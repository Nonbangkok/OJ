import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import * as db from '../db';
import { LESSON_IMPORT_LOCK_ID, LESSON_LIMITS } from '../constants/lessons';
import { readLessonBundle, type BundleLesson, type LessonBundle, type LessonBundleIssue } from './lessonBundleReader';

/**
 * Lesson bundle import (spec §5–6, D1/D2).
 *
 * A dry run reads and renders the bundle, checks every referenced problem
 * exists, and diffs it against the database by lesson slug. Applying runs the
 * same plan again inside one transaction (under an advisory lock, so two
 * imports never interleave) and then makes the database match the bundle:
 * tracks, modules and lessons are upserted by slug — so a learner's progress
 * survives re-imports — and whatever the bundle no longer has is deleted.
 * Deleting lessons that learners completed needs `confirmRemovals`.
 */

type Queryable = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => Promise<QueryResult<T>>;
};

export interface LessonDiffItem {
  slug: string;
  title: string;
  track: string;
  module: string;
}

export interface LessonRemovalItem extends LessonDiffItem {
  usersWithProgress: number;
}

export interface LessonImportPlan {
  bundleSha256: string;
  sourceCommit: string | null;
  lessons: {
    added: LessonDiffItem[];
    changed: LessonDiffItem[];
    removed: LessonRemovalItem[];
    unchanged: number;
  };
  tracks: { added: string[]; removed: string[] };
  issues: LessonBundleIssue[];
}

export type LessonImportResult =
  | { kind: 'invalid'; plan: LessonImportPlan }
  | { kind: 'needs_confirmation'; plan: LessonImportPlan }
  | { kind: 'imported'; plan: LessonImportPlan; importId: number };

interface ExistingLessonRow {
  id: number;
  slug: string;
  title: string;
  content_hash: string;
  module_slug: string;
  track_slug: string;
  users_with_progress: number;
}

const flattenLessons = (bundle: LessonBundle) => bundle.tracks.flatMap((track) =>
  track.modules.flatMap((module) => module.lessons.map((lesson) => ({ track, module, lesson }))));

async function missingProblemIssues(database: Queryable, bundle: LessonBundle): Promise<LessonBundleIssue[]> {
  const lessons = flattenLessons(bundle);
  const ids = [...new Set(lessons.flatMap(({ lesson }) => [...lesson.problems.map((p) => p.id), ...lesson.problemRefs]))];
  if (ids.length === 0) return [];
  const found = await database.query<{ id: string }>('SELECT id FROM problems WHERE id = ANY($1::text[])', [ids]);
  const existing = new Set(found.rows.map((row) => row.id));
  const issues: LessonBundleIssue[] = [];
  for (const { lesson } of lessons) {
    const missing = [...new Set([...lesson.problems.map((p) => p.id), ...lesson.problemRefs])].filter((id) => !existing.has(id));
    if (missing.length > 0) {
      issues.push({ path: lesson.file, message: `problem ${missing.map((id) => `"${id}"`).join(', ')} does not exist in this grader` });
    }
  }
  return issues;
}

async function buildPlan(database: Queryable, bundle: LessonBundle): Promise<{ plan: LessonImportPlan; existing: Map<string, ExistingLessonRow> }> {
  const issues = [...bundle.issues, ...await missingProblemIssues(database, bundle)];
  const existingRows = await database.query<ExistingLessonRow>(
    `SELECT l.id, l.slug, l.title, l.content_hash, m.slug AS module_slug, t.slug AS track_slug,
            (SELECT COUNT(*)::int FROM lesson_progress p WHERE p.lesson_id = l.id) AS users_with_progress
     FROM lessons l
     JOIN lesson_modules m ON m.id = l.module_id
     JOIN lesson_tracks t ON t.id = m.track_id
     ORDER BY t.position, m.position, l.position`,
  );
  const existing = new Map(existingRows.rows.map((row) => [row.slug, row]));
  const trackRows = await database.query<{ slug: string }>('SELECT slug FROM lesson_tracks ORDER BY position');
  const existingTracks = new Set(trackRows.rows.map((row) => row.slug));

  const added: LessonDiffItem[] = [];
  const changed: LessonDiffItem[] = [];
  let unchanged = 0;
  const bundleSlugs = new Set<string>();
  for (const { track, module, lesson } of flattenLessons(bundle)) {
    bundleSlugs.add(lesson.slug);
    const item = { slug: lesson.slug, title: lesson.title, track: track.slug, module: module.slug };
    const current = existing.get(lesson.slug);
    if (!current) added.push(item);
    else if (current.content_hash !== lesson.contentHash) changed.push(item);
    else unchanged += 1;
  }
  const removed = [...existing.values()]
    .filter((row) => !bundleSlugs.has(row.slug))
    .map((row) => ({ slug: row.slug, title: row.title, track: row.track_slug, module: row.module_slug, usersWithProgress: row.users_with_progress }));
  const bundleTracks = new Set(bundle.tracks.map((track) => track.slug));

  return {
    existing,
    plan: {
      bundleSha256: bundle.sha256,
      sourceCommit: bundle.sourceCommit,
      lessons: { added, changed, removed, unchanged },
      tracks: {
        added: bundle.tracks.map((t) => t.slug).filter((slug) => !existingTracks.has(slug)),
        removed: [...existingTracks].filter((slug) => !bundleTracks.has(slug)),
      },
      issues,
    },
  };
}

/** Dry run: what an import of this bundle would do. Throws LessonBundleError for an unreadable ZIP. */
export async function previewLessonImport(zip: Buffer): Promise<LessonImportPlan> {
  const bundle = await readLessonBundle(zip);
  return (await buildPlan(db, bundle)).plan;
}

class ImportStopped extends Error {
  constructor(readonly result: LessonImportResult) {
    super(result.kind);
  }
}

async function replaceLessonChildren(client: PoolClient, lessonId: number, lesson: BundleLesson): Promise<void> {
  await client.query('DELETE FROM lesson_problems WHERE lesson_id = $1', [lessonId]);
  if (lesson.problems.length > 0) {
    await client.query(
      `INSERT INTO lesson_problems (lesson_id, problem_id, position, role)
       SELECT $1, p.id, p.ord, p.role
       FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS p(id, role, ord)`,
      [lessonId, lesson.problems.map((p) => p.id), lesson.problems.map((p) => p.role)],
    );
  }
  await client.query('DELETE FROM lesson_assets WHERE lesson_id = $1', [lessonId]);
  for (const asset of lesson.assets) {
    await client.query(
      'INSERT INTO lesson_assets (lesson_id, name, mime_type, data) VALUES ($1, $2, $3, $4)',
      [lessonId, asset.name, asset.mimeType, asset.data],
    );
  }
}

async function writeBundle(client: PoolClient, bundle: LessonBundle, plan: LessonImportPlan, userId: number): Promise<number> {
  const touched = new Set([...plan.lessons.added, ...plan.lessons.changed].map((item) => item.slug));
  const keptModuleIds: number[] = [];

  for (const track of bundle.tracks) {
    const trackRow = await client.query<{ id: number }>(
      `INSERT INTO lesson_tracks (slug, title, description, position)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE
         SET title = EXCLUDED.title, description = EXCLUDED.description, position = EXCLUDED.position, updated_at = NOW()
       RETURNING id`,
      [track.slug, track.title, track.description, track.position],
    );
    const trackId = trackRow.rows[0].id;
    for (const module of track.modules) {
      const moduleRow = await client.query<{ id: number }>(
        `INSERT INTO lesson_modules (track_id, slug, title, summary, position)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (track_id, slug) DO UPDATE
           SET title = EXCLUDED.title, summary = EXCLUDED.summary, position = EXCLUDED.position
         RETURNING id`,
        [trackId, module.slug, module.title, module.summary, module.position],
      );
      const moduleId = moduleRow.rows[0].id;
      keptModuleIds.push(moduleId);
      for (const lesson of module.lessons) {
        const lessonRow = await client.query<{ id: number }>(
          `INSERT INTO lessons (module_id, slug, title, summary, position, reading_minutes, source_md, content_html, toc, content_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
           ON CONFLICT (slug) DO UPDATE
             SET module_id = EXCLUDED.module_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
                 position = EXCLUDED.position, reading_minutes = EXCLUDED.reading_minutes,
                 source_md = EXCLUDED.source_md, content_html = EXCLUDED.content_html, toc = EXCLUDED.toc,
                 updated_at = CASE WHEN lessons.content_hash IS DISTINCT FROM EXCLUDED.content_hash
                                   THEN NOW() ELSE lessons.updated_at END,
                 content_hash = EXCLUDED.content_hash
           RETURNING id`,
          [moduleId, lesson.slug, lesson.title, lesson.summary, lesson.position, lesson.minutes,
            lesson.source, lesson.html, JSON.stringify(lesson.toc), lesson.contentHash],
        );
        if (touched.has(lesson.slug)) await replaceLessonChildren(client, lessonRow.rows[0].id, lesson);
      }
    }
  }

  const lessonSlugs = flattenLessons(bundle).map(({ lesson }) => lesson.slug);
  await client.query('DELETE FROM lessons WHERE NOT (slug = ANY($1::text[]))', [lessonSlugs]);
  await client.query('DELETE FROM lesson_modules WHERE NOT (id = ANY($1::int[]))', [keptModuleIds]);
  await client.query('DELETE FROM lesson_tracks WHERE NOT (slug = ANY($1::text[]))', [bundle.tracks.map((t) => t.slug)]);

  const record = await client.query<{ id: number }>(
    `INSERT INTO lesson_imports (imported_by, bundle_sha256, source_commit, added, changed, removed)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, bundle.sha256, bundle.sourceCommit, plan.lessons.added.length, plan.lessons.changed.length, plan.lessons.removed.length],
  );
  return record.rows[0].id;
}

/**
 * Apply a bundle. Nothing is written unless the whole bundle is valid and,
 * when completed lessons would be deleted, `confirmRemovals` is set.
 */
export async function importLessonBundle(
  zip: Buffer,
  options: { userId: number; confirmRemovals: boolean },
): Promise<LessonImportResult> {
  const bundle = await readLessonBundle(zip);
  if (bundle.issues.length > 0) {
    return { kind: 'invalid', plan: (await buildPlan(db, bundle)).plan };
  }
  try {
    return await db.withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [LESSON_IMPORT_LOCK_ID]);
      const { plan } = await buildPlan(client as unknown as Queryable, bundle);
      if (plan.issues.length > 0) throw new ImportStopped({ kind: 'invalid', plan });
      if (!options.confirmRemovals && plan.lessons.removed.some((item) => item.usersWithProgress > 0)) {
        throw new ImportStopped({ kind: 'needs_confirmation', plan });
      }
      const importId = await writeBundle(client, bundle, plan, options.userId);
      return { kind: 'imported' as const, plan, importId };
    });
  } catch (error) {
    if (error instanceof ImportStopped) return error.result;
    throw error;
  }
}

export interface AdminLessonOverview {
  tracks: Array<{
    id: number;
    slug: string;
    title: string;
    is_visible: boolean;
    module_count: number;
    lesson_count: number;
    updated_at: string;
  }>;
  imports: Array<{
    id: number;
    imported_by: string | null;
    bundle_sha256: string;
    source_commit: string | null;
    added: number;
    changed: number;
    removed: number;
    created_at: string;
  }>;
}

export async function getAdminLessonOverview(): Promise<AdminLessonOverview> {
  const tracks = await db.query<AdminLessonOverview['tracks'][number]>(
    `SELECT t.id, t.slug, t.title, t.is_visible, t.updated_at,
            COUNT(DISTINCT m.id)::int AS module_count, COUNT(l.id)::int AS lesson_count
     FROM lesson_tracks t
     LEFT JOIN lesson_modules m ON m.track_id = t.id
     LEFT JOIN lessons l ON l.module_id = m.id
     GROUP BY t.id
     ORDER BY t.position`,
  );
  const imports = await db.query<AdminLessonOverview['imports'][number]>(
    `SELECT i.id, u.username AS imported_by, i.bundle_sha256, i.source_commit, i.added, i.changed, i.removed, i.created_at
     FROM lesson_imports i
     LEFT JOIN users u ON u.id = i.imported_by
     ORDER BY i.id DESC
     LIMIT $1`,
    [LESSON_LIMITS.IMPORT_HISTORY_LIMIT],
  );
  return { tracks: tracks.rows, imports: imports.rows };
}

/** Show or hide a track. Returns false when the track does not exist. */
export async function setLessonTrackVisibility(trackId: number, isVisible: boolean): Promise<boolean> {
  const result = await db.query('UPDATE lesson_tracks SET is_visible = $2 WHERE id = $1', [trackId, isVisible]);
  return (result.rowCount ?? 0) > 0;
}

import { randomUUID } from 'node:crypto';
import * as db from '../db';
import { AuthorProfileRow, ProblemDraftRow } from '../types/authoring';
import { AUTHORING_RUNNER, jobSnapshotSchema } from '../authoring/protocol';
import { StatementError } from '../authoring/statementSanitizer';
import { getAuthorProfile } from './authorProfileQueryService';
import { createFallbackAuthorAvatar } from './authorProfileImageService';
import { capturePdfSnapshot } from './authoringPdfSnapshotService';
import { ACTIVE_JOB_STATUSES, JobDatabase } from './authoringJobQueryService';

/** How often a contended draft is retried before it is deferred. */
export const PROFILE_SYNC = {
  MAX_ATTEMPTS: 5,
  RETRY_DELAY_MS: 12_000,
} as const;

export type ProfileSyncDatabase = JobDatabase;

export type ProfileSyncImpact = {
  affectedDrafts: number;
  affectedPublishedProblems: number;
};

/** Counts the drafts and published problems that a profile edit would cascade to. */
export async function getProfileSyncImpact(profileId: string, database: ProfileSyncDatabase = db): Promise<ProfileSyncImpact> {
  const drafts = (await database.query<{ count: number; published: number }>(`
    SELECT COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE published_at IS NOT NULL)::int AS published
    FROM problem_drafts WHERE author_profile_id=$1
  `, [profileId])).rows[0];
  return { affectedDrafts: drafts?.count ?? 0, affectedPublishedProblems: drafts?.published ?? 0 };
}

/**
 * Author-relevant fields: any of these changing means existing draft snapshots
 * are stale and the confirmation gate applies. `user_id` is an account link,
 * not author metadata.
 */
export const changesAuthorSnapshot = (
  current: AuthorProfileRow,
  updates: {
    aka_name?: string;
    real_name?: string;
    default_language?: string;
    country_code?: string;
    profile_image_png?: Buffer | null;
  },
): boolean => {
  if (updates.aka_name !== undefined && updates.aka_name !== current.aka_name) return true;
  if (updates.real_name !== undefined && updates.real_name !== current.real_name) return true;
  if (updates.default_language !== undefined && updates.default_language !== current.default_language) return true;
  if (updates.country_code !== undefined && updates.country_code !== current.country_code) return true;
  if (updates.profile_image_png !== undefined
    && !buffersEqual(updates.profile_image_png, current.profile_image_png)) return true;
  return false;
};

const buffersEqual = (a: Buffer | null, b: Buffer | null): boolean => {
  if (a === null || b === null) return a === b;
  return a.equals(b);
};

/** Queues one cascade covering every draft linked to the profile. */
export async function createProfileSync(
  profileId: string,
  database: ProfileSyncDatabase = db,
): Promise<{ syncId: string; affectedDrafts: number } | { kind: 'not_found' } | { kind: 'no_drafts' }> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const drafts = (await client.query<Pick<ProblemDraftRow, 'id'>>(`
      SELECT id FROM problem_drafts WHERE author_profile_id=$1 ORDER BY created_at, id
    `, [profileId])).rows;
    if (!drafts.length) {
      await client.query('ROLLBACK');
      return { kind: 'no_drafts' };
    }
    const syncId = randomUUID();
    await client.query(`INSERT INTO authoring_profile_syncs (id, profile_id) VALUES ($1, $2)`, [syncId, profileId]);
    for (const draft of drafts) {
      await client.query(`INSERT INTO authoring_profile_sync_items (id, sync_id, draft_id) VALUES ($1, $2, $3)`,
        [randomUUID(), syncId, draft.id]);
    }
    await client.query('COMMIT');
    return { syncId, affectedDrafts: drafts.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export type SyncItemResolution =
  | { kind: 'queued'; jobId: string; revision: number }
  | { kind: 'not_found' }
  | { kind: 'deferred'; reason: string }
  | { kind: 'failed'; reason: string };

/**
 * Advances one pending sync item: atomically refreshes the draft's author
 * snapshot, bumps its revision, and queues a sync_pdf runner job. Published
 * drafts stay published — the legacy problem row is refreshed when the PDF
 * result is imported.
 */
export async function startProfileSyncItem(
  itemId: string,
  database: ProfileSyncDatabase = db,
  now = Date.now(),
): Promise<SyncItemResolution> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const item = (await client.query<{ id: string; draft_id: string; attempts: number }>(
      'SELECT id, draft_id, attempts FROM authoring_profile_sync_items WHERE id=$1 FOR UPDATE', [itemId])).rows[0];
    if (!item) { await client.query('ROLLBACK'); return { kind: 'not_found' }; }
    const draft = (await client.query<ProblemDraftRow>(
      'SELECT * FROM problem_drafts WHERE id=$1 FOR UPDATE', [item.draft_id])).rows[0];
    if (!draft) { await client.query('ROLLBACK'); return { kind: 'not_found' }; }

    const profile = (await client.query<AuthorProfileRow>(
      'SELECT * FROM author_profiles WHERE id=(SELECT profile_id FROM authoring_profile_syncs WHERE id=(SELECT sync_id FROM authoring_profile_sync_items WHERE id=$1))',
      [itemId])).rows[0];
    if (!profile) { await client.query('ROLLBACK'); return { kind: 'not_found' }; }

    // Contentions: another active job holds the draft, or the runner queue is full.
    const active = await client.query('SELECT id FROM authoring_jobs WHERE draft_id=$1 AND status=ANY($2::text[])',
      [item.draft_id, ACTIVE_JOB_STATUSES]);
    if (active.rows[0]) {
      await deferOrRetry(client, itemId, item.attempts, 'draft busy with another authoring job', now);
      return await finishContention(client, itemId, item.attempts, now);
    }
    const count = await client.query('SELECT COUNT(*)::int AS count FROM authoring_jobs WHERE status=ANY($1::text[])',
      [ACTIVE_JOB_STATUSES]);
    if (count.rows[0].count >= AUTHORING_RUNNER.MAX_PENDING_JOBS) {
      await deferOrRetry(client, itemId, item.attempts, 'authoring queue is full', now);
      return await finishContention(client, itemId, item.attempts, now);
    }

    const avatar = profile.profile_image_png ?? await createFallbackAuthorAvatar(profile.aka_name);
    // Snapshot update keeps the draft's statement source untouched; the revision
    // bump is the sync's own authority. A published draft stays 'published' so a
    // later failed PDF rebuild cannot silently demote it and skip republish.
    const updated = (await client.query<ProblemDraftRow>(`
      UPDATE problem_drafts SET
        author_aka_name=$2, author_real_name=$3, language=$4, country_code=$5,
        author_profile_image_png=$6, revision=revision+1, verified_revision=NULL,
        status=CASE WHEN published_at IS NOT NULL THEN 'published' ELSE status END,
        updated_at=NOW()
      WHERE id=$1
      RETURNING *
    `, [item.draft_id, profile.aka_name, profile.real_name, profile.default_language,
      profile.country_code, avatar])).rows[0];

    let pdf: Awaited<ReturnType<typeof capturePdfSnapshot>>;
    try {
      pdf = await capturePdfSnapshot(client, updated);
    } catch (error) {
      // The statement source itself may be invalid for rendering (e.g. a missing
      // asset); leave the snapshot updated but record a terminal failure.
      if (error instanceof StatementError || (error as Error).name === 'ZodError') {
        await client.query(`UPDATE authoring_profile_sync_items SET status='failed',
          error_message=$2, sync_revision=$3, attempts=attempts+1, updated_at=NOW() WHERE id=$1`,
          [itemId, 'Statement could not be rendered to PDF', updated.revision]);
        await client.query('COMMIT');
        return { kind: 'failed', reason: 'Statement could not be rendered to PDF' };
      }
      throw error;
    }

    const parsed = jobSnapshotSchema.safeParse({
      version: 1, jobId: randomUUID(), draftId: updated.id, revision: updated.revision,
      kind: 'sync_pdf', source: '', pdf: pdf.snapshot,
      deadline: new Date(now + AUTHORING_RUNNER.JOB_TIMEOUT_MS).toISOString(),
    });
    if (!parsed.success) throw parsed.error;
    const snapshot = parsed.data;
    const job = (await client.query<{ id: string }>(`
      INSERT INTO authoring_jobs (id, draft_id, job_type, draft_revision, request_snapshot)
      VALUES ($1, $2, 'sync_pdf', $3, $4::jsonb) RETURNING id
    `, [snapshot.jobId, updated.id, updated.revision, JSON.stringify(snapshot)])).rows[0];
    await client.query("INSERT INTO authoring_job_files (job_id,name,content) VALUES ($1,'avatar',$2)", [snapshot.jobId, pdf.avatar]);
    await client.query(`INSERT INTO authoring_job_files (job_id,name,content)
      SELECT $1,'asset:'||filename,content FROM problem_draft_assets WHERE draft_id=$2`, [snapshot.jobId, updated.id]);
    await client.query(`UPDATE authoring_profile_sync_items SET status='syncing',
      attempts=attempts+1, sync_revision=$2, sync_pdf_job_id=$3, error_message=NULL, updated_at=NOW()
      WHERE id=$1`, [itemId, updated.revision, snapshot.jobId]);
    await client.query('COMMIT');
    return { kind: 'queued', jobId: snapshot.jobId, revision: updated.revision };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Records a bounded retry, or defers the item once attempts are exhausted. */
async function deferOrRetry(client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  itemId: string, attempts: number, reason: string, now: number): Promise<void> {
  if (attempts + 1 >= PROFILE_SYNC.MAX_ATTEMPTS) {
    await client.query(`UPDATE authoring_profile_sync_items SET status='deferred',
      attempts=attempts+1, error_message=$2, next_attempt_at=NULL, updated_at=NOW() WHERE id=$1`,
      [itemId, reason]);
  } else {
    await client.query(`UPDATE authoring_profile_sync_items SET attempts=attempts+1,
      next_attempt_at=$2, error_message=$3, updated_at=NOW() WHERE id=$1`,
      [itemId, new Date(now + PROFILE_SYNC.RETRY_DELAY_MS), reason]);
  }
}

async function finishContention(client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> },
  itemId: string, attempts: number, now: number): Promise<SyncItemResolution> {
  const item = (await client.query(
    'SELECT status, attempts, error_message FROM authoring_profile_sync_items WHERE id=$1', [itemId])).rows[0] as
    { status: string; attempts: number; error_message: string | null } | undefined;
  await client.query('COMMIT');
  if (item?.status === 'deferred') return { kind: 'deferred', reason: item.error_message ?? 'draft busy' };
  return { kind: 'failed', reason: `busy attempt ${attempts + 1} at ${new Date(now).toISOString()}` };
}

/** True when a pending item has waited past its next_attempt_at. */
export const isItemDue = (item: { next_attempt_at: Date | null }, now = Date.now()): boolean =>
  item.next_attempt_at === null || item.next_attempt_at.getTime() <= now;

/**
 * Reconciliation pass: starts due items, adopts running syncs, and finalizes
 * runs whose items are all terminal. Called from the authoring coordinator
 * tick, so transient failures are retried on the next tick.
 */
export async function reconcileProfileSyncs(database: ProfileSyncDatabase = db, now = Date.now()): Promise<void> {
  // Finalize runs whose items are all terminal.
  const finished = (await database.query<{ id: string }>(`
    SELECT s.id FROM authoring_profile_syncs s
    WHERE s.status IN ('queued', 'running')
      AND NOT EXISTS (SELECT 1 FROM authoring_profile_sync_items i
        WHERE i.sync_id = s.id AND i.status IN ('pending', 'syncing'))
  `)).rows;
  for (const { id } of finished) {
    const summary = (await database.query<{ synced: number; failed: number; deferred: number }>(`
      SELECT COUNT(*) FILTER (WHERE status='synced')::int AS synced,
        COUNT(*) FILTER (WHERE status='failed')::int AS failed,
        COUNT(*) FILTER (WHERE status='deferred')::int AS deferred
      FROM authoring_profile_sync_items WHERE sync_id=$1
    `, [id])).rows[0];
    const outcome = summary.failed > 0 ? 'failed' : 'succeeded';
    await database.query(`UPDATE authoring_profile_syncs SET status=$2,
      result_summary=$3::jsonb, finished_at=NOW() WHERE id=$1 AND status IN ('queued','running')`,
      [id, outcome, JSON.stringify({
        synced: summary.synced, failed: summary.failed, deferred: summary.deferred,
        ...(summary.deferred > 0 ? { warnings: ['Some drafts were busy and were left on their previous snapshot; re-run the sync later.'] } : {}),
      })]);
  }

  // Mark runs running once started.
  await database.query(`UPDATE authoring_profile_syncs SET status='running', started_at=COALESCE(started_at, NOW())
    WHERE status='queued' AND EXISTS (SELECT 1 FROM authoring_profile_sync_items i WHERE i.sync_id=authoring_profile_syncs.id)`);

  // Start due pending items.
  const due = (await database.query<{ id: string }>(`
    SELECT i.id FROM authoring_profile_sync_items i
    JOIN authoring_profile_syncs s ON s.id = i.sync_id
    WHERE i.status='pending' AND s.status IN ('queued', 'running')
      AND (i.next_attempt_at IS NULL OR i.next_attempt_at <= NOW())
    ORDER BY i.created_at, i.id
  `)).rows;
  for (const { id } of due) {
    try {
      const result = await startProfileSyncItem(id, database, now);
      if (result.kind === 'not_found') {
        await database.query(`UPDATE authoring_profile_sync_items SET status='deferred',
          error_message='draft no longer exists', updated_at=NOW() WHERE id=$1`, [id]);
      }
      // 'failed' and 'deferred' are terminal and already recorded; 'queued' is in flight.
    } catch (error) {
      // Transient DB errors surface here and are retried on the next tick.
      throw error;
    }
  }
}

/** Public projection for the Jobs tab. */
export async function getProfileSync(syncId: string, database: ProfileSyncDatabase = db) {
  const sync = (await database.query(`
    SELECT id, profile_id, status, result_summary, error_message, created_at, started_at, finished_at
    FROM authoring_profile_syncs WHERE id=$1`, [syncId])).rows[0];
  if (!sync) return null;
  const items = (await database.query(`
    SELECT i.id, i.draft_id, i.status, i.attempts, i.error_message,
      d.problem_id, d.title, d.status AS draft_status, d.published_at
    FROM authoring_profile_sync_items i
    JOIN problem_drafts d ON d.id = i.draft_id
    WHERE i.sync_id=$1 ORDER BY i.created_at, i.id`, [syncId])).rows;
  const totals = (await database.query(`
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status='synced')::int AS synced,
      COUNT(*) FILTER (WHERE status IN ('failed','deferred'))::int AS failed
    FROM authoring_profile_sync_items WHERE sync_id=$1`, [syncId])).rows[0];
  return {
    id: sync.id,
    profileId: sync.profile_id,
    status: sync.status,
    resultSummary: sync.result_summary,
    createdAt: sync.created_at,
    startedAt: sync.started_at,
    finishedAt: sync.finished_at,
    progress: { total: totals.total, synced: totals.synced, failed: totals.failed },
    items: items.map(item => ({
      draftId: item.draft_id, problemId: item.problem_id, title: item.title,
      status: item.status, attempts: item.attempts, errorMessage: item.error_message,
      draftStatus: item.draft_status, published: item.published_at !== null,
    })),
  };
}

/** Lists recent sync runs for the Jobs tab. */
export async function listProfileSyncs(limit = 20, database: ProfileSyncDatabase = db) {
  const syncs = (await database.query(`
    SELECT s.id, s.profile_id, s.status, s.result_summary, s.created_at, s.finished_at,
      p.aka_name AS profile_aka_name,
      (SELECT COUNT(*)::int FROM authoring_profile_sync_items i WHERE i.sync_id=s.id) AS total,
      (SELECT COUNT(*)::int FROM authoring_profile_sync_items i WHERE i.sync_id=s.id AND i.status='synced') AS synced,
      (SELECT COUNT(*)::int FROM authoring_profile_sync_items i WHERE i.sync_id=s.id AND i.status IN ('failed','deferred')) AS failed
    FROM authoring_profile_syncs s
    JOIN author_profiles p ON p.id = s.profile_id
    ORDER BY s.created_at DESC LIMIT $1`, [limit])).rows;
  return syncs.map(sync => ({
    id: sync.id, profileId: sync.profile_id, profileAkaName: sync.profile_aka_name,
    status: sync.status, resultSummary: sync.result_summary,
    createdAt: sync.created_at, finishedAt: sync.finished_at,
    progress: { total: sync.total, synced: sync.synced, failed: sync.failed },
  }));
}

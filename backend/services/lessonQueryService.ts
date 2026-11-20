import * as db from '../db';
import type { LessonProblemRole } from '../constants/lessons';
import type { LessonTocEntry } from './lessonMarkdown';

/**
 * Read side of Learn (spec §6). Hidden tracks — and everything in them — do
 * not exist for non-staff viewers. A lesson problem is "available" only when
 * the problem is visible and not attached to a scheduled/running contest
 * (problems.contest_id, the same rule GET /problems/:id applies); non-staff
 * viewers get no id or title for an unavailable one, so a contest's problems
 * cannot be learned from a lesson. Guests get `null` for every per-user field.
 */

export interface LearnViewer {
  userId: number | null;
  isStaff: boolean;
}

export interface LearnTrackSummary {
  slug: string;
  title: string;
  description: string | null;
  isVisible: boolean;
  moduleCount: number;
  lessonCount: number;
  completedCount: number | null;
}

export interface LearnContinueLesson {
  trackSlug: string;
  trackTitle: string;
  moduleTitle: string;
  lessonSlug: string;
  lessonTitle: string;
  minutes: number;
}

export interface LearnTracksResponse {
  tracks: LearnTrackSummary[];
  continueLesson: LearnContinueLesson | null;
}

export interface LearnLessonRow {
  slug: string;
  title: string;
  summary: string | null;
  minutes: number;
  completed: boolean | null;
  problemCount: number;
  solvedCount: number | null;
}

export interface LearnModule {
  slug: string;
  title: string;
  summary: string | null;
  lessons: LearnLessonRow[];
}

export interface LearnTrackResponse {
  track: { slug: string; title: string; description: string | null; isVisible: boolean };
  modules: LearnModule[];
}

export type LearnProblemStatus = 'solved' | 'attempted' | 'not_tried';

export interface LearnLessonProblem {
  position: number;
  role: LessonProblemRole;
  available: boolean;
  /** Staff only: why the problem is unavailable. */
  unavailableReason?: 'hidden' | 'in_contest';
  id: string | null;
  title: string | null;
  difficulty: number | null;
  problemType: string | null;
  status: LearnProblemStatus | null;
  bestScore: number | null;
  /** Per-case statuses of the viewer's best submission. */
  caseStatuses: string[] | null;
}

export interface LearnLessonLink {
  slug: string;
  title: string;
}

export interface LearnLessonResponse {
  lesson: {
    slug: string;
    title: string;
    summary: string | null;
    minutes: number;
    /** Sanitized HTML; `{{ASSET_BASE}}` stands for this lesson's asset route. */
    html: string;
    toc: LessonTocEntry[];
    updatedAt: string;
    completed: boolean | null;
  };
  track: { slug: string; title: string };
  module: { slug: string; title: string; lessonCount: number; completedCount: number | null };
  previous: LearnLessonLink | null;
  next: LearnLessonLink | null;
  problems: LearnLessonProblem[];
}

const userParam = (viewer: LearnViewer): number | null => viewer.userId;

export async function getLearnTracks(viewer: LearnViewer): Promise<LearnTracksResponse> {
  const tracks = await db.query<{
    slug: string; title: string; description: string | null; is_visible: boolean;
    module_count: number; lesson_count: number; completed_count: number;
  }>(
    `SELECT t.slug, t.title, t.description, t.is_visible,
            COUNT(DISTINCT m.id)::int AS module_count,
            COUNT(l.id)::int AS lesson_count,
            COUNT(p.lesson_id)::int AS completed_count
     FROM lesson_tracks t
     LEFT JOIN lesson_modules m ON m.track_id = t.id
     LEFT JOIN lessons l ON l.module_id = m.id
     LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.user_id = $1
     WHERE t.is_visible OR $2
     GROUP BY t.id
     ORDER BY t.position`,
    [userParam(viewer), viewer.isStaff],
  );

  let continueLesson: LearnContinueLesson | null = null;
  if (viewer.userId !== null) {
    const next = await db.query<{
      track_slug: string; track_title: string; module_title: string; slug: string; title: string; reading_minutes: number;
    }>(
      `WITH last_track AS (
         SELECT m.track_id
         FROM lesson_progress p
         JOIN lessons l ON l.id = p.lesson_id
         JOIN lesson_modules m ON m.id = l.module_id
         JOIN lesson_tracks t ON t.id = m.track_id
         WHERE p.user_id = $1 AND (t.is_visible OR $2)
         ORDER BY p.completed_at DESC
         LIMIT 1
       )
       SELECT t.slug AS track_slug, t.title AS track_title, m.title AS module_title,
              l.slug, l.title, l.reading_minutes
       FROM last_track lt
       JOIN lesson_tracks t ON t.id = lt.track_id
       JOIN lesson_modules m ON m.track_id = t.id
       JOIN lessons l ON l.module_id = m.id
       WHERE NOT EXISTS (SELECT 1 FROM lesson_progress p WHERE p.user_id = $1 AND p.lesson_id = l.id)
       ORDER BY m.position, l.position
       LIMIT 1`,
      [viewer.userId, viewer.isStaff],
    );
    const row = next.rows[0];
    if (row) {
      continueLesson = {
        trackSlug: row.track_slug, trackTitle: row.track_title, moduleTitle: row.module_title,
        lessonSlug: row.slug, lessonTitle: row.title, minutes: row.reading_minutes,
      };
    }
  }

  return {
    tracks: tracks.rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      description: row.description,
      isVisible: row.is_visible,
      moduleCount: row.module_count,
      lessonCount: row.lesson_count,
      completedCount: viewer.userId === null ? null : row.completed_count,
    })),
    continueLesson,
  };
}

/** null when the track does not exist or is hidden from this viewer. */
export async function getLearnTrack(trackSlug: string, viewer: LearnViewer): Promise<LearnTrackResponse | null> {
  const trackResult = await db.query<{ id: number; slug: string; title: string; description: string | null; is_visible: boolean }>(
    'SELECT id, slug, title, description, is_visible FROM lesson_tracks WHERE slug = $1 AND (is_visible OR $2)',
    [trackSlug, viewer.isStaff],
  );
  const track = trackResult.rows[0];
  if (!track) return null;

  const rows = await db.query<{
    module_slug: string; module_title: string; module_summary: string | null;
    slug: string | null; title: string | null; summary: string | null; reading_minutes: number | null;
    completed: boolean; problem_count: number; solved_count: number;
  }>(
    `SELECT m.slug AS module_slug, m.title AS module_title, m.summary AS module_summary,
            l.slug, l.title, l.summary, l.reading_minutes,
            EXISTS (SELECT 1 FROM lesson_progress p WHERE p.lesson_id = l.id AND p.user_id = $2) AS completed,
            (SELECT COUNT(*)::int FROM lesson_problems lp WHERE lp.lesson_id = l.id) AS problem_count,
            (SELECT COUNT(*)::int FROM lesson_problems lp
               JOIN user_problem_rewards r ON r.problem_id = lp.problem_id AND r.user_id = $2
             WHERE lp.lesson_id = l.id) AS solved_count
     FROM lesson_modules m
     LEFT JOIN lessons l ON l.module_id = m.id
     WHERE m.track_id = $1
     ORDER BY m.position, l.position`,
    [track.id, userParam(viewer)],
  );

  const modules: LearnModule[] = [];
  for (const row of rows.rows) {
    let module = modules[modules.length - 1];
    if (!module || module.slug !== row.module_slug) {
      module = { slug: row.module_slug, title: row.module_title, summary: row.module_summary, lessons: [] };
      modules.push(module);
    }
    if (row.slug !== null) {
      module.lessons.push({
        slug: row.slug,
        title: row.title!,
        summary: row.summary,
        minutes: row.reading_minutes!,
        completed: viewer.userId === null ? null : row.completed,
        problemCount: row.problem_count,
        solvedCount: viewer.userId === null ? null : row.solved_count,
      });
    }
  }

  return {
    track: { slug: track.slug, title: track.title, description: track.description, isVisible: track.is_visible },
    modules,
  };
}

interface LessonRow {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  reading_minutes: number;
  content_html: string;
  toc: LessonTocEntry[];
  updated_at: string;
  module_id: number;
  module_slug: string;
  module_title: string;
  track_id: number;
  track_slug: string;
  track_title: string;
}

/** The lesson if it exists and its track is visible to this viewer. */
async function findLesson(lessonSlug: string, viewer: LearnViewer): Promise<LessonRow | null> {
  const result = await db.query<LessonRow>(
    `SELECT l.id, l.slug, l.title, l.summary, l.reading_minutes, l.content_html, l.toc, l.updated_at,
            m.id AS module_id, m.slug AS module_slug, m.title AS module_title,
            t.id AS track_id, t.slug AS track_slug, t.title AS track_title
     FROM lessons l
     JOIN lesson_modules m ON m.id = l.module_id
     JOIN lesson_tracks t ON t.id = m.track_id
     WHERE l.slug = $1 AND (t.is_visible OR $2)`,
    [lessonSlug, viewer.isStaff],
  );
  return result.rows[0] ?? null;
}

/** Lesson id for a slug the viewer may see (progress and asset routes). */
export async function findVisibleLessonId(lessonSlug: string, viewer: LearnViewer): Promise<number | null> {
  return (await findLesson(lessonSlug, viewer))?.id ?? null;
}

export async function getLearnLesson(lessonSlug: string, viewer: LearnViewer): Promise<LearnLessonResponse | null> {
  const lesson = await findLesson(lessonSlug, viewer);
  if (!lesson) return null;
  const userId = userParam(viewer);

  const order = await db.query<{ slug: string; title: string; module_id: number; completed: boolean }>(
    `SELECT l.slug, l.title, l.module_id,
            EXISTS (SELECT 1 FROM lesson_progress p WHERE p.lesson_id = l.id AND p.user_id = $2) AS completed
     FROM lessons l
     JOIN lesson_modules m ON m.id = l.module_id
     WHERE m.track_id = $1
     ORDER BY m.position, l.position`,
    [lesson.track_id, userId],
  );
  const index = order.rows.findIndex((row) => row.slug === lesson.slug);
  const link = (row: { slug: string; title: string } | undefined): LearnLessonLink | null =>
    row ? { slug: row.slug, title: row.title } : null;
  const moduleRows = order.rows.filter((row) => row.module_id === lesson.module_id);

  const problems = await db.query<{
    position: number; role: LessonProblemRole; id: string; title: string; difficulty: number | null;
    problem_type: string; is_visible: boolean; contest_id: number | null;
    solved: boolean; best_score: number | null; submission_count: number; best_results: Array<{ status?: unknown }> | null;
  }>(
    `SELECT lp.position, lp.role, p.id, p.title, p.difficulty, p.problem_type, p.is_visible, p.contest_id,
            (r.user_id IS NOT NULL) AS solved,
            stats.best_score, COALESCE(stats.submission_count, 0) AS submission_count,
            best.results AS best_results
     FROM lesson_problems lp
     JOIN problems p ON p.id = lp.problem_id
     LEFT JOIN user_problem_rewards r ON r.problem_id = p.id AND r.user_id = $2
     LEFT JOIN LATERAL (
       SELECT MAX(s.score) AS best_score, COUNT(*)::int AS submission_count
       FROM submissions s WHERE s.user_id = $2 AND s.problem_id = p.id
     ) stats ON TRUE
     LEFT JOIN LATERAL (
       SELECT s.results FROM submissions s
       WHERE s.user_id = $2 AND s.problem_id = p.id
       ORDER BY s.score DESC NULLS LAST, s.id DESC
       LIMIT 1
     ) best ON TRUE
     WHERE lp.lesson_id = $1
     ORDER BY lp.position`,
    [lesson.id, userId],
  );

  const signedIn = viewer.userId !== null;
  return {
    lesson: {
      slug: lesson.slug,
      title: lesson.title,
      summary: lesson.summary,
      minutes: lesson.reading_minutes,
      html: lesson.content_html,
      toc: lesson.toc,
      updatedAt: lesson.updated_at,
      completed: signedIn ? order.rows[index]?.completed ?? false : null,
    },
    track: { slug: lesson.track_slug, title: lesson.track_title },
    module: {
      slug: lesson.module_slug,
      title: lesson.module_title,
      lessonCount: moduleRows.length,
      completedCount: signedIn ? moduleRows.filter((row) => row.completed).length : null,
    },
    previous: link(order.rows[index - 1]),
    next: link(order.rows[index + 1]),
    problems: problems.rows.map((row) => {
      const available = row.is_visible && row.contest_id === null;
      if (!available && !viewer.isStaff) {
        return {
          position: row.position, role: row.role, available: false,
          id: null, title: null, difficulty: null, problemType: null,
          status: null, bestScore: null, caseStatuses: null,
        };
      }
      const status: LearnProblemStatus | null = !signedIn ? null
        : row.solved ? 'solved' : row.submission_count > 0 ? 'attempted' : 'not_tried';
      return {
        position: row.position,
        role: row.role,
        available,
        ...(available ? {} : { unavailableReason: row.contest_id !== null ? 'in_contest' as const : 'hidden' as const }),
        id: row.id,
        title: row.title,
        difficulty: row.difficulty,
        problemType: row.problem_type,
        status,
        bestScore: signedIn && row.submission_count > 0 ? row.best_score : null,
        caseStatuses: signedIn
          ? (Array.isArray(row.best_results) ? row.best_results.map((r) => String(r?.status ?? '')) : [])
          : null,
      };
    }),
  };
}

export async function getLessonAsset(lessonSlug: string, name: string, viewer: LearnViewer): Promise<{ mimeType: string; data: Buffer } | null> {
  const result = await db.query<{ mime_type: string; data: Buffer }>(
    `SELECT a.mime_type, a.data
     FROM lesson_assets a
     JOIN lessons l ON l.id = a.lesson_id
     JOIN lesson_modules m ON m.id = l.module_id
     JOIN lesson_tracks t ON t.id = m.track_id
     WHERE l.slug = $1 AND a.name = $2 AND (t.is_visible OR $3)`,
    [lessonSlug, name, viewer.isStaff],
  );
  const row = result.rows[0];
  return row ? { mimeType: row.mime_type, data: row.data } : null;
}

/** Mark or unmark a lesson complete (idempotent). Returns the completion time, or null when cleared. */
export async function setLessonCompleted(userId: number, lessonId: number, completed: boolean): Promise<string | null> {
  if (!completed) {
    await db.query('DELETE FROM lesson_progress WHERE user_id = $1 AND lesson_id = $2', [userId, lessonId]);
    return null;
  }
  const result = await db.query<{ completed_at: string }>(
    `INSERT INTO lesson_progress (user_id, lesson_id) VALUES ($1, $2)
     ON CONFLICT (user_id, lesson_id) DO UPDATE SET completed_at = lesson_progress.completed_at
     RETURNING completed_at`,
    [userId, lessonId],
  );
  return result.rows[0].completed_at;
}

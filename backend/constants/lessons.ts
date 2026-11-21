/**
 * Lessons (Learn) limits and shared values.
 * Spec: docs/superpowers/specs/2026-11-20-lessons-mvp-design.md
 */

export const LESSON_PROBLEM_ROLES = ['example', 'practice', 'challenge'] as const;
export type LessonProblemRole = typeof LESSON_PROBLEM_ROLES[number];

export const LESSON_LIMITS = {
    /** Multipart field name of the bundle upload. */
    BUNDLE_FIELD_NAME: 'bundle',
    /** Compressed bundle size accepted by the upload (held in memory). */
    BUNDLE_MAX_BYTES: 25 * 1024 * 1024,
    /** Real inflated bytes read from one bundle, all entries together. */
    BUNDLE_MAX_INFLATED_BYTES: 64 * 1024 * 1024,
    MAX_ENTRIES: 2000,
    MAX_JSON_BYTES: 256 * 1024,
    MAX_MARKDOWN_BYTES: 200 * 1024,
    MAX_ASSET_BYTES: 2 * 1024 * 1024,
    MAX_TRACKS: 20,
    MAX_MODULES_PER_TRACK: 30,
    MAX_LESSONS_PER_MODULE: 40,
    MAX_LESSONS: 500,
    MAX_PROBLEMS_PER_LESSON: 20,
    MAX_ASSETS_PER_LESSON: 30,
    MAX_TITLE_LENGTH: 200,
    MAX_SUMMARY_LENGTH: 500,
    MAX_READING_MINUTES: 180,
    /** Nested directives (e.g. code tabs inside a solution). */
    MAX_DIRECTIVE_DEPTH: 3,
    /** Import history rows returned to the admin page. */
    IMPORT_HISTORY_LIMIT: 20,
} as const;

/** Lowercase kebab-case, used for track, module and lesson slugs. */
export const LESSON_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const LESSON_SLUG_MAX_LENGTH = 64;

/** Problem ids referenced from lessons (same shape the problems table allows). */
export const LESSON_PROBLEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,50}$/;

/** Lesson image assets: flat names, served back with this content type. */
export const LESSON_ASSET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const LESSON_ASSET_TYPES: Readonly<Record<string, string>> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
};

/** Bundle format version this backend understands (manifest.json "format"). */
export const LESSON_BUNDLE_FORMAT = 1;

/** One import at a time (pg_advisory_xact_lock key). */
export const LESSON_IMPORT_LOCK_ID = 734101;

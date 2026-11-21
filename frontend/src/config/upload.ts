/** Keep chunking thresholds consistent across the batch and single-problem upload flows. */
export const CHUNKED_UPLOAD_CONFIG = {
  singleRequestLimitBytes: 50 * 1024 * 1024,
  chunkSizeBytes: 25 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024 * 1024,
} as const;

/** Lessons bundle import (Manage › Lessons); mirrors the backend's LESSON_LIMITS.BUNDLE_MAX_BYTES. */
export const LESSON_BUNDLE_MAX_BYTES = 25 * 1024 * 1024;

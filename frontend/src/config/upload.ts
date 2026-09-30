/** Keep chunking thresholds consistent across the batch and single-problem upload flows. */
export const CHUNKED_UPLOAD_CONFIG = {
  singleRequestLimitBytes: 50 * 1024 * 1024,
  chunkSizeBytes: 25 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024 * 1024,
} as const;

import type { ProblemExportConfig } from '../types/api';
import { DEFAULT_SUBMISSION_FILENAME } from '../constants';
import type { ProblemExportBundle } from '../types/service';

/** Canonical portable config.json representation shared by all export paths. */
export const serializeProblemConfig = (
  problem: ProblemExportBundle['problem'],
): ProblemExportConfig => ({
  id: problem.id,
  title: problem.title,
  author: problem.author,
  time_limit_ms: problem.time_limit_ms,
  memory_limit_mb: problem.memory_limit_mb,
  categories: [...(problem.categories ?? [])],
  difficulty: problem.difficulty ?? null,
  collection: problem.collection_name ?? null,
  // Header-only keys: standard problems keep the legacy shape byte-for-byte.
  ...(problem.problem_type === 'header'
    ? {
      problem_type: 'header' as const,
      submission_filename: problem.submission_filename ?? DEFAULT_SUBMISSION_FILENAME,
    }
    : {}),
});

export default serializeProblemConfig;

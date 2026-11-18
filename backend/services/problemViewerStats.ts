/**
 * The problem page's per-viewer stats: the viewer's best submission (score
 * and per-case statuses, for the header strip) and their attempt count (the
 * Submissions tab). Sent by the standalone problem detail and, from the
 * viewer's own contest submissions, by the contest problem detail.
 */
export interface ProblemViewerStats {
  viewerBest: { score: number; caseStatuses: string[] } | null;
  viewerSubmissionCount: number;
}

/** A row selecting the best submission's score/results and the attempt count. */
export interface ProblemViewerStatsRow {
  best_score: number | null;
  best_results: unknown;
  submission_count: number;
}

export const toProblemViewerStats = (row: ProblemViewerStatsRow | undefined): ProblemViewerStats => {
  const caseStatuses = Array.isArray(row?.best_results)
    ? (row.best_results as { status?: unknown }[]).map((r) => String(r?.status ?? ''))
    : [];
  return {
    viewerBest: row?.best_score != null ? { score: Number(row.best_score), caseStatuses } : null,
    viewerSubmissionCount: Number(row?.submission_count ?? 0),
  };
};

import type { BatchUploadProgressState } from '../../types';
import type { AdminProblem } from '../../types';
import type { UploadProgress, UploadProgressState } from '../../types';

export const EMPTY_BATCH_PROGRESS: BatchUploadProgressState = {
  visible: false,
  processed: 0,
  total: 0,
  message: '',
  status: '',
  currentProblem: '',
};

export const getBulkVisibilityTargets = (problems: AdminProblem[], nextVisible: boolean): AdminProblem[] => {
  return problems.filter((problem) => problem.is_visible !== nextVisible && !problem.contest_id);
};

// --- Bulk selection ----------------------------------------------------------
// Selection is keyed by problem id (not row index) and always evaluated
// against the rows the table currently displays, so it composes with any
// filtering/pagination scheme, including future Show More incremental
// loading: newly displayed rows simply start unselected.

export interface ProblemSelectionState {
  /** Currently selected problem ids. Always replaced with a fresh Set on
   *  change — never mutated in place, so React can rely on identity. */
  ids: ReadonlySet<string>;
  /** Last individually activated row — the Shift+click range anchor. */
  anchorId: string | null;
}

export const EMPTY_PROBLEM_SELECTION: ProblemSelectionState = {
  ids: new Set<string>(),
  anchorId: null,
};

/** Apply one selection state to a batch of ids. `anchorId` follows the
 *  "null = keep the current anchor" convention. Returns the previous state
 *  object unchanged when nothing would change, so React can bail out. */
const applyIdsToSelection = (
  state: ProblemSelectionState,
  ids: readonly string[],
  selected: boolean,
  anchorId: string | null,
): ProblemSelectionState => {
  const next = new Set(state.ids);
  let changed = false;
  for (const id of ids) {
    if (selected && !next.has(id)) {
      next.add(id);
      changed = true;
    } else if (!selected && next.has(id)) {
      next.delete(id);
      changed = true;
    }
  }
  const nextAnchorId = anchorId ?? state.anchorId;
  if (!changed && nextAnchorId === state.anchorId) {
    return state;
  }
  return { ids: next, anchorId: nextAnchorId };
};

/** Single-row apply — used by the drag gesture (state decided at gesture
 *  start) and shared with the toggle logic. */
export const applyRowSelection = (
  state: ProblemSelectionState,
  problemId: string,
  selected: boolean,
  anchorId: string | null,
): ProblemSelectionState => applyIdsToSelection(state, [problemId], selected, anchorId);

/** Toggle one row (previous behavior, kept for callers/tests that only
 *  want the plain toggle semantics). */
export const toggleSelectedProblem = (
  selected: Array<string | number>,
  problemId: string | number,
): Array<string | number> => {
  return selected.includes(problemId)
    ? selected.filter((id) => id !== problemId)
    : [...selected, problemId];
};

/** Toggle one row, or — with shiftKey — select/deselect the whole
 *  anchor..row range in current display order (either direction). The range
 *  takes the OPPOSITE of the clicked row's current state: clicking an
 *  unchecked row with Shift selects the range, clicking a checked row
 *  deselects it. A Shift+click never moves the anchor; a plain click does.
 *  If the anchor is missing from the display (or is the clicked row
 *  itself), it degrades to a plain toggle. */
export const computeSelectionAfterToggle = (
  state: ProblemSelectionState,
  displayedProblems: AdminProblem[],
  problemId: string,
  { shiftKey }: { shiftKey: boolean },
): ProblemSelectionState => {
  if (shiftKey && state.anchorId !== null && state.anchorId !== problemId) {
    const anchorIndex = displayedProblems.findIndex((problem) => problem.id === state.anchorId);
    const targetIndex = displayedProblems.findIndex((problem) => problem.id === problemId);
    if (anchorIndex !== -1 && targetIndex !== -1) {
      const [from, to] = anchorIndex < targetIndex
        ? [anchorIndex, targetIndex]
        : [targetIndex, anchorIndex];
      const rangeIds = displayedProblems.slice(from, to + 1).map((problem) => problem.id);
      return applyIdsToSelection(
        state,
        rangeIds,
        !state.ids.has(problemId),
        null,
      );
    }
  }
  return applyIdsToSelection(state, [problemId], !state.ids.has(problemId), problemId);
};

/** Header checkbox semantics: select/deselect every currently displayed
 *  row (never rows that are merely loaded server-side). */
export const selectDisplayedIds = (
  state: ProblemSelectionState,
  displayedIds: readonly string[],
  selected: boolean,
): ProblemSelectionState => applyIdsToSelection(state, displayedIds, selected, null);

/** Drop selected ids that are no longer displayed (deleted problems, data
 *  refreshes, filter changes). Never unselects a row that is still
 *  displayed — which is exactly what makes this safe with Show More:
 *  appending rows prunes nothing. */
export const pruneSelectionToDisplayed = (
  state: ProblemSelectionState,
  displayedProblems: AdminProblem[],
): ProblemSelectionState => {
  if (state.ids.size === 0) {
    return state;
  }
  const displayedIds = new Set(displayedProblems.map((problem) => problem.id));
  const next = new Set<string>();
  let changed = false;
  state.ids.forEach((id) => {
    if (displayedIds.has(id)) {
      next.add(id);
    } else {
      changed = true;
    }
  });
  if (!changed) {
    return state;
  }
  const anchorGone = state.anchorId !== null && !displayedIds.has(state.anchorId);
  return { ids: next, anchorId: anchorGone ? null : state.anchorId };
};

export const getFilenameFromDisposition = (contentDisposition?: string): string => {
  if (!contentDisposition) {
    return `problems_export_${Date.now()}.zip`;
  }

  const filenameMatch = contentDisposition.match(/filename="(.+)"/);
  return filenameMatch?.[1] || `problems_export_${Date.now()}.zip`;
};

export const parseProgressEventData = (eventData: string): BatchUploadProgressState | null => {
  try {
    const data = JSON.parse(eventData) as Partial<BatchUploadProgressState>;
    if (typeof data.processed !== 'number' || typeof data.total !== 'number') {
      return null;
    }
    return {
      ...EMPTY_BATCH_PROGRESS,
      ...data,
      visible: true,
      status: 'in_progress',
    };
  } catch {
    return null;
  }
};

export const buildBatchUploadSuccessMessage = (
  added?: string[],
  skipped?: string[],
  message?: string,
): string => {
  if (added && skipped) {
    return `Batch upload complete. Added ${added.length} problems, skipped ${skipped.length} problems.`;
  }

  if (message) {
    return message;
  }

  return 'Batch upload process finished.';
};

export const normalizeUploadProgress = (progress: UploadProgress): UploadProgressState => {
  const normalizedStatus: UploadProgressState['status'] =
    progress.status === 'pending' ||
    progress.status === 'uploading' ||
    progress.status === 'completed' ||
    progress.status === 'failed'
      ? progress.status
      : 'failed';

  return {
    status: normalizedStatus,
    message: progress.message || '',
  };
};

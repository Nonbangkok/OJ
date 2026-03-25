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

export const toggleSelectedProblem = (
  selected: Array<string | number>,
  problemId: string | number,
): Array<string | number> => {
  return selected.includes(problemId)
    ? selected.filter((id) => id !== problemId)
    : [...selected, problemId];
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

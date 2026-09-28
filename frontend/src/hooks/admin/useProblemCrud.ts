import { useCallback, useEffect, useRef, useState } from 'react';

import adminService from '../../services/adminService';
import { POLLING_INTERVALS } from '../../config/constants';
import type {
  AdminProblem,
  AdminProblemsQuery,
  ProblemDetail,
  ProblemSelectionBulkConfirm,
  UploadProgressState,
} from '../../types';
import { getErrorMessage, toApiLikeError } from '../../utils/error';
import type { ProblemCategory } from '../../utils/constants';

import { useAdminProblemsPage } from './useAdminProblemsPage';
import { getBulkVisibilityTargets, normalizeUploadProgress } from './problemManagement.helpers';

export interface ProblemSaveData {
  id: string;
  title: string;
  author: string;
  categories?: readonly ProblemCategory[];
  /** Codeforces-like rating (800–3500 step 100); null = Unrated. */
  difficulty?: number | null;
  time_limit_ms: number;
  memory_limit_mb: number;
}

export interface ProblemSavePayload {
  problemData: ProblemSaveData;
  pdfFile: File | null;
  zipFile: File | null;
}

/** Stop polling a stuck upload job after this many polls; the backend job is
 *  still running, but the UI no longer waits on it indefinitely. */
const UPLOAD_POLL_MAX_ATTEMPTS = 300;

interface UseProblemCrudArgs {
  /** Server-side filter query for the paged admin problem list. */
  query: AdminProblemsQuery;
}

const useProblemCrud = ({ query }: UseProblemCrudArgs) => {
  const {
    problems,
    loading: pageLoading,
    error: pageError,
    loadingMore,
    loadMoreError,
    hasMore,
    authors,
    hasUnauthoredProblems,
    loadMore,
    refresh,
  } = useAdminProblemsPage(query);

  // Mutation-busy flag (bulk ops, edit modal); the paged hook owns the
  // initial list load, so this starts false and only flips during mutations.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProblem, setEditingProblem] = useState<ProblemDetail | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);

  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [problemToDelete, setProblemToDelete] = useState<string | null>(null);

  const [bulkConfirm, setBulkConfirm] = useState<ProblemSelectionBulkConfirm>({ isOpen: false, type: null });

  // The paged hook owns list loading state; a busy overlay is shown while
  // ANY of the two is true (page fetch, or a mutation-driven loading flag).
  const listBusy = pageLoading || loading;
  const listError = error || pageError;

  /** Re-fetch the loaded page span (first batch through the current
   *  cursor) under the current filters — keeps the table position after
   *  mutations instead of collapsing back to the first batch. */
  const fetchProblems = useCallback(async () => {
    await refresh();
  }, [refresh]);

  const handleDeleteClick = (problemId: string) => {
    setProblemToDelete(problemId);
    setIsConfirmModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!problemToDelete) {
      return;
    }

    try {
      await adminService.deleteProblem(problemToDelete);
      await fetchProblems();
    } catch (errorValue) {
      setError('Failed to delete problem.');
      console.error(errorValue);
    } finally {
      setIsConfirmModalOpen(false);
      setProblemToDelete(null);
    }
  };

  const handleToggleVisibility = async (problemId: string, currentVisibility: boolean) => {
    try {
      await adminService.updateProblemVisibility(problemId, !currentVisibility);
      await fetchProblems();
    } catch (errorValue) {
      setError('Failed to update problem visibility.');
      console.error(errorValue);
    }
  };

  const executeBulkVisibility = async (nextVisible: boolean) => {
    try {
      setLoading(true);
      const targets = getBulkVisibilityTargets(problems, nextVisible);
      await Promise.all(
        targets.map((problem) => adminService.updateProblemVisibility(problem.id, nextVisible)),
      );
      await fetchProblems();
    } catch (errorValue) {
      setError(nextVisible ? 'Failed to show all problems.' : 'Failed to hide all problems.');
      console.error(errorValue);
    } finally {
      setLoading(false);
      setBulkConfirm({ isOpen: false, type: null });
    }
  };

  const handleHideAll = () => {
    setBulkConfirm({ isOpen: true, type: 'hide' });
  };

  /** Bulk visibility for the SELECTED problems only (the selection bar's
   *  Show/Hide) — distinct from the global Show All / Hide All. */
  const setSelectionVisibility = async (problemIds: Array<string | number>, isVisible: boolean) => {
    try {
      setLoading(true);
      await Promise.all(
        problemIds.map((id) => adminService.updateProblemVisibility(id, isVisible)),
      );
      await fetchProblems();
    } catch (errorValue) {
      setError(isVisible ? 'Failed to show the selected problems.' : 'Failed to hide the selected problems.');
      console.error(errorValue);
    } finally {
      setLoading(false);
    }
  };

  /** Move the SELECTED problems to one collection (or none). At most one
   *  collection per problem — assignment replaces any previous value. */
  const moveSelectionToCollection = async (problemIds: Array<string | number>, collectionId: number | null) => {
    try {
      setLoading(true);
      await Promise.all(
        problemIds.map(async (id) => {
          const detail = await adminService.getProblemDetail(String(id));
          await adminService.updateProblem(String(id), {
            id: detail.id,
            title: detail.title,
            author: detail.author,
            categories: detail.categories as never,
            difficulty: detail.difficulty,
            collection_id: collectionId,
            time_limit_ms: detail.time_limit_ms,
            memory_limit_mb: detail.memory_limit_mb,
          });
        }),
      );
      await fetchProblems();
    } catch (errorValue) {
      setError('Failed to move the selected problems.');
      console.error(errorValue);
    } finally {
      setLoading(false);
    }
  };

  const executeHideAll = async () => {
    await executeBulkVisibility(false);
  };

  const handleShowAll = () => {
    setBulkConfirm({ isOpen: true, type: 'show' });
  };

  const executeShowAll = async () => {
    await executeBulkVisibility(true);
  };

  const handleEdit = async (problem: AdminProblem) => {
    try {
      setLoading(true);
      const data = await adminService.getProblemDetail(problem.id);
      setEditingProblem(data);
      setIsModalOpen(true);
    } catch (errorValue) {
      setError('Failed to fetch problem details.');
      console.error(errorValue);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingProblem(null);
    setIsModalOpen(true);
  };

  const handleSave = async ({ problemData, pdfFile, zipFile }: ProblemSavePayload) => {
    const isEditing = Boolean(editingProblem);
    setUploadProgress({ status: 'pending', message: 'Initiating save...' });

    try {
      let problemIdForUpload = problemData.id;

      if (isEditing && editingProblem) {
        await adminService.updateProblem(editingProblem.id, problemData);
      } else {
        const data = await adminService.createProblem(problemData);
        problemIdForUpload = data.id || problemData.id;
      }

      if (pdfFile || zipFile) {
        const fileData = new FormData();
        if (pdfFile) {
          fileData.append('problemPdf', pdfFile);
        }
        if (zipFile) {
          fileData.append('testcasesZip', zipFile);
        }

        setUploadProgress({ status: 'uploading', message: 'Uploading files to server...' });

        const data = await adminService.uploadFiles(problemIdForUpload, fileData);
        const { jobId } = data;

        if (jobId) {
          startUploadProgressPolling(jobId);
        } else {
          setIsModalOpen(false);
          await fetchProblems();
          setUploadProgress(null);
        }
      } else {
        setIsModalOpen(false);
        await fetchProblems();
        setUploadProgress(null);
      }
    } catch (errorValue) {
      const apiError = toApiLikeError(errorValue);
      const errorMsg = getErrorMessage(apiError, 'Failed to save problem.');
      setError(errorMsg);
      setUploadProgress({ status: 'failed', message: errorMsg });
      console.error(apiError);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setUploadProgress(null);
  };

  // --- upload progress polling (leak-safe) ---------------------------------

  const uploadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uploadPollAttemptsRef = useRef(0);
  const isMountedRef = useRef(true);

  const stopUploadProgressPolling = useCallback(() => {
    if (uploadPollRef.current !== null) {
      clearInterval(uploadPollRef.current);
      uploadPollRef.current = null;
    }
  }, []);

  const startUploadProgressPolling = (jobId: string) => {
    stopUploadProgressPolling();
    uploadPollAttemptsRef.current = 0;

    uploadPollRef.current = setInterval(async () => {
      if (!isMountedRef.current) {
        stopUploadProgressPolling();
        return;
      }

      if (uploadPollAttemptsRef.current >= UPLOAD_POLL_MAX_ATTEMPTS) {
        stopUploadProgressPolling();
        setError('Upload processing timed out.');
        setUploadProgress({ status: 'failed', message: 'Processing did not finish in time.' });
        return;
      }
      uploadPollAttemptsRef.current += 1;

      try {
        const progressData = await adminService.getUploadProgress(jobId);
        setUploadProgress(normalizeUploadProgress(progressData));

        if (progressData.status === 'completed' || progressData.status === 'failed') {
          stopUploadProgressPolling();
          if (progressData.status === 'completed') {
            setIsModalOpen(false);
            await fetchProblems();
            setUploadProgress(null);
          }
        }
      } catch (pollError) {
        console.error('Polling error:', pollError);
        setError('Failed to get upload progress.');
        setUploadProgress({ status: 'failed', message: 'Could not retrieve processing status.' });
        stopUploadProgressPolling();
      }
    }, POLLING_INTERVALS.BATCH_PROCESS);
  };

  // Cleanup on unmount: stop the interval and flip the mounted flag so an
  // in-flight poll callback can never setState on an unmounted component.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopUploadProgressPolling();
    };
  }, [stopUploadProgressPolling]);

  return {
    problems,
    loading: listBusy,
    setLoading,
    error: listError,
    setError,
    loadingMore,
    loadMoreError,
    hasMore,
    authors,
    hasUnauthoredProblems,
    loadMore,
    isModalOpen,
    setIsModalOpen,
    editingProblem,
    setEditingProblem,
    uploadProgress,
    setUploadProgress,
    isConfirmModalOpen,
    setIsConfirmModalOpen,
    problemToDelete,
    setProblemToDelete,
    bulkConfirm,
    setBulkConfirm,
    fetchProblems,
    handleDeleteClick,
    handleConfirmDelete,
    handleToggleVisibility,
    handleHideAll,
    executeHideAll,
    setSelectionVisibility,
    moveSelectionToCollection,
    handleShowAll,
    executeShowAll,
    handleEdit,
    handleCreate,
    handleSave,
    handleCloseModal,
  };
};

export default useProblemCrud;

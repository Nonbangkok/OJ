import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import adminService from '../../services/adminService';
import { POLLING_INTERVALS } from '../../config/constants';
import type {
  AdminProblem,
  BatchUploadFeedback,
  BatchUploadProgressState,
  ProblemDetail,
  ProblemSelectionBulkConfirm,
  UploadProgressState,
} from '../../types';
import { getErrorMessage, toApiLikeError } from '../../utils/error';

import {
  buildBatchUploadSuccessMessage,
  EMPTY_BATCH_PROGRESS,
  getBulkVisibilityTargets,
  getFilenameFromDisposition,
  normalizeUploadProgress,
  parseProgressEventData,
  toggleSelectedProblem,
} from './problemManagement.helpers';

interface ProblemSaveData {
  id: string;
  title: string;
  author: string;
  time_limit_ms: number;
  memory_limit_mb: number;
}

interface ProblemSavePayload {
  problemData: ProblemSaveData;
  pdfFile: File | null;
  zipFile: File | null;
}

const DEFAULT_BATCH_FEEDBACK: BatchUploadFeedback = { visible: false, message: '', type: 'info' };

const useProblemManagement = () => {
  const [problems, setProblems] = useState<AdminProblem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProblem, setEditingProblem] = useState<ProblemDetail | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [selectedProblems, setSelectedProblems] = useState<Array<string | number>>([]);

  const [batchUploadFeedback, setBatchUploadFeedback] = useState<BatchUploadFeedback>(DEFAULT_BATCH_FEEDBACK);
  const [batchUploadProgress, setBatchUploadProgress] = useState<BatchUploadProgressState>(EMPTY_BATCH_PROGRESS);

  const batchUploadInputRef = useRef<HTMLInputElement | null>(null);

  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [problemToDelete, setProblemToDelete] = useState<string | null>(null);

  const [bulkConfirm, setBulkConfirm] = useState<ProblemSelectionBulkConfirm>({ isOpen: false, type: null });

  const fetchProblems = useCallback(async () => {
    try {
      const data = await adminService.getProblems();
      setProblems(data);
    } catch (errorValue) {
      setError('Failed to fetch problems.');
      console.error(errorValue);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProblems();
  }, [fetchProblems]);

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

  const handleToggleSelectProblem = (problemId: string | number) => {
    setSelectedProblems((prev) => toggleSelectedProblem(prev, problemId));
  };

  const handleSelectAll = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      setSelectedProblems(problems.map((problem) => problem.id));
      return;
    }

    setSelectedProblems([]);
  };

  const handleExportSelected = async () => {
    if (selectedProblems.length === 0) {
      setBatchUploadFeedback({
        visible: true,
        message: 'Please select at least one problem to export.',
        type: 'warning',
      });
      return;
    }

    setBatchUploadFeedback({ visible: true, message: 'Initiating problem export...', type: 'info' });

    try {
      const response = await adminService.exportProblems(selectedProblems);
      const blob = new Blob([response.data], { type: response.headers['content-type'] });
      const downloadUrl = window.URL.createObjectURL(blob);
      const filename = getFilenameFromDisposition(response.headers['content-disposition']);

      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setBatchUploadFeedback({
        visible: true,
        message: `${selectedProblems.length} problems exported successfully!`,
        type: 'success',
      });
      setSelectedProblems([]);
    } catch (errorValue) {
      const errorMsg = getErrorMessage(errorValue, 'Failed to export problems.');
      setBatchUploadFeedback({ visible: true, message: errorMsg, type: 'error' });
      console.error('Error exporting problems:', errorValue);
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerBatchUpload = () => {
    setBatchUploadFeedback(DEFAULT_BATCH_FEEDBACK);
    batchUploadInputRef.current?.click();
  };

  const handleBatchUploadFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setLoading(true);
    setBatchUploadFeedback({ visible: true, message: 'Initiating batch upload...', type: 'info' });
    setBatchUploadProgress({
      visible: true,
      processed: 0,
      total: 0,
      message: 'Starting upload...',
      status: 'pending',
      currentProblem: '',
    });

    const formData = new FormData();
    formData.append('problemsZip', file);

    try {
      const response = await adminService.batchUploadProblems(formData);
      const { progressId } = response;

      if (progressId) {
        setBatchUploadFeedback({
          visible: true,
          message: 'File uploaded. Waiting for processing to start...',
          type: 'info',
        });

        const eventSource = adminService.getBatchUploadProgressEventSource(progressId);

        eventSource.addEventListener('progress', (progressEvent: MessageEvent<string>) => {
          const progressState = parseProgressEventData(progressEvent.data);
          if (!progressState) {
            console.warn('Received malformed progress data (progress event):', progressEvent.data);
            setBatchUploadFeedback({ visible: true, message: 'Received malformed progress update.', type: 'info' });
            return;
          }

          setBatchUploadProgress(progressState);
          setBatchUploadFeedback({ visible: true, message: 'Batch processing problems...', type: 'info' });
        });

        eventSource.addEventListener('complete', (completeEvent: MessageEvent<string>) => {
          const data = JSON.parse(completeEvent.data) as Partial<BatchUploadProgressState>;
          setBatchUploadProgress({
            ...EMPTY_BATCH_PROGRESS,
            ...data,
            visible: false,
            status: 'completed',
            currentProblem: data.currentProblem ?? '',
          });

          setBatchUploadFeedback({
            visible: true,
            message: buildBatchUploadSuccessMessage(data.added, data.skipped, data.message),
            type: 'success',
          });

          eventSource.close();
          void fetchProblems();
          setLoading(false);
        });

        eventSource.addEventListener('error', (errorEvent: MessageEvent<string>) => {
          let errorMsg = 'An unknown error occurred during processing.';
          if (errorEvent.data) {
            try {
              const data = JSON.parse(errorEvent.data) as { message?: string };
              errorMsg = data.message || errorMsg;
            } catch {
              errorMsg = errorEvent.data;
            }
          }

          setBatchUploadProgress({
            ...EMPTY_BATCH_PROGRESS,
            visible: false,
            message: errorMsg,
            status: 'error',
          });
          setBatchUploadFeedback({ visible: true, message: errorMsg, type: 'error' });
          eventSource.close();
          setLoading(false);
        });
      } else {
        const { added = [], skipped = [], errors = [] } = response;
        let feedbackMessage = `Batch upload complete. Added: ${added.length}. Skipped: ${skipped.length}.`;

        if (errors.length > 0) {
          const errorDetails = errors.map((item) => `${item.directory}: ${item.message}`).join('; ');
          feedbackMessage += ` Errors: ${errors.length} (${errorDetails})`;
          setBatchUploadFeedback({ visible: true, message: feedbackMessage, type: 'error' });
        } else {
          setBatchUploadFeedback({ visible: true, message: feedbackMessage, type: 'success' });
        }

        await fetchProblems();
        setLoading(false);
      }
    } catch (errorValue) {
      const errorMsg = getErrorMessage(errorValue, 'Failed to batch upload problems.');
      setBatchUploadFeedback({ visible: true, message: errorMsg, type: 'error' });
      setBatchUploadProgress({
        ...EMPTY_BATCH_PROGRESS,
        visible: false,
        message: errorMsg,
        status: 'error',
      });
      setLoading(false);
    } finally {
      if (batchUploadInputRef.current) {
        batchUploadInputRef.current.value = '';
      }
    }
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
          const pollInterval = setInterval(async () => {
            try {
              const progressData = await adminService.getUploadProgress(jobId);
              setUploadProgress(normalizeUploadProgress(progressData));

              if (progressData.status === 'completed' || progressData.status === 'failed') {
                clearInterval(pollInterval);
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
              clearInterval(pollInterval);
            }
          }, POLLING_INTERVALS.BATCH_PROCESS);
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

  return {
    problems,
    loading,
    error,
    isModalOpen,
    setIsModalOpen,
    editingProblem,
    setEditingProblem,
    uploadProgress,
    setUploadProgress,
    selectedProblems,
    setSelectedProblems,
    batchUploadFeedback,
    setBatchUploadFeedback,
    batchUploadProgress,
    setBatchUploadProgress,
    batchUploadInputRef,
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
    handleShowAll,
    executeShowAll,
    handleEdit,
    handleCreate,
    handleToggleSelectProblem,
    handleSelectAll,
    handleExportSelected,
    handleTriggerBatchUpload,
    handleBatchUploadFileChange,
    handleSave,
    handleCloseModal,
  };
};

export default useProblemManagement;

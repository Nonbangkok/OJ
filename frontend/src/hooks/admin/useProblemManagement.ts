import { useState, useEffect, useRef, useCallback } from 'react';
import adminService from '../../services/adminService';
import { POLLING_INTERVALS } from '../../config/constants';
import { Problem } from '../../types';

interface AdminProblem extends Problem {
  is_visible?: boolean;
  contest_id?: string | number;
  contest_status?: string;
}

interface BatchUploadProgress {
  visible: boolean;
  processed: number;
  total: number;
  message: string;
  status: string;
  currentProblem?: string;
}

const useProblemManagement = () => {
    const [problems, setProblems] = useState<AdminProblem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProblem, setEditingProblem] = useState<AdminProblem | null>(null);
    const [uploadProgress, setUploadProgress] = useState<any>(null);
    const [selectedProblems, setSelectedProblems] = useState<(string | number)[]>([]);

    // Batch upload feedback
    const [batchUploadFeedback, setBatchUploadFeedback] = useState({ visible: false, message: '', type: 'info' });
    const [batchUploadProgress, setBatchUploadProgress] = useState<BatchUploadProgress>({ visible: false, processed: 0, total: 0, message: '', status: '' });

    // Ref for the hidden file input
    const batchUploadInputRef = useRef<HTMLInputElement>(null);

    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [problemToDelete, setProblemToDelete] = useState<string | number | null>(null);

    // Bulk action confirmation
    const [bulkConfirm, setBulkConfirm] = useState({ isOpen: false, type: null as string | null });

    const fetchProblems = useCallback(async () => {
        try {
            // setLoading(true); // Don't trigger full reload on every refetch to prevent UI jumps
            const data = await adminService.getProblems();
            setProblems(data);
        } catch (err: any) {
            setError('Failed to fetch problems.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProblems();
    }, [fetchProblems]);

    const handleDeleteClick = (problemId: string | number) => {
        setProblemToDelete(problemId);
        setIsConfirmModalOpen(true);
    };

    const handleConfirmDelete = async () => {
        if (problemToDelete) {
            try {
                await adminService.deleteProblem(problemToDelete);
                fetchProblems();
            } catch (err: any) {
                setError('Failed to delete problem.');
                console.error(err);
            } finally {
                setIsConfirmModalOpen(false);
                setProblemToDelete(null);
            }
        }
    };

    const handleToggleVisibility = async (problemId: string | number, currentVisibility: boolean) => {
        try {
            await adminService.updateProblemVisibility(problemId, !currentVisibility);
            fetchProblems();
        } catch (err: any) {
            setError('Failed to update problem visibility.');
            console.error(err);
        }
    };

    const handleHideAll = () => {
        setBulkConfirm({ isOpen: true, type: 'hide' });
    };

    const executeHideAll = async () => {
        try {
            setLoading(true);
            const hidePromises = problems
                .filter(problem => problem.is_visible && !problem.contest_id)
                .map(problem =>
                    adminService.updateProblemVisibility(problem.id, false)
                );

            await Promise.all(hidePromises);
            fetchProblems();
        } catch (err: any) {
            setError('Failed to hide all problems.');
            console.error(err);
        } finally {
            setLoading(false);
            setBulkConfirm({ isOpen: false, type: null });
        }
    };

    const handleShowAll = () => {
        setBulkConfirm({ isOpen: true, type: 'show' });
    };

    const executeShowAll = async () => {
        try {
            setLoading(true);
            const showPromises = problems
                .filter(problem => !problem.is_visible && !problem.contest_id)
                .map(problem =>
                    adminService.updateProblemVisibility(problem.id, true)
                );

            await Promise.all(showPromises);
            fetchProblems();
        } catch (err: any) {
            setError('Failed to show all problems.');
            console.error(err);
        } finally {
            setLoading(false);
            setBulkConfirm({ isOpen: false, type: null });
        }
    };

    const handleEdit = async (problem: AdminProblem) => {
        try {
            setLoading(true);
            const data = await adminService.getProblemDetail(problem.id);
            setEditingProblem(data);
            setIsModalOpen(true);
        } catch (err: any) {
            setError('Failed to fetch problem details.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = () => {
        setEditingProblem(null);
        setIsModalOpen(true);
    };

    const handleToggleSelectProblem = (problemId: string | number) => {
        setSelectedProblems(prev =>
            prev.includes(problemId)
                ? prev.filter(id => id !== problemId)
                : [...prev, problemId]
        );
    };

    const handleSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.checked) {
            const allProblemIds = problems.map(p => p.id);
            setSelectedProblems(allProblemIds);
        } else {
            setSelectedProblems([]);
        }
    };

    const handleExportSelected = async () => {
        if (selectedProblems.length === 0) {
            setBatchUploadFeedback({ visible: true, message: 'Please select at least one problem to export.', type: 'warning' });
            return;
        }

        setBatchUploadFeedback({ visible: true, message: 'Initiating problem export...', type: 'info' });

        try {
            const response = await adminService.exportProblems(selectedProblems.map(id => id.toString()));

            const blob = new Blob([response.data], { type: response.headers['content-type'] });
            const downloadUrl = window.URL.createObjectURL(blob);

            const contentDisposition = response.headers['content-disposition'];
            let filename = `problems_export_${Date.now()}.zip`;
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="(.+)"/);
                if (filenameMatch && filenameMatch[1]) {
                    filename = filenameMatch[1];
                }
            }

            const link = document.createElement('a');
            link.href = downloadUrl;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(downloadUrl);

            setBatchUploadFeedback({ visible: true, message: `${selectedProblems.length} problems exported successfully!`, type: 'success' });
            setSelectedProblems([]);
        } catch (err: any) {
            const errorMsg = err.response?.data?.message || 'Failed to export problems.';
            setBatchUploadFeedback({ visible: true, message: errorMsg, type: 'error' });
            console.error('Error exporting problems:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleTriggerBatchUpload = () => {
        setBatchUploadFeedback({ visible: false, message: '', type: 'info' });
        if (batchUploadInputRef.current) {
            batchUploadInputRef.current.click();
        }
    };

    const handleBatchUploadFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setLoading(true);
        setBatchUploadFeedback({ visible: true, message: 'Initiating batch upload...', type: 'info' });
        setBatchUploadProgress({ visible: true, processed: 0, total: 0, message: 'Starting upload...', status: 'pending' });

        const formData = new FormData();
        formData.append('problemsZip', file);

        try {
            const response = await adminService.batchUploadProblems(formData);

            const { progressId } = response.data;
            if (progressId) {
                setBatchUploadFeedback({ visible: true, message: 'File uploaded. Waiting for processing to start...', type: 'info' });
                const eventSource = adminService.getBatchUploadProgressEventSource(progressId);

                eventSource.addEventListener('progress', (event: MessageEvent) => {
                    const data = JSON.parse(event.data);
                    if (data && typeof data.processed === 'number' && typeof data.total === 'number') {
                        setBatchUploadProgress({ ...data, visible: true, status: 'in_progress' });
                        setBatchUploadFeedback({ visible: true, message: 'Batch processing problems...', type: 'info' });
                    } else {
                        console.warn('Received malformed progress data (progress event):', data);
                        setBatchUploadFeedback({ visible: true, message: 'Received malformed progress update.', type: 'info' });
                    }
                });

                eventSource.addEventListener('complete', (event: MessageEvent) => {
                    const data = JSON.parse(event.data);
                    setBatchUploadProgress({ ...data, visible: false, status: 'completed' });

                    let successMessage = 'Batch upload process finished.';
                    if (data.added && data.skipped) {
                        successMessage = `Batch upload complete. Added ${data.added.length} problems, skipped ${data.skipped.length} problems.`;
                    } else if (data.message) {
                        successMessage = data.message;
                    }
                    setBatchUploadFeedback({ visible: true, message: successMessage, type: 'success' });

                    eventSource.close();
                    fetchProblems();
                    setLoading(false);
                });

                eventSource.addEventListener('error', (event: MessageEvent) => {
                    let errorMsg = 'An unknown error occurred during processing.';
                    if (event.data) {
                        try {
                            const data = JSON.parse(event.data);
                            errorMsg = data.message || errorMsg;
                        } catch (e: any) {
                            errorMsg = event.data;
                        }
                    }
                    setBatchUploadProgress({ visible: false, processed: 0, total: 0, message: errorMsg, status: 'error' });
                    setBatchUploadFeedback({ visible: true, message: errorMsg, type: 'error' });
                    eventSource.close();
                    setLoading(false);
                });
            } else {
                const { added = [], skipped = [], errors = [] } = response.data;
                let feedbackMessage = `Batch upload complete. Added: ${added.length}. Skipped: ${skipped.length}.`;
                if (errors.length > 0) {
                    const errorDetails = errors.map((e: any) => `${e.directory}: ${e.message}`).join('; ');
                    feedbackMessage += ` Errors: ${errors.length} (${errorDetails})`;
                    setBatchUploadFeedback({ visible: true, message: feedbackMessage, type: 'error' });
                } else {
                    setBatchUploadFeedback({ visible: true, message: feedbackMessage, type: 'success' });
                }
                fetchProblems();
                setLoading(false);
            }
        } catch (err: any) {
            const errorMsg = err.response?.data?.message || 'Failed to batch upload problems.';
            setBatchUploadFeedback({ visible: true, message: errorMsg, type: 'error' });
            setBatchUploadProgress({ visible: false, processed: 0, total: 0, message: errorMsg, status: 'error' });
            setLoading(false);
        } finally {
            if (batchUploadInputRef.current) {
                batchUploadInputRef.current.value = '';
            }
        }
    };

    const handleSave = async ({ problemData, pdfFile, zipFile }: { problemData: any; pdfFile?: File; zipFile?: File }) => {
        const isEditing = !!editingProblem;
        setUploadProgress({ status: 'pending', message: 'Initiating save...' });

        try {
            let problemIdForUpload = problemData.id;

            if (isEditing) {
                await adminService.updateProblem(editingProblem.id, problemData);
            } else {
                const data = await adminService.createProblem(problemData);
                problemIdForUpload = data.id;
            }

            if (pdfFile || zipFile) {
                const fileData = new FormData();
                if (pdfFile) fileData.append('problemPdf', pdfFile);
                if (zipFile) fileData.append('testcasesZip', zipFile);

                setUploadProgress({ status: 'uploading', message: 'Uploading files to server...' });

                const data = await adminService.uploadFiles(problemIdForUpload, fileData);

                const { jobId } = data as any;
                if (jobId) {
                    const pollInterval = setInterval(async () => {
                        try {
                            const progressData = await adminService.getUploadProgress(jobId);
                            setUploadProgress(progressData);

                            if (progressData.status === 'completed' || progressData.status === 'failed') {
                                clearInterval(pollInterval);
                                if (progressData.status === 'completed') {
                                    setIsModalOpen(false);
                                    fetchProblems();
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
                    fetchProblems();
                    setUploadProgress(null);
                }
            } else {
                setIsModalOpen(false);
                fetchProblems();
                setUploadProgress(null);
            }
        } catch (err: any) {
            const errorMsg = err.response?.data?.message || 'Failed to save problem.';
            setError(errorMsg);
            setUploadProgress({ status: 'failed', message: errorMsg });
            console.error(err);
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
        handleCloseModal
    };
};

export default useProblemManagement;

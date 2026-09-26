import adminService from '../../services/adminService';
import { getErrorMessage } from '../../utils/error';
import type { AdminProblemsQuery } from '../../types';

import useBatchUpload from './useBatchUpload';
import useProblemCrud from './useProblemCrud';
import { triggerZipDownload } from './useProblemExport';

/** Facade over the problem-management hooks; keeps the public API
 *  (consumed by ProblemManagement.tsx and tests) unchanged. The `query`
 *  is the server-side filter surface — filter changes reset the paged
 *  list to the first batch of the new query.
 *
 *  Bulk selection is intentionally NOT part of this facade: its
 *  source of truth is the DISPLAYED rows (the loaded page of the current
 *  server query), which only ProblemManagement.tsx knows. The page builds
 *  it directly via useProblemSelection({ displayedProblems }) so the
 *  semantics stay display-scoped under any loading scheme. */
const useProblemManagement = (query: AdminProblemsQuery) => {
  const crud = useProblemCrud({ query });
  const batchUpload = useBatchUpload({
    onCompleted: crud.fetchProblems,
    setLoading: crud.setLoading,
  });

  const handleExportSelected = async (problemIds: Array<string | number>) => {
    if (problemIds.length === 0) {
      batchUpload.setBatchUploadFeedback({
        visible: true,
        message: 'Please select at least one problem to export.',
        type: 'warning',
      });
      return;
    }

    batchUpload.setBatchUploadFeedback({ visible: true, message: 'Initiating problem export...', type: 'info' });

    try {
      const response = await adminService.exportProblems(problemIds);
      const contentType = response.headers['content-type'];
      triggerZipDownload({
        data: response.data,
        contentType: typeof contentType === 'string' ? contentType : 'application/zip',
        contentDisposition: response.headers['content-disposition'],
      });

      batchUpload.setBatchUploadFeedback({
        visible: true,
        message: `${problemIds.length} problems exported successfully!`,
        type: 'success',
      });
    } catch (errorValue) {
      const errorMsg = getErrorMessage(errorValue, 'Failed to export problems.');
      batchUpload.setBatchUploadFeedback({ visible: true, message: errorMsg, type: 'error' });
      console.error('Error exporting problems:', errorValue);
    } finally {
      crud.setLoading(false);
    }
  };

  return {
    problems: crud.problems,
    loading: crud.loading,
    error: crud.error,
    loadingMore: crud.loadingMore,
    loadMoreError: crud.loadMoreError,
    hasMore: crud.hasMore,
    authors: crud.authors,
    hasUnauthoredProblems: crud.hasUnauthoredProblems,
    loadMore: crud.loadMore,
    isModalOpen: crud.isModalOpen,
    setIsModalOpen: crud.setIsModalOpen,
    editingProblem: crud.editingProblem,
    setEditingProblem: crud.setEditingProblem,
    uploadProgress: crud.uploadProgress,
    setUploadProgress: crud.setUploadProgress,
    batchUploadFeedback: batchUpload.batchUploadFeedback,
    setBatchUploadFeedback: batchUpload.setBatchUploadFeedback,
    batchUploadProgress: batchUpload.batchUploadProgress,
    setBatchUploadProgress: batchUpload.setBatchUploadProgress,
    batchUploadInputRef: batchUpload.batchUploadInputRef,
    isConfirmModalOpen: crud.isConfirmModalOpen,
    setIsConfirmModalOpen: crud.setIsConfirmModalOpen,
    problemToDelete: crud.problemToDelete,
    setProblemToDelete: crud.setProblemToDelete,
    bulkConfirm: crud.bulkConfirm,
    setBulkConfirm: crud.setBulkConfirm,

    fetchProblems: crud.fetchProblems,
    handleDeleteClick: crud.handleDeleteClick,
    handleConfirmDelete: crud.handleConfirmDelete,
    handleToggleVisibility: crud.handleToggleVisibility,
    handleHideAll: crud.handleHideAll,
    executeHideAll: crud.executeHideAll,
    setSelectionVisibility: crud.setSelectionVisibility,
    moveSelectionToCollection: crud.moveSelectionToCollection,
    handleShowAll: crud.handleShowAll,
    executeShowAll: crud.executeShowAll,
    handleEdit: crud.handleEdit,
    handleCreate: crud.handleCreate,
    handleExportSelected,
    handleTriggerBatchUpload: batchUpload.handleTriggerBatchUpload,
    handleBatchUploadFileChange: batchUpload.handleBatchUploadFileChange,
    handleSave: crud.handleSave,
    handleCloseModal: crud.handleCloseModal,
  };
};

export type { ProblemSaveData, ProblemSavePayload } from './useProblemCrud';
export { triggerZipDownload } from './useProblemExport';

export default useProblemManagement;

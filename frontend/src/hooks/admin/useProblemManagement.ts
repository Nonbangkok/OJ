import adminService from '../../services/adminService';
import { getErrorMessage } from '../../utils/error';

import useBatchUpload from './useBatchUpload';
import useProblemCrud from './useProblemCrud';
import { triggerZipDownload } from './useProblemExport';
import useProblemSelection from './useProblemSelection';

/** Facade over the four problem-management hooks; keeps the public API
 *  (consumed by ProblemManagement.tsx and tests) unchanged. */
const useProblemManagement = () => {
  const crud = useProblemCrud();
  const selection = useProblemSelection({ problems: crud.problems });
  const batchUpload = useBatchUpload({
    onCompleted: crud.fetchProblems,
    setLoading: crud.setLoading,
  });

  const handleExportSelected = async () => {
    if (selection.selectedProblems.length === 0) {
      batchUpload.setBatchUploadFeedback({
        visible: true,
        message: 'Please select at least one problem to export.',
        type: 'warning',
      });
      return;
    }

    batchUpload.setBatchUploadFeedback({ visible: true, message: 'Initiating problem export...', type: 'info' });

    try {
      const response = await adminService.exportProblems(selection.selectedProblems);
      const contentType = response.headers['content-type'];
      triggerZipDownload({
        data: response.data,
        contentType: typeof contentType === 'string' ? contentType : 'application/zip',
        contentDisposition: response.headers['content-disposition'],
      });

      batchUpload.setBatchUploadFeedback({
        visible: true,
        message: `${selection.selectedProblems.length} problems exported successfully!`,
        type: 'success',
      });
      selection.setSelectedProblems([]);
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
    isModalOpen: crud.isModalOpen,
    setIsModalOpen: crud.setIsModalOpen,
    editingProblem: crud.editingProblem,
    setEditingProblem: crud.setEditingProblem,
    uploadProgress: crud.uploadProgress,
    setUploadProgress: crud.setUploadProgress,
    selectedProblems: selection.selectedProblems,
    setSelectedProblems: selection.setSelectedProblems,
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
    handleShowAll: crud.handleShowAll,
    executeShowAll: crud.executeShowAll,
    handleEdit: crud.handleEdit,
    handleCreate: crud.handleCreate,
    handleToggleSelectProblem: selection.handleToggleSelectProblem,
    handleSelectAll: selection.handleSelectAll,
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

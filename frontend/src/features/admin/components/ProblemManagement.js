import { useState, useEffect, useRef } from 'react';
import adminService from '../../../services/adminService';
import ProblemModal from './ProblemModal';
import ConfirmationModal from './ConfirmationModal';
import styles from './Management.module.css';
import tableStyles from '../../../components/common/Table.module.css';

const ProblemManagement = ({ currentUser }) => {
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProblem, setEditingProblem] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null); // State for upload progress
  const [selectedProblems, setSelectedProblems] = useState([]); // New state for selected problems

  // New state for batch upload feedback
  const [batchUploadFeedback, setBatchUploadFeedback] = useState({ visible: false, message: '', type: 'info' });
  const [batchUploadProgress, setBatchUploadProgress] = useState({ visible: false, processed: 0, total: 0, message: '', status: '' });

  // Ref for the hidden file input
  const batchUploadInputRef = useRef(null);

  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [problemToDelete, setProblemToDelete] = useState(null);

  // New state for bulk action confirmation
  const [bulkConfirm, setBulkConfirm] = useState({ isOpen: false, type: null });

  const fetchProblems = async () => {
    try {
      // setLoading(true);
      const data = await adminService.getProblems();
      setProblems(data);
    } catch (err) {
      setError('Failed to fetch problems.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProblems();
  }, []);

  const handleDeleteClick = (problemId) => {
    setProblemToDelete(problemId);
    setIsConfirmModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (problemToDelete) {
      try {
        await adminService.deleteProblem(problemToDelete);
        fetchProblems();
      } catch (err) {
        setError('Failed to delete problem.');
        console.error(err);
      } finally {
        setIsConfirmModalOpen(false);
        setProblemToDelete(null);
      }
    }
  };

  const handleToggleVisibility = async (problemId, currentVisibility) => {
    try {
      await adminService.updateProblemVisibility(problemId, !currentVisibility);
      fetchProblems();
    } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
      setError('Failed to show all problems.');
      console.error(err);
    } finally {
      setLoading(false);
      setBulkConfirm({ isOpen: false, type: null });
    }
  };

  const handleEdit = async (problem) => {
    try {
      setLoading(true);
      const data = await adminService.getProblemDetail(problem.id);
      setEditingProblem(data);
      setIsModalOpen(true);
    } catch (err) {
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

  const handleToggleSelectProblem = (problemId) => {
    setSelectedProblems(prev =>
      prev.includes(problemId)
        ? prev.filter(id => id !== problemId)
        : [...prev, problemId]
    );
  };

  const handleSelectAll = (event) => {
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

    // setLoading(true); // Disable buttons during export
    setBatchUploadFeedback({ visible: true, message: 'Initiating problem export...', type: 'info' });

    try {
      const response = await adminService.exportProblems(selectedProblems);

      // Create a Blob from the response data
      const blob = new Blob([response.data], { type: response.headers['content-type'] });
      const downloadUrl = window.URL.createObjectURL(blob);

      // Extract filename from Content-Disposition header
      const contentDisposition = response.headers['content-disposition'];
      let filename = `problems_export_${Date.now()}.zip`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1];
        }
      }

      // Create a link element and trigger the download
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setBatchUploadFeedback({ visible: true, message: `${selectedProblems.length} problems exported successfully!`, type: 'success' });
      setSelectedProblems([]); // Clear selection after export
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to export problems.';
      setBatchUploadFeedback({ visible: true, message: errorMsg, type: 'error' });
      console.error('Error exporting problems:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerBatchUpload = () => {
    // Reset feedback before triggering
    setBatchUploadFeedback({ visible: false, message: '', type: 'info' });
    // Trigger the hidden file input
    batchUploadInputRef.current.click();
  };

  const handleBatchUploadFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    setLoading(true); // Use main loading state to disable buttons
    setBatchUploadFeedback({ visible: true, message: 'Initiating batch upload...', type: 'info' });
    setBatchUploadProgress({ visible: true, processed: 0, total: 0, message: 'Starting upload...', status: 'pending' });

    const formData = new FormData();
    formData.append('problemsZip', file);

    try {
      const response = await adminService.batchUploadProblems(formData);

      const { progressId } = response.data;
      if (progressId) {
        // Initial feedback for file uploaded, progress listener will update more details
        setBatchUploadFeedback({ visible: true, message: 'File uploaded. Waiting for processing to start...', type: 'info' });
        const eventSource = adminService.getBatchUploadProgressEventSource(progressId);

        // eventSource.onmessage is now handled by specific event listeners
        // eventSource.onmessage = (event) => {
        //   const data = JSON.parse(event.data);
        //   setBatchUploadProgress(data);
        // };

        eventSource.addEventListener('progress', (event) => {
          const data = JSON.parse(event.data);
          if (data && typeof data.processed === 'number' && typeof data.total === 'number') {
            setBatchUploadProgress({ ...data, visible: true, status: 'in_progress' });
            setBatchUploadFeedback({ visible: true, message: 'Batch processing problems...', type: 'info' });
          } else {
            console.warn('Received malformed progress data (progress event):', data);
            setBatchUploadFeedback({ visible: true, message: 'Received malformed progress update.', type: 'info' });
          }
        });

        eventSource.addEventListener('complete', (event) => {
          const data = JSON.parse(event.data);
          setBatchUploadProgress({ ...data, visible: false, status: 'completed' });

          let successMessage = 'Batch upload process finished.';
          if (data.added && data.skipped) {
            successMessage = `Batch upload complete. Added ${data.added.length} problems, skipped ${data.skipped.length} problems.`;
          } else if (data.message) {
            successMessage = data.message; // Fallback to generic message from backend
          }
          setBatchUploadFeedback({ visible: true, message: successMessage, type: 'success' });

          eventSource.close();
          fetchProblems(); // Refresh the list after completion
          setLoading(false);
        });

        eventSource.addEventListener('error', (event) => {
          let errorMsg = 'An unknown error occurred during processing.';
          if (event.data) {
            try {
              const data = JSON.parse(event.data);
              errorMsg = data.message || errorMsg;
            } catch (e) {
              errorMsg = event.data;
            }
          }
          setBatchUploadProgress({ visible: false, processed: 0, total: 0, message: errorMsg, status: 'error' });
          setBatchUploadFeedback({ visible: true, message: errorMsg, type: 'error' });
          eventSource.close();
          setLoading(false);
        });
      } else {
        // Fallback if no progressId is returned (shouldn't happen with current backend)
        const { added = [], skipped = [], errors = [] } = response.data;
        let feedbackMessage = `Batch upload complete. Added: ${added.length}. Skipped: ${skipped.length}.`;
        if (errors.length > 0) {
          const errorDetails = errors.map(e => `${e.directory}: ${e.message}`).join('; ');
          feedbackMessage += ` Errors: ${errors.length} (${errorDetails})`;
          setBatchUploadFeedback({ visible: true, message: feedbackMessage, type: 'error' });
        } else {
          setBatchUploadFeedback({ visible: true, message: feedbackMessage, type: 'success' });
        }
        fetchProblems(); // Refresh the list
        setLoading(false);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to batch upload problems.';
      setBatchUploadFeedback({ visible: true, message: errorMsg, type: 'error' });
      setBatchUploadProgress({ visible: false, processed: 0, total: 0, message: errorMsg, status: 'error' });
      setLoading(false);
    } finally {
      // Reset the file input so the same file can be selected again
      if (batchUploadInputRef.current) {
        batchUploadInputRef.current.value = '';
      }
    }
  };

  const handleSave = async ({ problemData, pdfFile, zipFile }) => {
    const isEditing = !!editingProblem;
    // Reset progress on new save
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

        // Start polling for progress
        const { jobId } = data;
        if (jobId) {
          const pollInterval = setInterval(async () => {
            try {
              const progressData = await adminService.getUploadProgress(jobId);
              setUploadProgress(progressData);

              if (progressData.status === 'completed' || progressData.status === 'failed') {
                clearInterval(pollInterval);
                // Close modal immediately on success
                if (progressData.status === 'completed') {
                  setIsModalOpen(false);
                  fetchProblems();
                  setUploadProgress(null); // Reset progress
                }
              }
            } catch (pollError) {
              console.error('Polling error:', pollError);
              setError('Failed to get upload progress.');
              setUploadProgress({ status: 'failed', message: 'Could not retrieve processing status.' });
              clearInterval(pollInterval);
            }
          }, 1500);
        } else {
          // If no job ID, it means no zip file, so we are done
          setIsModalOpen(false);
          fetchProblems();
          setUploadProgress(null);
        }
      } else {
        // No files to upload, just close modal and refresh
        setIsModalOpen(false);
        fetchProblems();
        setUploadProgress(null);
      }
    } catch (err) {
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

  if (loading && !batchUploadProgress.visible) return <div>Loading problems...</div>;
  if (error) return <div className='error-message'>{error}</div>;

  return (
    <div className={styles['management-container']}>
      <div className={styles['management-header']}>
        <h2>Problem Management</h2>
        <div className={styles['header-actions']}>
          <div className={styles['bulk-actions']}>
            <button
              onClick={handleShowAll}
              className={styles['show-all-btn']}
              disabled={loading || problems.every(p => p.is_visible)}
              title="Show all hidden problems"
            >
              Show All
            </button>
            <button
              onClick={handleHideAll}
              className={styles['hide-all-btn']}
              disabled={loading || problems.every(p => !p.is_visible)}
              title="Hide all visible problems"
            >
              Hide All
            </button>
          </div>
          <input
            type="file"
            ref={batchUploadInputRef}
            onChange={handleBatchUploadFileChange}
            style={{ display: 'none' }}
            accept=".zip"
          />
          <button
            onClick={handleExportSelected}
            className={styles['create-btn']}
            style={{ marginRight: '10px' }}
            disabled={loading || selectedProblems.length === 0}
            title={selectedProblems.length === 0 ? 'Select problems to export' : 'Export selected problems'}
          >
            Export Selected
          </button>
          <button onClick={handleTriggerBatchUpload} className={styles['create-btn']} style={{ marginRight: '10px' }}>
            Batch Upload
          </button>
          <button onClick={handleCreate} className={styles['create-btn']}>Create New Problem</button>
        </div>
      </div>
      {/* Batch Upload Feedback UI */}
      {batchUploadFeedback.visible && (
        <div className={`${styles.feedbackBox} ${styles[batchUploadFeedback.type]}`}>
          <div className={styles.feedbackContent}>
            <p>{batchUploadFeedback.message}</p>
            {batchUploadProgress.visible && batchUploadProgress.total > 0 && batchUploadProgress.status === 'in_progress' && (
              <div className={styles.progressWrapper}>
                <div className={styles.progressInfo}>
                  <span className={styles.progressFile}>
                    Processing: {batchUploadProgress.currentProblem || '...'}
                  </span>
                  <span className={styles.progressCounters}>
                    {batchUploadProgress.processed}/{batchUploadProgress.total}
                  </span>
                </div>
                <div className={styles.progressBarContainer}>
                  <div
                    className={styles.progressBarFill}
                    style={{ width: `${(batchUploadProgress.processed / batchUploadProgress.total) * 100}%` }}
                  />
                  <span className={styles.progressPercentage}>
                    {Math.round((batchUploadProgress.processed / batchUploadProgress.total) * 100)}%
                  </span>
                </div>
              </div>
            )}
          </div>
          <button
            className={styles.closeButton}
            onClick={() => setBatchUploadFeedback({ ...batchUploadFeedback, visible: false })}
          >
            &times;
          </button>
        </div>
      )}
      <div className={tableStyles['table-container']}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  onChange={handleSelectAll}
                  checked={selectedProblems.length > 0 && selectedProblems.length === problems.length}
                  disabled={loading || problems.length === 0}
                  title="Select all problems"
                />
              </th>
              <th>ID</th>
              <th>Title</th>
              <th>Visibility</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {problems.map(problem => (
              <tr key={problem.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedProblems.includes(problem.id)}
                    onChange={() => handleToggleSelectProblem(problem.id)}
                    title="Select problem for export"
                  />
                </td>
                <td>{problem.id}</td>
                <td>{problem.title}</td>
                <td>
                  {problem.contest_id && (problem.contest_status === 'scheduled' || problem.contest_status === 'running') ? (
                    <span className={`${styles['contest-status-badge']} ${styles[problem.contest_status === 'scheduled' ? 'scheduled' : 'running']}`}>
                      {problem.contest_status === 'scheduled' ? 'In Scheduled Contest' : 'In Running Contest'}
                    </span>
                  ) : (
                    <button
                      onClick={() => handleToggleVisibility(problem.id, problem.is_visible)}
                      className={problem.is_visible ? styles['visible-btn'] : styles['hidden-btn']}
                      title={problem.is_visible ? 'Click to hide' : 'Click to show'}
                    >
                      {problem.is_visible ? 'Visible' : 'Hidden'}
                    </button>
                  )}
                </td>
                <td className={styles.actions}>
                  <button onClick={() => handleEdit(problem)} className={styles['edit-btn']}>Edit</button>
                  <button onClick={() => handleDeleteClick(problem.id)} className={styles['delete-btn']}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isModalOpen && (
        <ProblemModal
          problem={editingProblem}
          onClose={handleCloseModal}
          onSave={handleSave}
          uploadProgress={uploadProgress} // Pass progress to modal
          currentUser={currentUser}
        />
      )}
      <ConfirmationModal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Confirm Deletion"
        message={`Are you sure you want to delete problem "${problemToDelete}"? All related test cases and submissions will also be deleted.`}
      />
      <ConfirmationModal
        isOpen={bulkConfirm.isOpen}
        onClose={() => setBulkConfirm({ isOpen: false, type: null })}
        onConfirm={bulkConfirm.type === 'show' ? executeShowAll : executeHideAll}
        title={bulkConfirm.type === 'show' ? "Confirm Show All" : "Confirm Hide All"}
        message={bulkConfirm.type === 'show'
          ? "Are you sure you want to make all problems visible to users? (Excluding those in contests)"
          : "Are you sure you want to hide all problems from users? (Excluding those in contests)"}
      />
    </div>
  );
};

export default ProblemManagement; 
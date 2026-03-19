import useProblemManagement from '../../../hooks/admin/useProblemManagement';
import ProblemModal from './ProblemModal';
import ConfirmationModal from '../shared/ConfirmationModal';
import styles from '../shared/Management.module.css';
import tableStyles from '../../../components/styles/Table.module.css';
import LoadingPage from '../../../components/shared/LoadingPage';

const ProblemManagement = ({ currentUser }) => {
  const {
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
  } = useProblemManagement();

  if (loading && !batchUploadProgress.visible) return <LoadingPage />;
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
                <td>
                  <div className={styles.actions}>
                    <button onClick={() => handleEdit(problem)} className={styles['edit-btn']}>Edit</button>
                    <button onClick={() => handleDeleteClick(problem.id)} className={styles['delete-btn']}>Delete</button>
                  </div>
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
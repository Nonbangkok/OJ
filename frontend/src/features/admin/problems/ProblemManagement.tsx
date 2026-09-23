import { useEffect, useMemo, useState } from 'react';
import useProblemManagement from '../../../hooks/admin/useProblemManagement';
import useRejudge from '../../../hooks/admin/useRejudge';
import ProblemModal from './ProblemModal';
import CollectionsDialog from './CollectionsDialog';
import ConfirmationModal from '../shared/ConfirmationModal';
import RejudgeFeedbackBox from '../shared/RejudgeFeedbackBox';
import adminService from '../../../services/adminService';
import type { CollectionWithStats } from '../../../services/admin/problemsAdminService';
import styles from '../shared/Management.module.css';
import tableStyles from '../../../components/styles/Table.module.css';
import LoadingPage from '../../../components/shared/LoadingPage';
import { Button } from '../../../components/ui';

interface ProblemManagementProps {
  currentUser?: { username?: string } | null;
}

const ProblemManagement = ({ currentUser = null }: ProblemManagementProps) => {
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

  const {
    isRejudgeConfirmOpen,
    rejudgeTarget,
    rejudgeFeedback,
    handleRejudgeClick,
    handleCloseRejudgeConfirm,
    handleConfirmRejudge,
    dismissRejudgeFeedback,
  } = useRejudge();

  // Collections: list + filter + per-collection visibility actions.
  const [collections, setCollections] = useState<CollectionWithStats[]>([]);
  const [collectionFilter, setCollectionFilter] = useState<string>('all');
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [collectionConfirm, setCollectionConfirm] = useState<{ id: number; name: string; count: number; isVisible: boolean } | null>(null);

  const refreshCollections = () => {
    adminService.getCollections()
      .then(setCollections)
      .catch(() => setCollections([]));
  };
  useEffect(refreshCollections, []);

  const refreshAfterCollectionChange = () => {
    refreshCollections();
    return fetchProblems();
  };

  const visibleProblems = useMemo(() => {
    if (collectionFilter === 'all') return problems;
    if (collectionFilter === 'none') return problems.filter(problem => problem.collection_id === null);
    return problems.filter(problem => problem.collection_id === Number(collectionFilter));
  }, [problems, collectionFilter]);

  const filteredCollection = collections.find(c => c.id === Number(collectionFilter));

  const runCollectionVisibility = async () => {
    if (!collectionConfirm) return;
    try {
      await adminService.setCollectionVisibility(collectionConfirm.id, collectionConfirm.isVisible);
      setCollectionConfirm(null);
      await refreshAfterCollectionChange();
    } catch {
      setCollectionConfirm(null);
    }
  };

  if (loading && !batchUploadProgress.visible) return <LoadingPage />;
  if (error) return <div className='error-message'>{error}</div>;

  return (
    <div className={styles['management-container']}>
      <div className={styles['management-header']}>
        <h2>Problem Management</h2>
        <div className={styles['collection-controls']}>
          <label htmlFor="collection-filter">Collection</label>
          <select
            id="collection-filter"
            value={collectionFilter}
            onChange={(event) => setCollectionFilter(event.target.value)}
            aria-label="Filter problems by collection"
          >
            <option value="all">All Collections</option>
            <option value="none">No Collection</option>
            {collections.map(collection => (
              <option key={collection.id} value={collection.id}>{collection.name}</option>
            ))}
          </select>
          <Button size="compact" variant="secondary" onClick={() => setCollectionsOpen(true)}>
            Manage Collections
          </Button>
          {filteredCollection && (
            <>
              <Button
                size="compact"
                variant="neutral"
                disabled={loading || filteredCollection.problem_count === 0}
                onClick={() => setCollectionConfirm({ id: filteredCollection.id, name: filteredCollection.name, count: filteredCollection.problem_count, isVisible: true })}
                title="Set every problem in this collection to visible"
              >
                Show Collection
              </Button>
              <Button
                size="compact"
                variant="neutral"
                disabled={loading || filteredCollection.problem_count === 0}
                onClick={() => setCollectionConfirm({ id: filteredCollection.id, name: filteredCollection.name, count: filteredCollection.problem_count, isVisible: false })}
                title="Set every problem in this collection to hidden"
              >
                Hide Collection
              </Button>
            </>
          )}
        </div>
        <div className={styles['header-actions']}>
          <div className={styles['bulk-actions']}>
            <Button
              size="compact"
              variant="neutral"
              onClick={handleShowAll}
              disabled={loading || problems.every(p => p.is_visible)}
              title="Show all hidden problems"
            >
              Show All
            </Button>
            <Button
              size="compact"
              variant="neutral"
              onClick={handleHideAll}
              disabled={loading || problems.every(p => !p.is_visible)}
              title="Hide all visible problems"
            >
              Hide All
            </Button>
          </div>
          <input
            type="file"
            ref={batchUploadInputRef}
            onChange={handleBatchUploadFileChange}
            style={{ display: 'none' }}
            accept=".zip"
          />
          <Button
            onClick={handleExportSelected}
            disabled={loading || selectedProblems.length === 0}
            title={selectedProblems.length === 0 ? 'Select problems to export' : 'Export selected problems'}
          >
            Export Selected
          </Button>
          <Button onClick={handleTriggerBatchUpload}>
            Batch Upload
          </Button>
          <Button onClick={handleCreate}>Create New Problem</Button>
        </div>
      </div>
      {/* Rejudge feedback sits above the table so the outcome is visible
          without scrolling past the toolbar. */}
      <RejudgeFeedbackBox feedback={rejudgeFeedback} onDismiss={dismissRejudgeFeedback} />
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
                  checked={selectedProblems.length > 0 && selectedProblems.length === visibleProblems.length}
                  disabled={loading || problems.length === 0}
                  title="Select all problems"
                />
              </th>
              <th>ID</th>
              <th>Title</th>
              <th>Collection</th>
              <th>Visibility</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleProblems.map(problem => (
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
                  {problem.collection_id !== null
                    ? problem.collection_name
                    : <span className={styles['no-collection']}>No Collection</span>}
                </td>
                <td>
                  {problem.contest_id && (problem.contest_status === 'scheduled' || problem.contest_status === 'running') ? (
                    <span className={`${styles['contest-status-badge']} ${styles[problem.contest_status === 'scheduled' ? 'scheduled' : 'running']}`}>
                      {problem.contest_status === 'scheduled' ? 'In Scheduled Contest' : 'In Running Contest'}
                    </span>
                  ) : (
                    <Button
                      size="compact"
                      variant={problem.is_visible ? 'secondary' : 'neutral'}
                      onClick={() => handleToggleVisibility(problem.id, problem.is_visible)}
                      title={problem.is_visible ? 'Click to hide' : 'Click to show'}
                    >
                      {problem.is_visible ? 'Visible' : 'Hidden'}
                    </Button>
                  )}
                </td>
                <td>
                  <div className={styles.actions}>
                    <Button size="compact" onClick={() => handleEdit(problem)}>Edit</Button>
                    <Button
                      size="compact"
                      onClick={() => handleRejudgeClick({ kind: 'problem', id: problem.id, title: problem.title })}
                      title="Re-run every submission for this problem against the current testcases and limits"
                    >
                      Rejudge
                    </Button>
                    <Button size="compact" variant="destructive" onClick={() => handleDeleteClick(problem.id)}>Delete</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CollectionsDialog
        open={collectionsOpen}
        onClose={() => setCollectionsOpen(false)}
        onChanged={refreshAfterCollectionChange}
        collections={collections}
      />
      {collectionConfirm && (
        <ConfirmationModal
          isOpen
          onClose={() => setCollectionConfirm(null)}
          onConfirm={runCollectionVisibility}
          title={collectionConfirm.isVisible ? 'Confirm Show Collection' : 'Confirm Hide Collection'}
          message={`Are you sure you want to ${collectionConfirm.isVisible ? 'show' : 'hide'} all ${collectionConfirm.count} problem${collectionConfirm.count === 1 ? '' : 's'} in "${collectionConfirm.name}"?`}
        />
      )}
      {isModalOpen && (
        <ProblemModal
          collections={collections}
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
      <ConfirmationModal
        isOpen={isRejudgeConfirmOpen}
        onClose={handleCloseRejudgeConfirm}
        onConfirm={handleConfirmRejudge}
        title="Confirm Rejudge"
        message={rejudgeTarget
          ? `Rejudge re-runs every submission for problem "${rejudgeTarget.title}" against the current testcases and limits. Scores may change.`
          : ''}
        confirmText="Rejudge"
        confirmStyle="default"
      />
    </div>
  );
};

export default ProblemManagement; 

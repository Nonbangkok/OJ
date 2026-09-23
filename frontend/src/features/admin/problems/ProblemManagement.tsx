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
import { ActionMenu, Button, StatusBadge } from '../../../components/ui';

interface ProblemManagementProps {
  currentUser?: { username?: string } | null;
}

const COLLECTION_STATUS_LABEL: Record<CollectionWithStats['status'], string> = {
  empty: 'Empty',
  all_visible: 'All Visible',
  all_hidden: 'All Hidden',
  mixed: 'Mixed',
};

const ProblemManagement = ({ currentUser = null }: ProblemManagementProps) => {
  const {
    problems,
    loading,
    error,
    isModalOpen,
    editingProblem,
    uploadProgress,
    selectedProblems,
    setSelectedProblems,
    batchUploadFeedback,
    setBatchUploadFeedback,
    batchUploadProgress,
    batchUploadInputRef,
    isConfirmModalOpen,
    setIsConfirmModalOpen,
    problemToDelete,
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
    setSelectionVisibility,
    moveSelectionToCollection,
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

  // --- Filters ------------------------------------------------------------
  const [search, setSearch] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'visible' | 'hidden'>('all');

  // --- Collections --------------------------------------------------------
  const [collections, setCollections] = useState<CollectionWithStats[]>([]);
  const [collectionFilter, setCollectionFilter] = useState<string>('all');
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [collectionConfirm, setCollectionConfirm] = useState<{ id: number; name: string; count: number; isVisible: boolean } | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<{ collectionId: number | null; name: string } | null>(null);

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

  // Filters compose: search (ID/title) x collection x visibility.
  const visibleProblems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return problems.filter(problem => {
      if (collectionFilter === 'none' && problem.collection_id !== null) return false;
      if (collectionFilter !== 'all' && collectionFilter !== 'none' && problem.collection_id !== Number(collectionFilter)) return false;
      if (visibilityFilter === 'visible' && !problem.is_visible) return false;
      if (visibilityFilter === 'hidden' && problem.is_visible) return false;
      if (!query) return true;
      return problem.id.toLowerCase().includes(query) || problem.title.toLowerCase().includes(query);
    });
  }, [problems, collectionFilter, visibilityFilter, search]);

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

  const runMoveSelection = async () => {
    if (!moveConfirm) return;
    try {
      await moveSelectionToCollection(selectedProblems, moveConfirm.collectionId);
      setSelectedProblems([]);
    } finally {
      setMoveConfirm(null);
    }
  };

  if (loading && !batchUploadProgress.visible) return <LoadingPage />;
  if (error) return <div className='error-message'>{error}</div>;

  const hasSelection = selectedProblems.length > 0;

  return (
    <div className={styles['management-container']}>
      {/* --- 1. Page header: creation/import only -------------------------- */}
      <div className={styles['management-header']}>
        <h2>Problem Management</h2>
        <div className={styles['header-actions']}>
          <input
            type="file"
            ref={batchUploadInputRef}
            onChange={handleBatchUploadFileChange}
            style={{ display: 'none' }}
            accept=".zip"
          />
          <Button variant="secondary" onClick={handleTriggerBatchUpload}>Batch Upload</Button>
          <Button onClick={handleCreate}>+ New Problem</Button>
        </div>
      </div>

      {/* --- 2. Filter / scope bar ----------------------------------------- */}
      <div className={styles['filter-bar']}>
        <input
          type="search"
          className={styles['filter-search']}
          placeholder="Search by ID or title…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search problems"
        />
        <label className={styles['filter-control']}>
          <span className={styles['filter-label']}>Collection</span>
          <select
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
        </label>
        <label className={styles['filter-control']}>
          <span className={styles['filter-label']}>Visibility</span>
          <select
            value={visibilityFilter}
            onChange={(event) => setVisibilityFilter(event.target.value as 'all' | 'visible' | 'hidden')}
            aria-label="Filter problems by visibility"
          >
            <option value="all">All</option>
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
        {/* Global, low-frequency actions live behind one quiet menu. */}
        <ActionMenu
          label="More global actions"
          trigger="text"
          items={[
            { key: 'manage-collections', label: 'Manage Collections', onClick: () => setCollectionsOpen(true) },
            { key: 'show-all', label: 'Show all problems', onClick: handleShowAll, disabled: loading || problems.every(p => p.is_visible), title: 'Set every problem in the system to visible' },
            { key: 'hide-all', label: 'Hide all problems', onClick: handleHideAll, disabled: loading || problems.every(p => !p.is_visible), title: 'Set every problem in the system to hidden' },
          ]}
        />
      </div>

      {/* --- 3a. Collection context (only with a specific collection) ----- */}
      {filteredCollection && (
        <div className={styles['scope-bar']}>
          <span className={styles['scope-info']}>
            <strong>{filteredCollection.name}</strong>
            {' · '}{filteredCollection.problem_count} problem{filteredCollection.problem_count === 1 ? '' : 's'}
            {' · '}{COLLECTION_STATUS_LABEL[filteredCollection.status]}
          </span>
          <div className={styles['scope-actions']}>
            <Button
              size="compact"
              disabled={loading || filteredCollection.problem_count === 0}
              onClick={() => setCollectionConfirm({ id: filteredCollection.id, name: filteredCollection.name, count: filteredCollection.problem_count, isVisible: true })}
            >
              Show Collection
            </Button>
            <Button
              size="compact"
              variant="secondary"
              disabled={loading || filteredCollection.problem_count === 0}
              onClick={() => setCollectionConfirm({ id: filteredCollection.id, name: filteredCollection.name, count: filteredCollection.problem_count, isVisible: false })}
            >
              Hide Collection
            </Button>
          </div>
        </div>
      )}

      {/* --- 3b. Selection bar (only with a selection) -------------------- */}
      {hasSelection && (
        <div className={styles['selection-bar']} role="status">
          <span className={styles['selection-count']}>
            {selectedProblems.length} selected
          </span>
          <div className={styles['selection-actions']}>
            <Button size="compact" onClick={handleExportSelected} disabled={loading}>Export</Button>
            <Button size="compact" onClick={() => setSelectionVisibility(selectedProblems, true)} disabled={loading}>Show</Button>
            <Button size="compact" variant="secondary" onClick={() => setSelectionVisibility(selectedProblems, false)} disabled={loading}>Hide</Button>
            <label className={styles['selection-move']}>
              <span className={styles['filter-label']}>Move to Collection</span>
              <select
                value=""
                disabled={loading}
                aria-label="Move selected problems to a collection"
                onChange={(event) => {
                  const { value } = event.target;
                  if (value === '') return;
                  const collection = collections.find(c => c.id === Number(value));
                  setMoveConfirm({ collectionId: value === 'none' ? null : Number(value), name: collection?.name ?? 'No Collection' });
                }}
              >
                <option value="">Choose…</option>
                <option value="none">No Collection</option>
                {collections.map(collection => (
                  <option key={collection.id} value={collection.id}>{collection.name}</option>
                ))}
              </select>
            </label>
            <Button size="compact" variant="secondary" onClick={() => handleRejudgeClick({ kind: 'problem', id: String(selectedProblems[0]), title: `the ${selectedProblems.length} selected problems` })} disabled={loading}>
              Rejudge
            </Button>
            <Button size="compact" variant="neutral" onClick={() => setSelectedProblems([])}>Clear</Button>
          </div>
        </div>
      )}

      <RejudgeFeedbackBox feedback={rejudgeFeedback} onDismiss={dismissRejudgeFeedback} />
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

      {/* --- 4. Table: minimal row actions -------------------------------- */}
      <div className={`${tableStyles['table-container']} ${styles.tableWrap}`}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th className={styles['col-checkbox']}>
                <input
                  type="checkbox"
                  onChange={handleSelectAll}
                  checked={selectedProblems.length > 0 && selectedProblems.length === visibleProblems.length}
                  disabled={loading || visibleProblems.length === 0}
                  title="Select all visible problems"
                  aria-label="Select all visible problems"
                />
              </th>
              <th className={styles['col-left']}>ID</th>
              <th className={styles['col-left']}>Title</th>
              <th className={styles['col-left']}>Collection</th>
              <th className={styles['col-center']}>Visibility</th>
              <th className={styles['col-center']}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleProblems.map(problem => (
              <tr key={problem.id}>
                <td className={styles['col-checkbox']}>
                  <input
                    type="checkbox"
                    checked={selectedProblems.includes(problem.id)}
                    onChange={() => handleToggleSelectProblem(problem.id)}
                    aria-label={`Select problem ${problem.id}`}
                  />
                </td>
                <td className={styles['col-left']}>{problem.id}</td>
                <td className={styles['col-left']}>{problem.title}</td>
                <td className={styles['col-left']}>
                  {problem.collection_id !== null
                    ? <span title={problem.collection_name ?? undefined}>{problem.collection_name}</span>
                    : <span className={styles['no-collection']}>No Collection</span>}
                </td>
                <td className={styles['col-center']}>
                  {problem.contest_id && (problem.contest_status === 'scheduled' || problem.contest_status === 'running') ? (
                    <span className={`${styles['contest-status-badge']} ${styles[problem.contest_status === 'scheduled' ? 'scheduled' : 'running']}`}>
                      {problem.contest_status === 'scheduled' ? 'In Scheduled Contest' : 'In Running Contest'}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`${styles['visibility-badge']} ${problem.is_visible ? styles['visibility-visible'] : styles['visibility-hidden']}`}
                      onClick={() => handleToggleVisibility(problem.id, problem.is_visible)}
                      title={problem.is_visible ? 'Visible — click to hide' : 'Hidden — click to show'}
                    >
                      {problem.is_visible ? 'Visible' : 'Hidden'}
                    </button>
                  )}
                </td>
                <td className={styles['col-center']}>
                  <div className={styles['row-actions']}>
                    <Button size="compact" variant="secondary" onClick={() => handleEdit(problem)}>Edit</Button>
                    <ActionMenu
                      label={`Row actions for ${problem.id}`}
                      items={[
                        {
                          key: 'rejudge',
                          label: 'Rejudge',
                          title: 'Re-run every submission for this problem against the current testcases and limits',
                          onClick: () => handleRejudgeClick({ kind: 'problem', id: problem.id, title: problem.title }),
                        },
                        {
                          key: 'toggle-visibility',
                          label: problem.is_visible ? 'Hide Problem' : 'Show Problem',
                          onClick: () => handleToggleVisibility(problem.id, problem.is_visible),
                        },
                        {
                          key: 'delete',
                          label: 'Delete',
                          variant: 'danger',
                          onClick: () => handleDeleteClick(problem.id),
                        },
                      ]}
                    />
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
      {moveConfirm && (
        <ConfirmationModal
          isOpen
          onClose={() => setMoveConfirm(null)}
          onConfirm={runMoveSelection}
          title="Confirm Move to Collection"
          message={`Move ${selectedProblems.length} selected problem${selectedProblems.length === 1 ? '' : 's'} to "${moveConfirm.name}"? Each problem keeps at most one collection.`}
        />
      )}
      {isModalOpen && (
        <ProblemModal
          collections={collections}
          problem={editingProblem}
          onClose={handleCloseModal}
          onSave={handleSave}
          uploadProgress={uploadProgress}
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
          ? "Are you sure you want to make all problems in the system visible? (Excluding those in contests)"
          : "Are you sure you want to hide all problems in the system? (Excluding those in contests)"}
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

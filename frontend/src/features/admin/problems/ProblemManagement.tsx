import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import useProblemManagement from '../../../hooks/admin/useProblemManagement';
import useProblemSelection from '../../../hooks/admin/useProblemSelection';
import useRejudge from '../../../hooks/admin/useRejudge';
import CreateProblemDialog from './CreateProblemDialog';
import CollectionsDialog from './CollectionsDialog';
import ConfirmationModal from '../shared/ConfirmationModal';
import RejudgeFeedbackBox from '../shared/RejudgeFeedbackBox';
import adminService from '../../../services/adminService';
import type { CollectionWithStats } from '../../../services/admin/problemsAdminService';
import type { AdminProblemsQuery } from '../../../types';
import { ADMIN_PROBLEMS_PAGE } from '../../../config/constants';
import styles from '../shared/Management.module.css';
import tableStyles from '../../../components/styles/Table.module.css';
import { DifficultyBadge, ActionMenu, Button, FilterBar, SegmentedControl, StatusBadge, StatusDot, PageHeader, type FilterChip } from '../../../components/ui';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { DIFFICULTY_BANDS } from '../../../config/constants';
import { PROBLEM_CATEGORIES } from '../../../utils/constants';
import type { AdminProblem, AdminProblemSort, AdminProblemView } from '../../../types';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useInfiniteScroll } from '../../../hooks/useInfiniteScroll';
import { buildAdminProblemListQuery, type AdminProblemListLoaderData } from '../../../routing/problemListLoaders';

interface ProblemManagementProps {
  currentUser?: { username?: string; role?: string } | null;
  initialPageSpan?: AdminProblemListLoaderData;
}

const COLLECTION_STATUS_LABEL: Record<CollectionWithStats['status'], string> = {
  empty: 'Empty',
  all_visible: 'All Visible',
  all_hidden: 'All Hidden',
  mixed: 'Mixed',
};

type ViewKey = 'all' | AdminProblemView;
const VIEW_TABS: Array<{ value: ViewKey; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'in_contest', label: 'In contest' },
  { value: 'header', label: 'Header' },
];
const SORTABLE: Array<{ key: AdminProblemSort; label: string; align: 'left' | 'right' }> = [
  { key: 'id', label: 'ID', align: 'left' },
  { key: 'title', label: 'Title', align: 'left' },
  { key: 'difficulty', label: 'Difficulty', align: 'right' },
  { key: 'tests', label: 'Tests', align: 'right' },
];

/** What keeps students from being judged on this problem; empty when it is ready. */
export const healthIssues = (problem: AdminProblem): string[] => [
  ...(problem.has_pdf === false ? ['No PDF'] : []),
  ...(problem.testcase_count === 0 ? ['No tests'] : []),
  ...(problem.problem_type === 'header' && problem.has_grader === false ? ['No grader'] : []),
];

const ProblemManagement = ({ currentUser = null, initialPageSpan = null }: ProblemManagementProps) => {
  const navigate = useNavigate();
  // Rejudge is admin-only on the server (POST /admin/rejudge/problem/:id).
  const isAdmin = currentUser?.role === 'admin';
  const [createOpen, setCreateOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSearch = searchParams.get('search') || '';
  // Every filter but the search box lives in the URL (shareable, and Back
  // restores it); the search box keeps its own text and is debounced.
  const collectionFilter = searchParams.get('collection') || 'all';
  const urlVisibility = searchParams.get('visibility');
  const visibilityFilter = urlVisibility === 'visible' || urlVisibility === 'hidden' ? urlVisibility : 'all';
  const authorFilter = searchParams.get('author') || 'all';
  const viewParam = searchParams.get('view') || '';
  const view: ViewKey = (VIEW_TABS.some((t) => t.value === viewParam) ? viewParam : 'all') as ViewKey;
  const difficultyFilter = searchParams.get('difficulty') || '';
  const categoryFilter = searchParams.get('category') || '';
  const typeFilter = searchParams.get('type') || '';
  const sortParam = searchParams.get('sort') || '';
  const orderParam = searchParams.get('order') === 'desc' ? 'desc' : 'asc';

  const [search, setSearch] = useState(urlSearch);
  const debouncedSearch = useDebouncedValue(search, ADMIN_PROBLEMS_PAGE.SEARCH_DEBOUNCE_MS);
  // Mirror an externally changed URL (Back/Forward) into the search box,
  // adjusted during render so the box never shows a stale value.
  const [syncedUrlSearch, setSyncedUrlSearch] = useState(urlSearch);
  if (syncedUrlSearch !== urlSearch) {
    setSyncedUrlSearch(urlSearch);
    setSearch(urlSearch);
  }

  const updateUrlFilter = (key: string, value: string) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      // 'all' is the "no filter" sentinel of the chips; the free-text
      // search has no sentinel, so a search for the word "all" is kept.
      const isDefault = !value || (key !== 'search' && value === 'all');
      if (isDefault) next.delete(key);
      else next.set(key, value);
      next.delete('pages');
      return next;
    }, { replace: true, preventScrollReset: true });
  };

  // Server-side query. Sentinels 'all' are omitted so the default query is
  // the clean unfiltered first page.
  const query = useMemo<AdminProblemsQuery>(() => {
    return buildAdminProblemListQuery({
      search: debouncedSearch,
      collection: collectionFilter,
      visibility: visibilityFilter,
      author: authorFilter,
      view,
      difficulty: difficultyFilter,
      category: categoryFilter,
      type: typeFilter,
      sort: sortParam,
      order: orderParam,
    });
  }, [debouncedSearch, collectionFilter, visibilityFilter, authorFilter, view, difficultyFilter, categoryFilter, typeFilter, sortParam, orderParam]);

  const {
    problems,
    loading,
    error,
    loadingMore,
    loadMoreError,
    loadingAll,
    loadAllError,
    hasMore,
    authors,
    hasUnauthoredProblems,
    bulkEligibleCount,
    total,
    viewCounts,
    loadedQueryKey,
    loadMore,
    loadAll,
    isModalOpen,
    editingProblem,
    uploadProgress,
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
    deleteSelectedProblems,
    handleToggleVisibility,
    handleHideAll,
    executeHideAll,
    handleShowAll,
    executeShowAll,
    setSelectionVisibility,
    moveSelectionToCollection,
    handleEdit,
    handleCreate,
    handleExportSelected,
    handleTriggerBatchUpload,
    handleBatchUploadFileChange,
    handleSave,
    handleCloseModal
  } = useProblemManagement(query, initialPageSpan);
  const currentQueryKey = JSON.stringify(query);
  // The visible input updates immediately, but the server query is debounced.
  // Keep scope-wide actions unavailable until the result/count are for exactly
  // the query represented by the current controls.
  const bulkScopeReady = !loading
    && !error
    && search.trim() === debouncedSearch.trim()
    && loadedQueryKey === currentQueryKey;

  useEffect(() => {
    if (!bulkScopeReady) return;
    const loadedPages = Math.max(1, Math.ceil(problems.length / ADMIN_PROBLEMS_PAGE.PAGE_SIZE));
    const desiredPageParam = loadedPages > 1 ? String(loadedPages) : null;
    if (desiredPageParam === searchParams.get('pages') || (desiredPageParam === null && !searchParams.has('pages'))) return;
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      const nextValue = loadedPages > 1 ? String(loadedPages) : null;
      if (nextValue === next.get('pages') || (nextValue === null && !next.has('pages'))) return previous;
      if (nextValue) next.set('pages', nextValue);
      else next.delete('pages');
      return next;
    }, { replace: true, preventScrollReset: true });
  }, [bulkScopeReady, problems.length, searchParams, setSearchParams]);

  const {
    isRejudgeConfirmOpen,
    rejudgeTarget,
    rejudgeFeedback,
    handleRejudgeClick,
    handleCloseRejudgeConfirm,
    handleConfirmRejudge,
    dismissRejudgeFeedback,
  } = useRejudge();

  // Author options come from the server with every page (a distinct-names
  // aggregate over the WHOLE pool, independent of the loaded batch). Rows
  // with a NULL/empty author group under a "No author" option when present.
  const NO_AUTHOR = 'none';
  const authorOptions = useMemo(
    () => (hasUnauthoredProblems ? [...authors.map(a => a.name), NO_AUTHOR] : authors.map(a => a.name)),
    [authors, hasUnauthoredProblems],
  );
  const authorLabel = (value: string) => (value === NO_AUTHOR ? 'No author' : value);
  // If the selected author disappears from the pool (e.g. its only problem
  // was deleted), reset to 'all' — the query recomputes and refetches, so
  // the control never shows (or queries by) a phantom selection. Skipped
  // while the options list is still empty (first page in flight). Adjusted
  // during render; the guard is false after the reset, so it runs once.
  const phantomAuthor = authorFilter !== 'all' && authorOptions.length > 0 && !authorOptions.includes(authorFilter);
  useEffect(() => {
    if (phantomAuthor) updateUrlFilter('author', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the selected author leaves the pool
  }, [phantomAuthor]);
  // Display uses the sanitized value so the chip never shows a phantom selection.
  const displayAuthorFilter = phantomAuthor ? 'all' : authorFilter;

  // --- Collections --------------------------------------------------------
  const [collections, setCollections] = useState<CollectionWithStats[]>([]);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [collectionConfirm, setCollectionConfirm] = useState<{ id: number; name: string; count: number; isVisible: boolean } | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<{ collectionId: number | null; name: string } | null>(null);
  const [deleteSelectionConfirm, setDeleteSelectionConfirm] = useState(false);

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

  // The table renders exactly the server-paged rows (filters already ran
  // in SQL, before pagination).
  const visibleProblems = problems;
  const showMoreRef = useInfiniteScroll({
    enabled: hasMore && !loading && !loadingMore && !loadMoreError && !loadingAll
      && !loadAllError && bulkScopeReady,
    observationKey: visibleProblems.length,
    onLoadMore: loadMore,
  });

  const filteredCollection = collections.find(c => c.id === Number(collectionFilter));

  // --- Bulk selection ------------------------------------------------------
  // `visibleProblems` (rows the table displays, after every filter) is the
  // single source of truth for selection — not the full fetched list. The
  // header checkbox, Shift+click ranges, and drag gestures all operate on
  // it, so this wires into Show More incremental loading unchanged (newly
  // loaded rows simply start unselected).
  const {
    selectedProblemIds,
    selectedCount,
    hasSelection,
    isProblemSelected,
    headerChecked,
    headerIndeterminate,
    bindHeaderCheckboxRef,
    handleToggleSelectProblem,
    handleSelectAll,
    clearSelection,
    isDragging,
    isRowVisited,
    handleDragOverRow,
    handleSelectionZonePointerDown,
  } = useProblemSelection({ displayedProblems: visibleProblems });

  // Changing any filter clears the selection: a stale selection of rows the
  // user can no longer see (e.g. after clearing a search) is more dangerous
  // than useful. Debounce-free — filters are already user-paced.
  const changeSearch = (value: string) => {
    clearSelection();
    setSearch(value);
    updateUrlFilter('search', value);
  };
  /** Every URL-held filter: changing one clears the selection. */
  const changeFilter = (key: string, value: string) => {
    clearSelection();
    updateUrlFilter(key, value);
  };
  const changeSort = (key: AdminProblemSort) => {
    clearSelection();
    const current = sortParam || 'id';
    const nextOrder = current === key && orderParam === 'asc' ? 'desc' : 'asc';
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      if (key === 'id' && nextOrder === 'asc') { next.delete('sort'); next.delete('order'); }
      else { next.set('sort', key); next.set('order', nextOrder); }
      next.delete('pages');
      return next;
    }, { replace: true, preventScrollReset: true });
  };
  const sortState = (key: AdminProblemSort): 'ascending' | 'descending' | undefined => {
    const current = sortParam || 'id';
    if (current !== key) return undefined;
    return orderParam === 'desc' ? 'descending' : 'ascending';
  };

  const filterChips: FilterChip[] = [
    {
      key: 'collection',
      label: 'Collection',
      value: collectionFilter === 'all' ? undefined : collectionFilter,
      options: [{ value: 'none', label: 'No collection' }, ...collections.map((c) => ({ value: String(c.id), label: c.name }))],
      onChange: (value) => changeFilter('collection', value ?? ''),
    },
    {
      key: 'author',
      label: 'Author',
      value: displayAuthorFilter === 'all' ? undefined : displayAuthorFilter,
      options: authorOptions.map((author) => ({ value: author, label: authorLabel(author) })),
      onChange: (value) => changeFilter('author', value ?? ''),
    },
    {
      key: 'difficulty',
      label: 'Difficulty',
      value: difficultyFilter || undefined,
      options: DIFFICULTY_BANDS.map(({ value, label }) => ({ value, label })),
      onChange: (value) => changeFilter('difficulty', value ?? ''),
    },
    {
      key: 'category',
      label: 'Category',
      multiple: true,
      values: categoryFilter ? categoryFilter.split(',') : [],
      options: [...PROBLEM_CATEGORIES.map((name) => ({ value: name, label: name })), { value: 'Uncategorized', label: 'Uncategorized' }],
      onChange: (values) => changeFilter('category', values.join(',')),
    },
    {
      key: 'type',
      label: 'Type',
      value: typeFilter || undefined,
      options: [{ value: 'standard', label: 'Standard' }, { value: 'header', label: 'Header' }],
      onChange: (value) => changeFilter('type', value ?? ''),
    },
    {
      // Old links may carry ?visibility=; the Hidden tab is the usual way in.
      key: 'visibility',
      label: 'Visibility',
      value: visibilityFilter === 'all' ? undefined : visibilityFilter,
      options: [{ value: 'visible', label: 'Visible' }, { value: 'hidden', label: 'Hidden' }],
      onChange: (value) => changeFilter('visibility', value ?? ''),
    },
  ];
  const countLabel = total !== null
    ? `${total} ${total === 1 ? 'problem' : 'problems'}`
    : `${visibleProblems.length}${hasMore ? '+' : ''} problems`;

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
      await moveSelectionToCollection(selectedProblemIds, moveConfirm.collectionId);
      clearSelection();
    } finally {
      setMoveConfirm(null);
    }
  };

  const runDeleteSelection = async () => {
    const succeeded = await deleteSelectedProblems(selectedProblemIds);
    if (succeeded) clearSelection();
    setDeleteSelectionConfirm(false);
  };

  const confirmBulkVisibility = async () => {
    if (!bulkScopeReady || !bulkConfirm.type) return;
    const succeeded = bulkConfirm.type === 'show'
      ? await executeShowAll()
      : await executeHideAll();
    if (succeeded) clearSelection();
  };

  return (
    <div className={styles['management-container']}>
      {/* --- 1. Page header: creation/import only -------------------------- */}
      <input
        type="file"
        ref={batchUploadInputRef}
        onChange={handleBatchUploadFileChange}
        style={{ display: 'none' }}
        accept=".zip"
      />
      <PageHeader
        breadcrumb={[{ label: 'Manage' }]}
        title="Problems"
        meta={viewCounts ? `${viewCounts.all} problems · ${viewCounts.attention} need attention` : undefined}
        actions={(
          <>
            <Button variant="secondary" onClick={handleTriggerBatchUpload}>Import ZIP</Button>
            <ActionMenu
              label="More problem actions"
              items={[
                { key: 'manage-collections', label: 'Manage collections', onClick: () => setCollectionsOpen(true) },
                { key: 'show-all', label: `Show all ${bulkEligibleCount} matching`, onClick: handleShowAll, disabled: !bulkScopeReady || bulkEligibleCount === 0, title: `Set all ${bulkEligibleCount} matching eligible problems to visible` },
                { key: 'hide-all', label: `Hide all ${bulkEligibleCount} matching`, onClick: handleHideAll, disabled: !bulkScopeReady || bulkEligibleCount === 0, title: `Set all ${bulkEligibleCount} matching eligible problems to hidden` },
              ]}
            />
            <Button onClick={() => setCreateOpen(true)}>New problem</Button>
          </>
        )}
      />

      {/* --- 2. Views + filters --------------------------------------------- */}
      <SegmentedControl<ViewKey>
        aria-label="Problem view"
        className={styles['view-tabs']}
        value={view}
        options={VIEW_TABS.map((tab) => ({ value: tab.value, label: viewCounts ? `${tab.label} ${viewCounts[tab.value]}` : tab.label }))}
        onChange={(next) => changeFilter('view', next === 'all' ? '' : next)}
      />
      <FilterBar
        search={{ value: search, onChange: changeSearch, placeholder: 'Search problems' }}
        filters={filterChips}
        resultCount={<span aria-live="polite">{countLabel}</span>}
      />

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

      {/* --- 3b. Selection bar (after the pointer gesture ends) ----------- */}
      {hasSelection && !isDragging && (
        <div className={styles['selection-bar']} role="status" style={{ position: 'fixed' }}>
          <span className={styles['selection-count']}>
            {selectedCount} selected
          </span>
          <div className={styles['selection-actions']}>
            <Button size="compact" onClick={() => handleExportSelected(selectedProblemIds)} disabled={loading}>Export Selected ({selectedCount})</Button>
            <Button size="compact" onClick={() => setSelectionVisibility(selectedProblemIds, true)} disabled={loading}>Show</Button>
            <Button size="compact" variant="secondary" onClick={() => setSelectionVisibility(selectedProblemIds, false)} disabled={loading}>Hide</Button>
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
            {isAdmin && (
              <Button size="compact" variant="secondary" onClick={() => handleRejudgeClick({ kind: 'problems', ids: selectedProblemIds, title: `the ${selectedCount} selected problems` })} disabled={loading}>
                Rejudge
              </Button>
            )}
            <Button size="compact" variant="destructive" onClick={() => setDeleteSelectionConfirm(true)} disabled={loading}>
              Delete ({selectedCount})
            </Button>
            <Button size="compact" variant="neutral" onClick={clearSelection}>Clear</Button>
          </div>
        </div>
      )}

      <RejudgeFeedbackBox feedback={rejudgeFeedback} onDismiss={dismissRejudgeFeedback} />
      {batchUploadFeedback.visible && (
        <div className={`${styles.feedbackBox} ${styles.batchUploadFeedback} ${styles[batchUploadFeedback.type]}`}>
          <div className={styles.feedbackContent}>
            <p>{batchUploadFeedback.message}</p>
            {batchUploadProgress.visible && batchUploadProgress.total > 0
              && (batchUploadProgress.status === 'pending' || batchUploadProgress.status === 'in_progress') && (
              <div className={styles.progressWrapper}>
                <div className={styles.progressInfo}>
                  <span className={styles.progressFile}>
                    {batchUploadProgress.status === 'pending'
                      ? 'Uploading parts'
                      : `Processing: ${batchUploadProgress.currentProblem || '...'}`}
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

      {(loading || error) && !batchUploadProgress.visible && (
        <div className={styles['scope-bar']}>
          {loading && <span role="status">Loading Problems...</span>}
          {error && <span className="error-message" role="alert">{error}</span>}
        </div>
      )}

      {/* --- 4. Table: minimal row actions -------------------------------- */}
      <div className={`${tableStyles['table-container']} ${styles.tableWrap}`}>
        <table className={`${tableStyles.table} ${styles['problems-table']}`}>
          <thead>
            <tr>
              <th className={styles['col-checkbox']}>
                <input
                  type="checkbox"
                  ref={bindHeaderCheckboxRef}
                  onChange={(event) => handleSelectAll(event.target.checked)}
                  checked={headerChecked}
                  disabled={loading || visibleProblems.length === 0}
                  title="Select all currently displayed problems"
                  aria-label="Select all currently displayed problems"
                />
              </th>
              {SORTABLE.slice(0, 3).map(({ key, label, align }) => (
                <th key={key} className={styles[`col-${align}`]} aria-sort={sortState(key)}>
                  <button type="button" className={styles['sort-button']} onClick={() => changeSort(key)}>
                    {label}
                    {sortState(key) === 'ascending' && <CaretUp size={11} weight="bold" aria-hidden="true" />}
                    {sortState(key) === 'descending' && <CaretDown size={11} weight="bold" aria-hidden="true" />}
                  </button>
                </th>
              ))}
              <th className={styles['col-left']}>Health</th>
              {SORTABLE.slice(3).map(({ key, label, align }) => (
                <th key={key} className={styles[`col-${align}`]} aria-sort={sortState(key)}>
                  <button type="button" className={styles['sort-button']} onClick={() => changeSort(key)}>
                    {label}
                    {sortState(key) === 'ascending' && <CaretUp size={11} weight="bold" aria-hidden="true" />}
                    {sortState(key) === 'descending' && <CaretDown size={11} weight="bold" aria-hidden="true" />}
                  </button>
                </th>
              ))}
              <th className={styles['col-left']}>Visibility</th>
              <th className={styles['col-center']}><span className={styles['sr-only']}>Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visibleProblems.length === 0 && !loading && !error && (
              <tr><td colSpan={8}>No problems match the current filters.</td></tr>
            )}
            {visibleProblems.map(problem => {
              const selected = isProblemSelected(problem.id);
              const visited = isDragging && isRowVisited(problem.id);
              const rowClasses = [
                selected ? styles['row-selected'] : '',
                visited ? styles['row-drag-active'] : '',
              ].filter(Boolean).join(' ');
              return (
              <tr
                key={problem.id}
                className={[rowClasses, styles['row-clickable']].filter(Boolean).join(' ')}
                onPointerEnter={() => isDragging && handleDragOverRow(problem.id)}
                onClick={(event) => {
                  // Row click opens the editor (§7.8); links, buttons and checkboxes keep their own job.
                  if ((event.target as HTMLElement).closest('a, button, input, [role="menuitem"]')) return;
                  navigate(`/admin/problems/${encodeURIComponent(problem.id)}`);
                }}
              >
                <td
                  className={styles['col-checkbox']}
                  onPointerDown={(event) => {
                    // The checkbox handles its own click on release. Starting
                    // drag-selection from pointerdown on the input changes the
                    // selection bar while the pointer is still down, shifting
                    // the table under the user's cursor.
                    if (event.target === event.currentTarget.querySelector('input[type="checkbox"]')) return;
                    handleSelectionZonePointerDown(event, problem.id, selected);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) => handleToggleSelectProblem(problem.id, { shiftKey: (event.nativeEvent as KeyboardEvent).shiftKey })}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Select problem ${problem.id}`}
                  />
                </td>
                <td className={styles['col-left']}>
                  <Link to={`/problems/${encodeURIComponent(problem.id)}`} className={styles['problem-id']}>{problem.id}</Link>
                </td>
                <td className={`${styles['col-left']} ${styles['cell-wrap']}`}>
                  <span className={styles['problem-title']}>{problem.title}</span>
                  {problem.problem_type === 'header' && <StatusBadge>HEADER</StatusBadge>}
                  {problem.collection_id !== null && problem.collection_name && (
                    <span className={styles['problem-collection']}>{problem.collection_name}</span>
                  )}
                </td>
                <td className={styles['col-right']}><DifficultyBadge difficulty={problem.difficulty} /></td>
                <td className={styles['col-left']}>
                  {(() => {
                    const issues = healthIssues(problem);
                    return issues.length > 0
                      ? <span className={styles['health-bad']}>{issues.join(' · ')}</span>
                      : <span className={styles['health-ok']}>Ready</span>;
                  })()}
                </td>
                <td className={`${styles['col-right']} ${styles.mono}`}>{problem.testcase_count ?? '—'}</td>
                <td className={styles['col-center']}>
                  {problem.contest_id && (problem.contest_status === 'scheduled' || problem.contest_status === 'running')
                    ? <StatusDot tone="neutral" label="In contest" />
                    : <StatusDot tone={problem.is_visible ? 'pass' : 'warn'} label={problem.is_visible ? 'Visible' : 'Hidden'} />}
                </td>
                <td className={styles['col-center']}>
                  <div className={styles['row-actions']}>
                    <ActionMenu
                      label={`Row actions for ${problem.id}`}
                      items={[
                        { key: 'edit', label: 'Edit', onClick: () => navigate(`/admin/problems/${encodeURIComponent(problem.id)}`) },
                        { key: 'testcases', label: 'Testcases', onClick: () => navigate(`/admin/problems/${encodeURIComponent(problem.id)}/testcases`) },
                        ...(isAdmin ? [{
                          key: 'rejudge',
                          label: 'Rejudge',
                          title: 'Re-run every submission for this problem against the current testcases and limits',
                          onClick: () => handleRejudgeClick({ kind: 'problem', id: problem.id, title: problem.title }),
                        }] : []),
                        ...(problem.contest_id && (problem.contest_status === 'scheduled' || problem.contest_status === 'running') ? [] : [{
                          key: 'toggle-visibility',
                          label: problem.is_visible ? 'Hide' : 'Show',
                          onClick: () => handleToggleVisibility(problem.id, problem.is_visible),
                        }]),
                        { key: 'copy-link', label: 'Copy link', onClick: () => { void navigator.clipboard?.writeText(`${window.location.origin}/problems/${encodeURIComponent(problem.id)}`); } },
                        { key: 'delete', label: 'Delete', variant: 'danger' as const, onClick: () => handleDeleteClick(problem.id) },
                      ]}
                    />
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* --- 5. Show More: server-side next batch -------------------------- */}
      {(hasMore || loadMoreError || loadAllError) && !loading && (
        <div className={styles['load-more-container']} ref={showMoreRef}>
          {loadMoreError && (
            <p className={styles['load-more-error']} role="alert">
              Failed to load more problems.
            </p>
          )}
          {loadAllError && (
            <p className={styles['load-more-error']} role="alert">
              Failed to load all problems. Loaded rows remain available.
            </p>
          )}
          {loadingAll && (
            <span role="status" aria-label="Loading all problems">
              Loading all problems… {visibleProblems.length} loaded
            </span>
          )}
          <Button
            variant="secondary"
            onClick={loadMore}
            loading={loadingMore}
            loadingLabel="Loading…"
            disabled={loadingAll || !bulkScopeReady}
          >
            {loadMoreError ? 'Retry' : 'Show More'}
          </Button>
          <Button
            variant="secondary"
            onClick={loadAll}
            disabled={loadingAll || loadingMore || !bulkScopeReady}
          >
            {loadAllError ? 'Retry Load All' : 'Load All'}
          </Button>
        </div>
      )}

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
          message={`Move ${selectedCount} selected problem${selectedCount === 1 ? '' : 's'} to "${moveConfirm.name}"? Each problem keeps at most one collection.`}
        />
      )}
      <ConfirmationModal
        isOpen={deleteSelectionConfirm}
        onClose={() => setDeleteSelectionConfirm(false)}
        onConfirm={runDeleteSelection}
        title={`Delete ${selectedCount} selected problem${selectedCount === 1 ? '' : 's'}?`}
        message="This permanently deletes the selected problems and their test cases and submissions. This action cannot be undone."
        confirmText={`Delete ${selectedCount}`}
      />
      <CreateProblemDialog
        open={createOpen}
        author={currentUser?.username ?? ''}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => { setCreateOpen(false); navigate(`/admin/problems/${encodeURIComponent(id)}`); }}
      />
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
        onConfirm={confirmBulkVisibility}
        title={bulkConfirm.type === 'show' ? "Confirm Show All" : "Confirm Hide All"}
        message={bulkConfirm.type === 'show'
          ? `Are you sure you want to make all ${bulkEligibleCount} matching eligible problem${bulkEligibleCount === 1 ? '' : 's'} visible? (Excluding those in contests)`
          : `Are you sure you want to hide all ${bulkEligibleCount} matching eligible problem${bulkEligibleCount === 1 ? '' : 's'}? (Excluding those in contests)`}
        confirmDisabled={!bulkScopeReady || bulkEligibleCount === 0}
      />
      <ConfirmationModal
        isOpen={isRejudgeConfirmOpen}
        onClose={handleCloseRejudgeConfirm}
        onConfirm={handleConfirmRejudge}
        title="Confirm Rejudge"
        message={rejudgeTarget
          ? `Rejudge re-runs every submission for ${rejudgeTarget.kind === 'problems' ? rejudgeTarget.title : `problem "${rejudgeTarget.title}"`} against the current testcases and limits. Scores may change.`
          : ''}
        confirmText="Rejudge"
        confirmStyle="default"
      />
    </div>
  );
};

export default ProblemManagement;

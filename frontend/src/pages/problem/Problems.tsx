import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import styles from './Problems.module.css';
import { useIncrementalProblems } from '../../hooks/useIncrementalProblems';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import {
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  ScoreCell,
  SegmentedControl,
  StatusMark,
  TestcaseStrip,
  verdictTone,
  type DataTableColumn,
  type FilterChip,
  type VerdictTone,
} from '../../components/ui';
import { DIFFICULTY_BANDS, PROBLEMS_PAGE } from '../../config/constants';
import { useAuth } from '../../context/AuthContext';
import problemService from '../../services/problemService';
import { formatTimeAgo } from '../../utils/formatters';
import type {
  ProblemCategoryCountsResponse,
  ProblemFilterOptionsResponse,
  ProblemStatusCounts,
  ProblemSummary,
} from '../../types';
import type { PublicProblemListLoaderData } from '../../routing/problemListLoaders';
import { buildPublicProblemListQuery } from '../../routing/problemListLoaders';

import LoadingPage from '../../components/shared/LoadingPage';

const UNCATEGORIZED = 'Uncategorized';
const DIFFICULTY_SORT_ASC = 'difficulty-asc';
const DIFFICULTY_SORT_DESC = 'difficulty-desc';
const STATUSES = ['unsolved', 'attempted', 'solved'] as const;
type StatusSegment = 'all' | typeof STATUSES[number];

/** The viewer's mark for a row: solved, the best attempt's tone, or untried. */
const rowTone = (problem: ProblemSummary): VerdictTone => {
  if ((problem.best_score ?? 0) >= 100) return 'pass';
  if (Number(problem.submission_count ?? 0) > 0) return verdictTone(problem.best_submission_status);
  return 'none';
};

/** Adds the current value as an option when it is not one of the presets (legacy URLs). */
const withCurrent = (options: FilterChip['options'], value: string | undefined, label: () => string) =>
  value && !options.some((option) => option.value === value) ? [...options, { value, label: label() }] : options;

const Problems = ({ initialPageSpan = null }: { initialPageSpan?: PublicProblemListLoaderData }) => {
  const { user } = useAuth();
  const isGuest = !user;
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get('category') || '';
  const selectedCategories = useMemo(() => categoryParam.split(',').filter(Boolean), [categoryParam]);
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('search') || '');
  const difficultyMin = searchParams.get('difficultyMin') || '';
  const difficultyMax = searchParams.get('difficultyMax') || '';
  const difficultySort = searchParams.get('sort') ?? DIFFICULTY_SORT_ASC;
  const urlAuthor = searchParams.get('author') || '';
  const collection = searchParams.get('collection') || '';
  const statusParam = searchParams.get('status') || '';
  const status: StatusSegment = !isGuest && (STATUSES as readonly string[]).includes(statusParam)
    ? statusParam as StatusSegment
    : 'all';
  const [categoryCounts, setCategoryCounts] = useState<ProblemCategoryCountsResponse | null>(null);
  const [filterOptions, setFilterOptions] = useState<ProblemFilterOptionsResponse | null>(null);
  const [statusCounts, setStatusCounts] = useState<ProblemStatusCounts | null>(null);
  const [totals, setTotals] = useState<ProblemStatusCounts | null>(null);
  const [showCategories, setShowCategories] = useState(false);

  const urlSearch = searchParams.get('search') || '';
  // Same-route navigation keeps this component mounted. Mirror an externally
  // changed URL into the search box; the existing debounce governs queries.
  // Adjusted during render (not in an effect) so the box never commits a
  // stale value for one frame.
  const [mirroredUrlSearch, setMirroredUrlSearch] = useState(urlSearch);
  if (urlSearch !== mirroredUrlSearch) {
    setMirroredUrlSearch(urlSearch);
    setSearch(urlSearch);
  }

  /** Writes URL filters (replace history) and resets the restored page span. */
  const updateUrl = (patch: Record<string, string>, preserveEmpty: string[] = []) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(patch)) {
        if (value || preserveEmpty.includes(key)) next.set(key, value);
        else next.delete(key);
      }
      next.delete('pages');
      return next;
    }, { replace: true, preventScrollReset: true });
  };

  // Debounce the search box: keystrokes settle before the server-side query
  // changes, so typing does not fire a request per character.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), PROBLEMS_PAGE.SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Server-side query. The public list defaults to difficulty ascending;
  // unrated problems remain included after rated problems. Status, search,
  // category, difficulty filters and sorting all run in SQL before pagination.
  const query = useMemo(() => buildPublicProblemListQuery({
    status: status === 'all' ? '' : status,
    search: debouncedSearch,
    category: categoryParam,
    author: urlAuthor,
    collection,
    difficultyMin,
    difficultyMax,
    sort: difficultySort,
  }), [status, debouncedSearch, categoryParam, urlAuthor, collection, difficultyMin, difficultyMax, difficultySort]);

  const {
    problems,
    loading,
    error,
    loadingMore,
    loadMoreError,
    hasMore,
    loadMore,
    loadedQueryKey,
  } = useIncrementalProblems(query, initialPageSpan);
  const showMoreRef = useInfiniteScroll({
    enabled: hasMore && !loading && !loadingMore && !loadMoreError,
    observationKey: problems.length,
    onLoadMore: loadMore,
  });

  // True once any first page has finished loading. After that the controls
  // stay mounted forever — a later query change refreshes only the result
  // area, so the search input never remounts and typing keeps its focus.
  const [hasLoaded, setHasLoaded] = useState(false);
  if (!hasLoaded && !loading && !error) setHasLoaded(true);

  useEffect(() => {
    let cancelled = false;
    problemService.getCategoryCounts()
      .then(counts => { if (!cancelled) setCategoryCounts(counts); })
      .catch(() => { /* Category choices are supplementary. */ });
    problemService.getFilterOptions()
      .then(options => { if (!cancelled) setFilterOptions(options); })
      .catch(() => { /* Collection choices are supplementary. */ });
    problemService.getStatusCounts({})
      .then(counts => { if (!cancelled) setTotals(counts); })
      .catch(() => { /* The header count is supplementary. */ });
    return () => { cancelled = true; };
  }, []);

  // Segment counts follow every list filter except the status itself.
  const countFilters = useMemo(() => {
    const { status: _status, sort: _sort, order: _order, limit: _limit, cursor: _cursor, ...filters } = query;
    return filters;
  }, [query]);
  const countKey = JSON.stringify(countFilters);
  useEffect(() => {
    let cancelled = false;
    problemService.getStatusCounts(JSON.parse(countKey))
      .then(counts => { if (!cancelled) setStatusCounts(counts); })
      .catch(() => { if (!cancelled) setStatusCounts(null); });
    return () => { cancelled = true; };
  }, [countKey]);

  // Record the loaded span only after it belongs to the committed URL filters.
  // This avoids reviving an old page count in the debounce window after a
  // search input changes.
  useEffect(() => {
    if (loadedQueryKey !== JSON.stringify(query) || search.trim() !== debouncedSearch.trim()) return;
    const loadedPages = Math.max(1, Math.ceil(problems.length / PROBLEMS_PAGE.PAGE_SIZE));
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
  }, [loadedQueryKey, query, problems.length, search, debouncedSearch, searchParams, setSearchParams]);

  // Only narrowing controls affect the empty-state copy; the default sort
  // does not turn an otherwise unfiltered empty list into a filtered state.
  const hasActiveFilters = debouncedSearch.trim() !== ''
    || categoryParam !== ''
    || difficultyMin !== ''
    || difficultyMax !== ''
    || urlAuthor.trim() !== ''
    || collection !== ''
    || status !== 'all';

  const difficultyValue = difficultyMin || difficultyMax ? `${difficultyMin}-${difficultyMax}` : undefined;
  const categoryOptions = [
    ...(categoryCounts?.categories.map(({ name }) => ({ value: name, label: name })) ?? []),
    ...(categoryCounts?.uncategorized ? [{ value: UNCATEGORIZED, label: UNCATEGORIZED }] : []),
  ];
  const collectionOptions = [
    ...(filterOptions?.collections.map(option => ({ value: String(option.id), label: option.name })) ?? []),
    ...(filterOptions?.hasUncollected ? [{ value: 'none', label: 'No collection' }] : []),
  ];
  const filters: FilterChip[] = [
    {
      key: 'difficulty',
      label: 'Difficulty',
      value: difficultyValue,
      options: withCurrent(DIFFICULTY_BANDS.map(({ value, label }) => ({ value, label })), difficultyValue,
        () => `${difficultyMin || '…'}–${difficultyMax || '…'}`),
      onChange: (value) => {
        const band = DIFFICULTY_BANDS.find(b => b.value === value);
        updateUrl({ difficultyMin: band ? String(band.min) : '', difficultyMax: band ? String(band.max) : '' });
      },
    },
    {
      key: 'category',
      label: 'Category',
      value: categoryParam || undefined,
      options: withCurrent(categoryOptions, categoryParam || undefined, () => selectedCategories.join(', ')),
      onChange: (value) => updateUrl({ category: value ?? '' }),
    },
    {
      key: 'collection',
      label: 'Collection',
      value: collection || undefined,
      options: withCurrent(collectionOptions, collection || undefined, () => `Collection ${collection}`),
      onChange: (value) => updateUrl({ collection: value ?? '' }),
    },
    // Author has no preset list: it is set from a problem's author link and
    // shown here only so it can be removed.
    ...(urlAuthor ? [{
      key: 'author',
      label: 'Author',
      value: urlAuthor,
      options: [{ value: urlAuthor, label: urlAuthor }],
      onChange: () => updateUrl({ author: '' }),
    }] : []),
  ];

  const segmentLabel = (key: StatusSegment, label: string) =>
    statusCounts ? `${label} ${key === 'all' ? statusCounts.all : statusCounts[key]}` : label;

  const visibleCategories = (problem: ProblemSummary): string[] => {
    const categories = problem.categories ?? [];
    return showCategories ? [...categories] : categories.filter(c => selectedCategories.includes(c));
  };

  const columns: DataTableColumn<ProblemSummary>[] = [
    {
      key: 'mark',
      header: <span className={styles.srOnly}>Status</span>,
      cell: (p) => <StatusMark tone={rowTone(p)} />,
      width: '28px',
      mobile: 'hidden',
    },
    { key: 'id', header: 'ID', cell: (p) => <span className={styles.mono}>{p.id}</span>, mobile: 'meta' },
    {
      key: 'title',
      header: 'Title',
      mobile: 'primary',
      cell: (p) => {
        const categories = visibleCategories(p);
        return categories.length === 0 ? p.title : (
          <span className={styles.titleCell}>
            {p.title}
            <span className={styles.categories}>{categories.join(' · ')}</span>
          </span>
        );
      },
    },
    {
      key: 'difficulty',
      header: 'Difficulty',
      align: 'right',
      cell: (p) => (p.difficulty ?? '—'),
      mobile: 'hidden',
    },
    {
      key: 'best',
      header: 'Best',
      mobile: 'meta',
      cell: (p) => {
        const results = Array.isArray(p.best_submission_results) ? p.best_submission_results : [];
        return (
          <span className={styles.best}>
            {results.length > 0 && <TestcaseStrip results={results} />}
            <ScoreCell score={p.best_score} attempted={Number(p.submission_count ?? 0) > 0} />
          </span>
        );
      },
    },
    {
      key: 'last',
      header: 'Last tried',
      mobile: 'meta',
      cell: (p) => <span className={styles.muted}>{p.latest_submission_at ? formatTimeAgo(p.latest_submission_at) : '—'}</span>,
    },
  ];

  // The full-page loader is only for the very first load. Every later
  // refresh keeps the controls mounted so the search input keeps focus.
  const isInitialLoad = loading && !hasLoaded;
  if (isInitialLoad && !error) return <LoadingPage />;
  if (error && !hasLoaded) return <div className="error-message">{error}</div>;

  const headerMeta = totals
    ? (isGuest ? `${totals.all} problems` : `${totals.all} problems · ${totals.solved} solved`)
    : undefined;

  return (
    <div className={styles['problems-page-container']}>
      <PageHeader title="Problems" meta={headerMeta} />

      <FilterBar
        search={{
          value: search,
          placeholder: 'Search problems',
          onChange: (value) => { setSearch(value); updateUrl({ search: value }); },
        }}
        segments={isGuest ? undefined : (
          <SegmentedControl<StatusSegment>
            aria-label="Problem status"
            className={styles.segments}
            value={status}
            onChange={(value) => updateUrl({ status: value === 'all' ? '' : value })}
            options={[
              { value: 'all', label: segmentLabel('all', 'All') },
              { value: 'unsolved', label: segmentLabel('unsolved', 'Unsolved') },
              { value: 'attempted', label: segmentLabel('attempted', 'Attempted') },
              { value: 'solved', label: segmentLabel('solved', 'Solved') },
            ]}
          />
        )}
        filters={filters}
        trailing={(
          <>
            <button
              type="button"
              className={styles.toggle}
              aria-pressed={showCategories}
              onClick={() => setShowCategories(on => !on)}
            >
              Show categories
            </button>
            <select
              aria-label="Sort problems"
              className={styles.sortSelect}
              value={difficultySort}
              onChange={event => updateUrl({ sort: event.target.value }, ['sort'])}
            >
              <option value="">Sort: Default</option>
              <option value={DIFFICULTY_SORT_ASC}>Difficulty ↑</option>
              <option value={DIFFICULTY_SORT_DESC}>Difficulty ↓</option>
            </select>
          </>
        )}
      />

      <DataTable<ProblemSummary>
        caption="Problems"
        columns={columns}
        rows={problems}
        rowKey={(p) => p.id}
        rowLabel={(p) => p.title}
        rowHref={(p) => `/problems/${p.id}`}
        loading={loading}
        error={error ? { message: error } : undefined}
        empty={(
          <EmptyState
            title="Problem not available."
            description={hasActiveFilters
              ? 'No problems match the current filter.'
              : 'Check back later or try refreshing the page.'}
          />
        )}
      />

      {(hasMore || loadMoreError) && (
        <div className={styles['show-more-container']} ref={showMoreRef}>
          {loadMoreError && (
            <p className={styles['show-more-error']} role="alert">
              Failed to load more problems.
            </p>
          )}
          <Button
            variant="secondary"
            onClick={loadMore}
            loading={loadingMore}
            loadingLabel="Loading…"
          >
            {loadMoreError ? 'Retry' : 'Show More'}
          </Button>
        </div>
      )}
    </div>
  );
};

export default Problems;

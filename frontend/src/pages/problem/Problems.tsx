import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import styles from './Problems.module.css';
import { useIncrementalProblems } from '../../hooks/useIncrementalProblems';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import ProblemCard from '../../features/problem/ProblemCard';
import { Button } from '../../components/ui';
import { PROBLEMS_PAGE } from '../../config/constants';
import { PROBLEM_DIFFICULTY_OPTIONS } from '../../utils/constants';
import problemService from '../../services/problemService';
import type { ProblemCategoryCountsResponse, ProblemFilterOptionsResponse } from '../../types';

import LoadingPage from '../../components/shared/LoadingPage';

const ALL_CATEGORIES = 'All';
const UNCATEGORIZED = 'Uncategorized';
const DIFFICULTY_SORT_NONE = '';
const DIFFICULTY_SORT_ASC = 'difficulty-asc';
const DIFFICULTY_SORT_DESC = 'difficulty-desc';

const Problems = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategory = searchParams.get('category') || ALL_CATEGORIES;
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('search') || '');
  const difficultyMin = searchParams.get('difficultyMin') || '';
  const difficultyMax = searchParams.get('difficultyMax') || '';
  const difficultySort = searchParams.get('sort') ?? DIFFICULTY_SORT_ASC;
  const [author, setAuthor] = useState(() => searchParams.get('author') || '');
  const [debouncedAuthor, setDebouncedAuthor] = useState(() => searchParams.get('author') || '');
  const collection = searchParams.get('collection') || '';
  const [categoryCounts, setCategoryCounts] = useState<ProblemCategoryCountsResponse | null>(null);
  const [filterOptions, setFilterOptions] = useState<ProblemFilterOptionsResponse | null>(null);

  const urlSearch = searchParams.get('search') || '';
  const urlAuthor = searchParams.get('author') || '';
  // Same-route navigation keeps this component mounted. Mirror an externally
  // changed URL into the text boxes; the existing debounce governs queries.
  useEffect(() => { setSearch(urlSearch); }, [urlSearch]);
  useEffect(() => { setAuthor(urlAuthor); }, [urlAuthor]);

  const updateUrlFilter = (key: string, value: string, preserveEmpty = false) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      if (value || preserveEmpty) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };

  // Debounce the search box: keystrokes settle before the server-side query
  // changes, so typing does not fire a request per character.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), PROBLEMS_PAGE.SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedAuthor(author), PROBLEMS_PAGE.SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [author]);

  // Server-side query. The public list defaults to difficulty ascending;
  // unrated problems remain included after rated problems. Search, category,
  // difficulty filters and sorting all run in SQL before pagination.
  const query = useMemo(() => {
    const trimmed = debouncedSearch.trim();
    return {
      ...(trimmed ? { search: trimmed } : {}),
      ...(activeCategory !== ALL_CATEGORIES ? { category: activeCategory } : {}),
      ...(debouncedAuthor.trim() ? { author: debouncedAuthor.trim() } : {}),
      ...(collection !== '' ? { collection: collection === 'none' ? 'none' as const : Number(collection) } : {}),
      ...(difficultyMin !== '' ? { difficultyMin: Number(difficultyMin) } : {}),
      ...(difficultyMax !== '' ? { difficultyMax: Number(difficultyMax) } : {}),
      ...(difficultySort === DIFFICULTY_SORT_ASC || difficultySort === DIFFICULTY_SORT_DESC
        ? { sort: 'difficulty' as const, order: difficultySort === DIFFICULTY_SORT_ASC ? 'asc' as const : 'desc' as const }
        : {}),
    };
  }, [debouncedSearch, activeCategory, debouncedAuthor, collection, difficultyMin, difficultyMax, difficultySort]);

  const {
    problems,
    loading,
    error,
    loadingMore,
    loadMoreError,
    hasMore,
    loadMore,
  } = useIncrementalProblems(query);
  const showMoreRef = useInfiniteScroll({
    enabled: hasMore && !loading && !loadingMore && !loadMoreError,
    observationKey: problems.length,
    onLoadMore: loadMore,
  });

  // True once any first page has finished loading. After that the controls
  // stay mounted forever — a later query change refreshes only the result
  // area, so the search input never remounts and typing keeps its focus.
  const hasLoadedRef = useRef(false);
  if (!loading && !error) hasLoadedRef.current = true;

  // Global category tab counts — one cheap aggregate, independent of the
  // loaded batch, so tabs stay correct while pages stream in.
  useEffect(() => {
    let cancelled = false;
    problemService.getCategoryCounts()
      .then(counts => {
        if (!cancelled) setCategoryCounts(counts);
      })
      .catch(() => {
        // Tabs are supplementary; the list stays fully usable without them.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    problemService.getFilterOptions()
      .then(options => {
        if (!cancelled) setFilterOptions(options);
      })
      .catch(() => {
        // The list remains usable when supplementary filter choices cannot load.
      });
    return () => { cancelled = true; };
  }, []);

  // Coming back from a problem detail page restores the previous scroll spot.
  useScrollRestore(!loading && !error);

  // Only narrowing controls affect the empty-state copy; the default sort
  // does not turn an otherwise unfiltered empty list into a filtered state.
  const hasActiveFilters = debouncedSearch.trim() !== ''
    || activeCategory !== ALL_CATEGORIES
    || difficultyMin !== ''
    || difficultyMax !== ''
    || debouncedAuthor.trim() !== ''
    || collection !== '';

  // The full-page loader is only for the very first load. Every later
  // refresh (typing in search, changing a filter) keeps the controls
  // mounted — replacing the page would unmount the search input and drop
  // the user's focus mid-word. Only the result area shows the refresh.
  const isInitialLoad = loading && !hasLoadedRef.current;
  if (isInitialLoad && !error) return <LoadingPage />;
  if (error && !hasLoadedRef.current) return <div className="error-message">{error}</div>;

  return (
    <div className={styles['problems-page-container']}>
      <h1>All Problems</h1>

      <div className={styles['problems-controls']}>
        <input
          type="search"
          className={styles['problems-search']}
          placeholder="Search by name or ID…"
          value={search}
          onChange={event => { setSearch(event.target.value); updateUrlFilter('search', event.target.value); }}
          aria-label="Search problems"
        />
        <div className={styles['difficulty-controls']}>
          <label className={styles['difficulty-control']}>
            <span className={styles['difficulty-control-label']}>Difficulty</span>
            <select
              aria-label="Difficulty minimum"
              className={styles['difficulty-select']}
              value={difficultyMin}
              onChange={event => updateUrlFilter('difficultyMin', event.target.value)}
            >
              <option value="">Min</option>
              {PROBLEM_DIFFICULTY_OPTIONS.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <span className={styles['difficulty-separator']} aria-hidden="true">–</span>
          <select
            aria-label="Difficulty maximum"
            className={styles['difficulty-select']}
            value={difficultyMax}
            onChange={event => updateUrlFilter('difficultyMax', event.target.value)}
          >
            <option value="">Max</option>
            {PROBLEM_DIFFICULTY_OPTIONS.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <select
            aria-label="Sort problems"
            className={styles['difficulty-select']}
            value={difficultySort}
            onChange={event => updateUrlFilter('sort', event.target.value, true)}
          >
            <option value="">Sort: Default</option>
            <option value={DIFFICULTY_SORT_ASC}>Difficulty ↑</option>
            <option value={DIFFICULTY_SORT_DESC}>Difficulty ↓</option>
          </select>
        </div>
        <label className={styles['difficulty-control']}>
          <span className={styles['difficulty-control-label']}>Author</span>
          <input type="search" aria-label="Author" className={styles['difficulty-select']}
            placeholder="Filter by author…" value={author}
            onChange={event => { setAuthor(event.target.value); updateUrlFilter('author', event.target.value); }} />
        </label>
        <label className={styles['difficulty-control']}>
          <span className={styles['difficulty-control-label']}>Collection</span>
          <select aria-label="Collection" className={styles['difficulty-select']} value={collection}
            onChange={event => updateUrlFilter('collection', event.target.value)}>
            <option value="">All collections</option>
            {filterOptions?.hasUncollected && <option value="none">No collection</option>}
            {filterOptions?.collections.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
      </div>

      {categoryCounts && categoryCounts.total > 0 && (
        <div className={styles['category-tabs']} role="tablist" aria-label="Problem categories">
          <button
            role="tab"
            aria-selected={activeCategory === ALL_CATEGORIES}
            className={`${styles['category-tab']} ${activeCategory === ALL_CATEGORIES ? styles.active : ''}`}
            onClick={() => updateUrlFilter('category', '')}
          >
            {ALL_CATEGORIES} <span className={styles['category-count']}>{categoryCounts.total}</span>
          </button>
          {categoryCounts.categories.map(({ name, count }) => (
            <button
              key={name}
              role="tab"
              aria-selected={activeCategory === name}
              className={`${styles['category-tab']} ${activeCategory === name ? styles.active : ''}`}
              onClick={() => updateUrlFilter('category', name)}
            >
              {name} <span className={styles['category-count']}>{count}</span>
            </button>
          ))}
          {categoryCounts.uncategorized > 0 && (
            <button
              role="tab"
              aria-selected={activeCategory === UNCATEGORIZED}
              className={`${styles['category-tab']} ${activeCategory === UNCATEGORIZED ? styles.active : ''}`}
              onClick={() => updateUrlFilter('category', UNCATEGORIZED)}
            >
              {UNCATEGORIZED} <span className={styles['category-count']}>{categoryCounts.uncategorized}</span>
            </button>
          )}
        </div>
      )}

      {/* Result-area refresh indicator: the controls above stay mounted and
          interactive while this shows (spec: no full-page loading screen
          between searches). A later refresh keeps the previous batch
          visible; an empty result area shows the loading line. */}
      {error && <div className="error-message" role="alert">{error}</div>}
      {!error && loading && problems.length === 0 && (
        <p className={styles['results-loading']} role="status">Loading problems…</p>
      )}

      {problems.length > 0 ? (
        <div className={styles['problem-list']}>
          {problems.map(problem => (
            <ProblemCard
              key={problem.id}
              problem={problem}
              highlightCategory={activeCategory === ALL_CATEGORIES ? null : activeCategory}
            />
          ))}
        </div>
      ) : (
        !loading && (
          <div className={styles['no-problems-container']}>
            <div className={styles['no-problems-icon']}>📂</div>
            <div className={styles['no-problems-title']}>Problem not available.</div>
            <div className={styles['no-problems-subtext']}>
              {hasActiveFilters
                ? 'No problems match the current filter.'
                : 'Check back later or try refreshing the page.'}
            </div>
          </div>
        )
      )}

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

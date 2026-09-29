import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import styles from './Problems.module.css';
import { useIncrementalProblems } from '../../hooks/useIncrementalProblems';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import ProblemCard from '../../features/problem/ProblemCard';
import { Button } from '../../components/ui';
import { PROBLEMS_PAGE } from '../../config/constants';
import { PROBLEM_DIFFICULTY_OPTIONS } from '../../utils/constants';
import problemService from '../../services/problemService';
import type { ProblemCategoryCountsResponse, ProblemFilterOptionsResponse } from '../../types';
import type { PublicProblemListLoaderData } from '../../routing/problemListLoaders';
import { buildPublicProblemListQuery } from '../../routing/problemListLoaders';

import LoadingPage from '../../components/shared/LoadingPage';

const ALL_CATEGORIES = 'All';
const UNCATEGORIZED = 'Uncategorized';
const DIFFICULTY_SORT_NONE = '';
const DIFFICULTY_SORT_ASC = 'difficulty-asc';
const DIFFICULTY_SORT_DESC = 'difficulty-desc';

const Problems = ({ initialPageSpan = null }: { initialPageSpan?: PublicProblemListLoaderData }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedCategories = (searchParams.get('category') || '').split(',').filter(Boolean);
  const hasCategoryFilter = selectedCategories.length > 0;
  const categoryQueryValue = selectedCategories.join(',');
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
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedAuthor(author), PROBLEMS_PAGE.SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [author]);

  // Server-side query. The public list defaults to difficulty ascending;
  // unrated problems remain included after rated problems. Search, category,
  // difficulty filters and sorting all run in SQL before pagination.
  const query = useMemo(() => {
    return buildPublicProblemListQuery({
      search: debouncedSearch,
      category: categoryQueryValue,
      author: debouncedAuthor,
      collection,
      difficultyMin,
      difficultyMax,
      sort: difficultySort,
    });
  }, [debouncedSearch, categoryQueryValue, debouncedAuthor, collection, difficultyMin, difficultyMax, difficultySort]);

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
  const hasLoadedRef = useRef(false);
  if (!loading && !error) hasLoadedRef.current = true;

  // Global category counts — one cheap aggregate, independent of the loaded
  // batch, so category choices stay correct while pages stream in.
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

  // Record the loaded span only after it belongs to the committed URL filters.
  // This avoids reviving an old page count in the debounce window after a
  // search/author input changes.
  useEffect(() => {
    if (loadedQueryKey !== JSON.stringify(query)
      || search.trim() !== debouncedSearch.trim()
      || author.trim() !== debouncedAuthor.trim()) return;
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
  }, [loadedQueryKey, query, problems.length, search, debouncedSearch, author, debouncedAuthor, searchParams, setSearchParams]);

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

  // Only narrowing controls affect the empty-state copy; the default sort
  // does not turn an otherwise unfiltered empty list into a filtered state.
  const hasActiveFilters = debouncedSearch.trim() !== ''
    || hasCategoryFilter
    || difficultyMin !== ''
    || difficultyMax !== ''
    || debouncedAuthor.trim() !== ''
    || collection !== '';

  // Keep search and ordering visible; narrowing controls and categories are
  // grouped in one disclosure, with only selected filters summarized inline.
  // Count each selected category separately so the badge reflects a
  // multi-category filter, while range/author/collection remain one each.
  const activeFilterCount = selectedCategories.length
    + Number(difficultyMin !== '' || difficultyMax !== '')
    + Number(author.trim() !== '')
    + Number(collection !== '');
  const difficultyFilterLabel = difficultyMin && difficultyMax
    ? `Difficulty: ${difficultyMin}–${difficultyMax}`
    : difficultyMin
      ? `Difficulty: ≥ ${difficultyMin}`
      : `Difficulty: ≤ ${difficultyMax}`;
  const collectionFilterLabel = collection === 'none'
    ? 'No collection'
    : filterOptions?.collections.find(option => String(option.id) === collection)?.name ?? `Collection ${collection}`;
  const clearFilterControls = () => {
    setAuthor('');
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      ['category', 'difficultyMin', 'difficultyMax', 'author', 'collection'].forEach(key => next.delete(key));
      next.delete('pages');
      return next;
    }, { replace: true, preventScrollReset: true });
  };
  const setCategorySelection = (category: string, checked: boolean) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      const selected = new Set((next.get('category') || '').split(',').filter(Boolean));
      if (category === ALL_CATEGORIES) {
        selected.clear();
      } else if (checked) {
        selected.add(category);
      } else {
        selected.delete(category);
      }
      if (selected.size > 0) next.set('category', [...selected].join(','));
      else next.delete('category');
      next.delete('pages');
      return next;
    }, { replace: true, preventScrollReset: true });
  };

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
        <div className={styles['search-wrap']}>
          <input
            type="search"
            className={styles['problems-search']}
            placeholder="Search by name or ID…"
            value={search}
            onChange={event => { setSearch(event.target.value); updateUrlFilter('search', event.target.value); }}
            aria-label="Search problems"
          />
        </div>
        <div className={styles['primary-filter-actions']}>
          <select
            aria-label="Sort problems"
            className={`${styles['difficulty-select']} ${styles['sort-select']}`}
            value={difficultySort}
            onChange={event => updateUrlFilter('sort', event.target.value, true)}
          >
            <option value="">Sort: Default</option>
            <option value={DIFFICULTY_SORT_ASC}>Difficulty ↑</option>
            <option value={DIFFICULTY_SORT_DESC}>Difficulty ↓</option>
          </select>
          <details className={styles['filter-popover']}>
            <summary aria-label={`Filters${activeFilterCount ? `, ${activeFilterCount} active` : ''}`}>
              <span>Filters</span>
              {activeFilterCount > 0 && <span className={styles['filter-count']}>{activeFilterCount}</span>}
              <span className={styles['filter-chevron']} aria-hidden="true">⌄</span>
            </summary>
            <div className={styles['filter-panel']}>
              <div className={styles['filter-panel-header']}>
                <strong>Filters</strong>
                {activeFilterCount > 0 && (
                  <button type="button" className={styles['clear-filters']} onClick={clearFilterControls}>
                    Clear all
                  </button>
                )}
              </div>
              <div className={styles['filter-fields']}>
                <div className={`${styles['filter-control']} ${styles['difficulty-control-group']}`}>
                  <span>Difficulty</span>
                  <div className={styles['difficulty-controls']}>
                    <label className={styles['sr-only']} htmlFor="problem-difficulty-min">Difficulty minimum</label>
                    <select id="problem-difficulty-min" aria-label="Difficulty minimum"
                      className={styles['difficulty-select']} value={difficultyMin}
                      onChange={event => updateUrlFilter('difficultyMin', event.target.value)}>
                      <option value="">Min</option>
                      {PROBLEM_DIFFICULTY_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <span className={styles['difficulty-separator']} aria-hidden="true">–</span>
                    <label className={styles['sr-only']} htmlFor="problem-difficulty-max">Difficulty maximum</label>
                    <select id="problem-difficulty-max" aria-label="Difficulty maximum"
                      className={styles['difficulty-select']} value={difficultyMax}
                      onChange={event => updateUrlFilter('difficultyMax', event.target.value)}>
                      <option value="">Max</option>
                      {PROBLEM_DIFFICULTY_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </div>
                </div>
                <label className={styles['filter-control']}>
                  <span>Collection</span>
                  <select aria-label="Collection" className={styles['difficulty-select']} value={collection}
                    onChange={event => updateUrlFilter('collection', event.target.value)}>
                    <option value="">All collections</option>
                    {filterOptions?.hasUncollected && <option value="none">No collection</option>}
                    {filterOptions?.collections.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                </label>
                <label className={styles['filter-control']}>
                  <span>Author</span>
                  <input type="search" aria-label="Author" className={styles['difficulty-select']}
                    placeholder="Filter by author…" value={author}
                    onChange={event => { setAuthor(event.target.value); updateUrlFilter('author', event.target.value); }} />
                </label>
              </div>
              <fieldset className={`${styles['filter-fieldset']} ${styles['category-fieldset']}`}>
                <legend>Category</legend>
                <div className={styles['category-options']} role="group" aria-label="Problem categories">
                  <label className={styles['category-option']}>
                    <input type="checkbox" checked={!hasCategoryFilter}
                      onChange={() => setCategorySelection(ALL_CATEGORIES, true)} />
                    <span>All</span>
                    {categoryCounts && <small>{categoryCounts.total}</small>}
                  </label>
                  {categoryCounts?.categories.map(({ name, count }) => (
                    <label key={name} className={styles['category-option']}>
                      <input type="checkbox" value={name} checked={selectedCategories.includes(name)}
                        onChange={event => setCategorySelection(name, event.target.checked)} />
                      <span>{name}</span><small>{count}</small>
                    </label>
                  ))}
                  {Boolean(categoryCounts?.uncategorized) && (
                    <label className={styles['category-option']}>
                      <input type="checkbox" value={UNCATEGORIZED} checked={selectedCategories.includes(UNCATEGORIZED)}
                        onChange={event => setCategorySelection(UNCATEGORIZED, event.target.checked)} />
                      <span>{UNCATEGORIZED}</span><small>{categoryCounts?.uncategorized}</small>
                    </label>
                  )}
                </div>
              </fieldset>
            </div>
          </details>
        </div>
      </div>

      {activeFilterCount > 0 && (
        <div className={styles['active-filters']} aria-label="Active filters">
          <span className={styles['active-filters-label']}>Active filters</span>
          {hasCategoryFilter && (
            <button type="button" className={styles['active-filter-chip']} aria-label={`Remove category filter: ${selectedCategories.join(', ')}`}
              onClick={() => updateUrlFilter('category', '')}>
              Category: {selectedCategories.join(', ')}<span aria-hidden="true">×</span>
            </button>
          )}
          {(difficultyMin !== '' || difficultyMax !== '') && (
            <button type="button" className={styles['active-filter-chip']} aria-label="Remove difficulty filter"
              onClick={() => {
                setSearchParams(previous => {
                  const next = new URLSearchParams(previous);
                  next.delete('difficultyMin');
                  next.delete('difficultyMax');
                  next.delete('pages');
                  return next;
                }, { replace: true, preventScrollReset: true });
              }}>
              {difficultyFilterLabel}<span aria-hidden="true">×</span>
            </button>
          )}
          {author.trim() !== '' && (
            <button type="button" className={styles['active-filter-chip']} aria-label="Remove author filter"
              onClick={() => { setAuthor(''); updateUrlFilter('author', ''); }}>
              Author: {author.trim()}<span aria-hidden="true">×</span>
            </button>
          )}
          {collection !== '' && (
            <button type="button" className={styles['active-filter-chip']} aria-label="Remove collection filter"
              onClick={() => updateUrlFilter('collection', '')}>
              {collectionFilterLabel}<span aria-hidden="true">×</span>
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
              highlightCategories={selectedCategories}
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

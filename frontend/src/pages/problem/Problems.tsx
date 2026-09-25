import { useEffect, useMemo, useState } from 'react';
import styles from './Problems.module.css';
import { useIncrementalProblems } from '../../hooks/useIncrementalProblems';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import ProblemCard from '../../features/problem/ProblemCard';
import { Button } from '../../components/ui';
import { PROBLEMS_PAGE } from '../../config/constants';
import { PROBLEM_DIFFICULTY_OPTIONS } from '../../utils/constants';
import problemService from '../../services/problemService';
import type { ProblemCategoryCountsResponse } from '../../types';

import LoadingPage from '../../components/shared/LoadingPage';

const ALL_CATEGORIES = 'All';
const UNCATEGORIZED = 'Uncategorized';
const DIFFICULTY_SORT_NONE = '';
const DIFFICULTY_SORT_ASC = 'difficulty-asc';
const DIFFICULTY_SORT_DESC = 'difficulty-desc';

const Problems = () => {
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [difficultyMin, setDifficultyMin] = useState('');
  const [difficultyMax, setDifficultyMax] = useState('');
  const [difficultySort, setDifficultySort] = useState(DIFFICULTY_SORT_NONE);
  const [categoryCounts, setCategoryCounts] = useState<ProblemCategoryCountsResponse | null>(null);

  // Debounce the search box: keystrokes settle before the server-side query
  // changes, so typing does not fire a request per character.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), PROBLEMS_PAGE.SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Server-side query. With nothing selected it is empty and the backend
  // returns exactly the pre-feature default view (Unrated problems included,
  // ordered by id). Search, category, difficulty filters and sorting all run
  // in SQL before pagination.
  const query = useMemo(() => {
    const trimmed = debouncedSearch.trim();
    return {
      ...(trimmed ? { search: trimmed } : {}),
      ...(activeCategory !== ALL_CATEGORIES ? { category: activeCategory } : {}),
      ...(difficultyMin !== '' ? { difficultyMin: Number(difficultyMin) } : {}),
      ...(difficultyMax !== '' ? { difficultyMax: Number(difficultyMax) } : {}),
      ...(difficultySort === DIFFICULTY_SORT_ASC || difficultySort === DIFFICULTY_SORT_DESC
        ? { sort: 'difficulty' as const, order: difficultySort === DIFFICULTY_SORT_ASC ? 'asc' as const : 'desc' as const }
        : {}),
    };
  }, [debouncedSearch, activeCategory, difficultyMin, difficultyMax, difficultySort]);

  const {
    problems,
    loading,
    error,
    loadingMore,
    loadMoreError,
    hasMore,
    loadMore,
  } = useIncrementalProblems(query);

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

  // Coming back from a problem detail page restores the previous scroll spot.
  useScrollRestore(!loading && !error);

  // Any filter/search/sort selection active (drives the empty-state copy).
  const hasActiveFilters = debouncedSearch.trim() !== ''
    || activeCategory !== ALL_CATEGORIES
    || difficultyMin !== ''
    || difficultyMax !== ''
    || difficultySort !== DIFFICULTY_SORT_NONE;

  if (loading) return <LoadingPage />;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className={styles['problems-page-container']}>
      <h1>All Problems</h1>

      <div className={styles['problems-controls']}>
        <input
          type="search"
          className={styles['problems-search']}
          placeholder="Search by name or ID…"
          value={search}
          onChange={event => setSearch(event.target.value)}
          aria-label="Search problems"
        />
        <div className={styles['difficulty-controls']}>
          <label className={styles['difficulty-control']}>
            <span className={styles['difficulty-control-label']}>Difficulty</span>
            <select
              aria-label="Difficulty minimum"
              className={styles['difficulty-select']}
              value={difficultyMin}
              onChange={event => setDifficultyMin(event.target.value)}
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
            onChange={event => setDifficultyMax(event.target.value)}
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
            onChange={event => setDifficultySort(event.target.value)}
          >
            <option value="">Sort: Default</option>
            <option value={DIFFICULTY_SORT_ASC}>Difficulty ↑</option>
            <option value={DIFFICULTY_SORT_DESC}>Difficulty ↓</option>
          </select>
        </div>
      </div>

      {categoryCounts && categoryCounts.total > 0 && (
        <div className={styles['category-tabs']} role="tablist" aria-label="Problem categories">
          <button
            role="tab"
            aria-selected={activeCategory === ALL_CATEGORIES}
            className={`${styles['category-tab']} ${activeCategory === ALL_CATEGORIES ? styles.active : ''}`}
            onClick={() => setActiveCategory(ALL_CATEGORIES)}
          >
            {ALL_CATEGORIES} <span className={styles['category-count']}>{categoryCounts.total}</span>
          </button>
          {categoryCounts.categories.map(({ name, count }) => (
            <button
              key={name}
              role="tab"
              aria-selected={activeCategory === name}
              className={`${styles['category-tab']} ${activeCategory === name ? styles.active : ''}`}
              onClick={() => setActiveCategory(name)}
            >
              {name} <span className={styles['category-count']}>{count}</span>
            </button>
          ))}
          {categoryCounts.uncategorized > 0 && (
            <button
              role="tab"
              aria-selected={activeCategory === UNCATEGORIZED}
              className={`${styles['category-tab']} ${activeCategory === UNCATEGORIZED ? styles.active : ''}`}
              onClick={() => setActiveCategory(UNCATEGORIZED)}
            >
              {UNCATEGORIZED} <span className={styles['category-count']}>{categoryCounts.uncategorized}</span>
            </button>
          )}
        </div>
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
        <div className={styles['no-problems-container']}>
          <div className={styles['no-problems-icon']}>📂</div>
          <div className={styles['no-problems-title']}>Problem not available.</div>
          <div className={styles['no-problems-subtext']}>
            {hasActiveFilters
              ? 'No problems match the current filter.'
              : 'Check back later or try refreshing the page.'}
          </div>
        </div>
      )}

      {(hasMore || loadMoreError) && (
        <div className={styles['show-more-container']}>
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

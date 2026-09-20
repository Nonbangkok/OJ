import { useMemo, useState } from 'react';
import styles from './Problems.module.css';
import { useProblems } from '../../hooks/useProblems';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import ProblemCard from '../../features/problem/ProblemCard';
import { PROBLEM_DIFFICULTY_OPTIONS } from '../../utils/constants';
import type { ProblemListDifficultyQuery } from '../../services/problemService';

import LoadingPage from '../../components/shared/LoadingPage';

const ALL_CATEGORIES = 'All';
const UNCATEGORIZED = 'Uncategorized';
const DIFFICULTY_SORT_NONE = '';
const DIFFICULTY_SORT_ASC = 'difficulty-asc';
const DIFFICULTY_SORT_DESC = 'difficulty-desc';

const Problems = () => {
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES);
  const [search, setSearch] = useState('');
  const [difficultyMin, setDifficultyMin] = useState('');
  const [difficultyMax, setDifficultyMax] = useState('');
  const [difficultySort, setDifficultySort] = useState(DIFFICULTY_SORT_NONE);

  // Server-side difficulty controls. With nothing selected the query is empty
  // and the backend returns exactly the pre-feature default view (Unrated
  // problems included, ordered by id).
  const difficultyQuery = useMemo<ProblemListDifficultyQuery>(() => {
    const query: ProblemListDifficultyQuery = {};
    if (difficultyMin !== '') query.difficultyMin = Number(difficultyMin);
    if (difficultyMax !== '') query.difficultyMax = Number(difficultyMax);
    if (difficultySort === DIFFICULTY_SORT_ASC || difficultySort === DIFFICULTY_SORT_DESC) {
      query.sort = 'difficulty';
      query.order = difficultySort === DIFFICULTY_SORT_ASC ? 'asc' : 'desc';
    }
    return query;
  }, [difficultyMin, difficultyMax, difficultySort]);

  const { problems, loading, error } = useProblems(null, true, difficultyQuery);

  // Coming back from a problem detail page restores the previous scroll spot.
  useScrollRestore(!loading && !error);

  // A problem can carry several categories; it counts toward every one of its
  // tabs (and toward the "Uncategorized" tab when it has none).
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const problem of problems) {
      const keys = problem.categories?.length ? problem.categories : [UNCATEGORIZED];
      for (const key of keys) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    // Sort by frequency then name so the busiest categories lead.
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [problems]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return problems.filter(problem => {
      const keys = problem.categories?.length ? problem.categories : [UNCATEGORIZED];
      const matchesCategory = activeCategory === ALL_CATEGORIES
        || keys.includes(activeCategory);
      if (!matchesCategory) return false;
      if (!query) return true;
      return problem.title.toLowerCase().includes(query)
        || problem.id.toLowerCase().includes(query);
    });
  }, [problems, activeCategory, search]);

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

      {problems.length > 0 && (
        <div className={styles['category-tabs']} role="tablist" aria-label="Problem categories">
          <button
            role="tab"
            aria-selected={activeCategory === ALL_CATEGORIES}
            className={`${styles['category-tab']} ${activeCategory === ALL_CATEGORIES ? styles.active : ''}`}
            onClick={() => setActiveCategory(ALL_CATEGORIES)}
          >
            {ALL_CATEGORIES} <span className={styles['category-count']}>{problems.length}</span>
          </button>
          {categories.map(([name, count]) => (
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
        </div>
      )}

      {filtered.length > 0 ? (
        <div className={styles['problem-list']}>
          {filtered.map(problem => (
            <ProblemCard key={problem.id} problem={problem} />
          ))}
        </div>
      ) : (
        <div className={styles['no-problems-container']}>
          <div className={styles['no-problems-icon']}>📂</div>
          <div className={styles['no-problems-title']}>Problem not available.</div>
          <div className={styles['no-problems-subtext']}>
            {problems.length > 0
              ? 'No problems match the current filter.'
              : 'Check back later or try refreshing the page.'}
          </div>
        </div>
      )}
    </div>
  );
};

export default Problems;

import { useMemo, useState } from 'react';
import styles from './Problems.module.css';
import { useProblems } from '../../hooks/useProblems';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import ProblemCard from '../../features/problem/ProblemCard';

import LoadingPage from '../../components/shared/LoadingPage';

type Problem = {
  id: string;
  title: string;
  author: string | null;
  category?: string | null;
  submission_count?: string | null;
  latest_submission_at?: string | null;
  best_score?: number | null;
  latest_submission_status?: string | null;
  best_submission_status?: string | null;
  best_submission_results?: unknown;
};

const ALL_CATEGORIES = 'All';
const UNCATEGORIZED = 'Uncategorized';

const Problems = () => {
  const { problems, loading, error } = useProblems();
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES);
  const [search, setSearch] = useState('');

  // Coming back from a problem detail page restores the previous scroll spot.
  useScrollRestore(!loading && !error);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const problem of problems as Problem[]) {
      const key = problem.category?.trim() || UNCATEGORIZED;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // Sort by frequency then name so the busiest categories lead.
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [problems]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (problems as Problem[]).filter(problem => {
      const matchesCategory = activeCategory === ALL_CATEGORIES
        || (problem.category?.trim() || UNCATEGORIZED) === activeCategory;
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

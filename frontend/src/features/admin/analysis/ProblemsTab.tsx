import { useEffect, useRef, useState } from 'react';
import {
  exportAnalyticsCsv,
  fetchAnalyticsProblems,
  ProblemListRow,
  ProblemSortKey,
  SortDir,
} from '../../../services/analyticsService';
import SortableHeader from './components/SortableHeader';
import styles from './ProblemsTab.module.css';
import actionStyles from './AnalysisButtons.module.css';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

interface ProblemsTabProps {
  onSelectProblem: (problemId: string) => void;
}

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

const ProblemsTab = ({ onSelectProblem }: ProblemsTabProps) => {
  const [problems, setProblems] = useState<ProblemListRow[]>([]);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState<ProblemSortKey>('submissions');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchAnalyticsProblems({
          search: search || undefined,
          limit: PAGE_SIZE,
          offset,
          sortBy,
          sortDir,
        });
        if (!cancelled) setProblems(result.problems);
      } catch {
        if (!cancelled) setError('Failed to load problems. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [search, offset, sortBy, sortDir]);

  const handleSearchChange = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setOffset(0);
      setSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleSort = (column: string) => {
    const key = column as ProblemSortKey;
    setOffset(0);
    if (sortBy === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('desc');
    }
  };

  if (error) return <p className={styles.error}>{error}</p>;
  if (loading && problems.length === 0) return <p className={styles.loading}>Loading problems…</p>;

  return (
    <div className={styles.container}>
      <div className={styles['toolbar-row']}>
        <input
          type="text"
          className={styles.search}
          placeholder="Search problems…"
          aria-label="Search problems"
          onChange={(e) => handleSearchChange(e.target.value)}
        />
        <button
          type="button"
          className={styles['export-button']}
          onClick={() => void exportAnalyticsCsv('problems', { search, sortBy, sortDir })}
        >
          Export CSV
        </button>
      </div>

      <div className={styles['table-card']}>
        <table>
          <thead>
            <tr>
              <SortableHeader label="Problem" column="title" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Category" column="category" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Submissions" column="submissions" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Accepted" column="accepted" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="AC rate" column="acRate" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Solvers" column="solvers" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <th />
            </tr>
          </thead>
          <tbody>
            {problems.map((problem) => (
              <tr key={problem.problemId}>
                <td>{problem.title}</td>
                <td>{problem.categories?.length ? problem.categories.join(", ") : "—"}</td>
                <td>{problem.submissions}</td>
                <td>{problem.accepted}</td>
                <td>{formatPercent(problem.acRate)}</td>
                <td>{problem.solvers}</td>
                <td>
                  <button
                    type="button"
                    className={actionStyles['action-button']}
                    onClick={() => onSelectProblem(problem.problemId)}
                  >
                    Analyze {problem.title}
                  </button>
                </td>
              </tr>
            ))}
            {problems.length === 0 && (
              <tr><td colSpan={7} className={styles.empty}>No problems found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.pagination}>
        <button
          type="button"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          Prev
        </button>
        <span>{offset + 1}–{offset + problems.length}</span>
        <button
          type="button"
          disabled={problems.length < PAGE_SIZE}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default ProblemsTab;

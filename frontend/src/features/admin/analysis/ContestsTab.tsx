import { useEffect, useMemo, useState } from 'react';
import { Contest } from '../../../types';
import contestsAdminService from '../../../services/admin/contestsAdminService';
import SortableHeader from './components/SortableHeader';
import styles from './ContestsTab.module.css';

type ContestSortKey = 'title' | 'status' | 'start_time' | 'end_time' | 'participant_count';
type SortDir = 'asc' | 'desc';

interface ContestsTabProps {
  onSelectContest: (contestId: number) => void;
}

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString();

const ContestsTab = ({ onSelectContest }: ContestsTabProps) => {
  const [contests, setContests] = useState<Contest[]>([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<ContestSortKey>('start_time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const result = await contestsAdminService.getContests();
        if (!cancelled) setContests(result);
      } catch {
        if (!cancelled) setError('Failed to load contests. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, []);

  const handleSort = (column: string) => {
    const key = column as ContestSortKey;
    if (sortBy === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('desc');
    }
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? contests.filter(
          (c) => c.title.toLowerCase().includes(term) || c.status.toLowerCase().includes(term),
        )
      : contests;
    const factor = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = String(a[sortBy] ?? '');
      const bv = String(b[sortBy] ?? '');
      return av.localeCompare(bv, undefined, { numeric: true }) * factor;
    });
  }, [contests, search, sortBy, sortDir]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (loading) return <p className={styles.loading}>Loading contests…</p>;

  return (
    <div className={styles.container}>
      <input
        type="text"
        className={styles.search}
        placeholder="Search contests…"
        aria-label="Search contests"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className={styles['table-card']}>
        <table>
          <thead>
            <tr>
              <SortableHeader label="Contest" column="title" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Status" column="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Start" column="start_time" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="End" column="end_time" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Participants" column="participant_count" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((contest) => (
              <tr key={contest.id}>
                <td>{contest.title}</td>
                <td>{contest.status}</td>
                <td>{formatDate(contest.start_time)}</td>
                <td>{formatDate(contest.end_time)}</td>
                <td>{contest.participant_count ?? '—'}</td>
                <td>
                  <button
                    type="button"
                    className={styles['analyze-button']}
                    onClick={() => onSelectContest(contest.id)}
                  >
                    Analyze {contest.title}
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={6} className={styles.empty}>No contests found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ContestsTab;

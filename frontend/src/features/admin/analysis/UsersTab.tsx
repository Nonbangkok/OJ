import { useEffect, useRef, useState } from 'react';
import {
  AnalyticsUserRow,
  exportAnalyticsCsv,
  fetchAnalyticsUsers,
  SortDir,
  UserSortKey,
} from '../../../services/analyticsService';
import SortableHeader from './components/SortableHeader';
import styles from './UsersTab.module.css';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

interface UsersTabProps {
  onSelectUser: (userId: number) => void;
}

const formatAcRate = (rate: number): string => `${Math.round(rate * 100)}%`;

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
};

const UsersTab = ({ onSelectUser }: UsersTabProps) => {
  const [users, setUsers] = useState<AnalyticsUserRow[]>([]);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState<UserSortKey>('submissions');
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
        const result = await fetchAnalyticsUsers({
          search: search || undefined,
          limit: PAGE_SIZE,
          offset,
          sortBy,
          sortDir,
        });
        if (!cancelled) setUsers(result.users);
      } catch {
        if (!cancelled) setError('Failed to load users. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [search, offset, sortBy, sortDir]);

  // Debounce typing so we do not fire a request per keystroke.
  const handleSearchChange = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setOffset(0);
      setSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleSort = (column: string) => {
    const key = column as UserSortKey;
    setOffset(0);
    if (sortBy === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('desc');
    }
  };

  if (error) return <p className={styles.error}>{error}</p>;
  if (loading && users.length === 0) return <p className={styles.loading}>Loading users…</p>;

  return (
    <div className={styles.container}>
      <div className={styles['toolbar-row']}>
        <input
          type="text"
          className={styles.search}
          placeholder="Search users…"
          aria-label="Search users"
          onChange={(e) => handleSearchChange(e.target.value)}
        />
        <button
          type="button"
          className={styles['export-button']}
          onClick={() => void exportAnalyticsCsv('users', { search, sortBy, sortDir })}
        >
          Export CSV
        </button>
      </div>

      <div className={styles['table-card']}>
        <table>
          <thead>
            <tr>
              <SortableHeader label="Username" column="username" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <th>Role</th>
              <SortableHeader label="Submissions" column="submissions" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Solved" column="solved" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="AC rate" column="acRate" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Last active" column="lastActive" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.userId}>
                <td>{user.username}</td>
                <td>{user.role}</td>
                <td>{user.submissions}</td>
                <td>{user.solved}</td>
                <td>{formatAcRate(user.acRate)}</td>
                <td>{formatDate(user.lastActive)}</td>
                <td>
                  <button
                    type="button"
                    className={styles['view-button']}
                    onClick={() => onSelectUser(user.userId)}
                  >
                    View {user.username}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={7} className={styles.empty}>No users found.</td></tr>
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
        <span>{offset + 1}–{offset + users.length}</span>
        <button
          type="button"
          disabled={users.length < PAGE_SIZE}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default UsersTab;

import { useEffect, useState } from 'react';
import {
  AnalyticsUserRow,
  exportAnalyticsCsv,
  fetchAnalyticsUsers,
  fetchRetentionAnalytics,
  RetentionAnalytics,
  SortDir,
  UserSortKey,
} from '../../../services/analyticsService';
import SortableHeader from './components/SortableHeader';
import styles from './UsersTab.module.css';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

interface UsersTabProps {
  onSelectUser: (userId: number) => void;
  onCompareUsers: (userIds: [number, number]) => void;
}

const formatAcRate = (rate: number): string => `${Math.round(rate * 100)}%`;

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
};

const UsersTab = ({ onSelectUser, onCompareUsers }: UsersTabProps) => {
  const [retention, setRetention] = useState<RetentionAnalytics | null>(null);
  const [compareSelection, setCompareSelection] = useState<number[]>([]);
  const [users, setUsers] = useState<AnalyticsUserRow[]>([]);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState<UserSortKey>('submissions');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Retention summary is supplementary — never block the main list on it.
    fetchRetentionAnalytics()
      .then((data) => { if (!cancelled) setRetention(data); })
      .catch(() => { if (!cancelled) setRetention(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchAnalyticsUsers({
          search: debouncedSearch || undefined,
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
  }, [debouncedSearch, offset, sortBy, sortDir]);

  const toggleCompare = (userId: number): void => {
    setCompareSelection((current) => {
      if (current.includes(userId)) {
        return current.filter((id) => id !== userId);
      }
      // Keep at most two: replace the older pick.
      return [...current, userId].slice(-2);
    });
  };

  // Debounce typing so we do not fire a request per keystroke.
  const handleSearchChange = (value: string) => {
    setOffset(0);
    setSearch(value);
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

  return (
    <div className={styles.container}>
      <div className={styles['toolbar-row']}>
        <input
          type="text"
          className={styles.search}
          placeholder="Search users…"
          aria-label="Search users"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
        <button
          type="button"
          className={styles['export-button']}
          onClick={() => void exportAnalyticsCsv('users', { search, sortBy, sortDir })}
        >
          Export CSV
        </button>
        {compareSelection.length === 2 && (
          <button
            type="button"
            className={styles['export-button']}
            onClick={() => onCompareUsers([compareSelection[0], compareSelection[1]])}
          >
            Compare selected
          </button>
        )}
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {loading && <p className={styles.loading} role="status">Loading users…</p>}

      {retention && (
        <div className={styles['retention-card']} aria-label="Retention summary">
          <strong>{retention.activeUsers}</strong> active ·{' '}
          <strong>{retention.idleUsers.length}</strong> idle 30+ days ·{' '}
          <strong>{retention.neverSubmitted.length}</strong> registered but never submitted
        </div>
      )}

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
              <th>Compare</th>
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
                  <input
                    type="checkbox"
                    aria-label={`Compare ${user.username}`}
                    checked={compareSelection.includes(user.userId)}
                    onChange={() => toggleCompare(user.userId)}
                  />
                </td>
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
            {users.length === 0 && !loading && !error && (
              <tr><td colSpan={7} className={styles.empty}>No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.pagination}>
        <button
          type="button"
          disabled={offset === 0 || loading}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          Prev
        </button>
        <span>{offset + 1}–{offset + users.length}</span>
        <button
          type="button"
          disabled={loading || users.length < PAGE_SIZE}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default UsersTab;

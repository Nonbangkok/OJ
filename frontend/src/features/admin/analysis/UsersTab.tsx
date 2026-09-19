import { useEffect, useRef, useState } from 'react';
import { AnalyticsUserRow, fetchAnalyticsUsers } from '../../../services/analyticsService';
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
  }, [search, offset]);

  // Debounce typing so we do not fire a request per keystroke.
  const handleSearchChange = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setOffset(0);
      setSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  if (error) return <p className={styles.error}>{error}</p>;
  if (loading && users.length === 0) return <p className={styles.loading}>Loading users…</p>;

  return (
    <div className={styles.container}>
      <input
        type="text"
        className={styles.search}
        placeholder="Search users…"
        aria-label="Search users"
        onChange={(e) => handleSearchChange(e.target.value)}
      />

      <div className={styles['table-card']}>
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Submissions</th>
              <th>Solved</th>
              <th>AC rate</th>
              <th>Last active</th>
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

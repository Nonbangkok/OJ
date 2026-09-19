import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AnalyticsUserRow,
  fetchAnalyticsProblems,
  fetchAnalyticsSubmissions,
  fetchAnalyticsUsers,
  ProblemListRow,
  SubmissionListRow,
} from '../../../services/analyticsService';
import VerdictBadge from './components/VerdictBadge';
import styles from './SubmissionsTab.module.css';

const PAGE_SIZE = 50;
const VERDICT_OPTIONS = [
  '',
  'Accepted',
  'Wrong Answer',
  'Time Limit Exceeded',
  'Memory Limit Exceeded',
  'Runtime Error',
  'Compilation Error',
  'System Error',
];

interface SubmissionsTabProps {
  onSelectUser: (userId: number) => void;
  onSelectProblem: (problemId: string) => void;
}

const formatDateTime = (iso: string): string => new Date(iso).toLocaleString();

const formatMs = (ms: number | null): string => (ms === null ? '—' : `${ms} ms`);
const formatKb = (kb: number | null): string => (kb === null ? '—' : `${Math.round(kb / 1024)} MB`);

const SubmissionsTab = ({ onSelectUser, onSelectProblem }: SubmissionsTabProps) => {
  const [submissions, setSubmissions] = useState<SubmissionListRow[]>([]);
  const [problems, setProblems] = useState<ProblemListRow[]>([]);
  const [users, setUsers] = useState<AnalyticsUserRow[]>([]);
  const [problemId, setProblemId] = useState('');
  const [userId, setUserId] = useState('');
  const [verdict, setVerdict] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load picker options once (first page of each list is plenty).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [problemsResult, usersResult] = await Promise.all([
          fetchAnalyticsProblems({ limit: 100, sortBy: 'title', sortDir: 'asc' }),
          fetchAnalyticsUsers({ limit: 100, sortBy: 'username', sortDir: 'asc' }),
        ]);
        if (!cancelled) {
          setProblems(problemsResult.problems);
          setUsers(usersResult.users);
        }
      } catch {
        // Pickers stay empty; the main table still works without them.
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  // Refetch whenever a filter or the page changes.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchAnalyticsSubmissions({
          problemId: problemId || undefined,
          userId: userId ? Number(userId) : undefined,
          verdict: verdict || undefined,
          limit: PAGE_SIZE,
          offset,
        });
        if (!cancelled) setSubmissions(result.submissions);
      } catch {
        if (!cancelled) setError('Failed to load submissions. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [problemId, userId, verdict, offset]);

  const changeFilter = (setter: (value: string) => void) => (value: string) => {
    setOffset(0);
    setter(value);
  };

  if (error) return <p className={styles.error}>{error}</p>;
  if (loading && submissions.length === 0) return <p className={styles.loading}>Loading submissions…</p>;

  return (
    <div className={styles.container}>
      <div className={styles.filters} role="group" aria-label="Submission filters">
        <label className={styles.filter}>
          Problem
          <select
            value={problemId}
            onChange={(e) => changeFilter(setProblemId)(e.target.value)}
            aria-label="Filter by problem"
          >
            <option value="">All problems</option>
            {problems.map((p) => (
              <option key={p.problemId} value={p.problemId}>{p.title}</option>
            ))}
          </select>
        </label>

        <label className={styles.filter}>
          User
          <select
            value={userId}
            onChange={(e) => changeFilter(setUserId)(e.target.value)}
            aria-label="Filter by user"
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.userId} value={u.userId}>{u.username}</option>
            ))}
          </select>
        </label>

        <label className={styles.filter}>
          Verdict
          <select
            value={verdict}
            onChange={(e) => changeFilter(setVerdict)(e.target.value)}
            aria-label="Filter by verdict"
          >
            {VERDICT_OPTIONS.map((option) => (
              <option key={option} value={option}>{option === '' ? 'All verdicts' : option}</option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles['table-card']}>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Problem</th>
              <th>Source</th>
              <th>Verdict</th>
              <th>Score</th>
              <th>Time</th>
              <th>Memory</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => (
              <tr key={`${s.source}-${s.id}`}>
                <td>{formatDateTime(s.submittedAt)}</td>
                <td>
                  <Link to={`/profile/${s.username}`}>{s.username}</Link>
                </td>
                <td>{s.problemTitle}</td>
                <td>{s.source}</td>
                <td><VerdictBadge verdict={s.verdict} /></td>
                <td>{s.score}</td>
                <td>{formatMs(s.timeMs)}</td>
                <td>{formatKb(s.memoryKb)}</td>
                <td className={styles.actions}>
                  <button
                    type="button"
                    className={styles['link-button']}
                    onClick={() => onSelectUser(s.userId)}
                  >
                    User
                  </button>
                  <button
                    type="button"
                    className={styles['link-button']}
                    onClick={() => onSelectProblem(s.problemId)}
                  >
                    Problem
                  </button>
                </td>
              </tr>
            ))}
            {submissions.length === 0 && (
              <tr><td colSpan={9} className={styles.empty}>No submissions match these filters.</td></tr>
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
        <span>{offset + 1}–{offset + submissions.length}</span>
        <button
          type="button"
          disabled={submissions.length < PAGE_SIZE}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default SubmissionsTab;

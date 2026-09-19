import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchAnalyticsSubmissions,
  SubmissionListRow,
} from '../../../services/analyticsService';
import submissionService from '../../../services/submissionService';
import { useAutocomplete } from '../../../hooks/useAutocomplete';
import type { SubmissionDetail } from '../../../types';
import SubmissionModal from '../../problem/submission/SubmissionModal';
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
  const [verdict, setVerdict] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionDetail | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Typed filter with autocomplete suggestions, same pattern as the main
  // submissions page (useAutocomplete + submissionService.search*).
  const [selectedProblem, setSelectedProblem] = useState<{ id: string; title: string } | null>(null);
  const [selectedUser, setSelectedUser] = useState<{ id: number; username: string } | null>(null);
  const problemAutocomplete = useAutocomplete(submissionService.searchProblems);
  const userAutocomplete = useAutocomplete(submissionService.searchUsers);
  const problemInputRef = useRef<HTMLDivElement>(null);
  const userInputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (problemInputRef.current && !problemInputRef.current.contains(event.target as Node)) {
        problemAutocomplete.setShowSuggestions(false);
      }
      if (userInputRef.current && !userInputRef.current.contains(event.target as Node)) {
        userAutocomplete.setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [problemAutocomplete, userAutocomplete]);

  // Refetch whenever a filter or the page changes.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchAnalyticsSubmissions({
          problemId: selectedProblem?.id,
          userId: selectedUser?.id,
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
  }, [selectedProblem, selectedUser, verdict, offset]);

  const selectProblem = (problem: { id: string; title: string }) => {
    setSelectedProblem(problem);
    problemAutocomplete.select(problem.id);
  };

  const clearProblem = () => {
    setSelectedProblem(null);
    problemAutocomplete.setQuery('');
  };

  const selectUser = (user: { id: number; username: string }) => {
    setSelectedUser(user);
    userAutocomplete.select(user.username);
  };

  const clearUser = () => {
    setSelectedUser(null);
    userAutocomplete.setQuery('');
  };

  // Same flow as the main submissions page: fetch the full detail (with code)
  // and open the shared read-only modal.
  const handleViewCode = async (submission: SubmissionListRow) => {
    try {
      const data = await submissionService.getById(submission.id, submission.contestId);
      setSelectedSubmission(data);
      setIsModalOpen(true);
    } catch {
      setError(`Failed to fetch submission #${submission.id}.`);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedSubmission(null);
  };

  if (error) return <p className={styles.error}>{error}</p>;
  if (loading && submissions.length === 0) return <p className={styles.loading}>Loading submissions…</p>;

  return (
    <div className={styles.container}>
      <div className={styles.filters} role="group" aria-label="Submission filters">
        <div className={styles['filter-wrapper']} ref={problemInputRef}>
          <input
            type="text"
            className={styles['filter-input']}
            placeholder="Filter by problem"
            aria-label="Filter by problem"
            value={problemAutocomplete.query}
            onChange={problemAutocomplete.handleChange}
            onFocus={() => problemAutocomplete.query && problemAutocomplete.setShowSuggestions(true)}
          />
          {selectedProblem && (
            <button type="button" className={styles['clear-button']} onClick={clearProblem} aria-label="Clear problem filter">×</button>
          )}
          {problemAutocomplete.showSuggestions && problemAutocomplete.suggestions.length > 0 && (
            <ul className={styles['suggestions-list']}>
              {problemAutocomplete.suggestions.map((p: { id: string; title: string }) => (
                <li key={p.id} onClick={() => selectProblem(p)}>{p.id} — {p.title}</li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles['filter-wrapper']} ref={userInputRef}>
          <input
            type="text"
            className={styles['filter-input']}
            placeholder="Filter by user"
            aria-label="Filter by user"
            value={userAutocomplete.query}
            onChange={userAutocomplete.handleChange}
            onFocus={() => userAutocomplete.query && userAutocomplete.setShowSuggestions(true)}
          />
          {selectedUser && (
            <button type="button" className={styles['clear-button']} onClick={clearUser} aria-label="Clear user filter">×</button>
          )}
          {userAutocomplete.showSuggestions && userAutocomplete.suggestions.length > 0 && (
            <ul className={styles['suggestions-list']}>
              {userAutocomplete.suggestions.map((u: { id: number; username: string }) => (
                <li key={u.username} onClick={() => selectUser(u)}>{u.username}</li>
              ))}
            </ul>
          )}
        </div>

        <select
          className={styles['filter-select']}
          value={verdict}
          onChange={(e) => { setOffset(0); setVerdict(e.target.value); }}
          aria-label="Filter by verdict"
        >
          {VERDICT_OPTIONS.map((option) => (
            <option key={option} value={option}>{option === '' ? 'All verdicts' : option}</option>
          ))}
        </select>
      </div>

      <div className={styles['table-card']}>
        <div className={styles['table-scroll']}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Problem</th>
                <th>Verdict</th>
                <th>Score</th>
                <th>Time</th>
                <th>Memory</th>
                <th>Code</th>
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
                  <td><VerdictBadge verdict={s.verdict} /></td>
                  <td>{s.score}</td>
                  <td>{formatMs(s.timeMs)}</td>
                  <td>{formatKb(s.memoryKb)}</td>
                  <td>
                    <button
                      type="button"
                      className={styles['link-button']}
                      onClick={() => handleViewCode(s)}
                    >
                      View
                    </button>
                  </td>
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

      {isModalOpen && (
        <SubmissionModal submission={selectedSubmission} onClose={handleCloseModal} />
      )}
    </div>
  );
};

export default SubmissionsTab;

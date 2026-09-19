import { useEffect, useState } from 'react';
import { Contest } from '../../../types';
import contestsAdminService from '../../../services/admin/contestsAdminService';
import styles from './ContestsTab.module.css';

interface ContestsTabProps {
  onSelectContest: (contestId: number) => void;
}

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString();

const ContestsTab = ({ onSelectContest }: ContestsTabProps) => {
  const [contests, setContests] = useState<Contest[]>([]);
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

  if (error) return <p className={styles.error}>{error}</p>;
  if (loading) return <p className={styles.loading}>Loading contests…</p>;

  return (
    <div className={styles['table-card']}>
      <table>
        <thead>
          <tr>
            <th>Contest</th>
            <th>Status</th>
            <th>Start</th>
            <th>End</th>
            <th>Participants</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {contests.map((contest) => (
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
          {contests.length === 0 && (
            <tr><td colSpan={6} className={styles.empty}>No contests found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default ContestsTab;

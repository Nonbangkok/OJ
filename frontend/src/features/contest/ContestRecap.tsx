import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { InlineError, PageHeader, StatusBadge, TestcaseStrip } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import contestService from '../../services/contestService';
import type { Contest, ContestProblemScore, ContestScoreboardEntry } from '../../types';
import { formatWindow } from './format';
import { problemLetter } from './letters';
import styles from './ContestStates.module.css';

const FULL = 100;

/** Snapshots from before B9 store a bare number or { score } per problem. */
const scoreOf = (raw: number | ContestProblemScore | undefined): ContestProblemScore | null => {
  if (raw === undefined) return null;
  return typeof raw === 'number' ? { score: raw } : raw;
};

/** Finished contest (§7.7): the viewer's result, per-problem outcomes, and the final scoreboard. Open to everyone. */
export default function ContestRecap({ contest }: { contest: Contest }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<ContestScoreboardEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    contestService.getScoreboard(contest.id)
      .then((data) => { if (!cancelled) setRows(data.scoreboard); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [contest.id]);

  const problems = contest.problems ?? [];
  const mine = rows?.find((row) => row.username === user?.username) ?? null;
  const results = problems.map((p) => scoreOf(mine?.detailed_scores[p.id]));
  const solved = results.filter((r) => r?.score === FULL).length;

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={[{ label: 'Contests', to: '/contests' }, { label: contest.title }]}
        title={<>{contest.title} <StatusBadge>FINAL</StatusBadge></>}
        meta={<span className={styles.mono}>{`${formatWindow(contest.start_time, contest.end_time)} · ${Number(contest.participant_count ?? 0)} joined`}</span>}
        actions={<Link to={`/contests/${contest.id}/scoreboard`} className={styles.primaryLink}>Scoreboard</Link>}
      />
      {failed && <InlineError message="Couldn't load the results." />}

      {mine && rows && (
        <ul className={styles.recap} aria-label="Your result">
          <li><span>Your final rank</span><b>{`#${mine.rank ?? '—'}`}</b><em>{`of ${rows.length}`}</em></li>
          <li><span>Points</span><b>{mine.total_score}</b><em>{`/ ${problems.length * FULL}`}</em></li>
          <li><span>Solved</span><b>{solved}</b><em>{`of ${problems.length}`}</em></li>
        </ul>
      )}

      <table className={styles.table} aria-label="Problems">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Problem</th>
            {mine && <><th scope="col" className={styles.bestCol}>Your best</th><th scope="col" className={styles.right}>Score</th><th scope="col" className={styles.right}>Tries</th></>}
          </tr>
        </thead>
        <tbody>
          {problems.map((problem, i) => {
            const result = results[i];
            return (
              <tr key={problem.id}>
                <td className={styles.letter}>{problemLetter(i)}</td>
                <td>
                  <Link to={`/problems/${problem.id}`} className={styles.problemLink}>{problem.title}</Link>
                  {mine && result?.statuses && result.statuses.length > 0 && (
                    <span className={`${styles.phoneStrip} ${styles.phoneStripFlush}`} aria-hidden="true"><TestcaseStrip results={result.statuses.map((status) => ({ status }))} /></span>
                  )}
                </td>
                {mine && (
                  <>
                    <td className={styles.bestCol}>{result?.statuses && result.statuses.length > 0
                      ? <TestcaseStrip results={result.statuses.map((status) => ({ status }))} />
                      : <span className={styles.muted}>—</span>}
                    </td>
                    <td className={`${styles.right} ${styles.mono} ${result?.score === FULL ? styles.full : ''}`}>{result ? result.score : '—'}</td>
                    <td className={`${styles.right} ${styles.mono} ${styles.muted}`}>{result?.attempts ?? '—'}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles.sub}>Problems are back in the practice set — open one to keep working on it.</p>
    </div>
  );
}

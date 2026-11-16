import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import useContestScoreboard, { scoreCell } from '../../hooks/useContestScoreboard';
import UserAvatar from '../../components/user/UserAvatar';
import LoadingPage from '../../components/shared/LoadingPage';
import { EmptyState, InlineError, PageHeader, StatusBadge } from '../../components/ui';
import { formatRemaining } from '../../components/shell/useCountdown';
import { useAuth } from '../../context/AuthContext';
import { problemLetter } from '../../features/contest/letters';
import type { ContestScoreboardEntry } from '../../types';
import styles from './ContestScoreboard.module.css';

const FULL = 100;

const toneOf = (score: number): 'full' | 'zero' | undefined => {
  if (score >= FULL) return 'full';
  if (score <= 0) return 'zero';
  return undefined;
};

/** Seconds since the last refresh, re-rendered every second. */
function useSecondsSince(at: Date | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return at ? Math.max(0, Math.round((now - at.getTime()) / 1000)) : null;
}

/** "last hh:mm:ss" after the start; only rows whose cells say when each best was reached (B9). */
const lastLine = (row: ContestScoreboardEntry, startTime: string | null): string | null => {
  if (!startTime || !row.last_score_improvement_time || row.total_score <= 0) return null;
  const hasTimes = Object.values(row.detailed_scores ?? {}).some((raw) => Boolean(scoreCell(raw)?.best_at));
  if (!hasTimes) return null;
  return `last ${formatRemaining(new Date(row.last_score_improvement_time).getTime() - new Date(startTime).getTime())}`;
};

/** Contest scoreboard (§7.7, key-pages §3). */
const ContestScoreboard = () => {
  const { contestId = '' } = useParams();
  const { user } = useAuth();
  const { scoreboard, problems, loading, error, lastUpdate, connected, status, startTime } = useContestScoreboard(contestId);
  const seconds = useSecondsSince(lastUpdate);
  const viewerRow = useRef<HTMLTableRowElement | null>(null);
  const [viewerOffScreen, setViewerOffScreen] = useState(false);
  const viewer = scoreboard.find((row) => row.username === user?.username) ?? null;

  useEffect(() => {
    const node = viewerRow.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => setViewerOffScreen(!entries[0]?.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, [viewer?.username, scoreboard.length]);

  if (loading && scoreboard.length === 0) return <LoadingPage />;

  const live = status === 'running' || status === 'finishing';
  const meta = (
    <span className={styles.meta}>
      {connected && live && <span className={styles.liveDot} aria-label="Live updates on" role="img" />}
      {seconds !== null && <span>{`updated ${seconds}s ago`}</span>}
    </span>
  );

  return (
    <div className={styles.page}>
      <PageHeader
        title={<>Scoreboard {live ? <StatusBadge tone="success">LIVE</StatusBadge> : status === 'finished' ? <StatusBadge>FINAL</StatusBadge> : null}</>}
        meta={meta}
      />
      {error && <InlineError message={error} />}
      {!error && scoreboard.length === 0 && <EmptyState title="No one joined this contest." />}
      {scoreboard.length > 0 && (
      <div className={styles.scroll}>
        <table className={styles.table} aria-label="Scoreboard">
          <thead>
            <tr>
              <th scope="col" className={`${styles.rank} ${styles.sticky}`}>Rank</th>
              <th scope="col" className={`${styles.who} ${styles.sticky}`}>Participant</th>
              <th scope="col" className={`${styles.total} ${styles.sticky}`}>Total</th>
              {problems.map((problem, i) => {
                const id = String(problem.problem_id ?? problem.id);
                return (
                  <th scope="col" key={id} className={styles.cellHead}>
                    <Link to={`/contests/${contestId}/problems/${id}`} aria-label={`${problemLetter(i)}: ${problem.title}`} title={problem.title}>
                      {problemLetter(i)}
                    </Link>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {scoreboard.map((row) => {
              const isViewer = row.username === user?.username;
              const last = lastLine(row, startTime);
              return (
                <tr key={row.username} ref={isViewer ? viewerRow : undefined} data-viewer={isViewer ? 'true' : undefined}>
                  <td className={`${styles.rank} ${styles.sticky}`}>{row.rank ?? ''}</td>
                  <td className={`${styles.who} ${styles.sticky}`}>
                    <span className={styles.user}>
                      <UserAvatar username={row.username} hasAvatar={Boolean(row.has_avatar)} size={22} />
                      <Link to={`/profile/${row.username}`}>{row.username}</Link>
                    </span>
                  </td>
                  <td className={`${styles.total} ${styles.sticky}`}>
                    <b>{row.total_score}</b>
                    {last && <span className={styles.last}>{last}</span>}
                  </td>
                  {problems.map((problem) => {
                    const id = String(problem.problem_id ?? problem.id);
                    const cell = scoreCell(row.detailed_scores?.[id]);
                    if (!cell) return <td key={id} className={`${styles.cell} ${styles.untried}`}>—</td>;
                    return (
                      <td key={id} className={styles.cell} data-tone={toneOf(cell.score)}>
                        <span>{cell.score}</span>
                        {cell.attempts !== undefined && (
                          <span className={styles.tries}>{`${cell.attempts} ${cell.attempts === 1 ? 'try' : 'tries'}`}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      {viewer && viewerOffScreen && (
        <section className={styles.pin} aria-label="Your rank">
          <span>{`You · #${viewer.rank ?? '—'}`}</span>
          <b>{viewer.total_score}</b>
        </section>
      )}
    </div>
  );
};

export default ContestScoreboard;

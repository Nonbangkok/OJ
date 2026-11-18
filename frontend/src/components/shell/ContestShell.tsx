import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Circle, ListChecks, PaperPlaneTilt, Ranking, Timer, X } from '@phosphor-icons/react';
import contestService from '../../services/contestService';
import { subscribeSubmissions } from '../../services/realtimeService';
import { MOBILE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import type { Contest, ProblemSummary } from '../../types';
import { useContest } from '../../features/contest/ContestContext';
import { problemLetter } from '../../features/contest/letters';
import { HeaderProblemBadge } from '../../features/contest/HeaderProblemBadge';
import { useCountdown } from './useCountdown';
import AccountMenu from './AccountMenu';
import styles from './ContestShell.module.css';

const POLL_MS = 30_000;
const IN_PROGRESS = new Set(['Pending', 'Compiling', 'Running']);

export { useContestShellReload } from '../../features/contest/ContestContext';

export { problemLetter } from '../../features/contest/letters';

function ContestClock({ contest, compact = false }: { contest: Contest; compact?: boolean }) {
  const target = contest.status === 'running' ? contest.end_time : contest.status === 'scheduled' ? contest.start_time : null;
  const { label } = useCountdown(target);
  const text = contest.status === 'finishing' ? 'Judging' : contest.status === 'finished' ? 'Ended' : label;
  if (compact) return <span className={styles.compactClock}>{text}</span>;
  return (
    <div className={styles.clock}>
      <Timer size={16} aria-hidden="true" />
      {contest.status === 'scheduled' && <span className={styles.clockLabel}>Starts in</span>}
      <span className={styles.clockValue}>{text}</span>
      {contest.status === 'running' && <span className={styles.liveTag}>Live</span>}
    </div>
  );
}

function ProblemRow({ contestId, problem, index }: { contestId: string; problem: ProblemSummary; index: number }) {
  const attempts = Number(problem.submission_count ?? 0);
  const best = problem.best_score ?? null;
  const attempted = attempts > 0 && best !== null;
  const status = !attempted ? 'none' : Number(best) >= 100 ? 'ok' : 'bad';
  const Icon = status === 'ok' ? Check : status === 'bad' ? X : Circle;
  return (
    <NavLink to={`/contests/${contestId}/problems/${problem.id}`} className={styles.problem}>
      <span className={styles.letter}>{problemLetter(index)}</span>
      <Icon size={14} weight={status === 'none' ? 'regular' : 'bold'} className={styles[status]} aria-hidden="true" />
      <span className={styles.problemName}>
        <span className={styles.problemTitle}>{problem.title}</span>
        <HeaderProblemBadge problem={problem} compact />
      </span>
      {attempted && <span className={styles.score}>{best}</span>}
    </NavLink>
  );
}

/**
 * The contest sidebar (§6): only for a participant while the contest runs or
 * finishes — ContestLayout decides, and supplies the contest.
 */
export default function ContestShell() {
  const { contestId = '' } = useParams();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const { contest } = useContest();
  const [problems, setProblems] = useState<ProblemSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadProblems = () => {
      contestService.getProblems(contestId)
        .then((data) => { if (!cancelled) setProblems(data as ProblemSummary[]); })
        .catch(() => { /* the page under the shell reports load errors */ });
    };
    loadProblems();
    let poll: number | undefined;
    const unsubscribe = subscribeSubmissions(
      // Only final verdicts change a score; skip Pending/Compiling/Running pings.
      (update) => { if (update.table === 'contest_submissions' && !IN_PROGRESS.has(update.overall_status)) loadProblems(); },
      { onStreamDown: () => { poll = window.setInterval(loadProblems, POLL_MS); } },
    );
    return () => {
      cancelled = true;
      unsubscribe();
      if (poll !== undefined) window.clearInterval(poll);
    };
  }, [contestId, contest?.status]);

  const points = problems.reduce((sum, p) => sum + Number(p.best_score ?? 0), 0);

  if (isMobile) {
    return (
      <div className={styles.mobile}>
        <header className={styles.topbar}>
          <Link to="/contests" className={styles.back} aria-label="Back to contests"><ArrowLeft size={18} aria-hidden="true" /></Link>
          <span className={styles.topTitle}>{contest?.title}</span>
          {contest && <ContestClock contest={contest} compact />}
        </header>
        <main className={styles.main}><div className="container"><Outlet /></div></main>
        <nav aria-label="Contest" className={styles.tabbar}>
          <NavLink to={`/contests/${contestId}/problems`} className={styles.tab}><ListChecks size={20} aria-hidden="true" />Problems</NavLink>
          <NavLink to={`/contests/${contestId}/submissions`} className={styles.tab}><PaperPlaneTilt size={20} aria-hidden="true" />Mine</NavLink>
          <NavLink to={`/contests/${contestId}/scoreboard`} className={styles.tab}><Ranking size={20} aria-hidden="true" />Scoreboard</NavLink>
        </nav>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <nav aria-label="Contest" className={styles.nav}>
          <Link to="/contests" className={styles.leave}><ArrowLeft size={14} aria-hidden="true" />Leave contest view</Link>
          {contest && (
            <>
              <NavLink to={`/contests/${contestId}`} end className={styles.title}>{contest.title}</NavLink>
              <ContestClock contest={contest} />
            </>
          )}
          <div className={styles.problems}>
            {problems.map((problem, index) => (
              <ProblemRow key={problem.id} contestId={contestId} problem={problem} index={index} />
            ))}
          </div>
          <div className={styles.links}>
            <NavLink to={`/contests/${contestId}/problems`} end className={styles.link}>
              <ListChecks size={17} aria-hidden="true" />Problems
            </NavLink>
            <NavLink to={`/contests/${contestId}/submissions`} className={styles.link}>
              <PaperPlaneTilt size={17} aria-hidden="true" />My submissions
            </NavLink>
            <NavLink to={`/contests/${contestId}/scoreboard`} className={styles.link}>
              <Ranking size={17} aria-hidden="true" />Scoreboard
            </NavLink>
          </div>
        </nav>
        <div className={styles.total}><span>Your points</span><b>{points}</b></div>
        <div className={styles.footer}><AccountMenu /></div>
      </aside>
      <main className={styles.main}><div className="container"><Outlet /></div></main>
    </div>
  );
}

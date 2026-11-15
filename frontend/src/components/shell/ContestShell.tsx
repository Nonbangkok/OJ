import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Circle, ListChecks, PaperPlaneTilt, Ranking, Timer, X } from '@phosphor-icons/react';
import contestService from '../../services/contestService';
import { subscribeSubmissions } from '../../services/realtimeService';
import { MOBILE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import type { Contest, ProblemSummary } from '../../types';
import { useCountdown } from './useCountdown';
import AccountMenu from './AccountMenu';
import styles from './ContestShell.module.css';

const POLL_MS = 30_000;
const IN_PROGRESS = new Set(['Pending', 'Compiling', 'Running']);

const ContestShellReloadContext = createContext<() => void>(() => undefined);

/** Pages inside a contest call this after changing contest state (e.g. joining) so the sidebar refreshes. */
export const useContestShellReload = (): (() => void) => useContext(ContestShellReloadContext);

/** 0 → A … 25 → Z, 26 → AA. */
export function problemLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

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
      <span className={styles.problemTitle}>{problem.title}</span>
      {attempted && <span className={styles.score}>{best}</span>}
    </NavLink>
  );
}

export default function ContestShell() {
  const { contestId = '' } = useParams();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [contest, setContest] = useState<Contest | null>(null);
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    contestService.getById(contestId)
      .then((data) => { if (!cancelled) setContest(data); })
      .catch(() => { /* the page under the shell reports load errors */ });
    const loadProblems = () => {
      contestService.getProblems(contestId)
        .then((data) => { if (!cancelled) setProblems(data as ProblemSummary[]); })
        .catch(() => { /* hidden or not started: keep the list empty */ });
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
  }, [contestId, version]);

  // Reload at the next transition (start or end) so the sidebar never sits on 00:00:00.
  const transition = contest?.status === 'scheduled' ? contest.start_time : contest?.status === 'running' ? contest.end_time : null;
  useEffect(() => {
    if (!transition) return undefined;
    const delay = new Date(transition).getTime() - Date.now() + 1000;
    if (delay <= 0) return undefined;
    const timer = window.setTimeout(reload, delay);
    return () => window.clearTimeout(timer);
  }, [transition, reload]);

  const finished = contest?.status === 'finished';
  const showProblems = Boolean(contest) && !finished;
  const showMine = Boolean(contest?.is_participant) && !finished;

  if (isMobile) {
    return (
      <ContestShellReloadContext.Provider value={reload}>
      <div className={styles.mobile}>
        <header className={styles.topbar}>
          <Link to="/contests" className={styles.back} aria-label="Back to contests"><ArrowLeft size={18} aria-hidden="true" /></Link>
          <span className={styles.topTitle}>{contest?.title}</span>
          {contest && <ContestClock contest={contest} compact />}
        </header>
        <main className={styles.main}><div className="container"><Outlet /></div></main>
        <nav aria-label="Contest" className={styles.tabbar}>
          {!finished && <NavLink to={`/contests/${contestId}/problems`} className={styles.tab}><ListChecks size={20} aria-hidden="true" />Problems</NavLink>}
          {showMine && <NavLink to={`/contests/${contestId}/submissions`} className={styles.tab}><PaperPlaneTilt size={20} aria-hidden="true" />Mine</NavLink>}
          <NavLink to={`/contests/${contestId}/scoreboard`} className={styles.tab}><Ranking size={20} aria-hidden="true" />Scoreboard</NavLink>
        </nav>
      </div>
      </ContestShellReloadContext.Provider>
    );
  }

  return (
    <ContestShellReloadContext.Provider value={reload}>
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
          {showProblems && (
            <div className={styles.problems}>
              {problems.map((problem, index) => (
                <ProblemRow key={problem.id} contestId={contestId} problem={problem} index={index} />
              ))}
            </div>
          )}
          <div className={styles.links}>
            {!finished && (
              <NavLink to={`/contests/${contestId}/problems`} end className={styles.link}>
                <ListChecks size={17} aria-hidden="true" />Problems
              </NavLink>
            )}
            {showMine && (
              <NavLink to={`/contests/${contestId}/submissions`} className={styles.link}>
                <PaperPlaneTilt size={17} aria-hidden="true" />My submissions
              </NavLink>
            )}
            <NavLink to={`/contests/${contestId}/scoreboard`} className={styles.link}>
              <Ranking size={17} aria-hidden="true" />Scoreboard
            </NavLink>
          </div>
        </nav>
        <div className={styles.footer}><AccountMenu /></div>
      </aside>
      <main className={styles.main}><div className="container"><Outlet /></div></main>
    </div>
    </ContestShellReloadContext.Provider>
  );
}

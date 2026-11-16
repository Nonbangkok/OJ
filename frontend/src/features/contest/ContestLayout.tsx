import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import AppShell from '../../components/shell/AppShell';
import ContestShell from '../../components/shell/ContestShell';
import { InlineError } from '../../components/ui';
import LoadingPage from '../../components/shared/LoadingPage';
import contestService from '../../services/contestService';
import type { Contest } from '../../types';
import { ContestContext, inContestShell } from './ContestContext';

const TRANSITION_SLACK_MS = 1000;
/** While the server lags the clock (the scheduler ticks once a minute), re-ask this often. */
const PENDING_POLL_MS = 5000;
/**
 * The start/end timers run on this computer's clock, which can be minutes off on a lab PC.
 * While a contest is scheduled or running, also re-ask the server this often so the page
 * follows the server's state whatever the local clock says.
 */
const SERVER_CHECK_MS = 30_000;

/** Past a start or end the server hasn't caught up with yet, or judging the last submissions. */
const awaitingServer = (contest: Contest, now: number): boolean =>
  contest.status === 'finishing'
  || (contest.status === 'scheduled' && now >= new Date(contest.start_time).getTime())
  || (contest.status === 'running' && now >= new Date(contest.end_time).getTime());

/**
 * Route element for `/contests/:id/*`: loads the contest once, shares it with
 * the pages below, and picks the shell — ContestShell for a participant while
 * the contest runs or finishes, the normal AppShell otherwise.
 */
export default function ContestLayout() {
  const { contestId = '' } = useParams();
  const [contest, setContest] = useState<Contest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    contestService.getById(contestId)
      .then((data) => {
        if (cancelled) return;
        // Keep the same object when nothing changed, so pages keyed on the contest do not refetch.
        setContest((previous) => (previous && JSON.stringify(previous) === JSON.stringify(data) ? previous : data));
        setError(null);
      })
      .catch((err: { response?: { status?: number } }) => {
        if (cancelled) return;
        setError(err.response?.status === 404 ? 'Contest not found.' : "Couldn't load this contest.");
      });
    return () => { cancelled = true; };
  }, [contestId, version]);

  // Reload at the next transition (start or end) so no page sits on 00:00:00.
  const transition = contest?.status === 'scheduled' ? contest.start_time : contest?.status === 'running' ? contest.end_time : null;
  useEffect(() => {
    if (!transition) return undefined;
    const delay = new Date(transition).getTime() - Date.now() + TRANSITION_SLACK_MS;
    if (delay <= 0) return undefined;
    const timer = window.setTimeout(reload, delay);
    return () => window.clearTimeout(timer);
  }, [transition, reload]);

  // Keep asking until the server settles, so a tab left open moves from the
  // lobby into the contest, and from the last minute into the recap.
  useEffect(() => {
    if (!contest || !awaitingServer(contest, Date.now())) return undefined;
    const timer = window.setTimeout(reload, PENDING_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [contest, reload]);

  const steady = contest?.status === 'scheduled' || contest?.status === 'running';
  useEffect(() => {
    if (!steady) return undefined;
    const timer = window.setInterval(reload, SERVER_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [steady, reload]);

  const value = useMemo(() => ({ contest, error, reload }), [contest, error, reload]);

  let content;
  if (contest && inContestShell(contest)) {
    content = <ContestShell />;
  } else {
    content = (
      <AppShell>
        <div className="container">
          {error ? <InlineError message={error} /> : contest ? <Outlet /> : <LoadingPage />}
        </div>
      </AppShell>
    );
  }
  return <ContestContext.Provider value={value}>{content}</ContestContext.Provider>;
}

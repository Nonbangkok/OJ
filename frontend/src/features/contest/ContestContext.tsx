import { createContext, useContext } from 'react';
import type { Contest } from '../../types';

export interface ContestContextValue {
  contest: Contest | null;
  error: string | null;
  /** Re-fetch the contest (after joining, or when its clock crosses start/end). */
  reload: () => void;
}

const noop = () => undefined;
export const ContestContext = createContext<ContestContextValue>({ contest: null, error: null, reload: noop });

/** The contest loaded once by ContestLayout for every page under `/contests/:id`. */
export const useContest = (): ContestContextValue => useContext(ContestContext);

/** Pages call this after changing contest state (e.g. joining) so the shell refreshes. */
export const useContestShellReload = (): (() => void) => useContest().reload;

/** ContestShell is for a participant while the contest is running or finishing (§6, §7.7). */
export const inContestShell = (contest: Contest): boolean =>
  Boolean(contest.is_participant) && (contest.status === 'running' || contest.status === 'finishing');

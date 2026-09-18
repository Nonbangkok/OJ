import contestService from '../services/contestService';
import type { Contest } from '../types';

export type ContestFetchOutcome =
  | { kind: 'loaded'; contest: Contest }
  | { kind: 'finished'; contest: Contest; redirectPath: string }
  | { kind: 'forbidden'; contest: Contest | null; redirectPath: string | null }
  | { kind: 'not-found' }
  | { kind: 'error' };

/**
 * Shared core for contest status fetching. Performs one `getById` call and
 * classifies the outcome, including the finished-contest redirect target.
 *
 * `previousStatus` powers the guard's "contest finished while the user got a
 * 403" re-check: when the immediate fetch is forbidden but the cached status
 * says the contest already finished, a `finished` outcome to /contests is
 * returned instead of a bare 403.
 */
export const fetchContestOutcome = async (
  contestId: string,
  options?: { previousStatus?: string | null }
): Promise<ContestFetchOutcome> => {
  let fetchedContest: Contest;
  try {
    fetchedContest = await contestService.getById(contestId);
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 403) {
      if (options?.previousStatus === 'finished') {
        return { kind: 'forbidden', contest: null, redirectPath: '/contests' };
      }
      return { kind: 'forbidden', contest: null, redirectPath: null };
    }
    if (status === 404) {
      return { kind: 'not-found' };
    }
    return { kind: 'error' };
  }

  if (fetchedContest.status === 'finished') {
    const redirectPath = fetchedContest.is_participant
      ? `/contests/${contestId}/scoreboard`
      : '/contests';
    return { kind: 'finished', contest: fetchedContest, redirectPath };
  }

  return { kind: 'loaded', contest: fetchedContest };
};

/** Redirect path for a finished contest (participant → scoreboard, else list). */
export const finishedContestRedirectPath = (contestId: string, isParticipant: boolean): string =>
  isParticipant ? `/contests/${contestId}/scoreboard` : '/contests';

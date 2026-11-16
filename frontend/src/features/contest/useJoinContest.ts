import { useState } from 'react';
import contestService from '../../services/contestService';
import { useContest } from './ContestContext';

/** Joins the current contest and refreshes it; the server's refusal reads inline. */
export function useJoinContest(contestId: number | string) {
  const { reload } = useContest();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async (): Promise<boolean> => {
    setJoining(true);
    setError(null);
    try {
      await contestService.join(contestId);
      reload();
      return true;
    } catch (err) {
      setError((err as { response?: { data?: { message?: string } } }).response?.data?.message ?? "Couldn't join this contest.");
      return false;
    } finally {
      setJoining(false);
    }
  };

  return { join, joining, error };
}

import { Navigate } from 'react-router-dom';
import ContestRecap from '../../features/contest/ContestRecap';
import ContestJoinGate from '../../features/contest/ContestJoinGate';
import ContestLobby from '../../features/contest/ContestLobby';
import { useContest } from '../../features/contest/ContestContext';
import { useAuth } from '../../context/AuthContext';

/**
 * `/contests/:id` follows the contest's state (§7.7): the lobby before the
 * start, the join gate for a running contest the viewer hasn't joined, the
 * problem table for participants, and the recap once it has finished.
 */
const ContestDetail = () => {
  const { contest } = useContest();
  const { user } = useAuth();
  if (!contest) return null;
  // Staff watch a contest without joining it (§7.7); they get the problem table.
  const isStaff = user?.role === 'admin' || user?.role === 'staff';

  if (contest.status === 'scheduled') return <ContestLobby contest={contest} />;
  if (contest.status === 'running' && !contest.is_participant && !isStaff) return <ContestJoinGate contest={contest} />;
  if (contest.status === 'running' || contest.status === 'finishing') return <Navigate to="problems" replace />;

  return <ContestRecap contest={contest} />;
};

export default ContestDetail;

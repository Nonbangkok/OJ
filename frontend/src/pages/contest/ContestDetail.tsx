import { Link, Navigate } from 'react-router-dom';
import { PageHeader, StatusBadge } from '../../components/ui';
import ContestJoinGate from '../../features/contest/ContestJoinGate';
import ContestLobby from '../../features/contest/ContestLobby';
import { useContest } from '../../features/contest/ContestContext';

/**
 * `/contests/:id` follows the contest's state (§7.7): the lobby before the
 * start, the join gate for a running contest the viewer hasn't joined, the
 * problem table for participants, and the recap once it has finished.
 */
const ContestDetail = () => {
  const { contest } = useContest();
  if (!contest) return null;

  if (contest.status === 'scheduled') return <ContestLobby contest={contest} />;
  if (contest.status === 'running' && !contest.is_participant) return <ContestJoinGate contest={contest} />;
  if (contest.status === 'running' || contest.status === 'finishing') return <Navigate to="problems" replace />;

  return (
    <PageHeader
      breadcrumb={[{ label: 'Contests', to: '/contests' }, { label: contest.title }]}
      title={<>{contest.title} <StatusBadge>FINAL</StatusBadge></>}
      actions={<Link to="scoreboard">Scoreboard</Link>}
    />
  );
};

export default ContestDetail;

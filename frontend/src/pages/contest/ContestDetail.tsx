import { Link, Navigate } from 'react-router-dom';
import { InlineNotice, PageHeader, StatusBadge } from '../../components/ui';
import ContestRecap from '../../features/contest/ContestRecap';
import ContestJoinGate from '../../features/contest/ContestJoinGate';
import ContestLobby from '../../features/contest/ContestLobby';
import { useContest } from '../../features/contest/ContestContext';
import { useAuth } from '../../context/AuthContext';
import { formatWindow } from '../../features/contest/format';
import styles from '../../features/contest/ContestStates.module.css';

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
  if (contest.status === 'running') return <Navigate to="problems" replace />;
  if (contest.status === 'finishing') {
    // The problem table only takes participants and staff; anyone else waits here for the recap.
    if (contest.is_participant || isStaff) return <Navigate to="problems" replace />;
    return (
      <div className={styles.page}>
        <PageHeader
          breadcrumb={[{ label: 'Contests', to: '/contests' }, { label: contest.title }]}
          title={<>{contest.title} <StatusBadge>FINISHING</StatusBadge></>}
          meta={<span className={styles.mono}>{formatWindow(contest.start_time, contest.end_time)}</span>}
          actions={<Link to={`/contests/${contest.id}/scoreboard`} className={styles.primaryLink}>Scoreboard</Link>}
        />
        <div role="status">
          <InlineNotice title="Judging final submissions…">Results and the final scoreboard appear when the last submission is judged.</InlineNotice>
        </div>
      </div>
    );
  }

  return <ContestRecap contest={contest} />;
};

export default ContestDetail;

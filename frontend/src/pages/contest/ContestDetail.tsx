import { Link } from 'react-router-dom';
import styles from './ContestDetail.module.css';
import shared from '../../components/styles/ContestPages.module.css';
import { formatDateTime, getRemainingTime } from '../../utils/formatters';
import StatusBadge from '../../components/shared/StatusBadge';
import useContestDetail from '../../hooks/useContestDetail';
import LoadingPage from '../../components/shared/LoadingPage';

const ContestDetail = () => {
  const {
    contest,
    loading,
    error,
    joining,
    handleJoinContest
  } = useContestDetail();

  if (loading) return <LoadingPage />;

  if (error || !contest) {
    return (
      <div className={shared.error}>
        <h3 className={shared.errorTitle}>{error || 'Contest not found'}</h3>
        <Link to="/contests" className={shared.backLink}>
          ← Back to Contests
        </Link>
      </div>
    );
  }

  const problemCount = contest.problems?.length ?? 0;
  const showJoin = !contest.is_participant && contest.status !== 'finished';

  return (
    <div className={styles.container}>
      {/* Primary: title + status. The navbar already identifies the contest;
         this page only needs the identity once, as typography. */}
      <div className={styles.header}>
        <h1 className={styles.title}>{contest.title}</h1>
        <StatusBadge status={contest.status} />
      </div>

      {contest.description && (
        <p className={styles.description}>{contest.description}</p>
      )}

      {/* Secondary: one compact summary line instead of stat cards. */}
      <p className={styles.metaLine}>
        <span>
          {formatDateTime(contest.start_time)} → {formatDateTime(contest.end_time)}
        </span>
        <span className={styles.metaSeparator} aria-hidden="true">·</span>
        {contest.status === 'running' && (
          <>
            <span className={styles.remaining}>{getRemainingTime(contest.end_time)}</span>
            <span className={styles.metaSeparator} aria-hidden="true">·</span>
          </>
        )}
        <span>
          {contest.participant_count || 0} participant{Number(contest.participant_count) === 1 ? '' : 's'}
        </span>
        {problemCount > 0 && (
          <>
            <span className={styles.metaSeparator} aria-hidden="true">·</span>
            <span>{problemCount} problem{problemCount === 1 ? '' : 's'}</span>
          </>
        )}
      </p>

      {/* Action: one primary action, no giant buttons. */}
      {showJoin ? (
        <button onClick={handleJoinContest} disabled={joining} className={styles.joinButton}>
          {joining ? 'Joining...' : 'Join Contest'}
        </button>
      ) : contest.status === 'running' ? (
        <Link to={`/contests/${contest.id}/problems`} className={styles.primaryAction}>
          View Problems
        </Link>
      ) : contest.status === 'scheduled' && contest.is_participant ? (
        <p className={styles.waitingNote}>
          You are registered. The contest starts {formatDateTime(contest.start_time)} — check back then.
        </p>
      ) : (
        <Link to={`/contests/${contest.id}/scoreboard`} className={styles.primaryAction}>
          View Scoreboard
        </Link>
      )}
    </div>
  );
}

export default ContestDetail;

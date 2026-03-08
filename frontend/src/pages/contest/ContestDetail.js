import { Link } from 'react-router-dom';
import styles from './ContestDetail.module.css';
import { formatDateTime, getRemainingTime } from '../../utils/formatters';
import StatusBadge from '../../components/shared/StatusBadge';
import useContestDetail from '../../hooks/useContestDetail';

const ContestDetail = () => {
  const {
    contest,
    loading,
    error,
    joining,
    handleJoinContest
  } = useContestDetail();

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading contest data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <h3>Error: {error}</h3>
          <Link to="/contests" className={styles.backLink}>
            ← Back to Contests
          </Link>
        </div>
      </div>
    );
  }

  if (!contest) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <h3>Contest not found</h3>
          <Link to="/contests" className={styles.backLink}>
            ← Back to Contests
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Contest Header */}
      <div className={styles.contestHeader}>

        <div className={styles.titleSection}>
          <h1 className={styles.contestTitle}>{contest.title}</h1>
          <StatusBadge status={contest.status} />
        </div>

        {contest.description && (
          <p className={styles.contestDescription}>{contest.description}</p>
        )}
      </div>

      {/* Contest Info */}
      <div className={styles.contestInfo}>
        <div className={styles.infoGrid}>
          <div className={styles.infoCard}>
            <div className={styles.infoLabel}>Start Time</div>
            <div className={styles.infoValue}>
              {formatDateTime(contest.start_time)}
            </div>
          </div>

          <div className={styles.infoCard}>
            <div className={styles.infoLabel}>End Time</div>
            <div className={styles.infoValue}>{formatDateTime(contest.end_time)}</div>
          </div>

          {contest.status === 'running' && (
            <div className={styles.infoCard}>
              <div className={styles.infoLabel}>Time Remaining</div>
              <div className={`${styles.infoValue} ${styles.timeRemaining}`}>
                {getRemainingTime(contest.end_time)}
              </div>
            </div>
          )}

          <div className={styles.infoCard}>
            <div className={styles.infoLabel}>Participants</div>
            <div className={styles.infoValue}>
              {contest.participant_count || 0} people
            </div>
          </div>
        </div>
      </div>

      {/* Join/Waiting Section */}
      {!contest.is_participant && contest.status !== 'finished' && (
        <div className={styles.joinSection}>
          <button onClick={handleJoinContest} disabled={joining} className={styles.joinButton}>
            {joining ? 'Joining...' : 'Join Contest'}
          </button>
        </div>
      )}

      {contest.status === 'scheduled' && contest.is_participant && (
        <div className={styles.waitingMessage}>
          <div className={styles.waitingIcon}>⏳</div>
          <h3>Waiting for contest to start</h3>
          <p>The contest will start on {formatDateTime(contest.start_time)}</p>
          <p>You have registered to participate. Please check back when the contest begins.</p>
        </div>
      )}

    </div>
  );
}

export default ContestDetail; 
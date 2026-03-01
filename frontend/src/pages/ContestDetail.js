import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import styles from './ContestDetail.module.css';
import contestService from '../services/contestService';
import { formatDateTime, getRemainingTime } from '../utils/formatters';

const ContestDetail = () => {
  const { contestId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [contest, setContest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    fetchContestData();

    const intervalId = setInterval(() => {
      fetchContestData();
    }, 15000); // Poll every 15 seconds

    return () => clearInterval(intervalId);
  }, [contestId, user]); // Add user to dependency array to re-fetch if login status changes

  const fetchContestData = async () => {
    try {
      setLoading(true);

      const fetchedContest = await contestService.getById(contestId);
      setContest(fetchedContest);

      // Redirect logic
      if (fetchedContest.status === 'finished') {
        let redirectPath = '';

        if (fetchedContest.is_participant) {
          redirectPath = `/contests/${contestId}/scoreboard`;
        } else {
          redirectPath = '/contests';
        }
        navigate(redirectPath);
      }

    } catch (err) {
      console.error('Error fetching contest data:', err);
      if (err.response?.status === 403) {
        setError('You need to join this contest to view its details.');
        // If user is not participant and contest is finished, redirect to /contests
        if (contest?.status === 'finished') { // Use optional chaining to prevent error if contest is null
          navigate('/contests');
        }
      } else if (err.response?.status === 404) {
        setError('Contest not found.');
      } else {
        setError('Failed to load contest data.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleJoinContest = async () => {
    setJoining(true);
    try {
      await contestService.join(contestId);
      // Refresh contest data
      fetchContestData();
    } catch (err) {
      console.error('Error joining contest:', err);
      alert(err.response?.data?.message || 'Failed to join contest');
    } finally {
      setJoining(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusClasses = {
      'scheduled': `${styles.badge} ${styles.scheduled}`,
      'running': `${styles.badge} ${styles.running}`,
      'finishing': `${styles.badge} ${styles.finishing}`,
      'finished': `${styles.badge} ${styles.finished}`
    };

    const statusText = {
      'scheduled': 'Scheduled',
      'running': 'Running',
      'finishing': 'Finishing',
      'finished': 'Finished'
    };

    return (
      <span className={statusClasses[status] || styles.badge}>
        {statusText[status] || status}
      </span>
    );
  };



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
          {getStatusBadge(contest.status)}
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
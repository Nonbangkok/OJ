import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import styles from './Contests.module.css';

const API_URL = process.env.REACT_APP_API_URL;

function Contests() {
  const [contests, setContests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user } = useAuth();

  useEffect(() => {
    fetchContests();
  }, []);

  const fetchContests = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/contests`, {
        withCredentials: true
      });
      setContests(response.data);
    } catch (err) {
      console.error('Error fetching contests:', err);
      setError('Failed to load contests');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinContest = async (contestId) => {
    try {
      await axios.post(`${API_URL}/contests/${contestId}/join`, {}, {
        withCredentials: true
      });
      setError('');
      // Refresh contests to update join status
      fetchContests();
    } catch (err) {
      console.error('Error joining contest:', err);
      setError(err.response?.data?.message || 'Failed to join contest');
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

  const formatDateTime = (dateTime) => {
    return new Date(dateTime).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isContestJoinable = (contest) => {
    if (!user) return false;
    
    const now = new Date();
    const endTime = new Date(contest.end_time);
    
    // Can join until contest ends
    return now < endTime;
  };

  const isContestViewable = (contest, isParticipant) => {
    return contest.status === 'running' && isParticipant;
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading contests...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <h3>Error: {error}</h3>
          <Link to="/" className={styles.backLink}>
            ← Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Contests</h1>
      </div>

      {error && (
        <div className={styles.error}>
          ⚠️ {error}
        </div>
      )}

      {contests.length === 0 ? (
        <div className={styles.noContests}>
          <div className={styles.noContestsIcon}>🏅</div>
          <h3>No contests available at the moment</h3>
          <p>Please check back later for new contests</p>
        </div>
      ) : (
        <div className={styles.contestGrid}>
          {contests.map(contest => (
            <div key={contest.id} className={styles.contestCard}>
              <div className={styles.contestHeader}>
                <h3 className={styles.contestTitle}>{contest.title}</h3>
                {getStatusBadge(contest.status)}
              </div>
              
              {contest.description && (
                <p className={styles.contestDescription}>{contest.description}</p>
              )}
              
              <div className={styles.contestTiming}>
                <div className={styles.timeInfo}>
                  <span className={styles.timeLabel}>Start:</span>
                  <span className={styles.timeValue}>{formatDateTime(contest.start_time)}</span>
                </div>
                <div className={styles.timeInfo}>
                  <span className={styles.timeLabel}>End:</span>
                  <span className={styles.timeValue}>{formatDateTime(contest.end_time)}</span>
                </div>
              </div>

              <div className={styles.contestStats}>
                <span className={styles.stat}>Participants: {contest.participant_count || 0}</span>
                <span className={styles.stat}>Problems: {contest.problem_count || 0}</span>
              </div>

              <div className={styles.contestActions}>
                {/* Join Contest Button */}
                {isContestJoinable(contest) && !contest.is_participant && (
                  <button 
                    className={`${styles.actionBtn} ${styles.joinBtn}`}
                    onClick={() => handleJoinContest(contest.id)}
                  >
                    Join Contest
                  </button>
                )}

                {/* Already Joined - Show for all active contests */}
                {contest.is_participant && contest.status === 'scheduled' && (
                  <span className={styles.joinedStatus}>
                    You are registered
                  </span>
                )}

                {/* Enter Contest (Running) */}
                {isContestViewable(contest, contest.is_participant) && (
                  <Link 
                    to={`/contests/${contest.id}`}
                    className={`${styles.actionBtn} ${styles.enterBtn}`}
                  >
                    Enter Contest
                  </Link>
                )}

                {/* View Scoreboard */}
                {contest.status === 'finished' && (
                  <Link 
                    to={`/contests/${contest.id}/scoreboard`}
                    className={`${styles.actionBtn} ${styles.scoreboardBtn}`}
                  >
                    View Results
                  </Link>
                )}

                {/* Login Required */}
                {!user && isContestJoinable(contest) && (
                  <Link 
                    to="/login"
                    className={`${styles.actionBtn} ${styles.loginBtn}`}
                  >
                    🔑 Login to Join
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Contests; 
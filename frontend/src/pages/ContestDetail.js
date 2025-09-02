import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import styles from './ContestDetail.module.css';

const API_URL = process.env.REACT_APP_API_URL;

function ContestDetail() {
  const { contestId } = useParams();
  
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [contest, setContest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    fetchContestData();
  }, [contestId]);

  const fetchContestData = async () => {
    try {
      setLoading(true);
      
      const contestResponse = await axios.get(`${API_URL}/contests/${contestId}`, {
        withCredentials: true
      });
      
      setContest(contestResponse.data);
    } catch (err) {
      console.error('Error fetching contest data:', err);
      if (err.response?.status === 403) {
        setError('You need to join this contest to view its details.');
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
      await axios.post(`${API_URL}/contests/${contestId}/join`, {}, {
        withCredentials: true
      });
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

  const formatDateTime = (dateTime) => {
    return new Date(dateTime).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getRemainingTime = (endTime) => {
    const now = new Date();
    const end = new Date(endTime);
    const diff = end - now;
    
    if (diff <= 0) return 'Finished';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m remaining`;
    } else {
      return `${minutes}m remaining`;
    }
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
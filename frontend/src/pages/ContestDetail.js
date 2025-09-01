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
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    fetchContestData();
  }, [contestId]);

  const fetchContestData = async () => {
    try {
      setLoading(true);
      
      // Fetch contest details and problems in parallel
      const [contestResponse, problemsResponse] = await Promise.all([
        axios.get(`${API_URL}/contests/${contestId}`, {
          withCredentials: true
        }),
        axios.get(`${API_URL}/contests/${contestId}/problems`, {
          withCredentials: true
        })
      ]);
      
      setContest(contestResponse.data);
      setProblems(problemsResponse.data);
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

  const canAccessProblem = (contest) => {
    return (contest.status === 'running' || contest.status === 'finishing') && contest.is_participant;
  };

  const isContestOpenForRegistration = (contest) => {
    const now = new Date();
    const endTime = new Date(contest.end_time);
    return now < endTime;
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
        <div className={styles.headerTop}>
          <Link to="/contests" className={styles.backLink}>
            ← All Contests
          </Link>
          <Link to={`/contests/${contestId}/scoreboard`} className={styles.scoreboardLink}>
            View Rankings
          </Link>
        </div>
        
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
            <div className={styles.infoLabel}>🏁 End Time</div>
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

      {/* Problems Section */}
      <div className={styles.problemsSection}>
        <div className={styles.sectionHeader}>
          <h2>Contest Problems</h2>
          <span className={styles.problemCount}>
            {problems.length} problems
          </span>
        </div>

        {problems.length === 0 ? (
          <div className={styles.noProblems}>
            <div className={styles.noProblemsIcon}>📚</div>
            <p>No problems in this contest yet</p>
          </div>
        ) : (
          <div className={styles.problemsList}>
            {problems.map((problem, index) => (
              <div key={problem.id} className={styles.problemCard}>
                <div className={styles.problemHeader}>
                  <div className={styles.problemNumber}>
                    {String.fromCharCode(65 + index)}
                  </div>
                  <div className={styles.problemInfo}>
                    <h3 className={styles.problemTitle}>{problem.title}</h3>
                    <p className={styles.problemAuthor}>By {problem.author}</p>
                  </div>
                </div>

                <div className={styles.problemStats}>
                  <span className={styles.stat}>
                  Time Limit: {problem.time_limit_ms || 2000}ms
                  </span>
                  <span className={styles.stat}>
                  Memory Limit: {problem.memory_limit_mb || 256}MB
                  </span>
                  {problem.submission_count !== undefined && (
                    <span className={styles.stat}>
                      Submissions: {problem.submission_count}
                    </span>
                  )}
                  {problem.solved_count !== undefined && (
                    <span className={styles.stat}>
                      {problem.solved_count} solved
                    </span>
                  )}
                </div>

                <div className={styles.problemActions}>
                  {canAccessProblem(contest) ? (
                    <Link
                      to={`/contests/${contestId}/problems/${problem.id}`}
                      className={`${styles.actionBtn} ${styles.viewBtn}`}
                    >
                      📖 View Problem
                    </Link>
                  ) : contest.status === 'finished' ? (
                    <Link
                      to={`/problems/${problem.id}`}
                      className={`${styles.actionBtn} ${styles.viewBtn}`}
                    >
                      📖 View Problem
                    </Link>
                  ) : (
                    <span className={styles.lockedBtn}>
                      🔒 Locked
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contest not started yet */}
      {contest.status === 'scheduled' && contest.is_participant && (
        <div className={styles.waitingMessage}>
          <div className={styles.waitingIcon}>⏳</div>
          <h3>Waiting for contest to start</h3>
          <p>The contest will start on {formatDateTime(contest.start_time)}</p>
          <p>You have registered to participate. Please check back when the contest begins.</p>
        </div>
      )}

      {/* Contest running but user not joined */}
      {contest.status === 'running' && !contest.is_participant && (
        <div className={styles.notParticipantMessage}>
          <div className={styles.notParticipantIcon}>⏰</div>
          <h3>Contest is in progress</h3>
          <p>You have not registered for this contest yet</p>
          <p>You can register until the contest ends</p>
          <div className={styles.contestActions}>
            <button 
              className={`${styles.actionBtn} ${styles.joinBtn}`}
              onClick={async () => {
                try {
                  await axios.post(`${API_URL}/contests/${contestId}/join`, {}, {
                    withCredentials: true
                  });
                  // Refresh contest data
                  fetchContestData();
                } catch (err) {
                  console.error('Error joining contest:', err);
                  alert(err.response?.data?.message || 'Failed to join contest');
                }
              }}
            >
              🎯 Join Contest
            </button>
            <Link to="/contests" className={`${styles.actionBtn} ${styles.backBtn}`}>
              ← Back to Contests
            </Link>
          </div>
        </div>
      )}

      {/* Contest running and user is participant */}
      {contest.status === 'running' && contest.is_participant && (
        <div className={styles.participantMessage}>
          <div className={styles.participantIcon}>🎯</div>
          <h3>You have registered for this contest</h3>
          <p>The contest is in progress. You can access problems and submit solutions.</p>
          <div className={styles.contestActions}>
            <Link to={`/contests/${contestId}/scoreboard`} className={`${styles.actionBtn} ${styles.scoreboardBtn}`}>
              📊 View Rankings
            </Link>
          </div>
        </div>
      )}

      {/* Contest finished */}
      {contest.status === 'finished' && (
        <div className={styles.finishedSection}>
          <div className={styles.finishedIcon}>🏆</div>
          <h2>Contest Finished</h2>
          <p>This contest has ended. View the final results and rankings.</p>
          <div className={styles.finishedActions}>
            <Link to={`/contests/${contestId}/scoreboard`} className={styles.scoreboardLink}>
              View Results
            </Link>
          </div>
        </div>
      )}

      {/* Not a participant - Only show for scheduled contests */}
      {!contest.is_participant && contest.status === 'scheduled' && (
        <div className={styles.notParticipantSection}>
          <div className={styles.notParticipantIcon}>👥</div>
          <h2>Not Registered</h2>
          <p>You are not registered for this contest. Register to participate and solve problems.</p>
          {contest.status === 'scheduled' && (
            <button 
              onClick={handleJoinContest}
              disabled={joining}
              className={styles.joinBtn}
            >
              {joining ? 'Joining...' : 'Join Contest'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default ContestDetail; 
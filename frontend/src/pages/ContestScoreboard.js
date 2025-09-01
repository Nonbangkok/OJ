import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import styles from './ContestScoreboard.module.css';

const API_URL = process.env.REACT_APP_API_URL;

function ContestScoreboard() {
  const { contestId } = useParams();
  
  const [contest, setContest] = useState(null);
  const [scoreboard, setScoreboard] = useState([]);
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    fetchContestData();
    
    // Auto-refresh for running contests
    let interval;
    if (contest?.status === 'running') {
      interval = setInterval(fetchScoreboard, 30000); // Refresh every 30 seconds
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [contestId, contest?.status]);

  const fetchContestData = async () => {
    try {
      setLoading(true);
      
      // Fetch contest details and scoreboard in parallel
      const [contestResponse, scoreboardDataResponse] = await Promise.all([
        axios.get(`${API_URL}/contests/${contestId}`, {
          withCredentials: true
        }),
        axios.get(`${API_URL}/contests/${contestId}/scoreboard`, {
          withCredentials: true
        })
      ]);
      
      setContest(contestResponse.data);
      setScoreboard(scoreboardDataResponse.data.scoreboard);
      setProblems(scoreboardDataResponse.data.problems || []);
      setLastUpdate(new Date());

    } catch (err) {
      console.error('Error fetching contest data:', err);
      if (err.response?.status === 404) {
        setError('Contest not found.');
      } else if (err.response?.status === 403) {
        setError('You do not have permission to view this contest scoreboard');
      } else {
        setError('Failed to load contest scoreboard.');
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchScoreboard = async () => {
    try {
      const response = await axios.get(`${API_URL}/contests/${contestId}/scoreboard`, {
        withCredentials: true
      });
      
      // The response will always have scoreboard and problems, but we only need to update the scoreboard on refresh.
      setScoreboard(response.data.scoreboard);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Error refreshing scoreboard:', err);
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
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getProblemScore = (userScores, problemId) => {
    if (!userScores || typeof userScores !== 'object') return null;
    
    const problemScore = userScores[problemId];
    if (!problemScore) return null;
    
    // Handle both old format (just number) and new format (object)
    if (typeof problemScore === 'number') {
      return {
        score: problemScore,
        attempts: 1, // Default to 1 for old format
        solved: problemScore === 100
      };
    }
    
    if (typeof problemScore === 'object') {
      return {
        score: problemScore.score || 0,
        attempts: problemScore.attempts || 1,
        solved: (problemScore.score || 0) === 100
      };
    }
    
    return null;
  };

  const getRankIcon = (rank) => {
    switch(rank) {
      case 1: return '1st';
      case 2: return '2nd';
      case 3: return '3rd';
      default: return `#${rank}`;
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading contest rankings...</div>
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

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <Link to="/contests" className={styles.backLink}>
            ← All Contests
          </Link>
          <Link to={`/contests/${contestId}`} className={styles.contestLink}>
            🏆 View Contest Details
          </Link>
        </div>
        
        <div className={styles.titleSection}>
          <h1 className={styles.title}>Contest Rankings</h1>
          {contest && getStatusBadge(contest.status)}
        </div>
        
        {contest && (
          <h2 className={styles.contestTitle}>{contest.title}</h2>
        )}
      </div>

      {/* Contest Info */}
      {contest && (
        <div className={styles.contestInfo}>
          <div className={styles.infoCards}>
            <div className={styles.infoCard}>
              <span className={styles.infoLabel}>Participants</span>
              <span className={styles.infoValue}>{scoreboard.length} people</span>
            </div>
            <div className={styles.infoCard}>
              <span className={styles.infoLabel}>Problems</span>
              <span className={styles.infoValue}>{problems.length} problems</span>
            </div>
            {lastUpdate && contest.status === 'running' && (
              <div className={styles.infoCard}>
                <span className={styles.infoLabel}>Last Updated</span>
                <span className={styles.infoValue}>{formatDateTime(lastUpdate)}</span>
              </div>
            )}
          </div>
          
          {contest.status === 'running' && (
            <div className={styles.liveIndicator}>
              <span className={styles.liveIcon}>LIVE</span>
              <span>Real-time Updates</span>
            </div>
          )}
        </div>
      )}

      {/* Scoreboard */}
      {scoreboard.length === 0 ? (
        <div className={styles.noData}>
          <div className={styles.noDataIcon}>📊</div>
          <h3>No ranking data yet</h3>
          <p>No participants have submitted solutions in this contest yet</p>
        </div>
      ) : (
        <div className={styles.scoreboardContainer}>
          <div className={styles.tableWrapper}>
            <table className={styles.scoreboardTable}>
              <thead>
                <tr>
                  <th className={styles.rankHeader}>Rank</th>
                  <th className={styles.userHeader}>Participant</th>
                  <th className={styles.scoreHeader}>Total Score</th>
                  {problems.map((problem, index) => (
                    <th key={problem.problem_id} className={styles.problemHeader}>
                      <div className={styles.problemLetter}>
                        {String.fromCharCode(65 + index)}
                      </div>
                      <div className={styles.problemTitle}>
                        {problem.title}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scoreboard.map((participant, index) => {
                  const rank = index + 1;
                  return (
                    <tr key={participant.user_id} className={styles.participantRow}>
                      <td className={styles.rankCell}>
                        <span className={styles.rankValue}>
                          {getRankIcon(rank)}
                        </span>
                      </td>
                      
                      <td className={styles.userCell}>
                        <div className={styles.userInfo}>
                          <span className={styles.username}>
                            {participant.username}
                          </span>
                          {rank <= 3 && (
                            <span className={styles.topRankBadge}>
                              TOP {rank}
                            </span>
                          )}
                        </div>
                      </td>
                      
                      <td className={styles.scoreCell}>
                        <span className={styles.totalScore}>
                          {participant.total_score}
                        </span>
                      </td>
                      
                      {problems.map((problem) => {
                        const problemScore = getProblemScore(
                          participant.detailed_scores, 
                          problem.problem_id
                        );
                        
                        return (
                          <td key={problem.problem_id} className={styles.problemCell}>
                            {problemScore ? (
                              <div className={`${styles.problemScore} ${
                                problemScore.solved ? styles.solved : styles.partial
                              }`}>
                                <span className={styles.score}>
                                  {problemScore.score}
                                </span>
                                {problemScore.attempts > 1 && (
                                  <span className={styles.attempts}>
                                    ({problemScore.attempts})
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className={styles.noAttempt}>-</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default ContestScoreboard; 
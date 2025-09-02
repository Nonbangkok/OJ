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
      <h1>Contest Scoreboard</h1>
      {lastUpdate && (
        <div className={styles.refreshInfo}>
          <p>Last updated: {formatDateTime(lastUpdate)}</p>
        </div>
      )}

      {scoreboard.length === 0 ? (
        <div className={styles.noData}>
          <h3>No ranking data yet</h3>
          <p>No participants have submitted solutions in this contest yet</p>
        </div>
      ) : (
        <div className="table-container">
          <table className={`table ${styles.scoreboardTable}`}>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Participant</th>
                <th>Total Score</th>
                {problems.map((problem) => (
                  <th key={problem.problem_id}>
                    <div className={styles.problemHeader}>
                      <div className={styles.problemId}>{problem.problem_id}</div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scoreboard.map((participant, index) => {
                const rank = index + 1;
                return (
                  <tr key={participant.user_id} className={rank <= 3 ? `rank-${rank}` : ''}>
                    <td>{rank}</td>
                    <td>{participant.username}</td>
                    <td>{participant.total_score}</td>
                    {problems.map((problem) => {
                      const problemScore = getProblemScore(
                        participant.detailed_scores,
                        problem.problem_id
                      );

                      return (
                        <td key={problem.problem_id}>
                          {problemScore ? (
                            <div
                              className={`${styles.problemScore} ${
                                problemScore.solved
                                  ? styles.solved
                                  : problemScore.score > 0
                                  ? styles.partial
                                  : ''
                              }`}
                            >
                              <span className={styles.score}>{problemScore.score}</span>
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
      )}
    </div>
  );
}

export default ContestScoreboard; 
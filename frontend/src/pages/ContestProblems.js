import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link, useParams } from 'react-router-dom';
import styles from './Problems.module.css'; // Re-use the same styles

const API_URL = process.env.REACT_APP_API_URL;

const ContestProblems = () => {
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { contestId } = useParams();

  useEffect(() => {
    const fetchProblems = async () => {
      // This check is redundant now because of the one outside,
      // but it's good practice to keep it.
      if (!contestId) {
        setLoading(false);
        setError('Contest ID is missing, cannot fetch problems.');
        return;
      }
      try {
        const response = await axios.get(`${API_URL}/contests/${contestId}/problems`, {
          withCredentials: true,
        });
        setProblems(response.data);
      } catch (err) {
        setError('Failed to fetch contest problems. You may not have access to this contest.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    
    // We check for contestId here before initiating the fetch.
    if (contestId) {
      fetchProblems();
    } else {
      setLoading(false);
      setError('Contest ID not found in URL.');
    }
  }, [contestId]);

  const formatTimeAgo = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    let interval = seconds / 31536000;
    if (interval > 1) return `${Math.floor(interval)} years ago`;
    interval = seconds / 2592000;
    if (interval > 1) return `${Math.floor(interval)} months ago`;
    interval = seconds / 86400;
    if (interval > 1) return `${Math.floor(interval)} days ago`;
    interval = seconds / 3600;
    if (interval > 1) return `${Math.floor(interval)} hours ago`;
    interval = seconds / 60;
    if (interval > 1) return `${Math.floor(interval)} minutes ago`;
    return `${Math.floor(seconds)} seconds ago`;
  };
  
  const formatDateAbsolute = (dateString) => {
    if (!dateString) return '';
    const d = new Date(dateString);
    const pad = (num) => num.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${(d.getFullYear() + 543) % 100} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const generateResultString = (status, results) => {
    if (status === 'Compilation Error') {
      return 'Compilation Error';
    }
    if (!results || results.length === 0) {
      return '';
    }
    const charMap = {
      'Accepted': 'P',
      'Wrong Answer': '-',
      'Time Limit Exceeded': 'T',
      'Runtime Error': 'R',
      'Memory Limit Exceeded': 'M',
      'Skipped': 'S',
    };
    const resultChars = results.map(r => charMap[r.status] || '?').join('');
    return `[${resultChars}]`;
  };

  // Add a specific check for undefined contestId early on.
  if (!contestId) {
    return <div className="error-message">Error: No Contest ID specified in the URL.</div>;
  }

  if (loading) return <div>Loading problems...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className={styles['problems-page-container']}>
      <h1>Contest Problems</h1>
      <div className={styles['problem-list']}>
        {problems.map(problem => {
          const hasSubmitted = problem.submission_count > 0;

          return (
            <div key={problem.id} className={styles['problem-list-item']}>
              <div className={styles['problem-info']}>
                <h3 className={styles['problem-title']}>{problem.title}</h3>
                <p className={styles['problem-author']}>{problem.id}</p>
                <div className={styles['submission-status-placeholder']}>
                  {hasSubmitted && (
                     <div className={styles['submission-status']}>
                        <span className={styles['submission-time']}>
                            Submitted {formatTimeAgo(problem.latest_submission_at)} ({formatDateAbsolute(problem.latest_submission_at)})
                        </span>
                        <span className={styles['submission-tries']}>
                            {problem.submission_count} {problem.submission_count > 1 ? 'tries' : 'try'}
                        </span>
                     </div>
                  )}
                </div>
              </div>

              <div className={styles['problem-score-placeholder']}>
                {hasSubmitted && (
                  <div className={styles['problem-score-details']}>
                      <div className={styles['score-bar-container']}>
                          <div 
                            className={`${styles['score-bar']} ${problem.best_score === 100 ? styles.full : styles.partial}`} 
                            style={{ width: `${problem.best_score || 0}%` }}
                          >
                              <span>{problem.best_score || 0}</span>
                          </div>
                      </div>
                      <span className={styles['score-text']}>
                          {generateResultString(problem.best_submission_status, problem.best_submission_results)}
                      </span>
                  </div>
                )}
              </div>
              
              <Link to={`/contests/${contestId}/problems/${problem.id}`} className={`${styles['problem-action-btn']} ${hasSubmitted ? styles.edit : styles.new}`}>
                {hasSubmitted ? 'Edit' : 'New'}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ContestProblems; 
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import './Problems.css';
import '../components/Table.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const Problems = () => {
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchProblems = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/problems-with-stats`, {
          withCredentials: true,
        });
        setProblems(response.data);
      } catch (err) {
        setError('Failed to fetch problems. Please log in.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchProblems();
  }, []);

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
      return '[No results]';
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

  if (loading) return <div>Loading problems...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="problems-page-container">
      <h1>All Problems</h1>
      <div className="problem-list">
        {problems.map(problem => {
          const hasSubmitted = problem.submission_count > 0;

          return (
            <div key={problem.id} className="problem-list-item">
              <div className="problem-info">
                <h3 className="problem-title">{problem.title}</h3>
                <p className="problem-author">{problem.id}</p>
                <div className="submission-status-placeholder">
                  {hasSubmitted && (
                     <div className="submission-status">
                        <span className="submission-time">
                            Submitted {formatTimeAgo(problem.latest_submission_at)} ({formatDateAbsolute(problem.latest_submission_at)})
                        </span>
                        <span className="submission-tries">
                            {problem.submission_count} {problem.submission_count > 1 ? 'tries' : 'try'}
                        </span>
                     </div>
                  )}
                </div>
              </div>

              <div className="problem-score-placeholder">
                {hasSubmitted && (
                  <div className="problem-score-details">
                      <div className="score-bar-container">
                          <div 
                            className={`score-bar ${problem.best_score === 100 ? 'full' : 'partial'}`} 
                            style={{ width: `${problem.best_score || 0}%` }}
                          >
                              <span>{problem.best_score || 0}</span>
                          </div>
                      </div>
                      <span className="score-text">
                          {generateResultString(problem.latest_submission_status, problem.latest_submission_results)}
                      </span>
                  </div>
                )}
              </div>
              
              <Link to={`/problems/${problem.id}`} className={`problem-action-btn ${hasSubmitted ? 'edit' : 'new'}`}>
                {hasSubmitted ? 'View' : 'New'}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Problems; 
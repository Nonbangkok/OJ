import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import styles from './Submissions.module.css';
import SubmissionModal from './SubmissionModal';

const API_URL = process.env.REACT_APP_API_URL;

function ContestSubmissions() {
  const { contestId } = useParams();
  const { user } = useAuth();
  
  const [contest, setContest] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' or 'mine'
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchContestData = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/contests/${contestId}`, {
        withCredentials: true
      });
      setContest(response.data);
    } catch (err) {
      console.error('Error fetching contest data:', err);
    }
  }, [contestId]);

  const fetchSubmissions = useCallback(async () => {
    if (submissions.length === 0) {
      setLoading(true);
    }
    
    try {
      const params = {
        contestId: contestId
      };
      
      if (filter === 'mine') {
        params.filter = 'mine';
      }

      const response = await axios.get(`${API_URL}/submissions`, {
        withCredentials: true,
        params,
      });
      
      setSubmissions(response.data);
      setError('');
    } catch (err) {
      setError('Failed to fetch contest submissions. Please make sure you have access to this contest.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [contestId, filter, submissions.length]);

  useEffect(() => {
    fetchContestData();
  }, [fetchContestData]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  // Auto-refresh for processing submissions
  useEffect(() => {
    const isProcessing = submissions.some(sub => 
      ['Pending', 'Compiling', 'Running'].includes(sub.overall_status)
    );

    if (isProcessing) {
      const intervalId = setInterval(fetchSubmissions, 2500);
      return () => clearInterval(intervalId);
    }
  }, [submissions, fetchSubmissions]);

  const handleViewCode = async (submissionId) => {
    try {
      const response = await axios.get(`${API_URL}/submissions/${submissionId}`, {
        withCredentials: true,
        params: { contestId }
      });
      setSelectedSubmission(response.data);
      setIsModalOpen(true);
    } catch (err) {
      setError(`Failed to fetch submission #${submissionId}.`);
      console.error(err);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedSubmission(null);
  };

  const getStatusClass = (status) => {
    if (!status) return '';
    return `status-${status.split(' ')[0].toLowerCase()}`;
  };

  const canViewCode = (submission) => {
    if (!user) return false;
    
    // Admin and staff can view all submissions
    if (user.role === 'admin' || user.role === 'staff') {
      return true;
    }
    
    // Regular users can only view their own submissions
    return submission.username === user.username;
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

  if (loading) {
    return (
      <div className={styles['submissions-container']}>
        <div>Loading contest submissions...</div>
      </div>
    );
  }

  return (
    <div className={styles['submissions-container']}>
      {/* Contest Header */}
      {contest && (
        <div className={styles['contest-header']}>
          <div className={styles['header-top']}>
            <Link to={`/contests/${contestId}`} className={styles['back-link']}>
              ← Back to Contest
            </Link>
            <Link 
              to={`/contests/${contestId}/scoreboard`}
              className={styles['scoreboard-link']}
            >
              View Rankings
            </Link>
          </div>
          
          <div className={styles['contest-info']}>
            <h1>📤 Submissions - {contest.title}</h1>
            <div className={styles['contest-meta']}>
              <span className={`${styles['status-badge']} ${styles[contest.status]}`}>
                {contest.status === 'running' ? 'Running' :
                contest.status === 'scheduled' ? 'Scheduled' :
                contest.status === 'finished' ? 'Finished' : contest.status}
              </span>
              <span>Participants: {contest.participant_count || 0} people</span>
            </div>
          </div>
        </div>
      )}

      {/* Submissions Header */}
      <div className={styles['submissions-header']}>
        <h2>Contest Submissions</h2>
        <div className={styles['filter-buttons']}>
          <button
            className={`${styles['filter-btn']} ${filter === 'all' ? styles.active : ''}`}
            onClick={() => setFilter('all')}
          >
            All Contest Submissions
          </button>
          <button
            className={`${styles['filter-btn']} ${filter === 'mine' ? styles.active : ''}`}
            onClick={() => setFilter('mine')}
          >
            My Contest Submissions
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {/* Submissions Table */}
      {submissions.length === 0 ? (
        <div className={styles['no-submissions']}>
          <div className={styles['no-submissions-icon']}>📝</div>
          <h3>No submissions yet</h3>
          <p>No one has submitted solutions for this contest yet</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Submitted By</th>
                <th>Problem</th>
                <th>Language</th>
                <th>Status</th>
                <th>Score</th>
                <th>Submit Time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission) => (
                <tr key={submission.id}>
                  <td>#{submission.id}</td>
                  <td>
                    <span className={styles['username']}>
                      {submission.username}
                    </span>
                  </td>
                  <td>
                    <div className={styles['problem-info']}>
                      <span className={styles['problem-id']}>{submission.problem_id}</span>
                      <span className={styles['problem-title']}>{submission.problem_title}</span>
                    </div>
                  </td>
                  <td>
                    <span className={styles['language-badge']}>
                      {submission.language.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <span className={`status ${getStatusClass(submission.overall_status)}`}>
                      {submission.overall_status}
                    </span>
                  </td>
                  <td>
                    <span className={styles['score']}>
                      {submission.score !== undefined ? `${submission.score}/100` : 'N/A'}
                    </span>
                  </td>
                  <td>
                    <span className={styles['submit-time']}>
                      {formatDateTime(submission.submitted_at)}
                    </span>
                  </td>
                  <td>
                    {canViewCode(submission) ? (
                      <button
                        onClick={() => handleViewCode(submission.id)}
                        className={styles['view-code-btn']}
                        title="View Code"
                      >
                        👁️ Code
                      </button>
                    ) : (
                      <span className={styles['no-access']}>
                        🔒
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Submission Modal */}
      {isModalOpen && selectedSubmission && (
        <SubmissionModal 
          submission={selectedSubmission} 
          onClose={handleCloseModal} 
        />
      )}

      {/* Footer Info */}
      <div className={styles['submissions-footer']}>
        <div className={styles['info-text']}>
          <p>
            {filter === 'all' ? 
              'Admin and Staff can view code for all submissions' : 
              'You can only view code for your own submissions'
            }
          </p>
          {contest?.status === 'running' && (
            <p>Submissions auto-update every 2.5 seconds</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default ContestSubmissions; 
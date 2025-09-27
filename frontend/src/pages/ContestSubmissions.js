import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import styles from './Submissions.module.css';
import SubmissionModal from './SubmissionModal';

const API_URL = process.env.REACT_APP_API_URL;

function ContestSubmissions() {
  const { contestId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [contest, setContest] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' or 'mine'
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchContestData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/contests/${contestId}`, {
        withCredentials: true
      });
      const fetchedContest = response.data;
      setContest(fetchedContest);

      // Redirect logic if contest is finished
      if (fetchedContest.status === 'finished') {
        let redirectPath = '';

        if (fetchedContest.is_participant) {
          redirectPath = `/contests/${contestId}/scoreboard`;
        } else {
          redirectPath = '/contests';
        }
        navigate(redirectPath);
        return; // Stop further execution
      }
    } catch (err) {
      console.error('Error fetching contest data:', err);
      if (err.response?.status === 403) {
        // If user is not participant and contest is finished (or becomes finished), redirect to /contests
        try {
          const contestStatusCheck = await axios.get(`${API_URL}/contests/${contestId}`, { withCredentials: true });
          if (contestStatusCheck.data.status === 'finished') {
            navigate('/contests');
            return;
          }
        } catch (innerErr) {
          console.error('Failed to re-check contest status for 403 redirect:', innerErr);
        }
        setError('Failed to fetch contest submissions. You may not have access to this contest.');
      } else if (err.response?.status === 404) {
        setError('Contest not found.');
      } else {
        setError('Error fetching contest data.');
      }
    } finally {
      setLoading(false);
    }
  }, [contestId, user, navigate]); // Added user and navigate to dependencies

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
  }, [contestId, filter, submissions.length]); // Removed redirectMessage from dependencies

  useEffect(() => {
    fetchContestData();
    const intervalId = setInterval(() => {
      fetchContestData();
    }, 15000); // Poll every 15 seconds
    return () => clearInterval(intervalId);
  }, [fetchContestData]); // fetchContestData is a useCallback, so it's stable. If not, it would cause infinite loop.

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]); // Removed redirectMessage from dependencies

  // Auto-refresh for processing submissions
  useEffect(() => {
    const isProcessing = submissions.some(sub => 
      ['Pending', 'Compiling', 'Running'].includes(sub.overall_status)
    );

    if (isProcessing) {
      const intervalId = setInterval(fetchSubmissions, 2500);
      return () => clearInterval(intervalId);
    }
  }, [submissions, fetchSubmissions]); // Removed redirectMessage from dependencies

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

      {/* Submissions Header */}
      <div className={styles['submissions-header']}>
        <h1>Contest Submissions</h1>
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
          <h3>No submissions yet</h3>
          <p>No one has submitted solutions for this contest yet</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Problem</th>
                <th>Status</th>
                <th>Score</th>
                <th>Language</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission) => (
                <tr key={submission.id}>
                  <td>{formatDateTime(submission.submitted_at)}</td>
                  <td>{submission.username}</td>
                  <td>
                    <Link to={`/contests/${contestId}/problems/${submission.problem_id}`}>
                      {submission.problem_title}
                    </Link>
                  </td>
                  <td className={getStatusClass(submission.overall_status)}>
                    {submission.overall_status}
                  </td>
                  <td>
                    <span className={styles['score']}>
                      {submission.score !== undefined ? `${submission.score}` : 'N/A'}
                    </span>
                  </td>
                  <td>{submission.language}</td>
                  <td>
                    {canViewCode(submission) ? (
                      <button
                        onClick={() => handleViewCode(submission.id)}
                        className={styles['view-code-btn']}
                        title="View Code"
                      >
                        View Code
                      </button>
                    ) : null}
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

    </div>
  );
}

export default ContestSubmissions; 
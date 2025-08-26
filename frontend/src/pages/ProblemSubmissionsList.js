import React, { useState, useEffect } from 'react';
import axios from 'axios';
import SubmissionModal from './SubmissionModal';
import '../components/Table.css';

const API_URL = process.env.REACT_APP_API_URL;

const ProblemSubmissionsList = ({ problemId }) => {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch current user
        const userRes = await axios.get(`${API_URL}/me`, { withCredentials: true });
        if (userRes.data.isAuthenticated) {
          setCurrentUser(userRes.data.user);
        }

        // Fetch submissions for the specific problem, only for the current user
        const subsRes = await axios.get(`${API_URL}/api/submissions`, {
          withCredentials: true,
          params: { 
            problemId,
            filter: 'mine', // Only fetch submissions for the logged-in user
          },
        });
        setSubmissions(subsRes.data);
        setError('');
      } catch (err) {
        setError('Failed to fetch submissions for this problem.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [problemId]);

  const handleViewCode = async (submissionId) => {
    try {
      const response = await axios.get(`${API_URL}/api/submissions/${submissionId}`, {
        withCredentials: true,
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

  if (loading) return <div>Loading submissions...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="table-container" style={{ margin: 0, border: 'none', boxShadow: 'none' }}>
      {submissions.length === 0 ? (
        <p>No submissions for this problem yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Status</th>
              <th>Score</th>
              <th>Language</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map(sub => (
              <tr key={sub.id}>
                <td>{new Date(sub.submitted_at).toLocaleString()}</td>
                <td>{sub.username}</td>
                <td className={getStatusClass(sub.overall_status)}>{sub.overall_status}</td>
                <td>{sub.score}</td>
                <td>{sub.language}</td>
                <td>
                  {currentUser && currentUser.username === sub.username && (
                    <button onClick={() => handleViewCode(sub.id)} className="view-code-btn">
                      View Code
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {isModalOpen && <SubmissionModal submission={selectedSubmission} onClose={handleCloseModal} />}
    </div>
  );
};

export default ProblemSubmissionsList; 
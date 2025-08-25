import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import '../components/Table.css'; // Use the new shared table styles
import './Submissions.css'; // Import the new CSS file
import SubmissionModal from './SubmissionModal'; // Import the modal

const API_URL = process.env.REACT_APP_API_URL;

function Submissions() {
  const [submissions, setSubmissions] = useState([]);
  const [currentUser, setCurrentUser] = useState(null); // Add state for current user
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' or 'mine'
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    // Combined fetch function
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch current user
        const userRes = await axios.get(`${API_URL}/me`, {
          withCredentials: true,
        });
        if (userRes.data.isAuthenticated) {
          setCurrentUser(userRes.data.user);
        }

        // Fetch submissions
        const params = filter === 'mine' ? { filter: 'mine' } : {};
        const subsRes = await axios.get(`${API_URL}/api/submissions`, {
          withCredentials: true,
          params,
        });
        setSubmissions(subsRes.data);
        setError(''); // Clear previous errors
      } catch (err) {
        setError('Failed to fetch data. Please log in.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [filter]); // Re-fetch when filter changes

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
    <div className="submissions-container">
      <div className="submissions-header">
        <h1>Recent Submissions</h1>
        <div className="filter-buttons">
          <button 
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All Submissions
          </button>
          <button 
            className={`filter-btn ${filter === 'mine' ? 'active' : ''}`}
            onClick={() => setFilter('mine')}
          >
            My Submissions
          </button>
        </div>
      </div>
      <div className="table-container">
        <table className="submissions-table">
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
            {submissions.map(sub => (
              <tr key={sub.id}>
                <td>{new Date(sub.submitted_at).toLocaleString()}</td>
                <td>{sub.username}</td>
                <td><Link to={`/problems/${sub.problem_id}`}>{sub.problem_title}</Link></td>
                <td className={getStatusClass(sub.overall_status)}>{sub.overall_status}</td>
                <td>{sub.score}</td>
                <td>{sub.language}</td>
                <td>
                  {currentUser && (currentUser.username === sub.username || currentUser.role === 'admin' || currentUser.role === 'staff') ? (
                    <button onClick={() => handleViewCode(sub.id)} className="view-code-btn">
                      View Code
                    </button>
                  ) : (
                    <div className="view-code-btn" style={{ visibility: 'hidden' }} aria-hidden="true">
                      View Code
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isModalOpen && <SubmissionModal submission={selectedSubmission} onClose={handleCloseModal} />}
    </div>
  );
};

export default Submissions; 
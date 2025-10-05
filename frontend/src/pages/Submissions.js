import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Link, useParams } from 'react-router-dom';
import styles from './Submissions.module.css'; // Import the new CSS file
import SubmissionModal from './SubmissionModal'; // Import the modal

const API_URL = process.env.REACT_APP_API_URL;

function Submissions({ problemId, showTitle = true }) {
  const { contestId } = useParams(); // Get contestId from URL if this is a contest page
  const [submissions, setSubmissions] = useState([]);
  const [currentUser, setCurrentUser] = useState(null); // Add state for current user
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' or 'mine'
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filterProblemId, setFilterProblemId] = useState(''); // New state for problemId filter
  const [filterUserId, setFilterUserId] = useState(''); // New state for userId filter
  const [problemSuggestions, setProblemSuggestions] = useState([]);
  const [userSuggestions, setUserSuggestions] = useState([]);

  const fetchData = useCallback(async () => {
    // Only set loading on the very first fetch
    // if (submissions.length === 0) {
    //   setLoading(true);
    // }
    try {
      const userRes = await axios.get(`${API_URL}/me`, { withCredentials: true });
      if (userRes.data.isAuthenticated) {
        setCurrentUser(userRes.data.user);
      }

      const params = {};
      if (problemId) {
        // When on a problem detail page, always filter to the current user's submissions.
        params.filter = 'mine';
        params.problemId = problemId;
      } else if (filter === 'mine') {
        // On the main submissions page, respect the user's filter choice.
        params.filter = 'mine';
      }
      
      // Add contestId if this is a contest submissions page
      if (contestId) {
        params.contestId = contestId;
      }

      // Add admin/staff filters
      if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'staff') && !problemId) {
        if (filterProblemId) {
          params.filterProblemId = filterProblemId;
        }
        if (filterUserId) {
          params.filterUserId = filterUserId;
        }
      }

      const subsRes = await axios.get(`${API_URL}/submissions`, {
        withCredentials: true,
        params,
      });
      setSubmissions(subsRes.data);
      setError('');
    } catch (err) {
      setError('Failed to fetch data. Please log in.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [problemId, filter, contestId, currentUser, filterProblemId, filterUserId]); // Add new dependencies

  const fetchProblemSuggestions = useCallback(async (searchText) => {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'staff')) return;
    try {
      const response = await axios.get(`${API_URL}/admin/problems/list`, {
        withCredentials: true,
        params: { search: searchText }
      });
      setProblemSuggestions(response.data);
    } catch (err) {
      console.error('Error fetching problem suggestions:', err);
      setProblemSuggestions([]);
    }
  }, [currentUser]);

  const fetchUserSuggestions = useCallback(async (searchText) => {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'staff')) return;
    try {
      const response = await axios.get(`${API_URL}/admin/users/list`, {
        withCredentials: true,
        params: { search: searchText }
      });
      setUserSuggestions(response.data);
    } catch (err) {
      console.error('Error fetching user suggestions:', err);
      setUserSuggestions([]);
    }
  }, [currentUser]);

  useEffect(() => {
    fetchData();
  }, [filter, fetchData]); // Initial fetch when filter changes

  useEffect(() => {
    // Check if there are any submissions being processed
    const isProcessing = submissions.some(s => 
      s.overall_status === 'Pending' || 
      s.overall_status === 'Compiling' || 
      s.overall_status === 'Running'
    );

    if (isProcessing) {
      // If so, poll for updates every 2.5 seconds
      const intervalId = setInterval(fetchData, 2500);
      // Clean up the interval when the component unmounts or dependencies change
      return () => clearInterval(intervalId);
    }
  }, [submissions, fetchData]); // Rerun this effect if submissions or fetchData change

  useEffect(() => {
    const handler = setTimeout(() => {
      if (filterProblemId) {
        fetchProblemSuggestions(filterProblemId);
      } else {
        setProblemSuggestions([]); // Clear suggestions if input is empty
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [filterProblemId, fetchProblemSuggestions]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (filterUserId) {
        fetchUserSuggestions(filterUserId);
      } else {
        setUserSuggestions([]); // Clear suggestions if input is empty
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [filterUserId, fetchUserSuggestions]);

  const handleProblemIdChange = (e) => {
    setFilterProblemId(e.target.value);
  };

  const handleUserIdChange = (e) => {
    setFilterUserId(e.target.value);
  };

  const handleProblemSelect = (problemId) => {
    setFilterProblemId(problemId);
    setProblemSuggestions([]); // Clear suggestions after selection
  };

  const handleUserSelect = (username) => {
    setFilterUserId(username);
    setUserSuggestions([]); // Clear suggestions after selection
  };

    const handleViewCode = async (submissionId) => {
    try {
      const params = {};
      if (contestId) {
        params.contestId = contestId;
      }
      
      const response = await axios.get(`${API_URL}/submissions/${submissionId}`, {
        withCredentials: true,
        params,
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
    // Return the class name string directly for the global stylesheet
    return `status-${status.split(' ')[0].toLowerCase()}`;
  };

  if (loading) return <div>Loading submissions...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className={styles['submissions-container']}>
      {showTitle && (
        <div className={styles['submissions-header']}>
          <h1>Recent Submissions</h1>
          {/* Hide filter buttons when viewing submissions for a specific problem */}
          {!problemId && (
            <div className={styles['filter-buttons']}>
              <button
                className={`${styles['filter-btn']} ${filter === 'all' ? styles.active : ''}`}
                onClick={() => setFilter('all')}
              >
                All Submissions
              </button>
              <button
                className={`${styles['filter-btn']} ${filter === 'mine' ? styles.active : ''}`}
                onClick={() => setFilter('mine')}
              >
                My Submissions
              </button>
              {/* Admin/Staff Filters */}
              {currentUser && (currentUser.role === 'admin' || currentUser.role === 'staff') && (
                <>
                  <input
                    type="text"
                    placeholder="Filter by Problem ID"
                    value={filterProblemId}
                    onChange={handleProblemIdChange}
                    className={styles['filter-input']}
                  />
                  {problemSuggestions.length > 0 && (
                    <ul className={styles['suggestions-list']}>
                      {problemSuggestions.map(problem => (
                        <li key={problem.id} onClick={() => handleProblemSelect(problem.id)}>
                          {problem.id} - {problem.title}
                        </li>
                      ))}
                    </ul>
                  )}
                  <input
                    type="text"
                    placeholder="Filter by Username"
                    value={filterUserId}
                    onChange={handleUserIdChange}
                    className={styles['filter-input']}
                  />
                  {userSuggestions.length > 0 && (
                    <ul className={styles['suggestions-list']}>
                      {userSuggestions.map(user => (
                        <li key={user.id} onClick={() => handleUserSelect(user.username)}>
                          {user.username}
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    className={styles['filter-btn']}
                    onClick={fetchData} // Trigger refetch with current filters
                  >
                    Apply Filters
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
      <div className="table-container">
        {submissions.length === 0 && !loading ? (
          <p style={{ padding: '1rem 1.25rem' }}>
            {problemId ? "You haven't made any submissions for this problem yet." : "No submissions found."}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                {!problemId && <th>Problem</th>}
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
                  {!problemId && <td><Link to={`/problems/${sub.problem_id}`}>{sub.problem_title}</Link></td>}
                  <td className={getStatusClass(sub.overall_status)}>{sub.overall_status}</td>
                  <td>{sub.score}</td>
                  <td>{sub.language}</td>
                  <td>
                    {currentUser && (currentUser.username === sub.username || currentUser.role === 'admin' || currentUser.role === 'staff') ? (
                      <button onClick={() => handleViewCode(sub.id)} className={styles['view-code-btn']}>
                        View Code
                      </button>
                    ) : (
                      <div className={styles['view-code-btn']} style={{ visibility: 'hidden' }} aria-hidden="true">
                        View Code
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {isModalOpen && <SubmissionModal submission={selectedSubmission} onClose={handleCloseModal} />}
    </div>
  );
};

export default Submissions; 
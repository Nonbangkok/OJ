import React, { useState, useEffect, useCallback, useRef } from 'react';
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

  // Input states
  const [filterProblemId, setFilterProblemId] = useState('');
  const [filterUserId, setFilterUserId] = useState('');

  // Applied filter states (for manual trigger)
  const [appliedFilterProblemId, setAppliedFilterProblemId] = useState('');
  const [appliedFilterUserId, setAppliedFilterUserId] = useState('');

  // Autocomplete states
  const [problemSuggestions, setProblemSuggestions] = useState([]);
  const [userSuggestions, setUserSuggestions] = useState([]);
  const [showProblemSuggestions, setShowProblemSuggestions] = useState(false);
  const [showUserSuggestions, setShowUserSuggestions] = useState(false);

  const [visibleCount, setVisibleCount] = useState(10);

  // Refs for click outside detection and request tracking
  const problemInputRef = useRef(null);
  const userInputRef = useRef(null);
  const lastRequestIdRef = useRef(0);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (problemInputRef.current && !problemInputRef.current.contains(event.target)) {
        setShowProblemSuggestions(false);
      }
      if (userInputRef.current && !userInputRef.current.contains(event.target)) {
        setShowUserSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Fetch user once on mount
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userRes = await axios.get(`${API_URL}/me`, { withCredentials: true });
        if (userRes.data.isAuthenticated) {
          setCurrentUser(userRes.data.user);
        }
      } catch (err) {
        console.error("Error fetching user:", err);
      }
    };
    fetchUser();
  }, []);

  const fetchData = useCallback(async () => {
    const currentRequestId = Date.now();
    lastRequestIdRef.current = currentRequestId;

    // Only set loading on the very first fetch
    // if (submissions.length === 0) {
    //   setLoading(true);
    // }
    try {
      // Removed /me call from here to avoid infinite loop

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
        if (appliedFilterProblemId) {
          params.filterProblemId = appliedFilterProblemId;
        }
        if (appliedFilterUserId) {
          params.filterUserId = appliedFilterUserId;
        }
      }

      const subsRes = await axios.get(`${API_URL}/submissions`, {
        withCredentials: true,
        params,
      });

      // Check if request is still valid before updating state
      if (currentRequestId === lastRequestIdRef.current) {
        setSubmissions(subsRes.data);
        setError('');
      }
    } catch (err) {
      if (currentRequestId === lastRequestIdRef.current) {
        // If it's a 404 from filtering, it might just mean no user found, but ideally backend should handle this.
        // For now, let's just clear submissions if it's a filter error to be safe, or show error.
        // But better to fix backend.
        setError('Failed to fetch data. Please log in.');
        console.error(err);
      }
    } finally {
      if (currentRequestId === lastRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [problemId, filter, contestId, currentUser, appliedFilterProblemId, appliedFilterUserId]);

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

  const handleApplyFilters = () => {
    setSubmissions([]); // Clear current submissions
    setLoading(true);   // Show loading state
    setAppliedFilterProblemId(filterProblemId);
    setAppliedFilterUserId(filterUserId);
    // fetchData will be triggered by the useEffect dependency change
  };

  // Autocomplete Handlers
  const handleProblemChange = async (e) => {
    const value = e.target.value;
    setFilterProblemId(value);
    if (value.length > 0) {
      try {
        const res = await axios.get(`${API_URL}/api/search/problems?q=${value}`, { withCredentials: true });
        setProblemSuggestions(res.data);
        setShowProblemSuggestions(true);
      } catch (err) {
        console.error("Error fetching problem suggestions:", err);
      }
    } else {
      setProblemSuggestions([]);
      setShowProblemSuggestions(false);
    }
  };

  const handleUserChange = async (e) => {
    const value = e.target.value;
    setFilterUserId(value);
    if (value.length > 0) {
      try {
        const res = await axios.get(`${API_URL}/api/search/users?q=${value}`, { withCredentials: true });
        setUserSuggestions(res.data);
        setShowUserSuggestions(true);
      } catch (err) {
        console.error("Error fetching user suggestions:", err);
      }
    } else {
      setUserSuggestions([]);
      setShowUserSuggestions(false);
    }
  };

  const selectProblem = (problemId) => {
    setFilterProblemId(problemId);
    setShowProblemSuggestions(false);
  };

  const selectUser = (username) => {
    setFilterUserId(username);
    setShowUserSuggestions(false);
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
                  <div style={{ position: 'relative', alignContent: 'center' }} ref={problemInputRef}>
                    <input
                      type="text"
                      placeholder="Filter by Problem ID"
                      value={filterProblemId}
                      onChange={handleProblemChange}
                      onFocus={() => filterProblemId && setShowProblemSuggestions(true)}
                      className={styles['filter-input']}
                    />
                    {showProblemSuggestions && problemSuggestions.length > 0 && (
                      <ul className={styles['suggestions-list']}>
                        {problemSuggestions.map(p => (
                          <li key={p.id} onClick={() => selectProblem(p.id)}>
                            {p.id} - {p.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div style={{ position: 'relative', alignContent: 'center' }} ref={userInputRef}>
                    <input
                      type="text"
                      placeholder="Filter by Username"
                      value={filterUserId}
                      onChange={handleUserChange}
                      onFocus={() => filterUserId && setShowUserSuggestions(true)}
                      className={styles['filter-input']}
                    />
                    {showUserSuggestions && userSuggestions.length > 0 && (
                      <ul className={styles['suggestions-list']}>
                        {userSuggestions.map(u => (
                          <li key={u.username} onClick={() => selectUser(u.username)}>
                            {u.username}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <button
                    className={styles['filter-btn']}
                    onClick={handleApplyFilters} // Trigger refetch with current filters
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
              {submissions.slice(0, visibleCount).map(sub => (
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
      {visibleCount < submissions.length && (
        <div className={styles['show-more-container']}>
          <button
            className={styles['show-more-btn']}
            onClick={() => setVisibleCount(prev => prev + 10)}
          >
            Show More
          </button>
        </div>
      )}
      {isModalOpen && <SubmissionModal submission={selectedSubmission} onClose={handleCloseModal} />}
    </div>
  );
};

export default Submissions; 
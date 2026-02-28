import { useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import styles from './Submissions.module.css';
import SubmissionModal from '../features/problems/components/SubmissionModal';
import { useSubmissions } from '../hooks/useSubmissions';

function Submissions({ problemId, showTitle = true }) {
  const { contestId } = useParams();

  // Logic is now completely in the Hook
  const {
    submissions,
    currentUser,
    loading,
    error,
    filter,
    setFilter,
    selectedSubmission,
    isModalOpen,
    filterProblemId,
    filterUserId,
    problemSuggestions,
    userSuggestions,
    showProblemSuggestions,
    setShowProblemSuggestions,
    showUserSuggestions,
    setShowUserSuggestions,
    handleApplyFilters,
    handleViewCode,
    handleCloseModal,
    handleProblemChange,
    handleUserChange,
    selectProblem,
    selectUser
  } = useSubmissions(problemId, contestId);

  // UI Only state
  const [visibleCount, setVisibleCount] = useState(10);
  const problemInputRef = useRef(null);
  const userInputRef = useRef(null);

  // Click outside detection for suggestions
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
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setShowProblemSuggestions, setShowUserSuggestions]);

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
    return `status-${status.split(' ')[0].toLowerCase()}`;
  };

  if (loading) return <div>Loading submissions...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className={styles['submissions-container']}>
      {showTitle && (
        <div className={styles['submissions-header']}>
          <h1>Recent Submissions</h1>
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

                  <button className={styles['filter-btn']} onClick={handleApplyFilters}>
                    Apply Filters
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="table-container">
        {submissions.length === 0 ? (
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
                  {!problemId && (
                    <td><Link to={`/problems/${sub.problem_id}`}>{sub.problem_title}</Link></td>
                  )}
                  <td className={getStatusClass(sub.overall_status)}>{sub.overall_status}</td>
                  <td>{sub.score}</td>
                  <td>{sub.language}</td>
                  <td>
                    {currentUser && (currentUser.username === sub.username || currentUser.role === 'admin' || currentUser.role === 'staff') && (
                      <button onClick={() => handleViewCode(sub.id)} className={styles['view-code-btn']}>
                        View Code
                      </button>
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

      {isModalOpen && (
        <SubmissionModal submission={selectedSubmission} onClose={handleCloseModal} />
      )}
    </div>
  );
}

export default Submissions;
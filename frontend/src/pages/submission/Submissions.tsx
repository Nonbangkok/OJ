import React, { useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import styles from '../../components/styles/Submissions.module.css';
import SubmissionModal from '../../features/problem/submission/SubmissionModal';
import { useSubmissions } from '../../hooks/useSubmissions';
import { getStatusClass } from '../../utils/formatters';
import tableStyles from '../../components/styles/Table.module.css';
import LoadingPage from '../../components/shared/LoadingPage';
import { USER_ROLES } from '../../utils/constants';

interface SubmissionsProps {
  problemId?: string | number;
  contestId?: string | number;
  showTitle?: boolean;
}

const Submissions: React.FC<SubmissionsProps> = ({ problemId, contestId: propContestId, showTitle = true }) => {
  const { contestId: urlContestId } = useParams<{ contestId: string }>();
  const contestId = propContestId || urlContestId;

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
  const [visibleCount, setVisibleCount] = useState<number>(10);
  const problemInputRef = useRef<HTMLDivElement>(null);
  const userInputRef = useRef<HTMLDivElement>(null);

  // Click outside detection for suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (problemInputRef.current && !problemInputRef.current.contains(event.target as Node)) {
        setShowProblemSuggestions(false);
      }
      if (userInputRef.current && !userInputRef.current.contains(event.target as Node)) {
        setShowUserSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setShowProblemSuggestions, setShowUserSuggestions]);

  if (loading) return <LoadingPage />;
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
              {currentUser && (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.STAFF) && (
                <>
                  <div className={styles['filter-input-wrapper']} ref={problemInputRef}>
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
                          <li key={p.id} onClick={() => selectProblem(String(p.id))}>
                            {p.id} - {p.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className={styles['filter-input-wrapper']} ref={userInputRef}>
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

      <div className={tableStyles['table-container']}>
        {submissions.length === 0 ? (
          <div className={styles['no-submissions']}>
            <p>
              {problemId ? "You haven't made any submissions for this problem yet." : "No submissions found."}
            </p>
          </div>
        ) : (
          <table className={tableStyles.table}>
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
                  <td>{new Date(sub.submittedAt).toLocaleString()}</td>
                  <td>{sub.username}</td>
                  {!problemId && sub.problemId && (
                    <td><Link to={`/problems/${sub.problemId}`}>{sub.problem_title}</Link></td>
                  )}
                  <td className={getStatusClass(sub.status || '')}>{sub.status}</td>
                  <td>{sub.score}</td>
                  <td>{sub.language}</td>
                  <td>
                    {currentUser && (currentUser.username === sub.username || currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.STAFF) && (
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
        <SubmissionModal submission={selectedSubmission as any} onClose={handleCloseModal} />
      )}
    </div>
  );
}

export default Submissions;
import { useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import styles from '../components/styles/Submissions.module.css';
import SubmissionModal from '../features/problems/components/SubmissionModal';
import { useSubmissions } from '../hooks/useSubmissions';
import { getStatusClass, canViewCode, formatDateTime } from '../utils/formatters';
import tableStyles from '../components/styles/Table.module.css';
import { useAuth } from '../context/AuthContext';
import { useContestGuard } from '../hooks/useContestGuard';

const ContestSubmissions = () => {
    const { contestId } = useParams();
    const { user } = useAuth();

    // Contest access guard — handles redirect logic and polling
    const { isAccessible, loading: guardLoading, error: guardError } = useContestGuard(contestId);

    // Logic is now completely in the Hook
    const {
        submissions,
        currentUser,
        loading: submissionsLoading,
        error: submissionsError,
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
    } = useSubmissions(null, isAccessible ? contestId : null);

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

    if (guardLoading || submissionsLoading) {
        return (
            <div className={styles['submissions-container']}>
                <div>Loading contest submissions...</div>
            </div>
        );
    }

    const error = guardError || submissionsError;

    return (
        <div className={styles['submissions-container']}>
            <div className={styles['submissions-header']}>
                <h1>Contest Submissions</h1>
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
                                            <li key={p.id} onClick={() => selectProblem(p.id)}>
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
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className={tableStyles['table-container']}>
                {submissions.length === 0 ? (
                    <div className={styles['no-submissions']}>
                        <h3>No submissions yet</h3>
                        <p>No one has submitted solutions for this contest yet</p>
                    </div>
                ) : (
                    <table className={tableStyles.table}>
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
                            {submissions.slice(0, visibleCount).map((submission) => (
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
                                        {canViewCode(submission, user) ? (
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
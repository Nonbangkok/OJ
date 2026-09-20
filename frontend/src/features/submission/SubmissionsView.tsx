import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import styles from '../../components/styles/Submissions.module.css';
import SubmissionModal from '../problem/submission/SubmissionModal';
import { useSubmissions } from '../../hooks/useSubmissions';
import { getStatusClass, canViewCode, formatDateTime } from '../../utils/formatters';
import tableStyles from '../../components/styles/Table.module.css';
import LoadingPage from '../../components/shared/LoadingPage';
import { Button } from '../../components/ui';
import { USER_ROLES } from '../../utils/constants';
import type { AuthUser } from '../../types';

type SubmissionsViewProps = {
    /** Problem context: filters to the user's submissions for this problem. */
    problemId?: string | null;
    /** Contest context: fetches contest submissions and links problems within the contest. */
    contestId?: string | null;
    /** Whether the header (title + filters) renders at all. */
    showTitle?: boolean;
    /** Header title text. */
    title?: string;
    /** 'contest' renders the guarded contest variant (error inside the container, N/A score formatting). */
    variant?: 'page' | 'contest';
    /** Guard error surfaced by the contest page wrapper. */
    guardError?: string;
    /** Current authed user (contest variant checks code visibility via canViewCode). */
    user?: AuthUser | null;
};

const SubmissionsView = ({
    problemId = null,
    contestId = null,
    showTitle = true,
    title = 'Recent Submissions',
    variant = 'page',
    guardError,
    user = null,
}: SubmissionsViewProps) => {

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
    const problemInputRef = useRef<HTMLDivElement | null>(null);
    const userInputRef = useRef<HTMLDivElement | null>(null);

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

    if (variant === 'page') {
        if (loading) return <LoadingPage />;
        if (error) return <div className="error-message">{error}</div>;
    } else if (loading) {
        return <LoadingPage />;
    }

    const displayError = variant === 'contest' ? guardError || error : error;

    return (
        <div className={styles['submissions-container']}>
            {showTitle && (
                <div className={styles['submissions-header']}>
                    <h1>{title}</h1>
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
                                                    <li key={p.id}>
                                                        <button type="button" className={styles['suggestion-option']} onClick={() => selectProblem(p.id)}>
                                                            {p.id} - {p.title}
                                                        </button>
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
                                                    <li key={u.username}>
                                                        <button type="button" className={styles['suggestion-option']} onClick={() => selectUser(u.username)}>
                                                            {u.username}
                                                        </button>
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

            {displayError && <div className="error-message">{displayError}</div>}

            <div className={tableStyles['table-container']}>
                {submissions.length === 0 ? (
                    <div className={styles['no-submissions']}>
                        {variant === 'contest' ? (
                            <>
                                <h3>No submissions yet</h3>
                                <p>No one has submitted solutions for this contest yet</p>
                            </>
                        ) : (
                            <p>
                                {problemId
                                    ? "You haven't made any submissions for this problem yet."
                                    : 'No submissions found.'}
                            </p>
                        )}
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
                            {submissions.slice(0, visibleCount).map(sub => {
                                const viewable = variant === 'contest'
                                    ? canViewCode(sub, user)
                                    : currentUser && (currentUser.username === sub.username || currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.STAFF);
                                return (
                                    <tr key={sub.id}>
                                        <td>{formatDateTime(sub.submitted_at)}</td>
                                        <td><Link to={`/profile/${sub.username}`}>{sub.username}</Link></td>
                                        {!problemId && (
                                            <td>
                                                <Link
                                                    to={
                                                        variant === 'contest' && contestId
                                                            ? `/contests/${contestId}/problems/${sub.problem_id}`
                                                            : `/problems/${sub.problem_id}`
                                                    }
                                                >
                                                    {sub.problem_title}
                                                </Link>
                                            </td>
                                        )}
                                        <td className={getStatusClass(sub.overall_status)}>{sub.overall_status}</td>
                                        <td>
                                            {variant === 'contest' ? (
                                                <span className={styles['score']}>
                                                    {sub.score !== undefined ? `${sub.score}` : 'N/A'}
                                                </span>
                                            ) : (
                                                sub.score
                                            )}
                                        </td>
                                        <td>{sub.language}</td>
                                        <td>
                                            {viewable && (
                                                <Button
                                                    size="compact"
                                                    onClick={() => handleViewCode(sub.id)}
                                                    title={variant === 'contest' ? 'View Code' : undefined}
                                                >
                                                    View Code
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
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
            {isModalOpen && (
                <SubmissionModal submission={selectedSubmission} onClose={handleCloseModal} />
            )}
        </div>
    );
};

export default SubmissionsView;

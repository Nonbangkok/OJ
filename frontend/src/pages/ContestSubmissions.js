import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import styles from './Submissions.module.css';
import tableStyles from '../components/common/Table.module.css';
import SubmissionModal from '../features/problems/components/SubmissionModal';
import { getStatusClass, canViewCode, formatDateTime } from '../utils/formatters';
import { useContestGuard } from '../hooks/useContestGuard';
import { useSubmissions } from '../hooks/useSubmissions';

const ContestSubmissions = () => {
  const { contestId } = useParams();
  const { user } = useAuth();

  // Contest access guard — handles redirect logic and polling
  const { isAccessible, loading: guardLoading, error: guardError } = useContestGuard(contestId);

  // Fetch submissions using the shared hook, passing contestId
  const {
    submissions,
    loading: submissionsLoading,
    error: submissionsError,
    filter,
    setFilter,
    selectedSubmission,
    isModalOpen,
    handleViewCode,
    handleCloseModal
  } = useSubmissions(null, isAccessible ? contestId : null);

  if (guardLoading || submissionsLoading) {
    return (
      <div className={styles['submissions-container']}>
        <div>Loading contest submissions...</div>
      </div>
    );
  }

  // Combine errors if any
  const error = guardError || submissionsError;

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
        <div className={tableStyles['table-container']}>
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
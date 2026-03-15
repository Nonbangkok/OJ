import useContestManagement from '../../../hooks/admin/useContestManagement';
import ContestModal from './ContestModal';
import ProblemMigrationModal from '../problems/ProblemMigrationModal';
import ConfirmationModal from '../shared/ConfirmationModal';
import styles from '../shared/Management.module.css';
import tableStyles from '../../../components/styles/Table.module.css';
import LoadingPage from '../../../components/shared/LoadingPage';

const ContestManagement = ({ currentUser }) => {
  const {
    contests,
    loading,
    error,
    isModalOpen,
    setIsModalOpen,
    editingContest,
    setEditingContest,
    isMigrationModalOpen,
    setIsMigrationModalOpen,
    migrationContest,
    setMigrationContest,
    isConfirmModalOpen,
    setIsConfirmModalOpen,
    contestToDelete,
    setContestToDelete,
    fetchContests,
    handleDelete,
    handleEdit,
    handleCreate,
    handleManageProblems,
    getStatusBadge,
    formatDateTime
  } = useContestManagement(styles);

  if (loading) {
    return <LoadingPage />;
  }

  return (
    <div className={styles['management-container']}>
      <div className={styles['management-header']}>
        <h2>Contest Management</h2>
        <div className={styles['header-actions']}>
          <button
            onClick={handleCreate}
            className={styles['create-btn']}
          >
            Create New Contest
          </button>
        </div>
      </div>

      {error && (
        <div className={styles.error}>
          <h3>Error: {error}</h3>
        </div>
      )}

      {/* Contests Table */}
      {contests.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🏆</div>
          <h3>No contests yet</h3>
          <p>Create your first contest to get started</p>
          <button
            onClick={handleCreate}
            className={styles['create-btn']}
          >
            Create First Contest
          </button>
        </div>
      ) : (
        <div className={tableStyles['table-container']}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Start Time</th>
                <th>Participants</th>
                <th>Problems</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {contests.map(contest => (
                <tr key={contest.id}>
                  <td>
                    {contest.title}
                  </td>

                  <td>
                    {getStatusBadge(contest.status)}
                  </td>

                  <td>
                    <div className={styles.timeInfo}>
                      <div className={styles.timeRow}>
                        <span className={styles.timeLabel}>Start:</span>
                        <span className={styles.timeValue}>
                          {formatDateTime(contest.start_time)}
                        </span>
                      </div>
                      <div className={styles.timeRow}>
                        <span className={styles.timeLabel}>End:</span>
                        <span className={styles.timeValue}>
                          {formatDateTime(contest.end_time)}
                        </span>
                      </div>
                    </div>
                  </td>

                  <td>
                    <span className={styles.statValue}>
                      {contest.participant_count || 0}
                    </span>
                  </td>

                  <td>
                    <span className={styles.statValue}>
                      {contest.problem_count || 0}
                    </span>
                  </td>

                  <td>
                    <div className={styles.actionButtons}>
                      <button
                        onClick={() => handleEdit(contest)}
                        className={styles['edit-btn']}
                        title="Edit Contest"
                      >
                        Edit
                      </button>

                      <button
                        onClick={() => handleManageProblems(contest)}
                        className={styles['problems-btn']}
                        title="Manage Problems"
                        disabled={contest.status === 'finished'}
                      >
                        Problems
                      </button>

                      <button
                        onClick={() => {
                          setContestToDelete(contest.id);
                          setIsConfirmModalOpen(true);
                        }}
                        className={styles['delete-btn']}
                        title="Delete Contest"
                        disabled={contest.status === 'running'}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Contest Modal */}
      {isModalOpen && (
        <ContestModal
          contest={editingContest}
          onClose={() => {
            setIsModalOpen(false);
            setEditingContest(null);
          }}
          onSuccess={() => {
            fetchContests();
            setIsModalOpen(false);
            setEditingContest(null);
          }}
        />
      )}

      {/* Problem Migration Modal */}
      {isMigrationModalOpen && migrationContest && (
        <ProblemMigrationModal
          contest={migrationContest}
          onClose={() => {
            setIsMigrationModalOpen(false);
            setMigrationContest(null);
          }}
          onSuccess={() => {
            fetchContests();
            setIsMigrationModalOpen(false);
            setMigrationContest(null);
          }}
        />
      )}

      {/* Confirmation Modal */}
      {isConfirmModalOpen && (
        <ConfirmationModal
          isOpen={isConfirmModalOpen}
          onClose={() => {
            setIsConfirmModalOpen(false);
            setContestToDelete(null);
          }}
          onConfirm={handleDelete}
          title="Delete Contest"
          message="Are you sure you want to delete this contest? This action cannot be undone."
          confirmText="Delete"
          confirmStyle="danger"
        />
      )}
    </div>
  );
}

export default ContestManagement; 
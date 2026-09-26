import { useMemo, useState } from 'react';
import useContestManagement from '../../../hooks/admin/useContestManagement';
import useRejudge from '../../../hooks/admin/useRejudge';
import ContestModal from './ContestModal';
import ProblemMigrationModal from '../problems/ProblemMigrationModal';
import ConfirmationModal from '../shared/ConfirmationModal';
import RejudgeFeedbackBox from '../shared/RejudgeFeedbackBox';
import styles from '../shared/Management.module.css';
import tableStyles from '../../../components/styles/Table.module.css';
import LoadingPage from '../../../components/shared/LoadingPage';
import { ActionMenu, Button } from '../../../components/ui';

const ContestManagement = () => {
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
    handleToggleVisibility,
    getStatusBadge,
    formatDateTime
  } = useContestManagement(styles);

  const {
    isRejudgeConfirmOpen,
    rejudgeTarget,
    rejudgeFeedback,
    handleRejudgeClick,
    handleCloseRejudgeConfirm,
    handleConfirmRejudge,
    dismissRejudgeFeedback,
  } = useRejudge();

  // --- Filters: title search x status -------------------------------------
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const statuses = useMemo(
    () => [...new Set(contests.map(contest => contest.status))].sort(),
    [contests],
  );

  const visibleContests = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contests.filter(contest => {
      if (statusFilter !== 'all' && contest.status !== statusFilter) return false;
      if (!query) return true;
      return contest.title.toLowerCase().includes(query);
    });
  }, [contests, statusFilter, search]);

  if (loading) {
    return <LoadingPage />;
  }

  return (
    <div className={styles['management-container']}>
      {/* --- Page header: creation only ------------------------------------ */}
      <div className={styles['management-header']}>
        <h2>Contest Management</h2>
        <div className={styles['header-actions']}>
          <Button onClick={handleCreate}>+ New Contest</Button>
        </div>
      </div>

      {/* --- Filter / scope bar -------------------------------------------- */}
      <div className={styles['filter-bar']}>
        <input
          type="search"
          className={styles['filter-search']}
          placeholder="Search contests…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search contests"
        />
        <label className={styles['filter-control']}>
          <span className={styles['filter-label']}>Status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter contests by status"
          >
            <option value="all">All</option>
            {statuses.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className={styles.error}>
          <h3>Error: {error}</h3>
        </div>
      )}

      {/* Rejudge feedback sits above the table so the outcome is visible
          without scrolling past the toolbar. */}
      <RejudgeFeedbackBox feedback={rejudgeFeedback} onDismiss={dismissRejudgeFeedback} />

      {/* --- Table: Edit + Problems + overflow ---------------------------- */}
      <div className={`${tableStyles['table-container']} ${styles.tableWrap}`}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th className={styles['col-left']}>Title</th>
              <th className={styles['col-center']}>Status</th>
              <th className={styles['col-left']}>Start / End</th>
              <th className={styles['col-center']}>Participants</th>
              <th className={styles['col-center']}>Problems</th>
              <th className={styles['col-center']}>Visibility</th>
              <th className={styles['col-center']}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleContests.map(contest => (
              <tr key={contest.id}>
                <td className={styles['col-left']}>
                  {contest.title}
                </td>

                <td className={styles['col-center']}>
                  {getStatusBadge(contest.status)}
                </td>

                <td className={styles['col-left']}>
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

                <td className={styles['col-center']}>
                  <span className={styles.statValue}>
                    {contest.participant_count || 0}
                  </span>
                </td>

                <td className={styles['col-center']}>
                  <span className={styles.statValue}>
                    {contest.problem_count || 0}
                  </span>
                </td>

                <td className={styles['col-center']}>
                  <button
                    type="button"
                    className={`${styles['visibility-badge']} ${contest.is_visible ? styles['visibility-visible'] : styles['visibility-hidden']}`}
                    onClick={() => handleToggleVisibility(contest.id, contest.is_visible)}
                    title={contest.is_visible ? 'Visible — click to hide' : 'Hidden — click to show'}
                  >
                    {contest.is_visible ? 'Visible' : 'Hidden'}
                  </button>
                </td>

                <td className={styles['col-center']}>
                  <div className={styles['row-actions']}>
                    <Button
                      size="compact"
                      variant="secondary"
                      onClick={() => handleEdit(contest)}
                      title="Edit Contest"
                    >
                      Edit
                    </Button>
                    <Button
                      size="compact"
                      onClick={() => handleManageProblems(contest)}
                      title="Manage Problems"
                      disabled={contest.status === 'finished'}
                    >
                      Problems
                    </Button>
                    <ActionMenu
                      label={`Row actions for ${contest.title}`}
                      items={[
                        {
                          key: 'toggle-visibility',
                          label: contest.is_visible ? 'Hide Contest' : 'Show Contest',
                          onClick: () => handleToggleVisibility(contest.id, contest.is_visible),
                          title: contest.is_visible
                            ? 'Hide this contest from normal users and guests (reversible; status, timing, and data are untouched)'
                            : 'Make this contest visible to normal users and guests again',
                        },
                        {
                          key: 'rejudge',
                          label: 'Rejudge',
                          disabled: contest.status === 'finished',
                          title: contest.status === 'finished'
                            ? 'Finished contest — its scoreboard is frozen. Rejudge its problems individually instead.'
                            : 'Re-run every submission in this contest against the current testcases and limits',
                          onClick: () => handleRejudgeClick({ kind: 'contest', id: contest.id, title: contest.title }),
                        },
                        {
                          key: 'delete',
                          label: 'Delete',
                          variant: 'danger',
                          disabled: contest.status === 'running',
                          onClick: () => {
                            setContestToDelete(contest.id);
                            setIsConfirmModalOpen(true);
                          },
                        },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visibleContests.length && (
          <p className={styles['empty-state']}>No contests found.</p>
        )}
      </div>

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
        />
      )}

      {/* Rejudge confirmation */}
      <ConfirmationModal
        isOpen={isRejudgeConfirmOpen}
        onClose={handleCloseRejudgeConfirm}
        onConfirm={handleConfirmRejudge}
        title="Confirm Rejudge"
        message={rejudgeTarget
          ? `Rejudge re-runs every submission for contest "${rejudgeTarget.title}" against the current testcases and limits. Scores may change.`
          : ''}
        confirmText="Rejudge"
        confirmStyle="default"
      />
    </div>
  );
}

export default ContestManagement;

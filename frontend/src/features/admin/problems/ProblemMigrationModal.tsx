import useProblemMigrationModal from '../../../hooks/admin/useProblemMigrationModal';
import formStyles from '../../../components/styles/Form.module.css';
import modalStyles from '../shared/ModalLayout.module.css';
import LoadingPage from '../../../components/shared/LoadingPage';
import { Dialog } from '../../../components/ui/Dialog';

const ProblemMigrationModal = ({ contest, onClose, onSuccess }) => {
  const {
    availableProblems,
    contestProblems,
    loading,
    migrationLoading,
    error,
    selectedAvailable,
    selectedContest,
    handleMoveToContest,
    handleMoveToMain,
    handleSelectAvailable,
    handleSelectContest,
    handleSelectAllAvailable,
    handleSelectAllContest
  } = useProblemMigrationModal(contest, onSuccess);

  const canMoveProblems = contest.status === 'scheduled' || contest.status === 'running';

  if (loading) return <LoadingPage />;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Manage Contest Problems — ${contest.title}`}
      wide
    >
        {error && (
          <div className={formStyles['error-message']}>
            <h3>Error: {error}</h3>
          </div>
        )}

        {contest.status !== 'scheduled' && contest.status !== 'running' && (
          <div className={modalStyles.migrationModalWarning}>
            Problems can only be modified for scheduled or running contests.
            This contest is currently {contest.status}.
          </div>
        )}

        <div className={modalStyles.migrationModalGrid}>
          {/* Available Problems */}
          <div className={modalStyles.migrationPanel}>
            <div className={modalStyles.migrationPanelHeader}>
              <h3>Available Problems ({availableProblems.length})</h3>
              {canMoveProblems && availableProblems.length > 0 && (
                <button
                  onClick={handleSelectAllAvailable}
                  className={modalStyles.migrationSelectAllButton}
                >
                  {selectedAvailable.length === availableProblems.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>

            <div className={modalStyles.migrationProblemList}>
              {availableProblems.length === 0 ? (
                <div className={modalStyles.migrationEmptyList}>
                  <h3>No Available Problems</h3>
                </div>
              ) : (
                availableProblems.map(problem => {
                  const itemClasses = [
                    modalStyles.migrationProblemItem,
                    canMoveProblems ? modalStyles.enabled : modalStyles.disabled,
                    selectedAvailable.includes(problem.id) ? modalStyles.selected : ''
                  ].join(' ');

                  return (
                    <div
                      key={problem.id}
                      className={itemClasses}
                      role="button"
                      tabIndex={canMoveProblems ? 0 : -1}
                      aria-pressed={selectedAvailable.includes(problem.id)}
                      onClick={() => canMoveProblems && handleSelectAvailable(problem.id)}
                      onKeyDown={(e) => {
                        if (canMoveProblems && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          handleSelectAvailable(problem.id);
                        }
                      }}
                    >
                      <div className={modalStyles.migrationProblemDetails}>
                        <h4 className={modalStyles.migrationProblemTitle}>
                          {problem.title}
                        </h4>
                        <p className={modalStyles.migrationProblemAuthor}>by {problem.author}</p>
                      </div>
                      {canMoveProblems && (
                        <div className={modalStyles.migrationProblemCheckboxContainer}>
                          <input
                            type="checkbox"
                            checked={selectedAvailable.includes(problem.id)}
                            onChange={() => handleSelectAvailable(problem.id)}
                            onClick={e => e.stopPropagation()}
                            className={modalStyles.migrationProblemCheckbox}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Migration Controls */}
          <div className={modalStyles.migrationControls}>
            <div className={modalStyles.migrationControlsButtons}>
              <button
                onClick={handleMoveToContest}
                disabled={!canMoveProblems || selectedAvailable.length === 0 || migrationLoading}
                className={`${modalStyles.migrationControlButton} ${modalStyles.migrationControlToAdd}`}
                title="Move selected problems to contest"
              >
                <small className={modalStyles.migrationControlButtonText}>Add to Contest</small>
              </button>

              <button
                onClick={() => handleMoveToMain()}
                disabled={!canMoveProblems || selectedContest.length === 0 || migrationLoading}
                className={`${modalStyles.migrationControlButton} ${modalStyles.migrationControlToRemove}`}
                title="Move selected problems back to main pool"
              >
                <small className={modalStyles.migrationControlButtonText}>Remove from Contest</small>
              </button>
            </div>

            <div className={modalStyles.migrationSelectionCountContainer}>
              <div className={modalStyles.migrationSelectionCountText}>
                {selectedAvailable.length} selected from available
              </div>
              <div className={modalStyles.migrationSelectionCountText}>
                {selectedContest.length} selected from contest
              </div>
            </div>
          </div>

          {/* Contest Problems */}
          <div className={modalStyles.migrationPanel}>
            <div className={modalStyles.migrationPanelHeader}>
              <div>
                <h3>Contest Problems ({contestProblems.length})</h3>
              </div>
              {canMoveProblems && contestProblems.length > 0 && (
                <button
                  onClick={handleSelectAllContest}
                  className={modalStyles.migrationSelectAllButton}
                >
                  {selectedContest.length === contestProblems.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>

            <div className={modalStyles.migrationProblemList}>
              {contestProblems.length === 0 ? (
                <div className={modalStyles.migrationEmptyList}>
                  <h3>No Contest Problems</h3>
                  <p>No problems have been assigned to this contest yet</p>
                </div>
              ) : (
                contestProblems.map((problem) => {
                  const itemClasses = [
                    modalStyles.migrationProblemItem,
                    canMoveProblems ? modalStyles.enabled : modalStyles.disabled,
                    selectedContest.includes(problem.id) ? modalStyles.selected : ''
                  ].join(' ');

                  return (
                    <div
                      key={problem.id}
                      className={itemClasses}
                      role="button"
                      tabIndex={canMoveProblems ? 0 : -1}
                      aria-pressed={selectedContest.includes(problem.id)}
                      onClick={() => canMoveProblems && handleSelectContest(problem.id)}
                      onKeyDown={(e) => {
                        if (canMoveProblems && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          handleSelectContest(problem.id);
                        }
                      }}
                    >
                      <div className={modalStyles.migrationProblemDetails}>
                        <h4 className={modalStyles.migrationProblemTitle}>
                          {problem.title}
                        </h4>
                        <p className={modalStyles.migrationProblemAuthor}>by {problem.author}</p>
                      </div>
                      {canMoveProblems && (
                        <div className={modalStyles.migrationProblemCheckboxContainer}>
                          <input
                            type="checkbox"
                            checked={selectedContest.includes(problem.id)}
                            onChange={() => handleSelectContest(problem.id)}
                            onClick={e => e.stopPropagation()}
                            className={modalStyles.migrationProblemCheckbox}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className={modalStyles.migrationFooter}>
          <button
            onClick={onClose}
            className={modalStyles.migrationCloseButton}
          >
            Close
          </button>
        </div>
    </Dialog>
  );
}

export default ProblemMigrationModal; 
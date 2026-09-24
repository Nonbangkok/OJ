import { useMemo, useState } from 'react';
import useProblemMigrationModal from '../../../hooks/admin/useProblemMigrationModal';
import modalStyles from '../shared/ModalLayout.module.css';
import LoadingPage from '../../../components/shared/LoadingPage';
import { Button, Dialog } from '../../../components/ui';

/** One compact problem row: title + muted ID with a real checkbox. */
const ProblemRow = ({ problem, checked, disabled, onToggle, ariaLabel }) => (
  <li className={modalStyles.pickRow}>
    <label className={modalStyles.pickRowLabel}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        aria-label={ariaLabel}
      />
      <span className={modalStyles.pickRowBody}>
        <span className={modalStyles.pickRowTitle}>{problem.title}</span>
        <span className={modalStyles.pickRowId}>{problem.id}</span>
      </span>
    </label>
  </li>
);

/** One searchable panel of problems with its own selection set. */
const ProblemPanel = ({
  title,
  problems,
  selected,
  onToggle,
  onSelectAllVisible,
  disabled,
  searchPlaceholder,
  search,
  onSearch,
  emptyMessage,
}) => {
  const query = search.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!query) return problems;
    return problems.filter(problem =>
      problem.title.toLowerCase().includes(query)
      || problem.id.toLowerCase().includes(query));
  }, [problems, query]);

  return (
    <section className={modalStyles.pickPanel}>
      <header className={modalStyles.pickPanelHead}>
        <h3>
          {title} ({problems.length})
          {selected.length > 0 && (
            <span className={modalStyles.pickSelectedCount}> · {selected.length} selected</span>
          )}
        </h3>
        {disabled ? null : (
          <div className={modalStyles.pickPanelTools}>
            <button
              type="button"
              className={modalStyles.pickLinkButton}
              onClick={onSelectAllVisible}
              disabled={visible.length === 0}
            >
              {visible.every(problem => selected.includes(problem.id)) && visible.length > 0
                ? 'Deselect all visible'
                : 'Select all visible'}
            </button>
            {selected.length > 0 && (
              <button
                type="button"
                className={modalStyles.pickLinkButton}
                onClick={() => selected.forEach(onToggle)}
              >
                Clear selection
              </button>
            )}
          </div>
        )}
      </header>
      <input
        type="search"
        className={modalStyles.pickSearch}
        placeholder={searchPlaceholder}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        aria-label={searchPlaceholder}
      />
      {query && (
        <p className={modalStyles.pickResultCount}>
          {visible.length} of {problems.length} problems
        </p>
      )}
      <ul className={modalStyles.pickList}>
        {visible.length === 0 ? (
          <li className={modalStyles.pickEmpty}>
            {query
              ? `No problems match "${query}".`
              : emptyMessage}
          </li>
        ) : (
          visible.map(problem => (
            <ProblemRow
              key={problem.id}
              problem={problem}
              checked={selected.includes(problem.id)}
              disabled={disabled}
              onToggle={() => onToggle(problem.id)}
              ariaLabel={`Select problem ${problem.id}`}
            />
          ))
        )}
      </ul>
    </section>
  );
};

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

  // Per-panel search; selections survive searching by design (each panel's
  // selection set is independent of what is currently visible).
  const [availableSearch, setAvailableSearch] = useState('');
  const [contestSearch, setContestSearch] = useState('');

  // Select-all scopes to the currently visible (filtered) rows only.
  const selectAllVisibleAvailable = () => {
    const query = availableSearch.trim().toLowerCase();
    const visible = query
      ? availableProblems.filter(problem =>
          problem.title.toLowerCase().includes(query)
          || problem.id.toLowerCase().includes(query))
      : availableProblems;
    visible.forEach(problem => {
      if (!selectedAvailable.includes(problem.id)) handleSelectAvailable(problem.id);
    });
  };
  const selectAllVisibleContest = () => {
    const query = contestSearch.trim().toLowerCase();
    const visible = query
      ? contestProblems.filter(problem =>
          problem.title.toLowerCase().includes(query)
          || problem.id.toLowerCase().includes(query))
      : contestProblems;
    visible.forEach(problem => {
      if (!selectedContest.includes(problem.id)) handleSelectContest(problem.id);
    });
  };

  if (loading) return <LoadingPage />;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Manage Contest Problems — ${contest.title}`}
      wide
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {error && (
        <div role="alert" className={modalStyles.migrationModalWarning}>
          {error}
        </div>
      )}

      {contest.status !== 'scheduled' && contest.status !== 'running' && (
        <div className={modalStyles.migrationModalWarning}>
          Problems can only be modified for scheduled or running contests.
          This contest is currently {contest.status}.
        </div>
      )}

      <div className={modalStyles.pickGrid}>
        <ProblemPanel
          title="Available Problems"
          problems={availableProblems}
          selected={selectedAvailable}
          onToggle={handleSelectAvailable}
          onSelectAllVisible={selectAllVisibleAvailable}
          disabled={!canMoveProblems}
          searchPlaceholder="Search by ID or title…"
          search={availableSearch}
          onSearch={setAvailableSearch}
          emptyMessage="No available problems."
        />

        <div className={modalStyles.pickControls}>
          <Button
            size="compact"
            disabled={!canMoveProblems || selectedAvailable.length === 0 || migrationLoading}
            onClick={handleMoveToContest}
            title="Move selected problems to the contest"
          >
            Add{selectedAvailable.length > 0 ? ` ${selectedAvailable.length}` : ''} to Contest →
          </Button>
          <Button
            size="compact"
            variant="secondary"
            disabled={!canMoveProblems || selectedContest.length === 0 || migrationLoading}
            onClick={() => handleMoveToMain()}
            title="Move selected problems back to the main pool"
          >
            ← Remove{selectedContest.length > 0 ? ` ${selectedContest.length}` : ''}
          </Button>
        </div>

        <ProblemPanel
          title="Contest Problems"
          problems={contestProblems}
          selected={selectedContest}
          onToggle={handleSelectContest}
          onSelectAllVisible={selectAllVisibleContest}
          disabled={!canMoveProblems}
          searchPlaceholder="Search contest problems…"
          search={contestSearch}
          onSearch={setContestSearch}
          emptyMessage="No problems in this contest yet. Select problems from the left and add them to the contest."
        />
      </div>
    </Dialog>
  );
};

export default ProblemMigrationModal;

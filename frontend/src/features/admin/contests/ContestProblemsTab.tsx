import { useEffect, useId, useMemo, useState } from 'react';
import { DotsSixVertical, X } from '@phosphor-icons/react';
import { ActionMenu, ConfirmDialog, InlineError, InlineNotice } from '../../../components/ui';
import adminService from '../../../services/adminService';
import { getErrorMessage } from '../../../utils/error';
import { problemLetter } from '../../contest/letters';
import type { ContestStatus, ProblemBase } from '../../../types';
import styles from './ContestEditor.module.css';

interface ContestProblemsTabProps {
  contestId: number;
  status: ContestStatus;
  /** The contest's problems in contest order (A, B, …). */
  problems: ProblemBase[];
  onProblemsChange: (next: ProblemBase[]) => void;
}

const PICKER_LIMIT = 8;
const move = <T,>(list: T[], from: number, to: number): T[] => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

/** Problems tab (§7.8): ordered list with drag + Move up/down, remove, and an add picker. */
export default function ContestProblemsTab({ contestId, status, problems, onProblemsChange }: ContestProblemsTabProps) {
  const editable = status === 'scheduled' || status === 'running';
  const [error, setError] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [removing, setRemoving] = useState<ProblemBase | null>(null);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<ProblemBase[]>([]);
  const [query, setQuery] = useState('');
  const listboxId = useId();

  useEffect(() => {
    if (!editable) return undefined;
    let cancelled = false;
    adminService.getAvailableProblems()
      .then((list) => { if (!cancelled) setAvailable(list); })
      .catch(() => { if (!cancelled) setAvailable([]); });
    return () => { cancelled = true; };
  }, [editable]);

  const reorder = async (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= problems.length || to >= problems.length) return;
    const before = problems;
    const next = move(problems, from, to);
    setError('');
    onProblemsChange(next);
    try {
      await adminService.reorderProblems(contestId, next.map((x) => x.id));
    } catch (err) {
      onProblemsChange(before);
      setError(getErrorMessage(err, 'Failed to save the new order.'));
    }
  };

  const refresh = async () => {
    const [list, pool] = await Promise.all([
      adminService.getContestProblemsAdmin(contestId),
      adminService.getAvailableProblems().catch(() => available),
    ]);
    onProblemsChange(list);
    setAvailable(pool);
  };

  const add = async (problem: ProblemBase) => {
    setBusy(true);
    setError('');
    setQuery('');
    try {
      await adminService.migrateContestProblems(contestId, [problem.id], 'move_to_contest');
      await refresh();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to add the problem.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setError('');
    try {
      await adminService.removeContestProblem(contestId, removing.id);
      setRemoving(null);
      await refresh();
    } catch (err) {
      setRemoving(null);
      setError(getErrorMessage(err, 'Failed to remove the problem.'));
    } finally {
      setBusy(false);
    }
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const inContest = new Set(problems.map((x) => x.id));
    return available
      .filter((x) => !inContest.has(x.id) && (x.id.toLowerCase().includes(q) || x.title.toLowerCase().includes(q)))
      .slice(0, PICKER_LIMIT);
  }, [query, available, problems]);

  const endDrag = () => { setDragIndex(null); setOverIndex(null); };

  return (
    <div className={styles.panel}>
      {!editable && (
        <InlineNotice tone="neutral">Problems can&apos;t be added or removed after the contest ends.</InlineNotice>
      )}
      {error && <InlineError message={error} />}
      {problems.length === 0 ? (
        <p className={styles.muted}>No problems yet. Add one below — students see them as A, B, C… in this order.</p>
      ) : (
        <ol className={styles.problemList} aria-label="Contest problems in order">
          {problems.map((problem, index) => (
            <li
              key={problem.id}
              className={[styles.problemRow, overIndex === index && dragIndex !== null && dragIndex !== index ? styles.dropTarget : ''].filter(Boolean).join(' ')}
              draggable={editable}
              onDragStart={editable ? (e) => {
                setDragIndex(index);
                e.dataTransfer?.setData('text/plain', problem.id);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
              } : undefined}
              onDragOver={editable ? (e) => { e.preventDefault(); setOverIndex(index); } : undefined}
              onDrop={editable ? (e) => {
                e.preventDefault();
                const from = dragIndex;
                endDrag();
                if (from !== null) void reorder(from, index);
              } : undefined}
              onDragEnd={editable ? endDrag : undefined}
            >
              {editable && (
                <button type="button" className={styles.handle} aria-label={`Drag ${problem.id} to reorder`} title="Drag to reorder">
                  <DotsSixVertical size={16} aria-hidden="true" />
                </button>
              )}
              <span className={styles.letter}>{problemLetter(index)}</span>
              <span className={styles.problemTitle}>{problem.title}</span>
              <span className={styles.problemId}>{problem.id}</span>
              {editable && (
                <span className={styles.rowTools}>
                  <ActionMenu
                    label={`More actions for ${problem.id}`}
                    items={[
                      { key: 'up', label: 'Move up', disabled: index === 0, onClick: () => { void reorder(index, index - 1); } },
                      { key: 'down', label: 'Move down', disabled: index === problems.length - 1, onClick: () => { void reorder(index, index + 1); } },
                    ]}
                  />
                  <button type="button" className={styles.remove} aria-label={`Remove ${problem.id}`} onClick={() => setRemoving(problem)}>
                    <X size={14} aria-hidden="true" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {editable && (
        <div className={styles.picker}>
          <input
            type="search"
            role="combobox"
            aria-label="Add a problem by id or title…"
            aria-expanded={matches.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            placeholder="Add a problem by id or title…"
            className={styles.input}
            value={query}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
          />
          {matches.length > 0 && (
            <ul id={listboxId} role="listbox" className={styles.options} aria-label="Matching problems">
              {matches.map((x) => (
                <li key={x.id} role="option" aria-selected={false} className={styles.option} tabIndex={0}
                  onClick={() => { void add(x); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void add(x); } }}
                >
                  <span className={styles.problemTitle}>{x.title}</span>
                  <span className={styles.problemId}>{x.id}</span>
                </li>
              ))}
            </ul>
          )}
          {query.trim() !== '' && matches.length === 0 && (
            <p className={styles.muted}>No problem outside a contest matches “{query.trim()}”.</p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={removing !== null}
        tier="plain"
        title={`Remove ${removing?.title ?? ''}?`}
        body="Removing it from this contest returns it to the practice set with the visibility it had before."
        confirmLabel="Remove problem"
        busy={busy}
        onConfirm={() => { void remove(); }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

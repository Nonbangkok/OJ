import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button, EmptyState, FileDrop, InlineError, InlineNotice, PageHeader, StatusBadge, useToast,
} from '../../../components/ui';
import lessonsAdminService from '../../../services/admin/lessonsAdminService';
import { getErrorMessage } from '../../../utils/error';
import { trackPath } from '../../learn/paths';
import { LESSON_BUNDLE_MAX_BYTES } from '../../../config/upload';
import type { AdminLessonOverview, LessonImportPlan } from '../../../types';
import styles from './LessonsAdmin.module.css';

const WHEN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

interface Overview { attempt: number; data: AdminLessonOverview | null; error: string | null }

type ImportState =
  | { step: 'idle' }
  | { step: 'checking'; file: File }
  | { step: 'checked'; file: File; plan: LessonImportPlan; notice?: string }
  | { step: 'importing'; file: File; plan: LessonImportPlan }
  | { step: 'failed'; message: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const changeCount = (plan: LessonImportPlan) =>
  plan.lessons.added.length + plan.lessons.changed.length + plan.lessons.removed.length;

function DiffTable({ plan }: { plan: LessonImportPlan }) {
  const rows = [
    ...plan.lessons.added.map((item) => ({ ...item, kind: 'Added' as const, note: '' })),
    ...plan.lessons.changed.map((item) => ({ ...item, kind: 'Changed' as const, note: '' })),
    ...plan.lessons.removed.map((item) => ({
      ...item,
      kind: 'Removed' as const,
      note: item.usersWithProgress > 0
        ? `${item.usersWithProgress} ${item.usersWithProgress === 1 ? 'learner loses' : 'learners lose'} their progress on this lesson`
        : '',
    })),
  ];
  if (rows.length === 0) return <p className={styles.muted}>No lesson changes. Track and module details are still updated.</p>;
  const tone = { Added: 'success', Changed: 'neutral', Removed: 'danger' } as const;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr><th scope="col">Change</th><th scope="col">Slug</th><th scope="col">Lesson</th><th scope="col">Track › module</th><th scope="col">Note</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.kind}-${row.slug}`} className={row.kind === 'Removed' ? styles.removedRow : undefined}>
              <td><StatusBadge tone={tone[row.kind]} soft>{row.kind}</StatusBadge></td>
              <td className={styles.mono}>{row.slug}</td>
              <td className={styles.strong}>{row.title}</td>
              <td>{`${row.track} › ${row.module}`}</td>
              <td className={row.note ? styles.danger : styles.muted}>{row.note || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportPanel({ onImported }: { onImported: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<ImportState>({ step: 'idle' });
  const [confirmed, setConfirmed] = useState(false);

  const check = async (file: File) => {
    setConfirmed(false);
    setState({ step: 'checking', file });
    try {
      const outcome = await lessonsAdminService.importLessonBundle(file, { dryRun: true });
      setState({ step: 'checked', file, plan: outcome.plan });
    } catch (error) {
      setState({ step: 'failed', message: getErrorMessage(error, 'The bundle could not be checked.') });
    }
  };

  const apply = async (file: File, plan: LessonImportPlan) => {
    setState({ step: 'importing', file, plan });
    try {
      const outcome = await lessonsAdminService.importLessonBundle(file, { dryRun: false, confirmRemovals: confirmed });
      if (outcome.kind === 'imported') {
        const n = changeCount(outcome.plan);
        toast.show(n === 0 ? 'Bundle imported. No lessons changed.' : `Bundle imported: ${n} ${n === 1 ? 'lesson' : 'lessons'} changed.`, { tone: 'success' });
        setState({ step: 'idle' });
        onImported();
        return;
      }
      // The database changed since the dry run (or the bundle is invalid): show the fresh plan.
      setState({ step: 'checked', file, plan: outcome.plan, notice: outcome.kind === 'invalid' || outcome.kind === 'needs_confirmation' ? outcome.message : undefined });
    } catch (error) {
      setState({ step: 'failed', message: getErrorMessage(error, 'The import failed. Nothing was changed.') });
    }
  };

  const plan = state.step === 'checked' || state.step === 'importing' ? state.plan : null;
  const file = state.step === 'checked' || state.step === 'importing' || state.step === 'checking' ? state.file : null;
  const removalsWithProgress = plan?.lessons.removed.filter((item) => item.usersWithProgress > 0) ?? [];
  const learnersAffected = removalsWithProgress.reduce((sum, item) => sum + item.usersWithProgress, 0);
  const blocked = !plan || plan.issues.length > 0 || (removalsWithProgress.length > 0 && !confirmed);

  return (
    <section className={styles.panel} aria-labelledby="lesson-import">
      <h2 id="lesson-import" className={styles.panelTitle}>Import bundle</h2>
      <FileDrop
        label="Drop lessons-bundle.zip here or choose a file"
        hint="Built with lessons/run.sh build in CP-Author · up to 25 MB"
        accept={['.zip']}
        maxBytes={LESSON_BUNDLE_MAX_BYTES}
        disabled={state.step === 'checking' || state.step === 'importing'}
        onFiles={([picked]) => { void check(picked); }}
      />

      {file && (
        <p className={styles.fileLine}>
          <span className={styles.mono}>{file.name}</span>
          <span className={styles.muted}>{`${(file.size / (1024 * 1024)).toFixed(1)} MB`}</span>
          {plan?.sourceCommit && <span className={styles.muted}>{`CP-Author@${plan.sourceCommit.slice(0, 7)}`}</span>}
          {state.step === 'checking' && <span className={styles.muted} aria-live="polite">Checking…</span>}
          {plan && plan.issues.length === 0 && <StatusBadge tone="success" soft>Checked</StatusBadge>}
        </p>
      )}

      {state.step === 'failed' && <InlineError message={state.message} />}
      {state.step === 'checked' && state.notice && <InlineNotice tone="warning">{state.notice}</InlineNotice>}

      {plan && plan.issues.length > 0 && (
        <div className={styles.issues} role="alert">
          <p className={styles.issuesTitle}>{`${plan.issues.length} ${plan.issues.length === 1 ? 'problem' : 'problems'} in this bundle — nothing will be imported until they are fixed in CP-Author.`}</p>
          <ul>
            {plan.issues.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}><span className={styles.mono}>{issue.path}</span>{` — ${issue.message}`}</li>
            ))}
          </ul>
        </div>
      )}

      {plan && plan.issues.length === 0 && (
        <>
          <p className={styles.summary}>
            <span className={styles.sectionLabel}>Dry run</span>
            <StatusBadge tone="success" soft>{`+${plan.lessons.added.length} added`}</StatusBadge>
            <StatusBadge tone="neutral" soft>{`~${plan.lessons.changed.length} changed`}</StatusBadge>
            <StatusBadge tone="danger" soft>{`−${plan.lessons.removed.length} removed`}</StatusBadge>
            <span className={styles.muted}>{`${plan.lessons.unchanged} unchanged`}</span>
            {plan.tracks.added.length > 0 && <span className={styles.muted}>{`New tracks: ${plan.tracks.added.join(', ')}`}</span>}
            {plan.tracks.removed.length > 0 && <span className={styles.danger}>{`Removed tracks: ${plan.tracks.removed.join(', ')}`}</span>}
          </p>
          <DiffTable plan={plan} />
        </>
      )}

      {plan && (
        <div className={styles.confirmRow}>
          {removalsWithProgress.length > 0 && plan.issues.length === 0 && (
            <label className={styles.checkbox}>
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              {`Delete ${removalsWithProgress.length} ${removalsWithProgress.length === 1 ? 'lesson' : 'lessons'} — ${learnersAffected} completion ${learnersAffected === 1 ? 'record' : 'records'} will be lost`}
            </label>
          )}
          <span className={styles.spacer} />
          <Button variant="secondary" onClick={() => { setState({ step: 'idle' }); setConfirmed(false); }} disabled={state.step === 'importing'}>Cancel</Button>
          <Button
            onClick={() => { if (plan && file) void apply(file, plan); }}
            disabled={blocked}
            disabledReason={plan.issues.length > 0 ? 'Fix the problems in the bundle first' : removalsWithProgress.length > 0 && !confirmed ? 'Confirm the removals first' : undefined}
            loading={state.step === 'importing'}
            loadingLabel="Importing…"
          >
            Import
          </Button>
        </div>
      )}
    </section>
  );
}

/** Manage › Lessons (staff/admin): import a CP-Author bundle, show or hide tracks, see past imports. */
export default function LessonsAdminPage() {
  const toast = useToast();
  const [attempt, setAttempt] = useState(0);
  const [overview, setOverview] = useState<Overview>({ attempt: -1, data: null, error: null });
  const [busyTrack, setBusyTrack] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    lessonsAdminService.getLessonOverview().then(
      (data) => { if (!cancelled) setOverview({ attempt, data, error: null }); },
      (error: unknown) => { if (!cancelled) setOverview({ attempt, data: null, error: getErrorMessage(error, 'Failed to load lessons.') }); },
    );
    return () => { cancelled = true; };
  }, [attempt]);

  const reload = () => setAttempt((n) => n + 1);
  const data = overview.data;
  const lessonCount = data?.tracks.reduce((sum, t) => sum + t.lesson_count, 0) ?? 0;
  const last = data?.imports[0];

  const toggleTrack = async (id: number, isVisible: boolean) => {
    setBusyTrack(id);
    try {
      await lessonsAdminService.setLessonTrackVisibility(id, isVisible);
      setOverview((state) => (state.data ? {
        ...state,
        data: { ...state.data, tracks: state.data.tracks.map((t) => (t.id === id ? { ...t, is_visible: isVisible } : t)) },
      } : state));
    } catch (error) {
      toast.show(getErrorMessage(error, 'Failed to update the track.'), { tone: 'danger' });
    } finally {
      setBusyTrack(null);
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={[{ label: 'Manage' }]}
        title="Lessons"
        meta={data ? [
          `${data.tracks.length} ${data.tracks.length === 1 ? 'track' : 'tracks'} · ${lessonCount} ${lessonCount === 1 ? 'lesson' : 'lessons'}`,
          last ? `last import ${WHEN.format(new Date(last.created_at))}${last.imported_by ? ` by ${last.imported_by}` : ''}` : 'never imported',
        ].join(' · ') : undefined}
        actions={<Link to="/learn" className={styles.headerLink}>Open Learn</Link>}
      />

      <ImportPanel onImported={reload} />

      {overview.error && <InlineError message={overview.error} onRetry={reload} />}
      {!data && !overview.error && <p className={styles.muted} aria-live="polite">Loading lessons…</p>}

      {data && (
        <div className={styles.columns}>
          <section aria-labelledby="lesson-tracks" className={styles.section}>
            <h2 id="lesson-tracks" className={styles.sectionLabel}>Tracks</h2>
            {data.tracks.length === 0 ? (
              <EmptyState title="No tracks yet" description="Import a bundle to create them." />
            ) : (
              <ul className={styles.rows}>
                {data.tracks.map((track) => (
                  <li key={track.id} className={styles.row}>
                    <span className={styles.rowText}>
                      <Link to={trackPath(track.slug)} className={styles.strong}>{track.title}</Link>
                      <span className={styles.muted}>{`${track.slug} · ${plural(track.module_count, 'module')} · ${plural(track.lesson_count, 'lesson')}`}</span>
                    </span>
                    <StatusBadge tone={track.is_visible ? 'success' : 'neutral'} soft>{track.is_visible ? 'Visible' : 'Hidden'}</StatusBadge>
                    <Button
                      size="compact"
                      variant="secondary"
                      loading={busyTrack === track.id}
                      loadingLabel="Saving…"
                      onClick={() => { void toggleTrack(track.id, !track.is_visible); }}
                      aria-label={`${track.is_visible ? 'Hide' : 'Show'} ${track.title}`}
                    >
                      {track.is_visible ? 'Hide' : 'Show'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="lesson-imports" className={styles.section}>
            <h2 id="lesson-imports" className={styles.sectionLabel}>Import history</h2>
            {data.imports.length === 0 ? (
              <p className={styles.muted}>No imports yet.</p>
            ) : (
              <ul className={styles.rows}>
                {data.imports.map((item) => (
                  <li key={item.id} className={styles.row}>
                    <span className={styles.mono}>{`#${item.id}`}</span>
                    <span className={styles.rowText}>
                      <span>{WHEN.format(new Date(item.created_at))}</span>
                      <span className={styles.muted}>{item.imported_by ?? 'deleted user'}</span>
                    </span>
                    {item.source_commit && <span className={styles.mono}>{item.source_commit.slice(0, 7)}</span>}
                    <span className={styles.mono}>{`+${item.added} ~${item.changed} −${item.removed}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

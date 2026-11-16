import { useEffect, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { Button, ConfirmDialog, EmptyState, InlineError, PageHeader, StatusBadge } from '../../../components/ui';
import buttonStyles from '../../../components/ui/Button.module.css';
import adminService from '../../../services/adminService';
import { getErrorMessage, getErrorStatus } from '../../../utils/error';
import { useAuth } from '../../../context/AuthContext';
import ProblemGeneralTab from './ProblemGeneralTab';
import ProblemStatementTab from './ProblemStatementTab';
import ProblemDangerTab from './ProblemDangerTab';
import ProblemTestcasesTab from './ProblemTestcasesTab';
import ProblemGraderTab from './ProblemGraderTab';
import {
  TYPE_LOCK_MESSAGE, changedFields, fieldErrorsFrom400, formFromDetail, isFormDirty, validateForm,
  type AdminProblemEditorDetail, type FieldErrors, type ProblemEditorForm,
} from './problemEditorForm';
import styles from './ProblemEditor.module.css';

type EditorTab = 'general' | 'statement' | 'testcases' | 'grader' | 'danger';
const TAB_LABELS: Record<EditorTab, string> = {
  general: 'General', statement: 'Statement', testcases: 'Testcases', grader: 'Grader files', danger: 'Danger zone',
};
const SAVED_MS = 3000;

/** Full-page problem editor (§7.8) at /admin/problems/:problemId/:tab?. */
export default function ProblemEditPage() {
  const { problemId = '' } = useParams();
  // A fresh editor per problem id (including after a rename), so no state leaks between problems.
  return <ProblemEditor key={problemId} />;
}

function ProblemEditor() {
  const { problemId = '', tab: tabParam } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = `/admin/problems/${encodeURIComponent(problemId)}`;

  const [detail, setDetail] = useState<AdminProblemEditorDetail | null>(null);
  const [loadError, setLoadError] = useState<{ status?: number; message: string } | null>(null);
  const [saved, setSaved] = useState<ProblemEditorForm | null>(null);
  const [form, setForm] = useState<ProblemEditorForm | null>(null);
  const [authors, setAuthors] = useState<Array<{ id: number; username: string }>>([]);
  const [collections, setCollections] = useState<Array<{ id: number; name: string }>>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [lockedBy409, setLockedBy409] = useState(false);
  const [visibilityConfirm, setVisibilityConfirm] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  // Where to go once the form is clean again (after a delete or an id rename).
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminService.getProblemDetail(problemId)
      .then((data) => {
        if (cancelled) return;
        const next = data as AdminProblemEditorDetail;
        setDetail(next);
        setSaved(formFromDetail(next));
        setForm(formFromDetail(next));
      })
      .catch((err) => {
        if (!cancelled) setLoadError({ status: getErrorStatus(err), message: getErrorMessage(err, 'Failed to load the problem.') });
      });
    return () => { cancelled = true; };
  }, [problemId]);

  useEffect(() => {
    adminService.getAuthors().then((list) => setAuthors(list ?? [])).catch(() => setAuthors([]));
    adminService.getCollections().then((list) => setCollections(list ?? [])).catch(() => setCollections([]));
  }, []);

  const savedType = detail?.problem_type ?? 'standard';

  useEffect(() => {
    if (savedAt === null) return undefined;
    const timer = setTimeout(() => setSavedAt(null), SAVED_MS);
    return () => clearTimeout(timer);
  }, [savedAt]);

  const dirty = saved !== null && form !== null && isFormDirty(saved, form);
  const inThisProblem = (pathname: string) => pathname === base || pathname.startsWith(`${base}/`);
  const blocker = useBlocker(({ nextLocation }) => dirty && !inThisProblem(nextLocation.pathname));

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (leaveTo !== null && !dirty) navigate(leaveTo, { replace: true });
  }, [leaveTo, dirty, navigate]);

  if (loadError) {
    return (
      <div className={styles.page}>
        <PageHeader breadcrumb={[{ label: 'Manage' }, { label: 'Problems', to: '/admin/problems' }, { label: problemId }]} title={problemId} />
        {loadError.status === 404
          ? <EmptyState title="Problem not found" description="It may have been deleted or renamed." action={<Link to="/admin/problems">Back to problems</Link>} />
          : <InlineError message={loadError.message} />}
      </div>
    );
  }
  if (!detail || !form || !saved) {
    return <div className={styles.page}><p className={styles.muted} aria-live="polite">Loading problem…</p></div>;
  }

  const tabs: EditorTab[] = ['general', 'statement', 'testcases', ...(savedType === 'header' ? ['grader' as const] : []), 'danger'];
  const tab: EditorTab = tabs.includes(tabParam as EditorTab) ? tabParam as EditorTab : 'general';
  const goTab = (key: EditorTab) => navigate(key === 'general' ? base : `${base}/${key}`);

  const visibility: 'visible' | 'hidden' | 'contest' = detail.contest_id != null ? 'contest' : detail.is_visible ? 'visible' : 'hidden';
  const visibilityLabel = { visible: 'Visible', hidden: 'Hidden', contest: 'In contest' }[visibility];
  const collectionName = collections.find((c) => c.id === saved.collection_id)?.name;
  const typeLocked = Boolean(detail.type_locked) || lockedBy409;
  const submissionCount = detail.submission_count ?? 0;

  const patch = (next: Partial<ProblemEditorForm>) => {
    setForm((prev) => (prev ? { ...prev, ...next } : prev));
    setErrors((prev) => {
      const copy = { ...prev };
      for (const key of Object.keys(next)) delete copy[key as keyof ProblemEditorForm];
      return copy;
    });
    setSaveError('');
  };

  const save = async () => {
    const clientErrors = validateForm(form);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      if (tab !== 'general') goTab('general');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      await adminService.updateProblem(saved.id, changedFields(saved, form));
      const next = { ...form, id: form.id.trim(), submission_filename: form.submission_filename.trim() };
      setSaved(next);
      setForm(next);
      setDetail((prev) => (prev ? {
        ...prev, id: next.id, title: next.title, problem_type: next.problem_type,
        submission_filename: next.problem_type === 'header' ? next.submission_filename : null,
      } : prev));
      setSavedAt(Date.now());
      if (next.id !== saved.id) {
        setLeaveTo(`/admin/problems/${encodeURIComponent(next.id)}${tab === 'general' ? '' : `/${tab}`}`);
      }
    } catch (err) {
      const status = getErrorStatus(err);
      const message = getErrorMessage(err, 'Failed to save the problem.');
      if (status === 400) {
        const fieldErrors = fieldErrorsFrom400((err as { response?: { data?: unknown } }).response?.data);
        setErrors(fieldErrors);
        if (Object.keys(fieldErrors).length === 0) setSaveError(message);
        if (tab !== 'general') goTab('general');
      } else {
        if (status === 409 && message === TYPE_LOCK_MESSAGE) {
          // The type can no longer change: put the locked fields back so the other edits can still be saved.
          setLockedBy409(true);
          setForm((prev) => (prev ? { ...prev, problem_type: saved.problem_type, submission_filename: saved.submission_filename } : prev));
        }
        setSaveError(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleVisibility = async () => {
    setVisibilityBusy(true);
    try {
      await adminService.updateProblemVisibility(detail.id, !detail.is_visible);
      setDetail((prev) => (prev ? { ...prev, is_visible: !prev.is_visible } : prev));
      setVisibilityConfirm(false);
    } catch (err) {
      setSaveError(getErrorMessage(err, 'Failed to change visibility.'));
      setVisibilityConfirm(false);
    } finally {
      setVisibilityBusy(false);
    }
  };

  const hiding = Boolean(detail.is_visible);

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={[{ label: 'Manage' }, { label: 'Problems', to: '/admin/problems' }, { label: detail.id }]}
        title={<>{detail.title} <StatusBadge soft>{savedType === 'header' ? 'HEADER' : 'STANDARD'}</StatusBadge></>}
        meta={`${detail.id} · ${visibilityLabel}${collectionName ? ` · in collection ${collectionName}` : ''}`}
        actions={(
          <>
            {savedAt !== null && <span className={styles.saved} role="status">Saved</span>}
            <Link
              to={`/problems/${encodeURIComponent(detail.id)}`}
              className={['oj-button', buttonStyles.button, buttonStyles.secondary, styles.linkButton].join(' ')}
            >
              View as student
            </Link>
            <Button onClick={() => { void save(); }} disabled={!dirty || saving} loading={saving} loadingLabel="Saving…">Save</Button>
          </>
        )}
        tabs={(
          <div className={styles.tabs} role="tablist" aria-label="Problem sections">
            {tabs.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? styles.tabActive : styles.tab}
                onClick={() => goTab(key)}
              >
                {TAB_LABELS[key]}
              </button>
            ))}
          </div>
        )}
      />

      {saveError && <InlineError message={saveError} />}

      <div role="tabpanel" aria-label={TAB_LABELS[tab]}>
        {tab === 'general' && (
          <ProblemGeneralTab
            form={form}
            errors={errors}
            onChange={patch}
            authors={authors}
            collections={collections}
            typeLocked={typeLocked}
            submissionCount={submissionCount}
            visibility={visibility}
            onToggleVisibility={() => setVisibilityConfirm(true)}
          />
        )}
        {tab === 'statement' && (
          <ProblemStatementTab
            problemId={detail.id}
            hasPdf={Boolean(detail.has_pdf)}
            onReplaced={() => setDetail((prev) => (prev ? { ...prev, has_pdf: true } : prev))}
          />
        )}
        {tab === 'testcases' && (
          <ProblemTestcasesTab problemId={detail.id} submissionCount={submissionCount} canRejudge={user?.role === 'admin'} />
        )}
        {tab === 'grader' && <ProblemGraderTab problemId={detail.id} />}
        {tab === 'danger' && (
          <ProblemDangerTab
            problemId={detail.id}
            title={detail.title}
            submissionCount={submissionCount}
            onDeleted={() => { setForm(saved); setLeaveTo('/admin/problems'); }}
          />
        )}
      </div>

      <ConfirmDialog
        open={visibilityConfirm}
        tier="plain"
        title={`${hiding ? 'Hide' : 'Show'} ${detail.title}?`}
        body={hiding
          ? 'Students stop seeing it in the problem list. Submissions and testcases are kept.'
          : 'Students can open it from the problem list and submit.'}
        confirmLabel={hiding ? 'Hide problem' : 'Show problem'}
        busy={visibilityBusy}
        onConfirm={() => { void toggleVisibility(); }}
        onCancel={() => setVisibilityConfirm(false)}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        tier="destructive"
        title="Discard unsaved changes?"
        body="Your edits to this problem haven't been saved."
        confirmLabel="Discard changes"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </div>
  );
}

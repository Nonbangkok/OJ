import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../../services/api';
import { getErrorMessage, toApiLikeError } from '../../../utils/error';
import { Draft, DraftFields, draftBase, editableFields, isActive, Job } from './types';

type AuthoringDraftOptions = { allowPublishedStatementEdit?: boolean };

export const AUTOSAVE_DELAY_MS = 1200;

// Crash-recovery snapshot for every editable field (statement recovery lives in
// the statement editor). Best-effort: browser storage is an aid, never a
// prerequisite for editing.
type DraftRecovery = { baseRevision: number; fields: Partial<DraftFields> };

const recoveryKey = (id: string) => `oj-authoring-draft:${id}`;

function readRecovery(id: string): DraftRecovery | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(recoveryKey(id)) || 'null');
    if (!Number.isInteger(value?.baseRevision) || typeof value?.fields !== 'object' || value?.fields === null) return null;
    return value;
  } catch { return null; }
}

function writeRecovery(id: string, recovery: DraftRecovery | null) {
  try {
    if (recovery) window.sessionStorage.setItem(recoveryKey(id), JSON.stringify(recovery));
    else window.sessionStorage.removeItem(recoveryKey(id));
  } catch { /* Recovery is best-effort. */ }
}

export default function useAuthoringDraft(id: string, pollMs = 3000, options: AuthoringDraftOptions = {}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState<Draft | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [recovered, setRecovered] = useState(false);
  const recoveryHandled = useRef(false);
  const busyRef = useRef(false);
  const epoch = useRef(0);
  const setOperationBusy = useCallback((value: boolean) => {
    epoch.current++; busyRef.current = value; setBusy(value);
  }, []);
  const dirty = !!draft && !!form && editableFields.some(key => draft[key] !== form[key]);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const activeJob = jobs.find(isActive);
  const activeJobId = activeJob?.id;
  const actionsDisabled = !loaded || !draft || busy || dirty || conflict || !!activeJob || draft.status === 'published';
  const canPublish = !actionsDisabled && draft?.status === 'ready' && draft.verifiedRevision === draft.revision
    && draft.hasLatestPdf && draft.latestPdfRevision === draft.revision;

  const onError = useCallback((err: unknown) => {
    const code = toApiLikeError(err).response?.data?.code;
    setError(getErrorMessage(err, 'Request failed. Retry when the connection is available.'));
    if (code === 'revision_conflict') setConflict(true);
  }, []);

  const refresh = useCallback(async (discard = false) => {
    const current = ++epoch.current;
    const [detail, history] = await Promise.all([api.get<Draft>(draftBase(id)), api.get<Job[]>(`${draftBase(id)}/jobs`)]);
    if (current !== epoch.current) return;
    setJobs(history.data); setLoaded(true);
    if (discard || !dirtyRef.current) {
      setDraft(detail.data); setForm(detail.data); setConflict(false); setError(''); dirtyRef.current = false;
    } else setDraft(previous => {
      if (previous && previous.revision !== detail.data.revision) setConflict(true);
      return previous;
    });
  }, [id]);

  async function discardAndRefresh() {
    if (busyRef.current) return;
    setOperationBusy(true);
    try { await refresh(true); } catch (err) { onError(err); }
    finally { setOperationBusy(false); }
  }

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const current = epoch.current;
        const [detail, history] = await Promise.all([api.get<Draft>(draftBase(id)), api.get<Job[]>(`${draftBase(id)}/jobs`)]);
        if (!cancelled && !busyRef.current && current === epoch.current) {
          setJobs(history.data); setLoaded(true); setError('');
          // One-time crash recovery: restore unsaved edits captured before the tab closed.
          // A recovery captured against an older server revision raises the same
          // conflict state as restoreStatement, so the user keeps editing and decides.
          // The full-screen statement editor owns statementHtml recovery itself.
          // The full-screen statement editor (allowPublishedStatementEdit mode)
          // runs its own statement recovery; leave statementHtml to it there.
          const statementOwnedByEditor = !!options.allowPublishedStatementEdit;
          const recovery = recoveryHandled.current ? null : readRecovery(id);
          recoveryHandled.current = true;
          const restorable = recovery && detail.data.status !== 'published'
            ? Object.fromEntries(Object.entries(recovery.fields)
              .filter(([key]) => key !== 'statementHtml' || !statementOwnedByEditor)) : null;
          if (recovery && restorable && Object.keys(restorable).some(key =>
            restorable[key as keyof DraftFields] !== detail.data[key as keyof DraftFields])) {
            dirtyRef.current = true;
            setDraft(detail.data);
            setForm({ ...detail.data, ...restorable });
            setRecovered(true);
            if (recovery.baseRevision !== detail.data.revision) setConflict(true);
            return;
          }
          writeRecovery(id, null);
          setDraft(detail.data); setForm(detail.data);
        }
      } catch (err) { if (!cancelled) { onError(err); setLoaded(false); } }
    };
    void load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, onError]);

  useEffect(() => {
    const sync = () => {
      if (document.visibilityState !== 'visible' || busyRef.current) return;
      void refresh().catch(onError);
    };
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [refresh, onError]);

  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (!busyRef.current) {
          const current = epoch.current;
          const [detail, history] = await Promise.all([api.get<Draft>(draftBase(id)), api.get<Job[]>(`${draftBase(id)}/jobs`)]);
          if (!cancelled && !busyRef.current && current === epoch.current) {
            setJobs(history.data); setLoaded(true); setError('');
            // An in-flight poll must never replace text typed while the request was pending.
            if (!dirtyRef.current) { setDraft(detail.data); setForm(detail.data); }
            else setDraft(previous => {
              if (previous && previous.revision !== detail.data.revision) setConflict(true);
              return previous;
            });
          }
        }
      } catch (err) { if (!cancelled) { onError(err); setLoaded(false); } }
      if (!cancelled) timer = setTimeout(poll, pollMs);
    };
    timer = setTimeout(poll, pollMs);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, pollMs, onError, activeJobId]);

  function edit<K extends keyof DraftFields>(key: K, value: DraftFields[K]) {
    const canEditPublishedStatement = options.allowPublishedStatementEdit && key === 'statementHtml';
    if (busyRef.current || activeJob || (draft?.status === 'published' && !canEditPublishedStatement)) return;
    dirtyRef.current = true;
    setForm(previous => {
      if (!previous) return previous;
      const next = { ...previous, [key]: value };
      // Keep the recovery snapshot in sync with unsaved edits.
      const changes = Object.fromEntries(editableFields.filter(k => draft?.[k] !== next[k]).map(k => [k, next[k]]));
      writeRecovery(id, Object.keys(changes).length ? { baseRevision: draft?.revision ?? 0, fields: changes } : null);
      return next;
    });
  }
  function restoreStatement(statementHtml: string, baseRevision: number) {
    if (!draft || !form || statementHtml === form.statementHtml) return;
    dirtyRef.current = true;
    setForm(previous => previous ? { ...previous, statementHtml } : previous);
    if (baseRevision !== draft.revision) setConflict(true);
  }
  async function save() {
    if (!draft || !form || !dirty || busyRef.current || activeJob || conflict || !loaded) return;
    const changes = Object.fromEntries(editableFields.filter(key => draft[key] !== form[key]).map(key => [key, form[key]]));
    const canSavePublishedStatement = options.allowPublishedStatementEdit && draft.status === 'published'
      && Object.keys(changes).length === 1 && changes.statementHtml !== undefined;
    if (draft.status === 'published' && !canSavePublishedStatement) return;
    setOperationBusy(true); setError(''); setSaveState('saving');
    try {
      const result = await api.patch<Draft>(draftBase(id), { expectedRevision: draft.revision, ...changes });
      setDraft(result.data); setForm(result.data); dirtyRef.current = false; setSaveState('saved');
      writeRecovery(id, null);
    } catch (err) {
      onError(err); setSaveState('error');
      const code = toApiLikeError(err).response?.data?.code;
      if (code === 'job_active' || code === 'draft_published') {
        try { await refresh(); } catch (refreshError) { onError(refreshError); }
      }
    }
    finally { setOperationBusy(false); }
  }
  async function mutate(action: () => Promise<unknown>) {
    if (actionsDisabled || busyRef.current) return;
    setOperationBusy(true); setError('');
    try { await action(); await refresh(); } catch (err) { onError(err); }
    finally { setOperationBusy(false); }
  }
  async function runJob(action: 'compile' | 'generate' | 'outputs' | 'pdf' | 'verify', extra: { target?: string; seed?: string } = {}) {
    if (actionsDisabled || busyRef.current || !draft) return;
    setOperationBusy(true); setError('');
    try {
      const result = await api.post<Job>(`${draftBase(id)}/jobs/${action}`, { expectedRevision: draft.revision, ...extra });
      // Optimistic job state: show the queued job immediately instead of waiting for the next poll,
      // so action buttons lock right away and no stale-revision click can slip through the gap.
      setJobs(previous => [result.data, ...previous.filter(j => j.id !== result.data.id)]);
      if (action === 'verify') {
        setDraft(previous => previous ? { ...previous, status: 'draft', verifiedRevision: null } : null);
        setForm(previous => previous ? { ...previous, status: 'draft', verifiedRevision: null } : null);
      }
      // Poll immediately for the job's completion instead of waiting the full interval.
      void refresh().catch(() => { /* The active-job poll loop will retry. */ });
    } catch (err) {
      onError(err);
      const code = toApiLikeError(err).response?.data?.code;
      if (code === 'job_active' || code === 'draft_published') {
        try { await refresh(); } catch (refreshError) { onError(refreshError); }
      }
    }
    finally { setOperationBusy(false); }
  }
  async function publish() {
    if (!canPublish || !draft || busyRef.current) return;
    setOperationBusy(true); setError('');
    try {
      await api.post(`${draftBase(id)}/publish`, { expectedRevision: draft.revision });
      setDraft(previous => previous ? { ...previous, status: 'published' } : null);
      setForm(previous => previous ? { ...previous, status: 'published' } : null);
    } catch (err) { onError(err); }
    finally { setOperationBusy(false); }
  }

  // Debounced auto-save: unsaved edits persist themselves shortly after typing stops,
  // so no workflow action is blocked by a forgotten manual save.
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveRef = useRef(save);
  autosaveRef.current = save;
  const autosaveEnabled = !conflict && draft?.status !== 'published';
  useEffect(() => {
    if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null; }
    if (!dirty || !autosaveEnabled) return;
    setSaveState('dirty');
    autosaveTimer.current = setTimeout(() => { void autosaveRef.current(); }, AUTOSAVE_DELAY_MS);
    return () => { if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null; } };
  }, [dirty, autosaveEnabled, form]);
  useEffect(() => () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); }, []);
  // Flush pending auto-save when leaving the workspace.
  useEffect(() => () => {
    if (dirtyRef.current) void autosaveRef.current();
  }, []);

  return { draft, form, jobs, busy, dirty, error, conflict, loaded, activeJob, actionsDisabled, canPublish, saveState, recovered,
    edit, restoreStatement, save, refresh, discardAndRefresh, mutate, runJob, publish, onError, setOperationBusy };
}

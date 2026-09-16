import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../../services/api';
import { getErrorMessage, toApiLikeError } from '../../../utils/error';
import { Draft, DraftFields, draftBase, editableFields, isActive, Job } from './types';

export default function useAuthoringDraft(id: string, pollMs = 3000) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState<Draft | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [loaded, setLoaded] = useState(false);
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
          setDraft(detail.data); setForm(detail.data);
        }
      } catch (err) { if (!cancelled) { onError(err); setLoaded(false); } }
    };
    void load();
    return () => { cancelled = true; };
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
    if (busyRef.current || activeJob || draft?.status === 'published') return;
    dirtyRef.current = true;
    setForm(previous => previous ? { ...previous, [key]: value } : null);
  }
  function restoreStatement(statementHtml: string, baseRevision: number) {
    if (!draft || !form || statementHtml === form.statementHtml) return;
    dirtyRef.current = true;
    setForm(previous => previous ? { ...previous, statementHtml } : null);
    if (baseRevision !== draft.revision) setConflict(true);
  }
  async function save() {
    if (!draft || !form || !dirty || busyRef.current || activeJob || conflict || !loaded || draft.status === 'published') return;
    setOperationBusy(true); setError('');
    const changes = Object.fromEntries(editableFields.filter(key => draft[key] !== form[key]).map(key => [key, form[key]]));
    try {
      const result = await api.patch<Draft>(draftBase(id), { expectedRevision: draft.revision, ...changes });
      setDraft(result.data); setForm(result.data); dirtyRef.current = false;
    } catch (err) {
      onError(err);
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
      setJobs(previous => [result.data, ...previous.filter(j => j.id !== result.data.id)]);
      if (action === 'verify') {
        setDraft(previous => previous ? { ...previous, status: 'draft', verifiedRevision: null } : null);
        setForm(previous => previous ? { ...previous, status: 'draft', verifiedRevision: null } : null);
      }
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
  return { draft, form, jobs, busy, dirty, error, conflict, loaded, activeJob, actionsDisabled, canPublish,
    edit, restoreStatement, save, refresh, discardAndRefresh, mutate, runJob, publish, onError, setOperationBusy };
}

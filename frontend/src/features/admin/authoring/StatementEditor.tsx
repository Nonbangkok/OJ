import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../services/api';
import useAuthoringDraft from './useAuthoringDraft';
import { draftBase } from './types';
import { StatementAssets } from './StatementTab';
import styles from './Authoring.module.css';

const PREVIEW_DELAY_MS = 400;
const recoveryKey = (id: string) => `oj-authoring-statement:${id}`;

type StatementRecovery = { baseRevision: number; statementHtml: string };

function readRecovery(id: string): StatementRecovery | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(recoveryKey(id)) || 'null');
    return Number.isInteger(value?.baseRevision) && typeof value?.statementHtml === 'string' ? value : null;
  } catch { return null; }
}

function writeRecovery(id: string, recovery: StatementRecovery | null) {
  try {
    if (recovery) window.sessionStorage.setItem(recoveryKey(id), JSON.stringify(recovery));
    else window.sessionStorage.removeItem(recoveryKey(id));
  } catch { /* Browser storage is a recovery aid, never a prerequisite for editing. */ }
}

export default function StatementEditor({ id }: { id: string }) {
  const model = useAuthoringDraft(id);
  const { draft, form, dirty } = model;
  const [preview, setPreview] = useState('');
  const [previewState, setPreviewState] = useState<'waiting' | 'loading' | 'ready' | 'error'>('waiting');
  const [previewError, setPreviewError] = useState('');
  const [recovered, setRecovered] = useState(false);
  const request = useRef(0);
  const recoveryHandled = useRef(false);
  const recoveryBaseRevision = useRef<number | null>(null);
  const wasDirty = useRef(false);
  const draftId = draft?.id;
  const draftRevision = draft?.revision;
  const statementSource = form?.statementHtml;

  useEffect(() => {
    if (recoveryHandled.current || !draft || !form) return;
    recoveryHandled.current = true;
    const recovery = readRecovery(id);
    if (!recovery || recovery.statementHtml === form.statementHtml) {
      recoveryBaseRevision.current = draft.revision;
      writeRecovery(id, null);
      return;
    }
    recoveryBaseRevision.current = recovery.baseRevision;
    model.restoreStatement(recovery.statementHtml, recovery.baseRevision);
    setRecovered(true);
  }, [draft, form, id, model]);

  useEffect(() => {
    if (!recoveryHandled.current) return;
    if (dirty) wasDirty.current = true;
    else if (wasDirty.current) {
      writeRecovery(id, null); recoveryBaseRevision.current = draftRevision ?? null;
      wasDirty.current = false; setRecovered(false);
    }
  }, [dirty, draftRevision, id]);

  useEffect(() => {
    if (!draftId || statementSource === undefined) return;
    const current = ++request.current;
    setPreviewState('waiting'); setPreviewError('');
    const timer = window.setTimeout(async () => {
      setPreviewState('loading');
      try {
        const response = await api.post<{ html: string }>(`${draftBase(draftId)}/preview`,
          { statementHtml: statementSource });
        if (current === request.current) { setPreview(response.data.html); setPreviewState('ready'); }
      } catch {
        if (current === request.current) {
          setPreviewState('error'); setPreviewError('Preview could not be updated. Your source is unchanged.');
        }
      }
    }, PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draftId, draftRevision, statementSource]);

  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);

  if (!draft || !form) return <main className={styles.editorShell}>
    {model.error ? <p role="alert">{model.error}</p> : <p role="status">Loading editor…</p>}
  </main>;

  const editorDisabled = model.busy || !!model.activeJob || draft.status === 'published';
  return <main className={styles.editorShell}>
    <header className={styles.editorHeader}>
      <Link to={`/admin/authoring/${encodeURIComponent(id)}`} onClick={event => {
        if (!dirty) return;
        if (!window.confirm('Leave the editor without saving your changes?')) event.preventDefault();
        else writeRecovery(id, null);
      }}>← Workspace</Link>
      <div className={styles.editorTitle}><h1>Edit Task: {draft.problemId}</h1><span>{draft.title}</span></div>
      <strong>{draft.status === 'published' ? 'Published — read-only' : model.conflict ? 'Server conflict' : dirty ? 'Unsaved changes' : 'Saved'}</strong>
      <button type="button" disabled={!dirty || editorDisabled || model.conflict || !model.loaded}
        onClick={() => void model.save()}>Save</button>
      <button type="button" disabled={model.actionsDisabled} onClick={() => void model.runJob('pdf')}>Build PDF</button>
    </header>
    <section className={styles.editorNotices} aria-label="Editor notices">
      {model.error && <p className={styles.editorAlert} role="alert">{model.error}</p>}
      {model.conflict && <div className={styles.editorAlert} role="alert">
        <span>Server state changed. Your unsaved source is retained.</span>
        <button type="button" disabled={model.busy} onClick={() => {
          if (window.confirm('Discard local changes and sync the latest server revision?')) void model.discardAndRefresh();
        }}>Discard local changes and sync</button>
      </div>}
      {model.activeJob && <p className={styles.editorStatus} role="status">Active job: {model.activeJob.jobType} — {model.activeJob.status}</p>}
      {recovered && <p className={styles.editorStatus} role="status">Recovered unsaved statement from this browser tab.</p>}
    </section>
    <section className={styles.editorWorkspace} aria-label="Statement editor">
      <div className={styles.sourcePane}>
        <label htmlFor="statement-source">Statement Markdown / HTML / LaTeX</label>
        <textarea id="statement-source" spellCheck={false} value={form.statementHtml}
          readOnly={editorDisabled} onChange={event => {
            const statementHtml = event.target.value;
            const baseRevision = dirty ? recoveryBaseRevision.current ?? draft.revision : draft.revision;
            recoveryBaseRevision.current = baseRevision;
            writeRecovery(id, { baseRevision, statementHtml });
            model.edit('statementHtml', statementHtml);
          }} />
      </div>
      <div className={styles.previewPane}>
        <div className={styles.previewStatus} role="status">
          {previewState === 'waiting' ? 'Waiting for typing to pause…' : previewState === 'loading' ? 'Updating preview…'
            : previewState === 'error' ? previewError : 'Preview is up to date'}
        </div>
        {preview ? <iframe title="Fast statement preview" sandbox="" srcDoc={preview} />
          : <div className={styles.previewEmpty}>Preview will appear here.</div>}
      </div>
    </section>
    <details className={styles.editorAssets}>
      <summary>Statement assets & syntax help</summary>
      <p>Images: <code>{'<image src="{{ASSET_BASE}}/image.png">'}</code> or <code>{'![alt]({{ASSET_BASE}}/image.png)'}</code>.</p>
      <p>Page break: <code>{'<div class="forced-page-break"></div>'}</code>. The runner-built PDF remains authoritative.</p>
      <StatementAssets draft={draft} disabled={model.actionsDisabled} mutate={model.mutate} onError={model.onError} />
    </details>
  </main>;
}

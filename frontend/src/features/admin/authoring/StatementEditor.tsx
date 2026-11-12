import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Group, Panel, Separator, useDefaultLayout, useGroupRef } from 'react-resizable-panels';
import { Button, Dialog } from '../../../components/ui';
import authoringService from '../../../services/admin/authoringService';
import useAuthoringDraft from './useAuthoringDraft';
import useStatementPreview from './useStatementPreview';
import LivePreview from './LivePreview';
import { jobLabel } from './status';
import { StatementAssets } from './StatementTab';
import styles from './Authoring.module.css';

const recoveryKey = (id: string) => `oj-authoring-statement:${id}`;
const previewZoomKey = (id: string) => `oj-authoring-statement-preview-zoom:${id}`;
const MIN_PREVIEW_ZOOM = 50;
const MAX_PREVIEW_ZOOM = 200;
const PREVIEW_ZOOM_STEP = 10;
// Preview pagination: fixed A4-ish aspect slices keep page boundaries visible.
const PREVIEW_PAGE_ASPECT = 297 / 210; // height / width of A4

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

function readPreviewZoom(id: string) {
  try {
    const zoom = Number(window.localStorage.getItem(previewZoomKey(id)));
    return Number.isFinite(zoom) && zoom >= MIN_PREVIEW_ZOOM && zoom <= MAX_PREVIEW_ZOOM ? zoom : 100;
  } catch { return 100; }
}

// Layout persistence must never crash the editor when browser storage is unavailable (private mode).
const layoutStorage = {
  getItem(key: string) {
    try {
      const value = window.localStorage.getItem(key);
      // v4 JSON.parses the string while rendering; a corrupt value must fall back to the default split.
      if (value !== null) JSON.parse(value);
      return value;
    } catch { return null; }
  },
  setItem(key: string, value: string) {
    try { window.localStorage.setItem(key, value); } catch { /* Remembering the split is optional. */ }
  },
};

function useCompactEditorLayout() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 800px)');
    if (!media) return;
    const sync = () => setCompact(media.matches);
    sync(); media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return compact;
}

/** Preview-mode tab styled entirely through inline styles: some Safari
 *  builds resolved the class/pseudo-class cascade differently and rendered
 *  the selected tab's text invisible. Inline styles outrank every CSS rule
 *  and browser default, and hover is tracked in React state, so the colors
 *  are engine-proof by construction. */
function PreviewModeTab({ selected, onSelect, children }: {
  selected: boolean; onSelect: () => void; children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const base: CSSProperties = {
    padding: '0.3rem 0.9rem',
    fontSize: '0.8rem',
    cursor: 'pointer',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    border: '1px solid #495057',
    borderBottom: 0,
  };
  const style: CSSProperties = selected
    ? { ...base, background: '#6c757d', color: '#ffffff', fontWeight: 600 }
    : hovered
      ? { ...base, background: '#0d6efd', color: '#ffffff' }
      : { ...base, background: '#212529', color: '#ffffff' };
  return <button type="button" role="tab" aria-selected={selected}
    style={style} onClick={onSelect}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setHovered(true)} onBlur={() => setHovered(false)}>
    {children}
  </button>;
}

/** Embeds the runner-built PDF. While a build job runs, the currently loaded
 *  file stays put (switching src mid-load aborts the request and can leave
 *  Chrome's viewer blank); the new revision swaps in once, after the job
 *  finishes and the refreshed draft reports it. */
function PdfEmbed({ draftId, revision, buildRunning }: { draftId: string; revision: number | null; buildRunning: boolean }) {
  // The revision actually loaded in the iframe; lags `revision` while a job runs.
  // Adjusted while rendering (not in an effect) so the swap happens in the same
  // render that sees the finished build.
  const [loadedRevision, setLoadedRevision] = useState(revision);
  if (!buildRunning && revision !== null && revision !== loadedRevision) {
    setLoadedRevision(revision);
  }
  if (loadedRevision === null) return <div className={styles.previewEmpty}>No PDF built yet.</div>;
  return <iframe title="Latest runner-built PDF" className={styles.previewPdfEmbed}
    key={loadedRevision}
    src={`${authoringService.draftPdfUrl(draftId, loadedRevision)}#view=FitH`} />;
}

export default function StatementEditor({ id }: { id: string }) {
  const model = useAuthoringDraft(id, { allowPublishedStatementEdit: true });
  const { draft, form, dirty } = model;
  const [recovered, setRecovered] = useState(false);
  const [showAssets, setShowAssets] = useState(false);
  // Live HTML shows unsaved edits instantly; the Actual PDF tab shows the
  // runner-built file, whose pagination is exact by construction.
  const [pdfMode, setPdfMode] = useState(false);
  // The PDF is stale when no build exists yet, or the draft revision moved
  // past the built one (unsaved edits count too — they are one autosave away
  // from a new revision).
  const pdfStale = !!draft && (!draft.hasLatestPdf || draft.latestPdfRevision !== draft.revision || dirty);
  const buildPdf = useCallback(() => model.runJob('pdf'), [model]);
  // Switching to the Actual PDF tab with a stale PDF builds it automatically —
  // one job at a time; the guard inside runJob prevents double submission.
  const autoBuiltRef = useRef('');
  useEffect(() => {
    if (!pdfMode || !pdfStale || model.activeJob || model.actionsDisabled) return;
    const key = `${draft?.revision}:${draft?.latestPdfRevision}`;
    if (autoBuiltRef.current === key) return; // one auto-build per stale state
    autoBuiltRef.current = key;
    void buildPdf();
  }, [pdfMode, pdfStale, model.activeJob, model.actionsDisabled, draft?.revision, draft?.latestPdfRevision, buildPdf]);
  useEffect(() => { if (!pdfStale) autoBuiltRef.current = ''; }, [pdfStale]);
  const recoveryHandled = useRef(false);
  const recoveryBaseRevision = useRef<number | null>(null);
  const wasDirty = useRef(false);
  const panels = useGroupRef();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: `oj-authoring-statement-layout:${id}`,
    storage: layoutStorage,
  });
  const compactLayout = useCompactEditorLayout();
  // While the divider is dragged, embedded documents (preview iframe / PDF embed) must not swallow the
  // pointer events, or the drag never sees its pointermove/pointerup and gets stuck.
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    if (!resizing) return;
    const stop = () => setResizing(false);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
  }, [resizing]);
  const [previewZoom, setPreviewZoom] = useState(() => readPreviewZoom(id));
  const draftId = draft?.id;
  const draftRevision = draft?.revision;
  const statementSource = form?.statementHtml;
  const preview = useStatementPreview(draftId, statementSource, draftRevision);

  useEffect(() => {
    if (recoveryHandled.current || !draft || !form) return;
    recoveryHandled.current = true;
    const recovery = readRecovery(id);
    if (!recovery) {
      recoveryBaseRevision.current = draft.revision;
      return;
    }
    // Adopt the recovery's base revision even when the hook-level draft recovery
    // already restored the same text, so continued edits keep the original base.
    recoveryBaseRevision.current = recovery.baseRevision;
    if (recovery.statementHtml === form.statementHtml) {
      writeRecovery(id, null);
      return;
    }
    model.restoreStatement(recovery.statementHtml, recovery.baseRevision);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot restore from sessionStorage once the draft loads; the notice must flip in the same step as restoreStatement
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
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);

  // Ctrl/Cmd+S saves the statement from the editor.
  const saveLatest = useEffectEvent(() => model.save());
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveLatest();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(previewZoomKey(id), String(previewZoom)); } catch { /* Preference only. */ }
  }, [id, previewZoom]);

  if (!draft || !form) return <main className={styles.editorShell}>
    {model.error ? <p role="alert">{model.error}</p> : <p role="status">Loading editor…</p>}
  </main>;

  const editorDisabled = (model.busy && model.saveState !== 'saving') || !!model.activeJob;
  const zoomScale = previewZoom / 100;
  const editorState = draft.status === 'published' ? 'Published — editing available'
    : draft.publishedAt ? 'Editing — live problem unchanged'
      : model.conflict ? 'Server conflict'
        : dirty ? (model.saveState === 'saving' ? 'Saving…' : 'Unsaved changes') : 'Saved';
  const previewStatusText = preview.state === 'waiting' ? 'Preparing live preview…' : preview.state === 'loading' ? 'Rendering live preview…'
    : preview.state === 'error' ? preview.error : 'Live preview is up to date';
  return <main className={styles.editorShell}>
    <header className={styles.editorHeader}>
      <div className={styles.editorHeaderLeft}>
        <Link to={`/admin/authoring/${encodeURIComponent(id)}`}>← Workspace</Link>
        <div className={styles.editorTitle}><h1>Edit Task: {draft.problemId}</h1></div>
      </div>
      <strong className={styles.editorStateCenter}>{editorState}</strong>
      <div className={styles.editorHeaderRight}>
        <span className={styles.previewStatusChip} role="status">{previewStatusText}</span>
        <span className={styles.previewZoomControls} aria-label="Preview zoom controls">
          <button type="button" aria-label="Zoom out" disabled={previewZoom <= MIN_PREVIEW_ZOOM}
            onClick={() => setPreviewZoom(zoom => Math.max(MIN_PREVIEW_ZOOM, zoom - PREVIEW_ZOOM_STEP))}>−</button>
          <output aria-label="Preview zoom">{previewZoom}%</output>
          <button type="button" aria-label="Zoom in" disabled={previewZoom >= MAX_PREVIEW_ZOOM}
            onClick={() => setPreviewZoom(zoom => Math.min(MAX_PREVIEW_ZOOM, zoom + PREVIEW_ZOOM_STEP))}>+</button>
          <button type="button" aria-label="Reset preview zoom" disabled={previewZoom === 100}
            onClick={() => setPreviewZoom(100)}>Reset</button>
        </span>
        <Button variant="secondary" size="compact" onClick={() => setShowAssets(true)}>Assets &amp; help</Button>
      </div>
    </header>
    <section className={styles.editorNotices} aria-label="Editor notices">
      {model.error && <p className={styles.editorAlert} role="alert">{model.error}</p>}
      {model.conflict && <div className={styles.editorAlert} role="alert">
        <span>Server state changed. Your unsaved source is retained.</span>
        <button type="button" disabled={model.busy} onClick={() => {
          if (window.confirm('Discard local changes and sync the latest server revision?')) void model.discardAndRefresh();
        }}>Discard local changes and sync</button>
      </div>}
      {model.activeJob && <p className={styles.editorStatus} role="status">Active job: {jobLabel(model.activeJob.jobType)} — {model.activeJob.status}</p>}
      {recovered && <p className={styles.editorStatus} role="status">Recovered unsaved statement from this browser tab.</p>}
    </section>
    {/* resizeTargetMinimumSize keeps v2's grab zone (8px bar +-5px mouse, +-15px touch). */}
    <Group groupRef={panels} defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}
      resizeTargetMinimumSize={{ fine: 18, coarse: 38 }}
      orientation={compactLayout ? 'vertical' : 'horizontal'} className={resizing ? `${styles.editorWorkspace} ${styles.editorWorkspaceResizing}` : styles.editorWorkspace} role="region" aria-label="Statement editor">
      <Panel id="source" defaultSize="50" minSize="25" className={styles.sourcePane}>
        <textarea id="statement-source" aria-label="Statement source" spellCheck={false} value={form.statementHtml}
          readOnly={editorDisabled} onChange={event => {
            const statementHtml = event.target.value;
            const baseRevision = dirty ? recoveryBaseRevision.current ?? draft.revision : draft.revision;
            recoveryBaseRevision.current = baseRevision;
            writeRecovery(id, { baseRevision, statementHtml });
            model.edit('statementHtml', statementHtml);
          }} />
      </Panel>
      <Separator className={styles.editorResizeHandle} aria-label="Resize source and preview panes" disableDoubleClick onPointerDown={() => setResizing(true)}
        onDoubleClick={() => panels.current?.setLayout({ source: 50, preview: 50 })} />
      <Panel id="preview" defaultSize="50" minSize="25" className={styles.previewPane}>
        <div className={styles.previewModeBar} role="tablist" aria-label="Preview mode">
          <PreviewModeTab selected={pdfMode === false} onSelect={() => setPdfMode(false)}>Live HTML</PreviewModeTab>
          <PreviewModeTab selected={pdfMode === true} onSelect={() => setPdfMode(true)}>
            Actual PDF
            {pdfStale && <span className={styles.previewStaleDot} aria-label="PDF is outdated" title="Statement changed since the last build" />}
          </PreviewModeTab>
        </div>
        <div className={styles.previewViewport}>
          {pdfMode
            ? (draft.hasLatestPdf
              ? <PdfEmbed draftId={draft.id} revision={draft.latestPdfRevision}
                buildRunning={!!model.activeJob} />
              : <div className={styles.previewEmpty}>No PDF built yet.</div>)
            : (preview.shell && preview.state !== 'error'
              ? <LivePreview shell={preview.shell} statement={preview.html} zoomScale={zoomScale} />
              : <div className={styles.previewEmpty} role={preview.state === 'error' ? 'alert' : 'status'}>
                {preview.state === 'error' ? preview.error
                  : preview.state === 'loading' ? 'Rendering live preview…' : 'Preparing live preview…'}
              </div>)}
        </div>
        {pdfMode && pdfStale && !model.activeJob && (
          <div className={styles.pdfStaleBar} role="status">
            <span>{draft.hasLatestPdf ? 'Statement changed since this PDF was built.' : 'No PDF yet.'}</span>
            <Button disabled={model.actionsDisabled} onClick={() => void buildPdf()}>Build PDF now</Button>
          </div>
        )}
      </Panel>
    </Group>
    {showAssets && <Dialog open wide title="Statement assets & syntax help"
      description={'The runner-built PDF remains authoritative.'}
      onClose={() => setShowAssets(false)}
      footer={<Button variant="secondary" onClick={() => setShowAssets(false)}>Close</Button>}>
      <div className={styles.helpList}>
        <p><strong>Image</strong> — <code>&lt;image src=&quot;&#123;&#123;ASSET_BASE&#125;&#125;/image.png&quot;&gt;</code> or <code>![alt](&#123;&#123;ASSET_BASE&#125;&#125;/image.png)</code></p>
        <p><strong>Page break</strong> — <code>&lt;div class=&quot;forced-page-break&quot;&gt;&lt;/div&gt;</code></p>
      </div>
      <StatementAssets draft={draft} disabled={model.actionsDisabled} mutate={model.mutate} onError={model.onError} />
    </Dialog>}
  </main>;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ImperativePanelGroupHandle, Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Button, Dialog } from '../../../components/ui';
import authoringService from '../../../services/admin/authoringService';
import useAuthoringDraft from './useAuthoringDraft';
import { jobLabel } from './status';
import { StatementAssets } from './StatementTab';
import styles from './Authoring.module.css';

const PREVIEW_DELAY_MS = 400;
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

/** Live HTML preview: the sanitized statement rendered in a sandboxed frame
 *  that fills the pane — continuous flow, no page slicing. The iframe is
 *  sized to the document's full rendered height (measured after load), so the
 *  whole statement paints at every zoom level and the pane scrolls instead of
 *  clipping content inside the frame. The outer box reserves layout space at
 *  the SCALED size (height × zoom) while the inner box zooms visually — a
 *  bare transform reserves the unscaled height, letting the pane scroll past
 *  the end of the shrunken content. The Actual PDF tab is where exact
 *  pagination lives (the runner-built file itself). */
function LivePreview({ preview, zoomScale }: { preview: string; zoomScale: number }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [docHeight, setDocHeight] = useState(0);
  useEffect(() => { setDocHeight(0); }, [preview]);
  const measure = () => {
    try {
      const doc = frameRef.current?.contentDocument;
      if (doc?.body) setDocHeight(Math.ceil(doc.documentElement.scrollHeight));
    } catch { /* same-origin srcdoc; ignore transient access errors */ }
  };
  return <div className={styles.previewLive}
    style={{ width: `${100 / zoomScale}%`, height: docHeight ? `${Math.ceil(docHeight * zoomScale)}px` : undefined }}>
    <div className={styles.previewLiveZoom} style={{ transform: `scale(${zoomScale})` }}>
      <iframe title="Live statement preview" sandbox="allow-same-origin" srcDoc={preview}
        ref={frameRef} onLoad={measure} className={styles.previewLiveFrame}
        style={docHeight ? { height: `${docHeight}px` } : undefined} />
    </div>
  </div>;
}

/** Embeds the runner-built PDF. While a build job runs, the currently loaded
 *  file stays put (switching src mid-load aborts the request and can leave
 *  Chrome's viewer blank); the new revision swaps in once, after the job
 *  finishes and the refreshed draft reports it. */
function PdfEmbed({ draftId, revision, buildRunning }: { draftId: string; revision: number | null; buildRunning: boolean }) {
  // The revision actually loaded in the iframe; lags `revision` while a job runs.
  const [loadedRevision, setLoadedRevision] = useState(revision);
  useEffect(() => {
    if (!buildRunning && revision !== null && revision !== loadedRevision) {
      setLoadedRevision(revision);
    }
  }, [buildRunning, revision, loadedRevision]);
  if (loadedRevision === null) return <div className={styles.previewEmpty}>No PDF built yet.</div>;
  return <iframe title="Latest runner-built PDF" className={styles.previewPdfEmbed}
    key={loadedRevision}
    src={`${authoringService.draftPdfUrl(draftId, loadedRevision)}#view=FitH`} />;
}

export default function StatementEditor({ id }: { id: string }) {
  const model = useAuthoringDraft(id, 3000, { allowPublishedStatementEdit: true });
  const { draft, form, dirty } = model;
  const [preview, setPreview] = useState('');
  const [previewState, setPreviewState] = useState<'waiting' | 'loading' | 'ready' | 'error'>('waiting');
  const [previewError, setPreviewError] = useState('');
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
  const request = useRef(0);
  const recoveryHandled = useRef(false);
  const recoveryBaseRevision = useRef<number | null>(null);
  const wasDirty = useRef(false);
  const panels = useRef<ImperativePanelGroupHandle>(null);
  const compactLayout = useCompactEditorLayout();
  const [previewZoom, setPreviewZoom] = useState(() => readPreviewZoom(id));
  const draftId = draft?.id;
  const draftRevision = draft?.revision;
  const statementSource = form?.statementHtml;

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
        const response = await authoringService.previewStatement(draftId, statementSource);
        if (current === request.current) { setPreview(response.html); setPreviewState('ready'); }
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

  // Ctrl/Cmd+S saves the statement from the editor.
  const saveRef = useRef(model.save);
  saveRef.current = model.save;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveRef.current();
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

  const editorDisabled = model.busy || !!model.activeJob;
  const zoomScale = previewZoom / 100;
  const editorState = draft.status === 'published' ? 'Published — statement revision available'
    : draft.publishedAt ? 'Editing revision — live problem unchanged'
      : model.conflict ? 'Server conflict'
        : dirty ? (model.saveState === 'saving' ? 'Saving…' : 'Unsaved changes') : 'Saved';
  const previewStatusText = previewState === 'waiting' ? 'Waiting for typing to pause…' : previewState === 'loading' ? 'Updating preview…'
    : previewState === 'error' ? previewError : 'Preview is up to date';
  return <main className={styles.editorShell}>
    <header className={styles.editorHeader}>
      <Link to={`/admin/authoring/${encodeURIComponent(id)}`}>← Workspace</Link>
      <div className={styles.editorTitle}><h1>Edit Task: {draft.problemId}</h1><span>{draft.title}</span></div>
      <strong>{editorState}</strong>
      <span className={styles.headerSpacer} />
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
    <PanelGroup ref={panels} autoSaveId={`oj-authoring-statement-layout:${id}`} direction={compactLayout ? 'vertical' : 'horizontal'}
      className={styles.editorWorkspace} role="region" aria-label="Statement editor">
      <Panel defaultSize={50} minSize={25} className={styles.sourcePane}>
        <textarea id="statement-source" aria-label="Statement source" spellCheck={false} value={form.statementHtml}
          readOnly={editorDisabled} onChange={event => {
            const statementHtml = event.target.value;
            const baseRevision = dirty ? recoveryBaseRevision.current ?? draft.revision : draft.revision;
            recoveryBaseRevision.current = baseRevision;
            writeRecovery(id, { baseRevision, statementHtml });
            model.edit('statementHtml', statementHtml);
          }} />
      </Panel>
      <PanelResizeHandle className={styles.editorResizeHandle} aria-label="Resize source and preview panes"
        onDoubleClick={() => panels.current?.setLayout([50, 50])} />
      <Panel defaultSize={50} minSize={25} className={styles.previewPane}>
        <div className={styles.previewModeBar} role="tablist" aria-label="Preview mode">
          <button type="button" role="tab" aria-selected={pdfMode === false}
            className={pdfMode ? '' : styles.previewModeActive}
            onClick={() => setPdfMode(false)}>Live HTML</button>
          <button type="button" role="tab" aria-selected={pdfMode === true}
            className={pdfMode ? styles.previewModeActive : ''}
            onClick={() => setPdfMode(true)}>
            Actual PDF
            {pdfStale && <span className={styles.previewStaleDot} aria-label="PDF is outdated" title="Statement changed since the last build" />}
          </button>
        </div>
        <div className={styles.previewViewport}>
          {pdfMode
            ? (draft.hasLatestPdf
              ? <PdfEmbed draftId={draft.id} revision={draft.latestPdfRevision}
                buildRunning={!!model.activeJob} />
              : <div className={styles.previewEmpty}>No PDF built yet.</div>)
            : (preview ? <LivePreview preview={preview} zoomScale={zoomScale} />
              : <div className={styles.previewEmpty}>Preview will appear here.</div>)}
        </div>
        {pdfMode && pdfStale && !model.activeJob && (
          <div className={styles.pdfStaleBar} role="status">
            <span>{draft.hasLatestPdf ? 'Statement changed since this PDF was built.' : 'No PDF yet.'}</span>
            <Button disabled={model.actionsDisabled} onClick={() => void buildPdf()}>Build PDF now</Button>
          </div>
        )}
      </Panel>
    </PanelGroup>
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

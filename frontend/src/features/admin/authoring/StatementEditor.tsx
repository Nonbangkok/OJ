import { useEffect, useRef, useState } from 'react';
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

/** Matches the red-gate-v1 PDF template: A4 at 16px body font. An A4 sheet is
 *  210×297mm = 794×1123px at 96dpi, with the template's page margins
 *  (@page margin: 0.62in 0.75in 1in) baked in as padded page boxes so the
 *  preview's page breaks line up with the runner-built PDF. */
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const PAGE_MARGIN_TOP_PX = Math.round(0.62 * 96);   // 60
const PAGE_MARGIN_BOTTOM_PX = Math.round(1 * 96);   // 96
const PAGE_MARGIN_SIDE_PX = Math.round(0.75 * 96);  // 72

/** Injects the PDF template's @page margins into the preview document so it
 *  lays out on screen exactly as it prints: body gets the printable width
 *  (A4 minus side margins) and padding for the top/bottom margins. Screen
 *  rendering ignores @page, so without this the preview wraps lines wider
 *  than the real PDF and the page count drifts. */
const pagedSrcDoc = (preview: string): string => preview.replace('</head>',
  `<style>
    html { width: ${A4_WIDTH_PX}px; }
    body {
      width: ${A4_WIDTH_PX - PAGE_MARGIN_SIDE_PX * 2}px;
      margin: 0 ${PAGE_MARGIN_SIDE_PX}px;
      padding-top: ${PAGE_MARGIN_TOP_PX}px;
    }
  </style></head>`);

/** Slices the preview content into fixed A4 page frames so the author can see
 *  where page boundaries fall while typing. Every page renders the same
 *  document, translated up by one page-height per page index: page N shows
 *  exactly the lines that land on page N. Purely visual: the runner-built
 *  PDF remains authoritative. */
function PagedPreview({ preview, zoomScale }: { preview: string; zoomScale: number }) {
  const [pages, setPages] = useState(1);
  const [docHeight, setDocHeight] = useState(0);
  const measureRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    setPages(1);
    setDocHeight(0);
  }, [preview]);
  const measure = () => {
    try {
      const doc = measureRef.current?.contentDocument;
      if (!doc?.body) return;
      const inner = Math.ceil(doc.documentElement.scrollHeight);
      // Content flows inside the margins; each printable page holds
      // printable-height worth of it, starting below the top margin.
      if (inner > 0) {
        const printable = A4_HEIGHT_PX - PAGE_MARGIN_TOP_PX - PAGE_MARGIN_BOTTOM_PX;
        setDocHeight(inner);
        setPages(Math.max(1, Math.ceil((inner - PAGE_MARGIN_TOP_PX) / printable)));
      }
    } catch { /* sandboxed frame content is same-origin via srcdoc; ignore */ }
  };
  const srcDoc = pagedSrcDoc(preview);
  return <div className={styles.previewPages}>
    {/* Hidden measuring frame at the exact PDF page width and margins: the
        document renders at the same metrics as the real PDF, so page count
        and break positions match the runner output. */}
    <iframe title="Statement preview measurement" sandbox="allow-same-origin" srcDoc={srcDoc}
      ref={measureRef} onLoad={measure} className={styles.previewMeasure} aria-hidden="true" />
    {Array.from({ length: pages }, (_, index) => <div key={index} className={styles.previewPageWrapper}>
      <div className={styles.previewPageNumber} aria-hidden="true">Page {index + 1} / {pages}</div>
      <div className={styles.previewPageFrame}>
        <div className={styles.previewPageZoom} style={{ transform: `scale(${zoomScale})` }}>
          <iframe title={`Statement preview page ${index + 1}`} sandbox="allow-same-origin" srcDoc={srcDoc}
            className={styles.previewPageContent}
            style={docHeight
              ? { height: `${docHeight}px`,
                  top: `${-index * (A4_HEIGHT_PX - PAGE_MARGIN_TOP_PX - PAGE_MARGIN_BOTTOM_PX)}px` }
              : undefined} />
        </div>
      </div>
    </div>)}
  </div>;
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
            onClick={() => setPdfMode(true)}>Actual PDF</button>
        </div>
        <div className={styles.previewViewport}>
          {pdfMode
            ? (draft.hasLatestPdf
              ? <iframe title="Latest runner-built PDF" className={styles.previewPdfEmbed}
                src={`${authoringService.draftPdfUrl(draft.id, draft.latestPdfRevision)}#view=FitH`} />
              : <div className={styles.previewEmpty}>No PDF built yet. Build PDF from Verify &amp; Publish.</div>)
            : (preview ? <PagedPreview preview={preview} zoomScale={zoomScale} />
              : <div className={styles.previewEmpty}>Preview will appear here.</div>)}
        </div>
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

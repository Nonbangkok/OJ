import { useEffect, useRef, useState } from 'react';
import api from '../../../services/api';
import { Draft, draftBase } from './types';
import styles from './Authoring.module.css';

interface Asset { id: string; filename: string; sizeBytes: number }
export function PdfPreview({ draft }: { draft: Draft }) {
  const [open, setOpen] = useState(false);
  const url = `${(api.defaults?.baseURL || '').replace(/\/$/, '')}${draftBase(draft.id)}/pdf?revision=${draft.latestPdfRevision}`;
  if (!draft.hasLatestPdf) return <p>No PDF yet. Build PDF or run Verify All.</p>;
  return <section>
    <p>PDF revision {draft.latestPdfRevision} {draft.latestPdfRevision !== draft.revision ? '— outdated; rebuild for the current revision.' : '— current revision.'}</p>
    <button type="button" onClick={() => setOpen(p => !p)}>{open ? 'Hide PDF' : 'Preview PDF'}</button>
    <a href={url} target="_blank" rel="noreferrer">Open actual PDF</a>
    {open && <iframe className={styles.frame} title="Actual problem PDF" src={url} />}
  </section>;
}

export default function StatementTab({ draft, html, disabled, onEdit, onBuild, mutate, onError }: {
  draft: Draft; html: string; disabled: boolean; onEdit: (html: string) => void; onBuild: () => void;
  mutate: (action: () => Promise<unknown>) => Promise<void>; onError: (error: unknown) => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    let cancelled = false;
    api.get<Asset[]>(`${draftBase(draft.id)}/assets`).then(r => { if (!cancelled) setAssets(r.data); }).catch(onError);
    return () => { cancelled = true; };
  }, [draft.id, draft.revision, onError]);
  useEffect(() => { request.current++; setPreview(''); setPreviewBusy(false); }, [html, draft.revision]);
  useEffect(() => () => { request.current++; }, []);
  return <section>
    <h2>Statement</h2>
    <p>task-pdf-writer format: Markdown with inline HTML and LaTeX math. Write sample tables directly in HTML; they are independent of hidden testcases.</p>
    <label>Statement Markdown / HTML / LaTeX<textarea spellCheck={false} value={html} readOnly={draft.status === 'published'}
      onChange={e => onEdit(e.target.value)} /></label>
    <p>Images: <code>{'<image src="{{ASSET_BASE}}/image.png">'}</code> (legacy) or <code>{'![alt]({{ASSET_BASE}}/image.png)'}</code>. Page break: <code>{'<div class="forced-page-break"></div>'}</code>.</p>
    <div className={styles.actions}>
      <button type="button" disabled={previewBusy} onClick={async () => {
        const current = ++request.current; setPreviewBusy(true);
        try { const response = await api.post<{ html: string }>(`${draftBase(draft.id)}/preview`, { statementHtml: html });
          if (current === request.current) setPreview(response.data.html);
        } catch (err) { if (current === request.current) { setPreview(''); onError(err); } }
        finally { if (current === request.current) setPreviewBusy(false); }
      }}>Preview statement</button>
      <button type="button" disabled={disabled} onClick={onBuild}>Build PDF</button>
    </div>
    <p>Fast preview uses the current statement with saved header/images. Only the runner-built PDF is authoritative.</p>
    {preview && <iframe title="Fast statement preview" className={styles.frame} sandbox="" srcDoc={preview} />}
    <PdfPreview draft={draft} />
    <h3>Statement assets</h3>
    <p>JPEG, PNG or WebP; 10 MiB per normalized image / 100 MiB per draft. Save text before changing assets.</p>
    <label>Asset image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled}
      onChange={e => setFile(e.target.files?.[0] || null)} /></label>
    <button type="button" disabled={disabled || !file} onClick={() => {
      const selectedFile = file;
      if (!selectedFile) return;
      void mutate(async () => {
        const data = new FormData(); data.append('expectedRevision', String(draft.revision)); data.append('asset', selectedFile);
        await api.post(`${draftBase(draft.id)}/assets`, data); setFile(null);
      });
    }}>Upload asset</button>
    <ul>{assets.map(asset => <li key={asset.id}><code>{`{{ASSET_BASE}}/${asset.filename}`}</code> ({asset.sizeBytes} bytes)
      <button type="button" disabled={disabled} onClick={() => {
        if (window.confirm(`Delete ${asset.filename}? Update any statement references afterward.`)) void mutate(() =>
          api.delete(`${draftBase(draft.id)}/assets/${asset.id}`, { params: { expectedRevision: draft.revision } }));
      }}>Delete {asset.filename}</button></li>)}</ul>
  </section>;
}

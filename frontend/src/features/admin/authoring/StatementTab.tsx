import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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

export function StatementAssets({ draft, disabled, mutate, onError }: {
  draft: Draft; disabled: boolean;
  mutate: (action: () => Promise<unknown>) => Promise<void>; onError: (error: unknown) => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.get<Asset[]>(`${draftBase(draft.id)}/assets`).then(r => { if (!cancelled) setAssets(r.data); }).catch(onError);
    return () => { cancelled = true; };
  }, [draft.id, draft.revision, onError]);
  return <section>
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

export default function StatementTab({ draft, disabled, onBuild, mutate, onError }: {
  draft: Draft; disabled: boolean; onBuild: () => void;
  mutate: (action: () => Promise<unknown>) => Promise<void>; onError: (error: unknown) => void;
}) {
  return <section>
    <h2>Statement</h2>
    <p>Edit task-pdf-writer Markdown, inline HTML and LaTeX in the dedicated two-pane editor.</p>
    <div className={styles.actions}>
      <Link className={styles.primaryLink} to={`/admin/authoring/${encodeURIComponent(draft.id)}/editor`}>Open full-screen editor</Link>
      <button type="button" disabled={disabled} onClick={onBuild}>Build PDF</button>
    </div>
    <PdfPreview draft={draft} />
    <StatementAssets draft={draft} disabled={disabled} mutate={mutate} onError={onError} />
  </section>;
}

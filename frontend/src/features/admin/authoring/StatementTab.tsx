import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../components/ui';
import authoringService from '../../../services/admin/authoringService';
import { Asset, Draft } from './types';
import styles from './Authoring.module.css';

export function PdfPreview({ draft }: { draft: Draft }) {
  const [open, setOpen] = useState(false);
  const url = authoringService.draftPdfUrl(draft.id, draft.latestPdfRevision);
  if (!draft.hasLatestPdf) return <p className={styles.pdfPanelEmpty}>No PDF yet. Build PDF from Verify &amp; Publish.</p>;
  return <section className={styles.pdfPanel}>
    <div className={styles.pdfPanelHead}>
      <p className={styles.pdfPanelText}>PDF revision {draft.latestPdfRevision} {draft.latestPdfRevision !== draft.revision ? '— outdated; rebuild from Verify & Publish.' : '— current revision.'}</p>
      <div className={styles.pdfPanelActions}>
        <Button variant="secondary" size="compact" onClick={() => setOpen(p => !p)}>{open ? 'Hide PDF' : 'Preview PDF'}</Button>
        <a className={styles.pdfOpenLink} href={url} target="_blank" rel="noreferrer">Open actual PDF ↗</a>
      </div>
    </div>
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
    authoringService.listAssets(draft.id).then(list => { if (!cancelled) setAssets(list); }).catch(onError);
    return () => { cancelled = true; };
  }, [draft.id, draft.revision, onError]);
  return <section className={styles.assetsPanel}>
    <h3>Statement assets</h3>
    <p>JPEG, PNG or WebP; 10 MiB per normalized image / 100 MiB per draft. Save text before changing assets.</p>
    <label>Asset image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled}
      onChange={e => setFile(e.target.files?.[0] || null)} /></label>
    <button type="button" disabled={disabled || !file} onClick={() => {
      const selectedFile = file;
      if (!selectedFile) return;
      void mutate(async () => {
        const data = new FormData(); data.append('expectedRevision', String(draft.revision)); data.append('asset', selectedFile);
        await authoringService.uploadAsset(draft.id, data); setFile(null);
      });
    }}>Upload asset</button>
    <ul>{assets.map(asset => <li key={asset.id}><code>{`{{ASSET_BASE}}/${asset.filename}`}</code> ({asset.sizeBytes} bytes)
      <button type="button" disabled={disabled} onClick={() => {
        if (window.confirm(`Delete ${asset.filename}? Update any statement references afterward.`)) void mutate(() =>
          authoringService.deleteAsset(draft.id, asset.id, draft.revision));
      }}>Delete {asset.filename}</button></li>)}</ul>
  </section>;
}

export default function StatementTab({ draft, disabled, onBuild, mutate, onError }: {
  draft: Draft; disabled: boolean; onBuild: () => void;
  mutate: (action: () => Promise<unknown>) => Promise<void>; onError: (error: unknown) => void;
}) {
  // The Build PDF action lives in Verify & Publish (checklist + button); this
  // tab keeps only the statement source editing and its artifacts.
  void onBuild;
  return <section>
    <h2>Statement</h2>
    <div className={styles.actions}>
      <Link className={styles.primaryLink} to={`/admin/authoring/${encodeURIComponent(draft.id)}/editor`}>Open full-screen editor</Link>
    </div>
    <PdfPreview draft={draft} />
    <StatementAssets draft={draft} disabled={disabled} mutate={mutate} onError={onError} />
  </section>;
}

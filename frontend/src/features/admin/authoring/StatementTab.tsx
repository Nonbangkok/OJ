import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePdf } from '@phosphor-icons/react';
import { ActionMenu, Button, ConfirmDialog, FileDrop } from '../../../components/ui';
import buttonStyles from '../../../components/ui/Button.module.css';
import authoringService from '../../../services/admin/authoringService';
import { Asset, Draft } from './types';
import useStatementPreview from './useStatementPreview';
import LivePreview from './LivePreview';
import { formatDecimalSize } from './testcaseSize';
import LargeScreenNotice, { useSmallScreen } from './LargeScreenNotice';
import styles from './Statement.module.css';

const IMAGE_TYPES = ['.jpg', '.jpeg', '.png', '.webp'];
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** One-line PDF state: revision, stale warning, Rebuild / Open (or Build PDF when none exists). */
export function PdfRow({ draft, disabled, onBuild }: { draft: Draft; disabled: boolean; onBuild: () => void }) {
  if (!draft.hasLatestPdf || draft.latestPdfRevision === null) {
    return (
      <div className={styles.pdfRow}>
        <FilePdf size={18} aria-hidden="true" className={styles.pdfIcon} />
        <span className={styles.grow}>No PDF yet</span>
        <Button size="compact" variant="secondary" disabled={disabled} onClick={onBuild}>Build PDF</Button>
      </div>
    );
  }
  const stale = draft.latestPdfRevision !== draft.revision;
  return (
    <div className={styles.pdfRow}>
      <FilePdf size={18} aria-hidden="true" className={stale ? styles.pdfIconStale : styles.pdfIcon} />
      <span className={styles.grow}>
        <b>PDF</b> <span className={styles.mono}>{`PDF rev ${draft.latestPdfRevision}`}</span>
        {stale && <span className={styles.stale}> · <span>{`older than the draft (rev ${draft.revision})`}</span></span>}
      </span>
      <Button size="compact" variant="secondary" disabled={disabled} onClick={onBuild}>Rebuild</Button>
      <a className={styles.link} href={authoringService.draftPdfUrl(draft.id, draft.latestPdfRevision)} target="_blank" rel="noreferrer">Open</a>
    </div>
  );
}

export function StatementAssets({ draft, disabled, mutate, onError }: {
  draft: Draft; disabled: boolean;
  mutate: (action: () => Promise<unknown>) => Promise<void>; onError: (error: unknown) => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [deleting, setDeleting] = useState<Asset | null>(null);
  useEffect(() => {
    let cancelled = false;
    authoringService.listAssets(draft.id).then((list) => { if (!cancelled) setAssets(list); }).catch(onError);
    return () => { cancelled = true; };
  }, [draft.id, draft.revision, onError]);

  // One operation for the whole drop: each upload bumps the revision, so the
  // next file is sent against the revision the server holds now.
  const upload = (files: File[]) => {
    void mutate(async () => {
      let revision = draft.revision;
      for (const [index, file] of files.entries()) {
        if (index > 0) revision = (await authoringService.getDraft(draft.id)).revision;
        const data = new FormData();
        data.append('expectedRevision', String(revision));
        data.append('asset', file);
        await authoringService.uploadAsset(draft.id, data);
      }
    });
  };

  return (
    <section className={styles.section} aria-labelledby="statement-images-title">
      <div className={styles.sectionHead}>
        <h3 id="statement-images-title">Images</h3>
        <span className={styles.muted}>JPEG, PNG or WebP · 10 MB each · 100 MB per draft</span>
      </div>
      <FileDrop label="Drop images here" hint="Save your text first — uploading changes the draft." accept={IMAGE_TYPES} maxBytes={IMAGE_MAX_BYTES} multiple disabled={disabled} onFiles={upload} />
      {assets.length > 0 && (
        <table className={styles.table} aria-label="Statement images">
          <thead><tr><th>File</th><th>Use in the statement</th><th className={styles.num}>Size</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead>
          <tbody>
            {assets.map((asset) => {
              const path = `{{ASSET_BASE}}/${asset.filename}`;
              return (
                <tr key={asset.id}>
                  <td>{asset.filename}</td>
                  <td className={styles.mono}>
                    {path}{' '}
                    <Button size="compact" variant="secondary" aria-label={`Copy the path of ${asset.filename}`} onClick={() => { void navigator.clipboard?.writeText(path); }}>Copy</Button>
                  </td>
                  <td className={`${styles.num} ${styles.mono}`}>{formatDecimalSize(asset.sizeBytes)}</td>
                  <td className={styles.action}>
                    <ActionMenu label={`Actions for ${asset.filename}`} items={[
                      { key: 'delete', label: 'Delete', variant: 'danger', disabled, onClick: () => setDeleting(asset) },
                    ]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <ConfirmDialog
        open={deleting !== null}
        tier="destructive"
        title={`Delete ${deleting?.filename ?? ''}?`}
        body="The statement keeps any reference to it until you update the text."
        confirmLabel="Delete image"
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target) void mutate(() => authoringService.deleteAsset(draft.id, target.id, draft.revision));
        }}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}

/** Statement tab (§7.9): the rendered statement read-only, Edit statement, the PDF row, images. */
export default function StatementTab({ draft, disabled, onBuild, mutate, onError }: {
  draft: Draft; disabled: boolean; onBuild: () => void;
  mutate: (action: () => Promise<unknown>) => Promise<void>; onError: (error: unknown) => void;
}) {
  const small = useSmallScreen();
  const preview = useStatementPreview(draft.id, draft.statementHtml, draft.revision);
  return (
    <section className={styles.tab} aria-label="Statement">
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <b>Statement</b>
          {!small && (
            <Link className={['oj-button', buttonStyles.button, buttonStyles.secondary, buttonStyles.compact, styles.linkButton].join(' ')}
              to={`/admin/authoring/${encodeURIComponent(draft.id)}/editor`}>Edit statement</Link>
          )}
        </div>
        <div className={styles.cardBody}>
          {preview.shell && preview.state !== 'error'
            ? <LivePreview shell={preview.shell} statement={preview.html} zoomScale={1} />
            : <p className={styles.muted} role={preview.state === 'error' ? 'alert' : 'status'}>
              {preview.state === 'error' ? preview.error : 'Rendering the statement…'}
            </p>}
        </div>
      </div>
      <PdfRow draft={draft} disabled={disabled} onBuild={onBuild} />
      {small
        ? <LargeScreenNotice detail="Read the statement here; edit it and its images on a larger screen." />
        : <StatementAssets draft={draft} disabled={disabled} mutate={mutate} onError={onError} />}
    </section>
  );
}

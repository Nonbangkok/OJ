import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, ConfirmDialog, DataTable, Dialog, FilterBar, InlineError, SegmentedControl, StatusDot,
  type ActionMenuItem, type DataTableColumn,
} from '../../../components/ui';
import { useAuth } from '../../../context/AuthContext';
import authoringService from '../../../services/admin/authoringService';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { getErrorMessage } from '../../../utils/error';
import { formatTimeAgo } from '../../../utils/formatters';
import type { DraftFields, DraftSummary, Profile } from './types';
import { listStatus, readinessFromSummary, readinessOf } from './readiness';
import ReadinessSquares, { ReadinessLegend } from './ReadinessSquares';
import MetadataFields from './MetadataFields';
import AuthoringHub from './AuthoringHub';
import styles from './AuthoringHub.module.css';

const initialFields: DraftFields = {
  problemId: '', title: '', authorProfileId: null, authorAkaName: '', authorRealName: '', language: 'Thai', countryCode: 'THA',
  categories: [], difficulty: null, timeLimitMs: 1000, memoryLimitMb: 256, statementHtml: '', solutionCpp: '', generatorCpp: null,
  templateVersion: 'red-gate-v1',
};

const FILTER_KEYS = ['q', 'scope', 'author', 'status', 'sort', 'dir'] as const;
const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' }, { value: 'generated', label: 'Generated' }, { value: 'ready', label: 'Ready' }, { value: 'published', label: 'Published' },
];
const DOT_TONE = { neutral: 'neutral', warn: 'warn', ok: 'pass', bad: 'fail' } as const;
type SortKey = 'problemId' | 'title' | 'updated';

/** The Drafts sub-tab (§7.9): every draft with its readiness, filters in the URL. */
export default function DraftList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { values, set, setMany } = useUrlFilters(FILTER_KEYS);
  const scope = values.scope === 'mine' ? 'mine' : 'all';
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [mine, setMine] = useState<DraftSummary[] | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(initialFields);
  const [createError, setCreateError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<DraftSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    // "Mine" is server-side: the backend matches the username against Author Profile AKA names.
    Promise.all([authoringService.listDrafts(), authoringService.listDrafts('mine'), authoringService.listProfiles()])
      .then(([all, own, profileList]) => {
        if (cancelled) return;
        setDrafts(all as unknown as DraftSummary[]);
        setMine(own as unknown as DraftSummary[]);
        setProfiles(profileList);
      })
      .catch((err) => { if (!cancelled) setError(getErrorMessage(err, 'Could not load authoring drafts')); });
    return () => { cancelled = true; };
  }, []);

  const scoped = useMemo(() => (scope === 'mine' ? mine : drafts) ?? [], [scope, mine, drafts]);
  const sortKey: SortKey = values.sort === 'problemId' || values.sort === 'title' ? values.sort : 'updated';
  const direction = values.dir === 'asc' ? 'asc' : values.dir === 'desc' ? 'desc' : (sortKey === 'updated' ? 'desc' : 'asc');
  const rows = useMemo(() => {
    const query = values.q.trim().toLowerCase();
    const filtered = scoped.filter((d) => (!values.author || d.authorProfileId === values.author)
      && (!values.status || d.status === values.status)
      && (!query || d.problemId.toLowerCase().includes(query) || d.title.toLowerCase().includes(query)));
    const factor = direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => factor * (sortKey === 'updated'
      ? Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
      : a[sortKey].localeCompare(b[sortKey], 'en', { numeric: true, sensitivity: 'base' })));
  }, [scoped, values.q, values.author, values.status, sortKey, direction]);

  const hasOwnProfile = profiles.some((p) => p.akaName.toLowerCase() === (user?.username ?? '').toLowerCase());
  const published = (drafts ?? []).filter((d) => d.status === 'published').length;

  const startRevision = async (d: DraftSummary) => {
    setBusy(true);
    setError('');
    try {
      await authoringService.startNewRevision(d.id);
      navigate(`/admin/authoring/${d.id}`);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not start a new revision'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const target = deleting;
    setBusy(true);
    setError('');
    try {
      await authoringService.deleteDraft(target.id);
      setDrafts((prev) => (prev ?? []).filter((d) => d.id !== target.id));
      setMine((prev) => (prev ?? []).filter((d) => d.id !== target.id));
    } catch (err) {
      setError(getErrorMessage(err, 'Could not delete the authoring draft'));
    } finally {
      setDeleting(null);
      setBusy(false);
    }
  };

  const columns: DataTableColumn<DraftSummary>[] = [
    { key: 'problemId', header: 'Problem ID', sortable: true, mobile: 'meta', cell: (d) => <span className={styles.mono}>{d.problemId}</span> },
    { key: 'title', header: 'Title', sortable: true, mobile: 'primary', cell: (d) => <span className={styles.title}>{d.title}</span> },
    { key: 'author', header: 'Author', mobile: 'hidden', cell: (d) => <span className={styles.muted}>{d.authorAkaName}</span> },
    { key: 'ready', header: 'Ready', mobile: 'primary', cell: (d) => <ReadinessSquares states={readinessOf(readinessFromSummary(d))} /> },
    { key: 'status', header: 'Status', mobile: 'meta', cell: (d) => { const s = listStatus(d); return <StatusDot tone={DOT_TONE[s.tone]} label={s.label} />; } },
    { key: 'updated', header: 'Updated', sortable: true, mobile: 'meta', cell: (d) => <span className={styles.muted} title={new Date(d.updatedAt).toLocaleString()}>{formatTimeAgo(d.updatedAt)}</span> },
  ];

  const rowActions = (d: DraftSummary): ActionMenuItem[] => [
    { key: 'open', label: 'Open', onClick: () => navigate(`/admin/authoring/${d.id}`) },
    ...(d.status === 'published' ? [{ key: 'revision', label: 'Start new revision', disabled: busy, onClick: () => { void startRevision(d); } }] : []),
    { key: 'delete', label: 'Delete', variant: 'danger' as const, disabled: busy, onClick: () => setDeleting(d) },
  ];

  const emptyMessage = scope === 'mine' && !hasOwnProfile && scoped.length === 0
    ? 'No author profile is linked to your username.'
    : scoped.length === 0 ? 'No drafts yet. Create one to start writing a problem.' : 'No drafts match these filters.';

  return (
    <AuthoringHub
      tab="drafts"
      meta={drafts ? `${drafts.length} ${drafts.length === 1 ? 'draft' : 'drafts'} · ${published} published` : undefined}
      actions={<Button onClick={() => { setCreateError(''); setForm(initialFields); setCreating(true); }}>New draft</Button>}
    >
      <FilterBar
        search={{ value: values.q, onChange: (v) => set('q', v || null), placeholder: 'Search by ID or title' }}
        segments={(
          <SegmentedControl
            aria-label="Draft scope"
            options={[{ value: 'all', label: 'All drafts' }, { value: 'mine', label: 'Mine' }]}
            value={scope}
            onChange={(v) => set('scope', v === 'mine' ? 'mine' : null)}
          />
        )}
        filters={[
          { key: 'author', label: 'Author', value: values.author || undefined, options: profiles.map((p) => ({ value: p.id, label: p.akaName })), onChange: (v) => set('author', v) },
          { key: 'status', label: 'Status', value: values.status || undefined, options: STATUS_OPTIONS, onChange: (v) => set('status', v) },
        ]}
        resultCount={drafts ? `${rows.length} ${rows.length === 1 ? 'draft' : 'drafts'}` : undefined}
      />
      {error && <InlineError message={error} />}
      <DataTable<DraftSummary>
        caption="Drafts"
        columns={columns}
        rows={rows}
        rowKey={(d) => d.id}
        rowLabel={(d) => d.problemId}
        rowHref={(d) => `/admin/authoring/${d.id}`}
        rowActions={rowActions}
        sort={{ key: sortKey, direction, onChange: (key) => {
          const nextDir = key === sortKey ? (direction === 'asc' ? 'desc' : 'asc') : (key === 'updated' ? 'desc' : 'asc');
          setMany({ sort: key === 'updated' ? null : key, dir: nextDir });
        } }}
        loading={drafts === null && !error}
        empty={<p className={styles.empty}>{emptyMessage}</p>}
      />
      <ReadinessLegend />

      <form
        id="new-draft-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setCreateError('');
          try {
            const draft = await authoringService.createDraft(form);
            navigate(`/admin/authoring/${draft.id}`);
          } catch (err) {
            setCreateError(getErrorMessage(err, 'Could not create draft'));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Dialog
          open={creating}
          title="New draft"
          onClose={() => { if (!busy) setCreating(false); }}
          footer={(
            <>
              <Button variant="secondary" type="button" disabled={busy} onClick={() => setCreating(false)}>Cancel</Button>
              <Button form="new-draft-form" type="submit" disabled={busy} loading={busy} loadingLabel="Creating…">Create draft</Button>
            </>
          )}
        >
          {createError && <InlineError message={createError} />}
          <MetadataFields value={form} profiles={profiles} disabled={busy} onEdit={(key, value) => setForm((p) => ({ ...p, [key]: value }))} />
        </Dialog>
      </form>

      <ConfirmDialog
        open={deleting !== null}
        tier="destructive"
        title={`Delete ${deleting?.problemId ?? ''}?`}
        body="This permanently deletes this authoring draft and its draft-only artifacts. A problem it already published stays live."
        confirmLabel="Delete draft"
        busy={busy}
        onConfirm={() => { void remove(); }}
        onCancel={() => setDeleting(null)}
      />
    </AuthoringHub>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button, Dialog, OverflowTable, StatusBadge } from '../../../components/ui';
import { useAuth } from '../../../context/AuthContext';
import authoringService from '../../../services/admin/authoringService';
import { getErrorMessage } from '../../../utils/error';
import { formatTimeAgo } from '../../../utils/formatters';
import { Draft, DraftFields, Profile } from './types';
import { draftStatus } from './status';
import shared from '../shared/Management.module.css';
import MetadataFields from './MetadataFields';
import DraftWorkspace from './DraftWorkspace';
import StatementEditor from './StatementEditor';
import AuthorProfiles from './AuthorProfiles';
import AiDocs from './AiDocs';
import styles from './Authoring.module.css';

const initialFields: DraftFields = {
  problemId: '',
  title: '',
  authorProfileId: null,
  authorAkaName: '',
  authorRealName: '',
  language: 'Thai',
  countryCode: 'THA',
  categories: [],
  difficulty: null,
  timeLimitMs: 1000,
  memoryLimitMb: 256,
  statementHtml: '',
  solutionCpp: '',
  generatorCpp: null,
  templateVersion: 'red-gate-v1',
};

type ScopeFilter = 'all' | 'mine';
type SortKey = 'recent' | 'oldest' | 'problemId' | 'title';

/** Persisted per-browser view preferences — a convenience for frequent
 *  authors, never an authorization rule. Everyone still sees every draft
 *  under "All drafts" (the default). */
const PREF_KEY = 'oj:authoring:draft-view';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'oldest', label: 'Oldest updated' },
  { value: 'problemId', label: 'Problem ID' },
  { value: 'title', label: 'Title' },
];

const readPrefs = (): { scope: ScopeFilter; sort: SortKey } => {
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { scope?: string; sort?: string };
      const scope = parsed.scope === 'mine' ? 'mine' : 'all';
      const sort = SORT_OPTIONS.some(o => o.value === parsed.sort) ? parsed.sort as SortKey : 'recent';
      return { scope, sort };
    }
  } catch { /* corrupted or unavailable storage — fall back to defaults */ }
  return { scope: 'all', sort: 'recent' };
};

function DraftList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [mineDrafts, setMineDrafts] = useState<Draft[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(initialFields);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createError, setCreateError] = useState('');
  const initialPrefs = useMemo(readPrefs, []);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<ScopeFilter>(initialPrefs.scope);
  const [authorFilter, setAuthorFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState<SortKey>(initialPrefs.sort);
  useEffect(() => {
    let cancelled = false;
    // "My drafts" is server-side: the backend matches the logged-in username
    // against Author Profile AKA names (exact, case-normalized). We load both
    // views once so switching the toggle is instant.
    Promise.all([
      authoringService.listDrafts(),
      authoringService.listDrafts('mine'),
      authoringService.listProfiles(),
    ])
      .then(([draftList, mineList, profileList]) => {
        if (!cancelled) {
          setDrafts(draftList);
          setMineDrafts(mineList);
          setProfiles(profileList);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e, 'Could not load authoring drafts'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(PREF_KEY, JSON.stringify({ scope, sort })); } catch { /* ignore */ }
  }, [scope, sort]);

  // "My drafts" is defined by the Author Profile AKA ↔ username identity,
  // resolved server-side. The linked-profile lookup here only feeds the
  // empty-state hint: a user with no profile whose AKA matches nothing sees
  // an explanatory message instead of a bare empty list.
  const hasLinkedProfile = useMemo(
    () => profiles.some(p => p.akaName.toLowerCase() === (user?.username ?? '').toLowerCase()),
    [profiles, user?.username],
  );

  const scopedDrafts = scope === 'mine' ? mineDrafts : drafts;

  const visibleDrafts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = scopedDrafts.filter(d => {
      if (authorFilter !== 'all' && d.authorProfileId !== authorFilter) return false;
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (query && !d.problemId.toLowerCase().includes(query) && !d.title.toLowerCase().includes(query)) return false;
      return true;
    });
    const byUpdated = (a: Draft, b: Draft) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    return filtered.sort((a, b) => {
      if (sort === 'recent') return byUpdated(b, a);
      if (sort === 'oldest') return byUpdated(a, b);
      if (sort === 'problemId') return a.problemId.localeCompare(b.problemId, 'en', { numeric: true });
      return a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' });
    });
  }, [scopedDrafts, search, authorFilter, statusFilter, sort]);
  return (
    <section className={styles.authoring}>
      <div className={styles.listHead}>
        <h1>Problem Authoring</h1>
        <div className={styles.actions}>
          <Link className={styles.actionLink} to="/admin/authoring/profiles">
            Author profiles
          </Link>
          <Link className={styles.actionLink} to="/admin/authoring/ai-docs">
            AI Docs
          </Link>
          <Button onClick={() => { setCreateError(''); setCreating(true); }}>New draft</Button>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {creating && (
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
          <Dialog open title="New draft" onClose={() => { if (!busy) setCreating(false); }}
            footer={<>
              <Button form="new-draft-form" disabled={busy} type="submit" loading={busy} loadingLabel="Creating…">Create draft</Button>
              <Button variant="secondary" disabled={busy} onClick={() => setCreating(false)}>Cancel</Button>
            </>}>
            {createError && <p role="alert">{createError}</p>}
            <MetadataFields
              value={form}
              profiles={profiles}
              disabled={busy}
              onEdit={(key, value) => setForm((p) => ({ ...p, [key]: value }))}
            />
          </Dialog>
        </form>
      )}
      {loading ? (
        <p role="status">Loading drafts…</p>
      ) : (
        <>
          {/* Discovery toolbar — a filter over the single collaborative list.
              Every author still sees and can edit every draft under All drafts.
              Lives outside the Drafts panel so the panel stays a pure list. */}
          <div className={styles.draftsToolbar}>
            <input
              type="search"
              className={styles.draftsSearch}
              placeholder="Search by ID or title…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search drafts by ID or title"
            />
            <div
              className={`${shared['filter-segment']} ${styles.draftsScope}`}
              role="group"
              aria-label="Draft scope"
            >
              <button
                type="button"
                className={`${shared['filter-segment-btn']} ${scope === 'all' ? shared.active : ''}`}
                aria-pressed={scope === 'all'}
                onClick={() => setScope('all')}
              >
                All drafts
              </button>
              <button
                type="button"
                className={`${shared['filter-segment-btn']} ${scope === 'mine' ? shared.active : ''}`}
                aria-pressed={scope === 'mine'}
                onClick={() => setScope('mine')}
              >
                My drafts
              </button>
            </div>
            {/* Labeled filters: label inline beside its select, one height,
                one baseline — the whole toolbar reads as a single row. */}
            <label className={`${shared['filter-control']} ${styles.draftsFilter}`}>
              <span className={shared['filter-label']}>Author</span>
              <select
                value={authorFilter}
                onChange={(event) => setAuthorFilter(event.target.value)}
                aria-label="Filter drafts by author"
              >
                <option value="all">All</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.akaName}</option>
                ))}
              </select>
            </label>
            <label className={`${shared['filter-control']} ${styles.draftsFilter}`}>
              <span className={shared['filter-label']}>Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label="Filter drafts by status"
              >
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="generated">Generated</option>
                <option value="ready">Ready</option>
                <option value="published">Published</option>
              </select>
            </label>
            <label className={`${shared['filter-control']} ${styles.draftsFilter}`}>
              <span className={shared['filter-label']}>Sort</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
                aria-label="Sort drafts"
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h3>Drafts</h3>
              <p>{visibleDrafts.length === scopedDrafts.length ? `${scopedDrafts.length} saved` : `${visibleDrafts.length} of ${scopedDrafts.length}`}</p>
            </div>

            <OverflowTable label="Saved drafts">
            <table>
              <thead>
                <tr>
                  <th>Problem ID</th>
                  <th>Title</th>
                  <th>Author</th>
                  <th>Status</th>
                  <th>Last updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleDrafts.map((d) => {
                  const status = draftStatus(d.status);
                  return (
                    <tr key={d.id}>
                      <td>
                        <Link className={styles.draftIdLink} to={`/admin/authoring/${d.id}`}>
                          {d.problemId}
                        </Link>
                      </td>
                      <td>
                        <Link className={styles.draftTitleLink} to={`/admin/authoring/${d.id}`}>
                          {d.title}
                        </Link>
                      </td>
                      <td className={styles.draftAuthor}>{d.authorAkaName}</td>
                      <td>
                        <StatusBadge tone={status.tone} soft title={status.hint}>
                          {status.label}
                        </StatusBadge>
                      </td>
                      <td title={new Date(d.updatedAt).toLocaleString()}>{formatTimeAgo(d.updatedAt)}</td>
                      <td>
                        {d.status === 'published' && (
                          <Button
                            size="compact"
                            variant="secondary"
                            disabled={busy}
                            onClick={async () => {
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
                            }}
                          >
                            Start new revision
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!scopedDrafts.length && (scope === 'mine' && !hasLinkedProfile
              // "My drafts" found no identity: no Author Profile carries the
              // logged-in username as its AKA. Never fall back to all drafts.
              ? <p className={styles.panelBody}>No author profile is linked to your username.</p>
              : <p className={styles.panelBody}>No drafts yet. Create your first draft above.</p>)}
            {scopedDrafts.length > 0 && !visibleDrafts.length && (
              <p className={styles.panelBody}>No drafts match the current filters.</p>
            )}
          </OverflowTable>
          </section>
        </>
      )}
    </section>
  );
}

function ProfilesPage() {
  return (
    <section className={styles.authoring}>
      <Link to="/admin/authoring" className={styles.backLink}>← All drafts</Link>
      <h1>Author profiles</h1>
      <AuthorProfiles />
    </section>
  );
}

function AiDocsPage() {
  return <AiDocs />;
}

export default function ProblemAuthoring({ editorMode = false }: { editorMode?: boolean }) {
  const { user, isLoading } = useAuth();
  const { draftId } = useParams();
  const location = useLocation();
  if (isLoading) return <p role="status">Loading authoring…</p>;
  if (user?.role !== 'admin' && user?.role !== 'staff')
    return <p role="alert">Admin or staff access required for Problem Authoring.</p>;
  if (editorMode) {
    return draftId ? <StatementEditor key={draftId} id={draftId} /> : <DraftList />;
  }
  if (location.pathname === '/admin/authoring/profiles') return <ProfilesPage />;
  if (location.pathname === '/admin/authoring/ai-docs') return <AiDocsPage />;
  if (draftId) return <DraftWorkspace key={draftId} id={draftId} />;
  return <DraftList />;
}

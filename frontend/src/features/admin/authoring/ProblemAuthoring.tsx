import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button, Dialog, OverflowTable, StatusBadge } from '../../../components/ui';
import { useAuth } from '../../../context/AuthContext';
import authoringService from '../../../services/admin/authoringService';
import { getErrorMessage } from '../../../utils/error';
import { Draft, DraftFields, Profile } from './types';
import { draftStatus } from './status';
import MetadataFields from './MetadataFields';
import DraftWorkspace from './DraftWorkspace';
import StatementEditor from './StatementEditor';
import AuthorProfiles from './AuthorProfiles';
import styles from './Authoring.module.css';

const initialFields: DraftFields = {
  problemId: '',
  title: '',
  authorProfileId: null,
  authorAkaName: '',
  authorRealName: '',
  language: 'Thai',
  countryCode: 'THA',
  timeLimitMs: 1000,
  memoryLimitMb: 256,
  statementHtml: '',
  solutionCpp: '',
  generatorCpp: null,
  templateVersion: 'red-gate-v1',
};

function DraftList() {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(initialFields);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createError, setCreateError] = useState('');
  useEffect(() => {
    let cancelled = false;
    Promise.all([authoringService.listDrafts(), authoringService.listProfiles()])
      .then(([draftList, profileList]) => {
        if (!cancelled) {
          setDrafts(draftList);
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
  return (
    <section className={styles.authoring}>
      <div className={styles.listHead}>
        <h1>Problem Authoring</h1>
        <div className={styles.actions}>
          <Link className={styles.actionLink} to="/admin/authoring/profiles">
            Author profiles
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
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h3>Drafts</h3>
            <p>{drafts.length} saved</p>
          </div>
          <OverflowTable label="Saved drafts">
            <table>
              <thead>
                <tr>
                  <th>Problem ID</th>
                  <th>Title</th>
                  <th>Author</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => {
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
            {!drafts.length && <p className={styles.panelBody}>No drafts yet. Create your first draft above.</p>}
          </OverflowTable>
        </section>
      )}
    </section>
  );
}

function ProfilesPage() {
  return (
    <section className={styles.authoring}>
      <Link to="/admin/authoring" className={styles.backLink}>← All drafts</Link>
      <h1>Author profiles</h1>
      <p>
        Reusable author identities shared across drafts. Saving an author-relevant edit asks for
        confirmation, then automatically refreshes every linked draft's metadata, rebuilds its PDF,
        and republishes published problems. Follow the runs in a draft's History &amp; Logs tab.
      </p>
      <AuthorProfiles />
    </section>
  );
}

export default function ProblemAuthoring({ editorMode = false }: { editorMode?: boolean }) {
  const { user, isLoading } = useAuth();
  const { draftId } = useParams();
  const location = useLocation();
  if (isLoading) return <p role="status">Loading authoring…</p>;
  if (user?.role !== 'admin')
    return <p role="alert">Admin access required for Problem Authoring.</p>;
  if (editorMode) {
    return draftId ? <StatementEditor key={draftId} id={draftId} /> : <DraftList />;
  }
  if (location.pathname === '/admin/authoring/profiles') return <ProfilesPage />;
  if (draftId) return <DraftWorkspace key={draftId} id={draftId} />;
  return <DraftList />;
}

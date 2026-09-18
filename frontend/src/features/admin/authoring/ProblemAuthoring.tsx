import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, OverflowTable, StatusBadge } from '../../../components/ui';
import { useAuth } from '../../../context/AuthContext';
import api from '../../../services/api';
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
  const [showProfiles, setShowProfiles] = useState(false);
  const [form, setForm] = useState(initialFields);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function loadProfiles() {
    setProfiles((await api.get<Profile[]>('/admin/author-profiles')).data);
  }
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<Draft[]>('/admin/authoring/drafts'),
      api.get<Profile[]>('/admin/author-profiles'),
    ])
      .then(([d, p]) => {
        if (!cancelled) {
          setDrafts(d.data);
          setProfiles(p.data);
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
      <h1>Problem Authoring</h1>
      <p>
        Write, build and verify a new problem. Published problems remain hidden until enabled in
        Problem Management.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className={`${styles.actions} ${styles.topActions}`}>
        <Button onClick={() => setCreating(true)}>New draft</Button>
        <Button variant="secondary" onClick={() => setShowProfiles((p) => !p)}>
          Author profiles
        </Button>
        <Link className={styles.actionLink} to="/admin/problems">
          Problem Management
        </Link>
      </div>
      {showProfiles && (
        <AuthorProfiles
          onChanged={() => {
            void loadProfiles().catch((e) =>
              setError(getErrorMessage(e, 'Could not load profiles'))
            );
          }}
        />
      )}
      {creating && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError('');
            try {
              const result = await api.post<Draft>('/admin/authoring/drafts', form);
              navigate(`/admin/authoring/${result.data.id}`);
            } catch (err) {
              setError(getErrorMessage(err, 'Could not create draft'));
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2>New draft</h2>
          <MetadataFields
            value={form}
            profiles={profiles}
            disabled={busy}
            onEdit={(key, value) => setForm((p) => ({ ...p, [key]: value }))}
          />
          <div className={styles.actions}>
            <Button disabled={busy} type="submit">
              Create draft
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {loading ? (
        <p role="status">Loading drafts…</p>
      ) : (
        <OverflowTable label="Saved drafts">
          <table>
            <caption>Saved drafts</caption>
            <thead>
              <tr>
                <th>Problem</th>
                <th>Author</th>
                <th>Status</th>
                <th>Revision</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => {
                const status = draftStatus(d.status);
                return (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/admin/authoring/${d.id}`}>
                        {d.problemId} — {d.title}
                      </Link>
                    </td>
                    <td>{d.authorAkaName}</td>
                    <td>
                      <StatusBadge tone={status.tone} title={status.hint}>
                        {status.label}
                      </StatusBadge>
                    </td>
                    <td>{d.revision}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!drafts.length && <p>No drafts yet. Create your first draft above.</p>}
        </OverflowTable>
      )}
    </section>
  );
}

export default function ProblemAuthoring({ editorMode = false }: { editorMode?: boolean }) {
  const { user, isLoading } = useAuth();
  const { draftId } = useParams();
  if (isLoading) return <p role="status">Loading authoring…</p>;
  if (user?.role !== 'admin')
    return <p role="alert">Admin access required for Problem Authoring.</p>;
  return draftId ? (
    editorMode ? (
      <StatementEditor key={draftId} id={draftId} />
    ) : (
      <DraftWorkspace key={draftId} id={draftId} />
    )
  ) : (
    <DraftList />
  );
}

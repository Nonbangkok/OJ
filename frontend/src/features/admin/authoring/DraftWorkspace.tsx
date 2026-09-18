import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import { Button, Dialog, StatusBadge } from '../../../components/ui';
import api from '../../../services/api';
import useAuthoringDraft from './useAuthoringDraft';
import { Profile } from './types';
import { draftStatus } from './status';
import JobHistory from './JobHistory';
import MetadataFields from './MetadataFields';
import StatementTab, { PdfPreview } from './StatementTab';
import TestcaseFiles from './TestcaseFiles';
import CodeEditor from './CodeEditor';
import styles from './Authoring.module.css';

const saveStateText: Record<string, string> = {
  saved: 'Saved automatically',
  dirty: 'Saving…',
  saving: 'Saving…',
  error: 'Save failed — will retry after you edit again',
};

// Each workspace section is a real URL (…/metadata, …/statement, …), so browser
// Back/Forward and shared links land on the exact section.
const sections = [
  { path: 'metadata', label: 'Metadata' },
  { path: 'statement', label: 'Statement' },
  { path: 'solution', label: 'Solution' },
  { path: 'testcases', label: 'Testcases' },
  { path: 'verify', label: 'Verify & Publish' },
  { path: 'jobs', label: 'History & Logs' },
] as const;

export default function DraftWorkspace({ id }: { id: string }) {
  const model = useAuthoringDraft(id);
  const { draft, form, onError } = model;
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<{ action: 'generate' | 'outputs' | 'publish'; revision: number } | null>(null);
  const [leaveGuard, setLeaveGuard] = useState(false);
  useEffect(() => {
    if (!model.dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [model.dirty]);
  // Ctrl/Cmd+S saves the draft from anywhere in the workspace.
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

  if (!draft || !form) return <section className={styles.authoring}><Link to="/admin/authoring">All drafts</Link>
    {model.error ? <p role="alert">{model.error}</p> : <p role="status">Loading draft…</p>}</section>;
  const editorDisabled = model.busy || !!model.activeJob || draft.status === 'published';
  const status = draftStatus(draft.status);

  // Context passed to each section route below.
  const workspace = { model, draft, form, editorDisabled, setConfirm, navigate };

  return <div className={styles.workspaceShell}>
    <aside className={styles.leftNav}>
      <div className={styles.navInfo}>
        <Link to="/admin/authoring" className={styles.backLink}>← All drafts</Link>
        <h2>{draft.title}</h2>
        <p className={styles.navProblemId}>{draft.problemId}</p>
        <div className={styles.navMeta}>
          <StatusBadge tone={status.tone} title={status.hint}>{status.label}</StatusBadge>
          <span>Revision {draft.revision}</span>
        </div>
        <strong className={styles.saveState} role="status">
          {draft.status === 'published' ? 'Published — read-only'
            : model.conflict ? 'Server state changed'
              : saveStateText[model.saveState] ?? ''}
        </strong>
        {model.activeJob && <p role="status" className={styles.navJob}><StatusBadge tone="info">Running</StatusBadge> {model.activeJob.jobType}</p>}
      </div>
      <nav className={styles.sectionNav} aria-label="Draft sections">
        {sections.map(section => <NavLink key={section.path} to={section.path} relative="path"
          className={({ isActive }) => isActive ? `${styles.navBtn} ${styles.navBtnActive}` : styles.navBtn}>
          {section.label}
        </NavLink>)}
      </nav>
    </aside>
    <div className={styles.workspaceMain}>
      {model.error && <p role="alert">{model.error}</p>}
      {model.recovered && <p role="status">Recovered unsaved edits from this browser tab.</p>}
      {model.conflict && <div role="alert" className={styles.conflictBanner}><p>Server state changed. Your unsaved text is retained.</p>
        <Button variant="secondary" disabled={model.busy} onClick={() => setLeaveGuard(true)}>Discard local changes and sync</Button></div>}
      {draft.status === 'published' && <p>Created as hidden. Manage visibility in <Link to="/admin/problems">Problem Management</Link>.</p>}
      <Outlet context={workspace} />
    </div>
    {confirm && <Dialog open title={confirm.action === 'publish' ? 'Publish this problem?' : 'Replace stored files?'}
      description={confirm.action === 'publish' ? 'The problem will be created as hidden. The draft becomes read-only.'
        : confirm.action === 'generate' ? 'Replace the entire testcase set with generated inputs? Existing outputs will be removed only if generation succeeds.'
          : 'Replace all expected outputs with the reference solution results? Existing outputs remain if any case fails.'}
      onClose={() => setConfirm(null)}
      footer={<>
        {confirm.action === 'publish'
          ? <Button disabled={model.actionsDisabled || confirm.revision !== draft.revision || !model.canPublish} onClick={() => {
              if (confirm.revision !== draft.revision) return;
              void model.publish();
              setConfirm(null);
            }}>Confirm publish</Button>
          : <Button disabled={model.actionsDisabled || confirm.revision !== draft.revision} onClick={() => {
              if (confirm.revision !== draft.revision || confirm.action === 'publish') return;
              void model.runJob(confirm.action, confirm.action === 'generate' ? { seed: '12345' } : {});
              setConfirm(null);
            }}>Confirm replacement</Button>}
        <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
      </>} /> }
    <Dialog open={leaveGuard} title="Discard local changes?"
      description="Your unsaved edits will be lost and the latest server revision will load."
      onClose={() => setLeaveGuard(false)}
      footer={<>
        <Button variant="destructive" disabled={model.busy} onClick={() => { setLeaveGuard(false); void model.discardAndRefresh(); }}>Discard and sync</Button>
        <Button variant="secondary" onClick={() => setLeaveGuard(false)}>Keep my changes</Button>
      </>} />
  </div>;
}

export type WorkspaceContext = {
  model: ReturnType<typeof useAuthoringDraft>;
  draft: import('./types').Draft;
  form: import('./types').Draft;
  editorDisabled: boolean;
  setConfirm: (confirm: { action: 'generate' | 'outputs' | 'publish'; revision: number } | null) => void;
  navigate: ReturnType<typeof useNavigate>;
};

export const DraftMetadata = MetadataSection;
export const DraftStatement = StatementSection;
export const DraftSolution = SolutionSection;
export const DraftTestcases = TestcasesSection;
export const DraftVerify = VerifySection;
export const DraftJobs = JobsSection;

function MetadataSection() {
  const { model, draft, form, editorDisabled } = useOutletContext<WorkspaceContext>();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const { onError } = model;
  useEffect(() => { let cancelled = false;
    api.get<Profile[]>('/admin/author-profiles').then(r => { if (!cancelled) setProfiles(r.data); }).catch(onError);
    return () => { cancelled = true; };
  }, [onError]);
  // The author snapshot refreshes automatically when its linked profile changes,
  // so profile edits on the profiles page propagate without a manual button.
  useEffect(() => {
    if (model.actionsDisabled || !draft.authorProfileId || draft.publishedAt !== null) return;
    const linked = profiles.find(p => p.id === draft.authorProfileId);
    if (!linked) return;
    const snapshot = { akaName: linked.akaName, realName: linked.realName, language: linked.defaultLanguage, countryCode: linked.countryCode };
    const current = { akaName: draft.authorAkaName, realName: draft.authorRealName, language: draft.language, countryCode: draft.countryCode };
    if (JSON.stringify(snapshot) === JSON.stringify(current)) return;
    void model.mutate(() => api.post(`/admin/authoring/drafts/${draft.id}/refresh-author-profile`,
      { expectedRevision: draft.revision }));
  }, [draft, profiles, model]);
  return <section className={styles.authoring}>
    <h2>Metadata</h2>
    <MetadataFields value={form} profiles={profiles} disabled={editorDisabled}
      problemIdLocked={draft.publishedAt !== null} onEdit={model.edit} />
  </section>;
}

function StatementSection() {
  const { model, draft } = useOutletContext<WorkspaceContext>();
  return <section className={styles.authoring}>
    <h2>Statement</h2>
    <StatementTab draft={draft} disabled={model.actionsDisabled}
      onBuild={() => void model.runJob('pdf')} mutate={model.mutate} onError={model.onError} />
  </section>;
}

function SolutionSection() {
  const { model, form, editorDisabled } = useOutletContext<WorkspaceContext>();
  return <section className={styles.authoring}>
    <h2>Reference solution</h2>
    <CodeEditor label="solution.cpp" value={form.solutionCpp} disabled={editorDisabled}
      onChange={value => model.edit('solutionCpp', value)} />
    <div className={styles.sectionActions}>
      <Button disabled={model.actionsDisabled || !form.solutionCpp.trim()} onClick={() => void model.runJob('compile', { target: 'solution' })}>Compile solution</Button>
    </div>
  </section>;
}

function TestcasesSection() {
  const { model, draft, form, editorDisabled, setConfirm } = useOutletContext<WorkspaceContext>();
  const [seed, setSeed] = useState('12345');
  return <section className={styles.authoring}>
    <h2>Testcases</h2>
    <div className={styles.twoColumns}>
      <div className={styles.column}>
        <div className={styles.columnHead}>
          <h3>Files</h3>
          <Button disabled={model.actionsDisabled || !form.solutionCpp.trim()} onClick={() => setConfirm({ action: 'outputs', revision: draft.revision })}>Generate outputs</Button>
        </div>
        <TestcaseFiles draftId={draft.id} revision={draft.revision} artifactVersion={draft.updatedAt} disabled={model.actionsDisabled} onMutated={model.refresh} onError={model.onError} onBusyChange={model.setOperationBusy} />
      </div>
      <div className={styles.column}>
        <div className={styles.columnHead}>
          <h3>Generator <span className={styles.optionalTag}>optional</span></h3>
          <div className={styles.actions}>
            <Button variant="secondary" size="compact" disabled={model.actionsDisabled || !form.generatorCpp?.trim()} onClick={() => void model.runJob('compile', { target: 'generator' })}>Compile</Button>
            <Button size="compact" disabled={model.actionsDisabled || !form.generatorCpp?.trim() || !/^(0|[1-9][0-9]{0,19})$/.test(seed)
              || (seed.length === 20 && seed > '18446744073709551615')} onClick={() => setConfirm({ action: 'generate', revision: draft.revision })}>Generate inputs</Button>
          </div>
        </div>
        <CodeEditor label="generator.cpp" value={form.generatorCpp || ''} disabled={editorDisabled}
          onChange={value => model.edit('generatorCpp', value || null)} />
        <label className={styles.seedRow}>Generator seed<input value={seed} disabled={model.actionsDisabled} inputMode="numeric" onChange={e => setSeed(e.target.value)} /></label>
        <p className={styles.caution}>Legacy multi-file generators may ignore the seed and write to ./input/ instead of reading OJ_SEED or argv[1].</p>
      </div>
    </div>
  </section>;
}

function VerifySection() {
  const { model, draft, setConfirm, navigate } = useOutletContext<WorkspaceContext>();
  const status = draftStatus(draft.status);
  return <section className={styles.authoring}>
    <h2>Verify & Publish</h2>
    <div className={styles.verifyHero}>
      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      <span className={styles.verifyHeroText}>{status.hint}</span>
    </div>
    <PublishChecklist draft={draft} dirty={model.dirty} canPublish={model.canPublish} disabled={model.actionsDisabled}
      onVerify={() => void model.runJob('verify')} onPublish={() => setConfirm({ action: 'publish', revision: draft.revision })}
      onBuildPdf={() => void model.runJob('pdf')} onGoToTestcases={() => navigate('testcases', { relative: 'path' })} />
    <PdfPreview draft={draft} />
  </section>;
}

function JobsSection() {
  const { model } = useOutletContext<WorkspaceContext>();
  return <section className={styles.authoring}>
    <JobHistory jobs={model.jobs} onError={model.onError} />
  </section>;
}

function PublishChecklist({ draft, dirty, canPublish, disabled, onVerify, onPublish, onBuildPdf, onGoToTestcases }: {
  draft: import('./types').Draft; dirty: boolean; canPublish: boolean; disabled: boolean;
  onVerify: () => void; onPublish: () => void; onBuildPdf: () => void; onGoToTestcases: () => void;
}) {
  // Each gate names exactly what is missing and offers the action that fixes it.
  const pdfCurrent = draft.hasLatestPdf && draft.latestPdfRevision === draft.revision;
  const verified = draft.verifiedRevision === draft.revision;
  const hasOutputs = draft.status === 'generated' || draft.status === 'ready' || draft.status === 'published';
  const item = (done: boolean, label: string, detail: string, action?: React.ReactNode) =>
    <li className={done ? styles.checkDone : styles.checkTodo} key={label}>
      <span className={styles.checkMark} aria-hidden>{done ? '✓' : '○'}</span>
      <span className={styles.checkBody}>
        <span className={styles.checkLabel}>{label}</span>
        <span className={styles.checkDetail}>{done ? 'Done' : detail} {!done && action}</span>
      </span>
    </li>;
  return <div className={styles.verifyPanel}>
    <ul className={styles.checklist} aria-label="Publish readiness">
      {item(!!draft.solutionCpp.trim(), 'Reference solution', 'missing',
        <>— <button type="button" className={styles.linkButton} onClick={() => onGoToTestcases()}>add it</button></>)}
      {item(hasOutputs, 'Testcase outputs', 'not generated',
        <>— <button type="button" className={styles.linkButton} onClick={() => onGoToTestcases()}>generate</button></>)}
      {item(pdfCurrent, `PDF (revision ${draft.revision})`, draft.hasLatestPdf ? 'outdated' : 'not built',
        <>— <button type="button" className={styles.linkButton} disabled={disabled} onClick={onBuildPdf}>build now</button></>)}
      {item(verified, 'Verified', draft.verifiedRevision === null ? 'never verified' : `verified at revision ${draft.verifiedRevision}`,
        <>— <button type="button" className={styles.linkButton} disabled={disabled || !draft.solutionCpp.trim()} onClick={onVerify}>verify now</button></>)}
    </ul>
    {dirty && <p className={styles.caution}>Unsaved edits exist — saving automatically.</p>}
    <div className={styles.verifyActions}>
      <Button disabled={disabled || !draft.solutionCpp.trim()} onClick={onVerify}>Verify All</Button>
      <Button variant="primary" disabled={!canPublish} onClick={onPublish}>Publish problem</Button>
    </div>
    <p className={styles.caution}>Verify does not prove algorithm correctness.</p>
  </div>;
}

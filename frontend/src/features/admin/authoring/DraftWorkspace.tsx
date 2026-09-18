import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import { Button, Dialog, StatusBadge } from '../../../components/ui';
import api from '../../../services/api';
import useAuthoringDraft from './useAuthoringDraft';
import { draftBase, Profile } from './types';
import { draftStatus } from './status';
import JobHistory from './JobHistory';
import MetadataFields from './MetadataFields';
import StatementTab, { PdfPreview } from './StatementTab';
import TestcaseFiles from './TestcaseFiles';
import styles from './Authoring.module.css';

const saveStateText: Record<string, string> = {
  saved: 'All changes saved',
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
        <Button size="compact" disabled={!model.dirty || editorDisabled || model.conflict || !model.loaded}
          onClick={() => void model.save()}>Save now</Button>
        {model.activeJob && <p role="status" className={styles.navJob}><StatusBadge tone="info">Running</StatusBadge> {model.activeJob.jobType}</p>}
        {model.dirty && <p className={styles.navHint}>Edits save themselves after you stop typing.</p>}
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
      <JobHistory jobs={model.jobs} onError={onError} />
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

function MetadataSection() {
  const { model, draft, form, editorDisabled } = useOutletContext<WorkspaceContext>();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const { onError } = model;
  useEffect(() => { let cancelled = false;
    api.get<Profile[]>('/admin/author-profiles').then(r => { if (!cancelled) setProfiles(r.data); }).catch(onError);
    return () => { cancelled = true; };
  }, [onError]);
  return <section className={styles.authoring}>
    <h2>Metadata</h2>
    <MetadataFields value={form} profiles={profiles} disabled={editorDisabled}
      problemIdLocked={draft.publishedAt !== null} onEdit={model.edit} />
    <div className={styles.actions}>
      <Button variant="secondary" disabled={model.actionsDisabled || !draft.authorProfileId} onClick={() => void model.mutate(() =>
        api.post(`${draftBase(draft.id)}/refresh-author-profile`, { expectedRevision: draft.revision }))}>Refresh from profile</Button>
      <Link className={styles.actionLink} to="/admin/authoring/profiles">Manage author profiles</Link>
    </div>
    <p>Refresh explicitly copies the latest profile and avatar, increments revision and clears readiness.</p>
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
    <p>Private C++20 source. The author is responsible for algorithm correctness.</p>
    <label>solution.cpp<textarea spellCheck={false} disabled={editorDisabled} value={form.solutionCpp} onChange={e => model.edit('solutionCpp', e.target.value)} /></label>
    <Button disabled={model.actionsDisabled || !form.solutionCpp.trim()} onClick={() => void model.runJob('compile', { target: 'solution' })}>Compile solution</Button>
  </section>;
}

function TestcasesSection() {
  const { model, draft, form, editorDisabled, setConfirm } = useOutletContext<WorkspaceContext>();
  const [seed, setSeed] = useState('12345');
  return <section className={styles.authoring}>
    <h2>Generator & testcases</h2>
    <div className={styles.actions}>
      <Button disabled={model.actionsDisabled || !form.solutionCpp.trim()} onClick={() => setConfirm({ action: 'outputs', revision: draft.revision })}>Generate outputs</Button>
    </div>
    <p>Generate outputs runs the reference solution over every stored input. Upload inputs below; a generator is optional.</p>
    <details className={styles.generatorBox} open={!!form.generatorCpp?.trim()}>
      <summary>Optional generator (generator.cpp)</summary>
      <label>generator.cpp<textarea spellCheck={false} disabled={editorDisabled} value={form.generatorCpp || ''}
        onChange={e => model.edit('generatorCpp', e.target.value || null)} /></label>
      <p>New generators should read OJ_SEED or argv[1]. Legacy multi-file generators may write to ./input/ instead; passing a seed does not guarantee a legacy generator uses it.</p>
      <label>Generator seed<input value={seed} disabled={model.actionsDisabled} inputMode="numeric" onChange={e => setSeed(e.target.value)} /></label>
      <div className={styles.actions}>
        <Button variant="secondary" disabled={model.actionsDisabled || !form.generatorCpp?.trim()} onClick={() => void model.runJob('compile', { target: 'generator' })}>Compile generator</Button>
        <Button disabled={model.actionsDisabled || !form.generatorCpp?.trim() || !/^(0|[1-9][0-9]{0,19})$/.test(seed)
          || (seed.length === 20 && seed > '18446744073709551615')} onClick={() => setConfirm({ action: 'generate', revision: draft.revision })}>Generate inputs</Button>
      </div>
    </details>
    <TestcaseFiles draftId={draft.id} revision={draft.revision} artifactVersion={draft.updatedAt} disabled={model.actionsDisabled} onMutated={model.refresh} onError={model.onError} onBusyChange={model.setOperationBusy} />
  </section>;
}

function VerifySection() {
  const { model, draft, setConfirm, navigate } = useOutletContext<WorkspaceContext>();
  return <section className={styles.authoring}>
    <h2>Verify & Publish</h2>
    <PublishChecklist draft={draft} dirty={model.dirty} canPublish={model.canPublish} disabled={model.actionsDisabled}
      onVerify={() => void model.runJob('verify')} onPublish={() => setConfirm({ action: 'publish', revision: draft.revision })}
      onBuildPdf={() => void model.runJob('pdf')} onGoToTestcases={() => navigate('testcases', { relative: 'path' })} />
    <PdfPreview draft={draft} />
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
  const item = (done: boolean, label: string, action?: React.ReactNode) =>
    <li className={done ? styles.checkDone : styles.checkTodo} key={label}>
      <span aria-hidden>{done ? '✓' : '○'}</span> {label} {!done && action}
    </li>;
  return <>
    <ul className={styles.checklist} aria-label="Publish readiness">
      {item(!!draft.solutionCpp.trim(), 'Reference solution provided',
        <>— paste it in the <button type="button" className={styles.linkButton} onClick={onGoToTestcases}>Solution</button> section</>)}
      {item(hasOutputs, 'Testcase outputs generated',
        <>— run <button type="button" className={styles.linkButton} onClick={onGoToTestcases}>Generate outputs</button> in the Testcases section</>)}
      {item(pdfCurrent, `PDF built for revision ${draft.revision}`,
        <>— <button type="button" className={styles.linkButton} disabled={disabled} onClick={onBuildPdf}>Build PDF now</button></>)}
      {item(verified, `Verified at revision ${draft.revision}`,
        <>— <button type="button" className={styles.linkButton} disabled={disabled || !draft.solutionCpp.trim()} onClick={onVerify}>Verify All now</button></>)}
    </ul>
    {dirty && <p>Unsaved edits exist — they save automatically, then this checklist re-evaluates.</p>}
    <Button disabled={disabled || !draft.solutionCpp.trim()} onClick={onVerify}>Verify All</Button>
    <Button variant="primary" disabled={!canPublish} onClick={onPublish}>Publish problem</Button>
    <p>Verify renders the PDF, compiles C++, and compares the solution against stored outputs. It does not regenerate inputs or prove correctness.</p>
  </>;
}

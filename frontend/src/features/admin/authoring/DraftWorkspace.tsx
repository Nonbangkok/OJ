import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Dialog, StatusBadge } from '../../../components/ui';
import api from '../../../services/api';
import useAuthoringDraft from './useAuthoringDraft';
import { draftBase, Profile } from './types';
import { draftStatus } from './status';
import MetadataFields from './MetadataFields';
import StatementTab, { PdfPreview } from './StatementTab';
import TestcaseFiles from './TestcaseFiles';
import JobHistory from './JobHistory';
import styles from './Authoring.module.css';

const tabs = ['Metadata', 'Statement', 'Solution', 'Testcases', 'Verify & Publish'] as const;

const saveStateText: Record<string, string> = {
  saved: 'All changes saved',
  dirty: 'Saving…',
  saving: 'Saving…',
  error: 'Save failed — will retry after you edit again',
};

export default function DraftWorkspace({ id }: { id: string }) {
  const model = useAuthoringDraft(id);
  const { draft, form, onError, dirty } = model;
  const [tab, setTab] = useState<typeof tabs[number]>('Metadata');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [seed, setSeed] = useState('12345');
  const [confirm, setConfirm] = useState<{ action: 'generate' | 'outputs' | 'publish'; revision: number } | null>(null);
  const [leaveGuard, setLeaveGuard] = useState(false);
  useEffect(() => { let cancelled = false;
    api.get<Profile[]>('/admin/author-profiles').then(r => { if (!cancelled) setProfiles(r.data); }).catch(onError);
    return () => { cancelled = true; };
  }, [onError]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  if (!draft || !form) return <section className={styles.authoring}><Link to="/admin/authoring">All drafts</Link>
    {model.error ? <p role="alert">{model.error}</p> : <p role="status">Loading draft…</p>}</section>;
  const disabled = model.actionsDisabled;
  const editorDisabled = model.busy || !!model.activeJob || draft.status === 'published';
  const status = draftStatus(draft.status);
  return <section className={styles.authoring}>
    <Link to="/admin/authoring">All drafts</Link><h1>{draft.title}</h1>
    <div className={styles.summary}>
      <span>{draft.problemId}</span><span>Revision {draft.revision}</span>
      <StatusBadge tone={status.tone} title={status.hint}>{status.label}</StatusBadge>
      <strong className={styles.saveState} role="status">
        {draft.status === 'published' ? 'Published — read-only'
          : model.conflict ? 'Server state changed — see below'
            : saveStateText[model.saveState] ?? ''}
      </strong>
    </div>
    <div className={styles.toolbar}>
      <Button size="compact" disabled={!dirty || editorDisabled || model.conflict || !model.loaded}
        onClick={() => void model.save()}>Save now</Button>
      {model.activeJob && <p role="status"><StatusBadge tone="info">Running</StatusBadge> {model.activeJob.jobType} — {model.activeJob.status}. Actions are locked until it finishes.</p>}
      {dirty && <p>Unsaved edits save themselves automatically shortly after you stop typing.</p>}
    </div>
    {model.error && <p role="alert">{model.error}</p>}
    {model.recovered && <p role="status">Recovered unsaved edits from this browser tab.</p>}
    {model.conflict && <div role="alert"><p>Server state changed. Your unsaved text is retained.</p>
      <Button variant="secondary" disabled={model.busy} onClick={() => setLeaveGuard(true)}>Discard local changes and sync</Button></div>}
    {draft.status === 'published' && <p>Created as hidden. Manage visibility in <Link to="/admin/problems">Problem Management</Link>.</p>}
    <div role="tablist" aria-label="Draft workspace" className={styles.tabs}>{tabs.map(name => <button key={name}
      type="button" role="tab" id={`tab-${name}`} aria-controls="draft-panel" aria-selected={tab === name}
      onClick={() => setTab(name)}>{name}</button>)}</div>
    <div id="draft-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {tab === 'Metadata' && <>
        <MetadataFields value={form} profiles={profiles} disabled={editorDisabled}
          problemIdLocked={draft.publishedAt !== null} onEdit={model.edit} />
        <Button variant="secondary" disabled={disabled || !draft.authorProfileId} onClick={() => void model.mutate(() =>
          api.post(`${draftBase(id)}/refresh-author-profile`, { expectedRevision: draft.revision }))}>Refresh from profile</Button>
        <p>Refresh explicitly copies the latest profile and avatar, increments revision and clears readiness.</p>
        <Link to="/admin/authoring">Manage author profiles in the draft list</Link>
      </>}
      {tab === 'Statement' && <StatementTab draft={draft} disabled={disabled}
        onBuild={() => void model.runJob('pdf')} mutate={model.mutate} onError={onError} />}
      {tab === 'Solution' && <section><h2>Reference solution</h2><p>Private C++20 source. The author is responsible for algorithm correctness.</p>
        <label>solution.cpp<textarea spellCheck={false} disabled={editorDisabled} value={form.solutionCpp} onChange={e => model.edit('solutionCpp', e.target.value)} /></label>
        <Button disabled={disabled || !form.solutionCpp.trim()} onClick={() => void model.runJob('compile', { target: 'solution' })}>Compile solution</Button>
      </section>}
      {tab === 'Testcases' && <section><h2>Generator & testcases</h2>
        <p>generator.cpp is optional. Without a generator, upload inputs and optional outputs below.</p>
        <label>generator.cpp<textarea spellCheck={false} disabled={editorDisabled} value={form.generatorCpp || ''}
          onChange={e => model.edit('generatorCpp', e.target.value || null)} /></label>
        <p>Legacy multi-file generators may write to ./input/. New generators should read OJ_SEED or argv[1].</p>
        <p>Reproducibility has not been demonstrated. Passing a seed does not guarantee that a legacy generator uses it.</p>
        <label>Generator seed<input value={seed} disabled={disabled} inputMode="numeric" onChange={e => setSeed(e.target.value)} /></label>
        <Button variant="secondary" disabled={disabled || !form.generatorCpp?.trim()} onClick={() => void model.runJob('compile', { target: 'generator' })}>Compile generator</Button>
        <Button disabled={disabled || !form.generatorCpp?.trim() || !/^(0|[1-9][0-9]{0,19})$/.test(seed)
          || (seed.length === 20 && seed > '18446744073709551615')} onClick={() => setConfirm({ action: 'generate', revision: draft.revision })}>Generate inputs</Button>
        <Button disabled={disabled || !form.solutionCpp.trim()} onClick={() => setConfirm({ action: 'outputs', revision: draft.revision })}>Generate outputs</Button>
        <TestcaseFiles draftId={id} revision={draft.revision} artifactVersion={draft.updatedAt} disabled={disabled} onMutated={model.refresh} onError={onError} onBusyChange={model.setOperationBusy} />
      </section>}
      {tab === 'Verify & Publish' && <section><h2>Verify & Publish</h2>
        <PublishChecklist draft={draft} dirty={dirty} canPublish={model.canPublish} disabled={disabled}
          onVerify={() => void model.runJob('verify')} onPublish={() => setConfirm({ action: 'publish', revision: draft.revision })}
          onBuildPdf={() => void model.runJob('pdf')} onGoToTestcases={() => setTab('Testcases')} />
        <PdfPreview draft={draft} />
      </section>}
    </div>
    {confirm && <Dialog open title={confirm.action === 'publish' ? 'Publish this problem?' : 'Replace stored files?'}
      description={confirm.action === 'publish' ? 'The problem will be created as hidden. The draft becomes read-only.'
        : confirm.action === 'generate' ? 'Replace the entire testcase set with generated inputs? Existing outputs will be removed only if generation succeeds.'
          : 'Replace all expected outputs with the reference solution results? Existing outputs remain if any case fails.'}
      onClose={() => setConfirm(null)}
      footer={<>
        {confirm.action === 'publish'
          ? <Button disabled={disabled || confirm.revision !== draft.revision || !model.canPublish} onClick={() => {
              if (confirm.revision !== draft.revision) return;
              void model.publish();
              setConfirm(null);
            }}>Confirm publish</Button>
          : <Button disabled={disabled || confirm.revision !== draft.revision} onClick={() => {
              if (confirm.revision !== draft.revision || confirm.action === 'publish') return;
              void model.runJob(confirm.action, confirm.action === 'generate' ? { seed } : {});
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
    <JobHistory jobs={model.jobs} onError={onError} />
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
        <>— paste it in the <button type="button" className={styles.linkButton} onClick={onGoToTestcases}>Solution</button> tab</>)}
      {item(hasOutputs, 'Testcase outputs generated',
        <>— run <button type="button" className={styles.linkButton} onClick={onGoToTestcases}>Generate outputs</button> in the Testcases tab</>)}
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

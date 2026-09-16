import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../services/api';
import useAuthoringDraft from './useAuthoringDraft';
import { draftBase, Profile } from './types';
import MetadataFields from './MetadataFields';
import StatementTab, { PdfPreview } from './StatementTab';
import TestcaseFiles from './TestcaseFiles';
import JobHistory from './JobHistory';
import styles from './Authoring.module.css';

const tabs = ['Metadata', 'Statement', 'Solution', 'Testcases', 'Verify & Publish'] as const;
export default function DraftWorkspace({ id }: { id: string }) {
  const model = useAuthoringDraft(id);
  const { draft, form, onError, dirty } = model;
  const [tab, setTab] = useState<typeof tabs[number]>('Metadata');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [seed, setSeed] = useState('12345');
  const [confirm, setConfirm] = useState<{ action: 'generate' | 'outputs' | 'publish'; revision: number } | null>(null);
  useEffect(() => { let cancelled = false;
    api.get<Profile[]>('/admin/author-profiles').then(r => { if (!cancelled) setProfiles(r.data); }).catch(onError);
    return () => { cancelled = true; };
  }, [onError]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const leaveLink = (event: MouseEvent) => {
      if ((event.target as Element)?.closest?.('a[href]') && !window.confirm('Leave without saving your draft changes?')) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', leaveLink, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', leaveLink, true); };
  }, [dirty]);
  if (!draft || !form) return <section className={styles.authoring}><Link to="/admin/authoring">All drafts</Link>
    {model.error ? <p role="alert">{model.error}</p> : <p role="status">Loading draft…</p>}</section>;
  const disabled = model.actionsDisabled;
  const editorDisabled = model.busy || !!model.activeJob || draft.status === 'published';
  return <section className={styles.authoring}>
    <Link to="/admin/authoring">All drafts</Link><h1>{draft.title}</h1>
    <div className={styles.summary}><span>{draft.problemId}</span><span>Revision {draft.revision}</span><span>{draft.status}</span></div>
    <div className={styles.toolbar}>
      <strong>{draft.status === 'published' ? 'Published — read-only' : dirty ? 'Unsaved changes' : 'All changes saved'}</strong>
      <button type="button" disabled={!dirty || editorDisabled || model.conflict || !model.loaded} onClick={() => void model.save()}>Save draft</button>
      {model.activeJob && <p role="status">Active job: {model.activeJob.jobType} — {model.activeJob.status}. Actions are locked until it finishes.</p>}
      {dirty && <p>Save before compiling, generating, changing files, verifying or publishing.</p>}
    </div>
    {model.error && <p role="alert">{model.error}</p>}
    {model.conflict && <div role="alert"><p>Server state changed. Your unsaved text is retained.</p>
      <button type="button" disabled={model.busy} onClick={() => {
        if (window.confirm('Discard local changes and sync the latest server revision?')) void model.discardAndRefresh();
      }}>Discard local changes and sync</button></div>}
    {draft.status === 'published' && <p>Created as hidden. Manage visibility in <Link to="/admin/problems">Problem Management</Link>.</p>}
    <div role="tablist" aria-label="Draft workspace" className={styles.tabs}>{tabs.map(name => <button key={name}
      type="button" role="tab" id={`tab-${name}`} aria-controls="draft-panel" aria-selected={tab === name}
      onClick={() => setTab(name)}>{name}</button>)}</div>
    <div id="draft-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {tab === 'Metadata' && <>
        <MetadataFields value={form} profiles={profiles} disabled={editorDisabled} onEdit={model.edit} />
        <button type="button" disabled={disabled || !draft.authorProfileId} onClick={() => void model.mutate(() =>
          api.post(`${draftBase(id)}/refresh-author-profile`, { expectedRevision: draft.revision }))}>Refresh from profile</button>
        <p>Refresh explicitly copies the latest profile and avatar, increments revision and clears readiness.</p>
        <Link to="/admin/authoring">Manage author profiles in the draft list</Link>
      </>}
      {tab === 'Statement' && <StatementTab draft={draft} disabled={disabled}
        onBuild={() => void model.runJob('pdf')} mutate={model.mutate} onError={onError} />}
      {tab === 'Solution' && <section><h2>Reference solution</h2><p>Private C++20 source. The author is responsible for algorithm correctness.</p>
        <label>solution.cpp<textarea spellCheck={false} disabled={editorDisabled} value={form.solutionCpp} onChange={e => model.edit('solutionCpp', e.target.value)} /></label>
        <button type="button" disabled={disabled || !form.solutionCpp.trim()} onClick={() => void model.runJob('compile', { target: 'solution' })}>Compile solution</button>
      </section>}
      {tab === 'Testcases' && <section><h2>Generator & testcases</h2>
        <p>generator.cpp is optional. Without a generator, upload inputs and optional outputs below.</p>
        <label>generator.cpp<textarea spellCheck={false} disabled={editorDisabled} value={form.generatorCpp || ''}
          onChange={e => model.edit('generatorCpp', e.target.value || null)} /></label>
        <p>Legacy multi-file generators may write to ./input/. New generators should read OJ_SEED or argv[1].</p>
        <p>Reproducibility has not been demonstrated. Passing a seed does not guarantee that a legacy generator uses it.</p>
        <label>Generator seed<input value={seed} disabled={disabled} inputMode="numeric" onChange={e => setSeed(e.target.value)} /></label>
        <button type="button" disabled={disabled || !form.generatorCpp?.trim()} onClick={() => void model.runJob('compile', { target: 'generator' })}>Compile generator</button>
        <button type="button" disabled={disabled || !form.generatorCpp?.trim() || !/^(0|[1-9][0-9]{0,19})$/.test(seed)
          || (seed.length === 20 && seed > '18446744073709551615')} onClick={() => setConfirm({ action: 'generate', revision: draft.revision })}>Generate inputs</button>
        <button type="button" disabled={disabled || !form.solutionCpp.trim()} onClick={() => setConfirm({ action: 'outputs', revision: draft.revision })}>Generate outputs</button>
        <TestcaseFiles draftId={id} revision={draft.revision} artifactVersion={draft.updatedAt} disabled={disabled} onMutated={model.refresh} onError={onError} onBusyChange={model.setOperationBusy} />
      </section>}
      {tab === 'Verify & Publish' && <section><h2>Verify & Publish</h2>
        <p>Verify renders the PDF, compiles C++, and compares the solution against stored outputs. It does not regenerate inputs or prove correctness.</p>
        <ul><li>Saved revision: {draft.revision}{dirty ? ' (unsaved edits exist)' : ''}</li>
          <li>Solution: {draft.solutionCpp.trim() ? 'provided' : 'missing'}</li>
          <li>Generator: {draft.generatorCpp?.trim() ? 'provided (compile-only during Verify)' : 'optional — not provided'}</li>
          <li>Verified revision: {draft.verifiedRevision ?? 'none'}</li>
          <li>Publish readiness: {model.canPublish ? 'ready' : 'not ready or actions locked'}</li></ul>
        <button type="button" disabled={disabled || !form.solutionCpp.trim()} onClick={() => void model.runJob('verify')}>Verify All</button>
        <button type="button" disabled={!model.canPublish} onClick={() => setConfirm({ action: 'publish', revision: draft.revision })}>Publish problem</button>
        <PdfPreview draft={draft} />
      </section>}
    </div>
    {confirm && <section aria-label="Confirm action" className={styles.confirmation}>
      <p>{confirm.action === 'publish' ? 'The problem will be created as hidden. The draft becomes read-only. Confirm Publish?'
        : confirm.action === 'generate' ? 'Replace the entire testcase set with generated inputs? Existing outputs will be removed only if generation succeeds.'
          : 'Replace all expected outputs with the reference solution results? Existing outputs remain if any case fails.'}</p>
      <button type="button" disabled={disabled || confirm.revision !== draft.revision || (confirm.action === 'publish' && !model.canPublish)} onClick={() => {
        if (confirm.revision !== draft.revision) return;
        if (confirm.action === 'publish') void model.publish();
        else void model.runJob(confirm.action, confirm.action === 'generate' ? { seed } : {});
        setConfirm(null);
      }}>{confirm.action === 'publish' ? 'Confirm Publish' : 'Confirm replacement'}</button>
      <button type="button" onClick={() => setConfirm(null)}>Cancel</button>
    </section>}
    <JobHistory jobs={model.jobs} onError={onError} />
  </section>;
}

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Check, Circle } from '@phosphor-icons/react';
import { Link, Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { Button, ConfirmDialog, Dialog, StatusBadge } from '../../../components/ui';
import authoringService from '../../../services/admin/authoringService';
import { getErrorMessage } from '../../../utils/error';
import WorkspaceHeader from './WorkspaceHeader';
import StepTabs, { type StepPath } from './StepTabs';
import { readinessFromWorkspace, readinessOf, type ReadinessState } from './readiness';
import workspaceStyles from './Workspace.module.css';
import useAuthoringDraft from './useAuthoringDraft';
import { Profile } from './types';
import { draftStatus, jobLabel, jobStatus, verifyFailureExplanation } from './status';
import JobHistory from './JobHistory';
import MetadataFields from './MetadataFields';
import StatementTab, { PdfPreview } from './StatementTab';
import TestcaseFiles from './TestcaseFiles';
import CodeEditor from './CodeEditor';
import AiDocs from './AiDocs';
import { GENERATOR_TEMPLATE } from './generatorTemplate';
import styles from './Authoring.module.css';

const worse = (a: ReadinessState, b: ReadinessState): ReadinessState => {
  const rank: Record<ReadinessState, number> = { done: 0, todo: 1, stale: 2, failed: 3 };
  return rank[a] >= rank[b] ? a : b;
};

export default function DraftWorkspace({ id }: { id: string }) {
  const model = useAuthoringDraft(id);
  const { draft, form, onError } = model;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [confirm, setConfirm] = useState<WorkspaceConfirm | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [leaveGuard, setLeaveGuard] = useState(false);
  useEffect(() => {
    if (!model.dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [model.dirty]);
  // Ctrl/Cmd+S saves the draft from anywhere in the workspace.
  const saveLatest = useEffectEvent(() => model.save());
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveLatest();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const steps = useMemo(() => {
    if (!draft) return null;
    const r = readinessOf(readinessFromWorkspace(draft, model.jobs));
    return {
      metadata: 'done', statement: worse(r.statement, r.pdf), solution: r.solution, generator: r.generator,
      testcases: r.testcases, verify: r.verified,
    } as Record<StepPath, ReadinessState>;
  }, [draft, model.jobs]);

  if (!draft || !form) return <section className={styles.authoring}><Link to="/admin/authoring">All drafts</Link>
    {model.error ? <p role="alert">{model.error}</p> : <p role="status">Loading draft…</p>}</section>;
  const editorDisabled = model.busy || !!model.activeJob || draft.status === 'published';

  // Context passed to each section route below.
  const workspace = { model, draft, form, editorDisabled, setConfirm, navigate };
  const base = `/admin/authoring/${encodeURIComponent(id)}`;
  const onVerifyTab = pathname.endsWith('/verify');

  const startRevision = async () => {
    model.setOperationBusy(true);
    try { await authoringService.startNewRevision(draft.id); await model.refresh(); }
    catch (err) { onError(err); }
    finally { model.setOperationBusy(false); }
  };
  const removeDraft = async () => {
    try { await authoringService.deleteDraft(draft.id); setDeleting(false); navigate('/admin/authoring'); }
    catch (err) { setDeleting(false); onError(new Error(getErrorMessage(err, 'Could not delete the authoring draft'))); }
  };

  return <div className={workspaceStyles.workspace}>
    <WorkspaceHeader
      draft={draft}
      saveState={model.saveState}
      conflict={model.conflict}
      activeJob={model.activeJob}
      canPublish={model.canPublish}
      actionsDisabled={model.actionsDisabled}
      onVerifyTab={onVerifyTab}
      onVerify={() => { void model.runJob('verify'); }}
      onPublish={() => setConfirm({ action: 'publish', revision: draft.revision })}
      onStartRevision={() => { void startRevision(); }}
      onDelete={() => setDeleting(true)}
    />
    {steps && <StepTabs base={base} states={steps} />}
    <div className={workspaceStyles.workspace}>
      {model.error && <p role="alert">{model.error}</p>}
      {model.recovered && <p role="status">Recovered unsaved edits from this browser tab.</p>}
      {model.conflict && <div role="alert" className={styles.conflictBanner}><p>Server state changed. Your unsaved text is retained.</p>
        <Button variant="secondary" disabled={model.busy} onClick={() => setLeaveGuard(true)}>Discard local changes and sync</Button></div>}
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
              void model.runJob(confirm.action, confirm.action === 'generate' ? { seed: confirm.seed } : {});
              setConfirm(null);
            }}>Confirm replacement</Button>}
        <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
      </>} /> }
    <ConfirmDialog
      open={deleting}
      tier="destructive"
      title={`Delete ${draft.problemId}?`}
      body="This permanently deletes this authoring draft and its draft-only artifacts. A problem it already published stays live."
      confirmLabel="Delete draft"
      onConfirm={() => { void removeDraft(); }}
      onCancel={() => setDeleting(false)}
    />
    <Dialog open={leaveGuard} title="Discard local changes?"
      description="Your unsaved edits will be lost and the latest server revision will load."
      onClose={() => setLeaveGuard(false)}
      footer={<>
        <Button variant="destructive" disabled={model.busy} onClick={() => { setLeaveGuard(false); void model.discardAndRefresh(); }}>Discard and sync</Button>
        <Button variant="secondary" onClick={() => setLeaveGuard(false)}>Keep my changes</Button>
      </>} />
  </div>;
}

/** A pending confirm dialog. Generate carries the seed entered in the
 *  Testcases panel, so the job runs with exactly what the author typed. */
export type WorkspaceConfirm =
  | { action: 'generate'; revision: number; seed: string }
  | { action: 'outputs' | 'publish'; revision: number };

export type WorkspaceContext = {
  model: ReturnType<typeof useAuthoringDraft>;
  draft: import('./types').Draft;
  form: import('./types').Draft;
  editorDisabled: boolean;
  setConfirm: (confirm: WorkspaceConfirm | null) => void;
  navigate: ReturnType<typeof useNavigate>;
};

export const DraftMetadata = MetadataSection;
export const DraftStatement = StatementSection;
export const DraftSolution = SolutionSection;
export const DraftTestcases = TestcasesSection;
export const DraftGenerator = GeneratorSection;
export const DraftVerify = VerifySection;
export const DraftJobs = JobsSection;
export const DraftAiDocs = AiDocsSection;

function MetadataSection() {
  const { model, draft, form, editorDisabled } = useOutletContext<WorkspaceContext>();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const { onError, mutate } = model;
  // Profiles are refetched when the tab regains focus — the same trigger the
  // draft hook uses — so profile edits made elsewhere (the profiles page,
  // another tab) reach an already-open draft page and re-run the comparison.
  // A sequence guard keeps a slow earlier response from clobbering a newer one.
  const profileSeq = useRef(0);
  const loadProfiles = useCallback(() => {
    const seq = ++profileSeq.current;
    authoringService.listProfiles().then(list => { if (seq === profileSeq.current) setProfiles(list); }).catch(onError);
  }, [onError]);
  useEffect(() => { loadProfiles(); }, [loadProfiles]);
  useEffect(() => {
    const sync = () => { if (document.visibilityState === 'visible') loadProfiles(); };
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [loadProfiles]);
  // The author snapshot refreshes automatically when its linked profile changes,
  // so profile edits on the profiles page propagate without a manual button.
  // Keyed on the compared values (not the whole model, whose identity changes
  // every render) and deduped with a ref, so one real profile change produces
  // exactly one POST — never a loop that pins busy=true and disables the form.
  const linked = draft.authorProfileId ? profiles.find(p => p.id === draft.authorProfileId) : undefined;
  const syncKey = linked
    ? [draft.id, linked.akaName, linked.realName, linked.defaultLanguage, linked.countryCode,
      draft.authorAkaName, draft.authorRealName, draft.language, draft.countryCode].join(' ')
    : '';
  const syncAttemptedKey = useRef('');
  useEffect(() => {
    // Never sync a published draft; unsaved edits / conflicts / jobs leave the
    // sync for after autosave resolves rather than fighting it. A skip does
    // NOT mark the key as attempted, so it retries once the blocker clears.
    if (!linked || draft.status === 'published' || model.actionsDisabled) return;
    if (JSON.stringify([linked.akaName, linked.realName, linked.defaultLanguage, linked.countryCode])
      === JSON.stringify([draft.authorAkaName, draft.authorRealName, draft.language, draft.countryCode])) return;
    if (syncAttemptedKey.current === syncKey) return; // already tried this exact mismatch
    syncAttemptedKey.current = syncKey;
    // One attempt per mismatch: a failed POST surfaces via model.error and is
    // not auto-retried, so a persistently failing sync can never loop.
    void mutate(() => authoringService.refreshAuthorProfile(draft.id, draft.revision));
    // syncKey covers draft.id plus every compared value, so this re-runs when a
    // real profile edit (or a successful refresh) changes them — once each time;
    // actionsDisabled (a plain boolean) re-runs a sync skipped mid-autosave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey, draft.status, model.actionsDisabled]);
  return <section className={styles.authoring}>
    <h2>Metadata</h2>
    <MetadataFields value={form} profiles={profiles} disabled={editorDisabled}
      problemIdLocked={draft.publishedAt !== null} onEdit={model.edit} />
  </section>;
}

function StatementSection() {
  const { model, draft } = useOutletContext<WorkspaceContext>();
  return <section className={styles.authoring}>
    <StatementTab draft={draft} disabled={model.actionsDisabled}
      onBuild={() => void model.runJob('pdf')} mutate={model.mutate} onError={model.onError} />
  </section>;
}

function SolutionSection() {
  const { model, form, editorDisabled } = useOutletContext<WorkspaceContext>();
  return <section className={styles.authoring}>
    <h2>Solution</h2>
    <CodeEditor label="solution.cpp" value={form.solutionCpp} disabled={editorDisabled}
      onChange={value => model.edit('solutionCpp', value)} />
    <div className={styles.sectionActions}>
      <Button disabled={model.actionsDisabled || !form.solutionCpp.trim()} onClick={() => void model.runJob('compile', { target: 'solution' })}>Compile solution</Button>
    </div>
  </section>;
}

function TestcasesSection() {
  const { model, draft, form, setConfirm } = useOutletContext<WorkspaceContext>();
  const [seed, setSeed] = useState('12345');
  const seedValid = /^(0|[1-9][0-9]{0,19})$/.test(seed) && !(seed.length === 20 && seed > '18446744073709551615');
  return <section className={styles.authoring}>
    <h2>Testcases</h2>
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>Generate</h3>
      </div>
      <div className={styles.panelBody}>
        <div className={styles.generateRow}>
          <label className={styles.seedRow}>Generator seed<input value={seed} disabled={model.actionsDisabled || !form.generatorCpp?.trim()} inputMode="numeric" onChange={e => setSeed(e.target.value)} /></label>
          <div className={styles.actions}>
            <Button disabled={model.actionsDisabled || !form.generatorCpp?.trim() || !seedValid}
              onClick={() => setConfirm({ action: 'generate', revision: draft.revision, seed })}>Generate inputs</Button>
            <Button disabled={model.actionsDisabled || !form.solutionCpp.trim()} onClick={() => setConfirm({ action: 'outputs', revision: draft.revision })}>Generate outputs</Button>
          </div>
        </div>
        <p className={styles.caution}>Legacy multi-file generators may ignore the seed and write to ./input/ instead of reading OJ_SEED or argv[1].</p>
      </div>
    </section>
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>Files</h3>
      </div>
      <TestcaseFiles draftId={draft.id} revision={draft.revision} artifactVersion={draft.updatedAt} disabled={model.actionsDisabled} onMutated={model.refresh} onError={model.onError} onBusyChange={model.setOperationBusy} />
    </section>
  </section>;
}

function GeneratorSection() {
  const { model, draft, form, editorDisabled } = useOutletContext<WorkspaceContext>();
  return <section className={styles.authoring}>
    <h2>Generator <span className={styles.optionalTag}>optional</span></h2>
    <CodeEditor label="generator.cpp" value={form.generatorCpp || ''} disabled={editorDisabled}
      onChange={value => model.edit('generatorCpp', value || null)} minLines={18} />
    <details className={styles.generatorTemplate}>
      <summary>Reference template — the runner contract</summary>
      <ul>
        <li>Write 1–10 <code>.txt</code> files into <code>input/</code> — the runner collects them as the draft's testcases.</li>
        <li>The seed arrives as <code>argv[1]</code>; using it makes generation reproducible.</li>
        <li>Opening a file whose folder doesn't exist fails <em>silently</em> — check the stream before writing.</li>
        <li>Exit 0; keep total runtime within the generator timeout.</li>
      </ul>
      <pre>{GENERATOR_TEMPLATE}</pre>
      <Button variant="secondary" size="compact" disabled={editorDisabled || !!form.generatorCpp?.trim()}
        onClick={() => model.edit('generatorCpp', GENERATOR_TEMPLATE)}>
        {form.generatorCpp?.trim() ? 'Editor already has code' : 'Use this template'}
      </Button>
    </details>
    <div className={styles.sectionActions}>
      <Button disabled={model.actionsDisabled || !form.generatorCpp?.trim()} onClick={() => void model.runJob('compile', { target: 'generator' })}>Compile generator</Button>
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
    <VerifyOutcome draft={draft} jobs={model.jobs} />
    <PublishChecklist draft={draft} dirty={model.dirty} canPublish={model.canPublish} disabled={model.actionsDisabled}
      onVerify={() => void model.runJob('verify')} onPublish={() => setConfirm({ action: 'publish', revision: draft.revision })}
      onBuildPdf={() => void model.runJob('pdf')} onGoToSolution={() => navigate('solution', { relative: 'path' })}
      onGoToTestcases={() => navigate('testcases', { relative: 'path' })} />
    <PdfPreview draft={draft} />
  </section>;
}

/**
 * Outcome of the most recent Verify All for the current revision: a green
 * panel when it passed, and a plain-language failure explanation (which
 * stage failed and on which testcase) when it did not.
 */
function VerifyOutcome({ draft, jobs }: { draft: import('./types').Draft; jobs: import('./types').Job[] }) {
  const verify = jobs.find(job => job.jobType === 'verify_all');
  if (!verify || verify.status === 'queued' || verify.status === 'compiling' || verify.status === 'running') {
    return null;
  }
  if (verify.status === 'succeeded') {
    return <div className={`${styles.verifyOutcome} ${styles.verifyOutcomePassed}`} role="status">
      <StatusBadge tone="success">Verified</StatusBadge>
      <span className={styles.verifyOutcomeText}>
        All checks passed at revision {verify.draftRevision}
        {verify.resultSummary?.verification?.caseCount
          ? ` — ${verify.resultSummary.verification.caseCount} testcases executed against the solution.`
          : '.'}
      </span>
    </div>;
  }
  const { title, detail } = verifyFailureExplanation(verify);
  const timedOut = verify.status === 'timed_out';
  return <div
    className={`${styles.verifyOutcome} ${timedOut ? styles.verifyOutcomeTimedOut : styles.verifyOutcomeFailed}`}
    role="alert">
    <StatusBadge tone={timedOut ? 'warning' : 'danger'}>{timedOut ? 'Timed out' : 'Failed'}</StatusBadge>
    <div className={styles.verifyOutcomeText}>
      <strong>{title}.</strong> {detail}
      {verify.resultSummary?.failedCase
        ? <> Failing testcase: <code>#${verify.resultSummary.failedCase.caseNumber}</code>{verify.resultSummary.failedCase.durationMs !== undefined ? ` (${verify.resultSummary.failedCase.durationMs} ms)` : ''}.</>
        : null}
      <div className={styles.verifyOutcomeHint}>
        The problem cannot be published until verification passes.
      </div>
    </div>
  </div>;
}

function JobsSection() {
  const { model } = useOutletContext<WorkspaceContext>();
  return <section className={styles.authoring}>
    <JobHistory jobs={model.jobs} onError={model.onError} />
  </section>;
}

/** The AI Docs reference page, embedded as the last workspace nav entry. */
function AiDocsSection() {
  return <AiDocs embedded />;
}

function PublishChecklist({ draft, dirty, canPublish, disabled, onVerify, onPublish, onBuildPdf, onGoToSolution, onGoToTestcases }: {
  draft: import('./types').Draft; dirty: boolean; canPublish: boolean; disabled: boolean;
  onVerify: () => void; onPublish: () => void; onBuildPdf: () => void; onGoToSolution: () => void; onGoToTestcases: () => void;
}) {
  // Each gate names exactly what is missing and offers the action that fixes it.
  const pdfCurrent = draft.hasLatestPdf && draft.latestPdfRevision === draft.revision;
  const verified = draft.verifiedRevision === draft.revision;
  // Testcase readiness is a fact about the stored cases (every input has its
  // paired expected output), deliberately independent of the draft status —
  // starting a fresh verify resets the status, but never the testcases.
  const { total, withOutput } = draft.testcaseStats;
  const testcasesComplete = total > 0 && withOutput === total;
  const testcaseDetail = total === 0
    ? 'no testcases yet'
    : withOutput === total
      ? `${total} ${total === 1 ? 'case' : 'cases'}, all paired`
      : `${total - withOutput} of ${total} ${total - withOutput === 1 ? 'case' : 'cases'} missing expected outputs`;
  const item = (done: boolean, label: string, detail: string, action?: React.ReactNode, detailWhenDone = false) =>
    <li className={done ? styles.checkDone : styles.checkTodo} key={label}>
      <span className={styles.checkMark} aria-hidden>{done ? <Check size={14} weight="bold" /> : <Circle size={14} />}</span>
      <span className={styles.checkBody}>
        <span className={styles.checkLabel}>{label}</span>
        <span className={styles.checkDetail}>{done && !detailWhenDone ? 'Done' : detail} {!done && action}</span>
      </span>
    </li>;
  return <div className={styles.verifyPanel}>
    <ul className={styles.checklist} aria-label="Publish readiness">
      {item(!!draft.solutionCpp.trim(), 'Solution', 'missing',
        <>— <button type="button" className={styles.linkButton} onClick={() => onGoToSolution()}>add it</button></>)}
      {item(testcasesComplete, 'Testcases', testcaseDetail,
        <>— <button type="button" className={styles.linkButton} onClick={() => onGoToTestcases()}>{total === 0 ? 'add them' : 'open testcases'}</button></>, true)}
      {item(pdfCurrent, 'PDF', draft.hasLatestPdf ? 'outdated' : 'not built',
        <>— <button type="button" className={styles.linkButton} disabled={disabled} onClick={onBuildPdf}>build now</button></>)}
      {item(verified, 'Verified', draft.verifiedRevision === null ? 'never verified' : 'verified',
        <>— <button type="button" className={styles.linkButton} disabled={disabled || !draft.solutionCpp.trim()} onClick={onVerify}>verify now</button></>)}
    </ul>
    {dirty && <p className={styles.caution}>Unsaved edits exist — saving automatically.</p>}
    <div className={styles.verifyActions}>
      <Button disabled={disabled} onClick={onBuildPdf}>Build PDF</Button>
      <Button disabled={disabled || !draft.solutionCpp.trim()} onClick={onVerify}>Verify All</Button>
      <Button variant="primary" disabled={!canPublish} onClick={onPublish}>Publish problem</Button>
    </div>
  </div>;
}

import type { Draft, DraftSummary, Job } from './types';

/**
 * One readiness model for the draft list's Ready squares, the workspace's
 * step glyphs and the Verify & publish list (§7.9). It only reads data that
 * is already loaded: the list's B7 `readiness`, or the workspace draft + jobs.
 */
export type ReadinessState = 'done' | 'todo' | 'stale' | 'failed';
export type ReadinessKey = 'statement' | 'solution' | 'generator' | 'testcases' | 'pdf' | 'verified';

export interface ReadinessInput {
  revision: number;
  verifiedRevision: number | null;
  status: Draft['status'];
  hasStatement: boolean;
  hasSolution: boolean;
  hasGenerator: boolean;
  testcases: { total: number; withOutput: number };
  latestPdfRevision: number | null;
  latestJobs: Partial<Record<string, { status: string; revision: number }>>;
}

const FAILED = new Set(['failed', 'timed_out']);

export function readinessOf(input: ReadinessInput): Record<ReadinessKey, ReadinessState> {
  const { revision, latestJobs: jobs } = input;
  const succeededNow = (type: string) => jobs[type]?.status === 'succeeded' && jobs[type]?.revision === revision;
  const failedNow = (type: string) => FAILED.has(jobs[type]?.status ?? '') && jobs[type]?.revision === revision;
  const compiled = (present: boolean, compileJob: string, alsoDoneBy?: string): ReadinessState => {
    if (!present) return 'todo';
    // Success at this revision first: a Verify that compiled the fixed code beats an older failed Compile.
    if (succeededNow(compileJob) || (alsoDoneBy !== undefined && succeededNow(alsoDoneBy))) return 'done';
    if (FAILED.has(jobs[compileJob]?.status ?? '')) return 'failed';
    return 'stale';
  };

  // A failure at this revision wins over missing pieces, so a failed run never hides as "to do"/"out of date".
  const testcases: ReadinessState = failedNow('generate_outputs') || failedNow('run_generator') ? 'failed'
    : input.testcases.total === 0 ? 'todo'
      : input.testcases.withOutput < input.testcases.total ? 'stale' : 'done';
  const pdf: ReadinessState = failedNow('build_pdf') ? 'failed'
    : input.latestPdfRevision === null ? 'todo'
      : input.latestPdfRevision === revision ? 'done' : 'stale';
  // The server nulls verifiedRevision on every revision bump, so "verified before" comes from the jobs.
  const verifiedBefore = input.verifiedRevision !== null || jobs.verify_all?.status === 'succeeded';
  const verified: ReadinessState = input.verifiedRevision === revision ? 'done'
    : failedNow('verify_all') ? 'failed'
      // A published draft re-synced from its profile (revision bumped, not re-verified) stays verified.
      : input.status === 'published' && verifiedBefore ? 'done'
        : verifiedBefore ? 'stale' : 'todo';

  return {
    statement: input.hasStatement ? 'done' : 'todo',
    solution: compiled(input.hasSolution, 'compile_solution', 'verify_all'),
    generator: compiled(input.hasGenerator, 'compile_generator'),
    testcases,
    pdf,
    verified,
  };
}

export function readinessFromSummary(row: DraftSummary): ReadinessInput {
  return {
    revision: row.revision,
    verifiedRevision: row.verifiedRevision,
    status: row.status,
    hasStatement: row.readiness.hasStatement,
    hasSolution: row.readiness.hasSolution,
    hasGenerator: row.readiness.hasGenerator,
    testcases: row.readiness.testcases,
    latestPdfRevision: row.readiness.latestPdfRevision,
    latestJobs: row.readiness.latestJobs,
  };
}

export function readinessFromWorkspace(draft: Draft, jobs: Job[]): ReadinessInput {
  const latestJobs: ReadinessInput['latestJobs'] = {};
  const newest: Record<string, number> = {};
  for (const job of jobs) {
    const at = Date.parse(job.createdAt);
    if (newest[job.jobType] === undefined || at > newest[job.jobType]) {
      newest[job.jobType] = at;
      latestJobs[job.jobType] = { status: job.status, revision: job.draftRevision };
    }
  }
  return {
    revision: draft.revision,
    verifiedRevision: draft.verifiedRevision,
    status: draft.status,
    hasStatement: draft.statementHtml.length > 0,
    hasSolution: draft.solutionCpp.length > 0,
    hasGenerator: (draft.generatorCpp ?? '').length > 0,
    testcases: draft.testcaseStats ?? { total: 0, withOutput: 0 },
    latestPdfRevision: draft.hasLatestPdf ? draft.latestPdfRevision : null,
    latestJobs,
  };
}

/** The list's status cell: a dot tone and its label. */
export function listStatus(row: DraftSummary): { tone: 'neutral' | 'warn' | 'ok' | 'bad'; label: string } {
  if (row.status === 'published') return { tone: 'ok', label: `Published · rev ${row.revision}` };
  if (row.readiness.activeJob) return { tone: 'warn', label: 'Job running' };
  const verify = row.readiness.latestJobs.verify_all;
  if (verify && FAILED.has(verify.status) && verify.revision === row.revision) return { tone: 'bad', label: 'Verify failed' };
  if (row.status === 'ready') return { tone: 'ok', label: 'Ready' };
  if (row.status === 'generated') return { tone: 'warn', label: 'Generated' };
  return { tone: 'neutral', label: 'Draft' };
}

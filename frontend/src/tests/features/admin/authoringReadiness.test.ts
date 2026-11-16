import {
  listStatus, readinessFromSummary, readinessFromWorkspace, readinessOf, type ReadinessInput,
} from '../../../features/admin/authoring/readiness';
import { jobLabel, jobStatus } from '../../../features/admin/authoring/status';
import { formatDecimalSize } from '../../../features/admin/authoring/testcaseSize';
import type { Draft, DraftSummary, Job } from '../../../features/admin/authoring/types';

const base = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  revision: 5, verifiedRevision: null, status: 'draft',
  hasStatement: true, hasSolution: true, hasGenerator: true,
  testcases: { total: 10, withOutput: 10 },
  latestPdfRevision: 5,
  latestJobs: {},
  ...over,
});
const at = (status: string, revision = 5) => ({ status, revision });

describe('readinessOf', () => {
  it('a draft with nothing yet is all todo and never throws', () => {
    expect(readinessOf(base({ hasStatement: false, hasSolution: false, hasGenerator: false, testcases: { total: 0, withOutput: 0 }, latestPdfRevision: null }))).toEqual({
      statement: 'todo', solution: 'todo', generator: 'todo', testcases: 'todo', pdf: 'todo', verified: 'todo',
    });
  });

  it('statement: empty → todo, else done', () => {
    expect(readinessOf(base({ hasStatement: false })).statement).toBe('todo');
    expect(readinessOf(base()).statement).toBe('done');
  });

  it('solution: failed compile → failed; compiled or verified at this revision → done; otherwise stale', () => {
    expect(readinessOf(base({ latestJobs: { compile_solution: at('failed', 3) } })).solution).toBe('failed');
    expect(readinessOf(base({ latestJobs: { compile_solution: at('timed_out') } })).solution).toBe('failed');
    expect(readinessOf(base({ latestJobs: { compile_solution: at('succeeded') } })).solution).toBe('done');
    expect(readinessOf(base({ latestJobs: { verify_all: at('succeeded') } })).solution).toBe('done');
    expect(readinessOf(base({ latestJobs: { compile_solution: at('succeeded', 4) } })).solution).toBe('stale');
    expect(readinessOf(base()).solution).toBe('stale');
  });

  it('generator absent → todo and does not affect verified', () => {
    const r = readinessOf(base({ hasGenerator: false, verifiedRevision: 5 }));
    expect(r.generator).toBe('todo');
    expect(r.verified).toBe('done');
    expect(readinessOf(base({ latestJobs: { compile_generator: at('succeeded') } })).generator).toBe('done');
    expect(readinessOf(base({ latestJobs: { compile_generator: at('failed') } })).generator).toBe('failed');
  });

  it('testcases: none → todo; missing outputs → stale; outputs failed at this revision → failed; else done', () => {
    expect(readinessOf(base({ testcases: { total: 0, withOutput: 0 } })).testcases).toBe('todo');
    expect(readinessOf(base({ testcases: { total: 10, withOutput: 9 } })).testcases).toBe('stale');
    expect(readinessOf(base({ latestJobs: { generate_outputs: at('failed') } })).testcases).toBe('failed');
    expect(readinessOf(base({ latestJobs: { generate_outputs: at('failed', 4) } })).testcases).toBe('done');
    expect(readinessOf(base()).testcases).toBe('done');
  });

  it('pdf: none → todo; build failed at this revision → failed; current → done; older → stale', () => {
    expect(readinessOf(base({ latestPdfRevision: null })).pdf).toBe('todo');
    expect(readinessOf(base({ latestJobs: { build_pdf: at('failed') } })).pdf).toBe('failed');
    expect(readinessOf(base()).pdf).toBe('done');
    expect(readinessOf(base({ latestPdfRevision: 3 })).pdf).toBe('stale');
  });

  it('verified: at this revision → done; verify failed at this revision → failed; older → stale; never → todo', () => {
    expect(readinessOf(base({ verifiedRevision: 5 })).verified).toBe('done');
    expect(readinessOf(base({ latestJobs: { verify_all: at('failed') } })).verified).toBe('failed');
    expect(readinessOf(base({ latestJobs: { verify_all: at('timed_out') } })).verified).toBe('failed');
    expect(readinessOf(base({ verifiedRevision: 3 })).verified).toBe('stale');
    expect(readinessOf(base()).verified).toBe('todo');
  });

  it('final review: a successful verify now beats a compile that failed at an older revision', () => {
    const r = readinessOf(base({ latestJobs: { compile_solution: at('failed', 4), verify_all: at('succeeded') } }));
    expect(r.solution).toBe('done');
    // A compile that failed at an older revision with nothing newer still reads failed.
    expect(readinessOf(base({ latestJobs: { compile_solution: at('failed', 4) } })).solution).toBe('failed');
  });

  it('final review: verified becomes stale after an edit (the server nulls verifiedRevision on every bump)', () => {
    const edited = base({ verifiedRevision: null, latestJobs: { verify_all: at('succeeded', 4) } });
    expect(readinessOf(edited).verified).toBe('stale');
  });

  it('final review: a published draft re-synced from its profile still reads verified', () => {
    const synced = base({ status: 'published', verifiedRevision: null, latestJobs: { verify_all: at('succeeded', 4) } });
    expect(readinessOf(synced).verified).toBe('done');
  });

  it('final review: failures win over missing pieces (outputs, inputs, first PDF)', () => {
    expect(readinessOf(base({ testcases: { total: 10, withOutput: 4 }, latestJobs: { generate_outputs: at('failed') } })).testcases).toBe('failed');
    expect(readinessOf(base({ testcases: { total: 0, withOutput: 0 }, latestJobs: { run_generator: at('timed_out') } })).testcases).toBe('failed');
    expect(readinessOf(base({ latestPdfRevision: null, latestJobs: { build_pdf: at('failed') } })).pdf).toBe('failed');
    // A failure that a newer success replaced is not reported: latestJobs holds the newest job per type.
    expect(readinessOf(base({ latestJobs: { run_generator: at('succeeded') } })).testcases).toBe('done');
  });

  it('a published draft keeps its stored readiness (all done)', () => {
    expect(Object.values(readinessOf(base({ status: 'published', verifiedRevision: 5, latestJobs: { compile_solution: at('succeeded'), compile_generator: at('succeeded') } })))).toEqual(
      ['done', 'done', 'done', 'done', 'done', 'done'],
    );
  });
});

const summary = (over: Partial<DraftSummary> = {}): DraftSummary => ({
  id: 'd1', problemId: 'p1', title: 'P', authorProfileId: null, authorAkaName: 'Ada', status: 'generated',
  revision: 5, verifiedRevision: null, createdBy: 1, createdAt: '2026-11-01', updatedAt: '2026-11-02', publishedAt: null,
  readiness: {
    hasStatement: true, hasSolution: true, hasGenerator: false, testcases: { total: 2, withOutput: 2 },
    latestPdfRevision: 4, latestJobs: { verify_all: { status: 'failed', revision: 5 } }, activeJob: false,
  },
  ...over,
});

describe('readinessFromSummary / listStatus', () => {
  it('maps a list row onto the readiness input', () => {
    expect(readinessFromSummary(summary())).toEqual(expect.objectContaining({
      revision: 5, hasGenerator: false, testcases: { total: 2, withOutput: 2 }, latestPdfRevision: 4,
    }));
  });

  it('labels: published with its revision, a failed verify at this revision, else the status', () => {
    expect(listStatus(summary({ status: 'published', publishedAt: '2026-11-03', revision: 9 }))).toEqual({ tone: 'ok', label: 'Published · rev 9' });
    expect(listStatus(summary())).toEqual({ tone: 'bad', label: 'Verify failed' });
    expect(listStatus(summary({ status: 'ready', readiness: { ...summary().readiness, latestJobs: {} } }))).toEqual({ tone: 'ok', label: 'Ready' });
    expect(listStatus(summary({ readiness: { ...summary().readiness, latestJobs: {} } }))).toEqual({ tone: 'warn', label: 'Generated' });
    expect(listStatus(summary({ status: 'draft', readiness: { ...summary().readiness, latestJobs: {} } }))).toEqual({ tone: 'neutral', label: 'Draft' });
  });
});

describe('readinessFromWorkspace', () => {
  it('takes the newest job per type and only a PDF that exists', () => {
    const draft = {
      revision: 5, verifiedRevision: null, status: 'draft', statementHtml: '<p/>', solutionCpp: 'x', generatorCpp: null,
      testcaseStats: { total: 1, withOutput: 0 }, hasLatestPdf: false, latestPdfRevision: 4,
    } as unknown as Draft;
    const jobs = [
      { jobType: 'compile_solution', status: 'succeeded', draftRevision: 5, createdAt: '2026-11-02T10:00:00Z' },
      { jobType: 'compile_solution', status: 'failed', draftRevision: 4, createdAt: '2026-11-01T10:00:00Z' },
    ] as Job[];
    const input = readinessFromWorkspace(draft, jobs);
    expect(input.latestJobs).toEqual({ compile_solution: { status: 'succeeded', revision: 5 } });
    expect(input.latestPdfRevision).toBeNull();
    expect(input.hasGenerator).toBe(false);
    expect(readinessOf(input).solution).toBe('done');
  });
});

describe('job vocabulary', () => {
  it('run_generator is labelled Generate inputs', () => {
    expect(jobLabel('run_generator')).toBe('Generate inputs');
    expect(jobLabel('generate_inputs')).toBe('Generate inputs');
  });
  it('timed_out, cancelled and stale have labels', () => {
    expect(jobStatus('timed_out')).toEqual({ label: 'Timed out', tone: 'danger' });
    expect(jobStatus('cancelled').label).toBe('Cancelled');
    expect(jobStatus('stale').label).toBe('Stale');
  });
});

describe('minor fixes', () => {
  it('a running job shows in the list status (B7 activeJob)', () => {
    expect(listStatus(summary({ readiness: { ...summary().readiness, activeJob: true } }))).toEqual({ tone: 'warn', label: 'Job running' });
    // A published problem keeps its live status while a profile sync runs.
    expect(listStatus(summary({ status: 'published', readiness: { ...summary().readiness, activeJob: true } })).label).toBe('Published · rev 5');
  });

  it('sizes never read "1000 kB"', () => {
    expect(formatDecimalSize(999_499)).toBe('999 kB');
    expect(formatDecimalSize(999_999)).toBe('1.0 MB');
    expect(formatDecimalSize(84_000)).toBe('84 kB');
    expect(formatDecimalSize(9_960)).toBe('10 kB');
  });
});

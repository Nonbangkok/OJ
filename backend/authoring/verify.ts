import { performance } from 'node:perf_hooks';
import { buildPdf } from './pdf';
import { compileJob } from './compiler';
import { generateOutputs } from './outputs';
import { AuthoringSpool } from './spool';
import { AUTHORING_RUNNER, failedResult, JobResult, JobSnapshot, Verification, jobSnapshotSchema } from './protocol';

/** Verify frozen authoring artifacts without regenerating inputs or publishing solution output. */
export async function verifyAll(input: JobSnapshot, workRoot: string, spool: AuthoringSpool,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<JobResult> {
  const started = performance.now();
  const job = jobSnapshotSchema.parse(input);
  if (job.kind !== 'verify_all') throw new Error('Expected a verification job');
  job.deadline = new Date(Math.min(Date.parse(job.deadline), Date.now() + AUTHORING_RUNNER.JOB_TIMEOUT_MS)).toISOString();
  const verification: Verification = {
    checks: { pdf: 'pending', solution: 'pending', generator: job.generatorSource ? 'pending' : 'skipped', execution: 'pending' },
    cases: [], caseCount: job.cases!.length,
    totalTestcaseBytes: [...job.cases!, ...job.expectedOutputs!].reduce((sum, file) => sum + file.sizeBytes, 0),
    memoryLimitMb: job.limits!.memoryLimitMb, peakMemoryBytes: null,
    warnings: ['Peak memory measurement is unavailable; execution enforces the configured address-space limit with the runner allowance.',
      ...(job.generatorSource ? ['Generator reproducibility has not been demonstrated; Verify All compiles it but does not regenerate inputs.'] : [])],
  };
  const identity = { version: job.version, jobId: job.jobId, draftId: job.draftId,
    revision: job.revision, deadline: job.deadline };
  const logs: string[] = [];
  const phaseLog = (phase: string, text: string) => {
    // Reserve space for every phase so a noisy compiler cannot hide later diagnostics.
    logs.push(`[${phase}]\n${Buffer.from(text).subarray(0, 15 * 1024).toString('utf8')}\n`);
  };
  const finish = (result: JobResult): JobResult => ({ ...result, verification,
    log: Buffer.from(logs.join('')).subarray(0, AUTHORING_RUNNER.MAX_LOG_BYTES - 3).toString('utf8'),
    durationMs: Math.min(AUTHORING_RUNNER.JOB_TIMEOUT_MS, Math.max(0, Math.round(performance.now() - started))) });
  let phase: 'pdf' | 'solution' | 'generator' | 'execution' = 'pdf';
  try {
    const pdfResult = await buildPdf({ ...identity, kind: 'build_pdf', source: '', pdf: job.pdf }, workRoot, spool,
      { signal: options.signal });
    phaseLog('pdf', pdfResult.log);
    verification.checks.pdf = pdfResult.status === 'succeeded' ? 'passed' : 'failed';
    if (pdfResult.status !== 'succeeded') return finish(pdfResult);
    phase = 'solution';
    const execution = await generateOutputs(job, workRoot, spool, { ...options, verification,
      beforeExecution: async () => {
        verification.checks.solution = 'passed';
        if (job.generatorSource) {
          phase = 'generator';
          const generator = await compileJob({ ...identity, kind: 'compile_generator', source: job.generatorSource },
            workRoot, { signal: options.signal });
          phaseLog('generator', generator.log);
          verification.checks.generator = generator.status === 'succeeded' ? 'passed' : 'failed';
          if (generator.status !== 'succeeded') return { ...generator, log: '' };
        }
        phase = 'execution';
        return undefined;
      },
    });
    phaseLog('solution', execution.log);
    if (verification.checks.solution === 'pending') verification.checks.solution = 'failed';
    if (verification.checks.solution === 'passed' && ['passed', 'skipped'].includes(verification.checks.generator)) {
      verification.checks.execution = execution.status === 'succeeded' ? 'passed' : 'failed';
    }
    return finish({ ...execution, ...(execution.status === 'succeeded' ? { pdf: pdfResult.pdf } : {}) });
  } catch {
    verification.checks[phase] = 'failed';
    return finish(failedResult(job, 'runner_error'));
  }
}

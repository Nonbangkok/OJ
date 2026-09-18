import { chmod, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { compileJob } from './compiler';
import { AUTHORING_RUNNER, failedResult, JobResult, JobSnapshot, jobSnapshotSchema } from './protocol';
import { runBoundedProcess } from './process';
import { AuthoringSpool } from './spool';
import { TESTCASE_LIMITS, TestcaseError } from './testcases';

/** Compile once, run once in a fresh jail, then atomically freeze validated inputs. */
export async function generateInputs(jobInput: JobSnapshot, workRoot: string, spool: AuthoringSpool,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<JobResult> {
  const job = jobSnapshotSchema.parse(jobInput);
  if (job.kind !== 'run_generator') throw new Error('Expected a generator job');
  return compileJob(job, workRoot, { signal: options.signal, onCompiled: async cwd => {
    const jail = path.join(cwd, 'jail');
    await mkdir(jail, { mode: 0o755 });
    await mkdir(path.join(jail, 'input'), { mode: 0o777 });
    await chmod(path.join(jail, 'input'), 0o777); // mkdir's requested mode is subject to umask.
    await copyFile(path.join(cwd, 'program'), path.join(jail, 'generator'));
    await chmod(path.join(jail, 'generator'), 0o555);
    const remaining = Date.parse(job.deadline) - Date.now();
    if (remaining <= 0) return failedResult(job, 'job_expired');
    const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? AUTHORING_RUNNER.GENERATOR_TIMEOUT_MS,
      AUTHORING_RUNNER.GENERATOR_TIMEOUT_MS, remaining));
    const execution = await runBoundedProcess('/usr/bin/prlimit', [
      `--as=${AUTHORING_RUNNER.MEMORY_BYTES}`, `--cpu=${Math.ceil(timeoutMs / 1000) + 1}`,
      `--nproc=${AUTHORING_RUNNER.MAX_PROCESSES}`, `--fsize=${TESTCASE_LIMITS.MAX_FILE_BYTES}`, '--core=0',
      '--', '/usr/local/bin/oj-authoring-sandbox', jail, job.seed!,
    ], { cwd, seed: job.seed, timeoutMs, maxLogBytes: AUTHORING_RUNNER.MAX_DIAGNOSTIC_BYTES, signal: options.signal });
    const result = failedResult(job, 'generator_runtime_error');
    result.durationMs = execution.durationMs;
    result.exitCode = execution.exitCode;
    result.log = Buffer.from(execution.log.replaceAll(cwd, '[workspace]').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ''))
      .subarray(0, AUTHORING_RUNNER.MAX_LOG_BYTES - 3).toString('utf8');
    if (execution.reason === 'timeout') { result.status = 'timed_out'; result.errorCode = 'generator_timeout'; }
    else if (execution.reason === 'aborted') result.errorCode = 'runner_interrupted';
    else if (execution.reason === 'output_limit') result.errorCode = 'generator_output_limit';
    else if (execution.reason === 'exited' && execution.exitCode === 0) {
      try {
        result.inputs = await spool.storeInputs(job.jobId, path.join(jail, 'input'));
        result.status = 'succeeded'; result.errorCode = null;
      } catch (error) {
        if (!(error instanceof TestcaseError) && !['ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        result.errorCode = 'invalid_generated_inputs';
        result.log = Buffer.from(`${result.log}\n${(error as Error).message}`).subarray(0, AUTHORING_RUNNER.MAX_LOG_BYTES - 3).toString('utf8');
      }
    }
    return result;
  } });
}

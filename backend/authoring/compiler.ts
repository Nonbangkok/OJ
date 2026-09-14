import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findForbiddenInclude } from '../utils/compileGuard';
import { AUTHORING_RUNNER, failedResult, JobResult, JobSnapshot, jobSnapshotSchema } from './protocol';
import { runBoundedProcess } from './process';

/** Compiles one immutable C++20 source as nobody, then optionally enters its runtime. */
export async function compileJob(input: JobSnapshot, workRoot: string, options: {
  timeoutMs?: number; signal?: AbortSignal; onCompiled?: (cwd: string) => Promise<JobResult>;
} = {}): Promise<JobResult> {
  const job = jobSnapshotSchema.parse(input);
  if (Date.parse(job.deadline) <= Date.now()) return failedResult(job, 'job_expired');
  if (findForbiddenInclude(job.source)) return failedResult(job, 'forbidden_include');
  if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('Compiler requires the isolated Linux runner');
  const cwd = await mkdtemp(path.join(workRoot, 'compile-'));
  try {
    await chmod(cwd, 0o777);
    const filename = job.kind === 'compile_solution' || job.kind === 'generate_outputs' ? 'solution.cpp' : 'generator.cpp';
    await writeFile(path.join(cwd, filename), job.source, { mode: 0o644 });
    const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? AUTHORING_RUNNER.COMPILE_TIMEOUT_MS,
      AUTHORING_RUNNER.COMPILE_TIMEOUT_MS, Date.parse(job.deadline) - Date.now()));
    const execution = await runBoundedProcess('/usr/bin/prlimit', [
      `--as=${AUTHORING_RUNNER.MEMORY_BYTES}`, `--cpu=${Math.ceil(timeoutMs / 1000) + 1}`,
      `--nproc=${AUTHORING_RUNNER.MAX_PROCESSES}`, `--fsize=${AUTHORING_RUNNER.MAX_BINARY_BYTES}`, '--core=0',
      '--', '/usr/bin/g++', '-std=c++20', '-O2', '-pipe', '-fdiagnostics-color=never', '-fmax-errors=30',
      ...(job.kind === 'run_generator' || job.kind === 'generate_outputs' ? ['-static'] : []),
      filename, '-o', 'program',
    ], { cwd, timeoutMs, uid: 65534, gid: 65534, maxLogBytes: AUTHORING_RUNNER.MAX_DIAGNOSTIC_BYTES, signal: options.signal });
    const result = failedResult(job, 'compile_error');
    if (execution.reason === 'timeout') { result.status = 'timed_out'; result.errorCode = 'compile_timeout'; }
    else if (execution.reason === 'output_limit') result.errorCode = 'diagnostic_limit';
    else if (execution.reason === 'aborted') result.errorCode = 'runner_interrupted';
    else if (execution.reason === 'spawn_error') result.errorCode = 'runner_error';
    else if (execution.exitCode === 0) { result.status = 'succeeded'; result.errorCode = null; }
    const neutralLog = execution.log.replaceAll(cwd, '[workspace]').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    // A partial multibyte character can expand into U+FFFD: leave three bytes of headroom.
    result.log = Buffer.from(neutralLog).subarray(0, AUTHORING_RUNNER.MAX_LOG_BYTES - 3).toString('utf8');
    result.durationMs = execution.durationMs;
    result.exitCode = execution.exitCode;
    if (result.status === 'succeeded' && options.onCompiled) {
      const run = await options.onCompiled(cwd);
      run.log = Buffer.from(result.log + run.log).subarray(0, AUTHORING_RUNNER.MAX_LOG_BYTES - 3).toString('utf8');
      run.durationMs += result.durationMs;
      return run;
    }
    return result;
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

import { chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { compileJob } from './compiler';
import { AUTHORING_RUNNER, failedResult, JobResult, JobSnapshot, jobSnapshotSchema, OutputArtifact } from './protocol';
import { runOutputProcess } from './outputProcess';
import { AuthoringSpool } from './spool';
import { TESTCASE_LIMITS, TestcaseError } from './testcases';

/** Compile once; run each immutable input in a read-only jail and publish only a complete set. */
export async function generateOutputs(jobInput: JobSnapshot, workRoot: string, spool: AuthoringSpool,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<JobResult> {
  const started = performance.now();
  const job = jobSnapshotSchema.parse(jobInput);
  if (job.kind !== 'generate_outputs') throw new Error('Expected an output-generation job');
  const limits = job.limits!;
  const deadline = Math.min(Date.parse(job.deadline), Date.now() + AUTHORING_RUNNER.JOB_TIMEOUT_MS);
  const result = await compileJob({ ...job, deadline: new Date(deadline).toISOString() }, workRoot, {
    signal: options.signal, onCompiled: async cwd => {
      const jail = path.join(cwd, 'jail');
      await mkdir(jail, { mode: 0o555 });
      await copyFile(path.join(cwd, 'program'), path.join(jail, 'solution'));
      await chmod(path.join(jail, 'solution'), 0o555);
      const stage = await spool.beginOutputArtifacts(job.jobId);
      const rawOutput = path.join(stage, 'stdout.partial');
      const outputs: OutputArtifact[] = [];
      let total = job.cases!.reduce((sum, input) => sum + input.sizeBytes, 0);
      let log = '';
      const cleanLog = (text: string) => Buffer.from(text.replaceAll(cwd, '[workspace]')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')).subarray(0, AUTHORING_RUNNER.MAX_LOG_BYTES - 3).toString('utf8');
      try {
        for (const [index, input] of job.cases!.entries()) {
          const failure = failedResult(job, 'solution_runtime_error');
          failure.failedCase = { caseId: input.caseId, caseNumber: input.caseNumber, durationMs: 0 };
          failure.log = log;
          if (options.signal?.aborted) { failure.errorCode = 'runner_interrupted'; return failure; }
          if (Date.now() >= deadline) { failure.status = 'timed_out'; failure.errorCode = 'job_expired'; return failure; }
          let text: string;
          try { text = await spool.readJobInput(job.jobId, index, input); }
          catch { failure.errorCode = 'invalid_job_inputs'; return failure; }
          const remaining = deadline - Date.now();
          if (remaining <= 0) { failure.status = 'timed_out'; failure.errorCode = 'job_expired'; return failure; }
          const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? limits.timeLimitMs, limits.timeLimitMs, remaining));
          const execution = await runOutputProcess('/usr/bin/prlimit', [
            `--as=${(limits.memoryLimitMb + 32) * 1024 * 1024}`, `--cpu=${Math.ceil(timeoutMs / 1000) + 1}`,
            `--nproc=${AUTHORING_RUNNER.MAX_PROCESSES}`, `--fsize=${TESTCASE_LIMITS.MAX_FILE_BYTES}`, '--core=0',
            '--', '/usr/local/bin/oj-authoring-sandbox', jail,
          ], { cwd, input: text, outputPath: rawOutput, timeoutMs,
            maxOutputBytes: Math.max(0, Math.min(TESTCASE_LIMITS.MAX_FILE_BYTES, TESTCASE_LIMITS.MAX_TOTAL_BYTES - total)),
            maxDiagnosticBytes: AUTHORING_RUNNER.MAX_DIAGNOSTIC_BYTES,
            maxLogBytes: AUTHORING_RUNNER.MAX_LOG_BYTES - 3, signal: options.signal });
          log = cleanLog(log + execution.log);
          failure.log = log;
          failure.exitCode = execution.exitCode;
          failure.failedCase!.durationMs = Math.min(AUTHORING_RUNNER.JOB_TIMEOUT_MS, execution.durationMs);
          if (execution.reason === 'timeout') { failure.status = 'timed_out'; failure.errorCode = 'solution_timeout'; }
          else if (execution.reason === 'aborted') failure.errorCode = 'runner_interrupted';
          else if (execution.reason === 'output_limit') failure.errorCode = 'solution_output_limit';
          else if (execution.reason === 'spawn_error') failure.errorCode = 'runner_error';
          else if (execution.exitCode === 0) {
            try {
              const artifact = await spool.appendOutputArtifact(stage, index, rawOutput);
              total += artifact.sizeBytes;
              outputs.push({ ...input, ...artifact, durationMs: failure.failedCase!.durationMs });
              await rm(rawOutput);
              continue;
            } catch (error) {
              if (!(error instanceof TestcaseError)) throw error;
              failure.errorCode = 'invalid_generated_outputs';
              failure.log = cleanLog(`${log}\n${error.message}`);
            }
          }
          return failure;
        }
        if (options.signal?.aborted) return failedResult(job, 'runner_interrupted');
        if (Date.now() >= deadline) return failedResult(job, 'job_expired');
        await spool.finishOutputArtifacts(job.jobId, stage);
        return { ...failedResult(job, 'runner_error'), status: 'succeeded', errorCode: null, exitCode: 0, log, outputs };
      } finally { await spool.discardOutputArtifacts(stage); }
    },
  });
  result.durationMs = Math.min(AUTHORING_RUNNER.JOB_TIMEOUT_MS, Math.max(0, Math.round(performance.now() - started)));
  return result;
}

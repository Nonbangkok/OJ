import { z } from 'zod';
import { TESTCASE_LIMITS, validateTestcaseFilename } from './testcases';

export const AUTHORING_RUNNER = {
  POLL_MS: 1000,
  JOB_TIMEOUT_MS: 15 * 60_000,
  COMPILE_TIMEOUT_MS: 30_000,
  GENERATOR_TIMEOUT_MS: 60_000,
  MAX_SOURCE_BYTES: 2 * 1024 * 1024,
  MAX_LOG_BYTES: 64 * 1024,
  MAX_DIAGNOSTIC_BYTES: 10 * 1024 * 1024,
  MAX_RESULT_BYTES: 1024 * 1024,
  MAX_SNAPSHOT_BYTES: 16 * 1024 * 1024,
  MAX_BINARY_BYTES: 64 * 1024 * 1024,
  MEMORY_BYTES: 768 * 1024 * 1024,
  MAX_PROCESSES: 128,
  MAX_PENDING_JOBS: 100,
} as const;

export const seedSchema = z.string().regex(/^(0|[1-9][0-9]{0,19})$/)
  .refine(value => /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n,
    'Seed must be an unsigned 64-bit decimal string');
export const inputArtifactSchema = z.object({
  filename: z.string().refine(value => { try { validateTestcaseFilename(value); return true; } catch { return false; } }),
  sizeBytes: z.number().int().min(0).max(TESTCASE_LIMITS.MAX_FILE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type InputArtifact = z.infer<typeof inputArtifactSchema>;

export const jobSnapshotSchema = z.object({
  version: z.literal(1), jobId: z.string().uuid(), draftId: z.string().uuid(),
  revision: z.number().int().positive(),
  kind: z.enum(['compile_solution', 'compile_generator', 'run_generator']),
  seed: seedSchema.optional(),
  source: z.string().refine(value => Buffer.byteLength(value) <= AUTHORING_RUNNER.MAX_SOURCE_BYTES),
  deadline: z.string().datetime(),
}).strict().refine(value => value.kind === 'run_generator' ? value.seed !== undefined : value.seed === undefined);

export const jobResultSchema = z.object({
  version: z.literal(1), jobId: z.string().uuid(), draftId: z.string().uuid(),
  revision: z.number().int().positive(),
  status: z.enum(['succeeded', 'failed', 'timed_out']),
  errorCode: z.enum(['compile_error', 'compile_timeout', 'diagnostic_limit', 'forbidden_include',
    'runner_interrupted', 'runner_error', 'job_expired', 'generator_runtime_error',
    'generator_timeout', 'generator_output_limit', 'invalid_generated_inputs']).nullable(),
  log: z.string().refine(value => Buffer.byteLength(value) <= AUTHORING_RUNNER.MAX_LOG_BYTES),
  durationMs: z.number().int().min(0).max(AUTHORING_RUNNER.JOB_TIMEOUT_MS),
  exitCode: z.number().int().nullable(),
  inputs: z.array(inputArtifactSchema).min(1).max(TESTCASE_LIMITS.MAX_CASES).optional(),
}).strict().refine(value => value.status === 'succeeded'
  ? value.errorCode === null && value.exitCode === 0
  : value.errorCode !== null && value.inputs === undefined)
  .refine(value => !value.inputs || (new Set(value.inputs.map(i => i.filename)).size === value.inputs.length
    && value.inputs.reduce((total, i) => total + i.sizeBytes, 0) <= TESTCASE_LIMITS.MAX_TOTAL_BYTES));

export type JobSnapshot = z.infer<typeof jobSnapshotSchema>;
export type JobResult = z.infer<typeof jobResultSchema>;

/** Creates a bounded terminal failure tied to the immutable request identity. */
export function failedResult(job: JobSnapshot, errorCode: NonNullable<JobResult['errorCode']>): JobResult {
  return { version: 1, jobId: job.jobId, draftId: job.draftId, revision: job.revision,
    status: errorCode === 'job_expired' ? 'timed_out' : 'failed', errorCode, log: '', durationMs: 0, exitCode: null };
}

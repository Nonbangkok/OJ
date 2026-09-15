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
  MAX_SOLUTION_MEMORY_MB: 736,
  PDF_TIMEOUT_MS: 60_000,
  MAX_PDF_BYTES: 64 * 1024 * 1024,
  // Qt reserves virtual address ranges beyond its resident memory usage.
  PDF_ADDRESS_SPACE_BYTES: 2 * 1024 * 1024 * 1024,
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

const caseIdentity = { caseId: z.string().uuid(), caseNumber: z.number().int().positive() };
const caseInputSchema = inputArtifactSchema.extend(caseIdentity);
export type CaseInput = z.infer<typeof caseInputSchema>;
const caseMeasurementSchema = z.object({ ...caseIdentity,
  durationMs: z.number().int().min(0).max(AUTHORING_RUNNER.JOB_TIMEOUT_MS) }).strict();
const outputArtifactSchema = caseInputSchema.extend({ durationMs: caseMeasurementSchema.shape.durationMs });
export type OutputArtifact = z.infer<typeof outputArtifactSchema>;
const uniqueCases = (cases: CaseInput[]) => new Set(cases.map(c => c.caseId)).size === cases.length
  && new Set(cases.map(c => c.caseNumber)).size === cases.length
  && new Set(cases.map(c => c.filename)).size === cases.length
  && cases.reduce((sum, c) => sum + c.sizeBytes, 0) <= TESTCASE_LIMITS.MAX_TOTAL_BYTES;

export const pdfFileSchema = inputArtifactSchema.extend({
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
});
export type PdfFile = z.infer<typeof pdfFileSchema>;
export const pdfArtifactSchema = z.object({
  sizeBytes: z.number().int().min(8).max(AUTHORING_RUNNER.MAX_PDF_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), templateVersion: z.literal('red-gate-v1'),
}).strict();
export type PdfArtifact = z.infer<typeof pdfArtifactSchema>;
const metadataText = z.string().max(1000);
export const pdfSnapshotSchema = z.object({
  document: z.object({ templateVersion: z.literal('red-gate-v1'), title: metadataText, taskCode: metadataText,
    akaName: metadataText, realName: metadataText, language: metadataText, countryCode: metadataText,
    statementHtml: z.string().refine(value => Buffer.byteLength(value) <= 2 * 1024 * 1024) }).strict(),
  avatar: pdfFileSchema.extend({ mimeType: z.literal('image/png') }),
  assets: z.array(pdfFileSchema).max(1000).refine(files => new Set(files.map(f => f.filename)).size === files.length
    && files.reduce((sum, f) => sum + f.sizeBytes, 0) <= 100 * 1024 * 1024),
}).strict();

export const jobSnapshotSchema = z.object({
  version: z.literal(1), jobId: z.string().uuid(), draftId: z.string().uuid(),
  revision: z.number().int().positive(),
  kind: z.enum(['compile_solution', 'compile_generator', 'run_generator', 'generate_outputs', 'build_pdf', 'verify_all']),
  pdf: pdfSnapshotSchema.optional(),
  generatorSource: z.string().refine(value => value.trim().length > 0
    && Buffer.byteLength(value) <= AUTHORING_RUNNER.MAX_SOURCE_BYTES).optional(),
  expectedOutputs: z.array(caseInputSchema).min(1).max(TESTCASE_LIMITS.MAX_CASES).refine(uniqueCases).optional(),
  seed: seedSchema.optional(),
  cases: z.array(caseInputSchema).min(1).max(TESTCASE_LIMITS.MAX_CASES).refine(uniqueCases).optional(),
  limits: z.object({ timeLimitMs: z.number().int().positive().max(AUTHORING_RUNNER.JOB_TIMEOUT_MS),
    memoryLimitMb: z.number().int().positive().max(AUTHORING_RUNNER.MAX_SOLUTION_MEMORY_MB) }).strict().optional(),
  source: z.string().refine(value => Buffer.byteLength(value) <= AUTHORING_RUNNER.MAX_SOURCE_BYTES),
  deadline: z.string().datetime(),
}).strict().refine(value => value.kind === 'run_generator' ? value.seed !== undefined : value.seed === undefined)
  .refine(value => ['generate_outputs', 'verify_all'].includes(value.kind) ? value.cases !== undefined && value.limits !== undefined
    : value.cases === undefined && value.limits === undefined)
  .refine(value => value.kind === 'build_pdf' ? value.pdf !== undefined && value.source === ''
    : value.kind === 'verify_all' ? value.pdf !== undefined : value.pdf === undefined)
  .refine(value => value.kind === 'verify_all' ? value.source.trim().length > 0
    && value.expectedOutputs !== undefined && value.cases !== undefined
    && value.expectedOutputs.length === value.cases.length
    && value.expectedOutputs.every((output, i) => output.caseId === value.cases![i]!.caseId
      && output.caseNumber === value.cases![i]!.caseNumber && output.filename === value.cases![i]!.filename)
    && [...value.cases, ...value.expectedOutputs].reduce((total, item) => total + item.sizeBytes, 0) <= TESTCASE_LIMITS.MAX_TOTAL_BYTES
    : value.generatorSource === undefined && value.expectedOutputs === undefined);

const checkStatus = z.enum(['pending', 'passed', 'failed']);
export const verificationSchema = z.object({
  checks: z.object({ pdf: checkStatus, solution: checkStatus,
    generator: z.enum(['pending', 'passed', 'failed', 'skipped']), execution: checkStatus }).strict(),
  cases: z.array(caseMeasurementSchema).max(TESTCASE_LIMITS.MAX_CASES)
    .refine(cases => new Set(cases.map(c => c.caseId)).size === cases.length
      && new Set(cases.map(c => c.caseNumber)).size === cases.length),
  caseCount: z.number().int().min(1).max(TESTCASE_LIMITS.MAX_CASES),
  totalTestcaseBytes: z.number().int().min(0).max(TESTCASE_LIMITS.MAX_TOTAL_BYTES),
  memoryLimitMb: z.number().int().positive().max(AUTHORING_RUNNER.MAX_SOLUTION_MEMORY_MB),
  peakMemoryBytes: z.null(),
  warnings: z.array(z.string().max(1000)).min(1).max(20),
}).strict().refine(value => value.cases.length <= value.caseCount);
export type Verification = z.infer<typeof verificationSchema>;

export const jobResultSchema = z.object({
  version: z.literal(1), jobId: z.string().uuid(), draftId: z.string().uuid(),
  revision: z.number().int().positive(),
  status: z.enum(['succeeded', 'failed', 'timed_out']),
  errorCode: z.enum(['compile_error', 'compile_timeout', 'diagnostic_limit', 'forbidden_include',
    'runner_interrupted', 'runner_error', 'job_expired', 'generator_runtime_error',
    'generator_timeout', 'generator_output_limit', 'invalid_generated_inputs', 'solution_runtime_error',
    'solution_timeout', 'solution_output_limit', 'invalid_generated_outputs', 'invalid_job_inputs',
    'unsupported_resource_limits', 'pdf_render_error', 'pdf_timeout', 'pdf_output_limit',
    'invalid_pdf', 'invalid_pdf_inputs', 'invalid_statement', 'wrong_answer', 'invalid_expected_outputs',
    'invalid_verification_result']).nullable(),
  log: z.string().refine(value => Buffer.byteLength(value) <= AUTHORING_RUNNER.MAX_LOG_BYTES),
  durationMs: z.number().int().min(0).max(AUTHORING_RUNNER.JOB_TIMEOUT_MS),
  exitCode: z.number().int().nullable(),
  inputs: z.array(inputArtifactSchema).min(1).max(TESTCASE_LIMITS.MAX_CASES).optional(),
  outputs: z.array(outputArtifactSchema).min(1).max(TESTCASE_LIMITS.MAX_CASES).refine(uniqueCases).optional(),
  failedCase: caseMeasurementSchema.optional(),
  pdf: pdfArtifactSchema.optional(),
  verification: verificationSchema.optional(),
}).strict().refine(value => value.status === 'succeeded'
  ? value.errorCode === null && value.exitCode === 0 && value.failedCase === undefined
  : value.errorCode !== null && value.inputs === undefined && value.outputs === undefined && value.pdf === undefined)
  .refine(value => !(value.inputs && value.outputs))
  .refine(value => !value.pdf || (!value.inputs && !value.outputs))
  .refine(value => !value.verification || (!value.inputs && !value.outputs
    && (value.status !== 'succeeded' || (value.pdf !== undefined
      && value.verification.checks.pdf === 'passed' && value.verification.checks.solution === 'passed'
      && ['passed', 'skipped'].includes(value.verification.checks.generator)
      && value.verification.checks.execution === 'passed'
      && value.verification.cases.length === value.verification.caseCount))))
  .refine(value => !value.inputs || (new Set(value.inputs.map(i => i.filename)).size === value.inputs.length
    && value.inputs.reduce((total, i) => total + i.sizeBytes, 0) <= TESTCASE_LIMITS.MAX_TOTAL_BYTES));

export type JobSnapshot = z.infer<typeof jobSnapshotSchema>;
export type JobResult = z.infer<typeof jobResultSchema>;

/** Creates a bounded terminal failure tied to the immutable request identity. */
export function failedResult(job: JobSnapshot, errorCode: NonNullable<JobResult['errorCode']>): JobResult {
  return { version: 1, jobId: job.jobId, draftId: job.draftId, revision: job.revision,
    status: errorCode === 'job_expired' ? 'timed_out' : 'failed', errorCode, log: '', durationMs: 0, exitCode: null };
}

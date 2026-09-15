import { z } from 'zod';
import { AUTHORING_VALIDATION as A, PROBLEM_VALIDATION as P } from '../constants';
import { ProblemDraftRow } from '../types/authoring';
import { JobResult, JobSnapshot, jobSnapshotSchema } from '../authoring/protocol';
import { TestcaseError } from '../authoring/testcases';

// Revalidate stored metadata, including imported/legacy drafts, against the editor contract.
const text = (max: number) => z.string().trim().min(1).max(max);
const metadata = z.object({
  problem_id: text(A.MAX_PROBLEM_ID_LENGTH), title: text(A.MAX_TITLE_LENGTH),
  author_aka_name: text(A.MAX_AKA_NAME_LENGTH), author_real_name: text(A.MAX_REAL_NAME_LENGTH),
  language: text(A.MAX_LANGUAGE_LENGTH), country_code: z.string().regex(/^[A-Z]{3}$/),
  time_limit_ms: z.number().int().min(P.MIN_TIME_LIMIT_MS).max(A.MAX_INT),
  memory_limit_mb: z.number().int().min(P.MIN_MEMORY_LIMIT_MB).max(A.MAX_INT),
});
export const validVerificationMetadata = (draft: ProblemDraftRow) => metadata.safeParse(draft).success;

/** Never let an incomplete/misattributed report make a revision publishable. */
export function validateVerificationReport(snapshot: JobSnapshot | null, result: JobResult): void {
  const parsed = jobSnapshotSchema.safeParse(snapshot);
  const invalid = () => { throw new TestcaseError('invalid_verification_result', 'Verification does not match the immutable draft snapshot'); };
  if (!parsed.success || parsed.data.kind !== 'verify_all') return invalid();
  const job = parsed.data;
  const report = result.verification;
  // Infrastructure failures may happen before any stage can report progress.
  if (!report) { if (result.status === 'succeeded') invalid(); return; }
  const cases = job.cases!;
  const total = [...cases, ...job.expectedOutputs!].reduce((sum, c) => sum + c.sizeBytes, 0);
  if (report.caseCount !== cases.length || report.totalTestcaseBytes !== total || report.memoryLimitMb !== job.limits!.memoryLimitMb
    || report.cases.length > cases.length || report.cases.some((c, i) => c.caseId !== cases[i].caseId || c.caseNumber !== cases[i].caseNumber)
    || (job.generatorSource ? report.checks.generator === 'skipped' : report.checks.generator !== 'skipped')) invalid();
  if (result.failedCase && !cases.some(c => c.caseId === result.failedCase!.caseId && c.caseNumber === result.failedCase!.caseNumber)) invalid();
  if (result.status === 'succeeded' && (report.cases.length !== cases.length || report.checks.pdf !== 'passed'
    || report.checks.solution !== 'passed' || report.checks.execution !== 'passed'
    || (job.generatorSource && report.checks.generator !== 'passed'))) invalid();
}

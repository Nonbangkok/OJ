import { Draft, Job } from './types';

// Human-readable names + tones for draft statuses and job types, shared by the
// drafts table, workspace summary, and job history.

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const DRAFT_STATUS: Record<Draft['status'], { label: string; tone: StatusTone; hint: string }> = {
  draft: { label: 'Draft', tone: 'neutral', hint: 'Write the statement and solution, then add testcases.' },
  generated: { label: 'Generated', tone: 'info', hint: 'Testcase outputs exist. Run Verify All to check everything.' },
  ready: { label: 'Ready', tone: 'success', hint: 'Verified at the current revision. Publishing is unlocked.' },
  published: { label: 'Published', tone: 'success', hint: 'Published as a hidden problem. Manage visibility in Problem Management.' },
};

export const draftStatus = (status: Draft['status']) =>
  DRAFT_STATUS[status] ?? { label: status, tone: 'neutral' as const, hint: '' };

const JOB_TYPES: Record<string, string> = {
  compile_solution: 'Compile solution',
  compile_generator: 'Compile generator',
  generate_inputs: 'Generate inputs',
  generate_outputs: 'Generate outputs',
  build_pdf: 'Build PDF',
  verify_all: 'Verify All',
  sync_pdf: 'Profile sync PDF',
};

export const jobLabel = (jobType: string) => JOB_TYPES[jobType] ?? jobType;

const JOB_STATUSES: Record<string, { label: string; tone: StatusTone }> = {
  queued: { label: 'Queued', tone: 'info' },
  compiling: { label: 'Compiling', tone: 'info' },
  running: { label: 'Running', tone: 'info' },
  succeeded: { label: 'Succeeded', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

export const jobStatus = (status: string) => JOB_STATUSES[status] ?? { label: status, tone: 'neutral' as const };

/**
 * Plain-language explanations for a failed verification, shown on the
 * Verify & Publish tab. Ordered by how far the pipeline got: compile →
 * run solution per case → compare outputs → PDF. The failedCase number
 * (when present) pinpoints the exact testcase that broke.
 */
export const verifyFailureExplanation = (job: Job): { title: string; detail: string } => {
  const caseLabel = job.resultSummary?.failedCase
    ? ` (testcase #${job.resultSummary.failedCase.caseNumber})`
    : '';
  const code = job.errorCode ?? '';
  const MESSAGES: Record<string, { title: string; detail: string }> = {
    compile_error: {
      title: 'Solution failed to compile',
      detail: 'The reference solution has a compile error. Fix the code in the Solution tab, then run Verify All again.',
    },
    compile_timeout: {
      title: 'Compilation timed out',
      detail: 'Compiling the solution took too long (possible compile bomb / heavy template use). Simplify the code.',
    },
    forbidden_include: {
      title: 'Solution uses a forbidden #include',
      detail: 'The solution includes a file outside the permitted headers. Use standard library headers only.',
    },
    solution_runtime_error: {
      title: `Solution crashed${caseLabel}`,
      detail: 'The reference solution exited abnormally — common causes are a segfault, an assertion failing, or signed-integer overflow. Check array bounds and overflow for that input range.',
    },
    solution_timeout: {
      title: `Solution exceeded the time limit${caseLabel}`,
      detail: 'The reference solution ran longer than the problem time limit on at least one testcase. The intended solution must fit within the limit on every case — check for an unintended worst case.',
    },
    solution_output_limit: {
      title: `Solution printed too much output${caseLabel}`,
      detail: 'The reference solution produced more output than the runner allows. Check for an infinite print loop or printing inside a loop by mistake.',
    },
    wrong_answer: {
      title: `Solution output does not match the expected output${caseLabel}`,
      detail: 'The reference solution produced different output than the stored expected output. Either the solution has a bug, or that expected output is wrong — regenerate outputs if the solution is correct.',
    },
    invalid_expected_outputs: {
      title: 'Stored expected outputs are invalid',
      detail: 'At least one stored expected output could not be read. Open the Testcases tab and re-generate or re-upload the outputs.',
    },
    pdf_render_error: {
      title: 'PDF could not be rendered',
      detail: 'Rendering the statement PDF failed. Check the statement HTML for unsupported constructs.',
    },
    pdf_timeout: {
      title: 'PDF rendering timed out',
      detail: 'Rendering the statement PDF took too long. Simplify the statement content.',
    },
    pdf_output_limit: {
      title: 'PDF is too large',
      detail: 'The rendered PDF exceeded the size limit. Reduce embedded assets.',
    },
    invalid_statement: {
      title: 'Statement is invalid',
      detail: 'The statement HTML failed validation. Re-open the Statement tab and fix the reported issue.',
    },
    generator_runtime_error: {
      title: 'Generator crashed',
      detail: 'The testcase generator exited abnormally while producing inputs. Fix the generator code.',
    },
    generator_timeout: {
      title: 'Generator timed out',
      detail: 'The testcase generator exceeded its runtime limit.',
    },
  };
  return MESSAGES[code] ?? {
    title: job.errorMessage ? job.errorMessage : `Verification failed (${code || job.status})`,
    detail: 'The verification job did not complete successfully. Open History & Logs for the full diagnostic log.',
  };
};

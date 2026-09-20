import { verifyFailureExplanation } from './status';
import type { Job } from './types';

const failedJob = (overrides: Partial<Job> = {}): Job => ({
  id: 'j1',
  draftId: 'd1',
  draftRevision: 3,
  jobType: 'verify_all',
  status: 'failed',
  createdAt: '2026-09-20T00:00:00Z',
  errorCode: null,
  errorMessage: null,
  ...overrides,
} as Job);

describe('verifyFailureExplanation', () => {
  it('explains a wrong answer with the failing case number', () => {
    const job = failedJob({
      errorCode: 'wrong_answer',
      resultSummary: { failedCase: { caseNumber: 4, durationMs: 12 } },
    });

    const { title, detail } = verifyFailureExplanation(job);
    expect(title).toContain('#4');
    expect(detail).toMatch(/different output than the stored expected output/i);
  });

  it('explains a compile error without a case number', () => {
    const { title, detail } = verifyFailureExplanation(failedJob({ errorCode: 'compile_error' }));
    expect(title).toBe('Solution failed to compile');
    expect(detail).toMatch(/fix the code in the solution tab/i);
  });

  it('names the testcase for a solution timeout', () => {
    const job = failedJob({
      errorCode: 'solution_timeout',
      resultSummary: { failedCase: { caseNumber: 9, durationMs: 3000 } },
    });

    expect(verifyFailureExplanation(job).title).toContain('#9');
  });

  it('falls back to the error message for unknown codes', () => {
    const { title } = verifyFailureExplanation(
      failedJob({ errorCode: 'something_new', errorMessage: 'Custom message' })
    );

    expect(title).toBe('Custom message');
  });

  it('points to the history log when there is nothing else to show', () => {
    const { detail } = verifyFailureExplanation(failedJob({ errorCode: null, errorMessage: null }));

    expect(detail).toMatch(/history & logs/i);
  });

  it('covers the PDF failure family', () => {
    const { title } = verifyFailureExplanation(failedJob({ errorCode: 'pdf_render_error' }));
    expect(title).toBe('PDF could not be rendered');
  });
});

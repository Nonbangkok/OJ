import { jobSnapshotSchema, jobResultSchema } from '../authoring/protocol';

const id = '11111111-1111-4111-8111-111111111111';
const input = { caseId: id, caseNumber: 1, filename: '1.in', sizeBytes: 2, sha256: 'a'.repeat(64) };
const snapshot = { version: 1, jobId: id, draftId: id, revision: 1, kind: 'generate_outputs',
  source: 'int main(){}', deadline: '2026-09-14T00:00:00.000Z', cases: [input],
  limits: { timeLimitMs: 1000, memoryLimitMb: 256 } };
const result = { version: 1, jobId: id, draftId: id, revision: 1, status: 'succeeded',
  errorCode: null, log: '', durationMs: 1, exitCode: 0, outputs: [{ ...input, durationMs: 1 }] };

it('requires bounded immutable cases and execution limits for output jobs only', () => {
  expect(jobSnapshotSchema.safeParse(snapshot).success).toBe(true);
  for (const value of [{ ...snapshot, cases: [] }, { ...snapshot, limits: undefined },
    { ...snapshot, cases: [input, input] }, { ...snapshot, seed: '1' },
    { ...snapshot, kind: 'compile_solution' }, { ...snapshot, limits: { timeLimitMs: 0, memoryLimitMb: 256 } }]) {
    expect(jobSnapshotSchema.safeParse(value).success).toBe(false);
  }
});

it('accepts complete output manifests but rejects duplicate cases and artifacts on failure', () => {
  expect(jobResultSchema.safeParse(result).success).toBe(true);
  expect(jobResultSchema.safeParse({ ...result, outputs: [result.outputs[0], result.outputs[0]] }).success).toBe(false);
  expect(jobResultSchema.safeParse({ ...result, status: 'failed', errorCode: 'solution_runtime_error' }).success).toBe(false);
  expect(jobResultSchema.safeParse({ ...result, outputs: undefined, status: 'failed', exitCode: 1,
    errorCode: 'solution_runtime_error', failedCase: { caseId: id, caseNumber: 1, durationMs: 1 } }).success).toBe(true);
});

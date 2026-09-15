import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AuthoringSpool } from '../authoring/spool';
import { jobSnapshotSchema, jobResultSchema } from '../authoring/protocol';

const id = '11111111-1111-4111-8111-111111111111';
const meta = (text: string, filename = '1.in') => ({ filename, sizeBytes: Buffer.byteLength(text),
  sha256: createHash('sha256').update(text).digest('hex') });
const input = { ...meta('1\n'), caseId: id, caseNumber: 1 };
const expected = { ...input, ...meta('2\n') };
const pdf = { document: { templateVersion: 'red-gate-v1', title: 'One', taskCode: 'one', akaName: 'A',
  realName: 'Author', language: 'Thai', countryCode: 'THA', statementHtml: '<p>One</p>' }, assets: [],
  avatar: { ...meta('png', 'avatar.png'), mimeType: 'image/png' } };
const snapshot = { version: 1, jobId: id, draftId: id, revision: 1, kind: 'verify_all', source: 'int main(){}',
  deadline: '2099-01-01T00:00:00.000Z', cases: [input], expectedOutputs: [expected], pdf,
  limits: { timeLimitMs: 1000, memoryLimitMb: 256 } };
const verification = { checks: { pdf: 'passed', solution: 'passed', generator: 'skipped', execution: 'passed' },
  cases: [{ caseId: id, caseNumber: 1, durationMs: 2 }], caseCount: 1, totalTestcaseBytes: 4,
  memoryLimitMb: 256, peakMemoryBytes: null, warnings: ['Peak memory measurement is unavailable.'] };
const result = { version: 1, jobId: id, draftId: id, revision: 1, status: 'succeeded', errorCode: null,
  log: '', durationMs: 3, exitCode: 0, verification,
  pdf: { sizeBytes: 100, sha256: 'a'.repeat(64), templateVersion: 'red-gate-v1' } };

it('accepts an immutable verify snapshot with optional generator and matching pairs', () => {
  expect(jobSnapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(jobSnapshotSchema.safeParse({ ...snapshot, generatorSource: 'int main(){}' }).success).toBe(true);
});

it('rejects missing, mismatched, oversized, or mixed verification payloads', () => {
  for (const patch of [{ pdf: undefined }, { cases: undefined }, { limits: undefined }, { expectedOutputs: undefined },
    { expectedOutputs: [] }, { expectedOutputs: [{ ...expected, filename: 'other.in' }] },
    { expectedOutputs: [{ ...expected, caseNumber: 2 }] }, { generatorSource: '  ' }, { source: '' },
    { generatorSource: 'a'.repeat(2 * 1024 * 1024 + 1) }, { seed: '1' }]) {
    expect(jobSnapshotSchema.safeParse({ ...snapshot, ...patch }).success).toBe(false);
  }
  for (const kind of ['compile_solution', 'compile_generator', 'run_generator', 'generate_outputs', 'build_pdf']) {
    expect(jobSnapshotSchema.safeParse({ ...snapshot, kind }).success).toBe(false);
  }
});

it('requires consistent bounded verification reports and PDF only on success', () => {
  expect(jobResultSchema.safeParse(result).success).toBe(true);
  for (const patch of [{ pdf: undefined }, { outputs: [{ ...input, durationMs: 1 }] },
    { verification: { ...verification, checks: { ...verification.checks, solution: 'pending' } } },
    { verification: { ...verification, checks: { ...verification.checks, pdf: 'skipped' } } },
    { verification: { ...verification, cases: [] } }, { verification: { ...verification, peakMemoryBytes: 1 } },
    { verification: { ...verification, cases: [verification.cases[0], verification.cases[0]] } }]) {
    expect(jobResultSchema.safeParse({ ...result, ...patch }).success).toBe(false);
  }
  expect(jobResultSchema.safeParse({ ...result, status: 'failed', errorCode: 'wrong_answer', pdf: undefined,
    verification: { ...verification, checks: { ...verification.checks, execution: 'failed' } },
    failedCase: verification.cases[0] }).success).toBe(true);
});

it('freezes expected bytes privately and rejects tampering and symlinks on read', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'verify-spool-'));
  try {
    const spool = new AuthoringSpool(root); await spool.initialize();
    const job = jobSnapshotSchema.parse(snapshot);
    await spool.deliver(job, async () => '1\n', async name => Buffer.from(name === 'avatar' ? 'png' : '2\n'));
    expect(await spool.claim()).toEqual(job);
    // Cast only until the new spool boundary exists, so RED is a behavior assertion.
    const reader = (spool as AuthoringSpool & { readJobExpectedOutput?: Function }).readJobExpectedOutput;
    expect(typeof reader).toBe('function');
    expect(await reader!.call(spool, id, 0, expected)).toBe('2\n');
    const file = path.join(root, 'active', id, 'expected', '0.txt');
    await writeFile(file, '3\n');
    await expect(reader!.call(spool, id, 0, expected)).rejects.toMatchObject({ code: 'invalid_expected_outputs' });
    await rm(file); await symlink(path.join(root, 'active', id, 'inputs', '0.txt'), file);
    await expect(reader!.call(spool, id, 0, expected)).rejects.toMatchObject({ code: 'invalid_expected_outputs' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

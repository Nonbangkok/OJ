import { jobSnapshotSchema, jobResultSchema } from '../authoring/protocol';
import { AuthoringSpool } from '../authoring/spool';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const id = '11111111-1111-4111-8111-111111111111';
const artifact = { filename: 'avatar.png', sizeBytes: 8, sha256: 'a'.repeat(64), mimeType: 'image/png' };
const pdf = { document: { templateVersion: 'red-gate-v1', title: 'One', taskCode: 'one', akaName: 'A',
  realName: 'Author', language: 'Thai', countryCode: 'THA', statementHtml: '<h1>One</h1>' }, assets: [], avatar: artifact };
const snapshot = { version: 1, jobId: id, draftId: id, revision: 1, kind: 'build_pdf', source: '',
  deadline: '2026-09-14T00:00:00.000Z', pdf };
it('requires a versioned PDF snapshot and forbids mixing source/testcase payloads', () => {
  expect(jobSnapshotSchema.safeParse(snapshot).success).toBe(true);
  for (const value of [{ ...snapshot, pdf: undefined }, { ...snapshot, source: 'private C++' },
    { ...snapshot, kind: 'compile_solution' }, { ...snapshot, pdf: { ...pdf, document: { ...pdf.document, templateVersion: 'unknown' } } },
    { ...snapshot, pdf: { ...pdf, assets: [artifact, artifact] } }]) expect(jobSnapshotSchema.safeParse(value).success).toBe(false);
});
it('accepts bounded PDF manifests only on successful results', () => {
  const result = { version: 1, jobId: id, draftId: id, revision: 1, status: 'succeeded', errorCode: null,
    log: '', durationMs: 1, exitCode: 0, pdf: { sizeBytes: 1000, sha256: 'a'.repeat(64), templateVersion: 'red-gate-v1' } };
  expect(jobResultSchema.safeParse(result).success).toBe(true);
  expect(jobResultSchema.safeParse({ ...result, status: 'failed', errorCode: 'pdf_render_error' }).success).toBe(false);
  expect(jobResultSchema.safeParse({ ...result, pdf: { ...result.pdf, sizeBytes: 100 * 1024 * 1024 } }).success).toBe(false);
});

// A sync_pdf job is a build_pdf with the statement source unchanged; it must
// be accepted by the same protocol paths (regression: the runner dispatched
// sync_pdf to the C++ compiler and the spool skipped PDF file staging).
it('routes sync_pdf through the PDF build paths', async () => {
  const syncSnapshot = { ...snapshot, kind: 'sync_pdf' };
  expect(jobSnapshotSchema.safeParse(syncSnapshot).success).toBe(true);

  const avatar = Buffer.alloc(8, 0x61);
  const avatarArtifact = { filename: 'avatar.png', sizeBytes: avatar.length,
    sha256: createHash('sha256').update(avatar).digest('hex'), mimeType: 'image/png' as const };
  const pdf = { ...snapshot.pdf, avatar: avatarArtifact };
  const spool = new AuthoringSpool('/tmp/spool-sync-pdf-test');
  await spool.initialize();
  try {
    await spool.deliver({ ...syncSnapshot, pdf, deadline: '2099-01-01T00:00:00.000Z' } as never,
      undefined, async () => avatar);
    const ready = await readdir('/tmp/spool-sync-pdf-test/ready');
    expect(ready.length).toBeGreaterThan(0);
    const staged = await readdir(`/tmp/spool-sync-pdf-test/ready/${ready[0]}/pdf`, { recursive: true });
    expect(staged).toContain('avatar.png');
  } finally {
    await rm('/tmp/spool-sync-pdf-test', { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { chmod, mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { AuthoringSpool } = require('/runner/authoring/spool.js');
let buildPdf;
try { ({ buildPdf } = require('/runner/authoring/pdf.js')); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }

test('renders the generic Red Gate snapshot through the bounded renderer', async () => {
  assert.equal(typeof buildPdf, 'function');
  const root = await mkdtemp('/work/pdf-test-');
  await chmod(root, 0o755);
  try {
    const spool = new AuthoringSpool(path.join(root, 'spool')); await spool.initialize();
    const avatar = await readFile('/fixtures/red-gate-logo-alpha.png');
    const image = await readFile('/fixtures/red-gate-diagram.jpg');
    const meta = (content, filename, mimeType) => ({ filename, mimeType, sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
    const document = JSON.parse(await readFile('/fixtures/red-gate-metadata.json', 'utf8'));
    document.statementHtml = await readFile('/fixtures/red-gate-statement.html', 'utf8');
    const job = { version: 1, jobId: randomUUID(), draftId: randomUUID(), revision: 1, kind: 'build_pdf', source: '',
      deadline: new Date(Date.now() + 60_000).toISOString(), pdf: { document, avatar: meta(avatar, 'avatar.png', 'image/png'),
        assets: [meta(image, 'red-gate-diagram.jpg', 'image/jpeg')] } };
    await spool.deliver(job, undefined, async name => name === 'avatar' ? avatar : image); await spool.claim();
    const result = await buildPdf(job, root, spool);
    assert.equal(result.status, 'succeeded', JSON.stringify(result));
    const pdf = await spool.readPdf(job.jobId, result.pdf); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    if (process.env.PDF_QA_OUTPUT) { await mkdir(process.env.PDF_QA_OUTPUT, { recursive: true });
      await writeFile(path.join(process.env.PDF_QA_OUTPUT, 'slice7-red-gate.pdf'), pdf); }
    await spool.cleanup(job.jobId);
    // A sanitized but invalid formula must not create a successful artifact.
    job.jobId = randomUUID(); job.pdf.document.statementHtml = '<p>$\\NotARealKatexCommand$</p>';
    await spool.deliver(job, undefined, async name => name === 'avatar' ? avatar : image); await spool.claim();
    const invalid = await buildPdf(job, root, spool, { timeoutMs: 7000 });
    assert.equal(invalid.status, 'failed', JSON.stringify(invalid)); assert.equal(invalid.errorCode, 'pdf_render_error');
    assert.equal(invalid.pdf, undefined);
    await spool.cleanup(job.jobId);
    // User JavaScript must fail validation without reaching Qt.
    job.jobId = randomUUID(); job.pdf.document.statementHtml = '<script>document.write("unsafe")</script>';
    await spool.deliver(job, undefined, async name => name === 'avatar' ? avatar : image); await spool.claim();
    const unsafe = await buildPdf(job, root, spool);
    assert.equal(unsafe.errorCode, 'invalid_statement'); assert.equal(unsafe.pdf, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

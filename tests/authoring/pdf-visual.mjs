// Requires Poppler's pdftoppm on PATH (or PDFTOPPM); generated artifacts are ignored.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const reference = path.join(root, 'backend/tests/fixtures/pdf/red-gate-demo.pdf');
const candidate = path.resolve(process.argv[2] || path.join(root, 'output/pdf/slice7-red-gate.pdf'));
const workspace = await mkdtemp(path.join(tmpdir(), 'oj-pdf-visual-'));
try {
  for (const [name, source] of [['reference', reference], ['candidate', candidate]]) {
    await run(process.env.PDFTOPPM || 'pdftoppm', ['-scale-to-x', '909', '-scale-to-y', '1286', source, path.join(workspace, name)]);
  }
  const files = await readdir(workspace);
  const pages = prefix => files.filter(name => name.startsWith(prefix + '-') && name.endsWith('.ppm')).sort();
  const expected = pages('reference'), actual = pages('candidate');
  assert.equal(expected.length, 3, 'Approved reference has three pages');
  assert.equal(actual.length, expected.length, 'Page count must match');
  for (let i = 0; i < expected.length; i++) {
    assert.ok((await readFile(path.join(workspace, expected[i]))).equals(await readFile(path.join(workspace, actual[i]))),
      `Page ${i + 1} differs from the approved layout; inspect rendered images before changing the baseline`);
  }
  console.log('PASS: all 3 pages are pixel-identical at 909 × 1286');
} finally {
  await rm(workspace, { recursive: true, force: true });
}

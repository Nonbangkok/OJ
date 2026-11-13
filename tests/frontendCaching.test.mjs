import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Serves a fake build with the real frontend/nginx.conf and checks the
// caching headers browsers see. Without Cache-Control on index.html,
// browsers cache it heuristically (10% of its age), so after a deploy they
// can keep loading the previous build's index.html -- whose hashed bundles no
// longer exist -- for hours.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = readFileSync(path.join(repositoryRoot, 'frontend/Dockerfile'), 'utf8').match(/^FROM (nginx:\S+)/m)[1];
let container;
let root;

const headers = (urlPath) => {
  // busybox wget prints the response headers on stderr with -S.
  const out = execFileSync('docker', ['exec', container, 'sh', '-c',
    `wget -S -O /dev/null http://127.0.0.1${urlPath} 2>&1 || true`], { encoding: 'utf8' });
  const lines = out.split('\n').map(line => line.trim());
  const status = Number(lines.find(line => /^HTTP\/1\.\d \d+/.test(line))?.split(' ')[1]);
  const cacheControl = lines.filter(line => /^cache-control:/i.test(line)).map(line => line.replace(/^cache-control:\s*/i, ''));
  const csp = lines.some(line => /^content-security-policy:/i.test(line));
  return { status, cacheControl, csp };
};

before(() => {
  root = mkdtempSync(path.join(tmpdir(), 'oj-nginx-cache-'));
  mkdirSync(path.join(root, 'html/assets'), { recursive: true });
  writeFileSync(path.join(root, 'html/index.html'), '<!doctype html><script type="module" src="/assets/index-abc123.js"></script>');
  writeFileSync(path.join(root, 'html/assets/index-abc123.js'), 'console.log(1)');
  writeFileSync(path.join(root, 'html/logo512.png'), 'png');
  container = execFileSync('docker', ['run', '-d', '--rm', '--add-host', 'backend:127.0.0.1',
    '-v', `${path.join(repositoryRoot, 'frontend/nginx.conf')}:/etc/nginx/conf.d/default.conf:ro`,
    '-v', `${path.join(root, 'html')}:/usr/share/nginx/html:ro`, image], { encoding: 'utf8' }).trim();
  for (let i = 0; i < 50; i += 1) {
    try { if (headers('/').status === 200) return; } catch { /* starting */ }
    execFileSync('sleep', ['0.1']);
  }
  throw new Error('nginx did not start');
});

after(() => {
  if (container) execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
  if (root) rmSync(root, { recursive: true, force: true });
});

test('index.html is revalidated on every load (/, SPA routes, /index.html)', () => {
  for (const urlPath of ['/', '/submissions', '/admin/problems', '/index.html']) {
    const { status, cacheControl } = headers(urlPath);
    assert.equal(status, 200, urlPath);
    assert.deepEqual(cacheControl, ['no-cache'], urlPath);
  }
});

test('hashed build assets are cached long-term', () => {
  const { status, cacheControl } = headers('/assets/index-abc123.js');
  assert.equal(status, 200);
  assert.deepEqual(cacheControl, ['public, max-age=31536000, immutable']);
});

test('other static files get no forced caching policy', () => {
  assert.deepEqual(headers('/logo512.png').cacheControl, []);
});

test('the security headers are still sent alongside the caching header', () => {
  assert.equal(headers('/').csp, true);
  assert.equal(headers('/assets/index-abc123.js').csp, true);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { after, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/refresh-proxy.sh applies the proxy configuration of a new checkout.
// The production overlay bind-mounts nginx-proxy/production.conf as a single
// FILE, and `git checkout` replaces a changed file with a new inode: a running
// container stays attached to the old inode, so on Linux `nginx -s reload`
// silently re-reads the stale configuration. These tests swap the file the
// way git does (write a new file, rename it over the old one) and check that
// the new configuration is what the proxy actually serves.
//
// On Docker Desktop the bind mount re-resolves the path, so a plain reload can
// look correct there; the swap test is the one that fails without the fix on
// Linux, which is where CI and production run.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repositoryRoot, 'scripts/refresh-proxy.sh');
const project = `ojrp${randomBytes(4).toString('hex')}`;
const workDir = mkdtempSync(path.join(tmpdir(), `${project}-`));
const confPath = path.join(workDir, 'proxy.conf');

assert.notEqual(project, 'oj');

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', cwd: workDir, ...opts });
const must = (cmd, args) => {
  const r = run(cmd, args);
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stdout}${r.stderr}`);
  return r.stdout.trim();
};
const composeArgs = ['-p', project, '-f', 'docker-compose.yml'];
const compose = (...args) => must('docker', ['compose', ...composeArgs, ...args]);
const proxyId = () => compose('ps', '-q', 'nginx-proxy');

// Each configuration answers with its own name, so what the proxy serves says
// which configuration it has LOADED (`nginx -T` would re-read the files).
const conf = (name) => `server {\n    listen 8080;\n    location / {\n        return 200 "${name}\\n";\n    }\n}\n`;
// What `git checkout` does to a changed file: a brand-new inode at the same path.
const swapConf = (text) => {
  const tmp = `${confPath}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, confPath);
};
const serves = () => {
  let last = '';
  for (let i = 0; i < 30; i += 1) {
    const r = run('docker', ['exec', proxyId(), 'wget', '-qO-', 'http://127.0.0.1:8080/']);
    last = r.status === 0 ? r.stdout.trim() : `wget failed: ${r.stderr.trim()}`;
    if (r.status === 0) return last;
    spawnSync('sleep', ['0.3']);
  }
  return last;
};
const servesEventually = (expected) => {
  let last = '';
  for (let i = 0; i < 30; i += 1) {
    last = serves();
    if (last === expected) return last;
    spawnSync('sleep', ['0.3']);
  }
  return last;
};
const refresh = () => run('sh', [script, ...composeArgs]);

writeFileSync(
  path.join(workDir, 'docker-compose.yml'),
  'services:\n  nginx-proxy:\n    image: nginx:1.30-alpine\n    volumes:\n' +
    '      - ./proxy.conf:/etc/nginx/conf.d/default.conf:ro\n',
);

beforeEach(() => {
  run('docker', ['compose', ...composeArgs, 'down', '--remove-orphans']);
  writeFileSync(confPath, conf('A'));
  compose('up', '-d');
  assert.equal(servesEventually('A'), 'A', 'the proxy starts on configuration A');
});

after(() => {
  run('docker', ['compose', ...composeArgs, 'down', '-v', '--remove-orphans']);
  rmSync(workDir, { recursive: true, force: true });
});

test('the helper is executable, like every script the deploy path invokes', () => {
  assert.equal(statSync(script).mode & 0o111, 0o111);
});

test('a configuration replaced with a new inode is loaded, by recreating the proxy', () => {
  const before = proxyId();
  swapConf(conf('B'));
  const r = refresh();
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /recreating/);
  assert.notEqual(proxyId(), before, 'the proxy container was recreated');
  assert.equal(servesEventually('B'), 'B', 'the proxy serves the new configuration');
});

test('an unchanged configuration is reloaded in place, without dropping the container', () => {
  const before = proxyId();
  const r = refresh();
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /unchanged, reloaded/);
  assert.equal(proxyId(), before, 'no needless recreate (a reload keeps connections)');
  assert.equal(serves(), 'A');
});

test('a configuration nginx rejects fails the refresh instead of reporting success', () => {
  swapConf('this is not nginx configuration;\n');
  const r = refresh();
  assert.notEqual(r.status, 0, `${r.stdout}${r.stderr}`);
});

test('a missing proxy container is an error, not a silent no-op', () => {
  compose('down', '--remove-orphans');
  const r = refresh();
  assert.notEqual(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /not running/);
});

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Runs nginx-proxy with each real config and executes the healthcheck command
// exactly as docker-compose.yml defines it. production.conf redirects plain
// HTTP to HTTPS, so a healthcheck that hits "/" gets a 301, follows it to an
// HTTPS URL whose certificate does not match 127.0.0.1, and fails forever --
// and cloudflared (which waits for a healthy proxy) never starts.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compose = readFileSync(path.join(repositoryRoot, 'docker-compose.yml'), 'utf8');
const proxyBlock = compose.match(/^ {2}nginx-proxy:\n((?: {4}.*\n|\n)+)/m)[1];
const image = proxyBlock.match(/^\s*image:\s*(nginx:\S+)/m)[1];
const healthcheck = JSON.parse(proxyBlock.match(/^\s*test:\s*(\[.*\])\s*$/m)[1]);
assert.equal(healthcheck[0], 'CMD');
const healthcheckCommand = healthcheck.slice(1);

let work;
const containers = {};

const startProxy = (name, confFile) => {
  const id = execFileSync('docker', ['run', '-d', '--rm',
    '--add-host', 'frontend:127.0.0.1', '--add-host', 'backend:127.0.0.1',
    '-v', `${path.join(repositoryRoot, 'nginx-proxy', confFile)}:/etc/nginx/conf.d/default.conf:ro`,
    '-v', `${path.join(work, 'letsencrypt')}:/etc/letsencrypt:ro`,
    '-v', `${path.join(work, 'certbot')}:/var/www/certbot:ro`,
    image], { encoding: 'utf8' }).trim();
  containers[name] = id;
  for (let i = 0; i < 50; i += 1) {
    const r = spawnSync('docker', ['exec', id, 'sh', '-c', 'test -f /run/nginx.pid || test -f /var/run/nginx.pid'], { encoding: 'utf8' });
    if (r.status === 0) return;
    execFileSync('sleep', ['0.1']);
  }
  const logs = spawnSync('docker', ['logs', id], { encoding: 'utf8' });
  throw new Error(`${confFile}: nginx did not start\n${logs.stdout}${logs.stderr}`);
};

const runHealthcheck = (name) => spawnSync('docker', ['exec', containers[name], ...healthcheckCommand], { encoding: 'utf8' });

const firstResponse = (name, urlPath) => {
  // busybox wget prints each response's status line (-S); the first one is
  // what nginx answered before any redirect is followed.
  const r = spawnSync('docker', ['exec', containers[name], 'sh', '-c',
    `wget -S -O /dev/null http://127.0.0.1${urlPath} 2>&1 || true`], { encoding: 'utf8' });
  return Number(r.stdout.match(/HTTP\/1\.\d (\d+)/)?.[1]);
};

before(() => {
  work = mkdtempSync(path.join(tmpdir(), 'oj-proxy-health-'));
  const live = path.join(work, 'letsencrypt/live/nonbangkokgrader.com');
  mkdirSync(live, { recursive: true });
  mkdirSync(path.join(work, 'certbot'), { recursive: true });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=nonbangkokgrader.com',
    '-keyout', path.join(live, 'privkey.pem'), '-out', path.join(live, 'fullchain.pem')], { stdio: 'ignore' });
  startProxy('local', 'local.conf');
  startProxy('production', 'production.conf');
});

after(() => {
  for (const id of Object.values(containers)) spawnSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
  if (work) rmSync(work, { recursive: true, force: true });
});

test('the compose healthcheck passes with production.conf (HTTP->HTTPS redirect in place)', () => {
  const r = runHealthcheck('production');
  assert.equal(r.status, 0, `healthcheck failed: ${r.stdout}${r.stderr}`);
});

test('the compose healthcheck passes with local.conf', () => {
  const r = runHealthcheck('local');
  assert.equal(r.status, 0, `healthcheck failed: ${r.stdout}${r.stderr}`);
});

test('production still redirects direct plain-HTTP visitors to HTTPS', () => {
  assert.equal(firstResponse('production', '/'), 301);
  assert.equal(firstResponse('production', '/api/health/ready'), 301);
});

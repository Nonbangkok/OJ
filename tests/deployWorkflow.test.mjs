import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// There is no YAML parser in this repo, so these assertions pin the guarantees
// the deploy workflow must keep by matching its text.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Comment lines are stripped so a guarantee that is merely commented out fails.
const wf = readFileSync(path.join(repositoryRoot, '.github/workflows/deploy.yml'), 'utf8')
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

test('fires only after the CI workflow, on main', () => {
  assert.match(wf, /workflows:\s*\[CI\]/);
  assert.match(wf, /branches:\s*\[main\]/);
});

test('only a green push to main in this repository deploys (one && expression)', () => {
  const block = wf.match(/^ {4}if:\s*>-\n((?: {6,}\S.*\n)+)/m);
  assert.ok(block, 'job-level if: >- block not found');
  const expression = block[1].trim().split(/\s+/).join(' ');
  assert.equal(
    expression,
    [
      "github.event.workflow_run.conclusion == 'success'",
      "github.event.workflow_run.head_branch == 'main'",
      "github.event.workflow_run.event == 'push'",
      'github.event.workflow_run.head_repository.full_name == github.repository',
    ].join(' && '),
  );
});

test('waits for a human on the production environment', () => {
  assert.match(wf, /^\s+environment:\s*production\s*$/m);
});

test('deploys queue and are never cancelled mid-flight', () => {
  assert.match(wf, /cancel-in-progress:\s*false/);
});

test('deploys the commit CI tested, never github.sha', () => {
  assert.match(wf, /workflow_run\.head_sha/);
  assert.doesNotMatch(wf, /github\.sha/);
});

test('host key is pinned, never skipped', () => {
  assert.doesNotMatch(wf, /StrictHostKeyChecking[= ]+(no|off|accept-new)/i);
  assert.doesNotMatch(wf, /UserKnownHostsFile=\/dev\/null/);
  assert.match(wf, /StrictHostKeyChecking=yes/);
  assert.match(wf, /UserKnownHostsFile="\$HOME\/\.ssh\/known_hosts"/);
});

test('an empty pinned-hosts file fails closed before any connection', () => {
  assert.match(wf, /if \[ -z "\$keys" \]; then\n[\s\S]*?\bexit 1\n\s*fi/);
  assert.match(wf, /\.github\/deploy-known-hosts/);
});

test('the SSH key is created under umask 077 before it is written', () => {
  const umask = wf.indexOf('umask 077');
  const write = wf.indexOf('> "$HOME/.ssh/deploy_key"');
  assert.ok(umask !== -1 && write !== -1 && umask < write);
});

test('the SHA is validated as 40 hex characters before use', () => {
  assert.match(wf, /\*\[!0-9a-f\]\* \| ""\) .*exit 1/);
  assert.match(wf, /"\$\{#DEPLOY_SHA\}" -eq 40 \] \|\| \{[^}]*exit 1/);
});

test('the SSH session survives blips and a failure keeps its exit code', () => {
  assert.match(wf, /-o ConnectTimeout=\d+/);
  assert.match(wf, /-o ServerAliveInterval=\d+/);
  assert.match(wf, /-o ServerAliveCountMax=\d+/);
  assert.match(wf, /\|\| status=\$\?/);
  assert.match(wf, /exit "\$status"/);
});

test('failed runs explain exit 21, 22 and a lost connection (255)', () => {
  assert.match(wf, /^\s+21\) msg=".*ROLLED BACK/m);
  assert.match(wf, /^\s+22\) msg=".*ROLLBACK ALSO FAILED/m);
  assert.match(wf, /^\s+255\) msg=".*cd-deploy-\*\.log/m);
  assert.match(wf, /::error::The first line of the output above names the run log/);
});

test('public repo: GitHub-hosted runner only, read-only token, no tracing', () => {
  assert.doesNotMatch(wf, /runs-on:\s*self-hosted/);
  assert.match(wf, /runs-on:\s*ubuntu-latest/);
  assert.match(wf, /^permissions:\n\s+contents:\s*read/m);
  assert.doesNotMatch(wf, /set -\w*x/);
});

test('third-party actions are pinned to a released version', () => {
  const uses = [...wf.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length > 0);
  for (const u of uses) assert.match(u, /@v\d+(\.\d+)*$/, u);
  assert.match(wf, /tailscale\/github-action@v\d+\.\d+\.\d+/);
});

test('uses exactly the five production secrets', () => {
  assert.doesNotMatch(wf, /secrets\[/);
  const names = new Set([...wf.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]));
  assert.deepEqual(
    [...names].sort(),
    ['DEPLOY_HOST', 'DEPLOY_SSH_KEY', 'DEPLOY_USER', 'TS_OAUTH_CLIENT_ID', 'TS_OAUTH_SECRET'],
  );
});

test('the public URL check is warning-only', () => {
  assert.match(wf, /https:\/\/nonbangkokgrader\.com\//);
  assert.match(wf, /continue-on-error:\s*true/);
});

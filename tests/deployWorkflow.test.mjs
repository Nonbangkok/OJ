import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// There is no YAML parser in this repo, so these assertions pin the guarantees
// the deploy workflow must keep by matching its text.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wf = readFileSync(path.join(repositoryRoot, '.github/workflows/deploy.yml'), 'utf8');

test('fires only after the CI workflow, on main', () => {
  assert.match(wf, /workflows:\s*\[CI\]/);
  assert.match(wf, /branches:\s*\[main\]/);
});

test('red CI never deploys, and only main does', () => {
  assert.match(wf, /workflow_run\.conclusion == 'success'/);
  assert.match(wf, /workflow_run\.head_branch == 'main'/);
});

test('waits for a human on the production environment', () => {
  assert.match(wf, /environment:\s*production/);
});

test('deploys queue and are never cancelled mid-flight', () => {
  assert.match(wf, /cancel-in-progress:\s*false/);
});

test('deploys the commit CI tested, never github.sha', () => {
  assert.match(wf, /workflow_run\.head_sha/);
  assert.doesNotMatch(wf, /github\.sha/);
});

test('host key is pinned, never skipped', () => {
  assert.doesNotMatch(wf, /StrictHostKeyChecking[= ]no/);
  assert.match(wf, /StrictHostKeyChecking=yes/);
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

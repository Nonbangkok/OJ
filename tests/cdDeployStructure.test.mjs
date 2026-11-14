import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Structural guards for scripts/cd-deploy.sh that need no Docker. A shell
// function defined twice is silently shadowed (the last definition wins), passes
// `sh -n` and can leave a whole fix as dead code.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repositoryRoot, 'scripts/cd-deploy.sh');
const source = readFileSync(scriptPath, 'utf8');
const code = source
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

test('cd-deploy.sh parses', () => {
  const r = spawnSync('sh', ['-n', scriptPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('no function in cd-deploy.sh is defined twice', () => {
  const names = [...code.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{/gm)].map((m) => m[1]);
  assert.ok(names.length > 10, 'function definitions were found');
  const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
  assert.deepEqual([...new Set(duplicates)], []);
});

test('the run log is a direct file descriptor, ignoring HUP and PIPE', () => {
  assert.match(code, /^trap '' HUP PIPE$/m);
  assert.match(code, /^\s+exec >>"\$LOG_FILE" 2>&1$/m);
  assert.doesNotMatch(code, /mkfifo/);
  assert.doesNotMatch(code, /\btee\b/);
  assert.match(code, /^\s+trap finish_run_log EXIT$/m);
});

// The workflow runs `scripts/cd-deploy.sh <sha>` with no interpreter, so a file
// without the execute bit is exit 126 ("Permission denied") on the server. Every
// test here runs it as `sh <script>`, which is why nothing else notices.
test('cd-deploy.sh is executable, on disk and in the git index', () => {
  assert.equal(statSync(scriptPath).mode & 0o111, 0o111, 'mode must carry the execute bit for all');
  const r = spawnSync('git', ['ls-files', '-s', '--', 'scripts/cd-deploy.sh'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (r.status === 0 && r.stdout.trim()) {
    // A fresh checkout takes its file mode from the index (core.fileMode).
    assert.match(r.stdout, /^100755 /, `git index mode: ${r.stdout.trim()}`);
  }
});

test('the migration scan does not parse ls output (shellcheck SC2012)', () => {
  assert.doesNotMatch(code, /\bls\s+"\$REPO_DIR/);
  assert.match(code, /for f in "\$REPO_DIR"\/backend\/migrations\/\*\.ts/);
});

test('OJ_IMAGE_TAG is exported, never left to an assignment prefix on a function call', () => {
  // POSIX leaves it unspecified whether "VAR=x somefunction" exports VAR, and
  // the server runs dash: without the export, compose would silently fall back
  // to :local and "roll back" to the wrong images.
  assert.match(code, /^\s+export OJ_IMAGE_TAG$/m);
  assert.doesNotMatch(code, /OJ_IMAGE_TAG=\S+ compose\b/);
  const composeBody = code.slice(code.indexOf('compose() {'));
  assert.match(composeBody.slice(0, composeBody.indexOf('\n}')), /export OJ_IMAGE_TAG/);
});

test('rollback restores the image tags before the checkout', () => {
  const body = code.slice(code.indexOf('rollback() {'), code.indexOf('prune_images() {'));
  const retag = body.indexOf('docker tag "$repo:$SNAPSHOT_TAG"');
  const checkout = body.indexOf('checkout --quiet --detach "$PREV_SHA"');
  assert.ok(retag !== -1 && checkout !== -1, 'both steps found');
  // After a successful retag, ":$PREV_TAG" is the snapshot, so the by-hand
  // command the exit-22 banner prints is always correct.
  assert.ok(retag < checkout, 'the retag loop must come before the git checkout');
});

test('the lock is taken when flock exists and skipped when it does not', () => {
  assert.match(code, /command -v flock/);
  assert.match(code, /^\s+exec 9>"\$LOCK_FILE"$/m);
  assert.match(code, /^\s+flock -n 9 \|\| die /m);
});

test('everything the script creates is private to the deploy user', () => {
  assert.match(code, /^umask 077$/m);
});

test('log() writes from a subshell, so a failed write cannot pollute later output', () => {
  // A printf that fails on a closed console leaves the line in this shell's
  // stdio buffer; every command substitution forked afterwards inherits a copy
  // and flushes it into its own output (it once turned `df -Pk | awk` into two
  // lines and failed the disk guard). cdDeployRollback covers the behaviour.
  assert.match(code, /^\s+\(printf '%s cd-deploy: %s\\n' .*\) \|\| true$/m);
});

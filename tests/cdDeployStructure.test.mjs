import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

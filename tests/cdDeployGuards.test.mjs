import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercises the preflight guards of scripts/cd-deploy.sh with CD_DRY_RUN=1
// against a throwaway Postgres container and throwaway git repositories.
// Everything uses random names and is removed in after(); it never touches a
// real compose project.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repositoryRoot, 'scripts/cd-deploy.sh');
const runId = randomBytes(4).toString('hex');
const container = `ojcdguard-${runId}-db`;
const workDir = mkdtempSync(path.join(tmpdir(), `ojcdguard-${runId}-`));

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const must = (cmd, args, opts) => {
  const r = run(cmd, args, opts);
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stdout}${r.stderr}`);
  return r.stdout.trim();
};
const sql = (statement) =>
  must('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', statement]);

const git = (cwd, ...args) =>
  must('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd });

const repo = path.join(workDir, 'repo');
let headSha;
let offMainSha;

before(() => {
  // git: bare origin + clone with a tracked file, main pushed, plus a commit
  // that only exists on a side branch (not an ancestor of origin/main).
  const origin = path.join(workDir, 'origin.git');
  must('git', ['init', '--bare', '-b', 'main', origin]);
  must('git', ['clone', origin, repo]);
  writeFileSync(path.join(repo, 'tracked.txt'), 'one\n');
  git(repo, 'add', 'tracked.txt');
  git(repo, 'commit', '-m', 'one');
  git(repo, 'branch', '-M', 'main');
  git(repo, 'push', 'origin', 'main');
  headSha = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-b', 'side');
  writeFileSync(path.join(repo, 'side.txt'), 'side\n');
  git(repo, 'add', 'side.txt');
  git(repo, 'commit', '-m', 'side');
  offMainSha = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', 'main');

  must('docker', ['run', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=x', 'postgres:18-alpine']);
  for (let i = 0; i < 60; i += 1) {
    const r = run('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-c', 'select 1']);
    if (r.status === 0) break;
    spawnSync('sleep', ['1']);
  }
  sql('CREATE TABLE contests (id serial PRIMARY KEY, status varchar(20) NOT NULL)');
  sql('CREATE TABLE submissions (id serial PRIMARY KEY, overall_status varchar(50) NOT NULL)');
});

after(() => {
  spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8' });
  rmSync(workDir, { recursive: true, force: true });
});

const env = (extra = {}) => ({
  ...process.env,
  CD_DRY_RUN: '1',
  CD_REPO_DIR: repo,
  CD_DB_CONTAINER: container,
  CD_DB_USER: 'postgres',
  CD_DB_NAME: 'postgres',
  // The Docker root of the machine running the tests (e.g. Docker Desktop's VM
  // path) need not be stat-able on the host, so point the check at a real dir.
  CD_DOCKER_ROOT_DIR: workDir,
  CD_MIN_FREE_GB: '0',
  CD_QUEUE_WAIT_SECONDS: '2',
  ...extra,
});

const runScript = (sha, extra) => run('sh', [script, sha], { cwd: repositoryRoot, env: env(extra) });

const reset = () => {
  sql('TRUNCATE contests, submissions');
};

test('all clear exits 0', () => {
  reset();
  const r = runScript(headSha);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('running contest exits 10; ALLOW_DURING_CONTEST=1 overrides', () => {
  reset();
  sql("INSERT INTO contests (status) VALUES ('running')");
  const r = runScript(headSha);
  assert.equal(r.status, 10, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /contest/i);
  const ok = runScript(headSha, { ALLOW_DURING_CONTEST: '1' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

test('finishing contest exits 10', () => {
  reset();
  sql("INSERT INTO contests (status) VALUES ('finishing')");
  const r = runScript(headSha);
  assert.equal(r.status, 10, r.stdout + r.stderr);
});

test('scheduled and finished contests do not block', () => {
  reset();
  sql("INSERT INTO contests (status) VALUES ('scheduled'), ('finished')");
  const r = runScript(headSha);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('busy judge queue exits 11 after the wait window', () => {
  reset();
  sql("INSERT INTO submissions (overall_status) VALUES ('Running')");
  const r = runScript(headSha);
  assert.equal(r.status, 11, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /1 submission/);
});

test('Pending submissions do not count as in flight', () => {
  reset();
  sql("INSERT INTO submissions (overall_status) VALUES ('Pending'), ('Accepted')");
  const r = runScript(headSha);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('queue that drains while the script waits exits 0', async () => {
  reset();
  sql("INSERT INTO submissions (overall_status) VALUES ('Compiling')");
  const child = spawn('sh', [script, headSha], {
    cwd: repositoryRoot,
    env: env({ CD_QUEUE_WAIT_SECONDS: '60' }),
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const exited = new Promise((resolve) => child.on('close', resolve));
  await new Promise((resolve) => setTimeout(resolve, 3000));
  sql('DELETE FROM submissions');
  const code = await exited;
  assert.equal(code, 0, output);
});

test('low free disk exits 12', () => {
  reset();
  const r = runScript(headSha, { CD_MIN_FREE_GB: '999999' });
  assert.equal(r.status, 12, r.stdout + r.stderr);
});

test('SHA not on origin/main exits 14', () => {
  reset();
  const r = runScript(offMainSha);
  assert.equal(r.status, 14, r.stdout + r.stderr);
});

test('modified tracked file exits 13; untracked files are ignored', () => {
  reset();
  writeFileSync(path.join(repo, 'untracked.log'), 'x\n');
  const clean = runScript(headSha);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  writeFileSync(path.join(repo, 'tracked.txt'), 'changed\n');
  try {
    const r = runScript(headSha);
    assert.equal(r.status, 13, r.stdout + r.stderr);
  } finally {
    git(repo, 'checkout', '--', 'tracked.txt');
  }
});

test('contest_submissions in flight exit 11 even with ALLOW_DURING_CONTEST=1; absent table is fine', () => {
  reset();
  // Fixture so far has no contest_submissions table: counted as 0.
  const without = runScript(headSha, { ALLOW_DURING_CONTEST: '1' });
  assert.equal(without.status, 0, without.stdout + without.stderr);

  sql('CREATE TABLE contest_submissions (id serial PRIMARY KEY, overall_status varchar(50) NOT NULL)');
  try {
    sql("INSERT INTO contest_submissions (overall_status) VALUES ('Accepted'), ('Pending')");
    const idle = runScript(headSha, { ALLOW_DURING_CONTEST: '1' });
    assert.equal(idle.status, 0, idle.stdout + idle.stderr);
    for (const status of ['Compiling', 'Running']) {
      sql('DELETE FROM contest_submissions');
      sql(`INSERT INTO contest_submissions (overall_status) VALUES ('${status}')`);
      const r = runScript(headSha, { ALLOW_DURING_CONTEST: '1' });
      assert.equal(r.status, 11, r.stdout + r.stderr);
      assert.match(r.stdout + r.stderr, /1 submission/);
    }
  } finally {
    sql('DROP TABLE contest_submissions');
  }
});

test('non-integer or empty CD_MIN_FREE_GB / CD_QUEUE_WAIT_SECONDS exit 1 naming the variable', () => {
  reset();
  for (const name of ['CD_MIN_FREE_GB', 'CD_QUEUE_WAIT_SECONDS']) {
    for (const value of ['2.5', 'abc', '', '-1']) {
      const r = runScript(headSha, { [name]: value });
      assert.equal(r.status, 1, `${name}='${value}'\n${r.stdout}${r.stderr}`);
      assert.match(r.stdout + r.stderr, new RegExp(`${name} must be a non-negative integer, got '${value}'`));
    }
  }
});

test('free disk is the minimum over the checkout and the Docker root; refusal names the short path', () => {
  reset();
  const r = runScript(headSha, { CD_MIN_FREE_GB: '999999', CD_DOCKER_ROOT_DIR: workDir });
  assert.equal(r.status, 12, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /GB on \S+, below the required 999999 GB/);
});

test('unreadable Docker root fails closed with exit 1', () => {
  reset();
  const r = runScript(headSha, { CD_DOCKER_ROOT_DIR: path.join(workDir, 'does-not-exist') });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /could not read free disk space/);
});

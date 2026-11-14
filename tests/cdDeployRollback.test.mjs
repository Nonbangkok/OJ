import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercises backup, deploy, verify and rollback of scripts/cd-deploy.sh.
// Everything is throwaway: a Postgres container, a compose project with its own
// name and no ports or volumes (three trivial services, image names under a
// random prefix), a bare origin, and a stub deploy command in place of
// deploy.sh (which is bound to the real domain, certificate and tunnel). The
// project name is never `oj`, and after() removes everything it created.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repositoryRoot, 'scripts/cd-deploy.sh');
const runId = randomBytes(4).toString('hex');
const prefix = `ojcdrb${runId}`;
const project = prefix;
const dbContainer = `${prefix}-db`;
const workDir = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
const repo = path.join(workDir, 'repo');
const services = ['backend', 'frontend', 'authoring-runner'];
const OLD_TAG = 'aaa';

assert.notEqual(project, 'oj');

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const must = (cmd, args, opts) => {
  const r = run(cmd, args, opts);
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stdout}${r.stderr}`);
  return r.stdout.trim();
};
const git = (...args) =>
  must('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo });
const sql = (statement) =>
  must('docker', ['exec', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement]);
const compose = (tag, ...args) =>
  must('docker', ['compose', '-p', project, '-f', 'docker-compose.yml', ...args], {
    cwd: repo,
    env: { ...process.env, OJ_IMAGE_TAG: tag },
  });

let shaA;
let shaB;
let newTag;
const okHealth = path.join(workDir, 'ready');
const failStub = path.join(workDir, 'deploy-fail.sh');
const okStub = path.join(workDir, 'deploy-ok.sh');
const stubRan = path.join(workDir, 'stub-ran');

const imageRefs = (tag) => services.map((s) => `${prefix}-${s}:${tag}`);
const allImageRefs = () =>
  run('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'])
    .stdout.split('\n')
    .filter((ref) => ref.startsWith(`${prefix}-`));
const removeImages = () => {
  const refs = allImageRefs();
  if (refs.length) run('docker', ['rmi', '-f', ...refs]);
};
const tagAll = (tag) => {
  for (const ref of imageRefs(tag)) must('docker', ['tag', `${prefix}-backend:${OLD_TAG}`, ref]);
};

// Image of each running container of the throwaway project, by service.
const runningImages = () => {
  const out = {};
  for (const service of services) {
    const id = must('docker', ['compose', '-p', project, '-f', 'docker-compose.yml', 'ps', '-q', service], { cwd: repo });
    out[service] = id ? must('docker', ['inspect', '-f', '{{.Config.Image}}', id]) : null;
  }
  return out;
};
const assertRunning = (tag) => {
  assert.deepEqual(runningImages(), Object.fromEntries(services.map((s) => [s, `${prefix}-${s}:${tag}`])));
};

// The image's init server answers briefly before the real one starts: wait
// for init to finish, then for the final server.
const waitForPostgres = (container) => {
  for (let i = 0; i < 90; i += 1) {
    const logs = run('docker', ['logs', container]);
    const ready = `${logs.stdout}${logs.stderr}`.includes('PostgreSQL init process complete');
    if (ready && run('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-c', 'select 1']).status === 0) return;
    spawnSync('sleep', ['1']);
  }
  assert.fail(`postgres in ${container} never became ready`);
};

before(() => {
  const origin = path.join(workDir, 'origin.git');
  must('git', ['init', '--bare', '-b', 'main', origin]);
  must('git', ['clone', origin, repo]);
  const composeYml = services
    .map((s) => `  ${s}:\n    image: ${prefix}-${s}:\${OJ_IMAGE_TAG:-local}\n    command: ["sleep", "3600"]\n`)
    .join('');
  // Optional database service (profile "db", off unless COMPOSE_PROFILES=db).
  // DEPLOY_MARK changes with the image tag, so a deploy recreates it.
  const databaseYml =
    '  database:\n    image: postgres:18-alpine\n    profiles: ["db"]\n    environment:\n' +
    '      POSTGRES_PASSWORD: x\n      DEPLOY_MARK: ${OJ_IMAGE_TAG:-local}\n' +
    '    volumes:\n      - dbdata:/var/lib/postgresql\n';
  writeFileSync(path.join(repo, 'docker-compose.yml'), `services:\n${composeYml}${databaseYml}volumes:\n  dbdata:\n`);
  mkdirSync(path.join(repo, 'backend/migrations'), { recursive: true });
  writeFileSync(path.join(repo, 'backend/migrations/0001Core.ts'), '// 1\n');
  git('add', '.');
  git('commit', '-m', 'A');
  git('branch', '-M', 'main');
  writeFileSync(path.join(repo, 'backend/migrations/0002More.ts'), '// 2\n');
  writeFileSync(path.join(repo, 'release.txt'), 'B\n');
  git('add', '.');
  git('commit', '-m', 'B');
  git('push', 'origin', 'main');
  shaB = git('rev-parse', 'HEAD');
  shaA = git('rev-parse', 'HEAD~1');
  newTag = git('rev-parse', '--short=12', 'HEAD');

  // Trivial stand-ins for the three release images.
  const imageDir = path.join(workDir, 'image');
  mkdirSync(imageDir);
  writeFileSync(path.join(imageDir, 'Dockerfile'), 'FROM postgres:18-alpine\n');
  must('docker', ['build', '-q', '-t', `${prefix}-backend:${OLD_TAG}`, imageDir]);

  writeFileSync(okHealth, 'ok\n');
  writeFileSync(failStub, '#!/bin/sh\necho "stub deploy failing"\ntouch "$CD_TEST_STUB_RAN"\nexit 1\n', { mode: 0o755 });
  writeFileSync(
    okStub,
    `#!/bin/sh\ntouch "$CD_TEST_STUB_RAN"\ndocker compose -p ${project} -f docker-compose.yml up -d --no-build\n`,
    { mode: 0o755 },
  );

  must('docker', ['run', '-d', '--name', dbContainer, '-e', 'POSTGRES_PASSWORD=x', 'postgres:18-alpine']);
  waitForPostgres(dbContainer);
  sql('CREATE TABLE contests (id serial PRIMARY KEY, status varchar(20) NOT NULL)');
  sql('CREATE TABLE submissions (id serial PRIMARY KEY, overall_status varchar(50) NOT NULL)');
  sql('CREATE TABLE schema_migrations (version text PRIMARY KEY)');
});

after(() => {
  if (existsSync(repo)) {
    spawnSync('docker', ['compose', '-p', project, '--profile', 'db', '-f', 'docker-compose.yml', 'down', '-v', '--remove-orphans'], {
      cwd: repo,
      encoding: 'utf8',
    });
  }
  spawnSync('docker', ['rm', '-f', dbContainer], { encoding: 'utf8' });
  removeImages();
  rmSync(workDir, { recursive: true, force: true });
});

// Back to "release A (tag aaa) is running, recorded in .last-release".
beforeEach(() => {
  compose(OLD_TAG, 'down', '--remove-orphans');
  git('checkout', '--quiet', '--detach', shaA);
  for (const name of ['.last-release', 'backups']) rmSync(path.join(repo, name), { recursive: true, force: true });
  rmSync(stubRan, { force: true });
  removeImages();
  must('docker', ['build', '-q', '-t', `${prefix}-backend:${OLD_TAG}`, path.join(workDir, 'image')]);
  for (const tag of [OLD_TAG, newTag, 'old1']) tagAll(tag);
  sql('TRUNCATE contests, submissions, schema_migrations');
  sql("INSERT INTO schema_migrations VALUES ('0001_core')");
  compose(OLD_TAG, 'up', '-d', '--no-build');
  writeFileSync(path.join(repo, '.last-release'), `${OLD_TAG}\n${shaA}\n`);
});

const baseEnv = (extra = {}) => ({
  ...process.env,
  CD_REPO_DIR: repo,
  CD_DB_CONTAINER: dbContainer,
  CD_DB_USER: 'postgres',
  CD_DB_NAME: 'postgres',
  CD_DOCKER_ROOT_DIR: workDir,
  CD_MIN_FREE_GB: '0',
  CD_QUEUE_WAIT_SECONDS: '2',
  CD_IMAGE_PREFIX: prefix,
  CD_COMPOSE_FILES: '-f docker-compose.yml',
  COMPOSE_PROJECT_NAME: project,
  CD_HEALTH_URL: `file://${okHealth}`,
  CD_HEALTH_WAIT_SECONDS: '4',
  CD_DEPLOY_CMD: okStub,
  CD_TEST_STUB_RAN: stubRan,
  ...extra,
});

const runScript = (sha, extra) =>
  new Promise((resolve) => {
    const child = spawn('sh', [script, sha], { cwd: repositoryRoot, env: baseEnv(extra) });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (status) => resolve({ status, out }));
  });

const head = () => git('rev-parse', 'HEAD');
const dumps = () => {
  try {
    return readdirSync(path.join(repo, 'backups')).filter((name) => name.endsWith('.dump')).sort();
  } catch {
    return [];
  }
};

test('failed deploy exits 21 and restores the previous images and working tree', async () => {
  const r = await runScript(shaB, { CD_DEPLOY_CMD: failStub });
  assert.equal(r.status, 21, r.out);
  assert.match(r.out, /DEPLOY FAILED/);
  assert.match(r.out, /ROLLBACK OK/);
  assert.equal(head(), shaA);
  assertRunning(OLD_TAG);
  assert.equal(readFileSync(path.join(repo, '.last-release'), 'utf8'), `${OLD_TAG}\n${shaA}\n`);
  assert.equal(dumps().length, 1);
  assert.match(dumps()[0], new RegExp(`^pre-deploy-${newTag}-\\d{8}T\\d{6}\\.dump$`));  // The run log (first output line, and named by the rollback message) holds the outcome.
  const logName = readdirSync(path.join(repo, 'backups')).find((name) => /^cd-deploy-.*\.log$/.test(name));
  assert.ok(logName, 'run log written next to the dumps');
  assert.match(r.out.split('\n')[0], /log file: .*cd-deploy-/);
  assert.match(readFileSync(path.join(repo, 'backups', logName), 'utf8'), /ROLLBACK OK/);
  assert.match(r.out, /Full log of this run on the server: .*cd-deploy-/);
});

test('rollback target images missing exits 22 and says what to do by hand', async () => {
  run('docker', ['rmi', '-f', ...imageRefs(OLD_TAG)]);
  const r = await runScript(shaB, { CD_DEPLOY_CMD: failStub });
  assert.equal(r.status, 22, r.out);
  assert.match(r.out, /ROLLBACK FAILED/);
  assert.match(r.out, /rollback target is missing/);
  assert.match(r.out, new RegExp(`${prefix}-backend:${OLD_TAG}`));
  assert.match(r.out, new RegExp(`git checkout --detach ${shaA}`));
  assert.match(r.out, /database was NOT restored/);
});

test('nothing running warns "no rollback target" and still deploys', async () => {
  compose(OLD_TAG, 'down', '--remove-orphans');
  rmSync(path.join(repo, '.last-release'));
  sql("INSERT INTO schema_migrations VALUES ('0002_more')");
  const r = await runScript(shaB);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /no rollback target/);
  assert.equal(head(), shaB);
  assert.equal(readFileSync(path.join(repo, '.last-release'), 'utf8'), `${newTag}\n${shaB}\n`);
});

test('failed deploy with nothing running exits 22 (no rollback target)', async () => {
  compose(OLD_TAG, 'down', '--remove-orphans');
  rmSync(path.join(repo, '.last-release'));
  const r = await runScript(shaB, { CD_DEPLOY_CMD: failStub });
  assert.equal(r.status, 22, r.out);
  assert.match(r.out, /no rollback target/);
});

test('.last-release is recorded from live state, never trusted from the file', async () => {
  writeFileSync(path.join(repo, '.last-release'), `zzz\n${shaB}\n`);
  const r = await runScript(shaB, { CD_DEPLOY_CMD: failStub });
  assert.equal(r.status, 21, r.out);
  assert.match(r.out, new RegExp(`rollback target: tag ${OLD_TAG} at ${shaA}`));
  assert.equal(head(), shaA);
  assertRunning(OLD_TAG);
  assert.equal(readFileSync(path.join(repo, '.last-release'), 'utf8'), `${OLD_TAG}\n${shaA}\n`);
});

test('first CD deploy over a hand-built :local release is rollbackable', async () => {
  compose(OLD_TAG, 'down', '--remove-orphans');
  tagAll('local');
  compose('local', 'up', '-d', '--no-build');
  rmSync(path.join(repo, '.last-release'));
  const r = await runScript(shaB, { CD_DEPLOY_CMD: failStub });
  assert.equal(r.status, 21, r.out);
  assert.match(r.out, new RegExp(`rollback target: tag local at ${shaA}`));
  assert.match(r.out, /ROLLBACK OK/);
  assert.equal(head(), shaA);
  assertRunning('local');
});

// A deploy of the commit that is already live reuses the live tag: deploy.sh
// rebuilds the very images the rollback would restore.
const redeploySetup = () => {
  compose(OLD_TAG, 'down', '--remove-orphans');
  git('checkout', '--quiet', '--detach', shaB);
  compose(newTag, 'up', '-d', '--no-build');
  const originalId = must('docker', ['image', 'inspect', '-f', '{{.Id}}', `${prefix}-backend:${newTag}`]);
  const brokenDir = path.join(workDir, 'image-broken');
  mkdirSync(brokenDir, { recursive: true });
  writeFileSync(path.join(brokenDir, 'Dockerfile'), 'FROM postgres:18-alpine\nLABEL broken=1\n');
  const rebuild = path.join(workDir, 'deploy-rebuild.sh');
  const builds = services.map((svc) => `docker build -q -t ${prefix}-${svc}:$OJ_IMAGE_TAG ${brokenDir} >/dev/null`).join('\n');
  return { originalId, rebuild, builds };
};
const runningImageIds = () =>
  services.map((service) => {
    const id = must('docker', ['compose', '-p', project, '-f', 'docker-compose.yml', 'ps', '-q', service], { cwd: repo });
    return must('docker', ['inspect', '-f', '{{.Image}}', id]);
  });

test('redeploying the live commit that then fails restores the original images, not the rebuilt ones', async () => {
  const { originalId, rebuild, builds } = redeploySetup();
  sql("INSERT INTO schema_migrations VALUES ('0002_more')");
  writeFileSync(
    rebuild,
    `#!/bin/sh\n${builds}\ndocker compose -p ${project} -f docker-compose.yml up -d --no-build\nexit 1\n`,
    { mode: 0o755 },
  );
  const r = await runScript(shaB, { CD_DEPLOY_CMD: rebuild });
  assert.equal(r.status, 21, r.out);
  assert.match(r.out, /ROLLBACK OK/);
  assert.equal(head(), shaB);
  assert.deepEqual(runningImageIds(), [originalId, originalId, originalId]);
  assert.equal(must('docker', ['image', 'inspect', '-f', '{{.Id}}', `${prefix}-backend:${newTag}`]), originalId);
});

test('rollback that cannot verify exits 22, never a false ROLLBACK OK', async () => {
  // schema_migrations stops at 0001 but the live tree (B) ships 0002: neither
  // the failed deploy nor the restored release can pass full verification.
  const { rebuild, builds } = redeploySetup();
  writeFileSync(rebuild, `#!/bin/sh\n${builds}\ndocker compose -p ${project} -f docker-compose.yml up -d --no-build\n`, { mode: 0o755 });
  const r = await runScript(shaB, { CD_DEPLOY_CMD: rebuild });
  assert.equal(r.status, 22, r.out);
  assert.match(r.out, /ROLLBACK FAILED/);
  assert.doesNotMatch(r.out, /ROLLBACK OK/);
});

test('database service recreated by the deploy is re-resolved by name (no false rollback)', async () => {
  const dbEnv = { ...process.env, COMPOSE_PROFILES: 'db', OJ_IMAGE_TAG: OLD_TAG };
  const composeDb = (...args) =>
    must('docker', ['compose', '-p', project, '-f', 'docker-compose.yml', ...args], { cwd: repo, env: dbEnv });
  const idOf = () => composeDb('ps', '-q', 'database');
  try {
    composeDb('up', '-d', '--no-build');
    waitForPostgres(`${project}-database-1`);
    const sqlInDb = (statement) =>
      must('docker', ['exec', `${project}-database-1`, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', statement]);
    sqlInDb('CREATE TABLE contests (id serial PRIMARY KEY, status varchar(20) NOT NULL)');
    sqlInDb('CREATE TABLE submissions (id serial PRIMARY KEY, overall_status varchar(50) NOT NULL)');
    sqlInDb('CREATE TABLE schema_migrations (version text PRIMARY KEY)');
    sqlInDb("INSERT INTO schema_migrations VALUES ('0001_core'), ('0002_more')");
    const before = idOf();
    const r = await runScript(shaB, { COMPOSE_PROFILES: 'db', CD_DB_CONTAINER: '' });
    assert.equal(r.status, 0, r.out);
    assert.notEqual(idOf(), before, 'the deploy must have recreated the database container');
    assert.match(r.out, /DEPLOY OK/);
  } finally {
    spawnSync('docker', ['compose', '-p', project, '--profile', 'db', '-f', 'docker-compose.yml', 'down', '-v', '--remove-orphans'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, OJ_IMAGE_TAG: OLD_TAG },
    });
  }
});

test('successful deploy records the release, keeps the previous images, prunes older tags and backups', async () => {
  const backupDir = path.join(repo, 'backups');
  mkdirSync(backupDir);
  for (const ts of ['20200101T000001', '20200101T000002', '20200101T000003']) {
    writeFileSync(path.join(backupDir, `pre-deploy-zzzzzzzzzzzz-${ts}.dump`), 'x');
  }
  sql("INSERT INTO schema_migrations VALUES ('0002_more')");
  const r = await runScript(shaB, { CD_BACKUP_KEEP: '2' });
  assert.equal(r.status, 0, r.out);
  assert.equal(head(), shaB);
  assertRunning(newTag);
  assert.equal(readFileSync(path.join(repo, '.last-release'), 'utf8'), `${newTag}\n${shaB}\n`);
  const refs = allImageRefs();
  for (const ref of [...imageRefs(newTag), ...imageRefs(OLD_TAG)]) assert.ok(refs.includes(ref), `${ref} kept`);
  for (const ref of imageRefs('old1')) assert.ok(!refs.includes(ref), `${ref} pruned`);
  const kept = dumps();
  assert.equal(kept.length, 2, kept.join(','));
  assert.ok(kept.includes('pre-deploy-zzzzzzzzzzzz-20200101T000003.dump'));
  const dump = kept.find((name) => name.startsWith(`pre-deploy-${newTag}-`));
  assert.ok(dump, kept.join(','));
  // The backup is a real, readable custom-format dump.
  const list = run('docker', ['exec', '-i', dbContainer, 'pg_restore', '-l'], { input: readFileSync(path.join(backupDir, dump)) });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /schema_migrations/);
});

test('release that never becomes ready is rolled back (exit 21)', async () => {
  // Not ready exactly while release B is checked out, like a broken release.
  const server = http.createServer((req, res) => {
    const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    res.statusCode = sha === shaB ? 503 : 200;
    res.end('x');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    sql("INSERT INTO schema_migrations VALUES ('0002_more')");
    const r = await runScript(shaB, { CD_HEALTH_URL: `http://127.0.0.1:${server.address().port}/` });
    assert.equal(r.status, 21, r.out);
    assert.match(r.out, /did not become ready/);
    assert.match(r.out, /ROLLBACK OK/);
    assert.equal(head(), shaA);
    assertRunning(OLD_TAG);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('newest migration behind the shipped ones is a failed deploy (exit 21)', async () => {
  // schema_migrations stops at 0001 while release B ships 0002.
  const r = await runScript(shaB);
  assert.equal(r.status, 21, r.out);
  assert.match(r.out, /newest applied migration is '0001' but this release ships 0002/);
  assert.match(r.out, /ROLLBACK OK/);
  assert.equal(head(), shaA);
  assertRunning(OLD_TAG);
});

test('backup failure exits 20 before anything is changed', async () => {
  writeFileSync(path.join(repo, 'backups'), 'not a directory\n');
  const r = await runScript(shaB);
  assert.equal(r.status, 20, r.out);
  assert.equal(head(), shaA);
  assert.ok(!existsSync(stubRan), 'deploy command must not run');
  assertRunning(OLD_TAG);
});

test('unreadable dump exits 20, removes the file and changes nothing', async () => {
  // A pg_dump that "succeeds" with garbage output must not pass verification.
  const shimDir = path.join(workDir, 'shim');
  mkdirSync(shimDir, { recursive: true });
  writeFileSync(
    path.join(shimDir, 'docker'),
    '#!/bin/sh\ncase "$*" in *pg_dump*) echo garbage; exit 0;; esac\nexec "$REAL_DOCKER" "$@"\n',
    { mode: 0o755 },
  );
  const realDocker = must('sh', ['-c', 'command -v docker']);
  const r = await runScript(shaB, { PATH: `${shimDir}:${process.env.PATH}`, REAL_DOCKER: realDocker });
  assert.equal(r.status, 20, r.out);
  assert.match(r.out, /not readable/);
  assert.deepEqual(dumps(), []);
  assert.equal(head(), shaA);
  assert.ok(!existsSync(stubRan));
});

test('pg_dump exceeding CD_BACKUP_TIMEOUT_SECONDS exits 20, removes the partial file and changes nothing', async () => {
  // Replaces the dump with a long sleep but keeps the real in-container timeout.
  const shimDir = path.join(workDir, 'shim-timeout');
  mkdirSync(shimDir, { recursive: true });
  writeFileSync(
    path.join(shimDir, 'docker'),
    '#!/bin/sh\ncase "$*" in *pg_dump*) exec "$REAL_DOCKER" exec "$2" "$3" "$4" sleep 30;; esac\nexec "$REAL_DOCKER" "$@"\n',
    { mode: 0o755 },
  );
  const realDocker = must('sh', ['-c', 'command -v docker']);
  const started = Date.now();
  const r = await runScript(shaB, {
    PATH: `${shimDir}:${process.env.PATH}`,
    REAL_DOCKER: realDocker,
    CD_BACKUP_TIMEOUT_SECONDS: '2',
  });
  assert.equal(r.status, 20, r.out);
  assert.match(r.out, /exceeded 2s/);
  assert.ok(Date.now() - started < 25000, 'the cap must cut the dump short');
  assert.deepEqual(dumps(), []);
  assert.equal(head(), shaA);
  assert.ok(!existsSync(stubRan));
});

test('invalid CD_BACKUP_TIMEOUT_SECONDS exits 1 before anything is changed', async () => {
  for (const value of ['', 'x', '0']) {
    const r = await runScript(shaB, { CD_BACKUP_TIMEOUT_SECONDS: value });
    assert.equal(r.status, 1, `'${value}'\n${r.out}`);
    assert.match(r.out, /CD_BACKUP_TIMEOUT_SECONDS must be/);
  }
  assert.equal(head(), shaA);
});

test('invalid CD_BACKUP_KEEP exits 1 before anything is changed', async () => {
  for (const value of ['', 'x', '0']) {
    const r = await runScript(shaB, { CD_BACKUP_KEEP: value });
    assert.equal(r.status, 1, `'${value}'\n${r.out}`);
    assert.match(r.out, /CD_BACKUP_KEEP must be/);
  }
  assert.equal(head(), shaA);
});

// A dropped SSH session without a pty closes the pipes the script writes to.
// The deploy command outlives the reader and fails; the script must still run
// to completion, and the run log must hold the final verdict.
const runWithReaderClosedMidDeploy = async (prepare) => {
  const slowFail = path.join(workDir, 'deploy-slow-fail.sh');
  writeFileSync(
    slowFail,
    '#!/bin/sh\necho "stub deploy started"\ntouch "$CD_TEST_STUB_RAN"\nsleep 4\necho "stub deploy still writing after the reader closed"\nexit 1\n',
    { mode: 0o755 },
  );
  if (prepare) prepare();
  const child = spawn('sh', [script, shaB], { cwd: repositoryRoot, env: baseEnv({ CD_DEPLOY_CMD: slowFail }) });
  let consoleOut = '';
  child.stdout.on('data', (d) => { consoleOut += d; });
  child.stderr.on('data', (d) => { consoleOut += d; });
  const closed = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal })));
  for (let i = 0; i < 300 && !existsSync(stubRan); i += 1) await new Promise((r) => setTimeout(r, 100));
  assert.ok(existsSync(stubRan), `deploy command never started: ${consoleOut}`);
  child.stdout.destroy();
  child.stderr.destroy();
  const { status, signal } = await closed;
  assert.equal(signal, null);
  const logName = readdirSync(path.join(repo, 'backups')).find((name) => /^cd-deploy-.*\.log$/.test(name));
  assert.ok(logName, 'run log written');
  const logged = readFileSync(path.join(repo, 'backups', logName), 'utf8');
  assert.match(logged, /stub deploy still writing after the reader closed/);
  assert.match(logged, /DEPLOY FAILED/);
  assert.match(logged, /Full log of this run on the server/);
  return { status, logged, consoleOut };
};

test('exit 21 survives the console reader going away mid-deploy and the log holds the verdict', async () => {
  const { status, logged, consoleOut } = await runWithReaderClosedMidDeploy();
  assert.equal(status, 21, consoleOut);
  assert.equal(head(), shaA);
  assertRunning(OLD_TAG);
  assert.match(logged, /ROLLBACK OK/);
});

test('exit 22 survives the console reader going away mid-deploy and the log holds the verdict', async () => {
  const { status, logged, consoleOut } = await runWithReaderClosedMidDeploy(() =>
    run('docker', ['rmi', '-f', ...imageRefs(OLD_TAG)]),
  );
  assert.equal(status, 22, consoleOut);
  assert.match(logged, /ROLLBACK FAILED/);
  assert.match(logged, /rollback target is missing/);
  assert.match(logged, /database was NOT restored/);
});

test('an unwritable run log fails loudly before anything is changed', { skip: process.getuid?.() === 0 }, async () => {
  const backupDir = path.join(repo, 'backups');
  mkdirSync(backupDir);
  chmodSync(backupDir, 0o555);
  try {
    const r = await runScript(shaB);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /cannot write the run log/);
  } finally {
    chmodSync(backupDir, 0o755);
  }
  assert.ok(!existsSync(stubRan), 'deploy command must not run');
  assert.equal(head(), shaA);
});

test('a console that is already closed cannot kill a run that has no log (SIGPIPE is ignored)', async () => {
  // backups is a file, so no run log can be created and output stays on stdout.
  writeFileSync(path.join(repo, 'backups'), 'not a directory\n');
  const statusFile = path.join(workDir, 'closed-console-status');
  rmSync(statusFile, { force: true });
  // The reader (`true`) exits at once, so every write by the script hits a closed pipe.
  const child = spawn('sh', ['-c', '(sleep 1; sh "$0" "$1"; echo $? >"$2") 2>&1 | true', script, shaB, statusFile], {
    cwd: repositoryRoot,
    env: baseEnv(),
  });
  await new Promise((resolve) => child.on('close', resolve));
  for (let i = 0; i < 100 && !existsSync(statusFile); i += 1) await new Promise((r) => setTimeout(r, 100));
  assert.equal(readFileSync(statusFile, 'utf8').trim(), '20');
  assert.ok(!existsSync(stubRan));
});

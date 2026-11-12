import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { after, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercises scripts/pg18-guard.sh against throwaway Docker volumes. Every run
// uses its own random prefixes, so it never sees (or touches) a real
// project's volumes; everything it creates is removed in after().

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guard = path.join(repositoryRoot, 'scripts/pg18-guard.sh');
const runId = randomBytes(4).toString('hex');
const createdVolumes = new Set();

const docker = (args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, `docker ${args.join(' ')}\n${result.stderr}`);
  return result.stdout;
};

// Creates <name> and writes `content` to each relative path inside it.
const seedVolume = (name, files) => {
  docker(['volume', 'create', name]);
  createdVolumes.add(name);
  const script = Object.entries(files)
    .map(([file, content]) => `mkdir -p "$(dirname "/v/${file}")" && echo ${content} > "/v/${file}"`)
    .join(' && ');
  docker(['run', '--rm', '--network', 'none', '-v', `${name}:/v`, 'alpine:3', 'sh', '-c', script]);
};

const runGuard = (project) =>
  spawnSync('sh', [guard], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, OJ_PG_GUARD_PROJECT: project },
  });

const prefix = (label) => `ojpgguard-${runId}-${label}`;

after(() => {
  for (const name of createdVolumes) {
    spawnSync('docker', ['volume', 'rm', '-f', name], { encoding: 'utf8' });
  }
});

test('(a) fresh install: no volumes passes', () => {
  const result = runGuard(prefix('a'));
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('(a2) fresh install on 18: an 18 cluster without the marker and no old volume passes', () => {
  const project = prefix('a2');
  seedVolume(`${project}_db-data-18`, { '18/docker/PG_VERSION': '18' });

  const result = runGuard(project);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('(b) old 16 volume without an 18 volume requires the migration', () => {
  const project = prefix('b');
  seedVolume(`${project}_db-data`, { PG_VERSION: '16' });

  const result = runGuard(project);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /Postgres 18 upgrade required: see docs\/runbooks\/postgres-18-upgrade\.md/);
  assert.match(result.stdout, new RegExp(`${project}_db-data\\b`));
  assert.match(result.stdout, new RegExp(`${project}_db-data-18`));
});

test('(c) old 16 volume plus a migrated 18 cluster (marker present) passes', () => {
  const project = prefix('c');
  seedVolume(`${project}_db-data`, { PG_VERSION: '16' });
  seedVolume(`${project}_db-data-18`, {
    '18/docker/PG_VERSION': '18',
    '.oj-pg18-migrated-from-16': 'migrated',
  });

  const result = runGuard(project);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('(c1) old 16 volume plus an 18 cluster without the migrated marker requires the migration', () => {
  // e.g. a plain `docker compose up` on the new release initialised an EMPTY 18 cluster
  const project = prefix('c1');
  seedVolume(`${project}_db-data`, { PG_VERSION: '16' });
  seedVolume(`${project}_db-data-18`, { '18/docker/PG_VERSION': '18' });

  const result = runGuard(project);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /Postgres 18 upgrade required: see docs\/runbooks\/postgres-18-upgrade\.md/);
  assert.match(result.stdout, /initialised WITHOUT migrating/);
  assert.match(result.stdout, /scripts\/pg18-migrate\.sh --force-recreate-18/);
});

test('(c2) old 16 volume plus an 18 volume without a cluster requires the migration', () => {
  const project = prefix('c2');
  seedVolume(`${project}_db-data`, { PG_VERSION: '16' });
  seedVolume(`${project}_db-data-18`, { 'README': 'empty' });

  const result = runGuard(project);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /docs\/runbooks\/postgres-18-upgrade\.md/);
});

test('(c3) an 18 cluster left by an interrupted migration is refused', () => {
  const project = prefix('c3');
  seedVolume(`${project}_db-data`, { PG_VERSION: '16' });
  seedVolume(`${project}_db-data-18`, {
    '18/docker/PG_VERSION': '18',
    '.oj-pg18-migration-incomplete': 'started',
    // even with the migrated marker, an incomplete marker still refuses
    '.oj-pg18-migrated-from-16': 'migrated',
  });

  const result = runGuard(project);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /docs\/runbooks\/postgres-18-upgrade\.md/);
  assert.match(result.stdout, /--force-recreate-18/);
});

test('(d) 16-era data at the root of the 18 volume is refused', () => {
  const project = prefix('d');
  seedVolume(`${project}_db-data-18`, { PG_VERSION: '16' });

  const result = runGuard(project);
  assert.equal(result.status, 3, result.stdout + result.stderr);
  assert.match(result.stdout, /docs\/runbooks\/postgres-18-upgrade\.md/);
});

test('(e) a different project name behaves like (b): the name is not hardcoded', () => {
  const project = prefix('e-other');
  seedVolume(`${project}_db-data`, { PG_VERSION: '16' });

  const result = runGuard(project);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`${project}_db-data-18`));
  // The (b) project's volumes must not leak into this result.
  assert.doesNotMatch(result.stdout, new RegExp(prefix('b')));
});

test('without the override, the project name comes from docker compose config', () => {
  const project = prefix('f');
  seedVolume(`${project}_db-data`, { PG_VERSION: '16' });

  const env = { ...process.env, COMPOSE_PROJECT_NAME: project };
  delete env.OJ_PG_GUARD_PROJECT;
  const result = spawnSync('sh', [guard, '--env-file', '.env.example', '-f', 'docker-compose.yml'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env,
  });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`${project}_db-data-18`));
});

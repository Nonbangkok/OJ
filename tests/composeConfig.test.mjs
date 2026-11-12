import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Only what the docker CLI itself needs. The rest of the developer's shell env
// (an exported HTTP_PORT, COMPOSE_*, POSTGRES_*, …) would override
// .env.example and make the assertions depend on the machine.
const DOCKER_ENV_KEYS = new Set(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'USER', 'LANG']);
const DOCKER_ENV_PREFIXES = ['DOCKER_', 'XDG_', 'LC_'];

const dockerEnvironment = (overrides) => {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (DOCKER_ENV_KEYS.has(key) || DOCKER_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      env[key] = value;
    }
  }
  return { ...env, ...overrides };
};

const renderComposeConfig = (files, environment = {}) => {
  const args = ['compose', '--env-file', '.env.example'];
  for (const file of files) {
    args.push('-f', file);
  }
  args.push('config', '--format', 'json');

  const result = spawnSync('docker', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: dockerEnvironment(environment),
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test('local Compose config is self-contained and migration-gated', () => {
  const config = renderComposeConfig(['docker-compose.yml']);
  const serviceNames = Object.keys(config.services).sort();

  assert.deepEqual(serviceNames, [
    'authoring-runner',
    'backend',
    'database',
    'frontend',
    'migrate',
    'nginx-proxy',
  ]);
  assert.equal(config.services.backend.depends_on.migrate.condition, 'service_completed_successfully');
  assert.match(config.services.backend.healthcheck.test.join(' '), /health\/ready/);
  assert.equal(config.services.backend.environment.NODE_ENV, 'development');
  assert.equal(config.services.backend.environment.COOKIE_SECURE, 'false');
  assert.equal(config.services.backend.environment.COOKIE_DOMAIN, '');
  assert.equal(config.services.backend.environment.CORS_ORIGINS, '');
  assert.equal(config.services.frontend.build.args.REACT_APP_API_URL, '/api');
  assert.match(config.services.frontend.healthcheck.test.join(' '), /127\.0\.0\.1/);
  assert.equal(config.services['nginx-proxy'].ports[0].published, '80');

  for (const service of Object.values(config.services)) {
    assert.equal(service.container_name, undefined);
  }

  const nginxVolumes = config.services['nginx-proxy'].volumes;
  assert.equal(nginxVolumes.some(({ target }) => target === '/etc/letsencrypt'), false);
  assert.equal(nginxVolumes.some(({ source }) => source.endsWith('/nginx-proxy/local.conf')), true);

  const localNginx = readFileSync(path.join(repositoryRoot, 'nginx-proxy/local.conf'), 'utf8');
  assert.match(localNginx, /X-Frame-Options "SAMEORIGIN"/);
  assert.match(localNginx, /frame-ancestors 'self'/);
  assert.match(localNginx, /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(localNginx, /font-src[^;]*https:\/\/fonts\.gstatic\.com/);

  const frontendNginx = readFileSync(path.join(repositoryRoot, 'frontend/nginx.conf'), 'utf8');
  assert.match(frontendNginx, /X-Frame-Options "SAMEORIGIN"/);
  assert.match(frontendNginx, /frame-ancestors 'self'/);
  assert.match(frontendNginx, /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(frontendNginx, /font-src[^;]*https:\/\/fonts\.gstatic\.com/);
});

test('authoring runner shares only its spool and has no network or backend secrets', () => {
  for (const files of [['docker-compose.yml'], ['docker-compose.yml', 'docker-compose.production.yml']]) {
    const config = renderComposeConfig(files, { CLOUDFLARE_TUNNEL_TOKEN: 'test-only' });
    const runner = config.services['authoring-runner'];
    assert.equal(runner.network_mode, 'none');
    assert.equal(runner.read_only, true);
    assert.deepEqual(runner.cap_drop, ['ALL']);
    assert.deepEqual([...runner.cap_add].sort(), ['DAC_OVERRIDE', 'KILL', 'SETGID', 'SETUID', 'SYS_CHROOT']);
    assert.match(runner.tmpfs.find(value => value.startsWith('/work:')), /(?:[:,])exec(?:,|$)/);
    assert.equal(runner.mem_limit, '1073741824');
    assert.equal(runner.pids_limit, 256);
    assert.equal(runner.volumes.length, 1);
    assert.equal(runner.volumes[0].target, '/jobs');
    assert.equal(runner.environment?.DATABASE_URL, undefined);
    assert.equal(runner.environment?.SECRET_KEY, undefined);
    assert.equal(config.services.backend.environment.AUTHORING_JOBS_DIR, '/jobs');
    assert.equal(config.services.backend.volumes.some(v => v.target === '/jobs' && v.source === runner.volumes[0].source), true);
  }
});

test('backend retains only the capabilities required to drop judge privileges', () => {
  const configurations = [
    renderComposeConfig(['docker-compose.yml']),
    renderComposeConfig(
      ['docker-compose.yml', 'docker-compose.production.yml'],
      {
        CLOUDFLARE_TUNNEL_TOKEN: 'test-tunnel-token',
        COOKIE_DOMAIN: 'nonbangkokgrader.com',
        CORS_ORIGINS: 'https://nonbangkokgrader.com',
      },
    ),
  ];

  for (const config of configurations) {
    assert.deepEqual(config.services.backend.cap_drop, ['ALL']);
    assert.deepEqual(config.services.backend.cap_add.sort(), ['SETGID', 'SETUID']);
  }
});

test('production defaults consistently target nonbangkokgrader.com', () => {
  const config = renderComposeConfig(
    ['docker-compose.yml', 'docker-compose.production.yml'],
    { CLOUDFLARE_TUNNEL_TOKEN: 'test-tunnel-token' },
  );

  assert.equal(config.services.backend.environment.COOKIE_DOMAIN, 'nonbangkokgrader.com');
  assert.deepEqual(config.services.backend.environment.CORS_ORIGINS.split(','), [
    'https://www.nonbangkokgrader.com',
    'https://nonbangkokgrader.com',
    'https://upload.nonbangkokgrader.com',
  ]);

  const productionFiles = [
    '.env.production.example',
    'docker-compose.production.yml',
    'nginx-proxy/production.conf',
    'deploy.sh',
  ].map((file) => readFileSync(path.join(repositoryRoot, file), 'utf8'));
  const productionText = productionFiles.join('\n');

  assert.doesNotMatch(productionText, /(?:^|\.)woi-grader\.com/m);
  // Apex is the canonical origin; www has its own block that redirects to it.
  assert.match(productionText, /server_name nonbangkokgrader\.com;/);
  assert.match(productionText, /server_name www\.nonbangkokgrader\.com;/);
  assert.match(productionText, /return 301 https:\/\/nonbangkokgrader\.com\$request_uri;/);
  assert.match(productionText, /server_name upload\.nonbangkokgrader\.com/);
  assert.match(productionText, /\/etc\/letsencrypt\/live\/nonbangkokgrader\.com\/fullchain\.pem/);
  assert.match(productionText, /Host: nonbangkokgrader\.com/);
});

test('production overlay enables public security and tunnel configuration', () => {
  const config = renderComposeConfig(
    ['docker-compose.yml', 'docker-compose.production.yml'],
    {
      CLOUDFLARE_TUNNEL_TOKEN: 'test-tunnel-token',
      COOKIE_DOMAIN: 'nonbangkokgrader.com',
      CORS_ORIGINS: 'https://www.nonbangkokgrader.com,https://nonbangkokgrader.com,https://upload.nonbangkokgrader.com',
    },
  );

  assert.ok(config.services.cloudflared);
  assert.equal(config.services.cloudflared.environment.TUNNEL_TOKEN, 'test-tunnel-token');
  assert.equal(config.services.backend.environment.NODE_ENV, 'production');
  assert.equal(config.services.backend.environment.COOKIE_SECURE, 'true');
  assert.equal(config.services.backend.environment.COOKIE_DOMAIN, 'nonbangkokgrader.com');
  assert.match(config.services.backend.environment.CORS_ORIGINS, /upload\.nonbangkokgrader\.com/);
  assert.equal(
    config.services['nginx-proxy'].ports.some(({ target, published }) => target === 443 && published === '443'),
    true,
  );

  const nginxVolumes = config.services['nginx-proxy'].volumes;
  assert.equal(nginxVolumes.some(({ source }) => source.endsWith('/nginx-proxy/production.conf')), true);
  assert.equal(nginxVolumes.some(({ source }) => source.endsWith('/nginx-proxy/local.conf')), false);
  assert.equal(nginxVolumes.some(({ target }) => target === '/etc/letsencrypt'), true);
  assert.equal(nginxVolumes.some(({ target }) => target === '/var/lib/letsencrypt'), true);

  const productionNginx = readFileSync(path.join(repositoryRoot, 'nginx-proxy/production.conf'), 'utf8');
  assert.match(productionNginx, /X-Frame-Options "SAMEORIGIN"/);
  assert.match(productionNginx, /frame-ancestors 'self'/);
  assert.match(productionNginx, /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(productionNginx, /font-src[^;]*https:\/\/fonts\.gstatic\.com/);
  assert.match(productionNginx, /listen 443 ssl/);
  assert.match(productionNginx, /ssl_certificate \/etc\/letsencrypt\/live\/nonbangkokgrader\.com\/fullchain\.pem/);
  assert.equal(config.services.cloudflared.networks['tunnel-network'].ipv4_address, '172.30.250.3');
  assert.equal('tunnel-network' in config.services['nginx-proxy'].networks, true);
  assert.equal(config.networks['tunnel-network'].ipam.config[0].subnet, '172.30.250.0/29');
  assert.match(productionNginx, /set_real_ip_from 172\.30\.250\.3/);
  assert.match(productionNginx, /real_ip_header CF-Connecting-IP/);
  assert.doesNotMatch(productionNginx, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for/);
  assert.match(productionNginx, /proxy_set_header X-Forwarded-For \$remote_addr/);
});

test('database runs Postgres 18 on the 18 volume layout', () => {
  const config = renderComposeConfig(['docker-compose.yml']);
  const database = config.services.database;

  assert.equal(database.image, 'postgres:18-alpine');
  assert.equal(
    database.volumes.some(v => v.type === 'volume' && v.source === 'db-data-18' && v.target === '/var/lib/postgresql'),
    true,
  );
  assert.equal(database.volumes.some(v => v.target === '/var/lib/postgresql/data'), false);
  assert.ok(config.volumes['db-data-18']);
  assert.equal(config.volumes['db-data'], undefined);

  const production = renderComposeConfig(
    ['docker-compose.yml', 'docker-compose.production.yml'],
    { CLOUDFLARE_TUNNEL_TOKEN: 'test-tunnel-token' },
  );
  assert.equal(production.services.database.image, 'postgres:18-alpine');
  assert.deepEqual(production.services.database.volumes, database.volumes);
  assert.ok(production.volumes['db-data-18']);
  assert.equal(production.volumes['db-data'], undefined);
});

test('integration stack uses Postgres 18', () => {
  const text = readFileSync(path.join(repositoryRoot, 'tests/authoring/compose.yml'), 'utf8');
  assert.match(text, /^\s+image: postgres:18-alpine\s*$/m);
  assert.match(text, /^\s+- \/var\/lib\/postgresql\s*$/m);
  assert.doesNotMatch(text, /\/var\/lib\/postgresql\/data/);
});

test('backend image installs the Postgres 18 client and retries the pgdg key fetch', () => {
  const dockerfile = readFileSync(path.join(repositoryRoot, 'backend/Dockerfile'), 'utf8');
  assert.match(dockerfile, /postgresql-client-18\b/);
  assert.doesNotMatch(dockerfile, /postgresql-client-16/);
  const keyLine = dockerfile.split('\n').find(line => line.includes('ACCC4CF8.asc'));
  assert.ok(keyLine);
  assert.match(keyLine, /--retry 5/);
  assert.match(keyLine, /--retry-all-errors/);
});

test('deploy.sh runs the Postgres 18 upgrade guard before it builds or starts anything', () => {
  const lines = readFileSync(path.join(repositoryRoot, 'deploy.sh'), 'utf8').split('\n');
  const firstLine = (pattern) => lines.findIndex((line) => pattern.test(line));
  const guard = firstLine(/^scripts\/pg18-guard\.sh "\$\{compose_files\[@\]\}" \|\| exit \$\?$/);
  const build = firstLine(/^"\$\{compose\[@\]\}" build\b/);
  const up = firstLine(/^"\$\{compose\[@\]\}" up\b/);

  assert.notEqual(guard, -1, 'deploy.sh must call scripts/pg18-guard.sh with the shared compose files');
  assert.notEqual(build, -1);
  assert.notEqual(up, -1);
  assert.ok(guard < build && guard < up, 'the guard must run before build and up');
});

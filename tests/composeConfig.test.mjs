import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const renderComposeConfig = (files, environment = {}) => {
  const args = ['compose', '--env-file', '.env.example'];
  for (const file of files) {
    args.push('-f', file);
  }
  args.push('config', '--format', 'json');

  const result = spawnSync('docker', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test('local Compose config is self-contained and migration-gated', () => {
  const config = renderComposeConfig(['docker-compose.yml']);
  const serviceNames = Object.keys(config.services).sort();

  assert.deepEqual(serviceNames, [
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

test('backend retains only the capabilities required to drop judge privileges', () => {
  const configurations = [
    renderComposeConfig(['docker-compose.yml']),
    renderComposeConfig(
      ['docker-compose.yml', 'docker-compose.production.yml'],
      {
        CLOUDFLARE_TUNNEL_TOKEN: 'test-tunnel-token',
        COOKIE_DOMAIN: 'woi-grader.com',
        CORS_ORIGINS: 'https://woi-grader.com',
      },
    ),
  ];

  for (const config of configurations) {
    assert.deepEqual(config.services.backend.cap_drop, ['ALL']);
    assert.deepEqual(config.services.backend.cap_add.sort(), ['SETGID', 'SETUID']);
  }
});

test('production overlay enables public security and tunnel configuration', () => {
  const config = renderComposeConfig(
    ['docker-compose.yml', 'docker-compose.production.yml'],
    {
      CLOUDFLARE_TUNNEL_TOKEN: 'test-tunnel-token',
      COOKIE_DOMAIN: 'woi-grader.com',
      CORS_ORIGINS: 'https://www.woi-grader.com,https://woi-grader.com,https://upload.woi-grader.com',
    },
  );

  assert.ok(config.services.cloudflared);
  assert.equal(config.services.cloudflared.environment.TUNNEL_TOKEN, 'test-tunnel-token');
  assert.equal(config.services.backend.environment.NODE_ENV, 'production');
  assert.equal(config.services.backend.environment.COOKIE_SECURE, 'true');
  assert.equal(config.services.backend.environment.COOKIE_DOMAIN, 'woi-grader.com');
  assert.match(config.services.backend.environment.CORS_ORIGINS, /upload\.woi-grader\.com/);
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
  assert.match(productionNginx, /ssl_certificate \/etc\/letsencrypt\/live\/woi-grader\.com\/fullchain\.pem/);
  assert.equal(config.services.cloudflared.networks['tunnel-network'].ipv4_address, '172.30.250.3');
  assert.equal('tunnel-network' in config.services['nginx-proxy'].networks, true);
  assert.equal(config.networks['tunnel-network'].ipam.config[0].subnet, '172.30.250.0/29');
  assert.match(productionNginx, /set_real_ip_from 172\.30\.250\.3/);
  assert.match(productionNginx, /real_ip_header CF-Connecting-IP/);
  assert.doesNotMatch(productionNginx, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for/);
  assert.match(productionNginx, /proxy_set_header X-Forwarded-For \$remote_addr/);
});

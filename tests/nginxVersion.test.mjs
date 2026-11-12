import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readText = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const proxyImage = () => {
  const compose = readText('docker-compose.yml');
  const service = compose.match(/^ {2}nginx-proxy:\n((?: {4}.*\n|\n)+)/m);
  assert.ok(service, 'nginx-proxy service found in docker-compose.yml');
  const image = service[1].match(/^\s*image:\s*(nginx:\S+)/m);
  assert.ok(image, 'nginx-proxy service has an nginx image');
  return image[1];
};

const frontendImage = () => {
  const from = readText('frontend/Dockerfile').match(/^FROM (nginx:\S+)/m);
  assert.ok(from, 'frontend/Dockerfile has an nginx runtime stage');
  return from[1];
};

test('reverse proxy and frontend runtime use the same nginx image', () => {
  assert.equal(proxyImage(), frontendImage());
});

test('nginx is on the 1.30 stable line', () => {
  assert.equal(proxyImage(), 'nginx:1.30-alpine');
});

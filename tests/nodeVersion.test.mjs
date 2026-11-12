import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readText = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));

const major = readText('.nvmrc').trim();
const tagPattern = new RegExp(`^${major}(?:[.@-]|$)`);

const listDockerfiles = () => {
  const result = spawnSync('git', ['ls-files'], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ls-files failed: ${result.stderr}`);
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .filter((file) => {
      const base = path.posix.basename(file);
      return base === 'Dockerfile' || base.endsWith('.Dockerfile') || base.startsWith('Dockerfile.');
    });
};

test('.nvmrc pins Node 26', () => {
  assert.equal(readText('.nvmrc').trim(), '26');
});

test('package engines match .nvmrc', () => {
  for (const workspace of ['backend', 'frontend']) {
    assert.equal(readJson(`${workspace}/package.json`).engines.node, `${major}.x`, `${workspace}/package.json`);
    assert.equal(
      readJson(`${workspace}/package-lock.json`).packages[''].engines.node,
      `${major}.x`,
      `${workspace}/package-lock.json`,
    );
  }
});

test('Node base images in every Dockerfile match .nvmrc', () => {
  let found = 0;
  for (const file of listDockerfiles()) {
    const tags = [...readText(file).matchAll(/^FROM node:(\S+)/gm)].map((match) => match[1]);
    for (const tag of tags) {
      found += 1;
      assert.ok(tagPattern.test(tag), `${file} uses node:${tag}`);
    }
  }
  assert.ok(found > 0, 'found at least one node base image');
});

test('judge image is on trixie; runner build stage stays on bookworm', () => {
  assert.match(readText('backend/Dockerfile'), new RegExp(`^FROM node:${major}-trixie-slim`, 'm'));
  assert.match(readText('backend/authoring/Dockerfile'), /^FROM node:26-bookworm-slim AS build/m);
});

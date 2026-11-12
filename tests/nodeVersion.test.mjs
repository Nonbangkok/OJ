import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readText = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));

const dockerfiles = ['backend/Dockerfile', 'backend/authoring/Dockerfile', 'frontend/Dockerfile'];

test('.nvmrc pins Node 26', () => {
  assert.equal(readText('.nvmrc').trim(), '26');
});

test('package engines match .nvmrc', () => {
  for (const workspace of ['backend', 'frontend']) {
    assert.equal(readJson(`${workspace}/package.json`).engines.node, '26.x', `${workspace}/package.json`);
    assert.equal(
      readJson(`${workspace}/package-lock.json`).packages[''].engines.node,
      '26.x',
      `${workspace}/package-lock.json`,
    );
  }
});

test('Node base images match .nvmrc', () => {
  for (const file of dockerfiles) {
    const tags = [...readText(file).matchAll(/^FROM node:(\S+)/gm)].map((match) => match[1]);
    assert.ok(tags.length > 0, `${file} has a node base image`);
    for (const tag of tags) {
      assert.ok(tag.startsWith('26-'), `${file} uses node:${tag}`);
    }
  }
});

test('judge and runner build stages stay on bookworm', () => {
  assert.match(readText('backend/Dockerfile'), /^FROM node:26-bookworm-slim/m);
  assert.match(readText('backend/authoring/Dockerfile'), /^FROM node:26-bookworm-slim AS build/m);
});

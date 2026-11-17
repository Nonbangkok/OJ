import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readText = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

test('the built site is world-readable whatever umask the server checked the files out with', () => {
  // A file checked out under umask 077 is 0600; COPY keeps the mode and nginx then answers 403
  // (production served /favicon.svg as 403 while older public files were fine).
  const dockerfile = readText('frontend/Dockerfile');
  assert.match(dockerfile, /RUN npm run build && chmod -R a\+rX build\b/);
});

test('index.html describes the site for link previews instead of the create-react-app placeholder', () => {
  const html = readText('frontend/index.html');
  assert.doesNotMatch(html, /create-react-app/);
  assert.match(html, /<meta\s+name="description"\s+content="[^"]{20,}"/);
  assert.match(html, /<meta\s+property="og:title"\s+content="Grader"/);
  assert.match(html, /<meta\s+property="og:description"\s+content="[^"]{20,}"/);
  assert.match(html, /<meta\s+property="og:type"\s+content="website"/);
});

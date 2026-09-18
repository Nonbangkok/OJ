// Non-TypeScript resources are required by both the API preview and PDF worker.
const { cpSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
mkdirSync(path.join(root, 'dist', 'authoring'), { recursive: true });
cpSync(path.join(root, 'authoring', 'templates'), path.join(root, 'dist', 'authoring', 'templates'), { recursive: true });

// CSP guard: the reverse proxy serves `script-src 'self'` (no 'unsafe-inline'),
// so the built index.html must contain no inline <script> and no inline
// on<event>= handler attributes. Usage: node check-no-inline-scripts.mjs [file]
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'build/index.html';
const html = readFileSync(file, 'utf8');
const offenders = [];

for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
  if (!/\ssrc\s*=/i.test(m[0])) offenders.push(`inline <script>: ${m[0]}`);
}
for (const m of html.matchAll(/<[a-z][^>]*\son[a-z]+\s*=[^>]*>/gi)) {
  offenders.push(`inline event handler: ${m[0]}`);
}

if (offenders.length > 0) {
  console.error(`CSP check failed for ${file}:`);
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log(`CSP check passed for ${file}: no inline scripts or handlers.`);

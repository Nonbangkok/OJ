'use strict';

const katex = require('katex');
const { Parser } = require('htmlparser2');
const { StatementError } = require('./statementSanitizer');

const MAX_BYTES = 16 * 1024 * 1024;
const utf8Bytes = value => new TextEncoder().encode(value).length;
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function defaultRenderMath(tex, display) {
  return katex.renderToString(tex, {
    displayMode: display,
    strict: 'error',
    throwOnError: true,
    trust: () => { throw new Error('Untrusted math command'); },
    maxExpand: 1000,
    maxSize: 100,
  });
}

/** Renders TeX in text nodes only; callers may inject the backend's VM-bounded KaTeX function. */
function renderStatementMath(html, renderMath = defaultRenderMath) {
  const deadline = Date.now() + 1000;
  let count = 0;
  let bytes = 0;
  let pending = '';
  let skipped = 0;
  const result = [];
  const append = part => {
    bytes += utf8Bytes(part);
    if (bytes > MAX_BYTES) throw new StatementError('preview_too_large', 'Rendered preview exceeds 16 MiB');
    result.push(part);
  };
  const text = value => {
    if (skipped) { append(escapeHtml(value)); return; }
    let offset = 0;
    const opening = /\$\$|\\\[|\\\(|\$/g;
    for (let match; (match = opening.exec(value));) {
      const left = match[0];
      const right = left === '\\[' ? '\\]' : left === '\\(' ? '\\)' : left;
      const start = match.index + left.length;
      let end = start;
      let braces = 0;
      for (; end < value.length; end++) {
        if (braces <= 0 && value.startsWith(right, end)) break;
        if (value[end] === '\\') { end++; continue; }
        if (value[end] === '{') braces++;
        if (value[end] === '}') braces--;
      }
      if (end >= value.length) break;
      append(escapeHtml(value.slice(offset, match.index)));
      if (++count > 1000 || Date.now() >= deadline) {
        throw new StatementError('preview_too_large', 'Math preview exceeds its rendering budget');
      }
      try {
        const math = renderMath(value.slice(start, end), left === '$$' || left === '\\[' , deadline - Date.now());
        if (Date.now() >= deadline) throw new Error('Math rendering budget exceeded');
        append(math);
      } catch {
        throw new StatementError('invalid_math', 'Invalid, unsafe or overly complex LaTeX in statement');
      }
      offset = end + right.length;
      opening.lastIndex = offset;
    }
    append(escapeHtml(value.slice(offset)));
  };
  const flush = () => { if (pending) { text(pending); pending = ''; } };
  const parser = new Parser({
    onopentag(tag, attributes) {
      flush();
      append(`<${tag}${Object.entries(attributes).map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join('')}>`);
      if (tag === 'pre' || tag === 'code') skipped++;
    },
    ontext(value) { pending += value; },
    onclosetag(tag) {
      flush();
      if (!['br', 'hr', 'img'].includes(tag)) append(`</${tag}>`);
      if (tag === 'pre' || tag === 'code') skipped--;
    },
  }, { decodeEntities: true });
  parser.end(html);
  flush();
  return result.join('');
}

module.exports = { renderStatementMath };

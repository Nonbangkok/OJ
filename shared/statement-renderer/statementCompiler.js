'use strict';

const { marked } = require('marked');
const { sanitizeStatement, StatementError } = require('./statementSanitizer');

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const utf8Bytes = value => new TextEncoder().encode(value).length;
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function protectMath(source) {
  let prefix = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `OJMATHTOKEN${Math.random().toString(36).slice(2)}X`;
    if (!source.includes(candidate)) { prefix = candidate; break; }
  }
  if (!prefix) throw new StatementError('INVALID_STATEMENT', 'Could not reserve a math placeholder');
  const expressions = [];
  let markdown = '';
  let offset = 0;
  const opening = /\$\$|\\\[|\\\(|\$/g;
  for (let match; (match = opening.exec(source));) {
    const left = match[0];
    const right = left === '\\[' ? '\\]' : left === '\\(' ? '\\)' : left;
    const start = match.index + left.length;
    let end = start;
    let braces = 0;
    for (; end < source.length; end++) {
      if (braces <= 0 && source.startsWith(right, end)) break;
      if (source[end] === '\\') { end++; continue; }
      if (source[end] === '{') braces++;
      if (source[end] === '}') braces--;
    }
    if (end >= source.length) break;
    markdown += source.slice(offset, match.index);
    if (expressions.length >= 1000) {
      throw new StatementError('STATEMENT_TOO_LARGE', 'Statement contains too many math expressions');
    }
    const token = `${prefix}${expressions.length}END`;
    expressions.push(source.slice(match.index, end + right.length));
    markdown += token;
    offset = end + right.length;
    opening.lastIndex = offset;
  }
  markdown += source.slice(offset);
  return {
    markdown,
    restore(html) {
      return expressions.reduce((result, expression, index) =>
        result.replaceAll(`${prefix}${index}END`, () => escapeHtml(expression)), html);
    },
  };
}

function compileStatementSource(source, assetNames) {
  if (typeof source !== 'string' || source.includes('\0')) {
    throw new StatementError('INVALID_STATEMENT', 'Statement must be text without null bytes');
  }
  if (utf8Bytes(source) > MAX_SOURCE_BYTES) {
    throw new StatementError('STATEMENT_TOO_LARGE', 'Statement exceeds 2 MiB');
  }
  const protectedSource = protectMath(source);
  let rendered;
  try {
    rendered = marked.parse(protectedSource.markdown, {
      gfm: true, breaks: false, pedantic: false, smartLists: true, smartypants: false,
      headerIds: false, mangle: false,
    });
  } catch {
    throw new StatementError('INVALID_STATEMENT', 'Statement Markdown could not be parsed');
  }
  if (typeof rendered !== 'string') {
    throw new StatementError('INVALID_STATEMENT', 'Statement Markdown did not produce HTML');
  }
  const compatibleHtml = protectedSource.restore(rendered)
    .replaceAll(/%7B%7BASSET_BASE%7D%7D/gi, '{{ASSET_BASE}}')
    .replace(/<(\/?)image(?=[\s/>])/gi, '<$1img');
  return sanitizeStatement(compatibleHtml, assetNames);
}

module.exports = { compileStatementSource, protectMath };

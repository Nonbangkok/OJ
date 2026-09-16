import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createContext, Script, Context } from 'node:vm';
import path from 'node:path';
import { PDF_TEMPLATE_DIRECTORY } from './pdfTemplate';
import { sanitizeStatement, StatementError } from './statementSanitizer';

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
let markdownContext: Context | undefined;
const parseMarkdown = new Script(`require('marked').parse(statementSource, {
  gfm: true, breaks: false, pedantic: false, smartLists: true, smartypants: false,
  headerIds: false, mangle: false
})`);

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function protectMath(source: string): { markdown: string; restore(html: string): string } {
  let prefix = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = `OJMATHTOKEN${randomBytes(16).toString('hex')}X`;
    if (!source.includes(candidate)) { prefix = candidate; break; }
  }
  if (!prefix) throw new StatementError('INVALID_STATEMENT', 'Could not reserve a math placeholder');
  const expressions: string[] = [];
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
    restore(html: string) {
      return expressions.reduce((result, expression, index) =>
        result.replaceAll(`${prefix}${index}END`, () => escapeHtml(expression)), html);
    },
  };
}

function context(): Context {
  if (markdownContext) return markdownContext;
  markdownContext = createContext({});
  const bundle = readFileSync(path.join(PDF_TEMPLATE_DIRECTORY, 'vendor/bundle.js'), 'utf8');
  new Script(bundle).runInContext(markdownContext, { timeout: 1000 });
  return markdownContext;
}

/** Compile task-pdf-writer Markdown/raw HTML source into the canonical safe HTML fragment. */
export function compileStatementSource(source: string, assetNames: readonly string[]): string {
  if (typeof source !== 'string' || source.includes('\0')) {
    throw new StatementError('INVALID_STATEMENT', 'Statement must be text without null bytes');
  }
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    throw new StatementError('STATEMENT_TOO_LARGE', 'Statement exceeds 2 MiB');
  }
  const protectedSource = protectMath(source);
  const runtime = context();
  // The authoritative task-pdf-writer renderer passes non-math source to Marked unchanged.
  // Math is restored afterward so Marked cannot consume its delimiters or TeX backslashes.
  runtime.statementSource = protectedSource.markdown;
  let rendered: unknown;
  try {
    rendered = parseMarkdown.runInContext(runtime, { timeout: 1000 });
  } catch {
    throw new StatementError('INVALID_STATEMENT', 'Statement Markdown could not be parsed');
  } finally {
    runtime.statementSource = '';
  }
  if (typeof rendered !== 'string') {
    throw new StatementError('INVALID_STATEMENT', 'Statement Markdown did not produce HTML');
  }
  // Browsers historically treat <image> as <img>; htmlparser2 intentionally does not.
  // Normalize after Markdown parsing so examples inside fenced code remain literal text.
  const compatibleHtml = protectedSource.restore(rendered)
    .replaceAll(/%7B%7BASSET_BASE%7D%7D/gi, '{{ASSET_BASE}}')
    .replace(/<(\/?)image(?=[\s/>])/gi, '<$1img');
  return sanitizeStatement(compatibleHtml, assetNames);
}

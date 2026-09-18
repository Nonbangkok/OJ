import { Parser } from 'htmlparser2';
import { STATEMENT_ASSET } from '../constants';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_NODES = 100_000;
const MAX_DEPTH = 128;
const ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'b', 'strong', 'i', 'em', 'u', 's',
  'sub', 'sup', 'div', 'span', 'br', 'hr', 'ul', 'ol', 'li', 'table', 'thead',
  'tbody', 'tfoot', 'tr', 'td', 'th', 'pre', 'code', 'img', 'blockquote', 'del', 'a',
]);
const VOID_TAGS = new Set(['br', 'hr', 'img']);
const ALLOWED_CLASSES = new Set([
  'forced-page-break', 'sample-table', 'sample-table-short', 'geometry-data', 'input-spec',
]);
const DIMENSION_TAGS = new Set(['img', 'table', 'td', 'th']);
const STYLE_VALUES: Record<string, readonly string[]> = {
  'text-align': ['left', 'right', 'center', 'justify'],
  'vertical-align': ['top', 'middle', 'bottom', 'baseline'],
  'white-space': ['normal', 'pre', 'pre-wrap', 'pre-line', 'nowrap', 'break-spaces'],
  'page-break-after': ['always'],
  'border-collapse': ['collapse'],
  'background-color': ['transparent'],
  'border': ['0'],
  'margin': ['0'],
  'padding': ['0', '1', '5px'],
};

export class StatementError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'StatementError';
  }
}

function unsafe(message: string): never {
  throw new StatementError('UNSAFE_STATEMENT', message);
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function sanitizeStyle(tag: string, style: string): string {
  const declarations = new Map<string, string>();
  for (const declaration of style.split(';')) {
    if (!declaration.trim()) continue;
    // This parses only our tiny CSS value language, never general CSS syntax.
    const match = /^\s*([a-z-]+)\s*:\s*([a-z0-9.% -]+)\s*$/i.exec(declaration);
    if (!match) unsafe('Unsupported statement style');
    const property = match[1]!.toLowerCase();
    const value = match[2]!.trim().toLowerCase();
    if (declarations.has(property)) unsafe('Duplicate statement style');
    if ((property === 'width' || property === 'height') && DIMENSION_TAGS.has(tag)) {
      const dimension = /^(\d+(?:\.\d+)?)(px|%)$/.exec(value);
      const amount = dimension ? Number(dimension[1]) : NaN;
      if (!dimension || amount <= 0 || amount > (dimension[2] === '%' ? 100 : 10_000)) {
        unsafe('Unsupported statement dimension');
      }
    } else if (!Object.hasOwn(STYLE_VALUES, property) || !STYLE_VALUES[property]!.includes(value)) {
      unsafe('Unsupported statement style');
    }
    declarations.set(property, value);
  }
  return [...declarations].sort(([a], [b]) => a.localeCompare(b))
    .map(([property, value]) => `${property}: ${value}`).join('; ');
}

function sanitizeAttribute(tag: string, name: string, value: string, assets: ReadonlySet<string>): string {
  if (name === 'title' || (tag === 'img' && name === 'alt')) return value;
  if (tag === 'a' && name === 'href') {
    if (value.length > 2048) unsafe('Unsupported statement link');
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
        unsafe('Unsupported statement link');
      }
    } catch (error) {
      if (error instanceof StatementError) throw error;
      unsafe('Unsupported statement link');
    }
    return value;
  }
  if (name === 'class') {
    const classes = value.trim().split(/\s+/).filter(Boolean);
    if (classes.some(className => !ALLOWED_CLASSES.has(className)
      && !(tag === 'code' && /^language-[A-Za-z0-9_+-]{1,32}$/.test(className)))) {
      unsafe('Unsupported statement class');
    }
    return [...new Set(classes)].sort().join(' ');
  }
  if (name === 'style') return sanitizeStyle(tag, value);
  if (tag === 'img' && name === 'src') {
    const prefix = '{{ASSET_BASE}}/';
    const filename = value.startsWith(prefix) ? value.slice(prefix.length) : '';
    if (filename.length > STATEMENT_ASSET.MAX_FILENAME_LENGTH
      || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)
      || filename.includes('..') || !assets.has(filename)) {
      throw new StatementError('INVALID_STATEMENT_ASSET', 'Image must reference a declared statement asset');
    }
    return value;
  }
  if (tag === 'table' && (name === 'cellspacing' || name === 'cellpadding') && value === '0') return value;
  if (tag === 'tr' && name === 'align' && value.toLowerCase() === 'center') return 'center';
  if (DIMENSION_TAGS.has(tag) && (name === 'width' || name === 'height')) {
    const percent = name === 'width' ? /^([1-9][0-9]?)%$|^(100)%$/.exec(value) : null;
    if (!percent && (!/^[1-9][0-9]{0,4}$/.test(value) || Number(value) > 10_000)) {
      unsafe('Unsupported statement dimension');
    }
    return value;
  }
  if ((tag === 'td' || tag === 'th') && (name === 'colspan' || name === 'rowspan')) {
    if (!/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > 100) unsafe('Unsupported table span');
    return value;
  }
  unsafe(`Unsupported statement attribute: ${name}`);
}

/** Rejects unsafe HTML and emits a bounded, canonical statement fragment. */
export function sanitizeStatement(html: string, assetNames: readonly string[]): string {
  if (typeof html !== 'string' || html.includes('\0')) {
    throw new StatementError('INVALID_STATEMENT', 'Statement must be HTML text without null bytes');
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_BYTES) {
    throw new StatementError('STATEMENT_TOO_LARGE', 'Statement exceeds 2 MiB');
  }
  const assets = new Set(assetNames);
  const output: string[] = [];
  let outputBytes = 0;
  let nodes = 0;
  let depth = 0;
  let inText = false;
  let pendingTag: string | undefined;
  let attributes = new Map<string, string>();
  const countNode = () => {
    if (++nodes > MAX_NODES) throw new StatementError('STATEMENT_TOO_LARGE', 'Statement has too many nodes');
  };
  const append = (text: string) => {
    outputBytes += Buffer.byteLength(text, 'utf8');
    if (outputBytes > MAX_BYTES) throw new StatementError('STATEMENT_TOO_LARGE', 'Sanitized statement exceeds 2 MiB');
    output.push(text);
  };
  // Streaming callbacks avoid constructing or recursively serializing an unbounded DOM.
  const parser = new Parser({
    onopentagname(tag) {
      if (!ALLOWED_TAGS.has(tag)) unsafe(`Unsupported statement element: ${tag}`);
      countNode();
      if (depth + 1 > MAX_DEPTH) throw new StatementError('STATEMENT_TOO_LARGE', 'Statement nesting exceeds 128 levels');
      pendingTag = tag;
      attributes = new Map();
      inText = false;
    },
    onattribute(name, value) {
      if (attributes.has(name)) unsafe('Duplicate statement attribute');
      attributes.set(name, sanitizeAttribute(pendingTag!, name, value, assets));
    },
    onopentag(tag) {
      if (tag === 'img' && !attributes.has('src')) {
        throw new StatementError('INVALID_STATEMENT_ASSET', 'Image must reference a declared statement asset');
      }
      append(`<${tag}${[...attributes].sort(([a], [b]) => a.localeCompare(b))
        .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('')}>`);
      if (!VOID_TAGS.has(tag)) depth++;
      pendingTag = undefined;
    },
    onclosetag(tag) {
      if (pendingTag) throw new StatementError('INVALID_STATEMENT', 'Incomplete statement element');
      if (!VOID_TAGS.has(tag)) {
        append(`</${tag}>`);
        depth--;
      }
      inText = false;
    },
    ontext(text) {
      if (!inText) countNode();
      inText = true;
      append(escapeText(text));
    },
    oncomment() {
      countNode();
      inText = false;
    },
    onprocessinginstruction() { unsafe('Statement declarations are not supported'); },
    onerror() { throw new StatementError('INVALID_STATEMENT', 'Malformed statement HTML'); },
  }, { xmlMode: false, decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.end(html);
  if (pendingTag) throw new StatementError('INVALID_STATEMENT', 'Incomplete statement element');
  return output.join('');
}

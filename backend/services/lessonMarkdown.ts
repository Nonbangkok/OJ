import { compileStatementSource, renderStatementMath, StatementError } from '@oj/statement-renderer';
import { LESSON_LIMITS, LESSON_PROBLEM_ID_PATTERN } from '../constants/lessons';

/**
 * Lesson Markdown → stored HTML (spec §4, D3/D4).
 *
 * The body goes through the same compiler + sanitizer as problem statements
 * (`@oj/statement-renderer`), which throws on anything it does not allow, so
 * an unsafe lesson fails the import instead of being silently altered.
 *
 * Lesson directives are not Markdown: before compiling, each directive line is
 * replaced by a random placeholder paragraph, and after sanitizing, each
 * placeholder is swapped for fixed markup this module writes itself. Author
 * text never reaches an attribute except a problem id (checked against
 * LESSON_PROBLEM_ID_PATTERN) and titles (HTML-escaped), so the sanitizer stays
 * the boundary for everything the author wrote.
 *
 *   :::hint [title]          … :::   <details data-lesson="hint">
 *   :::solution [problemId]  … :::   <details data-lesson="solution">
 *   :::note [title]          … :::   <aside data-lesson="callout" data-tone="note">
 *   :::warning [title]       … :::   <aside data-lesson="callout" data-tone="warning">
 *   :::tabs                  … :::   <div data-lesson="code-tabs">  (fenced code blocks inside)
 *   :::problem <problemId>           <div data-lesson="problem" data-problem="…"></div>
 *
 * Images are written as `![alt](assets/name.png)` and must be declared assets
 * of the lesson; the stored HTML keeps the `{{ASSET_BASE}}/name` placeholder
 * that the client resolves to the lesson's asset route.
 */

export class LessonContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LessonContentError';
  }
}

export interface LessonTocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface RenderedLesson {
  html: string;
  toc: LessonTocEntry[];
  /** Problem ids named by :::problem / :::solution, in order of appearance. */
  problemRefs: string[];
}

type DirectiveKind = 'hint' | 'solution' | 'note' | 'warning' | 'tabs' | 'problem';

const OPEN_DIRECTIVE = /^:::(hint|solution|note|warning|tabs|problem)(?:[ \t]+(.*?))?[ \t]*$/;
const CLOSE_DIRECTIVE = /^:::[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MAX_DIRECTIVE_TITLE = 120;

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const decodeEntities = (value: string): string => value
  .replace(/&#0*39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

function reservePrefix(source: string): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `OJLESSONTOKEN${Math.random().toString(36).slice(2)}N`;
    if (!source.includes(candidate)) return candidate;
  }
  throw new LessonContentError('Could not reserve a directive placeholder');
}

function checkProblemId(value: string | undefined, line: number, required: boolean): string | undefined {
  if (!value) {
    if (required) throw new LessonContentError(`Line ${line}: :::problem needs a problem id`);
    return undefined;
  }
  if (!LESSON_PROBLEM_ID_PATTERN.test(value)) {
    throw new LessonContentError(`Line ${line}: "${value}" is not a valid problem id`);
  }
  return value;
}

function checkTitle(value: string | undefined, line: number): string | undefined {
  if (!value) return undefined;
  if (value.length > MAX_DIRECTIVE_TITLE) {
    throw new LessonContentError(`Line ${line}: directive title is longer than ${MAX_DIRECTIVE_TITLE} characters`);
  }
  return value;
}

interface Preprocessed {
  markdown: string;
  replacements: Map<string, string>;
  problemRefs: string[];
}

function preprocess(source: string): Preprocessed {
  const prefix = reservePrefix(source);
  const replacements = new Map<string, string>();
  const problemRefs: string[] = [];
  const stack: Array<{ kind: DirectiveKind; line: number }> = [];
  const out: string[] = [];
  let fence: string | null = null;
  let counter = 0;

  const placeholder = (html: string): void => {
    const token = `${prefix}${counter}X`;
    counter += 1;
    replacements.set(token, html);
    out.push('', token, '');
  };

  const lines = source.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const fenceMatch = FENCE.exec(raw);
    if (fence !== null) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length
        && raw.trim() === fenceMatch[1]) {
        fence = null;
      }
      out.push(raw);
      return;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      out.push(raw);
      return;
    }
    if (!raw.startsWith(':::') && raw.trimStart().startsWith(':::')) {
      throw new LessonContentError(`Line ${lineNo}: a directive must start at the beginning of a line`);
    }
    if (!raw.startsWith(':::')) {
      // Author-facing image shorthand: ](assets/name) → declared statement asset.
      out.push(raw.replaceAll('](assets/', ']({{ASSET_BASE}}/'));
      return;
    }

    if (CLOSE_DIRECTIVE.test(raw)) {
      const open = stack.pop();
      if (!open) throw new LessonContentError(`Line ${lineNo}: ::: closes nothing`);
      placeholder(open.kind === 'hint' || open.kind === 'solution' ? '</div></details>'
        : open.kind === 'tabs' ? '</div>' : '</aside>');
      return;
    }

    const match = OPEN_DIRECTIVE.exec(raw);
    if (!match) throw new LessonContentError(`Line ${lineNo}: unknown directive "${raw.trim().slice(0, 40)}"`);
    const kind = match[1] as DirectiveKind;
    const argument = match[2]?.trim() || undefined;

    if (kind === 'problem') {
      const id = checkProblemId(argument, lineNo, true)!;
      problemRefs.push(id);
      placeholder(`<div data-lesson="problem" data-problem="${id}"></div>`);
      return;
    }
    if (stack.length >= LESSON_LIMITS.MAX_DIRECTIVE_DEPTH) {
      throw new LessonContentError(`Line ${lineNo}: directives nest deeper than ${LESSON_LIMITS.MAX_DIRECTIVE_DEPTH}`);
    }
    stack.push({ kind, line: lineNo });
    switch (kind) {
      case 'hint': {
        const title = checkTitle(argument, lineNo) ?? 'Hint';
        placeholder(`<details data-lesson="hint"><summary>${escapeHtml(title)}</summary><div data-lesson="body">`);
        break;
      }
      case 'solution': {
        const id = checkProblemId(argument, lineNo, false);
        if (id) problemRefs.push(id);
        placeholder(`<details data-lesson="solution"${id ? ` data-problem="${id}"` : ''}>`
          + '<summary>Solution</summary><div data-lesson="body">');
        break;
      }
      case 'tabs':
        if (argument) throw new LessonContentError(`Line ${lineNo}: :::tabs takes no argument`);
        placeholder('<div data-lesson="code-tabs">');
        break;
      default: {
        const title = checkTitle(argument, lineNo);
        placeholder(`<aside data-lesson="callout" data-tone="${kind}">`
          + (title ? `<p data-lesson="callout-title">${escapeHtml(title)}</p>` : ''));
      }
    }
  });

  if (fence !== null) throw new LessonContentError('A fenced code block is not closed');
  const unclosed = stack.pop();
  if (unclosed) throw new LessonContentError(`Line ${unclosed.line}: :::${unclosed.kind} is not closed`);
  return { markdown: out.join('\n'), replacements, problemRefs };
}

function addHeadingIds(html: string): { html: string; toc: LessonTocEntry[] } {
  const toc: LessonTocEntry[] = [];
  const withIds = html.replace(/<h([23])((?:\s[^>]*)?)>([\s\S]*?)<\/h\1>/g, (_whole, level: string, attributes: string, inner: string) => {
    const id = `section-${toc.length + 1}`;
    const text = decodeEntities(inner
      .replace(/<annotation[\s\S]*?<\/annotation>/g, '')
      .replace(/<span class="katex-mathml">[\s\S]*?<\/span><\/span>/g, '')
      .replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ').trim();
    toc.push({ id, text, level: Number(level) as 2 | 3 });
    return `<h${level} id="${id}"${attributes}>${inner}</h${level}>`;
  });
  return { html: withIds, toc };
}

/** Render one lesson body. Throws LessonContentError with an author-facing message. */
export function renderLessonMarkdown(source: string, assetNames: readonly string[]): RenderedLesson {
  if (typeof source !== 'string' || source.includes('\0')) {
    throw new LessonContentError('Lesson must be text without null bytes');
  }
  if (Buffer.byteLength(source, 'utf8') > LESSON_LIMITS.MAX_MARKDOWN_BYTES) {
    throw new LessonContentError(`Lesson exceeds ${LESSON_LIMITS.MAX_MARKDOWN_BYTES} bytes`);
  }
  const { markdown, replacements, problemRefs } = preprocess(source);

  let html: string;
  try {
    html = compileStatementSource(markdown, assetNames);
  } catch (error) {
    if (error instanceof StatementError) throw new LessonContentError(error.message);
    throw error;
  }

  for (const [token, markup] of replacements) {
    const paragraph = new RegExp(`<p>\\s*${token}\\s*</p>`);
    if (!paragraph.test(html)) {
      throw new LessonContentError('A directive must start at the beginning of a line outside lists, quotes and tables');
    }
    html = html.replace(paragraph, () => markup);
  }

  try {
    html = renderStatementMath(html);
  } catch (error) {
    if (error instanceof StatementError) throw new LessonContentError(error.message);
    throw error;
  }

  const withToc = addHeadingIds(html);
  return { html: withToc.html, toc: withToc.toc, problemRefs };
}

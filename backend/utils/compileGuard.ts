/**
 * Pre-compile source guards.
 *
 * Both guards run on the preprocessing tokens a real lexer produces (line
 * splices, `//` and `/* *\/` comments, string / character / raw-string
 * literals, header names and the `%:` digraphs are handled the way GCC
 * handles them), so a comment between `#` and `include`, a backslash-newline
 * inside a keyword or an escape sequence inside a string cannot hide what the
 * compiler will see.
 *
 * - {@link findForbiddenInclude} protects EVERY submission: it rejects
 *   absolute or traversing paths in the include family (`#include`,
 *   `#include_next`, `#import`, `#embed`, `__has_include`) and in macro bodies
 *   a computed include could use (RUNNER-001). The unprivileged compile (uid
 *   drop in submissionService) bounds what is left.
 * - {@link findHeaderSourceRejection} applies only to header problems, whose
 *   submission is compiled in the same translation unit as the problem's
 *   SECRET grader sources. It is defence in depth: the structural boundary is
 *   the two-step build (see HEADER_CPP_PREPARE), which deletes every grader
 *   file before the assembler runs. Its messages quote only the submission's
 *   own text, never grader content.
 */

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

type TokenKind = 'identifier' | 'number' | 'string' | 'char' | 'header-name' | 'punctuator' | 'other';

interface PpToken {
  kind: TokenKind;
  /** Spelling after line splicing; digraph punctuators carry their primary spelling. */
  text: string;
  /**
   * String literals: the body with escape sequences decoded (raw strings
   * verbatim). Header names: the name between the delimiters.
   */
  value?: string;
  /** 1-based physical line of the token's first character. */
  line: number;
  /** Whitespace or a comment separates this token from the previous one on its logical line. */
  spaceBefore: boolean;
}

interface LogicalLine {
  tokens: PpToken[];
  /** Directive name of a `#` line (`''` for a null or non-identifier directive), null for a text line. */
  directive: string | null;
}

type LexProblemKind = 'stray-backslash' | 'raw-string-splice' | 'bad-raw-string' | 'ambiguous-suffix' | 'unsupported-escape';

interface LexProblem {
  kind: LexProblemKind;
  line: number;
}

interface LexResult {
  lines: LogicalLine[];
  /** Constructs GCC accepts but a guard cannot read unambiguously (header problems reject them). */
  problems: LexProblem[];
}

/** Directives whose operand is lexed as a header name (`<...>` / `"..."`). */
const HEADER_NAME_DIRECTIVES = new Set(['include', 'include_next', 'import', 'embed']);
/** Operators whose parenthesised operand is lexed as a header name. */
const HAS_INCLUDE_OPERATORS = new Set(['__has_include', '__has_include_next', '__has_embed']);
const STRING_PREFIXES = new Set(['u8', 'u', 'U', 'L']);
const RAW_STRING_PREFIXES = new Set(['R', 'u8R', 'uR', 'UR', 'LR']);
const MAX_RAW_DELIMITER = 16;
/** Two-character digraphs other than `%:` / `<:` (handled with their special cases). */
const DIGRAPHS = new Map<string, string>([[':>', ']'], ['<%', '{'], ['%>', '}']]);

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isIdentStart = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$' || c.charCodeAt(0) >= 0x80);
const isIdentChar = (c: string | undefined): boolean => isIdentStart(c) || isDigit(c);
const isHorizontalSpace = (c: string | undefined): boolean =>
  c === ' ' || c === '\t' || c === '\f' || c === '\v' || c === '\0';
const isHexDigit = (c: string | undefined): boolean => c !== undefined && /^[0-9A-Fa-f]$/.test(c);

/**
 * Translation phases 1-2: CRLF, CR and LF all end a line (GCC treats a lone
 * CR as a newline), and a backslash followed by optional horizontal
 * whitespace and a newline is removed. Returns the spliced text, the physical
 * line of each character, and where splices happened (GCC reverts them
 * inside raw string literals).
 */
function spliceLines(source: string): { text: string; lineAt: number[]; splices: number[] } {
  const chars: string[] = [];
  const lineAt: number[] = [];
  const splices: number[] = [];
  let line = 1;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      let j = i + 1;
      while (isHorizontalSpace(source[j]) && source[j] !== '\0') j += 1;
      if (source[j] === '\n' || source[j] === '\r') {
        j += source[j] === '\r' && source[j + 1] === '\n' ? 2 : 1;
        splices.push(chars.length);
        line += 1;
        i = j;
        continue;
      }
    }
    if (c === '\r' || c === '\n') {
      chars.push('\n');
      lineAt.push(line);
      i += c === '\r' && source[i + 1] === '\n' ? 2 : 1;
      line += 1;
      continue;
    }
    chars.push(c);
    lineAt.push(line);
    i += 1;
  }
  return { text: chars.join(''), lineAt, splices };
}

const SIMPLE_ESCAPES = new Map<string, string>([
  ['n', '\n'], ['t', '\t'], ['v', '\v'], ['b', '\b'], ['r', '\r'], ['f', '\f'], ['a', '\x07'],
  ['e', '\x1b'], ['E', '\x1b'], ['\\', '\\'], ['?', '?'], ["'", "'"], ['"', '"'],
]);

/**
 * Decode the escape sequences of a narrow string literal body. `exotic` flags
 * the C++23 / GNU forms (`\N{...}`, `\o{...}`, `\x{...}`, `\u{...}`) whose
 * value this decoder does not compute.
 */
function decodeEscapes(body: string): { value: string; exotic: boolean } {
  let value = '';
  let exotic = false;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c !== '\\') {
      value += c;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) break;
    const simpleValue = SIMPLE_ESCAPES.get(next);
    if (simpleValue !== undefined) {
      value += simpleValue;
      i += 1;
    } else if (next >= '0' && next <= '7') {
      let digits = '';
      while (digits.length < 3 && body[i + 1] !== undefined && body[i + 1] >= '0' && body[i + 1] <= '7') {
        digits += body[i + 1];
        i += 1;
      }
      // GCC masks an out-of-range narrow escape to the char width (and warns).
      value += String.fromCharCode(parseInt(digits, 8) & 0xff);
    } else if ((next === 'x' || next === 'u' || next === 'U' || next === 'o' || next === 'N') && body[i + 2] === '{') {
      exotic = true;
      const close = body.indexOf('}', i + 3);
      i = close === -1 ? body.length : close;
    } else if (next === 'x') {
      let digits = '';
      i += 1;
      while (isHexDigit(body[i + 1])) {
        digits += body[i + 1];
        i += 1;
      }
      // Hex escapes are greedy (`\x63b` is one escape); GCC masks the value.
      if (digits) value += String.fromCharCode(parseInt(digits.slice(-2), 16));
    } else if (next === 'u' || next === 'U') {
      const width = next === 'u' ? 4 : 8;
      const digits = body.slice(i + 2, i + 2 + width);
      if (digits.length === width && [...digits].every(isHexDigit)) {
        const codePoint = parseInt(digits, 16);
        value += codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
        i += 1 + width;
      } else {
        i += 1;
      }
    } else {
      // Unknown escape: GCC warns and keeps the character.
      value += next;
      i += 1;
    }
  }
  return { value, exotic };
}

/** Lex C++ source into logical lines of preprocessing tokens, the way GCC's preprocessor does. */
function lexPreprocessingTokens(source: string): LexResult {
  const { text, lineAt, splices } = spliceLines(source);
  const n = text.length;
  const lines: LogicalLine[] = [];
  const problems: LexProblem[] = [];
  let tokens: PpToken[] = [];
  let spaceBefore = false;
  let headerNameNext = false;
  let afterHasInclude = false;

  const lineOf = (index: number): number => lineAt[Math.min(index, lineAt.length - 1)] ?? 1;

  /** A splice strictly inside (start, stop): binary search, `splices` is ascending. */
  const hasSpliceBetween = (start: number, stop: number): boolean => {
    let lo = 0;
    let hi = splices.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (splices[mid] <= start) lo = mid + 1;
      else hi = mid;
    }
    return lo < splices.length && splices[lo] < stop;
  };

  const push = (kind: TokenKind, start: number, end: number, spelling?: string, value?: string): void => {
    const token: PpToken = { kind, text: spelling ?? text.slice(start, end), line: lineOf(start), spaceBefore };
    if (value !== undefined) token.value = value;
    tokens.push(token);
    spaceBefore = false;
    // A header name follows `#include`-family directive names and `__has_include(`.
    if (afterHasInclude && kind === 'punctuator' && token.text === '(') {
      headerNameNext = true;
    }
    afterHasInclude = kind === 'identifier' && HAS_INCLUDE_OPERATORS.has(token.text);
    if (
      kind === 'identifier' && tokens.length === 2 && tokens[0].kind === 'punctuator' && tokens[0].text === '#'
      && HEADER_NAME_DIRECTIVES.has(token.text)
    ) {
      headerNameNext = true;
    }
  };

  const finishLine = (): void => {
    const first = tokens[0];
    let directive: string | null = null;
    if (first && first.kind === 'punctuator' && first.text === '#') {
      directive = tokens[1]?.kind === 'identifier' ? tokens[1].text : '';
    }
    lines.push({ tokens, directive });
    tokens = [];
    spaceBefore = false;
    headerNameNext = false;
    afterHasInclude = false;
  };

  /** A literal followed by a prefix word and a quote: GCC reads the word as a ud-suffix unless it is a macro. */
  const checkSuffix = (end: number): void => {
    if (!isIdentStart(text[end])) return;
    let m = end;
    while (isIdentChar(text[m])) m += 1;
    const word = text.slice(end, m);
    if ((text[m] === '"' || text[m] === "'") && (STRING_PREFIXES.has(word) || RAW_STRING_PREFIXES.has(word))) {
      problems.push({ kind: 'ambiguous-suffix', line: lineOf(end) });
    }
  };

  // Positions from which a scan for the closing `"` / `'` is known to run
  // off the end of its line. Lexing resumes right after an unterminated
  // quote, so without this a line like `"\"\"\"...` would be rescanned once
  // per quote (quadratic); with it every position is scanned at most once
  // per quote character.
  const deadEnds: Record<string, Uint8Array> = { '"': new Uint8Array(n + 1), "'": new Uint8Array(n + 1) };

  const lexQuoted = (start: number, quotePos: number): number => {
    const quote = text[quotePos];
    const dead = deadEnds[quote];
    const visited: number[] = [];
    let j = quotePos + 1;
    while (j < n && text[j] !== quote && text[j] !== '\n' && dead[j] === 0) {
      visited.push(j);
      j += text[j] === '\\' ? 2 : 1;
    }
    if (j >= n || text[j] !== quote || dead[j] === 1) {
      for (const position of visited) dead[position] = 1;
      // Unterminated: GCC reports an error. Keep lexing after the quote, so
      // the rest of the line is still inspected as code.
      push('other', start, quotePos + 1);
      return quotePos + 1;
    }
    if (quote === '"') {
      const decoded = decodeEscapes(text.slice(quotePos + 1, j));
      if (decoded.exotic) problems.push({ kind: 'unsupported-escape', line: lineOf(start) });
      push('string', start, j + 1, undefined, decoded.value);
    } else {
      push('char', start, j + 1);
    }
    checkSuffix(j + 1);
    return j + 1;
  };

  const lexRawString = (start: number, quotePos: number): number => {
    let j = quotePos + 1;
    while (j < n && j - quotePos - 1 <= MAX_RAW_DELIMITER) {
      const d = text[j];
      if (d === '(' || d === ' ' || d === ')' || d === '\\' || d === '\t' || d === '\v' || d === '\f' || d === '\n') break;
      j += 1;
    }
    const delimiter = text.slice(quotePos + 1, j);
    if (text[j] !== '(' || delimiter.length > MAX_RAW_DELIMITER) {
      problems.push({ kind: 'bad-raw-string', line: lineOf(start) });
      push('identifier', start, quotePos);
      return quotePos;
    }
    const terminator = `)${delimiter}"`;
    const close = text.indexOf(terminator, j + 1);
    const stop = close === -1 ? n : close + terminator.length;
    if (close === -1) problems.push({ kind: 'bad-raw-string', line: lineOf(start) });
    if (hasSpliceBetween(start, stop)) {
      problems.push({ kind: 'raw-string-splice', line: lineOf(start) });
    }
    push('string', start, stop, undefined, text.slice(j + 1, close === -1 ? n : close));
    checkSuffix(stop);
    return stop;
  };

  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '\n') {
      finishLine();
      i += 1;
      continue;
    }
    if (isHorizontalSpace(c)) {
      spaceBefore = true;
      i += 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      spaceBefore = true;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i + 2);
      i = end === -1 ? n : end;
      spaceBefore = true;
      continue;
    }

    const wantHeaderName = headerNameNext;
    headerNameNext = false;
    if (wantHeaderName && (c === '<' || c === '"')) {
      const close = c === '<' ? '>' : '"';
      let j = i + 1;
      while (j < n && text[j] !== close && text[j] !== '\n') j += 1;
      if (text[j] === close) {
        push('header-name', i, j + 1, undefined, text.slice(i + 1, j));
        i = j + 1;
        continue;
      }
    }

    if (isIdentStart(c)) {
      let j = i + 1;
      while (isIdentChar(text[j])) j += 1;
      const word = text.slice(i, j);
      if (text[j] === '"' && RAW_STRING_PREFIXES.has(word)) {
        i = lexRawString(i, j);
        continue;
      }
      if ((text[j] === '"' || text[j] === "'") && STRING_PREFIXES.has(word)) {
        i = lexQuoted(i, j);
        continue;
      }
      push('identifier', i, j);
      i = j;
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(text[i + 1]))) {
      let j = i + 1;
      while (j < n) {
        const d = text[j];
        if ((d === '+' || d === '-') && 'eEpP'.includes(text[j - 1])) j += 1;
        else if (d === "'" && isIdentChar(text[j + 1])) j += 2;
        else if (isIdentChar(d) || d === '.') j += 1;
        else break;
      }
      push('number', i, j);
      i = j;
      continue;
    }

    if (c === '"' || c === "'") {
      i = lexQuoted(i, i);
      continue;
    }

    // Punctuators. Only the ones the guards look at get their own token
    // (`#`, `##` and the digraphs); every other operator character is lexed
    // as a one-character punctuator, which is enough here.
    if (c === '%' && text[i + 1] === ':') {
      if (text[i + 2] === '%' && text[i + 3] === ':') {
        push('punctuator', i, i + 4, '##');
        i += 4;
      } else {
        push('punctuator', i, i + 2, '#');
        i += 2;
      }
      continue;
    }
    if (c === '#') {
      const paste = text[i + 1] === '#';
      push('punctuator', i, i + (paste ? 2 : 1), paste ? '##' : '#');
      i += paste ? 2 : 1;
      continue;
    }
    if (c === '<' && text[i + 1] === ':') {
      // `<::` not followed by `:` or `>` is `<` `::` (C++11 rule).
      if (text[i + 2] === ':' && text[i + 3] !== ':' && text[i + 3] !== '>') {
        push('punctuator', i, i + 1);
        i += 1;
      } else {
        push('punctuator', i, i + 2, '[');
        i += 2;
      }
      continue;
    }
    if (c === ':' && text[i + 1] === ':') {
      push('punctuator', i, i + 2);
      i += 2;
      continue;
    }
    const digraph = DIGRAPHS.get(text.slice(i, i + 2));
    if (digraph !== undefined) {
      push('punctuator', i, i + 2, digraph);
      i += 2;
      continue;
    }
    if (c === '.' && text[i + 1] === '.' && text[i + 2] === '.') {
      push('punctuator', i, i + 3);
      i += 3;
      continue;
    }
    if (c === '\\') {
      // Outside a literal a backslash can only start a universal character
      // name inside an identifier (or be a stray character g++ rejects).
      problems.push({ kind: 'stray-backslash', line: lineOf(i) });
      push('other', i, i + 1);
      i += 1;
      continue;
    }
    push(/[!%&()*+,\-./:;<=>?[\]^{|}~]/.test(c) ? 'punctuator' : 'other', i, i + 1);
    i += 1;
  }
  if (tokens.length > 0) finishLine();
  return { lines, problems };
}

/** Space-joined spelling of a token run, for messages and path checks. */
function spell(tokens: readonly PpToken[]): string {
  return tokens.map((t, index) => (index > 0 && t.spaceBefore ? ` ${t.text}` : t.text)).join('');
}

// ---------------------------------------------------------------------------
// Include guard (every submission)
// ---------------------------------------------------------------------------

const INCLUDE_DIRECTIVES = new Set(['include', 'include_next', 'import']);

/** Absolute or traversing (the historical rule: any `..` at all). */
function isUnsafeIncludePath(target: string): boolean {
  const trimmed = target.trim();
  return trimmed.startsWith('/') || trimmed.includes('..');
}

/** `#include <x` / `#include "x` with no closing delimiter: g++ reports it itself. */
const isUnterminatedHeaderName = (token: PpToken): boolean =>
  (token.kind === 'punctuator' && token.text === '<') || (token.kind === 'other' && token.text.endsWith('"'));

/** A `..` path segment (`../x`, `a/..`, `..`), unlike an ellipsis in prose ("Loading..."). */
const hasTraversalSegment = (target: string): boolean => /(^|\/)\.\.(\/|$)/.test(target);

/** Tokens of a `#define` line after the macro name and its parameter list. */
function macroBody(line: LogicalLine): PpToken[] {
  const tokens = line.tokens;
  let index = 3;
  if (tokens[3]?.kind === 'punctuator' && tokens[3].text === '(' && !tokens[3].spaceBefore) {
    while (index < tokens.length && !(tokens[index].kind === 'punctuator' && tokens[index].text === ')')) index += 1;
    index += 1;
  }
  return tokens.slice(index);
}

const isPunctuator = (token: PpToken, text: string): boolean => token.kind === 'punctuator' && token.text === text;

/**
 * The `<` ... `>` spans of one group: the tokens `first..end` hold a `>` at
 * `end` and no `>` before it, so EVERY `<` in the group ends its span at
 * `end` and each span is a suffix of the first one. A computed include takes
 * the tokens from a `<` to the first `>` after it, with whitespace dropped,
 * and any `<` could be where the expansion starts. Returns the first span
 * that is absolute or traversing, in time linear in the group.
 */
function pathInAngleGroup(body: readonly PpToken[], first: number, end: number): string | null {
  // `compact` is the first span; `offsets[k]` is where token k starts in it.
  const offsets: number[] = [];
  let compact = '';
  for (let k = first + 1; k < end; k += 1) {
    offsets[k] = compact.length;
    compact += body[k].text.replace(/\s+/g, '');
  }
  offsets[end] = compact.length;
  const isSegmentAt = (p: number): boolean =>
    compact.startsWith('..', p) && (p + 2 === compact.length || compact[p + 2] === '/');
  // The last `..` segment preceded by a `/`: it lies inside every span starting before it.
  let lastInnerSegment = -1;
  for (let p = compact.indexOf('/..'); p !== -1; p = compact.indexOf('/..', p + 1)) {
    if (isSegmentAt(p + 1)) lastInnerSegment = p + 1;
  }
  for (let k = first; k < end; k += 1) {
    if (!isPunctuator(body[k], '<')) continue;
    const start = offsets[k + 1];
    if (compact[start] === '/' || isSegmentAt(start) || lastInnerSegment > start) return compact.slice(start);
  }
  return null;
}

/** Path-like spellings in a macro body a computed `#include E` could expand to. */
function forbiddenPathInMacroBody(body: readonly PpToken[]): string | null {
  // Every string literal, plus their concatenation ("/proc/" "self/environ").
  const literals = body.filter((t) => t.kind === 'string').map((t) => t.value ?? '');
  for (const candidate of [literals.join(''), ...literals]) {
    const trimmed = candidate.trim();
    if (trimmed.startsWith('/') || hasTraversalSegment(trimmed)) return trimmed;
  }
  // `<` ... `>` spans: `#define E </etc/passwd>` + `#include E`. Grouped by
  // their closing `>`, so a body of thousands of `<` stays linear.
  let groupStart = -1;
  for (let k = 0; k < body.length; k += 1) {
    if (groupStart === -1 && isPunctuator(body[k], '<')) {
      groupStart = k;
    } else if (groupStart !== -1 && isPunctuator(body[k], '>')) {
      const hit = pathInAngleGroup(body, groupStart, k);
      if (hit !== null) return hit;
      groupStart = -1;
    }
  }
  return null;
}

function forbiddenIncludeInLine(line: LogicalLine): string | null {
  const directive = line.directive;
  if (directive !== null && (INCLUDE_DIRECTIVES.has(directive) || directive === 'embed')) {
    const operand = line.tokens[2];
    if (operand?.kind === 'header-name') {
      if (isUnsafeIncludePath(operand.value ?? '')) return (operand.value ?? '').trim();
    } else if (operand && operand.kind !== 'identifier' && !isUnterminatedHeaderName(operand)) {
      // Not a header name and not a macro name: operator junk or a path
      // fragment. Reject rather than guess what it expands to.
      return spell(line.tokens.slice(2));
    }
    // A macro include (`#include E`): path-like macro bodies are caught on
    // their own #define line below.
  }
  if (directive === 'define') {
    const hit = forbiddenPathInMacroBody(macroBody(line));
    if (hit !== null) return hit;
  }
  const tokens = line.tokens;
  for (let k = 0; k + 2 < tokens.length; k += 1) {
    if (
      tokens[k].kind === 'identifier' && HAS_INCLUDE_OPERATORS.has(tokens[k].text)
      && tokens[k + 1].text === '(' && tokens[k + 2].kind === 'header-name'
      && isUnsafeIncludePath(tokens[k + 2].value ?? '')
    ) {
      return (tokens[k + 2].value ?? '').trim();
    }
  }
  return null;
}

/**
 * Returns the offending path (or operand) of the first include-family
 * directive, `__has_include` operand or macro body that names an absolute or
 * traversing path, or null.
 */
export function findForbiddenInclude(code: string): string | null {
  for (const line of lexPreprocessingTokens(code).lines) {
    const hit = forbiddenIncludeInLine(line);
    if (hit !== null) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Assembler-embedding guard (header problems)
// ---------------------------------------------------------------------------

type AsmHazardKind = 'asm' | 'attribute' | 'paste' | 'embed' | 'ident';

interface AsmHazard {
  kind: AsmHazardKind;
  spelling: string;
  line: number;
}

const ASM_KEYWORDS = new Set(['asm', '__asm', '__asm__']);
/** Attributes whose string argument GCC writes into the assembly verbatim. */
const RAW_ASSEMBLY_ATTRIBUTES = new Set(['section', '__section__', 'weakref', '__weakref__', 'symver', '__symver__']);
/** Directives whose string GCC writes into the assembly verbatim (`.ident`). */
const RAW_ASSEMBLY_DIRECTIVES = new Set(['ident', 'sccs']);

function embeddingDirectiveIn(value: string): string | null {
  const lower = value.toLowerCase();
  if (lower.includes('incbin')) return 'incbin';
  if (lower.includes('.include')) return '.include';
  return null;
}

/**
 * How much of a run of adjacent string literals is carried to the next
 * literal: one character short of the longest directive looked for
 * (`.include`), so a directive split across literals is still found while
 * each check stays proportional to the new literal, not to the whole run.
 */
const RUN_TAIL = '.include'.length - 1;

/**
 * Hazards of one logical line. `carriedRun` is the tail of the adjacent
 * string literals that end the previous text line: GCC concatenates
 * adjacent literals across newlines outside directives.
 */
function asmHazardInLine(line: LogicalLine, carriedRun: string): { hazard: AsmHazard | null; run: string } {
  const tokens = line.tokens;
  if (line.directive !== null && RAW_ASSEMBLY_DIRECTIVES.has(line.directive)) {
    return { hazard: { kind: 'ident', spelling: `#${line.directive}`, line: tokens[0].line }, run: '' };
  }
  let run = line.directive === null ? carriedRun : '';
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.kind === 'string') {
      const window = run + (token.value ?? '');
      const embedded = embeddingDirectiveIn(window);
      if (embedded) return { hazard: { kind: 'embed', spelling: embedded, line: token.line }, run: '' };
      run = window.slice(-RUN_TAIL);
      continue;
    }
    run = '';
    if (token.kind === 'identifier') {
      if (ASM_KEYWORDS.has(token.text)) return { hazard: { kind: 'asm', spelling: token.text, line: token.line }, run };
      if (RAW_ASSEMBLY_ATTRIBUTES.has(token.text)) {
        return { hazard: { kind: 'attribute', spelling: token.text, line: token.line }, run };
      }
      if (token.text.toLowerCase().includes('incbin')) {
        return { hazard: { kind: 'embed', spelling: 'incbin', line: token.line }, run };
      }
    } else if (token.kind === 'punctuator') {
      if (token.text === '##') return { hazard: { kind: 'paste', spelling: '##', line: token.line }, run };
      const next = tokens[k + 1];
      if (token.text === '.' && next?.kind === 'identifier' && !next.spaceBefore && next.text.toLowerCase() === 'include') {
        return { hazard: { kind: 'embed', spelling: '.include', line: token.line }, run };
      }
    }
  }
  return { hazard: null, run: line.directive === null ? run : carriedRun };
}

function firstAsmHazard(lines: readonly LogicalLine[]): AsmHazard | null {
  let run = '';
  for (const line of lines) {
    const result = asmHazardInLine(line, run);
    if (result.hazard) return result.hazard;
    run = result.run;
  }
  return null;
}

/**
 * Constructs that put submission-controlled text into the assembler input:
 * inline asm (`asm`, `__asm`, `__asm__`), the `section` / `weakref` /
 * `symver` attributes and `#ident` / `#sccs` (their strings are written into
 * the assembly verbatim), token pasting (`##` / `%:%:`, which could assemble
 * any of these from pieces), and `incbin` / `.include` in an identifier or in
 * a string literal after concatenation and escape decoding. Returns the
 * offending spelling, or null.
 */
export function findForbiddenAsm(code: string): string | null {
  return firstAsmHazard(lexPreprocessingTokens(code).lines)?.spelling ?? null;
}

// ---------------------------------------------------------------------------
// Header-problem rules
// ---------------------------------------------------------------------------

const CPP_KEYWORDS = new Set([
  'alignas', 'alignof', 'asm', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'char8_t', 'char16_t',
  'char32_t', 'class', 'concept', 'const', 'consteval', 'constexpr', 'constinit', 'const_cast', 'continue',
  'co_await', 'co_return', 'co_yield', 'decltype', 'default', 'delete', 'do', 'double', 'dynamic_cast',
  'else', 'enum', 'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend', 'goto', 'if',
  'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'noexcept', 'nullptr', 'operator', 'private',
  'protected', 'public', 'register', 'reinterpret_cast', 'requires', 'return', 'short', 'signed', 'sizeof',
  'static', 'static_assert', 'static_cast', 'struct', 'switch', 'template', 'this', 'thread_local', 'throw',
  'true', 'try', 'typedef', 'typeid', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void',
  'volatile', 'wchar_t', 'while',
  // Alternative tokens.
  'and', 'and_eq', 'bitand', 'bitor', 'compl', 'not', 'not_eq', 'or', 'or_eq', 'xor', 'xor_eq',
  // Identifiers with special meaning, and the preprocessor's own.
  'final', 'override', 'import', 'module', 'defined',
]);

/** `__x` and `_X`: names reserved for the implementation (libraries expand their macros into them). */
const isReservedIdentifier = (name: string): boolean => name.startsWith('__') || /^_[A-Z]/.test(name);

const isHeaderName = (name: string): boolean => /\.(h|hpp)$/.test(name);

export interface HeaderSourceContext {
  /** The submission's file name inside the grader workspace (e.g. `student.h`). */
  submissionFilename: string;
  /** The problem's secret grader files; only their identifiers are used. */
  graderFiles: ReadonlyArray<{ filename: string; content: Buffer | string }>;
  /** The problem's public starter files: the only names `#include "..."` may use. */
  starterFilenames: readonly string[];
}

/** Every identifier the grader's code (not its comments or strings) uses. */
function collectGraderIdentifiers(files: HeaderSourceContext['graderFiles']): Set<string> {
  const identifiers = new Set<string>();
  for (const file of files) {
    const source = typeof file.content === 'string' ? file.content : file.content.toString('utf8');
    for (const line of lexPreprocessingTokens(source).lines) {
      for (const token of line.tokens) {
        if (token.kind === 'identifier') identifiers.add(token.text);
      }
    }
  }
  return identifiers;
}

/** A submission token safe to echo back: its own text, one line, bounded. */
function quote(text: string): string {
  const flat = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
  return `"${flat.length > 60 ? `${flat.slice(0, 57)}...` : flat}"`;
}

const LEX_PROBLEM_MESSAGES: Record<LexProblemKind, string> = {
  'stray-backslash': 'a backslash outside a string or character literal is not allowed in this problem.',
  'raw-string-splice': 'a line continuation (backslash-newline) inside a raw string literal is not allowed in this problem.',
  'bad-raw-string': 'malformed or unterminated raw string literal.',
  'ambiguous-suffix': 'a string literal directly followed by another prefixed literal is not allowed in this problem; put a space between them.',
  'unsupported-escape': 'delimited and named escape sequences (\\N{...}, \\x{...}, \\o{...}, \\u{...}) are not allowed in this problem.',
};

function asmHazardMessage(hazard: AsmHazard, where: string): string {
  switch (hazard.kind) {
    case 'asm':
      return `Compilation rejected: inline assembly (${quote(hazard.spelling)}) is not allowed in this problem.`;
    case 'attribute':
      // Matched as an identifier anywhere (a macro could otherwise spell the
      // attribute), so say what it is: a variable may simply share the name.
      return `Compilation rejected (${where}): ${quote(hazard.spelling)} is not allowed in this problem: it names a GCC attribute that writes raw assembly. Rename it if it is your own identifier.`;
    case 'paste':
      return `Compilation rejected (${where}): token pasting (##) is not allowed in this problem.`;
    case 'ident':
      return `Compilation rejected (${where}): the ${hazard.spelling} directive is not allowed in this problem.`;
    case 'embed':
      return `Compilation rejected (${where}): assembler file embedding (${quote(hazard.spelling)}) is not allowed in this problem.`;
  }
}

/** Include-family and macro rules of one directive line, or null. */
function headerDirectiveRejection(
  line: LogicalLine,
  where: string,
  publicHeaders: readonly string[],
  graderIdentifiers: ReadonlySet<string>,
): string | null {
  const directive = line.directive;
  if (directive === 'embed') {
    return `Compilation rejected (${where}): #embed is not allowed in this problem.`;
  }
  if (directive !== null && INCLUDE_DIRECTIVES.has(directive)) {
    const operand = line.tokens[2];
    if (!operand) return null;
    if (operand.kind !== 'header-name') {
      return `Compilation rejected (${where}): #${directive} must name a header directly ("..." or <...>), not through a macro.`;
    }
    const target = operand.value ?? '';
    if (operand.text.startsWith('<')) {
      if (target.includes('..') || target.includes('\\') || target.trim().startsWith('/')) {
        return `Compilation rejected (${where}): #${directive} <${target}> is not allowed: header names may not contain "..", "\\" or start with "/".`;
      }
      return null;
    }
    if (publicHeaders.includes(target)) return null;
    const allowed = publicHeaders.length > 0
      ? `standard headers (<...>) and this problem's public headers: ${publicHeaders.map((h) => `"${h}"`).join(', ')}`
      : 'standard headers (<...>) only';
    return `Compilation rejected (${where}): #${directive} ${quote(target)} is not allowed. Include ${allowed}.`;
  }
  if (directive === 'define' || directive === 'undef') {
    const nameToken = line.tokens[2];
    if (nameToken?.kind !== 'identifier') return null;
    const macro = nameToken.text;
    if (CPP_KEYWORDS.has(macro)) {
      return `Compilation rejected (${where}): #${directive} of the C++ keyword ${quote(macro)} is not allowed.`;
    }
    if (graderIdentifiers.has(macro)) {
      return `Compilation rejected (${where}): #${directive} of ${quote(macro)} is not allowed because the grader uses that name. Rename the macro.`;
    }
    if (directive === 'define' && isReservedIdentifier(macro)) {
      const functionLike = line.tokens[3]?.text === '(' && !line.tokens[3].spaceBefore;
      if (functionLike || macroBody(line).length > 0) {
        return `Compilation rejected (${where}): a function-like or non-empty #define of the reserved name ${quote(macro)} is not allowed (an empty include-guard #define is fine).`;
      }
    }
  }
  return null;
}

/**
 * Header-problem source rules (defence in depth on top of the two-step
 * build). Returns the submitter-facing rejection message, or null:
 *
 * - lexical ambiguity GCC would resolve differently from a guard (a stray
 *   backslash, a splice inside a raw string, ...) is rejected outright;
 * - `#include` / `#include_next` / `#import` may only name `<header>` (no
 *   `..`, `\` or leading `/`) or `"name"` where name is one of the problem's
 *   public starter headers; computed includes and `#embed` are rejected;
 * - `#define` / `#undef` of a C++ keyword or of any identifier the grader
 *   uses is rejected (a student macro must never rewrite or stringize grader
 *   code into a diagnostic), and so is a function-like or non-empty
 *   `#define` of a reserved name (library macros expand into those);
 * - the assembler-embedding constructs of {@link findForbiddenAsm}.
 *
 * Messages quote only the submission's own text, never grader content.
 */
export function findHeaderSourceRejection(code: string, context: HeaderSourceContext): string | null {
  const { lines, problems } = lexPreprocessingTokens(code);
  const file = context.submissionFilename;
  if (problems.length > 0) {
    const first = problems.reduce((a, b) => (b.line < a.line ? b : a));
    return `Compilation rejected (${file}:${first.line}): ${LEX_PROBLEM_MESSAGES[first.kind]}`;
  }
  const graderIdentifiers = collectGraderIdentifiers(context.graderFiles);
  const publicHeaders = [...new Set(context.starterFilenames)]
    .filter((name) => isHeaderName(name) && name !== context.submissionFilename)
    .sort();
  let run = '';
  for (const line of lines) {
    const where = `${file}:${line.tokens[0]?.line ?? 1}`;
    const directiveRejection = headerDirectiveRejection(line, where, publicHeaders, graderIdentifiers);
    if (directiveRejection) return directiveRejection;
    const result = asmHazardInLine(line, run);
    if (result.hazard) return asmHazardMessage(result.hazard, `${file}:${result.hazard.line}`);
    run = result.run;
  }
  return null;
}

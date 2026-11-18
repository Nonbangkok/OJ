/**
 * Pre-compile source guards.
 *
 * Both guards run on the preprocessing tokens a real lexer produces, written
 * to agree with GCC's own (libcpp, checked against g++ 14 with -std=c++20):
 * line splices, `//` and `/* *\/` comments, string / character / raw-string
 * literals, pp-numbers with digit separators, header names (on every operand
 * of an `#include` line, as GCC lexes them) and the `%:` digraphs. A guard is
 * only as good as that agreement: wherever the two disagree about where a
 * comment or a literal starts, a submission can hide a directive from the
 * guard that g++ still runs. So an unterminated quote swallows the rest of
 * its line exactly as GCC's does, and whatever the lexer cannot read the way
 * GCC would in every context is reported as a {@link LexProblem} the guards
 * fail closed on.
 *
 * - {@link findIncludeRejection} / {@link findForbiddenInclude} protect EVERY
 *   C++ submission (and the authoring compiler): they reject absolute or
 *   traversing paths in the include family (`#include`, `#include_next`,
 *   `#import`, `__has_include`), in `#line`, in macro bodies a computed
 *   include could use and on a computed include line itself, plus `#embed`
 *   and the ambiguous lexical constructs (RUNNER-001). The unprivileged
 *   compile (uid drop in submissionService) bounds what is left.
 * - {@link findHeaderSourceRejection} applies only to header problems, whose
 *   submission is compiled in the same translation unit as the problem's
 *   SECRET grader sources. It is defence in depth: the structural boundary is
 *   the two-step build (see HEADER_CPP_PREPARE), which deletes every grader
 *   file before the assembler runs. Its messages quote only the submission's
 *   own text, never grader content.
 *
 * This module must stay free of project imports: the authoring runner image
 * copies only its compiled file (see backend/authoring/Dockerfile).
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
   * String literals: the body with escape sequences decoded (raw strings and
   * literals on an `#include` line verbatim, as GCC reads them there).
   * Header names: the name between the delimiters.
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

type LexProblemKind =
  | 'stray-backslash'
  | 'raw-string-splice'
  | 'bad-raw-string'
  | 'ambiguous-suffix'
  | 'ambiguous-has-include'
  | 'unsupported-escape'
  | 'unterminated-comment'
  | 'unterminated-literal';

interface LexProblem {
  kind: LexProblemKind;
  line: number;
}

interface LexResult {
  lines: LogicalLine[];
  /** Constructs a guard cannot read the way GCC would in every context (the guards reject them). */
  problems: LexProblem[];
}

/**
 * Directives GCC lexes in "angled headers" mode for their WHOLE line: every
 * `<...>` closed on the line is one header-name token and quotes take no
 * escapes. (`#embed` is not one of them in GCC 14, which does not know the
 * directive; the guards reject it outright.)
 */
const ANGLED_DIRECTIVES = new Set(['include', 'include_next', 'import']);
/**
 * Operators whose operand GCC lexes in angled mode only when it EVALUATES
 * them (an active `#if`, ordinary text), but not in a skipped block, a
 * `#define` body or an `#elif` after a taken branch. Their operand must
 * therefore lex the same either way (see `checkMaybeAngled`).
 */
const HAS_INCLUDE_OPERATORS = new Set(['__has_include', '__has_include_next', '__has_embed']);
const STRING_PREFIXES = new Set(['u8', 'u', 'U', 'L']);
const RAW_STRING_PREFIXES = new Set(['R', 'u8R', 'uR', 'UR', 'LR']);
const MAX_RAW_DELIMITER = 16;
/** Raw-string delimiter characters g++ 14 accepts: the basic character set minus space, `(`, `)`, `\` and controls. */
const RAW_DELIMITER_CHAR = /^[A-Za-z0-9_{}[\]#<>%:;.?*+\-/^&|~!=,"']$/;
/** Two-character digraphs other than `%:` / `<:` (handled with their special cases). */
const DIGRAPHS = new Map<string, string>([[':>', ']'], ['<%', '{'], ['%>', '}']]);

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
/** ASCII letters, digits and `_` (libcpp's ISIDNUM: no `$`, no extended characters). */
const isAsciiIdChar = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || isDigit(c));
/** `$` and every non-ASCII character continue an identifier or pp-number, as in g++ (it only diagnoses invalid ones). */
const isExtendedIdChar = (c: string | undefined): boolean => c !== undefined && (c === '$' || c.charCodeAt(0) >= 0x80);
const isIdentStart = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || isExtendedIdChar(c));
const isIdentChar = (c: string | undefined): boolean => isIdentStart(c) || isDigit(c);
/** libcpp's is_nvspace: space, tab, form feed, vertical tab and NUL. */
const isHorizontalSpace = (c: string | undefined): boolean =>
  c === ' ' || c === '\t' || c === '\f' || c === '\v' || c === '\0';
const isHexDigit = (c: string | undefined): boolean => c !== undefined && /^[0-9A-Fa-f]$/.test(c);

/**
 * Translation phases 1-2: CRLF, CR and LF all end a line (GCC treats a lone
 * CR as a newline), and a backslash followed by optional horizontal
 * whitespace (NUL included, as in GCC) and a newline is removed. Returns the
 * spliced text, the physical line of each character, and where splices
 * happened (GCC reverts them inside raw string literals).
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
      while (isHorizontalSpace(source[j])) j += 1;
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

/** How a quote is read: with escapes, without (an `#include` line), or "either" (a `__has_include` operand). */
type QuoteMode = 'normal' | 'angled' | 'maybe';

/** Lex C++ source into logical lines of preprocessing tokens, the way GCC's preprocessor does. */
function lexPreprocessingTokens(source: string): LexResult {
  const { text, lineAt, splices } = spliceLines(source);
  const n = text.length;
  const lines: LogicalLine[] = [];
  const problems: LexProblem[] = [];
  let tokens: PpToken[] = [];
  let spaceBefore = false;
  /** The current logical line is an `#include`-family directive (angled mode for the whole line). */
  let angledLine = false;
  /**
   * Where a `__has_include` operand stands: 1 = the token right after the
   * operator, 2 = the token after its `(`, 3 = after an identifier operand
   * (a following `(` would make it a function-like macro call GCC expands
   * in angled mode).
   */
  let hasIncludeState = 0;
  /** No `>` before the next newline from any position below this (memo: keeps `<<<<...` lines linear). */
  let angleNoCloseUntil = 0;

  const lineOf = (index: number): number => lineAt[Math.min(index, lineAt.length - 1)] ?? 1;
  const problem = (kind: LexProblemKind, index: number): void => {
    problems.push({ kind, line: lineOf(index) });
  };

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
    if (
      kind === 'identifier' && tokens.length === 2 && tokens[0].kind === 'punctuator' && tokens[0].text === '#'
      && ANGLED_DIRECTIVES.has(token.text)
    ) {
      angledLine = true;
    }
    const state = hasIncludeState;
    hasIncludeState = 0;
    if (kind === 'identifier' && HAS_INCLUDE_OPERATORS.has(token.text)) {
      hasIncludeState = 1;
    } else if (state === 1) {
      // `__has_include MACRO ...`: the macro could expand to the `(`, and GCC
      // keeps lexing in angled mode until it has the operand.
      if (kind === 'identifier') problem('ambiguous-has-include', start);
      else if (kind === 'punctuator' && token.text === '(') hasIncludeState = 2;
    } else if (state === 2) {
      if (kind === 'identifier') hasIncludeState = 3;
    } else if (state === 3 && kind === 'punctuator' && token.text === '(') {
      problem('ambiguous-has-include', start);
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
    angledLine = false;
    hasIncludeState = 0;
  };

  /**
   * A literal followed by a prefix word and a quote: GCC reads the word as a
   * ud-suffix unless it is a macro, so whether the quote opens a raw (or
   * prefixed) literal depends on macros the guard cannot see.
   */
  const checkSuffix = (end: number): void => {
    if (!isIdentStart(text[end])) return;
    let m = end;
    while (isIdentChar(text[m])) m += 1;
    const word = text.slice(end, m);
    if ((text[m] === '"' || text[m] === "'") && (STRING_PREFIXES.has(word) || RAW_STRING_PREFIXES.has(word))) {
      problem('ambiguous-suffix', end);
    }
  };

  /** Index of the newline ending the current line at or after `from`, or `n`. */
  const lineEnd = (from: number): number => {
    const end = text.indexOf('\n', from);
    return end === -1 ? n : end;
  };

  /**
   * `'...'` / `"..."` (prefix included from `start`). Escapes skip a
   * character except in angled mode, where GCC reads the body verbatim. An
   * unterminated literal makes the REST OF THE LINE one opaque token, as
   * GCC's lex_string does (CPP_OTHER): nothing after the quote on that line
   * opens a comment or a raw string.
   */
  const lexQuoted = (start: number, quotePos: number, mode: QuoteMode, headerName = false): number => {
    const quote = text[quotePos];
    let j = quotePos + 1;
    if (mode === 'normal') {
      while (j < n && text[j] !== quote && text[j] !== '\n') j += text[j] === '\\' && text[j + 1] !== '\n' ? 2 : 1;
    } else {
      let sawBackslash = false;
      while (j < n && text[j] !== quote && text[j] !== '\n') {
        if (text[j] === '\\') sawBackslash = true;
        j += 1;
      }
      // With escapes the literal would end somewhere else (or not at all).
      if (mode === 'maybe' && sawBackslash) problem('ambiguous-has-include', start);
    }
    if (j >= n || text[j] !== quote) {
      const stop = Math.min(j, n);
      if (stop >= n) problem('unterminated-literal', start);
      push('other', start, stop);
      return stop;
    }
    const body = text.slice(quotePos + 1, j);
    if (headerName) {
      push('header-name', start, j + 1, undefined, body);
    } else if (quote === '"') {
      if (mode === 'normal') {
        const decoded = decodeEscapes(body);
        if (decoded.exotic) problem('unsupported-escape', start);
        push('string', start, j + 1, undefined, decoded.value);
      } else {
        push('string', start, j + 1, undefined, body);
      }
    } else {
      push('char', start, j + 1);
    }
    checkSuffix(j + 1);
    return j + 1;
  };

  /**
   * `<...>` in angled mode: one header-name token up to the first `>` on the
   * line (no escapes, comments or literals inside). Returns the index after
   * it, or -1 when the line has no `>` (GCC then lexes a plain `<`). A
   * "maybe" operand must not hold anything that would lex differently as
   * ordinary tokens.
   */
  const lexAngleHeader = (i: number, mode: QuoteMode): number => {
    if (i < angleNoCloseUntil) return -1;
    let close = i + 1;
    while (close < n && text[close] !== '>' && text[close] !== '\n') close += 1;
    if (close >= n || text[close] !== '>') {
      // Every `<` before this newline fails the same way.
      angleNoCloseUntil = close;
      return -1;
    }
    const name = text.slice(i + 1, close);
    if (mode === 'maybe' && /\/\*|\/\/|["']/.test(name)) problem('ambiguous-has-include', i);
    push('header-name', i, close + 1, undefined, name);
    checkSuffix(close + 1);
    return close + 1;
  };

  const lexRawString = (start: number, quotePos: number): number => {
    let j = quotePos + 1;
    while (j < n && j - quotePos - 1 <= MAX_RAW_DELIMITER && RAW_DELIMITER_CHAR.test(text[j])) j += 1;
    const delimiter = text.slice(quotePos + 1, j);
    if (text[j] !== '(' || delimiter.length > MAX_RAW_DELIMITER) {
      // g++ errors and recovers by scanning on to some later quote; where
      // exactly is not something to mirror. Both guards reject this.
      problem('bad-raw-string', start);
      push('identifier', start, quotePos);
      return quotePos;
    }
    const terminator = `)${delimiter}"`;
    const close = text.indexOf(terminator, j + 1);
    const stop = close === -1 ? n : close + terminator.length;
    if (close === -1) problem('bad-raw-string', start);
    if (hasSpliceBetween(start, stop)) problem('raw-string-splice', start);
    push('string', start, stop, undefined, text.slice(j + 1, close === -1 ? n : close));
    checkSuffix(stop);
    return stop;
  };

  /**
   * A pp-number from `start` (a digit, or `.` + digit), as libcpp's
   * lex_number: ASCII identifier characters, `'` digit separators (always
   * taken, but given back at the end of a run), `.` unless right after a
   * separator, a sign after e/E/p/P; then `$` or an extended character
   * starts another run. So `1'$` is the number `1` followed by a character
   * literal, and `1'''a` is one (invalid) number.
   */
  const lexNumber = (start: number): number => {
    let j = start + 1;
    for (;;) {
      const run = j;
      while (j < n) {
        const d = text[j];
        if (
          isAsciiIdChar(d) || d === "'" || (d === '.' && text[j - 1] !== "'")
          || ((d === '+' || d === '-') && 'eEpP'.includes(text[j - 1]))
        ) {
          j += 1;
        } else {
          break;
        }
      }
      while (j > run && text[j - 1] === "'") j -= 1;
      if (j < n && isExtendedIdChar(text[j])) {
        j += 1;
        continue;
      }
      return j;
    }
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
      if (end === -1) problem('unterminated-comment', i);
      i = end === -1 ? n : end + 2;
      spaceBefore = true;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      i = lineEnd(i + 2);
      spaceBefore = true;
      continue;
    }

    // An `#include` line is angled throughout; a `__has_include` operand
    // only when GCC evaluates it, so it must lex the same either way.
    const operand = hasIncludeState === 1 || hasIncludeState === 2;
    const mode: QuoteMode = angledLine ? 'angled' : operand ? 'maybe' : 'normal';
    if (mode !== 'normal' && c === '<') {
      const next = lexAngleHeader(i, mode);
      if (next !== -1) {
        i = next;
        continue;
      }
    }
    if (mode !== 'normal' && c === '"') {
      i = lexQuoted(i, i, mode, true);
      continue;
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
        i = lexQuoted(i, j, mode);
        continue;
      }
      push('identifier', i, j);
      i = j;
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(text[i + 1]))) {
      const j = lexNumber(i);
      push('number', i, j);
      i = j;
      continue;
    }

    if (c === '"' || c === "'") {
      i = lexQuoted(i, i, mode);
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
      // Which `\u{...}` / `\N{...}` forms g++ takes into an identifier
      // depends on its version and -std, so it is ambiguous.
      problem('stray-backslash', i);
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

/** A submission token safe to echo back: its own text, one line, bounded. */
function quote(text: string): string {
  const flat = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
  return `"${flat.length > 60 ? `${flat.slice(0, 57)}...` : flat}"`;
}

const LEX_PROBLEM_MESSAGES: Record<LexProblemKind, string> = {
  'stray-backslash': 'a backslash outside a string or character literal is not allowed.',
  'raw-string-splice': 'a line continuation (backslash-newline) inside a raw string literal is not allowed.',
  'bad-raw-string': 'malformed or unterminated raw string literal.',
  'ambiguous-suffix': 'a string literal directly followed by another prefixed literal is not allowed; put a space between them.',
  'ambiguous-has-include': 'a __has_include operand must be written directly as <name> or "name" (no comments, quotes or backslashes in it, no macro).',
  'unsupported-escape': 'delimited and named escape sequences (\\N{...}, \\x{...}, \\o{...}, \\u{...}) are not allowed in this problem.',
  'unterminated-comment': 'unterminated /* comment.',
  'unterminated-literal': 'unterminated string or character literal at the end of the file.',
};

const earliestProblem = (problems: readonly LexProblem[]): LexProblem | null =>
  problems.reduce<LexProblem | null>((a, b) => (a === null || b.line < a.line ? b : a), null);

/** `__x` and `_X`: names reserved for the implementation (libraries and predefined macros use them). */
const isReservedIdentifier = (name: string): boolean => name.startsWith('__') || /^_[A-Z]/.test(name);

// ---------------------------------------------------------------------------
// Include guard (every C++ submission)
// ---------------------------------------------------------------------------

/**
 * Lexical problems that can make the guard and GCC disagree about where a
 * comment or literal starts — the include guard fails closed on these. (An
 * unterminated comment or literal at the end of the file hides nothing from
 * either, and undecodable escapes only matter to the header rules.)
 */
const INCLUDE_GUARD_LEX_PROBLEMS: ReadonlySet<LexProblemKind> = new Set<LexProblemKind>([
  'stray-backslash', 'raw-string-splice', 'bad-raw-string', 'ambiguous-suffix', 'ambiguous-has-include',
]);

/** Absolute or traversing (the historical rule: any `..` at all). */
function isUnsafeIncludePath(target: string): boolean {
  const trimmed = target.trim();
  return trimmed.startsWith('/') || trimmed.includes('..');
}

/** `#include <x` / `#include "x` with no closing delimiter on the line: g++ reports it itself. */
const isUnterminatedHeaderName = (token: PpToken): boolean =>
  (token.kind === 'punctuator' && token.text === '<') || (token.kind === 'other' && token.text.startsWith('"'));

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
const isLiteralWithValue = (token: PpToken): boolean => token.kind === 'string' || token.kind === 'header-name';

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

/**
 * Tokens that could put an absolute or traversing path into a file name once
 * macros expand: a `/` (any `/` may become the first character of the name),
 * `..`, a literal naming such a path, or a reserved identifier (a predefined
 * or system-header macro such as `_PATH_BSHELL`).
 */
function hasPathLikeToken(tokens: readonly PpToken[], isTaintedMacro: (name: string) => boolean): boolean {
  for (const token of tokens) {
    if (isPunctuator(token, '/')) return true;
    if (isLiteralWithValue(token) && isUnsafeIncludePath(token.value ?? '')) return true;
    if (token.kind === 'identifier' && (isReservedIdentifier(token.text) || isTaintedMacro(token.text))) return true;
  }
  return tokens.map((t) => t.text).join('').includes('..');
}

/**
 * Macros whose expansion, followed through every macro their bodies name,
 * could contribute a path-like token ({@link hasPathLikeToken}). Linear: a
 * reverse-edge walk from the directly path-like bodies.
 */
function pathLikeMacros(lines: readonly LogicalLine[]): ReadonlySet<string> {
  const tainted = new Set<string>();
  const dependents = new Map<string, string[]>();
  const queue: string[] = [];
  const mark = (name: string): void => {
    if (!tainted.has(name)) {
      tainted.add(name);
      queue.push(name);
    }
  };
  for (const line of lines) {
    if (line.directive !== 'define' || line.tokens[2]?.kind !== 'identifier') continue;
    const name = line.tokens[2].text;
    const body = macroBody(line);
    if (hasPathLikeToken(body, () => false)) mark(name);
    for (const token of body) {
      if (token.kind !== 'identifier') continue;
      const list = dependents.get(token.text);
      if (list) list.push(name);
      else dependents.set(token.text, [name]);
    }
  }
  while (queue.length > 0) {
    for (const dependent of dependents.get(queue.pop() as string) ?? []) mark(dependent);
  }
  return tainted;
}

type IncludeHazard =
  | { kind: 'path'; directive: string; target: string; line: number }
  | { kind: 'embed'; line: number }
  | { kind: 'lexical'; problem: LexProblem };

/** The offending path of a run of tokens: an unsafe literal's own value, else the run's spelling. */
function offendingSpelling(tokens: readonly PpToken[]): string {
  const literal = tokens.find((t) => isLiteralWithValue(t) && isUnsafeIncludePath(t.value ?? ''));
  return literal ? (literal.value ?? '').trim() : spell(tokens);
}

function includeHazardInLine(line: LogicalLine, tainted: ReadonlySet<string>): IncludeHazard | null {
  const directive = line.directive;
  const tokens = line.tokens;
  const at = tokens[0]?.line ?? 1;
  const pathHazard = (target: string, name = directive ?? 'include'): IncludeHazard =>
    ({ kind: 'path', directive: name, target, line: at });
  const isTainted = (name: string): boolean => tainted.has(name);

  if (directive === 'embed') return { kind: 'embed', line: at };
  if (directive !== null && ANGLED_DIRECTIVES.has(directive)) {
    // GCC lexes every operand as a header name, and a macro in front of one
    // (`#define E` + `#include E "/etc/passwd"`) can make it THE operand.
    for (const token of tokens.slice(2)) {
      if (token.kind === 'header-name' && isUnsafeIncludePath(token.value ?? '')) {
        return pathHazard((token.value ?? '').trim());
      }
    }
    const operand = tokens[2];
    const rest = tokens.slice(2);
    if (!operand || operand.kind === 'header-name') return null;
    const computed = operand.kind === 'identifier'
      // `<` with no `>` on its physical line, closed after a multi-line comment: GCC glues the tokens.
      || (isPunctuator(operand, '<') && rest.some((t) => isPunctuator(t, '>')));
    if (computed) return hasPathLikeToken(rest, isTainted) ? pathHazard(offendingSpelling(rest)) : null;
    if (isUnterminatedHeaderName(operand)) return null;
    // Neither a header name nor a macro: operator junk or a path fragment.
    // Reject rather than guess what it expands to.
    return pathHazard(spell(rest));
  }
  // `#line N "file"` / `# N "file"`: g++ prints lines of "file" as the caret
  // context of every later diagnostic.
  if (directive === 'line' || (directive === '' && tokens[1]?.kind === 'number')) {
    const rest = tokens.slice(directive === 'line' ? 2 : 1);
    if (hasPathLikeToken(rest, isTainted)) return pathHazard(offendingSpelling(rest), 'line');
  }
  if (directive === 'define') {
    const hit = forbiddenPathInMacroBody(macroBody(line));
    if (hit !== null) return pathHazard(hit, 'include');
  }
  for (let k = 0; k + 2 < tokens.length; k += 1) {
    if (
      tokens[k].kind === 'identifier' && HAS_INCLUDE_OPERATORS.has(tokens[k].text)
      && tokens[k + 1].text === '(' && tokens[k + 2].kind === 'header-name'
      && isUnsafeIncludePath(tokens[k + 2].value ?? '')
    ) {
      return pathHazard((tokens[k + 2].value ?? '').trim(), 'include');
    }
  }
  return null;
}

function firstIncludeHazard(code: string): IncludeHazard | null {
  const { lines, problems } = lexPreprocessingTokens(code);
  const lexical = earliestProblem(problems.filter((p) => INCLUDE_GUARD_LEX_PROBLEMS.has(p.kind)));
  if (lexical) return { kind: 'lexical', problem: lexical };
  const tainted = pathLikeMacros(lines);
  for (const line of lines) {
    const hazard = includeHazardInLine(line, tainted);
    if (hazard) return hazard;
  }
  return null;
}

/**
 * Returns the offending path (or operand) of the first include-family
 * directive, `#line`, `__has_include` operand or macro body that names an
 * absolute or traversing path, `#embed` for an `#embed` directive, or a short
 * description of a lexical construct the guard cannot read the way GCC
 * would; null when the source is fine. See {@link findIncludeRejection} for
 * the submitter-facing message.
 */
export function findForbiddenInclude(code: string): string | null {
  const hazard = firstIncludeHazard(code);
  if (!hazard) return null;
  switch (hazard.kind) {
    case 'path':
      return hazard.target;
    case 'embed':
      return '#embed';
    case 'lexical':
      return `line ${hazard.problem.line}: ${LEX_PROBLEM_MESSAGES[hazard.problem.kind]}`;
  }
}

/**
 * The include guard's submitter-facing rejection, or null. `filename` (the
 * header problem's `student.h`) names the file in line references.
 */
export function findIncludeRejection(code: string, filename?: string): string | null {
  const hazard = firstIncludeHazard(code);
  if (!hazard) return null;
  const where = (line: number): string => (filename ? `${filename}:${line}` : `line ${line}`);
  switch (hazard.kind) {
    case 'path':
      return hazard.directive === 'line'
        ? `Compilation rejected (${where(hazard.line)}): #line may not name an absolute or ".." path (${quote(hazard.target)}).`
        : `Compilation rejected: #include of a non-permitted path (${quote(hazard.target)}) is not allowed. `
          + 'Use standard library headers (e.g. <bits/stdc++.h>) only.';
    case 'embed':
      return `Compilation rejected (${where(hazard.line)}): #embed is not allowed.`;
    case 'lexical':
      return `Compilation rejected (${where(hazard.problem.line)}): ${LEX_PROBLEM_MESSAGES[hazard.problem.kind]}`;
  }
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
  if (directive !== null && ANGLED_DIRECTIVES.has(directive)) {
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
 * - every lexical problem is rejected outright: a construct a guard cannot
 *   read the way GCC would in every context (a stray backslash, a splice
 *   inside a raw string, a malformed raw string, a ud-suffix that might be a
 *   literal prefix, an ambiguous `__has_include` operand), an undecodable
 *   escape, and an unterminated comment or literal at the end of the file;
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
  const first = earliestProblem(problems);
  if (first) {
    return `Compilation rejected (${file}:${first.line}): ${LEX_PROBLEM_MESSAGES[first.kind]}`;
  }
  const identifiers = collectGraderIdentifiers(context.graderFiles);
  const publicHeaders = [...new Set(context.starterFilenames)]
    .filter((name) => isHeaderName(name) && name !== context.submissionFilename)
    .sort();
  let run = '';
  for (const line of lines) {
    const where = `${file}:${line.tokens[0]?.line ?? 1}`;
    const directiveRejection = headerDirectiveRejection(line, where, publicHeaders, identifiers);
    if (directiveRejection) return directiveRejection;
    const result = asmHazardInLine(line, run);
    if (result.hazard) return asmHazardMessage(result.hazard, `${file}:${result.hazard.line}`);
    run = result.run;
  }
  return null;
}

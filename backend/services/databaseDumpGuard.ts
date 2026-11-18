import crypto from 'crypto';
import fs from 'fs';
import { PassThrough, Readable } from 'stream';

/**
 * A2-06: an uploaded .sql is replayed by psql, which also executes
 * client-side meta-commands (`\!`, `\o |cmd`, `\copy ... program`, ...)
 * written anywhere at statement level, that is outside a string literal, a
 * quoted identifier, a dollar-quoted body, a comment or COPY data. Two
 * layers keep those out:
 *
 *  1. `inspectPlainDump` (before maintenance mode starts) accepts only what
 *     pg_dump writes: its header and "dump complete" footer, and no
 *     backslash at statement level except pg_dump 18's own
 *     `\restrict <key>` / `\unrestrict <key>` pair. It follows SQL lexical
 *     state between COPY blocks the way psql does (`SqlLexer`), so a
 *     backslash inside a literal (LaTeX text in a `pg_dump --inserts` dump)
 *     is data, and a meta-command after a literal on the same line is still
 *     found. It exists to give a clear 400, not to be the boundary: it
 *     assumes standard_conforming_strings = on (pg_dump sets it at the top
 *     of every dump) and does not model psql's BEGIN ATOMIC heuristic, so a
 *     crafted file can still hide a meta-command from it.
 *  2. `openGuardedPlainDump` (the actual boundary) feeds psql the file behind
 *     a `\restrict` with a fresh random key and without pg_dump's own pair.
 *     In restricted mode psql refuses every meta-command except
 *     `\unrestrict <that key>`, which the file cannot know, and
 *     ON_ERROR_STOP turns the refusal into a failed import.
 */

export type PlainDumpInspection =
  | { ok: true; omitRanges: ReadonlyArray<ByteRange> }
  | { ok: false; reason: string };

/** Half-open byte range [start, end) of the uploaded file. */
export type ByteRange = { start: number; end: number };

const HEADER_LINES = ['--', '-- PostgreSQL database dump'];
const FOOTER_LINE = '-- PostgreSQL database dump complete';
/** Only the start of a line is kept for the line checks; COPY rows can be megabytes long. */
const LINE_HEAD_LIMIT = 64 * 1024;
/** Longest dollar-quote tag followed; pg_dump's own are a few bytes ($_$, $__$). */
const DOLLAR_TAG_LIMIT = 64 * 1024;

const NEWLINE = 0x0a;
const BACKSLASH = 0x5c;
const QUOTE = 0x27;
const DOUBLE_QUOTE = 0x22;
const DOLLAR = 0x24;
const DASH = 0x2d;
const SLASH = 0x2f;
const STAR = 0x2a;
const SEMICOLON = 0x3b;
const OPEN_PAREN = 0x28;
const CLOSE_PAREN = 0x29;
const DOT = 0x2e;
const LOWER_E = 0x65;
const NEWLINE_BUFFER = Buffer.from([NEWLINE]);
const EMPTY = Buffer.alloc(0);

const RESTRICT_PATTERN = /^\\restrict ([A-Za-z0-9]+)$/;
const UNRESTRICT_PATTERN = /^\\unrestrict ([A-Za-z0-9]+)$/;
const COPY_FROM_STDIN_PATTERN = /^COPY .+ FROM stdin;$/;

/** psql's ident_start / dolq_start: a letter, `_` or any byte of a multibyte character. */
const isIdentStart = (byte: number): boolean =>
  (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || byte === 0x5f || byte >= 0x80;
const isDigit = (byte: number): boolean => byte >= 0x30 && byte <= 0x39;
const isSpace = (byte: number): boolean => byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);

type LexMode =
  | 'statement'
  | 'literal'
  | 'escapeLiteral'
  | 'quotedIdentifier'
  | 'lineComment'
  | 'blockComment'
  | 'dollarQuoted'
  | 'metaCommand';

type LexedLine = { backslashColumn: number; tagTooLong: boolean };

/**
 * The SQL between COPY blocks as psql's lexer (psqlscan.l) sees it, for the
 * one question that matters here: is a backslash at statement level? Fed a
 * line at a time, in pieces of any size; `endLine` closes each line.
 *
 * Followed: '...' with '' doubled (standard_conforming_strings = on, so a
 * backslash is an ordinary byte), E'...' where a backslash escapes the next
 * byte, "..." identifiers with "" doubled, $tag$...$tag$ bodies, -- and
 * nested /* *\/ comments, parentheses and the semicolons that end a
 * statement. A statement-level backslash starts a meta-command that runs to
 * the end of its line.
 */
class SqlLexer {
  private mode: LexMode = 'statement';
  private commentDepth = 0;
  private dollarTag: Buffer = EMPTY;
  /** E'...': the next byte is escaped (it may arrive in the next piece). */
  private escapeNext = false;
  /** The identifier or number being read, so that only a lone E before a quote opens E'...'. */
  private word: 'none' | 'identifier' | 'number' = 'none';
  private wordLength = 0;
  private wordFirstByte = 0;
  private parenDepth = 0;
  /** Bytes held back until the byte after them is known. */
  private pending: Buffer = EMPTY;
  /** Column (bytes into the line) of pending[0], or of the next byte. */
  private column = 0;
  private backslashColumn = -1;
  private tagTooLong = false;
  /** Nothing but whitespace and comments since the last statement ended. */
  atStatementStart = true;

  /** Whether the next byte is at statement level. */
  get atStatementLevel(): boolean {
    return this.mode === 'statement';
  }

  write(piece: Buffer): void {
    if (this.tagTooLong || piece.length === 0) return;
    const data = this.pending.length > 0 ? Buffer.concat([this.pending, piece]) : piece;
    const used = this.scan(data, false);
    this.column += used;
    this.pending = data.subarray(used);
  }

  /** The line's newline: everything held back is decided. Reports what the line held. */
  endLine(): LexedLine {
    if (!this.tagTooLong) {
      this.scan(this.pending.length > 0 ? Buffer.concat([this.pending, NEWLINE_BUFFER]) : NEWLINE_BUFFER, true);
    }
    const line = { backslashColumn: this.backslashColumn, tagTooLong: this.tagTooLong };
    this.pending = EMPTY;
    this.column = 0;
    this.backslashColumn = -1;
    return line;
  }

  /**
   * Lex `data` from its start. With `final`, `data` ends with the line's
   * newline and is consumed whole; otherwise lexing stops (and returns the
   * offset) where the next byte would be needed.
   */
  private scan(data: Buffer, final: boolean): number {
    const end = data.length;
    let i = 0;
    while (i < end) {
      switch (this.mode) {
        case 'lineComment':
        case 'metaCommand': {
          const newline = data.indexOf(NEWLINE, i);
          if (newline === -1) return end;
          this.mode = 'statement';
          i = newline + 1;
          break;
        }
        case 'literal': {
          const quote = data.indexOf(QUOTE, i);
          if (quote === -1) return end;
          if (quote + 1 === end && !final) return quote;
          if (data[quote + 1] === QUOTE) {
            i = quote + 2;
          } else {
            this.mode = 'statement';
            i = quote + 1;
          }
          break;
        }
        case 'escapeLiteral': {
          if (this.escapeNext) {
            this.escapeNext = false;
            i += 1;
            break;
          }
          let j = i;
          while (j < end && data[j] !== QUOTE && data[j] !== BACKSLASH) j += 1;
          if (j === end) return end;
          if (data[j] === BACKSLASH) {
            this.escapeNext = true;
            i = j + 1;
            break;
          }
          if (j + 1 === end && !final) return j;
          if (data[j + 1] === QUOTE) {
            i = j + 2;
          } else {
            this.mode = 'statement';
            i = j + 1;
          }
          break;
        }
        case 'quotedIdentifier': {
          const quote = data.indexOf(DOUBLE_QUOTE, i);
          if (quote === -1) return end;
          if (quote + 1 === end && !final) return quote;
          if (data[quote + 1] === DOUBLE_QUOTE) {
            i = quote + 2;
          } else {
            this.mode = 'statement';
            i = quote + 1;
          }
          break;
        }
        case 'blockComment': {
          let j = i;
          while (j < end && data[j] !== STAR && data[j] !== SLASH) j += 1;
          if (j === end) return end;
          if (j + 1 === end && !final) return j;
          if (data[j] === SLASH && data[j + 1] === STAR) {
            this.commentDepth += 1;
            i = j + 2;
          } else if (data[j] === STAR && data[j + 1] === SLASH) {
            this.commentDepth -= 1;
            if (this.commentDepth === 0) this.mode = 'statement';
            i = j + 2;
          } else {
            i = j + 1;
          }
          break;
        }
        case 'dollarQuoted': {
          const dollar = data.indexOf(DOLLAR, i);
          if (dollar === -1) return end;
          const tagEnd = dollar + this.dollarTag.length;
          if (tagEnd > end) {
            // A tag never holds a newline, so with `final` it cannot close here.
            if (!final) return dollar;
            return end;
          }
          if (data.subarray(dollar, tagEnd).equals(this.dollarTag)) {
            this.mode = 'statement';
            i = tagEnd;
          } else {
            i = dollar + 1;
          }
          break;
        }
        case 'statement': {
          const next = this.scanStatementByte(data, i, final);
          if (next === -1) return i;
          i = next;
          break;
        }
      }
    }
    return end;
  }

  /** One token step at statement level from `data[i]`; -1 when the next byte is needed first. */
  private scanStatementByte(data: Buffer, i: number, final: boolean): number {
    const byte = data[i];
    const atEnd = i + 1 === data.length && !final;

    if (isIdentStart(byte) || isDigit(byte)) {
      if (this.word === 'none') {
        this.word = isDigit(byte) ? 'number' : 'identifier';
        this.wordLength = 0;
        this.wordFirstByte = byte;
        this.atStatementStart = false;
      }
      this.wordLength += 1;
      return i + 1;
    }
    // `$` continues an identifier (psql's ident_cont); `.` continues a number (1.5e).
    if ((byte === DOLLAR && this.word === 'identifier') || (byte === DOT && this.word === 'number')) {
      this.wordLength += 1;
      return i + 1;
    }
    const loneE = this.word === 'identifier' && this.wordLength === 1 && (this.wordFirstByte | 0x20) === LOWER_E;
    this.word = 'none';

    switch (byte) {
      case QUOTE:
        this.mode = loneE ? 'escapeLiteral' : 'literal';
        this.atStatementStart = false;
        return i + 1;
      case DOUBLE_QUOTE:
        this.mode = 'quotedIdentifier';
        this.atStatementStart = false;
        return i + 1;
      case DASH:
        if (atEnd) return -1;
        if (data[i + 1] === DASH) {
          this.mode = 'lineComment';
          return i + 2;
        }
        this.atStatementStart = false;
        return i + 1;
      case SLASH:
        if (atEnd) return -1;
        if (data[i + 1] === STAR) {
          this.mode = 'blockComment';
          this.commentDepth = 1;
          return i + 2;
        }
        this.atStatementStart = false;
        return i + 1;
      case DOLLAR: {
        const tag = this.dollarTagAt(data, i, final);
        if (tag === 'pending') return -1;
        if (tag === 'tooLong') {
          this.tagTooLong = true;
          return data.length;
        }
        this.atStatementStart = false;
        if (tag === null) return i + 1; // a parameter ($1) or a stray $
        this.mode = 'dollarQuoted';
        this.dollarTag = Buffer.from(tag);
        return i + tag.length;
      }
      case BACKSLASH:
        if (this.backslashColumn === -1) this.backslashColumn = this.column + i;
        this.mode = 'metaCommand';
        return i + 1;
      case OPEN_PAREN:
        this.parenDepth += 1;
        this.atStatementStart = false;
        return i + 1;
      case CLOSE_PAREN:
        if (this.parenDepth > 0) this.parenDepth -= 1;
        this.atStatementStart = false;
        return i + 1;
      case SEMICOLON:
        // psql sends the statement at a semicolon outside parentheses.
        if (this.parenDepth === 0) this.atStatementStart = true;
        return i + 1;
      default:
        if (!isSpace(byte)) this.atStatementStart = false;
        return i + 1;
    }
  }

  /** The `$tag$` opening at data[i], null when it is no tag, 'pending' when more bytes are needed. */
  private dollarTagAt(data: Buffer, i: number, final: boolean): Buffer | null | 'pending' | 'tooLong' {
    const end = data.length;
    if (i + 1 === end) return final ? null : 'pending';
    if (data[i + 1] === DOLLAR) return data.subarray(i, i + 2);
    if (!isIdentStart(data[i + 1])) return null;
    let j = i + 2;
    while (j < end && (isIdentStart(data[j]) || isDigit(data[j]))) j += 1;
    if (j - i > DOLLAR_TAG_LIMIT) return 'tooLong';
    if (j === end) return final ? null : 'pending';
    return data[j] === DOLLAR ? data.subarray(i, j + 1) : null;
  }
}

const NOT_PG_DUMP = 'The uploaded .sql file is not a pg_dump plain-text dump (it does not start with the "-- PostgreSQL database dump" header).';
const INCOMPLETE = 'The uploaded .sql file is incomplete: it ends before the "PostgreSQL database dump complete" footer. Upload the whole file.';

/** The `\.` line that ends COPY data (a trailing CR is ignored, like psql does). */
const isEndOfCopyData = (lineHead: Buffer): boolean =>
  lineHead[0] === BACKSLASH && lineHead[1] === DOT && (lineHead.length === 2 || (lineHead.length === 3 && lineHead[2] === 0x0d));

/** `\name` of the meta-command starting at `column`, for the error message. */
const describeMetaCommand = (lineHead: Buffer, column: number): string =>
  column < lineHead.length ? lineHead.subarray(column).toString('utf8').split(/\s/, 1)[0].slice(0, 20) : '\\';

/** Line-by-line state of `inspectPlainDump`; fed the upload in chunks. */
class PlainDumpScan {
  private readonly lexer = new SqlLexer();
  private state: 'preamble' | 'sql' | 'copy' | 'footer' = 'preamble';
  private lineNumber = 0;
  private restrict: { key: string; range: ByteRange } | null = null;
  private unrestrict: ByteRange | null = null;
  private head: Buffer[] = [];
  private headLength = 0;
  private lineStart = 0;
  private offset = 0;
  /** The line being checked (its first LINE_HEAD_LIMIT bytes, newline excluded). */
  private lineHead: Buffer = EMPTY;
  private lineText: string | null = null;
  /** Where the lexer stood when the current line began. */
  private lineBeganAtStatementLevel = true;
  private lineBeganAtStatementStart = true;

  /** Returns the rejection as soon as one is certain, else null. */
  feed(chunk: Buffer): PlainDumpInspection | null {
    let position = 0;
    for (;;) {
      const newline = chunk.indexOf(NEWLINE, position);
      const piece = chunk.subarray(position, newline === -1 ? chunk.length : newline);
      this.appendHead(piece);
      if (this.lexesCurrentLine()) this.lexer.write(piece);
      if (newline === -1) break;
      const rejection = this.endLine(this.offset + newline + 1);
      if (rejection) return rejection;
      position = newline + 1;
    }
    this.offset += chunk.length;
    return null;
  }

  finish(): PlainDumpInspection {
    if (this.offset > this.lineStart) {
      const rejection = this.endLine(this.offset);
      if (rejection) return rejection;
    }
    if (this.lineNumber < HEADER_LINES.length) return { ok: false, reason: NOT_PG_DUMP };
    if (this.state !== 'footer' || (this.restrict && !this.unrestrict)) return { ok: false, reason: INCOMPLETE };
    return { ok: true, omitRanges: [this.restrict?.range, this.unrestrict].filter((range): range is ByteRange => Boolean(range)) };
  }

  /** COPY data and what follows the footer are checked line by line only. */
  private lexesCurrentLine(): boolean {
    return this.state === 'preamble' || this.state === 'sql';
  }

  private appendHead(piece: Buffer): void {
    if (this.headLength >= LINE_HEAD_LIMIT || piece.length === 0) return;
    const kept = piece.subarray(0, LINE_HEAD_LIMIT - this.headLength);
    this.head.push(kept);
    this.headLength += kept.length;
  }

  private endLine(end: number): PlainDumpInspection | null {
    this.lineNumber += 1;
    this.lineHead = this.head.length === 1 ? this.head[0] : Buffer.concat(this.head, this.headLength);
    this.lineText = null;
    this.head = [];
    this.headLength = 0;
    const start = this.lineStart;
    this.lineStart = end;
    const lexed = this.lexesCurrentLine() ? this.lexer.endLine() : null;
    const rejection = this.checkLine(start, end, lexed);
    this.lineBeganAtStatementLevel = this.lexer.atStatementLevel;
    this.lineBeganAtStatementStart = this.lexer.atStatementStart;
    return rejection;
  }

  /**
   * The current line as text, decoded only when a check needs it: most lines
   * of a large dump are COPY rows or sit inside a literal. A trailing CR is
   * ignored, like psql does.
   */
  private text(): string {
    this.lineText ??= this.lineHead.toString('utf8').replace(/\r$/, '');
    return this.lineText;
  }

  private isBlankOrComment(): boolean {
    const text = this.text();
    return text.trim() === '' || text.startsWith('--');
  }

  private checkLine(start: number, end: number, lexed: LexedLine | null): PlainDumpInspection | null {
    const lineNumber = this.lineNumber;
    if (lineNumber <= HEADER_LINES.length) {
      return this.text() === HEADER_LINES[lineNumber - 1] ? null : { ok: false, reason: NOT_PG_DUMP };
    }

    if (this.state === 'copy') {
      if (isEndOfCopyData(this.lineHead)) this.state = 'sql';
      return null;
    }

    if (this.state === 'footer' || !lexed) {
      const match = UNRESTRICT_PATTERN.exec(this.text());
      if (match && this.restrict && match[1] === this.restrict.key && !this.unrestrict) {
        this.unrestrict = { start, end };
        return null;
      }
      if (this.isBlankOrComment()) return null;
      return { ok: false, reason: `The uploaded .sql file has content after the end of the dump (line ${lineNumber}). Only plain pg_dump output can be imported.` };
    }

    if (lexed.tagTooLong) {
      return { ok: false, reason: `The uploaded .sql file has a dollar-quote tag longer than 64 KiB on line ${lineNumber}. Only plain pg_dump output can be imported.` };
    }

    if (lexed.backslashColumn !== -1) {
      const match = this.state === 'preamble' && lexed.backslashColumn === 0 ? RESTRICT_PATTERN.exec(this.text()) : null;
      if (match && !this.restrict) {
        this.restrict = { key: match[1], range: { start, end } };
        return null;
      }
      return {
        ok: false,
        reason: `The uploaded .sql file contains a psql meta-command on line ${lineNumber} (${describeMetaCommand(this.lineHead, lexed.backslashColumn)}). Only plain pg_dump output can be imported.`,
      };
    }

    // Inside a literal these lines are data, not the footer or a COPY.
    if (this.lineBeganAtStatementLevel && this.text() === FOOTER_LINE) {
      this.state = 'footer';
      return null;
    }
    if (this.state === 'preamble' && this.isBlankOrComment()) return null;

    const isCopyFromStdin = this.lineBeganAtStatementStart
      && this.lexer.atStatementLevel
      && this.lexer.atStatementStart
      && COPY_FROM_STDIN_PATTERN.test(this.text());
    this.state = isCopyFromStdin ? 'copy' : 'sql';
    return null;
  }
}

/**
 * Check that an uploaded .sql is plain pg_dump output before anything is
 * dropped. On success, returns the byte ranges of pg_dump's own
 * `\restrict`/`\unrestrict` lines, which the guarded stream leaves out.
 */
export const inspectPlainDump = async (filePath: string): Promise<PlainDumpInspection> => {
  const scan = new PlainDumpScan();
  try {
    for await (const chunk of fs.createReadStream(filePath) as AsyncIterable<Buffer>) {
      const rejection = scan.feed(chunk);
      if (rejection) return rejection;
    }
  } catch {
    return { ok: false, reason: 'The uploaded file could not be read.' };
  }
  return scan.finish();
};

/** A key for psql's restricted mode the uploaded file cannot guess. */
export const createRestrictKey = (): string => crypto.randomBytes(32).toString('hex');

/**
 * The uploaded dump as psql should read it: our own `\restrict <key>` first,
 * then the file without the byte ranges `inspectPlainDump` returned. A read
 * error surfaces as an 'error' event (runCommand then kills psql before EOF).
 */
export const openGuardedPlainDump = (
  filePath: string,
  omitRanges: ReadonlyArray<ByteRange>,
  restrictKey: string,
): Readable => {
  const output = new PassThrough();
  // Consumers attach their own 'error' listener (runCommand does); this one
  // only keeps a stream nobody reads from crashing the process.
  output.on('error', () => undefined);
  const sorted = [...omitRanges].sort((a, b) => a.start - b.start);

  const copyRange = (start: number, end?: number): Promise<void> => new Promise((resolve, reject) => {
    if (output.destroyed) {
      reject(new Error('dump stream closed'));
      return;
    }
    if (end !== undefined && end <= start) {
      resolve();
      return;
    }
    // createReadStream's `end` is inclusive.
    const source = fs.createReadStream(filePath, { start, end: end === undefined ? undefined : end - 1 });
    // The consumer went away (psql exited, or the caller destroyed the
    // stream): stop reading instead of waiting forever on a paused source.
    const onOutputClose = (): void => {
      source.destroy();
      reject(new Error('dump stream closed'));
    };
    output.once('close', onOutputClose);
    source.on('error', (error) => {
      output.off('close', onOutputClose);
      reject(error);
    });
    source.on('end', () => {
      output.off('close', onOutputClose);
      resolve();
    });
    source.pipe(output, { end: false });
  });

  void (async () => {
    try {
      output.write(`\\restrict ${restrictKey}\n`);
      let position = 0;
      for (const range of sorted) {
        await copyRange(position, range.start);
        position = range.end;
      }
      await copyRange(position);
      output.end();
    } catch (error) {
      output.destroy(error as Error);
    }
  })();

  return output;
};

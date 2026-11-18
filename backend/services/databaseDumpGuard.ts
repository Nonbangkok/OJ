import crypto from 'crypto';
import fs from 'fs';
import { PassThrough, Readable } from 'stream';

/**
 * A2-06: an uploaded .sql is replayed by psql, which also executes
 * client-side meta-commands (`\!`, `\o |cmd`, `\copy ... program`, ...)
 * written anywhere outside a quoted string. Two layers keep those out:
 *
 *  1. `inspectPlainDump` (before maintenance mode starts) accepts only what
 *     pg_dump writes: its header and "dump complete" footer, no line that
 *     starts with a backslash outside COPY data, except pg_dump 18's own
 *     `\restrict <key>` / `\unrestrict <key>` pair. It exists to give a clear
 *     400; a line scan cannot see a meta-command placed mid-line.
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
/** Only the start of a line is examined; COPY rows can be megabytes long. */
const LINE_HEAD_LIMIT = 64 * 1024;
const BACKSLASH = 0x5c;
const NEWLINE = 0x0a;

const RESTRICT_PATTERN = /^\\restrict ([A-Za-z0-9]+)$/;
const UNRESTRICT_PATTERN = /^\\unrestrict ([A-Za-z0-9]+)$/;
const COPY_FROM_STDIN_PATTERN = /^COPY .+ FROM stdin;$/;

type Line = { text: string; startsWithBackslash: boolean; start: number; end: number };

/** Yield every line of the file (without its newline) with its byte range. */
async function* readLines(filePath: string): AsyncGenerator<Line> {
  let head: Buffer[] = [];
  let headLength = 0;
  let lineStart = 0;
  let chunkBase = 0;

  const appendHead = (piece: Buffer): void => {
    if (headLength >= LINE_HEAD_LIMIT || piece.length === 0) return;
    const kept = piece.subarray(0, LINE_HEAD_LIMIT - headLength);
    head.push(kept);
    headLength += kept.length;
  };
  const takeLine = (end: number): Line => {
    const bytes = Buffer.concat(head, headLength);
    head = [];
    headLength = 0;
    const line: Line = {
      // A trailing CR is ignored, like psql does.
      text: bytes.toString('utf8').replace(/\r$/, ''),
      startsWithBackslash: bytes[0] === BACKSLASH,
      start: lineStart,
      end,
    };
    lineStart = end;
    return line;
  };

  for await (const chunk of fs.createReadStream(filePath) as AsyncIterable<Buffer>) {
    let position = 0;
    for (;;) {
      const newline = chunk.indexOf(NEWLINE, position);
      if (newline === -1) {
        appendHead(chunk.subarray(position));
        break;
      }
      appendHead(chunk.subarray(position, newline));
      yield takeLine(chunkBase + newline + 1);
      position = newline + 1;
    }
    chunkBase += chunk.length;
  }
  if (chunkBase > lineStart) {
    yield takeLine(chunkBase);
  }
}

const describeMetaCommand = (text: string): string => text.split(/\s/, 1)[0].slice(0, 20);

/**
 * Check that an uploaded .sql is plain pg_dump output before anything is
 * dropped. On success, returns the byte ranges of pg_dump's own
 * `\restrict`/`\unrestrict` lines, which the guarded stream leaves out.
 */
export const inspectPlainDump = async (filePath: string): Promise<PlainDumpInspection> => {
  let lineNumber = 0;
  let state: 'preamble' | 'sql' | 'copy' | 'footer' = 'preamble';
  let restrict: { key: string; range: ByteRange } | null = null;
  let unrestrict: ByteRange | null = null;

  try {
    for await (const line of readLines(filePath)) {
      lineNumber += 1;
      if (lineNumber <= HEADER_LINES.length) {
        if (line.text !== HEADER_LINES[lineNumber - 1]) {
          return { ok: false, reason: 'The uploaded .sql file is not a pg_dump plain-text dump (it does not start with the "-- PostgreSQL database dump" header).' };
        }
        continue;
      }

      if (state === 'copy') {
        if (line.text === '\\.') state = 'sql';
        continue;
      }

      const isBlankOrComment = line.text.trim() === '' || line.text.startsWith('--');

      if (state === 'footer') {
        const match = UNRESTRICT_PATTERN.exec(line.text);
        if (match && restrict && match[1] === restrict.key && !unrestrict) {
          unrestrict = { start: line.start, end: line.end };
          continue;
        }
        if (isBlankOrComment && !line.startsWithBackslash) continue;
        return { ok: false, reason: `The uploaded .sql file has content after the end of the dump (line ${lineNumber}). Only plain pg_dump output can be imported.` };
      }

      if (line.startsWithBackslash) {
        const match = RESTRICT_PATTERN.exec(line.text);
        if (state === 'preamble' && match && !restrict) {
          restrict = { key: match[1], range: { start: line.start, end: line.end } };
          continue;
        }
        return {
          ok: false,
          reason: `The uploaded .sql file contains a psql meta-command on line ${lineNumber} (${describeMetaCommand(line.text)}). Only plain pg_dump output can be imported.`,
        };
      }

      if (line.text === FOOTER_LINE) {
        state = 'footer';
        continue;
      }
      if (isBlankOrComment) continue;

      state = COPY_FROM_STDIN_PATTERN.test(line.text) ? 'copy' : 'sql';
    }
  } catch {
    return { ok: false, reason: 'The uploaded file could not be read.' };
  }

  if (lineNumber < HEADER_LINES.length) {
    return { ok: false, reason: 'The uploaded .sql file is not a pg_dump plain-text dump (it does not start with the "-- PostgreSQL database dump" header).' };
  }
  if (state !== 'footer' || (restrict && !unrestrict)) {
    return { ok: false, reason: 'The uploaded .sql file is incomplete: it ends before the "PostgreSQL database dump complete" footer. Upload the whole file.' };
  }
  return { ok: true, omitRanges: [restrict?.range, unrestrict].filter((range): range is ByteRange => Boolean(range)) };
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

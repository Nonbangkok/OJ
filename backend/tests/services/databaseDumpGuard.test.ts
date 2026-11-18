import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { createRestrictKey, inspectPlainDump, openGuardedPlainDump } from '../../services/databaseDumpGuard';

/**
 * A2-06: what a plain-text upload must look like before the import starts,
 * and what psql is actually fed. The shape follows pg_dump 18 output.
 */
const DUMP_KEY = 'NgPlHR1JlWSBt3ewnP2lLJ3JDwQwHKe06uz8PwIjedtUIeYRA2ccLQYs4WAIkEU';

const pgDump18 = (body: string, key: string | null = DUMP_KEY): string => [
  '--',
  '-- PostgreSQL database dump',
  '--',
  '',
  ...(key ? [`\\restrict ${key}`, ''] : []),
  '-- Dumped from database version 18.7',
  '-- Dumped by pg_dump version 18.7',
  '',
  'SET statement_timeout = 0;',
  "SET client_encoding = 'UTF8';",
  '',
  body,
  '',
  '--',
  '-- PostgreSQL database dump complete',
  '--',
  '',
  ...(key ? [`\\unrestrict ${key}`, ''] : []),
].join('\n');

const TABLE_WITH_COPY = [
  'CREATE TABLE public.t (',
  '    id integer NOT NULL,',
  '    s text',
  ');',
  '',
  'COPY public.t (id, s) FROM stdin;',
  '1\t\\N',
  '\\N\t\\\\restrict not-a-command',
  '2\ta\\\\b',
  '\\.',
  '',
].join('\n');

describe('databaseDumpGuard (A2-06)', () => {
  let workDir: string;
  const write = (contents: string | Buffer): string => {
    const file = path.join(workDir, `dump-${Math.random().toString(36).slice(2)}.sql`);
    fs.writeFileSync(file, contents);
    return file;
  };
  const readAll = async (stream: Readable): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oj-dump-guard-'));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  describe('inspectPlainDump', () => {
    it('accepts pg_dump 18 output with its \\restrict pair and backslashes inside COPY data', async () => {
      const contents = pgDump18(TABLE_WITH_COPY);
      const result = await inspectPlainDump(write(contents));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Exactly pg_dump's own two lines are left out of psql's input.
      expect(result.omitRanges.map(({ start, end }) => contents.slice(start, end))).toEqual([
        `\\restrict ${DUMP_KEY}\n`,
        `\\unrestrict ${DUMP_KEY}\n`,
      ]);
    });

    it('accepts a dump from an older pg_dump without the \\restrict pair', async () => {
      const result = await inspectPlainDump(write(pgDump18(TABLE_WITH_COPY, null)));

      expect(result).toEqual({ ok: true, omitRanges: [] });
    });

    it('rejects a file that does not start like pg_dump output', async () => {
      const result = await inspectPlainDump(write('CREATE TABLE x (id int);\n'));

      expect(result).toEqual({ ok: false, reason: expect.stringContaining('not a pg_dump plain-text dump') });
    });

    it('rejects pg_dumpall output', async () => {
      const result = await inspectPlainDump(write('--\n-- PostgreSQL database cluster dump\n--\n'));

      expect(result.ok).toBe(false);
    });

    it.each([
      ['\\! touch /tmp/x', '\\!'],
      ['\\o | touch /tmp/x', '\\o'],
      ["\\copy (SELECT 1) TO PROGRAM 'touch /tmp/x'", '\\copy'],
      ['\\connect other_db', '\\connect'],
      [`\\unrestrict ${DUMP_KEY}`, '\\unrestrict'],
    ])('rejects a meta-command line in the SQL (%s)', async (line, command) => {
      const result = await inspectPlainDump(write(pgDump18(`SELECT 1;\n${line}\nSELECT 2;`)));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain('psql meta-command');
      expect(result.reason).toContain(command);
    });

    it('rejects a second \\restrict in the preamble', async () => {
      const contents = pgDump18('SELECT 1;').replace(`\\restrict ${DUMP_KEY}\n`, `\\restrict ${DUMP_KEY}\n\\restrict other\n`);

      expect((await inspectPlainDump(write(contents))).ok).toBe(false);
    });

    it('rejects anything but pg_dump\'s \\unrestrict after the footer', async () => {
      const contents = `${pgDump18('SELECT 1;')}\\! touch /tmp/x\n`;
      const result = await inspectPlainDump(write(contents));

      expect(result).toEqual({ ok: false, reason: expect.stringContaining('content after the end of the dump') });
    });

    it('rejects an \\unrestrict whose key differs from the \\restrict', async () => {
      const contents = pgDump18('SELECT 1;').replace(`\\unrestrict ${DUMP_KEY}`, '\\unrestrict someotherkey');

      expect((await inspectPlainDump(write(contents))).ok).toBe(false);
    });

    it('rejects a truncated upload (no footer, or cut inside COPY data)', async () => {
      const full = pgDump18(TABLE_WITH_COPY);
      const cutBeforeFooter = full.slice(0, full.indexOf('-- PostgreSQL database dump complete'));
      const cutInsideCopy = full.slice(0, full.indexOf('2\ta'));

      for (const contents of [cutBeforeFooter, cutInsideCopy]) {
        const result = await inspectPlainDump(write(contents));
        expect(result).toEqual({ ok: false, reason: expect.stringContaining('incomplete') });
      }
    });

    it('reports an unreadable upload', async () => {
      const result = await inspectPlainDump(path.join(workDir, 'missing.sql'));

      expect(result).toEqual({ ok: false, reason: 'The uploaded file could not be read.' });
    });

    it('handles COPY rows longer than a read chunk', async () => {
      const longRow = `1\t${'x'.repeat(300 * 1024)}`;
      const contents = pgDump18(`CREATE TABLE t (id int, s text);\nCOPY public.t (id, s) FROM stdin;\n${longRow}\n\\N\tz\n\\.\n`);

      expect((await inspectPlainDump(write(contents))).ok).toBe(true);
    });
  });

  /**
   * A2-06 follow-up: a backslash is a psql meta-command only at statement
   * level. Inside a string literal, a quoted identifier, a dollar-quoted body
   * or a comment it is data, and a pg_dump --inserts dump of LaTeX text has
   * whole lines that start with one.
   */
  describe('inspectPlainDump: SQL lexical state outside COPY', () => {
    const inspect = async (body: string) => inspectPlainDump(write(pgDump18(body)));
    const metaCommandReason = (line: number, command: string): string =>
      `The uploaded .sql file contains a psql meta-command on line ${line} (${command}). Only plain pg_dump output can be imported.`;
    /** Line number of `needle` inside pgDump18(body). */
    const lineOf = (body: string, needle: string): number =>
      pgDump18(body).slice(0, pgDump18(body).indexOf(needle)).split('\n').length;

    it.each([
      ['a multi-line literal with LaTeX lines (pg_dump --inserts)',
        "INSERT INTO public.statements VALUES (1, 'Statement\n\\begin{cases} x \\end{cases}\nend');"],
      ['doubled quotes and a trailing backslash inside the literal',
        "INSERT INTO public.statements VALUES (2, 'it''s\n\\frac{a}{b} ''quoted''\n\\');"],
      ['an E string with escaped quotes and backslashes',
        "INSERT INTO public.statements VALUES (3, E'a\\'b\n\\\\begin{x}\n\\'still inside\n\\\\');"],
      ['a dollar-quoted function body',
        "CREATE FUNCTION public.f() RETURNS text\n    LANGUAGE sql\n    AS $_$\nSELECT '\n\\begin{cases}'::text\n$_$;"],
      ['dollar quotes with another tag inside',
        'CREATE FUNCTION public.g() RETURNS text\n    LANGUAGE sql\n    AS $body$\nSELECT $x$\n\\x$x$ || $$\n\\$$\n$body$;'],
      ['a quoted identifier spanning lines',
        'CREATE TABLE public."odd\n\\name" (id integer);'],
      ['nested block comments and line comments',
        "/* outer\n\\one /* inner\n\\two */ still outer\n\\three */\nSELECT 1; -- \\! not a command\n-- \\! a comment line"],
      ['lines that look like COPY and the footer inside a literal',
        "INSERT INTO public.statements VALUES (4, 'COPY public.t (id) FROM stdin;\n\\N\n\\.\n-- PostgreSQL database dump complete\n');\nSELECT 2;"],
      ['a literal right before real COPY data',
        `INSERT INTO public.statements VALUES (5, 'a\n\\b');\n${TABLE_WITH_COPY}`],
    ])('accepts %s', async (_name, body) => {
      expect(await inspect(body)).toEqual({ ok: true, omitRanges: expect.any(Array) });
    });

    it.each([
      ['the line after a multi-line literal closes',
        "INSERT INTO public.statements VALUES (1, 'Statement\n\\begin{cases}\nend');\n\\! touch /tmp/x", '\\! touch', '\\!'],
      ['the same line, after the literal',
        "INSERT INTO public.statements VALUES (1, 'a\n\\b');  \\! touch /tmp/x", "\\b');", '\\!'],
      ['an indented line',
        'SELECT 1;\n   \\o | touch /tmp/x', '   \\o', '\\o'],
      ['after a literal that ends in a backslash (standard strings)',
        "SELECT 'a\\';\n\\! touch /tmp/x", '\\! touch', '\\!'],
      ['after a doubled quote and the real closing quote',
        "SELECT 'it''s\n';\n\\copy t TO PROGRAM 'x'", '\\copy', '\\copy'],
      ['after an E string whose escaped quote did not close it',
        "SELECT E'a\\'\n\\b';\n\\! touch /tmp/x", '\\! touch', '\\!'],
      ['after a dollar-quoted body closes',
        'SELECT $a$ $b$\n\\x $a$;\n\\! touch /tmp/x', '\\! touch', '\\!'],
      ['after nested block comments close',
        '/* /* */ still comment\n\\x */\n\\! touch /tmp/x', '\\! touch', '\\!'],
      ['after a quoted identifier closes',
        'SELECT 1 AS "a""\n\\b";\n\\! touch /tmp/x', '\\! touch', '\\!'],
      ['after a COPY-looking line inside a literal (no COPY data follows)',
        "SELECT '\nCOPY probe FROM stdin;\n';\n\\! touch /tmp/x\n\\.", '\\! touch', '\\!'],
    ])('rejects a meta-command at statement level: %s', async (_name, body, needle, command) => {
      expect(await inspect(body)).toEqual({ ok: false, reason: metaCommandReason(lineOf(body, needle), command) });
    });

    it('reports a dump that ends inside a literal as incomplete', async () => {
      const result = await inspect("INSERT INTO public.statements VALUES (1, 'never closed\n\\begin{x}");

      expect(result).toEqual({ ok: false, reason: expect.stringContaining('incomplete') });
    });

    it('follows a dollar-quote tag split across two read chunks', async () => {
      // fs streams read 64 KiB at a time; put the closing tag on that boundary.
      const prefix = 'CREATE FUNCTION public.h() RETURNS text\n    LANGUAGE sql\n    AS $tagname$\n\\body\n';
      const framedPrefix = pgDump18(prefix + '@').split('@')[0];
      const padding = 'x'.repeat(64 * 1024 - framedPrefix.length - 3);
      const accepted = `${prefix}${padding}\n$tagname$;\nSELECT 1;`;
      const rejected = `${prefix}${padding}\n$tagname$;\n\\! touch /tmp/x`;

      const closingTag = pgDump18(accepted).lastIndexOf('$tagname$');
      expect(closingTag).toBeLessThan(64 * 1024);
      expect(closingTag + '$tagname$'.length).toBeGreaterThan(64 * 1024);
      expect((await inspect(accepted)).ok).toBe(true);
      expect(await inspect(rejected)).toEqual({ ok: false, reason: metaCommandReason(lineOf(rejected, '\\! touch'), '\\!') });
    });

    it('accepts a dump with CRLF line endings, literal and COPY data included', async () => {
      const body = `INSERT INTO public.statements VALUES (1, 'a\n\\begin{x}\nb');\n${TABLE_WITH_COPY}`;
      const contents = pgDump18(body).replace(/\n/g, '\r\n');

      expect((await inspectPlainDump(write(contents))).ok).toBe(true);
    });

    it.each([
      ['an indented \\restrict', pgDump18('SELECT 1;', null).replace('\n\n-- Dumped from', `\n  \\restrict ${DUMP_KEY}\n-- Dumped from`), '\\restrict'],
      ['psql\'s \\; separator, which pg_dump never writes', pgDump18('SELECT 1 \\; SELECT 2;'), '\\;'],
    ])('rejects %s', async (_name, contents, command) => {
      const result = await inspectPlainDump(write(contents));

      expect(result).toEqual({ ok: false, reason: expect.stringContaining(`psql meta-command on line`) });
      if (!result.ok) expect(result.reason).toContain(`(${command})`);
    });

    it('rejects a dollar-quote tag it cannot follow', async () => {
      const result = await inspect(`SELECT $${'a'.repeat(70 * 1024)}$ body $${'a'.repeat(70 * 1024)}$;`);

      expect(result).toEqual({ ok: false, reason: expect.stringContaining('dollar-quote tag longer than 64 KiB') });
    });

    it('scans a literal longer than a read chunk', async () => {
      const body = `INSERT INTO public.statements VALUES (1, '${'y'.repeat(200 * 1024)}\n\\begin{x}\n${'z'.repeat(200 * 1024)}');\n\\! touch /tmp/x`;

      expect(await inspect(body)).toEqual({ ok: false, reason: metaCommandReason(lineOf(body, '\\! touch'), '\\!') });
    });
  });

  describe('openGuardedPlainDump', () => {
    it('prefixes its own \\restrict and drops only pg_dump\'s pair, byte for byte', async () => {
      // A raw CR inside a function body and a row longer than a read chunk
      // must reach psql unchanged.
      const body = `CREATE FUNCTION f() RETURNS text AS $$ SELECT 'a\rb' $$ LANGUAGE sql;\n${TABLE_WITH_COPY}COPY public.t (id, s) FROM stdin;\n3\t${'y'.repeat(200 * 1024)}\n\\.\n`;
      const contents = pgDump18(body);
      const file = write(contents);
      const inspection = await inspectPlainDump(file);
      if (!inspection.ok) throw new Error(inspection.reason);
      const key = createRestrictKey();

      const fed = (await readAll(openGuardedPlainDump(file, inspection.omitRanges, key))).toString('utf8');

      const expected = `\\restrict ${key}\n${contents
        .replace(`\\restrict ${DUMP_KEY}\n`, '')
        .replace(`\\unrestrict ${DUMP_KEY}\n`, '')}`;
      expect(fed).toBe(expected);
    });

    it('uses a fresh key the dump cannot know', () => {
      const first = createRestrictKey();
      expect(first).toMatch(/^[0-9a-f]{64}$/);
      expect(createRestrictKey()).not.toBe(first);
    });

    it('surfaces a read error on the stream', async () => {
      const stream = openGuardedPlainDump(path.join(workDir, 'missing.sql'), [], createRestrictKey());

      await expect(readAll(stream)).rejects.toThrow(/ENOENT/);
    });

    it('stops reading when the consumer destroys the stream', async () => {
      const file = write(pgDump18(`SELECT '${'z'.repeat(1024 * 1024)}';`));
      const stream = openGuardedPlainDump(file, [], createRestrictKey());
      await new Promise((resolve) => stream.once('readable', resolve));

      stream.destroy();

      await new Promise((resolve) => setImmediate(resolve));
      expect(stream.destroyed).toBe(true);
    });
  });
});

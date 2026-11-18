import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { getDatabaseImportProgress, startDatabaseImport } from '../../services/adminDatabaseService';
import { endMaintenanceMode } from '../../services/maintenanceMode';

jest.unmock('pg');

// The import tears down and restores the `public` schema of the database the
// app is configured for, so this suite points the app (db pool + env) at a
// dedicated throwaway database on the integration server.
jest.mock('../../db', () => {
  const actualPg = jest.requireActual('pg');
  const url = new URL(process.env.INTEGRATION_DATABASE_URL ?? 'postgres://unused:unused@127.0.0.1:1/unused');
  url.pathname = `/oj_import_meta_${process.pid}`;
  const connectionString = url.toString();
  const pool = new actualPg.Pool({ connectionString });
  return {
    pool,
    query: (text: string, params?: unknown[]) => pool.query(text, params),
    createMigrationsPool: () => new actualPg.Pool({ connectionString }),
    withTransaction: async (body: (client: unknown) => Promise<unknown>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await body(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
});
jest.mock('../../config/env', () => {
  const actual = jest.requireActual('../../config/env');
  const url = new URL(process.env.INTEGRATION_DATABASE_URL ?? 'postgres://unused:unused@127.0.0.1:1/unused');
  const database = `oj_import_meta_${process.pid}`;
  const dedicated = new URL(url.toString());
  dedicated.pathname = `/${database}`;
  return {
    ...actual,
    env: {
      ...actual.env,
      DATABASE_URL: dedicated.toString(),
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: database,
    },
  };
});
jest.mock('../../services/contestScheduler', () => ({
  __esModule: true,
  default: { pause: jest.fn(), resume: jest.fn() },
}));

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const hasTool = (tool: string): boolean => spawnSync(tool, ['--version']).status === 0;
const enabled = Boolean(integrationDatabaseUrl) && ['psql', 'pg_dump', 'pg_restore'].every(hasTool);

/** pg_dump's frame around `body`, so the upload passes the header/footer checks. */
const pgDumpFrame = (body: string): string =>
  `--\n-- PostgreSQL database dump\n--\n\nSET client_encoding = 'UTF8';\n\n${body}\n\n--\n-- PostgreSQL database dump complete\n--\n\n`;

/**
 * A2-06: an uploaded .sql is replayed by psql, which honours client-side
 * meta-commands. A restore must never run a shell command named by the
 * uploaded file inside the backend container: a meta-command line is
 * rejected up front (400), and one the line scan cannot see is refused by
 * psql's restricted mode, failing the import with the live database kept.
 */
(enabled ? describe : describe.skip)('database import does not execute psql meta-commands from the upload (A2-06)', () => {
  jest.setTimeout(120_000);
  const databaseName = `oj_import_meta_${process.pid}`;
  const admin = new pg.Pool({ connectionString: integrationDatabaseUrl });
  let workDir = '';

  const waitForImport = async (jobId: string, token: string): Promise<{ status: string; message: string }> => {
    const deadline = Date.now() + 90_000;
    for (;;) {
      const progress = getDatabaseImportProgress(jobId, token);
      if (progress && progress !== 'unauthorized' && (progress.status === 'completed' || progress.status === 'failed')) {
        return progress;
      }
      if (Date.now() > deadline) throw new Error(`import did not finish: ${JSON.stringify(progress)}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  const upload = (contents: string): string => {
    const uploaded = path.join(workDir, `upload-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
    fs.writeFileSync(uploaded, contents);
    return uploaded;
  };

  const newMarker = (): string => path.join(workDir, `ran-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const liveUsers = async (): Promise<string[]> =>
    (await db.query('SELECT username FROM users ORDER BY username')).rows.map((row) => row.username as string);

  beforeAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${databaseName}`);
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oj-import-meta-'));
  });

  beforeEach(async () => {
    endMaintenanceMode();
    await db.query('DROP SCHEMA IF EXISTS public CASCADE');
    await db.query('CREATE SCHEMA public');
    await runMigrationsFromPool(db.pool);
    await db.query("INSERT INTO users (username, password_hash, role) VALUES ('live-admin', 'x', 'admin')");
  });

  afterAll(async () => {
    endMaintenanceMode();
    await db.pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.end();
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  });

  const metaCommandLines: Array<[string, (marker: string) => string]> = [
    ['\\! shell escape', (marker) => `\\! touch ${marker}`],
    ['\\o pipe to a command', (marker) => `\\o | touch ${marker}\nSELECT 1;\n\\o`],
    ['\\copy ... to program', (marker) => `\\copy (SELECT 1) TO PROGRAM 'touch ${marker}'`],
  ];

  it.each(metaCommandLines)('%s in an uploaded .sql never runs (bare file)', async (_name, line) => {
    const marker = newMarker();

    const started = await startDatabaseImport('backup.sql', upload(`CREATE TABLE probe (id int);\n${line(marker)}\nSELECT 1;\n`));
    if (started.kind === 'ok') await waitForImport(started.jobId, started.token);

    expect(started.kind).toBe('invalid_dump');
    expect(fs.existsSync(marker)).toBe(false);
  });

  it.each(metaCommandLines)('%s on its own line inside a pg_dump frame is rejected with a clear message', async (_name, line) => {
    const marker = newMarker();

    const started = await startDatabaseImport('backup.sql', upload(pgDumpFrame(`CREATE TABLE probe (id int);\n${line(marker)}\nSELECT 1;`)));

    expect(started).toEqual({ kind: 'invalid_dump', message: expect.stringContaining('psql meta-command') });
    expect(fs.existsSync(marker)).toBe(false);
    expect(await liveUsers()).toEqual(['live-admin']);
  });

  // A2-06 follow-up: the scan tracks SQL lexical state, so a meta-command
  // after SQL on the same line, or behind a COPY line that is really inside a
  // string literal, is rejected up front too.
  const metaCommandsAtStatementLevel: Array<[string, (marker: string) => string]> = [
    ['a meta-command after SQL on the same line', (marker) => `CREATE TABLE probe (id int); \\! touch ${marker}\nSELECT 1;`],
    ['a meta-command after a fake COPY inside a string literal', (marker) => `SELECT '\nCOPY probe FROM stdin;\n';\n\\! touch ${marker}\n\\.`],
  ];

  it.each(metaCommandsAtStatementLevel)('%s is rejected up front', async (_name, body) => {
    const marker = newMarker();

    const started = await startDatabaseImport('backup.sql', upload(pgDumpFrame(body(marker))));

    expect(started).toEqual({ kind: 'invalid_dump', message: expect.stringContaining('psql meta-command') });
    expect(fs.existsSync(marker)).toBe(false);
    expect(await liveUsers()).toEqual(['live-admin']);
  });

  // These pass the scan, which assumes standard_conforming_strings = on (as
  // pg_dump writes) and does not model psql's BEGIN ATOMIC heuristic;
  // psql's restricted mode is what stops them.
  const hiddenMetaCommands: Array<[string, (marker: string) => string]> = [
    ['a meta-command the scan reads as string content after the dump turned standard_conforming_strings off',
      (marker) => `SET standard_conforming_strings = off;\nSELECT 'a\\';\nSELECT ';\n\\! touch ${marker}\n';`],
    ['a meta-command after a COPY line inside a BEGIN ATOMIC function body',
      (marker) => `CREATE FUNCTION probe_f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1;\nCOPY probe FROM stdin;\n\\! touch ${marker}\n\\.\nEND;`],
  ];

  it.each(hiddenMetaCommands)('%s is refused by psql and the live database is kept', async (_name, body) => {
    const marker = newMarker();

    const started = await startDatabaseImport('backup.sql', upload(pgDumpFrame(body(marker))));
    if (started.kind !== 'ok') throw new Error(`expected the scan to accept this upload, got ${started.kind}`);
    const outcome = await waitForImport(started.jobId, started.token);

    expect(fs.existsSync(marker)).toBe(false);
    expect(outcome.status).toBe('failed');
    expect(outcome.message).toContain('backslash commands are restricted');
    expect(outcome.message).toContain('the previous database was restored');
    expect(await liveUsers()).toEqual(['live-admin']);
  });

  describe('a real pg_dump --inserts dump of text with lines that start with a backslash', () => {
    // LaTeX in a statement: whole lines inside the literal start with "\".
    const latexValues = [
      'Statement\n\\begin{cases} x \\end{cases}\nend',
      "\\frac{1}{2}\n\\\\ a doubled backslash, it's ''quoted''\n\\",
      '\\! looks like a shell escape but is data\n\\o | not a pipe\n\\.',
    ];

    const dumpWithInserts = (): string => {
      const url = new URL(integrationDatabaseUrl!);
      const outFile = path.join(workDir, `inserts-${Date.now()}.sql`);
      const result = spawnSync('pg_dump', [
        '-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', databaseName,
        '--inserts', '-F', 'p', '-f', outFile,
      ], { encoding: 'utf8', env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) } });
      if (result.status !== 0) throw new Error(`pg_dump failed: ${result.stderr}`);
      return fs.readFileSync(outFile, 'utf8');
    };

    const storedValues = async (): Promise<string[]> =>
      (await db.query('SELECT body FROM latex_statements ORDER BY id')).rows.map((row) => row.body as string);

    beforeEach(async () => {
      await db.query('CREATE TABLE latex_statements (id int PRIMARY KEY, body text NOT NULL)');
      for (const [index, value] of latexValues.entries()) {
        await db.query('INSERT INTO latex_statements VALUES ($1, $2)', [index + 1, value]);
      }
    });

    it('is accepted and restores every value byte for byte', async () => {
      const dump = dumpWithInserts();
      // The dump really has such lines outside any COPY block.
      expect(dump).not.toContain('FROM stdin;');
      expect(dump.split('\n').filter((line) => line.startsWith('\\begin{cases}') || line.startsWith('\\o | not a pipe'))).toHaveLength(2);
      await db.query("UPDATE latex_statements SET body = 'changed after the dump'");

      const started = await startDatabaseImport('backup.sql', upload(dump));
      if (started.kind !== 'ok') throw new Error(`import did not start: ${JSON.stringify(started)}`);
      const outcome = await waitForImport(started.jobId, started.token);

      expect(outcome).toEqual({ status: 'completed', message: 'Database imported successfully.' });
      expect(await storedValues()).toEqual(latexValues);
      expect(await liveUsers()).toEqual(['live-admin']);
    });

    it.each([
      ['on the line after the literal closes', (dump: string, command: string) =>
        dump.replace(/(INSERT INTO public\.latex_statements VALUES \(1, [^;]*;\n)/, `$1${command}\n`)],
      ['on the same line, right after the literal', (dump: string, command: string) =>
        dump.replace(/(INSERT INTO public\.latex_statements VALUES \(1, [^;]*;)/, `$1 ${command}`)],
    ])('still rejects a meta-command %s', async (_name, inject) => {
      const marker = newMarker();
      const dump = dumpWithInserts();
      const tampered = inject(dump, `\\! touch ${marker}`);
      expect(tampered).not.toBe(dump);

      const started = await startDatabaseImport('backup.sql', upload(tampered));

      expect(started).toEqual({ kind: 'invalid_dump', message: expect.stringMatching(/psql meta-command on line \d+ \(\\!\)/) });
      expect(fs.existsSync(marker)).toBe(false);
      expect(await storedValues()).toEqual(latexValues);
    });
  });
});

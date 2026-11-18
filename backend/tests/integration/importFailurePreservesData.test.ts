import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import * as db from '../../db';
import { migrations } from '../../migrations';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { runCommand } from '../../utils/runCommand';
import {
  buildDatabaseExportRequest,
  getDatabaseImportProgress,
  startDatabaseImport,
} from '../../services/adminDatabaseService';
import { endMaintenanceMode } from '../../services/maintenanceMode';

jest.unmock('pg');

// The import tears down and restores the `public` schema of the database the
// app is configured for, so this suite points the app (db pool + env) at a
// dedicated throwaway database created on the integration server — never the
// shared integration database's public schema, never the app's own database.
jest.mock('../../db', () => {
  const actualPg = jest.requireActual('pg');
  const url = new URL(process.env.INTEGRATION_DATABASE_URL ?? 'postgres://unused:unused@127.0.0.1:1/unused');
  url.pathname = `/oj_import_failure_${process.pid}`;
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
  const database = `oj_import_failure_${process.pid}`;
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

type Outcome = { status: string; message: string };

/**
 * A2-02: "Replace database" must never leave the site without its data or
 * its session table. An upload that cannot restore cleanly (not a pg
 * archive, a dump from an install with a different owner role, a backup the
 * migrations cannot bring forward, ...) leaves the live database — data AND
 * sessions — exactly as it was, so the admin can still log in and retry.
 */
(enabled ? describe : describe.skip)('database import failure keeps the live database (A2-02)', () => {
  jest.setTimeout(120_000);
  const databaseName = `oj_import_failure_${process.pid}`;
  const admin = new pg.Pool({ connectionString: integrationDatabaseUrl });
  let workDir = '';

  const waitForImport = async (jobId: string, token: string): Promise<Outcome> => {
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

  const importFile = async (originalName: string, contents: string | Buffer): Promise<Outcome> => {
    const uploaded = path.join(workDir, `upload-${Date.now()}-${originalName}`);
    fs.writeFileSync(uploaded, contents);
    const started = await startDatabaseImport(originalName, uploaded);
    if (started.kind !== 'ok') throw new Error(`import did not start: ${started.kind}`);
    return waitForImport(started.jobId, started.token);
  };

  /** The app's own export (pg_dump -F p, user_sessions excluded). */
  const exportDatabase = async (): Promise<string> => {
    const { command, dumpFilePath } = buildDatabaseExportRequest();
    await runCommand(command);
    const contents = fs.readFileSync(dumpFilePath, 'utf8');
    fs.unlinkSync(dumpFilePath);
    return contents;
  };

  const resetLiveDatabase = async (applied = migrations): Promise<void> => {
    await db.query('DROP SCHEMA IF EXISTS public CASCADE');
    await db.query('CREATE SCHEMA public');
    await runMigrationsFromPool(db.pool, applied);
  };

  const usernames = async (): Promise<string[]> =>
    (await db.query('SELECT username FROM users ORDER BY username')).rows.map((row) => row.username as string);

  const sessionTableExists = async (): Promise<boolean> =>
    (await db.query("SELECT to_regclass('public.user_sessions') IS NOT NULL AS present")).rows[0].present as boolean;

  const liveSessionSurvived = async (): Promise<boolean> =>
    (await db.query("SELECT 1 FROM user_sessions WHERE sid = 'live-session'")).rows.length === 1;

  const safetyCopyDirs = (): string[] => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('oj-db-import-'));

  beforeAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${databaseName}`);
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oj-import-failure-'));
  });

  beforeEach(async () => {
    endMaintenanceMode();
    await resetLiveDatabase();
    await db.query("INSERT INTO users (username, password_hash, role) VALUES ('live-admin', 'x', 'admin')");
    await db.query("INSERT INTO user_sessions (sid, sess, expire) VALUES ('live-session', '{}', NOW() + INTERVAL '1 day')");
  });

  afterAll(async () => {
    endMaintenanceMode();
    await db.pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.end();
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('rejects a .tar upload that is not a pg archive before touching anything', async () => {
    const uploaded = path.join(workDir, 'not-an-archive.tar');
    fs.writeFileSync(uploaded, 'this is not a pg_dump archive\n');

    const started = await startDatabaseImport('backup.tar', uploaded);

    expect(started).toEqual({ kind: 'invalid_dump', message: expect.stringContaining('not a PostgreSQL archive') });
    expect(await usernames()).toEqual(['live-admin']);
    expect(await liveSessionSurvived()).toBe(true);
  });

  it('a .sql dump that aborts part-way (owner role from another install) leaves the live database intact', async () => {
    const dump = await exportDatabase();
    // Same schema, made by an install whose POSTGRES_USER differs: pg_dump
    // emits `ALTER ... OWNER TO <that role>` right after each CREATE.
    const foreignDump = dump.replace(/OWNER TO [^;]+;/g, 'OWNER TO oj_import_role_from_another_install;');
    expect(foreignDump).not.toBe(dump);
    await db.query("INSERT INTO users (username, password_hash, role) VALUES ('created-after-export', 'x', 'user')");
    const before = safetyCopyDirs();

    const outcome = await importFile('backup.sql', foreignDump);

    expect(outcome.status).toBe('failed');
    expect(outcome.message).toContain('the previous database was restored');
    expect(outcome.message).toContain('oj_import_role_from_another_install');
    expect(await usernames()).toEqual(['created-after-export', 'live-admin']);
    expect(await sessionTableExists()).toBe(true);
    // The safety copy holds live sessions too: the admin stays logged in.
    expect(await liveSessionSurvived()).toBe(true);
    // ...and it is removed once the database is back.
    expect(safetyCopyDirs()).toEqual(before);
  });

  it('a custom-format .dump with an object owned by a role this install lacks restores (owners are skipped)', async () => {
    const foreignRole = `oj_import_foreign_owner_${process.pid}`;
    const archivePath = path.join(workDir, `foreign-${Date.now()}.dump`);
    const url = new URL(integrationDatabaseUrl!);
    await admin.query(`DROP ROLE IF EXISTS ${foreignRole}`);
    await admin.query(`CREATE ROLE ${foreignRole}`);
    try {
      await db.query("INSERT INTO users (username, password_hash, role) VALUES ('in-archive', 'x', 'user')");
      await db.query(`ALTER TABLE collections OWNER TO ${foreignRole}`);
      const dump = spawnSync('pg_dump', [
        '-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', databaseName,
        '--exclude-table=user_sessions', '-F', 'c', '-f', archivePath,
      ], { encoding: 'utf8', env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) } });
      if (dump.status !== 0) throw new Error(`pg_dump failed: ${dump.stderr}`);
      await resetLiveDatabase();
      await db.query("INSERT INTO users (username, password_hash, role) VALUES ('live-admin', 'x', 'admin')");
    } finally {
      await db.query('ALTER TABLE IF EXISTS collections OWNER TO CURRENT_USER').catch(() => undefined);
      await admin.query(`DROP ROLE IF EXISTS ${foreignRole}`);
    }

    const outcome = await importFile('backup.dump', fs.readFileSync(archivePath));

    expect(outcome).toEqual({ status: 'completed', message: 'Database imported successfully.' });
    expect(await usernames()).toEqual(['in-archive', 'live-admin']);
    expect(await sessionTableExists()).toBe(true);
  });

  it('a backup the migrations cannot bring forward is rolled back to the live database', async () => {
    // Taken before 0018, with two usernames that differ only in case: 0018's
    // case-insensitive unique index cannot be built on the restored rows.
    await resetLiveDatabase(migrations.filter((migration) => migration.version < '0018'));
    await db.query("INSERT INTO users (username, password_hash, role) VALUES ('Alice', 'x', 'user'), ('alice', 'x', 'user')");
    const dump = await exportDatabase();
    await resetLiveDatabase();
    await db.query("INSERT INTO users (username, password_hash, role) VALUES ('live-admin', 'x', 'admin')");
    await db.query("INSERT INTO user_sessions (sid, sess, expire) VALUES ('live-session', '{}', NOW() + INTERVAL '1 day')");

    const outcome = await importFile('backup.sql', dump);

    expect(outcome.status).toBe('failed');
    expect(outcome.message).toContain('the previous database was restored');
    expect(await usernames()).toEqual(['live-admin']);
    expect(await liveSessionSurvived()).toBe(true);
    const latest = (await db.query('SELECT MAX(version) AS version FROM schema_migrations')).rows[0].version;
    expect(latest).toBe(migrations[migrations.length - 1].version);
  });

  it('a self-export taken before migration 0018 restores and is migrated forward', async () => {
    // An older backup: its schema stops at 0017, and like every export it has
    // no user_sessions table — 0018 alters that table during the post-restore
    // migration step, so the session table must exist before migrations run.
    await resetLiveDatabase(migrations.filter((migration) => migration.version < '0018'));
    await db.query("INSERT INTO users (username, password_hash, role) VALUES ('old-backup-user', 'x', 'admin')");
    const dump = await exportDatabase();
    await resetLiveDatabase();
    await db.query("INSERT INTO users (username, password_hash, role) VALUES ('live-admin', 'x', 'admin')");

    const outcome = await importFile('backup.sql', dump);

    expect(outcome).toEqual({ status: 'completed', message: expect.any(String) });
    expect(await usernames()).toEqual(['old-backup-user']);
    expect(await sessionTableExists()).toBe(true);
    const latest = (await db.query('SELECT MAX(version) AS version FROM schema_migrations')).rows[0].version;
    expect(latest).toBe(migrations[migrations.length - 1].version);
  });

  it('a valid self-export (pg_dump 18, with its \\restrict pair) still restores and recreates the session table', async () => {
    const dump = await exportDatabase();
    expect(dump).toMatch(/^\\restrict [A-Za-z0-9]+$/m);
    await db.query("INSERT INTO users (username, password_hash, role) VALUES ('created-after-export', 'x', 'user')");
    const before = safetyCopyDirs();

    const outcome = await importFile('backup.sql', dump);

    expect(outcome).toEqual({ status: 'completed', message: 'Database imported successfully.' });
    expect(await usernames()).toEqual(['live-admin']);
    expect(await sessionTableExists()).toBe(true);
    expect(safetyCopyDirs()).toEqual(before);
  });
});

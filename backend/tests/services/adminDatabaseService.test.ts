import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import express, { Express } from 'express';
import * as db from '../../db';
import { runCommand } from '../../utils/runCommand';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { dropAllTablesForImport } from '../../services/adminQueryService';
import contestScheduler from '../../services/contestScheduler';
import {
  beginMaintenanceMode,
  endMaintenanceMode,
  isMaintenanceActive,
  maintenanceGate,
} from '../../services/maintenanceMode';
import { startDatabaseImport, getDatabaseImportProgress } from '../../services/adminDatabaseService';

jest.mock('../../db', () => {
  const query = jest.fn();
  return {
    query,
    pool: { query, connect: jest.fn() },
    createMigrationsPool: jest.fn(() => ({ connect: jest.fn(), end: jest.fn() })),
  };
});
jest.mock('../../utils/runCommand', () => ({ runCommand: jest.fn() }));
jest.mock('../../scripts/migrate', () => ({ runMigrationsFromPool: jest.fn() }));
jest.mock('../../services/adminQueryService', () => ({ dropAllTablesForImport: jest.fn() }));
jest.mock('../../services/contestScheduler', () => ({
  __esModule: true,
  default: { pause: jest.fn(), resume: jest.fn() },
}));

describe('maintenanceMode (DB-05)', () => {
  afterEach(() => {
    endMaintenanceMode();
  });

  it('claims and releases the window exactly once', () => {
    expect(beginMaintenanceMode()).toBe(true);
    expect(isMaintenanceActive()).toBe(true);
    // A second claim while active is rejected.
    expect(beginMaintenanceMode()).toBe(false);
    endMaintenanceMode();
    expect(isMaintenanceActive()).toBe(false);
    // Re-claimable after release; extra end() calls are safe.
    expect(beginMaintenanceMode()).toBe(true);
    endMaintenanceMode();
    endMaintenanceMode();
  });

  describe('maintenanceGate middleware', () => {
    let app: Express;

    beforeEach(() => {
      endMaintenanceMode();
      app = express();
      app.use(maintenanceGate);
      app.get('/problems', (_req, res) => res.json({ ok: true }));
      app.get('/health/live', (_req, res) => res.json({ ok: true }));
      app.get('/admin/database/import-progress/:jobId', (_req, res) => res.json({ status: 'pending' }));
    });

    it('lets requests through when inactive', async () => {
      const res = await request(app).get('/problems');
      expect(res.status).toBe(200);
    });

    it('returns 503 for every request while active', async () => {
      beginMaintenanceMode();

      const res = await request(app).get('/problems');
      expect(res.status).toBe(503);
      expect(res.body.message).toContain('maintenance');
    });

    it('keeps health checks and import-progress reachable during maintenance', async () => {
      beginMaintenanceMode();

      expect((await request(app).get('/health/live')).status).toBe(200);
      expect((await request(app).get('/admin/database/import-progress/job-1')).status).toBe(200);
    });
  });
});

const MINIMAL_DUMP = '--\n-- PostgreSQL database dump\n--\n\nSELECT 1;\n\n--\n-- PostgreSQL database dump complete\n--\n';

type RunCommandCall = { executable: string; args: string[]; env?: Record<string, string | undefined>; stdin?: unknown };
const commandCalls = (): RunCommandCall[] => (runCommand as jest.Mock).mock.calls.map(([command]) => command as RunCommandCall);

describe('startDatabaseImport (DB-05 / ADMIN-003 / A2-02)', () => {
  let workDir: string;
  let callOrder: string[];

  const writeUpload = (name: string, contents: string = MINIMAL_DUMP): string => {
    const uploaded = path.join(workDir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
    fs.writeFileSync(uploaded, contents);
    return uploaded;
  };

  const waitForOutcome = async (jobId: string, token: string): Promise<{ status: string; message: string }> => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const progress = getDatabaseImportProgress(jobId, token);
      if (progress && progress !== 'unauthorized' && ['completed', 'failed'].includes(progress.status)) return progress;
      if (Date.now() > deadline) throw new Error(`import did not finish: ${JSON.stringify(progress)}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  const importAndWait = async (name: string, contents?: string) => {
    const uploaded = writeUpload(name, contents);
    const started = await startDatabaseImport(name, uploaded);
    if (started.kind !== 'ok') throw new Error(`import did not start: ${started.kind}`);
    return { uploaded, outcome: await waitForOutcome(started.jobId, started.token) };
  };

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oj-import-unit-'));
    endMaintenanceMode();
    jest.clearAllMocks();
    callOrder = [];
    (db.query as jest.Mock).mockImplementation(async (sql: string) => {
      if (/CREATE TABLE IF NOT EXISTS user_sessions/.test(sql)) callOrder.push('ensure-sessions');
      return { rows: [] };
    });
    (runCommand as jest.Mock).mockImplementation(async (command: RunCommandCall) => {
      callOrder.push(command.executable);
    });
    (runMigrationsFromPool as jest.Mock).mockImplementation(async () => { callOrder.push('migrate'); return []; });
    (dropAllTablesForImport as jest.Mock).mockImplementation(async () => { callOrder.push('drop'); });
  });

  afterEach(() => {
    endMaintenanceMode();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('rejects a second import while one is running', async () => {
    // Hold the import in flight on the schema drop.
    let releaseDrop!: () => void;
    (dropAllTablesForImport as jest.Mock).mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseDrop = resolve; }),
    );

    const first = await startDatabaseImport('backup.sql', writeUpload('backup.sql'));
    expect(first).toMatchObject({ kind: 'ok', jobId: expect.any(String), token: expect.any(String) });

    const secondUpload = writeUpload('backup2.sql');
    const second = await startDatabaseImport('backup2.sql', secondUpload);
    expect(second).toEqual({ kind: 'import_in_progress' });
    expect(fs.existsSync(secondUpload)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseDrop();
    if (first.kind === 'ok') await waitForOutcome(first.jobId, first.token);
    expect(isMaintenanceActive()).toBe(false);
  });

  it('activates maintenance mode, pauses the scheduler, and cleans up on success', async () => {
    const uploaded = writeUpload('backup.sql');
    const result = await startDatabaseImport('backup.sql', uploaded);

    expect(result).toMatchObject({ kind: 'ok', jobId: expect.any(String), token: expect.any(String) });
    // Maintenance + scheduler pause are claimed synchronously before the
    // background work starts.
    expect(isMaintenanceActive()).toBe(true);
    expect(contestScheduler.pause).toHaveBeenCalled();
    if (result.kind !== 'ok') return;

    expect(await waitForOutcome(result.jobId, result.token)).toEqual({ status: 'completed', message: 'Database imported successfully.' });

    // A2-02: safety copy first, then drop + restore; user_sessions exists
    // before the migrations (0018 alters it).
    expect(callOrder).toEqual(['pg_dump', 'drop', 'psql', 'ensure-sessions', 'migrate', 'ensure-sessions']);
    // Migrations run on a dedicated pool (no API statement_timeout).
    const migrationsPoolArg = (runMigrationsFromPool as jest.Mock).mock.calls[0][0];
    expect(migrationsPoolArg).not.toBe(db.pool);

    expect(isMaintenanceActive()).toBe(false);
    expect(contestScheduler.resume).toHaveBeenCalled();
    expect(fs.existsSync(uploaded)).toBe(false);
  });

  it('takes the safety copy as a custom-format dump inside a private directory and removes it afterwards', async () => {
    let safetyDirMode = 0;
    (runCommand as jest.Mock).mockImplementation(async (command: RunCommandCall) => {
      if (command.executable === 'pg_dump') {
        safetyDirMode = fs.statSync(path.dirname(command.args[command.args.indexOf('-f') + 1])).mode & 0o777;
      }
    });

    await importAndWait('backup.sql');

    const safetyCopy = commandCalls().find((command) => command.executable === 'pg_dump')!;
    expect(safetyCopy.args).toEqual(expect.arrayContaining(['-F', 'c']));
    expect(safetyCopy.args).not.toContain('--exclude-table=user_sessions');
    expect(safetyDirMode).toBe(0o700);
    const safetyCopyPath = safetyCopy.args[safetyCopy.args.indexOf('-f') + 1];
    expect(fs.existsSync(path.dirname(safetyCopyPath))).toBe(false);
  });

  it('feeds psql the upload on stdin behind a \\restrict, never via -f <upload> (A2-06)', async () => {
    const { uploaded } = await importAndWait('backup.sql');

    const restore = commandCalls().find((command) => command.executable === 'psql')!;
    expect(restore.args).toEqual(expect.arrayContaining(['-X', '--single-transaction', '-f', '-']));
    expect(restore.args).not.toContain(uploaded);
    expect(restore.stdin).toBeDefined();
    // A2-06: no backend secrets in any pg tool's environment.
    for (const command of commandCalls()) {
      expect(Object.keys(command.env ?? {})).toEqual(['PGPASSWORD']);
    }
  });

  it('restores archives with pg_restore after pg_restore --list accepted them', async () => {
    await importAndWait('backup.dump', 'PGDMP-archive-bytes');

    const calls = commandCalls();
    expect(calls[0]).toMatchObject({ executable: 'pg_restore', args: ['--list', expect.stringContaining('backup.dump')] });
    const restore = calls.find((command) => command.executable === 'pg_restore' && !command.args.includes('--list'))!;
    expect(restore.args).toEqual(expect.arrayContaining(['--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error']));
  });

  it.each([
    ['backup.sql', 'CREATE TABLE x (id int);\n', 'not a pg_dump plain-text dump'],
    ['backup.sql', `${MINIMAL_DUMP.replace('SELECT 1;', 'SELECT 1;\n\\! id')}`, 'psql meta-command on line 6 (\\!)'],
    ['backup.sql', MINIMAL_DUMP.slice(0, 30), 'incomplete'],
  ])('rejects an unsafe or broken upload (%s) before maintenance mode, leaving the database alone', async (name, contents, reason) => {
    const uploaded = writeUpload(name, contents);

    const result = await startDatabaseImport(name, uploaded);

    expect(result).toEqual({ kind: 'invalid_dump', message: expect.stringContaining(reason) });
    expect(isMaintenanceActive()).toBe(false);
    expect(contestScheduler.pause).not.toHaveBeenCalled();
    expect(dropAllTablesForImport).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
    expect(fs.existsSync(uploaded)).toBe(false);
  });

  it('rejects an archive that pg_restore --list cannot read', async () => {
    (runCommand as jest.Mock).mockRejectedValueOnce(new Error('pg_restore: error: input file does not appear to be a valid archive'));
    const uploaded = writeUpload('backup.tar', 'not an archive');

    const result = await startDatabaseImport('backup.tar', uploaded);

    expect(result).toEqual({ kind: 'invalid_dump', message: expect.stringContaining('not a PostgreSQL archive') });
    expect(isMaintenanceActive()).toBe(false);
    expect(dropAllTablesForImport).not.toHaveBeenCalled();
  });

  it.each([
    ['the restore', 'psql', 'restore failed'],
    ['the migrations', 'migrate', 'migration failed'],
  ])('restores the safety copy when %s fail, then ensures the session table', async (_step, failing, errorMessage) => {
    if (failing === 'psql') {
      (runCommand as jest.Mock).mockImplementation(async (command: RunCommandCall) => {
        callOrder.push(command.executable);
        if (command.executable === 'psql') throw new Error(errorMessage);
      });
    } else {
      (runMigrationsFromPool as jest.Mock).mockImplementation(async () => { callOrder.push('migrate'); throw new Error(errorMessage); });
    }

    const { outcome } = await importAndWait('backup.sql');

    expect(outcome.status).toBe('failed');
    expect(outcome.message).toContain('the previous database was restored');
    expect(outcome.message).toContain(errorMessage);
    // Drop again and pg_restore the safety copy, then make sure logins work.
    const rollback = callOrder.slice(callOrder.lastIndexOf('drop'));
    expect(rollback).toEqual(['drop', 'pg_restore', 'ensure-sessions']);
    const safetyCopyPath = commandCalls()[0].args.at(-1);
    expect(commandCalls().at(-1)).toMatchObject({ executable: 'pg_restore', args: expect.arrayContaining([safetyCopyPath, '--exit-on-error']) });
    expect(fs.existsSync(path.dirname(safetyCopyPath!))).toBe(false);
    expect(isMaintenanceActive()).toBe(false);
    expect(contestScheduler.resume).toHaveBeenCalled();
  });

  it('keeps the safety copy and says where it is when restoring it fails too', async () => {
    (runCommand as jest.Mock).mockImplementation(async (command: RunCommandCall) => {
      if (command.executable !== 'pg_dump') throw new Error(`${command.executable} failed`);
      fs.writeFileSync(command.args[command.args.indexOf('-f') + 1], 'safety copy');
    });

    const { outcome } = await importAndWait('backup.sql');

    const safetyCopyPath = commandCalls()[0].args.at(-1)!;
    expect(outcome.status).toBe('failed');
    expect(outcome.message).toContain('restoring the previous database failed too');
    expect(outcome.message).toContain(safetyCopyPath);
    expect(fs.existsSync(safetyCopyPath)).toBe(true);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS user_sessions'));
    fs.rmSync(path.dirname(safetyCopyPath), { recursive: true, force: true });
  });

  it('drops nothing when the safety copy cannot be taken', async () => {
    (runCommand as jest.Mock).mockRejectedValueOnce(new Error('pg_dump: error: No space left on device'));

    const { outcome } = await importAndWait('backup.sql');

    expect(outcome.status).toBe('failed');
    expect(outcome.message).toContain('the live database was not changed');
    expect(dropAllTablesForImport).not.toHaveBeenCalled();
    expect(isMaintenanceActive()).toBe(false);
  });

  it('reports an unchanged database when the drop itself fails (it is one statement) and restores nothing', async () => {
    (dropAllTablesForImport as jest.Mock).mockRejectedValueOnce(new Error('permission denied for schema extra'));

    const { outcome } = await importAndWait('backup.sql');

    expect(outcome.status).toBe('failed');
    expect(outcome.message).toContain('the live database was not changed');
    expect(outcome.message).toContain('permission denied for schema extra');
    expect(dropAllTablesForImport).toHaveBeenCalledTimes(1);
    // Only the safety copy ran: no upload restore, no safety-copy restore.
    expect(commandCalls().map((command) => command.executable)).toEqual(['pg_dump']);
    const safetyCopyPath = commandCalls()[0].args.at(-1)!;
    expect(fs.existsSync(path.dirname(safetyCopyPath))).toBe(false);
    expect(isMaintenanceActive()).toBe(false);
  });

  it('does not claim maintenance mode for an unsupported file type', async () => {
    const result = await startDatabaseImport('backup.txt', '/tmp/backup.txt');

    expect(result).toEqual({ kind: 'unsupported_extension' });
    expect(isMaintenanceActive()).toBe(false);
    expect(dropAllTablesForImport).not.toHaveBeenCalled();
  });

  it('prunes completed import progress entries after the TTL (ADMIN-006)', async () => {
    const started = await startDatabaseImport('backup.sql', writeUpload('backup.sql'));
    expect(started.kind).toBe('ok');
    if (started.kind !== 'ok') return;
    const { jobId, token } = started;

    // Freshly completed — still readable with its token.
    expect(await waitForOutcome(jobId, token)).toEqual({
      status: 'completed',
      message: 'Database imported successfully.',
    });

    // After the TTL the entry is gone: unknown job → null.
    jest.useFakeTimers({ now: Date.now() + 24 * 60 * 60 * 1000 + 1000 });
    try {
      expect(getDatabaseImportProgress(jobId, token)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

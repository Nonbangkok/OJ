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
import { startDatabaseImport } from '../../services/adminDatabaseService';

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

const flushMicrotasks = async (times = 20): Promise<void> => {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
};

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

describe('startDatabaseImport (DB-05 / ADMIN-003)', () => {
  beforeEach(() => {
    endMaintenanceMode();
    jest.clearAllMocks();
    (db.query as jest.Mock).mockResolvedValue({});
    (runCommand as jest.Mock).mockResolvedValue(undefined);
    (runMigrationsFromPool as jest.Mock).mockResolvedValue([]);
    (dropAllTablesForImport as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    endMaintenanceMode();
  });

  it('rejects a second import while one is running', async () => {
    // Hold the import in flight on the schema drop.
    let releaseDrop!: () => void;
    (dropAllTablesForImport as jest.Mock).mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseDrop = resolve; }),
    );

    const first = await startDatabaseImport('backup.sql', '/tmp/backup.sql');
    expect(first).not.toHaveProperty('kind');

    const second = await startDatabaseImport('backup2.sql', '/tmp/backup2.sql');
    expect(second).toEqual({ kind: 'import_in_progress' });

    releaseDrop();
    await flushMicrotasks();
    expect(isMaintenanceActive()).toBe(false);
  });

  it('activates maintenance mode, pauses the scheduler, and cleans up on success', async () => {
    const result = await startDatabaseImport('backup.sql', '/tmp/backup.sql');

    expect(result).not.toHaveProperty('kind');
    // Maintenance + scheduler pause are claimed synchronously before the
    // background work starts.
    expect(isMaintenanceActive()).toBe(true);
    expect(contestScheduler.pause).toHaveBeenCalled();

    await flushMicrotasks();

    expect(dropAllTablesForImport).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledTimes(1);
    // Migrations run on a dedicated pool (no API statement_timeout).
    const migrationsPoolArg = (runMigrationsFromPool as jest.Mock).mock.calls[0][0];
    expect(migrationsPoolArg).not.toBe(db.pool);
    // ADMIN-003: user_sessions is recreated after the import because the
    // dump excludes it.
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS user_sessions'),
    );

    expect(isMaintenanceActive()).toBe(false);
    expect(contestScheduler.resume).toHaveBeenCalled();
  });

  it('releases maintenance mode even when the import fails', async () => {
    (runCommand as jest.Mock).mockRejectedValueOnce(new Error('restore failed'));

    await startDatabaseImport('backup.sql', '/tmp/backup.sql');
    await flushMicrotasks();

    expect(isMaintenanceActive()).toBe(false);
    expect(contestScheduler.resume).toHaveBeenCalled();
  });

  it('does not claim maintenance mode for an unsupported file type', async () => {
    const result = await startDatabaseImport('backup.txt', '/tmp/backup.txt');

    expect(result).toEqual({ kind: 'unsupported_extension' });
    expect(isMaintenanceActive()).toBe(false);
    expect(dropAllTablesForImport).not.toHaveBeenCalled();
  });
});

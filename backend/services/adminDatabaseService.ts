import crypto from 'crypto';
import fs from 'fs';
import { env } from '../config/env';
import { createMigrationsPool, pool } from '../db';
import { runMigrationsFromPool } from '../scripts/migrate';
import { getErrorMessage } from '../utils/errorMessage';
import { logger } from '../utils/logger';
import { runCommand, SpawnCommand } from '../utils/runCommand';
import {
  buildDatabaseExportCommand,
  buildDatabaseExportFilePath,
  buildDatabaseImportCommand,
} from './adminSystemService';
import { dropAllTablesForImport } from './adminQueryService';
import { beginMaintenanceMode, endMaintenanceMode } from './maintenanceMode';
import contestScheduler from './contestScheduler';

// Database import/export process orchestration. The import-progress map and
// per-job tokens live here so the controller stays a thin routing layer.

export type DatabaseImportCommand = Exclude<ReturnType<typeof buildDatabaseImportCommand>, { kind: 'unsupported_extension' }>;

type ImportProgress = { status: string; message: string; token: string };

/**
 * ADMIN-006: how long a finished import's progress entry stays queryable.
 * The admin UI polls while an import runs; once it is completed/failed the
 * entry is only useful for a final status read, so it is pruned after this
 * TTL to keep the in-memory map from growing without bound across imports.
 */
const IMPORT_PROGRESS_TTL_MS = 24 * 60 * 60 * 1000;

/** When each progress entry was last written — drives TTL pruning. */
const importProgressUpdatedAt = new Map<string, number>();

const importProgressMap = new Map<string, ImportProgress>();

/** Drop entries for finished jobs older than the TTL (ADMIN-006). */
const pruneStaleImportProgress = (now = Date.now()): void => {
  for (const [jobId, progress] of importProgressMap) {
    if (progress.status !== 'completed' && progress.status !== 'failed') {
      continue;
    }
    const updatedAt = importProgressUpdatedAt.get(jobId);
    if (updatedAt !== undefined && now - updatedAt > IMPORT_PROGRESS_TTL_MS) {
      importProgressMap.delete(jobId);
      importProgressUpdatedAt.delete(jobId);
    }
  }
};

const unlinkIfExists = async (filePath: string): Promise<void> => {
  if (!fs.existsSync(filePath)) {
    return;
  }
  try {
    await fs.promises.unlink(filePath);
  } catch (unlinkError: unknown) {
    console.error(`Error deleting temporary file (${filePath}):`, unlinkError);
  }
};

// The import-progress endpoint cannot use session auth because the import drops
// the session table mid-run (see server.ts). Use a constant-time comparison of a
// per-job token instead so the endpoint authenticates without a session.
const isValidImportToken = (expected: string, provided: unknown): boolean => {
  if (typeof provided !== 'string' || provided.length === 0) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
};

export type StartedDatabaseImport = {
  kind: 'ok';
  jobId: string;
  token: string;
};

/**
 * ADMIN-003: exports exclude user_sessions, so a restored database has no
 * session table even though migration 0001 (which creates it) is recorded as
 * applied in the restored schema_migrations. Recreate it explicitly so
 * logins work immediately after an import.
 */
const ENSURE_USER_SESSIONS_SQL = `
CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
)`;

/** Validate the uploaded dump and start the asynchronous import; the caller responds 202. */
export const startDatabaseImport = async (
  originalFilename: string,
  dumpFilePath: string,
): Promise<StartedDatabaseImport | { kind: 'unsupported_extension' } | { kind: 'import_in_progress' }> => {
  const importCommandResult = buildDatabaseImportCommand(
    originalFilename,
    dumpFilePath,
    env.PGDATABASE,
    env.PGUSER,
    env.PGHOST,
    env.PGPORT,
    env.PGPASSWORD,
  );
  if (importCommandResult.kind === 'unsupported_extension') {
    await unlinkIfExists(dumpFilePath);
    return { kind: 'unsupported_extension' };
  }

  // DB-05: exactly one import may run at a time. The maintenance-mode flag is
  // the claim: a second import while the schema is being dropped/restored
  // would interleave destructively.
  if (!beginMaintenanceMode()) {
    await unlinkIfExists(dumpFilePath);
    return { kind: 'import_in_progress' };
  }

  // The contest scheduler must not tick against a schema that is being
  // dropped and recreated (DB-05).
  contestScheduler.pause();

  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const token = crypto.randomBytes(32).toString('hex');
  importProgressMap.set(jobId, { status: 'pending', message: 'Database import queued.', token });

  const setProgress = (status: string, message: string): void => {
    importProgressMap.set(jobId, { status, message, token });
    importProgressUpdatedAt.set(jobId, Date.now());
  };

  void (async () => {
    try {
      setProgress('uploading', 'Preparing database import.');
      logger.warn('database import started - maintenance mode active, dropping schema');
      await dropAllTablesForImport();

      setProgress('uploading', 'Importing database dump. This may take several minutes.');
      await runCommand(importCommandResult);

      setProgress('migrating', 'Applying database migrations to the restored data.');
      // DB-10: migrations run on a dedicated pool without the API
      // statement_timeout — index builds on a restored dump may exceed it.
      const migrationsPool = createMigrationsPool();
      try {
        await runMigrationsFromPool(migrationsPool);
      } finally {
        await migrationsPool.end();
      }

      // ADMIN-003 follow-up: the dump has no user_sessions table; recreate
      // it (migration 0001 is already recorded as applied).
      await pool.query(ENSURE_USER_SESSIONS_SQL);

      setProgress('completed', 'Database imported successfully.');
      logger.info('database import completed');
    } catch (error: unknown) {
      logger.error('database import failed', { err: error });
      setProgress('failed', `Failed to import database: ${getErrorMessage(error)}`);
    } finally {
      contestScheduler.resume();
      endMaintenanceMode();
      await unlinkIfExists(dumpFilePath);
    }
  })();

  return { kind: 'ok', jobId, token };
};

export type DatabaseImportProgress = { status: string; message: string } | null;

/**
 * Look up an import job's progress. Returns null when the job is unknown,
 * 'unauthorized' when the token does not match, otherwise the public progress
 * (without the token).
 */
export const getDatabaseImportProgress = (
  jobId: string,
  providedToken: unknown,
): DatabaseImportProgress | 'unauthorized' => {
  pruneStaleImportProgress();

  const progress = importProgressMap.get(jobId);
  if (!progress) {
    return null;
  }
  if (!isValidImportToken(progress.token, providedToken)) {
    return 'unauthorized';
  }
  const { token: _token, ...publicProgress } = progress;
  return publicProgress;
};

export type DatabaseExportRequest = {
  command: SpawnCommand;
  dumpFilePath: string;
  downloadName: string;
};

/** Build the pg_dump command for a full database export. */
export const buildDatabaseExportRequest = (): DatabaseExportRequest => {
  const timestamp = Date.now();
  const dumpFilePath = buildDatabaseExportFilePath(timestamp);
  const command = buildDatabaseExportCommand(
    dumpFilePath,
    env.PGDATABASE,
    env.PGUSER,
    env.PGHOST,
    env.PGPORT,
    env.PGPASSWORD,
  );
  return { command, dumpFilePath, downloadName: `oj_backup_${timestamp}.sql` };
};

export { runCommand, unlinkIfExists };

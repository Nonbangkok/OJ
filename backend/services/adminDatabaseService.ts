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
import { beginMaintenanceMode, endMaintenanceMode, isMaintenanceActive } from './maintenanceMode';
import contestScheduler from './contestScheduler';
import os from 'os';
import path from 'path';
import { DATABASE_IMPORT } from '../constants';
import {
  buildDatabaseArchiveCheckCommand,
  buildDatabaseSafetyCopyCommand,
  buildDatabaseSafetyRestoreCommand,
  PgConnection,
} from './adminSystemService';
import { waitForAuthoringCoordinatorIdle } from './authoringJobCoordinator';
import { isBatchUploadRunning } from './batchUploadService';
import { ByteRange, createRestrictKey, inspectPlainDump, openGuardedPlainDump } from './databaseDumpGuard';
import { discardQueuedJudgeTasks, pauseJudgeQueue, resumeJudgeQueue, waitForRunningJudgesToSettle } from './judgeQueue';
import { sweepOrphanedSubmissions } from './submissionService';

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
    logger.error('could not delete a temporary database file', { filePath, err: unlinkError });
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

export type DatabaseImportStartResult =
  | StartedDatabaseImport
  | { kind: 'unsupported_extension' }
  | { kind: 'import_in_progress' }
  /** A2-03: a background batch problem upload is still writing problems. */
  | { kind: 'batch_upload_in_progress' }
  /** A2-02/A2-06: rejected before anything was touched; `message` is for the admin. */
  | { kind: 'invalid_dump'; message: string };

/**
 * ADMIN-003: exports exclude user_sessions, so a restored database has no
 * session table even though migration 0001 (which creates it) is recorded as
 * applied in the restored schema_migrations. Recreate it explicitly so
 * logins work immediately after an import. It runs before the migrations
 * (0018 alters this table) and again whenever an import ends.
 */
const ENSURE_USER_SESSIONS_SQL = `
CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
)`;

/** A2-02: prefix of the private (0700) directory holding the pre-import safety copy. */
const SAFETY_COPY_DIR_PREFIX = 'oj-db-import-';

const currentConnection = (): PgConnection => ({
  databaseName: env.PGDATABASE,
  databaseUser: env.PGUSER,
  databaseHost: env.PGHOST,
  databasePort: env.PGPORT,
  databasePassword: env.PGPASSWORD,
});

type ImportJob = {
  dumpFilePath: string;
  command: DatabaseImportCommand;
  /** Plain dumps only: pg_dump's own \restrict/\unrestrict lines, left out of psql's input. */
  omitRanges: ReadonlyArray<ByteRange>;
  /** Settles once a contest-scheduler tick that was running at import start is over. */
  schedulerSettled: Promise<unknown>;
  setProgress: (status: string, message: string) => void;
};

/**
 * A2-02/A2-06: reject an upload that cannot restore cleanly (or would run
 * psql meta-commands) before maintenance mode starts or anything is dropped.
 */
const validateUpload = async (
  command: DatabaseImportCommand,
  dumpFilePath: string,
): Promise<{ ok: true; omitRanges: ReadonlyArray<ByteRange> } | { ok: false; message: string }> => {
  if (command.format === 'plain') {
    const inspection = await inspectPlainDump(dumpFilePath);
    return inspection.ok ? { ok: true, omitRanges: inspection.omitRanges } : { ok: false, message: inspection.reason };
  }
  try {
    await runCommand(buildDatabaseArchiveCheckCommand(dumpFilePath));
  } catch (error: unknown) {
    logger.warn('database import rejected: pg_restore --list failed', { err: error });
    return { ok: false, message: 'The uploaded .dump/.tar file is not a PostgreSQL archive that pg_restore can read.' };
  }
  return { ok: true, omitRanges: [] };
};

/** Resolve true when `work` settles within `timeoutMs`, false otherwise. */
const settlesWithin = async (work: Promise<unknown>, timeoutMs: number): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  try {
    return await Promise.race([Promise.resolve(work).then(() => true, () => true), timedOut]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * A2-03: nothing else in the process may touch the database between the
 * drop and the end of the restore. Maintenance mode already 503s new
 * requests and makes the authoring coordinator skip its ticks and a batch
 * upload stop between problems (startDatabaseImport refuses to begin while
 * a batch is running); this waits for the work that was already running. Throws (nothing dropped yet) when
 * a step does not settle within DATABASE_IMPORT.QUIESCE_TIMEOUT_MS.
 */
const quiesceBackgroundWork = async (schedulerSettled: Promise<unknown>): Promise<void> => {
  const timeoutMs = DATABASE_IMPORT.QUIESCE_TIMEOUT_MS;
  // Scheduler first: a contest-end migration inside its tick drains that
  // contest's judges, so the judge queue keeps running until the tick is over.
  if (!(await settlesWithin(schedulerSettled, timeoutMs))) {
    throw new Error('A contest scheduler run did not finish in time. Try again in a few minutes.');
  }
  pauseJudgeQueue();
  if (!(await waitForRunningJudgesToSettle(timeoutMs))) {
    throw new Error('Running judge tasks did not finish in time. Try again when the judge queue is idle.');
  }
  if (!(await waitForAuthoringCoordinatorIdle(timeoutMs))) {
    throw new Error('An authoring job sync did not finish in time. Try again in a few minutes.');
  }
};

const restoreUpload = async (job: ImportJob): Promise<void> => {
  if (job.command.format === 'archive') {
    await runCommand(job.command);
    return;
  }
  // A2-06: psql reads the upload behind a \restrict with a key the file
  // cannot know, so every meta-command in it is refused (databaseDumpGuard).
  const guardedDump = openGuardedPlainDump(job.dumpFilePath, job.omitRanges, createRestrictKey());
  try {
    await runCommand({ ...job.command, stdin: guardedDump });
  } finally {
    guardedDump.destroy();
  }
};

const ensureUserSessionsTable = async (): Promise<void> => {
  await pool.query(ENSURE_USER_SESSIONS_SQL);
};

/** Restore the upload into the emptied database and migrate it forward. Throws on any failure. */
const restoreAndMigrate = async (job: ImportJob): Promise<void> => {
  await restoreUpload(job);
  await ensureUserSessionsTable();

  job.setProgress('migrating', 'Applying database migrations to the restored data.');
  // DB-10: migrations run on a dedicated pool without the API
  // statement_timeout — index builds on a restored dump may exceed it.
  const migrationsPool = createMigrationsPool();
  try {
    await runMigrationsFromPool(migrationsPool);
  } finally {
    await migrationsPool.end();
  }
};

/** A2-02: put the pre-import database back. Returns false when that failed too. */
const restoreSafetyCopy = async (safetyCopyPath: string, connection: PgConnection): Promise<boolean> => {
  try {
    await dropAllTablesForImport();
    await runCommand(buildDatabaseSafetyRestoreCommand(safetyCopyPath, connection));
    logger.warn('database import: the previous database was restored from the safety copy');
    return true;
  } catch (error: unknown) {
    logger.error('database import: restoring the safety copy failed; the copy is kept for manual recovery', {
      err: error,
      safetyCopyPath,
    });
    return false;
  }
};

const runImportJob = async (job: ImportJob): Promise<void> => {
  const connection = currentConnection();
  let safetyDir: string | undefined;
  let keepSafetyDir = false;
  let imported = false;
  let failureMessage = '';

  try {
    try {
      job.setProgress('uploading', 'Waiting for running judge and background tasks to finish.');
      await quiesceBackgroundWork(job.schedulerSettled);

      job.setProgress('uploading', 'Saving a safety copy of the current database.');
      // mkdtemp creates the directory 0700: the copy holds every row,
      // password hashes and live sessions included.
      safetyDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), SAFETY_COPY_DIR_PREFIX));
      const safetyCopyPath = path.join(safetyDir, 'pre-import.dump');
      await runCommand(buildDatabaseSafetyCopyCommand(safetyCopyPath, connection));

      job.setProgress('uploading', 'Importing database dump. This may take several minutes.');
      logger.warn('database import: dropping the live database contents and restoring the uploaded dump');
      // One statement: if it fails, nothing was dropped (outer catch).
      await dropAllTablesForImport();

      try {
        await restoreAndMigrate(job);
        imported = true;
      } catch (importError: unknown) {
        logger.error('database import failed; restoring the pre-import safety copy', { err: importError });
        job.setProgress('uploading', 'The import failed. Restoring the previous database.');
        const detail = getErrorMessage(importError);
        if (await restoreSafetyCopy(safetyCopyPath, connection)) {
          failureMessage = `Failed to import database; the previous database was restored. ${detail}`;
        } else {
          keepSafetyDir = true;
          failureMessage = `Failed to import database, and restoring the previous database failed too. Its safety copy was kept at ${safetyCopyPath} on the backend server. ${detail}`;
        }
      }
    } catch (error: unknown) {
      // Quiesce, the safety copy or the (atomic) drop failed: nothing has been dropped.
      logger.error('database import aborted before the live database was changed', { err: error });
      failureMessage = `Failed to import database; the live database was not changed. ${getErrorMessage(error)}`;
    }

    if (imported) {
      // A2-03/A2-04: queued judge tasks refer to pre-import ids, which now
      // name other rows. Drop them and recover the restored rows the way a
      // fresh boot does (Pending re-enqueued, Compiling/Running settled).
      const discardedJudgeTasks = discardQueuedJudgeTasks();
      try {
        const swept = await sweepOrphanedSubmissions();
        logger.info('database import: restored submissions recovered', { discardedJudgeTasks, ...swept });
      } catch (error: unknown) {
        logger.error('database import: submission sweep failed', { err: error });
      }
    }
  } finally {
    // Whatever happened above, logins must keep working afterwards.
    await ensureUserSessionsTable().catch((error: unknown) => {
      logger.error('database import: could not ensure the user_sessions table', { err: error });
    });
    if (safetyDir && !keepSafetyDir) {
      await fs.promises.rm(safetyDir, { recursive: true, force: true }).catch((error: unknown) => {
        logger.error('database import: could not remove the safety copy', { err: error });
      });
    }
    await unlinkIfExists(job.dumpFilePath);
    endMaintenanceMode();
    resumeJudgeQueue();
    contestScheduler.resume();
  }

  if (imported) {
    job.setProgress('completed', 'Database imported successfully.');
    logger.info('database import completed');
  } else {
    job.setProgress('failed', failureMessage);
  }
};

/**
 * Validate the uploaded dump and start the asynchronous import; the caller
 * responds 202. The import (A2-02/A2-03): quiesce background work, take a
 * safety copy, drop + restore + migrate, and on any failure put the safety
 * copy back.
 */
export const startDatabaseImport = async (
  originalFilename: string,
  dumpFilePath: string,
): Promise<DatabaseImportStartResult> => {
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

  // Answer a concurrent import before reading a large upload; the real claim
  // is beginMaintenanceMode() below.
  if (isMaintenanceActive()) {
    await unlinkIfExists(dumpFilePath);
    return { kind: 'import_in_progress' };
  }
  if (isBatchUploadRunning()) {
    await unlinkIfExists(dumpFilePath);
    return { kind: 'batch_upload_in_progress' };
  }

  const validation = await validateUpload(importCommandResult, dumpFilePath);
  if (!validation.ok) {
    await unlinkIfExists(dumpFilePath);
    return { kind: 'invalid_dump', message: validation.message };
  }

  // A2-03: checked again right before the claim, with no await in between:
  // a batch upload running now would keep writing problems into the
  // database the import drops and restores, while one that reaches its
  // first problem after the claim sees maintenance mode and stops.
  if (isBatchUploadRunning()) {
    await unlinkIfExists(dumpFilePath);
    return { kind: 'batch_upload_in_progress' };
  }

  // DB-05: exactly one import may run at a time. The maintenance-mode flag is
  // the claim: a second import while the schema is being dropped/restored
  // would interleave destructively.
  if (!beginMaintenanceMode()) {
    await unlinkIfExists(dumpFilePath);
    return { kind: 'import_in_progress' };
  }

  // The contest scheduler must not tick against a schema that is being
  // dropped and recreated (DB-05); the import waits for a running tick.
  const schedulerSettled = Promise.resolve(contestScheduler.pause());

  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const token = crypto.randomBytes(32).toString('hex');
  importProgressMap.set(jobId, { status: 'pending', message: 'Database import queued.', token });

  const setProgress = (status: string, message: string): void => {
    importProgressMap.set(jobId, { status, message, token });
    importProgressUpdatedAt.set(jobId, Date.now());
  };

  void runImportJob({
    dumpFilePath,
    command: importCommandResult,
    omitRanges: validation.omitRanges,
    schedulerSettled,
    setProgress,
  }).catch((error: unknown) => {
    logger.error('database import job crashed', { err: error });
    setProgress('failed', `Failed to import database: ${getErrorMessage(error)}`);
  });

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

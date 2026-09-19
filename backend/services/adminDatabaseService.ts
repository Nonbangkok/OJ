import crypto from 'crypto';
import fs from 'fs';
import { env } from '../config/env';
import { pool } from '../db';
import { runMigrationsFromPool } from '../scripts/migrate';
import { getErrorMessage } from '../utils/errorMessage';
import { runCommand, SpawnCommand } from '../utils/runCommand';
import {
  buildDatabaseExportCommand,
  buildDatabaseExportFilePath,
  buildDatabaseImportCommand,
} from './adminSystemService';
import { dropAllTablesForImport } from './adminQueryService';

// Database import/export process orchestration. The import-progress map and
// per-job tokens live here so the controller stays a thin routing layer.

export type DatabaseImportCommand = Exclude<ReturnType<typeof buildDatabaseImportCommand>, { kind: 'unsupported_extension' }>;

type ImportProgress = { status: string; message: string; token: string };

const importProgressMap = new Map<string, ImportProgress>();

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
  jobId: string;
  token: string;
};

/** Validate the uploaded dump and start the asynchronous import; the caller responds 202. */
export const startDatabaseImport = async (
  originalFilename: string,
  dumpFilePath: string,
): Promise<StartedDatabaseImport | { kind: 'unsupported_extension' }> => {
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

  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const token = crypto.randomBytes(32).toString('hex');
  importProgressMap.set(jobId, { status: 'pending', message: 'Database import queued.', token });

  const setProgress = (status: string, message: string): void => {
    importProgressMap.set(jobId, { status, message, token });
  };

  void (async () => {
    try {
      setProgress('uploading', 'Preparing database import.');
      console.log('Dropping existing tables before import...');
      await dropAllTablesForImport();

      setProgress('uploading', 'Importing database dump. This may take several minutes.');
      await runCommand(importCommandResult);

      setProgress('migrating', 'Applying database migrations to the restored data.');
      await runMigrationsFromPool(pool);

      setProgress('completed', 'Database imported successfully.');
    } catch (error: unknown) {
      console.error('Error during database import:', error);
      setProgress('failed', `Failed to import database: ${getErrorMessage(error)}`);
    } finally {
      await unlinkIfExists(dumpFilePath);
    }
  })();

  return { jobId, token };
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

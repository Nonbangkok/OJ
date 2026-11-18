import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import * as db from '../../db';
import { runCommand } from '../../utils/runCommand';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { dropAllTablesForImport } from '../../services/adminQueryService';
import { getDatabaseImportProgress, startDatabaseImport } from '../../services/adminDatabaseService';
import { isBatchUploadRunning, processBatchUpload } from '../../services/batchUploadService';
import contestScheduler from '../../services/contestScheduler';
import { resumeJudgeQueue } from '../../services/judgeQueue';
import { beginMaintenanceMode, endMaintenanceMode, isMaintenanceActive } from '../../services/maintenanceMode';

// Real db.ts (on the global pg mock) except the migrations pool, which the
// import ends after migrating.
jest.mock('../../db', () => ({
  ...jest.requireActual('../../db'),
  createMigrationsPool: jest.fn(() => ({ end: jest.fn() })),
}));
jest.mock('../../utils/runCommand', () => ({ runCommand: jest.fn() }));
jest.mock('../../scripts/migrate', () => ({ runMigrationsFromPool: jest.fn() }));
jest.mock('../../services/adminQueryService', () => ({ dropAllTablesForImport: jest.fn() }));

const MINIMAL_DUMP = '--\n-- PostgreSQL database dump\n--\n\nSELECT 1;\n\n--\n-- PostgreSQL database dump complete\n--\n';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A2-03 follow-up: a batch problem upload runs after its 202, one
 * transaction per problem, and outlives the request that started it. The
 * database import must not drop and restore the database under it: an
 * import is refused while a batch is still writing problems, and a batch
 * stops between problems once maintenance mode is active.
 */
describe('database import and background batch problem uploads (A2-03)', () => {
  let workDir = '';
  /** Ids of the problems the batch began to write, in order. */
  let problemInserts: string[] = [];
  let onProblemInsert: (id: string) => Promise<void> | void = () => undefined;

  const makeBatchZip = async (ids: string[]): Promise<string> => {
    const zipPath = path.join(workDir, `batch-${randomUUID()}.zip`);
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = new ZipArchive({ zlib: { level: 1 } });
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      for (const id of ids) {
        archive.append(JSON.stringify({ id, title: `Problem ${id}`, author: 'staff', time_limit_ms: 1000, memory_limit_mb: 256 }), {
          name: `batch/${id}/config.json`,
        });
      }
      void archive.finalize().catch(reject);
    });
    return zipPath;
  };

  const writeDump = (): string => {
    const dumpPath = path.join(workDir, `upload-${randomUUID()}.sql`);
    fs.writeFileSync(dumpPath, MINIMAL_DUMP);
    return dumpPath;
  };

  const waitForImport = async (jobId: string, token: string): Promise<{ status: string; message: string }> => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const progress = getDatabaseImportProgress(jobId, token);
      if (progress && progress !== 'unauthorized' && ['completed', 'failed'].includes(progress.status)) return progress;
      if (Date.now() > deadline) throw new Error(`import did not finish: ${JSON.stringify(progress)}`);
      await sleep(10);
    }
  };

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oj-import-batch-'));
    endMaintenanceMode();
    resumeJudgeQueue();
    problemInserts = [];
    onProblemInsert = () => undefined;
    (db.pool.query as jest.Mock).mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/INSERT INTO problems/.test(sql)) {
        const id = String(params?.[0]);
        problemInserts.push(id);
        await onProblemInsert(id);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    (runCommand as jest.Mock).mockResolvedValue(undefined);
    (runMigrationsFromPool as jest.Mock).mockResolvedValue([]);
    (dropAllTablesForImport as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    endMaintenanceMode();
    contestScheduler.resume();
    resumeJudgeQueue();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('refuses to start an import while a batch upload is still writing problems, and starts once it has finished', async () => {
    let releaseFirstProblem!: () => void;
    let firstProblemStarted!: () => void;
    const firstProblemInFlight = new Promise<void>((resolve) => { firstProblemStarted = resolve; });
    onProblemInsert = async () => {
      if (problemInserts.length !== 1) return;
      firstProblemStarted();
      await new Promise<void>((resolve) => { releaseFirstProblem = resolve; });
    };
    const batch = processBatchUpload(await makeBatchZip(['P1', 'P2', 'P3']));
    await firstProblemInFlight;
    expect(isBatchUploadRunning()).toBe(true);

    const refusedUpload = writeDump();
    const refused = await startDatabaseImport('backup.sql', refusedUpload);

    expect(refused).toEqual({ kind: 'batch_upload_in_progress' });
    expect(isMaintenanceActive()).toBe(false);
    expect(fs.existsSync(refusedUpload)).toBe(false);
    expect(runCommand).not.toHaveBeenCalled();
    expect(dropAllTablesForImport).not.toHaveBeenCalled();

    releaseFirstProblem();
    const results = await batch;
    expect([...results.added].sort()).toEqual(['P1', 'P2', 'P3']);
    expect(results.errors).toEqual([]);
    expect(isBatchUploadRunning()).toBe(false);

    const started = await startDatabaseImport('backup.sql', writeDump());
    if (started.kind !== 'ok') throw new Error(`import did not start: ${started.kind}`);
    expect(await waitForImport(started.jobId, started.token)).toEqual({ status: 'completed', message: 'Database imported successfully.' });
  });

  it('stops between problems once maintenance mode is active', async () => {
    // Whatever claims the window mid-batch: the batch must not write the next problem.
    onProblemInsert = () => {
      if (problemInserts.length === 1) expect(beginMaintenanceMode()).toBe(true);
    };

    const results = await processBatchUpload(await makeBatchZip(['P1', 'P2', 'P3']));

    expect(problemInserts).toHaveLength(1);
    expect(results.added).toEqual(problemInserts);
    expect(results.errors).toEqual([{
      directory: 'Batch Process',
      message: 'Stopped because a database import started: 2 of 3 problems were not processed. Upload them again after the import has finished.',
    }]);
    expect(isBatchUploadRunning()).toBe(false);
  });

  it('writes nothing when it reaches its first problem during an import', async () => {
    // An upload request that was already past the maintenance gate.
    expect(beginMaintenanceMode()).toBe(true);

    const results = await processBatchUpload(await makeBatchZip(['P1', 'P2']));

    expect(problemInserts).toEqual([]);
    expect(db.pool.connect).not.toHaveBeenCalled();
    expect(results).toEqual({
      added: [],
      skipped: [],
      errors: [{
        directory: 'Batch Process',
        message: 'Stopped because a database import started: 2 of 2 problems were not processed. Upload them again after the import has finished.',
      }],
    });
  });

  it('no longer counts a batch that failed as running', async () => {
    const results = await processBatchUpload(path.join(workDir, 'missing.zip'));

    expect(results.errors).toEqual([expect.objectContaining({ directory: 'Batch Process' })]);
    expect(isBatchUploadRunning()).toBe(false);
  });
});

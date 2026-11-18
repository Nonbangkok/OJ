import fs from 'fs';
import os from 'os';
import path from 'path';
import * as db from '../../db';
import { JUDGE_CONFIG } from '../../constants';
import { runCommand } from '../../utils/runCommand';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { dropAllTablesForImport } from '../../services/adminQueryService';
import { startAuthoringCoordinator } from '../../services/authoringJobCoordinator';
import contestScheduler from '../../services/contestScheduler';
import { enqueueTrackedJudgeTask, getJudgeQueueStats, resetInFlightTracking, resumeJudgeQueue } from '../../services/judgeQueue';
import { endMaintenanceMode, isMaintenanceActive } from '../../services/maintenanceMode';
import { getDatabaseImportProgress, startDatabaseImport } from '../../services/adminDatabaseService';

jest.mock('../../db', () => {
  const query = jest.fn();
  return {
    query,
    pool: { query: jest.fn(), connect: jest.fn() },
    createMigrationsPool: jest.fn(() => ({ connect: jest.fn(), end: jest.fn() })),
  };
});
jest.mock('../../utils/runCommand', () => ({ runCommand: jest.fn() }));
jest.mock('../../scripts/migrate', () => ({ runMigrationsFromPool: jest.fn() }));
jest.mock('../../services/adminQueryService', () => ({ dropAllTablesForImport: jest.fn() }));
// Short quiesce bound so the "still running" case does not take minutes.
jest.mock('../../constants', () => ({
  ...jest.requireActual('../../constants'),
  DATABASE_IMPORT: { QUIESCE_TIMEOUT_MS: 1_000 },
}));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate: () => boolean, timeoutMs = 10_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await sleep(10);
  }
};

const MINIMAL_DUMP = '--\n-- PostgreSQL database dump\n--\n\nSELECT 1;\n\n--\n-- PostgreSQL database dump complete\n--\n';

/**
 * A2-03: the import window runs from the schema drop until the restore has
 * finished. Nothing else in the process may touch the database inside it:
 * not judge tasks that were running or queued when the import started, not
 * the authoring coordinator's poll loop, and not a contest-scheduler tick
 * that was already in progress (maintenance mode alone only stops new HTTP).
 */
describe('database import quiesces background database work (A2-03)', () => {
  const RESTORE_MS = 700;
  let windowOpen = false;
  let workDir = '';

  const runImport = async (): Promise<{ status: string; message: string }> => {
    const dumpPath = path.join(workDir, `upload-${Date.now()}.sql`);
    fs.writeFileSync(dumpPath, MINIMAL_DUMP);
    const started = await startDatabaseImport('backup.sql', dumpPath);
    if (started.kind !== 'ok') throw new Error(`import did not start: ${started.kind}`);
    let outcome: { status: string; message: string } | null = null;
    await waitFor(() => {
      const progress = getDatabaseImportProgress(started.jobId, started.token);
      if (progress && progress !== 'unauthorized' && ['completed', 'failed'].includes(progress.status)) outcome = progress;
      return outcome !== null;
    }, 30_000);
    return outcome!;
  };

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oj-import-quiesce-'));
    endMaintenanceMode();
    resetInFlightTracking();
    resumeJudgeQueue();
    windowOpen = false;
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    (db.pool.query as jest.Mock).mockResolvedValue({ rows: [] });
    (runMigrationsFromPool as jest.Mock).mockResolvedValue([]);
    (dropAllTablesForImport as jest.Mock).mockImplementation(async () => { windowOpen = true; });
    // Every pg tool run (safety copy, restore) takes RESTORE_MS; the window
    // closes once the restore after the drop is done.
    (runCommand as jest.Mock).mockImplementation(async () => { await sleep(RESTORE_MS); windowOpen = false; });
  });

  afterEach(async () => {
    endMaintenanceMode();
    contestScheduler.resume();
    resumeJudgeQueue();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('no judge task (running or queued at import start) executes inside the import window', async () => {
    const insideWindow: string[] = [];
    const judgeTask = (name: string, durationMs: number) => async () => {
      // Start = the pipeline's SELECT/UPDATE of the row; end = the verdict write.
      if (windowOpen) insideWindow.push(`${name}:start`);
      await sleep(durationMs);
      if (windowOpen) insideWindow.push(`${name}:end`);
    };
    for (let i = 0; i < JUDGE_CONFIG.MAX_CONCURRENT_JUDGES; i += 1) {
      enqueueTrackedJudgeTask(judgeTask(`running-${i}`, 150), { table: 'submissions', submissionId: 100 + i });
    }
    enqueueTrackedJudgeTask(judgeTask('queued', 20), { table: 'submissions', submissionId: 999 });
    await waitFor(() => getJudgeQueueStats().running === JUDGE_CONFIG.MAX_CONCURRENT_JUDGES);

    expect((await runImport()).status).toBe('completed');
    await waitFor(() => getJudgeQueueStats().running === 0 && getJudgeQueueStats().queued === 0);

    expect(insideWindow).toEqual([]);
  });

  it('drops the pre-import queue after a successful import and judges new work afterwards', async () => {
    const ran: string[] = [];
    let releaseRunning!: () => void;
    for (let i = 0; i < JUDGE_CONFIG.MAX_CONCURRENT_JUDGES; i += 1) {
      enqueueTrackedJudgeTask(() => new Promise<void>((resolve) => { releaseRunning = resolve; }), { table: 'submissions', submissionId: 200 + i });
    }
    enqueueTrackedJudgeTask(async () => { ran.push('stale'); }, { table: 'submissions', submissionId: 299 });
    setTimeout(() => releaseRunning(), 100);

    expect((await runImport()).status).toBe('completed');
    // The stale task named a pre-import id; it never runs against the restored rows.
    expect(getJudgeQueueStats()).toEqual({ running: 0, queued: 0 });
    expect(ran).toEqual([]);

    // The queue is live again for post-import submissions.
    enqueueTrackedJudgeTask(async () => { ran.push('fresh'); }, { table: 'submissions', submissionId: 1 });
    await waitFor(() => ran.length === 1);
    expect(ran).toEqual(['fresh']);
  });

  it('keeps queued judge tasks when the import fails and the live database is restored', async () => {
    const ran: string[] = [];
    let releaseRunning!: () => void;
    for (let i = 0; i < JUDGE_CONFIG.MAX_CONCURRENT_JUDGES; i += 1) {
      enqueueTrackedJudgeTask(() => new Promise<void>((resolve) => { releaseRunning = resolve; }), { table: 'submissions', submissionId: 300 + i });
    }
    enqueueTrackedJudgeTask(async () => { ran.push('queued'); }, { table: 'submissions', submissionId: 399 });
    setTimeout(() => releaseRunning(), 100);
    (runMigrationsFromPool as jest.Mock).mockRejectedValueOnce(new Error('migration exploded'));

    const outcome = await runImport();

    expect(outcome.status).toBe('failed');
    expect(outcome.message).toContain('the previous database was restored');
    // Same rows as before the import, so the queued task is still valid.
    await waitFor(() => ran.length === 1);
    expect(ran).toEqual(['queued']);
  });

  it('fails without dropping anything when a running judge task does not finish within the bound', async () => {
    let releaseRunning!: () => void;
    for (let i = 0; i < JUDGE_CONFIG.MAX_CONCURRENT_JUDGES; i += 1) {
      enqueueTrackedJudgeTask(() => new Promise<void>((resolve) => { releaseRunning = resolve; }), { table: 'submissions', submissionId: 400 + i });
    }
    await waitFor(() => getJudgeQueueStats().running === JUDGE_CONFIG.MAX_CONCURRENT_JUDGES);

    try {
      const outcome = await runImport();

      expect(outcome.status).toBe('failed');
      expect(outcome.message).toContain('the live database was not changed');
      expect(outcome.message).toContain('judge tasks did not finish in time');
      expect(dropAllTablesForImport).not.toHaveBeenCalled();
      expect(runCommand).not.toHaveBeenCalled();
      expect(isMaintenanceActive()).toBe(false);
    } finally {
      releaseRunning();
    }
  });

  it('the authoring coordinator does not start a reconcile tick inside the import window', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oj-import-coordinator-'));
    const ticksInsideWindow: number[] = [];
    (db.pool.connect as jest.Mock).mockImplementation(async () => {
      if (windowOpen) ticksInsideWindow.push(Date.now());
      return { query: jest.fn().mockResolvedValue({ rows: [{ locked: true }] }), release: jest.fn() };
    });
    const stop = await startAuthoringCoordinator(root);
    try {
      await runImport();
    } finally {
      stop();
      fs.rmSync(root, { recursive: true, force: true });
    }

    expect(ticksInsideWindow).toEqual([]);
  });

  it('waits for an authoring reconcile pass that is already running', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oj-import-coordinator-'));
    let slowPass = false;
    let passEndedAt = 0;
    let dropAt = 0;
    (db.pool.connect as jest.Mock).mockImplementation(async () => ({
      query: jest.fn(async (sql: string) => {
        if (slowPass && /pg_try_advisory_lock/.test(sql)) {
          slowPass = false;
          await sleep(300);
          passEndedAt = Date.now();
        }
        return { rows: [{ locked: true }] };
      }),
      release: jest.fn(),
    }));
    (dropAllTablesForImport as jest.Mock).mockImplementation(async () => { dropAt ||= Date.now(); windowOpen = true; });
    const stop = await startAuthoringCoordinator(root);
    try {
      // The next poll (POLL_MS) starts the slow pass; the import begins during it.
      slowPass = true;
      await waitFor(() => !slowPass);
      await runImport();
    } finally {
      stop();
      fs.rmSync(root, { recursive: true, force: true });
    }

    expect(passEndedAt).toBeGreaterThan(0);
    expect(dropAt).toBeGreaterThanOrEqual(passEndedAt);
  });

  it('a contest-scheduler tick already in progress finishes before the schema drop', async () => {
    const contestQueriesInsideWindow: string[] = [];
    let first = true;
    (db.query as jest.Mock).mockImplementation(async (sql: string) => {
      if (/FROM contests/.test(sql)) {
        if (windowOpen) contestQueriesInsideWindow.push(sql.trim().split('\n')[0]);
        if (first) { first = false; await sleep(150); }
      }
      return { rows: [] };
    });

    const tick = contestScheduler.checkContestStatus();
    await runImport();
    await tick;

    expect(contestQueriesInsideWindow).toEqual([]);
  });
});

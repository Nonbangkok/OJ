import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { runCommand } from '../../utils/runCommand';
import { SUBMISSION_STATUS } from '../../constants';
import { enqueueTrackedJudgeTask } from '../../services/judgeQueue';
import {
  buildDatabaseExportRequest,
  getDatabaseImportProgress,
  startDatabaseImport,
} from '../../services/adminDatabaseService';
import { endMaintenanceMode } from '../../services/maintenanceMode';

jest.unmock('pg');

// The import tears down and restores the `public` schema of the database the
// app is configured for, so this suite points the app (db pool + env) at a
// dedicated throwaway database on the integration server.
jest.mock('../../db', () => {
  const actualPg = jest.requireActual('pg');
  const url = new URL(process.env.INTEGRATION_DATABASE_URL ?? 'postgres://unused:unused@127.0.0.1:1/unused');
  url.pathname = `/oj_import_sweep_${process.pid}`;
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
  const database = `oj_import_sweep_${process.pid}`;
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
// Record re-enqueues instead of running the real compile/judge pipeline.
jest.mock('../../services/judgeQueue', () => ({
  ...jest.requireActual('../../services/judgeQueue'),
  enqueueTrackedJudgeTask: jest.fn(),
  enqueueJudgeTask: jest.fn(),
}));

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const hasTool = (tool: string): boolean => spawnSync(tool, ['--version']).status === 0;
const enabled = Boolean(integrationDatabaseUrl) && ['psql', 'pg_dump'].every(hasTool);

/**
 * A2-04: an export taken while submissions are being judged carries
 * Pending/Compiling/Running rows. Restoring it in-process must recover them
 * the way a fresh boot does (sweepOrphanedSubmissions): Pending re-enqueued,
 * Compiling/Running made terminal. Without that they would show as
 * "judging" until the next backend restart.
 */
(enabled ? describe : describe.skip)('database import recovers non-terminal restored submissions (A2-04)', () => {
  jest.setTimeout(120_000);
  const databaseName = `oj_import_sweep_${process.pid}`;
  const admin = new pg.Pool({ connectionString: integrationDatabaseUrl });
  let workDir = '';
  const judgeable = [SUBMISSION_STATUS.PENDING, SUBMISSION_STATUS.COMPILING, SUBMISSION_STATUS.RUNNING];

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

  beforeAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${databaseName}`);
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oj-import-sweep-'));
    await runMigrationsFromPool(db.pool);
  });

  afterAll(async () => {
    endMaintenanceMode();
    await db.pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.end();
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('re-enqueues restored Pending rows and settles restored Compiling/Running rows', async () => {
    await db.query("INSERT INTO users (id, username, password_hash, role) VALUES (1, 'u1', 'x', 'user')");
    await db.query("INSERT INTO problems (id, title, time_limit_ms, memory_limit_mb, is_visible) VALUES ('p', 'P', 1000, 256, true)");
    await db.query("INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ('p', 1, '1', '1')");
    await db.query(`INSERT INTO contests (id, title, start_time, end_time, status)
      VALUES (1, 'C', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'running')`);
    for (const [id, status] of [[11, SUBMISSION_STATUS.PENDING], [12, SUBMISSION_STATUS.COMPILING], [13, SUBMISSION_STATUS.RUNNING], [14, SUBMISSION_STATUS.ACCEPTED]] as const) {
      await db.query(
        `INSERT INTO submissions (id, user_id, problem_id, code, language, overall_status, score) VALUES ($1, 1, 'p', 'x', 'cpp', $2, 0)`,
        [id, status],
      );
    }
    for (const [id, status] of [[21, SUBMISSION_STATUS.PENDING], [22, SUBMISSION_STATUS.RUNNING]] as const) {
      await db.query(
        `INSERT INTO contest_submissions (id, contest_id, user_id, problem_id, code, language, overall_status, score) VALUES ($1, 1, 1, 'p', 'x', 'cpp', $2, 0)`,
        [id, status],
      );
    }

    // The app's own export, taken while those rows were mid-judge.
    const { command, dumpFilePath } = buildDatabaseExportRequest();
    await runCommand(command);
    const uploaded = path.join(workDir, 'mid-judge-backup.sql');
    fs.renameSync(dumpFilePath, uploaded);
    (enqueueTrackedJudgeTask as jest.Mock).mockClear();

    const started = await startDatabaseImport('backup.sql', uploaded);
    if (started.kind !== 'ok') throw new Error(`import did not start: ${started.kind}`);
    expect((await waitForImport(started.jobId, started.token)).status).toBe('completed');

    const enqueued = (): Set<string> => new Set((enqueueTrackedJudgeTask as jest.Mock).mock.calls
      .map(([, key]) => `${key.table}:${key.submissionId}`));
    const unrecovered = async (): Promise<string[]> => {
      const rows = (await db.query(`
        SELECT 'submissions' AS t, id, overall_status FROM submissions WHERE overall_status = ANY($1::text[])
        UNION ALL
        SELECT 'contest_submissions', id, overall_status FROM contest_submissions WHERE overall_status = ANY($1::text[])
      `, [judgeable])).rows as Array<{ t: string; id: number; overall_status: string }>;
      // A Pending row counts as recovered once it is back in the judge queue.
      return rows
        .filter((row) => !(row.overall_status === SUBMISSION_STATUS.PENDING && enqueued().has(`${row.t}:${row.id}`)))
        .map((row) => `${row.t}:${row.id}:${row.overall_status}`)
        .sort();
    };

    // The recovery may run just after the import reports completion.
    const deadline = Date.now() + 5_000;
    let stuck = await unrecovered();
    while (stuck.length > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      stuck = await unrecovered();
    }
    expect(stuck).toEqual([]);

    // The terminal row is left alone.
    const accepted = await db.query('SELECT overall_status FROM submissions WHERE id = 14');
    expect(accepted.rows[0].overall_status).toBe(SUBMISSION_STATUS.ACCEPTED);
  });
});

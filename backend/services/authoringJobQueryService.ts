import { randomUUID } from 'node:crypto';
import type { Pool, QueryResultRow } from 'pg';
import * as db from '../db';
import { AuthoringJobRow, ProblemDraftRow } from '../types/authoring';
import { AUTHORING_RUNNER, JobSnapshot, jobResultSchema, jobSnapshotSchema } from '../authoring/protocol';

export type JobDatabase = {
  pool: Pick<Pool, 'connect'>;
  query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
};
export type DurableJob = AuthoringJobRow & { request_snapshot: JobSnapshot | null };
export const ACTIVE_JOB_STATUSES = ['queued', 'compiling', 'running'];
export const AUTHORING_COORDINATOR_LOCK = 734002;
const QUEUE_RESERVATION_LOCK = 734003;
type QueueResult = { kind: 'queued'; job: DurableJob }
  | { kind: 'not_found' | 'source_missing' | 'queue_full' }
  | { kind: 'revision_conflict' | 'published'; currentRevision: number }
  | { kind: 'busy'; jobId: string };

/** Atomically reserves one job and its immutable source/revision before dispatch. */
export async function queueCompileJob(draftId: string, revision: number, target: 'solution' | 'generator', database: JobDatabase = db): Promise<QueueResult> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    // Also bounds total queued source bytes under simultaneous requests across drafts.
    await client.query('SELECT pg_advisory_xact_lock($1)', [QUEUE_RESERVATION_LOCK]);
    const draft = (await client.query<ProblemDraftRow>('SELECT * FROM problem_drafts WHERE id=$1 FOR UPDATE', [draftId])).rows[0];
    const reject = async (result: QueueResult) => { await client.query('ROLLBACK'); return result; };
    if (!draft) return await reject({ kind: 'not_found' });
    if (draft.status === 'published') return await reject({ kind: 'published', currentRevision: draft.revision });
    if (draft.revision !== revision) return await reject({ kind: 'revision_conflict', currentRevision: draft.revision });
    const active = await client.query('SELECT id FROM authoring_jobs WHERE draft_id=$1 AND status=ANY($2::text[])', [draftId, ACTIVE_JOB_STATUSES]);
    if (active.rows[0]) return await reject({ kind: 'busy', jobId: active.rows[0].id });
    const count = await client.query('SELECT COUNT(*)::int AS count FROM authoring_jobs WHERE status=ANY($1::text[])', [ACTIVE_JOB_STATUSES]);
    if (count.rows[0].count >= AUTHORING_RUNNER.MAX_PENDING_JOBS) return await reject({ kind: 'queue_full' });
    const source = target === 'generator' ? draft.generator_cpp : draft.solution_cpp;
    if (!source?.trim()) return await reject({ kind: 'source_missing' });
    const snapshot = jobSnapshotSchema.parse({ version: 1, jobId: randomUUID(), draftId: draft.id, revision,
      kind: target === 'generator' ? 'compile_generator' : 'compile_solution', source,
      deadline: new Date(Date.now() + AUTHORING_RUNNER.JOB_TIMEOUT_MS).toISOString() });
    const inserted = await client.query<DurableJob>(`
      INSERT INTO authoring_jobs (id, draft_id, job_type, draft_revision, request_snapshot)
      VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *
    `, [snapshot.jobId, draftId, snapshot.kind, revision, JSON.stringify(snapshot)]);
    await client.query('COMMIT');
    return { kind: 'queued', job: inserted.rows[0] };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

/** Loads private job state for admin projection or internal reconciliation. */
export async function getAuthoringJob(id: string, database: JobDatabase = db): Promise<DurableJob | null> {
  return (await database.query<DurableJob>('SELECT * FROM authoring_jobs WHERE id=$1', [id])).rows[0] ?? null;
}

/** Imports a terminal result once; compilation alone never changes draft readiness. */
export async function applyJobResult(id: string, input: unknown, database: JobDatabase = db): Promise<boolean> {
  const result = jobResultSchema.parse(input);
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query<DurableJob>('SELECT * FROM authoring_jobs WHERE id=$1', [id])).rows[0];
    if (!job || !ACTIVE_JOB_STATUSES.includes(job.status)) { await client.query('ROLLBACK'); return false; }
    if (result.jobId !== id || result.draftId !== job.draft_id || result.revision !== job.draft_revision) throw new Error('Result identity mismatch');
    // Serialize the revision check with Save/Publish before finalizing the job.
    const draft = (await client.query<ProblemDraftRow>('SELECT * FROM problem_drafts WHERE id=$1 FOR UPDATE', [job.draft_id])).rows[0];
    if (!draft) { await client.query('ROLLBACK'); return false; }
    const status = draft.revision !== result.revision ? 'stale' : result.status;
    const updated = await client.query(`
      UPDATE authoring_jobs SET status=$2, result_summary=$3::jsonb, log=$4,
        error_code=$5::text, error_message=$5::text, finished_at=NOW(), request_snapshot=NULL
      WHERE id=$1 AND status=ANY($6::text[]) RETURNING id
    `, [id, status, JSON.stringify({ runnerStatus: result.status, durationMs: result.durationMs, exitCode: result.exitCode }),
      result.log, result.errorCode, ACTIVE_JOB_STATUSES]);
    await client.query('COMMIT');
    return updated.rows.length === 1;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

/** Fails abandoned or invalid jobs without allowing them to overwrite a terminal result. */
export async function failAuthoringJob(id: string, code: string, timedOut: boolean, database: JobDatabase = db): Promise<void> {
  await database.query(`UPDATE authoring_jobs SET status=$2, error_code=$3::text, error_message=$3::text,
    finished_at=NOW(), request_snapshot=NULL WHERE id=$1 AND status=ANY($4::text[])`,
  [id, timedOut ? 'timed_out' : 'failed', code, ACTIVE_JOB_STATUSES]);
}

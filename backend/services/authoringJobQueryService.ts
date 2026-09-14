import { randomUUID } from 'node:crypto';
import type { Pool, QueryResultRow } from 'pg';
import * as db from '../db';
import { AuthoringJobRow, ProblemDraftRow } from '../types/authoring';
import { AUTHORING_RUNNER, CaseInput, InputArtifact, JobSnapshot, jobResultSchema, jobSnapshotSchema, seedSchema } from '../authoring/protocol';
import { TESTCASE_LIMITS, TestcaseError } from '../authoring/testcases';

export type JobDatabase = {
  pool: Pick<Pool, 'connect'>;
  query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
};
export type DurableJob = AuthoringJobRow & { request_snapshot: JobSnapshot | null };
export const ACTIVE_JOB_STATUSES = ['queued', 'compiling', 'running'];
export const AUTHORING_COORDINATOR_LOCK = 734002;
const QUEUE_RESERVATION_LOCK = 734003;
type QueueResult = { kind: 'queued'; job: DurableJob }
  | { kind: 'not_found' | 'source_missing' | 'queue_full' | 'inputs_missing' | 'unsupported_resource_limits' }
  | { kind: 'revision_conflict' | 'published'; currentRevision: number }
  | { kind: 'busy'; jobId: string };

/** Atomically reserves one job and its immutable source/revision before dispatch. */
export async function queueCompileJob(draftId: string, revision: number, target: 'solution' | 'generator', database: JobDatabase = db): Promise<QueueResult> {
  return queueJob(draftId, revision, target === 'generator' ? 'compile_generator' : 'compile_solution', undefined, database);
}

export async function queueGeneratorJob(draftId: string, revision: number, seed: string, database: JobDatabase = db): Promise<QueueResult> {
  return queueJob(draftId, revision, 'run_generator', seedSchema.parse(seed), database);
}

export async function queueOutputJob(draftId: string, revision: number, database: JobDatabase = db): Promise<QueueResult> {
  return queueJob(draftId, revision, 'generate_outputs', undefined, database);
}

export async function readQueuedInput(jobId: string, caseId: string, database: JobDatabase = db): Promise<string> {
  const row = (await database.query('SELECT input_data FROM authoring_job_inputs WHERE job_id=$1 AND case_id=$2', [jobId, caseId])).rows[0];
  if (!row) throw new TestcaseError('invalid_job_inputs', 'The captured input is missing');
  return row.input_data;
}

async function queueJob(draftId: string, revision: number, kind: JobSnapshot['kind'], seed: string | undefined, database: JobDatabase): Promise<QueueResult> {
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
    const source = kind === 'compile_solution' || kind === 'generate_outputs' ? draft.solution_cpp : draft.generator_cpp;
    if (!source?.trim()) return await reject({ kind: 'source_missing' });
    let cases: CaseInput[] | undefined;
    if (kind === 'generate_outputs') {
      if (draft.memory_limit_mb > AUTHORING_RUNNER.MAX_SOLUTION_MEMORY_MB || draft.time_limit_ms > AUTHORING_RUNNER.JOB_TIMEOUT_MS) {
        return await reject({ kind: 'unsupported_resource_limits' });
      }
      cases = (await client.query<CaseInput>(`SELECT id AS "caseId",case_number AS "caseNumber",
        original_input_filename AS filename,octet_length(input_data) AS "sizeBytes",
        encode(sha256(convert_to(input_data,'UTF8')),'hex') AS sha256
        FROM problem_draft_testcases WHERE draft_id=$1 ORDER BY case_number`, [draftId])).rows;
      if (!cases.length) return await reject({ kind: 'inputs_missing' });
    }
    const snapshot = jobSnapshotSchema.parse({ version: 1, jobId: randomUUID(), draftId: draft.id, revision,
      kind, source, ...(seed === undefined ? {} : { seed }),
      ...(cases ? { cases, limits: { timeLimitMs: draft.time_limit_ms, memoryLimitMb: draft.memory_limit_mb } } : {}),
      deadline: new Date(Date.now() + AUTHORING_RUNNER.JOB_TIMEOUT_MS).toISOString() });
    const inserted = await client.query<DurableJob>(`
      INSERT INTO authoring_jobs (id, draft_id, job_type, draft_revision, request_snapshot)
      VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *
    `, [snapshot.jobId, draftId, snapshot.kind, revision, JSON.stringify(snapshot)]);
    if (cases) await client.query(`INSERT INTO authoring_job_inputs (job_id,case_id,case_number,input_data)
      SELECT $1,id,case_number,input_data FROM problem_draft_testcases WHERE draft_id=$2`, [snapshot.jobId, draftId]);
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
export async function applyJobResult(id: string, input: unknown, database: JobDatabase = db,
  readInput?: (index: number, artifact: InputArtifact) => Promise<string>): Promise<boolean> {
  const result = jobResultSchema.parse(input);
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query<DurableJob>('SELECT * FROM authoring_jobs WHERE id=$1', [id])).rows[0];
    if (!job || !ACTIVE_JOB_STATUSES.includes(job.status)) { await client.query('ROLLBACK'); return false; }
    if (result.jobId !== id || result.draftId !== job.draft_id || result.revision !== job.draft_revision) throw new Error('Result identity mismatch');
    const generating = job.job_type === 'run_generator';
    const outputting = job.job_type === 'generate_outputs';
    if (result.status === 'succeeded' && (generating ? !result.inputs || !readInput || result.outputs !== undefined
      : outputting ? !result.outputs || !readInput || result.inputs !== undefined
        : result.inputs !== undefined || result.outputs !== undefined)) {
      throw new TestcaseError('invalid_generated_inputs', 'Result artifacts do not match the requested job type');
    }
    const captured = outputting ? jobSnapshotSchema.safeParse(job.request_snapshot) : null;
    if (outputting) {
      const cases = captured?.success ? captured.data.cases : undefined;
      const invalid = !cases || (result.outputs && (result.outputs.length !== cases.length
        || result.outputs.some((c, i) => c.caseId !== cases[i].caseId || c.caseNumber !== cases[i].caseNumber || c.filename !== cases[i].filename)
        || result.outputs.reduce((sum, c) => sum + c.sizeBytes, 0) + cases.reduce((sum, c) => sum + c.sizeBytes, 0) > TESTCASE_LIMITS.MAX_TOTAL_BYTES))
        || (result.failedCase && !cases.some(c => c.caseId === result.failedCase!.caseId && c.caseNumber === result.failedCase!.caseNumber));
      if (invalid) throw new TestcaseError('invalid_generated_outputs', 'Output result does not match the immutable input set');
    }
    // Serialize the revision check with Save/Publish before finalizing the job.
    const draft = (await client.query<ProblemDraftRow>('SELECT * FROM problem_drafts WHERE id=$1 FOR UPDATE', [job.draft_id])).rows[0];
    if (!draft) { await client.query('ROLLBACK'); return false; }
    const status = draft.revision !== result.revision || draft.status === 'published' ? 'stale' : result.status;
    // Locking the draft serializes duplicate imports and all manual testcase changes.
    const current = (await client.query('SELECT status FROM authoring_jobs WHERE id=$1', [id])).rows[0];
    if (!current || !ACTIVE_JOB_STATUSES.includes(current.status)) { await client.query('ROLLBACK'); return false; }
    if (generating && status === 'succeeded') {
      await client.query('DELETE FROM problem_draft_testcases WHERE draft_id=$1', [job.draft_id]);
      for (const [index, artifact] of result.inputs!.entries()) {
        const text = await readInput!(index, artifact);
        await client.query(`INSERT INTO problem_draft_testcases
          (id,draft_id,case_number,original_input_filename,input_data,output_data,source,source_revision)
          VALUES ($1,$2,$3,$4,$5,NULL,'generated',$6)`,
        [randomUUID(), job.draft_id, index + 1, artifact.filename, text, result.revision]);
      }
      await client.query("UPDATE problem_drafts SET status='generated',verified_revision=NULL,updated_at=NOW() WHERE id=$1", [job.draft_id]);
    }
    if (outputting && status === 'succeeded') {
      for (const [index, artifact] of result.outputs!.entries()) {
        const text = await readInput!(index, artifact);
        const changed = await client.query(`UPDATE problem_draft_testcases SET output_data=$1,updated_at=NOW()
          WHERE draft_id=$2 AND id=$3 AND case_number=$4 RETURNING id`, [text, job.draft_id, artifact.caseId, artifact.caseNumber]);
        if (changed.rows.length !== 1) throw new TestcaseError('invalid_generated_outputs', 'Stored testcase no longer matches the snapshot');
      }
      await client.query("UPDATE problem_drafts SET status='generated',verified_revision=NULL,updated_at=NOW() WHERE id=$1", [job.draft_id]);
    }
    const updated = await client.query(`
      UPDATE authoring_jobs SET status=$2, result_summary=$3::jsonb, log=$4,
        error_code=$5::text, error_message=$5::text, finished_at=NOW(), request_snapshot=NULL
      WHERE id=$1 AND status=ANY($6::text[]) RETURNING id
    `, [id, status, JSON.stringify({ runnerStatus: result.status, durationMs: result.durationMs, exitCode: result.exitCode,
      ...(generating ? { seed: job.request_snapshot?.seed, reproducibility: 'unverified',
        warnings: ['Reproducibility has not been demonstrated; legacy generators may ignore the seed.'],
        caseCount: result.inputs?.length ?? 0, inputs: result.inputs ?? [] } : {}),
      ...(outputting ? { caseCount: result.outputs?.length ?? 0, outputs: result.outputs ?? [],
        ...(result.failedCase ? { failedCase: result.failedCase } : {}) } : {}),
    }),
      result.log, result.errorCode, ACTIVE_JOB_STATUSES]);
    if (updated.rows.length !== 1) { await client.query('ROLLBACK'); return false; }
    await client.query('DELETE FROM authoring_job_inputs WHERE job_id=$1', [id]);
    await client.query('COMMIT');
    return updated.rows.length === 1;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

/** Fails abandoned or invalid jobs without allowing them to overwrite a terminal result. */
export async function failAuthoringJob(id: string, code: string, timedOut: boolean, database: JobDatabase = db): Promise<void> {
  await database.query(`WITH terminal AS (UPDATE authoring_jobs SET status=$2, error_code=$3::text, error_message=$3::text,
    finished_at=NOW(), request_snapshot=NULL WHERE id=$1 AND status=ANY($4::text[]) RETURNING id)
    DELETE FROM authoring_job_inputs WHERE job_id IN (SELECT id FROM terminal)`,
  [id, timedOut ? 'timed_out' : 'failed', code, ACTIVE_JOB_STATUSES]);
}

import { randomUUID } from 'node:crypto';
import type { Pool, QueryResultRow } from 'pg';
import * as db from '../db';
import { AuthoringJobRow, ProblemDraftRow } from '../types/authoring';
import { AUTHORING_RUNNER, CaseInput, InputArtifact, JobSnapshot, PdfArtifact, jobResultSchema, jobSnapshotSchema, seedSchema } from '../authoring/protocol';
import { TESTCASE_LIMITS, TestcaseError } from '../authoring/testcases';
import { StatementError } from '../authoring/statementSanitizer';
import { capturePdfSnapshot } from './authoringPdfSnapshotService';
import { validVerificationMetadata, validateVerificationReport } from './authoringVerificationService';

export type JobDatabase = {
  pool: Pick<Pool, 'connect'>;
  query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
};
export type DurableJob = AuthoringJobRow & { request_snapshot: JobSnapshot | null };
export const ACTIVE_JOB_STATUSES = ['queued', 'compiling', 'running'];
export const AUTHORING_COORDINATOR_LOCK = 734002;
const QUEUE_RESERVATION_LOCK = 734003;
type QueueResult = { kind: 'queued'; job: DurableJob }
  | { kind: 'not_found' | 'source_missing' | 'queue_full' | 'inputs_missing' | 'unsupported_resource_limits' | 'unsupported_template' | 'invalid_statement' | 'invalid_metadata' | 'outputs_missing' | 'invalid_testcases' }
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

export async function queuePdfJob(draftId: string, revision: number, database: JobDatabase = db): Promise<QueueResult> {
  return queueJob(draftId, revision, 'build_pdf', undefined, database);
}

export async function queueVerifyJob(draftId: string, revision: number, database: JobDatabase = db): Promise<QueueResult> {
  return queueJob(draftId, revision, 'verify_all', undefined, database);
}

export async function readQueuedFile(jobId: string, name: string, database: JobDatabase = db): Promise<Buffer> {
  const row = (await database.query('SELECT content FROM authoring_job_files WHERE job_id=$1 AND name=$2', [jobId, name])).rows[0];
  if (!row) {
    // 'output:' rows are expected-output captures, not PDF images; report the right failure.
    const expectedOutput = name.startsWith('output:');
    throw new TestcaseError(
      expectedOutput ? 'invalid_expected_outputs' : 'invalid_pdf_inputs',
      expectedOutput ? 'Captured expected output is missing' : 'Captured PDF file is missing',
    );
  }
  return row.content;
}

export async function getDraftPdf(id: string, database: JobDatabase = db) {
  return (await database.query<Pick<ProblemDraftRow, 'latest_pdf' | 'latest_pdf_revision' | 'revision'>>(
    'SELECT latest_pdf,latest_pdf_revision,revision FROM problem_drafts WHERE id=$1', [id])).rows[0] ?? null;
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
    const verifying = kind === 'verify_all';
    if (verifying && !validVerificationMetadata(draft)) return await reject({ kind: 'invalid_metadata' });
    const source = kind === 'build_pdf' ? '' : kind === 'compile_solution' || kind === 'generate_outputs' || verifying ? draft.solution_cpp : draft.generator_cpp;
    if (kind !== 'build_pdf' && !source?.trim()) return await reject({ kind: 'source_missing' });
    let pdf: Awaited<ReturnType<typeof capturePdfSnapshot>> | undefined;
    if (kind === 'build_pdf' || verifying) {
      if (draft.template_version !== 'red-gate-v1') return await reject({ kind: 'unsupported_template' });
      if (!draft.statement_html.trim()) return await reject({ kind: 'invalid_statement' });
      try { pdf = await capturePdfSnapshot(client, draft); }
      catch (error) { if (error instanceof StatementError || (error as Error).name === 'ZodError') return await reject({ kind: 'invalid_statement' }); throw error; }
    }
    let cases: CaseInput[] | undefined;
    let expectedOutputs: CaseInput[] | undefined;
    if (kind === 'generate_outputs' || verifying) {
      if (draft.memory_limit_mb > AUTHORING_RUNNER.MAX_SOLUTION_MEMORY_MB || draft.time_limit_ms > AUTHORING_RUNNER.JOB_TIMEOUT_MS) {
        return await reject({ kind: 'unsupported_resource_limits' });
      }
      cases = (await client.query<CaseInput>(`SELECT id AS "caseId",case_number AS "caseNumber",
        original_input_filename AS filename,octet_length(input_data) AS "sizeBytes",
        encode(sha256(convert_to(input_data,'UTF8')),'hex') AS sha256
        FROM problem_draft_testcases WHERE draft_id=$1 ORDER BY case_number`, [draftId])).rows;
      if (!cases.length) return await reject({ kind: 'inputs_missing' });
      if (verifying) {
        if ((await client.query('SELECT 1 FROM problem_draft_testcases WHERE draft_id=$1 AND output_data IS NULL LIMIT 1', [draftId])).rows.length) {
          return await reject({ kind: 'outputs_missing' });
        }
        expectedOutputs = (await client.query<CaseInput>(`SELECT id AS "caseId",case_number AS "caseNumber",
          original_input_filename AS filename,octet_length(output_data) AS "sizeBytes",
          encode(sha256(convert_to(output_data,'UTF8')),'hex') AS sha256
          FROM problem_draft_testcases WHERE draft_id=$1 ORDER BY case_number`, [draftId])).rows;
      }
    }
    const parsedSnapshot = jobSnapshotSchema.safeParse({ version: 1, jobId: randomUUID(), draftId: draft.id, revision,
      kind, source, ...(seed === undefined ? {} : { seed }),
      ...(cases ? { cases, limits: { timeLimitMs: draft.time_limit_ms, memoryLimitMb: draft.memory_limit_mb } } : {}),
      ...(pdf ? { pdf: pdf.snapshot } : {}),
      ...(verifying ? { expectedOutputs, ...(draft.generator_cpp?.trim() ? { generatorSource: draft.generator_cpp } : {}) } : {}),
      deadline: new Date(Date.now() + AUTHORING_RUNNER.JOB_TIMEOUT_MS).toISOString() });
    if (!parsedSnapshot.success) {
      if (verifying) return await reject({ kind: 'invalid_testcases' });
      throw parsedSnapshot.error;
    }
    const snapshot = parsedSnapshot.data;
    const inserted = await client.query<DurableJob>(`
      INSERT INTO authoring_jobs (id, draft_id, job_type, draft_revision, request_snapshot)
      VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *
    `, [snapshot.jobId, draftId, snapshot.kind, revision, JSON.stringify(snapshot)]);
    if (cases) await client.query(`INSERT INTO authoring_job_inputs (job_id,case_id,case_number,input_data)
      SELECT $1,id,case_number,input_data FROM problem_draft_testcases WHERE draft_id=$2`, [snapshot.jobId, draftId]);
    if (pdf) {
      await client.query("INSERT INTO authoring_job_files (job_id,name,content) VALUES ($1,'avatar',$2)", [snapshot.jobId, pdf.avatar]);
      await client.query(`INSERT INTO authoring_job_files (job_id,name,content)
        SELECT $1,'asset:'||filename,content FROM problem_draft_assets WHERE draft_id=$2`, [snapshot.jobId, draftId]);
    }
    if (verifying) {
      await client.query(`INSERT INTO authoring_job_files (job_id,name,content)
        SELECT $1,'output:'||id::text,convert_to(output_data,'UTF8') FROM problem_draft_testcases WHERE draft_id=$2`, [snapshot.jobId, draftId]);
      // A requested fresh verification supersedes prior readiness, even at the same source revision.
      await client.query("UPDATE problem_drafts SET status='draft',verified_revision=NULL,updated_at=NOW() WHERE id=$1", [draftId]);
    }
    await client.query('COMMIT');
    // Deliver to the runner without waiting out the coordinator's poll tick.
    notifyJobActivity();
    return { kind: 'queued', job: inserted.rows[0] };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

/** Set by the coordinator at boot (avoids a circular import): called after
 *  job writes so delivery/result-import runs immediately, not on the next
 *  poll tick — this is what makes enqueue→result feel near-instant. */
let jobActivityListener: (() => void) | undefined;
export function setJobActivityListener(listener: (() => void) | undefined): void { jobActivityListener = listener; }
export function notifyJobActivity(): void { jobActivityListener?.(); }

/** Loads private job state for admin projection or internal reconciliation. */
export async function getAuthoringJob(id: string, database: JobDatabase = db): Promise<DurableJob | null> {
  return (await database.query<DurableJob>('SELECT * FROM authoring_jobs WHERE id=$1', [id])).rows[0] ?? null;
}

/** Imports a terminal result once; compilation alone never changes draft readiness. */
export async function applyJobResult(id: string, input: unknown, database: JobDatabase = db,
  readInput?: (index: number, artifact: InputArtifact) => Promise<string>,
  readPdf?: (artifact: PdfArtifact) => Promise<Buffer>): Promise<boolean> {
  const result = jobResultSchema.parse(input);
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query<DurableJob>('SELECT * FROM authoring_jobs WHERE id=$1', [id])).rows[0];
    if (!job || !ACTIVE_JOB_STATUSES.includes(job.status)) { await client.query('ROLLBACK'); return false; }
    if (result.jobId !== id || result.draftId !== job.draft_id || result.revision !== job.draft_revision) throw new Error('Result identity mismatch');
    const generating = job.job_type === 'run_generator';
    const outputting = job.job_type === 'generate_outputs';
    const verifying = job.job_type === 'verify_all';
    const syncing = job.job_type === 'sync_pdf';
    const buildingPdf = job.job_type === 'build_pdf' || verifying || syncing;
    if (verifying) validateVerificationReport(job.request_snapshot, result);
    else if (result.verification) throw new TestcaseError('invalid_verification_result', 'Unexpected verification report');
    if (result.status === 'succeeded' && (buildingPdf ? !result.pdf || !readPdf
      || result.pdf.templateVersion !== job.request_snapshot?.pdf?.document.templateVersion : result.pdf !== undefined)) {
      throw new TestcaseError('invalid_pdf', 'PDF artifact does not match the requested job');
    }
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
    const expired = verifying && Date.parse(job.request_snapshot!.deadline) <= Date.now();
    // sync_pdf is the only job kind that legitimately runs on a published draft;
    // its revision was produced by the sync itself and stays authoritative.
    const status = draft.revision !== result.revision || (draft.status === 'published' && !syncing) ? 'stale' : expired ? 'timed_out' : result.status;
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
    if (buildingPdf && status === 'succeeded') {
      const content = await readPdf!(result.pdf!);
      // A sync on a published draft keeps it published — published_at is the
      // durable fact; the status lifecycle must not demote it, and the republish
      // decision keys off published_at, not the (mutable) status value.
      const syncKeepsPublished = syncing && draft.published_at !== null;
      await client.query(`UPDATE problem_drafts SET latest_pdf=$1,latest_pdf_revision=$2,
        status=${syncKeepsPublished ? "'published'" : "'generated'"},verified_revision=NULL,updated_at=NOW() WHERE id=$3`, [content, result.revision, job.draft_id]);
      if (verifying) await client.query("UPDATE problem_drafts SET status='ready',verified_revision=$1 WHERE id=$2", [result.revision, job.draft_id]);
      if (syncing) {
        // Refresh the legacy problem's author metadata and PDF in the same
        // transaction, guarded by provenance like the publish path so legacy
        // edits made outside authoring are never silently overwritten.
        // Testcases are untouched (statement unchanged).
        if (syncKeepsPublished) {
          const republished = await republishSyncedProblem(client, job.draft_id, draft, content);
          if (!republished) throw new TestcaseError('sync_republish_failed',
            'The published problem changed outside authoring; the PDF was not republished');
        }
        await client.query(`UPDATE authoring_profile_sync_items SET status='synced',
          error_message=NULL, updated_at=NOW() WHERE sync_pdf_job_id=$1`, [job.id]);
      }
    }
    if (syncing && status !== 'succeeded') {
      await client.query(`UPDATE authoring_profile_sync_items SET status='failed',
        error_message=$2, updated_at=NOW() WHERE sync_pdf_job_id=$1`,
        [job.id, `PDF rebuild failed (${status}${result.errorCode ? `: ${result.errorCode}` : ''})`]);
    }
    const updated = await client.query(`
      UPDATE authoring_jobs SET status=$2, result_summary=$3::jsonb, log=$4,
        error_code=$5::text, error_message=$5::text, finished_at=NOW(), request_snapshot=NULL
      WHERE id=$1 AND status=ANY($6::text[])
        AND (NOT $7::boolean OR $2::text <> 'succeeded'
          OR (request_snapshot->>'deadline')::timestamptz > clock_timestamp()) RETURNING id
    `, [id, status, JSON.stringify({ runnerStatus: result.status, durationMs: result.durationMs, exitCode: result.exitCode,
      ...(generating ? { seed: job.request_snapshot?.seed, reproducibility: 'unverified',
        warnings: ['Reproducibility has not been demonstrated; legacy generators may ignore the seed.'],
        caseCount: result.inputs?.length ?? 0, inputs: result.inputs ?? [] } : {}),
      ...(outputting ? { caseCount: result.outputs?.length ?? 0, outputs: result.outputs ?? [],
        ...(result.failedCase ? { failedCase: result.failedCase } : {}) } : {}),
      ...(buildingPdf ? { pdf: result.pdf ?? null } : {}),
      ...(verifying ? { verification: result.verification ?? null,
        verifiedRevision: status === 'succeeded' ? result.revision : null,
        ...(result.failedCase ? { failedCase: result.failedCase } : {}),
        totalArtifactBytes: (result.verification?.totalTestcaseBytes ?? 0) + (result.pdf?.sizeBytes ?? 0)
          + (job.request_snapshot?.pdf?.assets.reduce((sum, a) => sum + a.sizeBytes, 0) ?? 0)
          + (job.request_snapshot?.pdf?.avatar.sizeBytes ?? 0) } : {}),
    }),
      result.log, expired ? 'job_expired' : result.errorCode, ACTIVE_JOB_STATUSES, verifying]);
    if (updated.rows.length !== 1) {
      await client.query('ROLLBACK');
      // Artifact I/O or row-lock waits may cross the deadline after the initial check.
      // Revoke the pending PDF/readiness writes before recording the timeout.
      if (verifying && Date.parse(job.request_snapshot!.deadline) <= Date.now()) {
        await failAuthoringJob(id, 'job_expired', true, database);
      }
      return false;
    }
    await client.query('DELETE FROM authoring_job_inputs WHERE job_id=$1', [id]);
    await client.query('DELETE FROM authoring_job_files WHERE job_id=$1', [id]);
    await client.query('COMMIT');
    notifyJobActivity();
    return updated.rows.length === 1;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

/** Fails abandoned or invalid jobs without allowing them to overwrite a terminal result. */
export async function failAuthoringJob(id: string, code: string, timedOut: boolean, database: JobDatabase = db): Promise<void> {
  await database.query(`WITH terminal AS (UPDATE authoring_jobs SET status=$2, error_code=$3::text, error_message=$3::text,
    finished_at=NOW(), request_snapshot=NULL WHERE id=$1 AND status=ANY($4::text[]) RETURNING id)
    , inputs AS (DELETE FROM authoring_job_inputs WHERE job_id IN (SELECT id FROM terminal))
    DELETE FROM authoring_job_files WHERE job_id IN (SELECT id FROM terminal)`,
  [id, timedOut ? 'timed_out' : 'failed', code, ACTIVE_JOB_STATUSES]);
  // A failed sync_pdf job also fails its cascade item so the run can finish.
  await database.query(`UPDATE authoring_profile_sync_items SET status='failed',
    error_message=$2, updated_at=NOW()
    WHERE sync_pdf_job_id=$1 AND status='syncing'`,
  [id, `PDF rebuild failed (${code})`]);
}

type PoolClientLike = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> };

/**
 * Refreshes a published problem's author metadata and PDF after a sync, using
 * the same provenance matching as the publish path so external legacy edits
 * refuse to be overwritten. Runs on a locked client inside applyJobResult's
 * transaction. Returns false when the legacy row no longer matches the last
 * authoring publication.
 */
async function republishSyncedProblem(client: PoolClientLike,
  draftId: string, draft: ProblemDraftRow, pdf: Buffer): Promise<boolean> {
  const provenance = (await client.query(`SELECT problem_id,title,author,time_limit_ms,memory_limit_mb
      FROM authoring_published_problems WHERE draft_id=$1`, [draftId])).rows[0] as
    { problem_id: string; title: string; author: string | null; time_limit_ms: number; memory_limit_mb: number } | undefined;
  if (!provenance) return false;
  const updated = await client.query(`UPDATE problems SET
    title=$2, author=$3, problem_pdf=$4
    WHERE id=$1 AND title=$5 AND author IS NOT DISTINCT FROM $6
      AND time_limit_ms=$7 AND memory_limit_mb=$8
    RETURNING id`,
  [provenance.problem_id, draft.title, draft.author_aka_name, pdf,
    provenance.title, provenance.author, provenance.time_limit_ms, provenance.memory_limit_mb]);
  if (!updated.rows.length) {
    const existing = await client.query('SELECT 1 FROM problems WHERE id=$1', [provenance.problem_id]);
    if (!existing.rows.length) return false;
    return false;
  }
  await client.query(`UPDATE authoring_published_problems SET title=$2,author=$3,updated_at=NOW() WHERE draft_id=$1`,
    [draftId, draft.title, draft.author_aka_name]);
  return true;
}

import { createHash } from 'node:crypto';
import * as db from '../db';
import { ProblemDraftRow, AuthoringJobRow } from '../types/authoring';
import { ACTIVE_JOB_STATUSES, JobDatabase } from './authoringJobQueryService';
import { validVerificationMetadata } from './authoringVerificationService';
import { pdfArtifactSchema, verificationSchema } from '../authoring/protocol';
import { TESTCASE_LIMITS, validateTestcaseFilename } from '../authoring/testcases';

type PublishFailure = 'not_found' | 'published' | 'revision_conflict' | 'not_ready'
  | 'pdf_not_verified' | 'invalid_testcases' | 'busy' | 'problem_id_conflict';
export type PublishResult = { kind: PublishFailure; currentRevision?: number }
  | { kind: 'created'; draftId: string; problemId: string; revision: number; caseCount: number; publishedAt: Date };

/** Publish only verified artifacts; no source code is copied into the legacy grader tables. */
export async function publishProblemDraft(draftId: string, expectedRevision: number,
  database: JobDatabase = db): Promise<PublishResult> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const draft = (await client.query<ProblemDraftRow>('SELECT * FROM problem_drafts WHERE id=$1 FOR UPDATE', [draftId])).rows[0];
    const reject = async (kind: PublishFailure): Promise<PublishResult> => {
      await client.query('ROLLBACK'); return { kind, ...(draft ? { currentRevision: draft.revision } : {}) };
    };
    if (!draft) return await reject('not_found');
    if (draft.status === 'published') return await reject('published');
    if (draft.revision !== expectedRevision) return await reject('revision_conflict');
    if ((await client.query('SELECT 1 FROM authoring_jobs WHERE draft_id=$1 AND status=ANY($2::text[]) LIMIT 1',
      [draftId, ACTIVE_JOB_STATUSES])).rows.length) return await reject('busy');
    if (draft.status !== 'ready' || draft.verified_revision !== draft.revision || !validVerificationMetadata(draft)) return await reject('not_ready');

    const verification = (await client.query<AuthoringJobRow>(`SELECT * FROM authoring_jobs
      WHERE draft_id=$1 AND job_type='verify_all' ORDER BY created_at DESC,id DESC LIMIT 1`, [draftId])).rows[0];
    const summary = verification?.result_summary;
    const report = verificationSchema.safeParse(summary?.verification);
    if (!verification || verification.status !== 'succeeded' || verification.draft_revision !== draft.revision
      || summary?.verifiedRevision !== draft.revision || !report.success
      || report.data.checks.pdf !== 'passed' || report.data.checks.solution !== 'passed' || report.data.checks.execution !== 'passed'
      || report.data.checks.generator !== (draft.generator_cpp?.trim() ? 'passed' : 'skipped')) return await reject('not_ready');

    const manifest = pdfArtifactSchema.safeParse(summary?.pdf);
    if (!draft.latest_pdf || draft.latest_pdf_revision !== draft.revision || !manifest.success
      || manifest.data.templateVersion !== draft.template_version || manifest.data.sizeBytes !== draft.latest_pdf.length
      || manifest.data.sha256 !== createHash('sha256').update(draft.latest_pdf).digest('hex')) return await reject('pdf_not_verified');

    // Load metadata only. SQL copies large testcase contents inside the transaction.
    const cases = (await client.query<{ id: string; case_number: number; filename: string; input_bytes: number; output_bytes: number | null }>(
      `SELECT id,case_number,original_input_filename AS filename,octet_length(input_data) AS input_bytes,
       octet_length(output_data) AS output_bytes FROM problem_draft_testcases WHERE draft_id=$1 ORDER BY case_number LIMIT $2`,
      [draftId, TESTCASE_LIMITS.MAX_CASES + 1])).rows;
    let total = 0;
    if (!cases.length || cases.length > TESTCASE_LIMITS.MAX_CASES || cases.length !== report.data.caseCount
      || cases.length !== report.data.cases.length) return await reject('invalid_testcases');
    for (const [i, c] of cases.entries()) {
      try { validateTestcaseFilename(c.filename); } catch { return await reject('invalid_testcases'); }
      if (c.output_bytes === null || c.input_bytes > TESTCASE_LIMITS.MAX_FILE_BYTES || c.output_bytes > TESTCASE_LIMITS.MAX_FILE_BYTES
        || report.data.cases[i].caseId !== c.id || report.data.cases[i].caseNumber !== c.case_number) return await reject('invalid_testcases');
      total += c.input_bytes + c.output_bytes;
    }
    if (total > TESTCASE_LIMITS.MAX_TOTAL_BYTES || total !== report.data.totalTestcaseBytes) return await reject('invalid_testcases');

    // ON CONFLICT targets only the Problem ID, including races with the legacy upload path.
    // Never upsert: another author's published problem must remain untouched.
    const inserted = await client.query(`INSERT INTO problems
      (id,title,author,problem_pdf,time_limit_ms,memory_limit_mb,is_visible)
      VALUES ($1,$2,$3,$4,$5,$6,false) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [draft.problem_id, draft.title, draft.author_aka_name, draft.latest_pdf, draft.time_limit_ms, draft.memory_limit_mb]);
    if (!inserted.rows.length) return await reject('problem_id_conflict');
    await client.query(`INSERT INTO testcases (problem_id,case_number,input_data,output_data)
      SELECT $1,case_number,input_data,output_data FROM problem_draft_testcases WHERE draft_id=$2 ORDER BY case_number`, [draft.problem_id, draftId]);
    const published = (await client.query<{ published_at: Date }>(`UPDATE problem_drafts SET status='published',
      published_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING published_at`, [draftId])).rows[0];
    await client.query('COMMIT');
    return { kind: 'created', draftId, problemId: draft.problem_id, revision: draft.revision,
      caseCount: cases.length, publishedAt: published.published_at };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

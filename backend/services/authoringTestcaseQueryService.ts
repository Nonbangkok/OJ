import { randomUUID } from 'node:crypto';
import * as db from '../db';
import { JobDatabase } from './authoringJobQueryService';
import { PreparedTestcase, PreparedTestcasePatch } from './authoringTestcaseUploadService';
import { TESTCASE_LIMITS, TestcaseError, validateTestcaseFilename } from '../authoring/testcases';

type Mutation = { kind: 'append'; cases: PreparedTestcase[] | AsyncIterable<PreparedTestcase> }
  | { kind: 'replace'; cases: PreparedTestcase[] | AsyncIterable<PreparedTestcase> }
  | { kind: 'patch'; caseId: string; patch: PreparedTestcasePatch }
  | { kind: 'delete'; caseId: string };
export type TestcaseMutationResult = { kind: 'saved'; revision: number }
  | { kind: 'not_found' | 'case_not_found' }
  | { kind: 'published' | 'revision_conflict'; currentRevision: number };

const metadataColumns = `id, case_number AS "caseNumber", original_input_filename AS filename,
  octet_length(input_data) AS "inputBytes", octet_length(output_data) AS "outputBytes",
  (output_data IS NOT NULL) AS "hasOutput", source, source_revision AS "sourceRevision",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function listDraftTestcases(draftId: string, database: JobDatabase = db) {
  const draft = (await database.query('SELECT revision FROM problem_drafts WHERE id=$1', [draftId])).rows[0];
  if (!draft) return null;
  const result = await database.query(`SELECT ${metadataColumns} FROM problem_draft_testcases WHERE draft_id=$1 ORDER BY case_number, id`, [draftId]);
  return { revision: draft.revision, testcases: result.rows };
}

export async function getDraftTestcase(draftId: string, caseId: string, database: JobDatabase = db) {
  return (await database.query(`SELECT ${metadataColumns}, input_data AS input, output_data AS output
    FROM problem_draft_testcases WHERE draft_id=$1 AND id=$2`, [draftId, caseId])).rows[0] ?? null;
}

/** Serialize manual edits with generator import and Publish through the draft row lock. */
export async function mutateDraftTestcases(draftId: string, expectedRevision: number, mutation: Mutation, database: JobDatabase = db): Promise<TestcaseMutationResult> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const draft = (await client.query('SELECT revision, status FROM problem_drafts WHERE id=$1 FOR UPDATE', [draftId])).rows[0];
    const reject = async (result: TestcaseMutationResult) => { await client.query('ROLLBACK'); return result; };
    if (!draft) return await reject({ kind: 'not_found' });
    if (draft.status === 'published') return await reject({ kind: 'published', currentRevision: draft.revision });
    if (draft.revision !== expectedRevision) return await reject({ kind: 'revision_conflict', currentRevision: draft.revision });
    const revision = draft.revision + 1;
    const current = (await client.query(`SELECT COUNT(*)::int AS count, COALESCE(MAX(case_number), 0)::int AS last,
      COALESCE(SUM(octet_length(input_data) + COALESCE(octet_length(output_data), 0)), 0)::text AS bytes
      FROM problem_draft_testcases WHERE draft_id=$1`, [draftId])).rows[0];
    const checkText = (text: string, filename: string) => {
      const size = Buffer.byteLength(text);
      if (size > TESTCASE_LIMITS.MAX_FILE_BYTES) throw new TestcaseError('testcase_file_too_large', `${filename} exceeds 64 MiB`);
      if (text.includes('\0')) throw new TestcaseError('invalid_testcase_text', `${filename} contains NUL`);
      return size;
    };
    const checkTotal = (bytes: number) => {
      if (bytes > TESTCASE_LIMITS.MAX_TOTAL_BYTES) throw new TestcaseError('testcase_total_size_exceeded', 'Draft testcases exceed 512 MiB total');
    };
    const checkName = async (filename: string, exceptId: string | null = null) => {
      validateTestcaseFilename(filename);
      const duplicate = await client.query(`SELECT id FROM problem_draft_testcases WHERE draft_id=$1
        AND original_input_filename=$2 AND ($3::uuid IS NULL OR id<>$3::uuid) LIMIT 1`, [draftId, filename, exceptId]);
      if (duplicate.rows.length) throw new TestcaseError('duplicate_testcase_filename', `Duplicate input filename: ${filename}`);
    };
    if (mutation.kind === 'append' || mutation.kind === 'replace') {
      const replace = mutation.kind === 'replace';
      if (replace) await client.query('DELETE FROM problem_draft_testcases WHERE draft_id=$1', [draftId]);
      let count = replace ? 0 : current.count;
      let number = replace ? 1 : current.last + 1;
      let bytes = replace ? 0 : Number(current.bytes);
      let added = 0;
      // ZIP decoding and insertion are sequential: at most one pair is retained.
      // Any late stream/size/DB failure rolls back even the initial DELETE.
      for await (const testcase of mutation.cases) {
        if (++count > TESTCASE_LIMITS.MAX_CASES) throw new TestcaseError('testcase_count_exceeded', 'Draft exceeds 1,000 testcases');
        await checkName(testcase.filename);
        bytes += checkText(testcase.input, testcase.filename) + (testcase.output === null ? 0 : checkText(testcase.output, testcase.filename));
        checkTotal(bytes);
        await client.query(`INSERT INTO problem_draft_testcases
          (id,draft_id,case_number,original_input_filename,input_data,output_data,source,source_revision)
          VALUES ($1,$2,$3,$4,$5,$6,'uploaded',$7)`, [randomUUID(), draftId, number++, testcase.filename, testcase.input, testcase.output, revision]);
        added++;
      }
      if (!added) throw new TestcaseError('testcase_input_required', 'At least one input is required');
    } else {
      const existing = (await client.query(`SELECT id,original_input_filename,octet_length(input_data) AS input_bytes,
        COALESCE(octet_length(output_data),0) AS output_bytes FROM problem_draft_testcases WHERE draft_id=$1 AND id=$2`, [draftId, mutation.caseId])).rows[0];
      if (!existing) return await reject({ kind: 'case_not_found' });
      if (mutation.kind === 'delete') await client.query('DELETE FROM problem_draft_testcases WHERE draft_id=$1 AND id=$2', [draftId, mutation.caseId]);
      else {
        const patch = mutation.patch;
        if (patch.input === undefined && patch.output === undefined) throw new TestcaseError('testcase_file_required', 'An input or output file is required');
        const name = patch.filename ?? existing.original_input_filename;
        await checkName(name, mutation.caseId);
        let bytes = Number(current.bytes);
        if (patch.input !== undefined) bytes += checkText(patch.input, name) - existing.input_bytes - existing.output_bytes;
        if (patch.output !== undefined) bytes += checkText(patch.output, name) - (patch.input === undefined ? existing.output_bytes : 0);
        checkTotal(bytes);
        await client.query(`UPDATE problem_draft_testcases SET
          original_input_filename=COALESCE($3,original_input_filename),input_data=COALESCE($4,input_data),
          output_data=CASE WHEN $5::text IS NOT NULL THEN $5 WHEN $4::text IS NOT NULL THEN NULL ELSE output_data END,
          source='uploaded',source_revision=$6,updated_at=NOW() WHERE draft_id=$1 AND id=$2`,
        [draftId, mutation.caseId, patch.filename ?? null, patch.input ?? null, patch.output ?? null, revision]);
      }
    }
    await client.query("UPDATE problem_drafts SET revision=$2,status='draft',verified_revision=NULL,updated_at=NOW() WHERE id=$1", [draftId, revision]);
    await client.query('COMMIT');
    return { kind: 'saved', revision };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

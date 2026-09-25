import * as db from '../db';
import { PoolClient } from 'pg';
import unzipper from 'unzipper';
import { AdminProblemRow, ProblemDetailDTO, ProblemRow } from '../types/models';
import { CreateProblemRequestBody, UpdateProblemRequestBody } from '../types/api';
import {
  ProblemExportBundle,
  ProblemExportTestcaseRow,
  ProblemStatsRow,
  ReplaceProblemTestcasesFromZipResult,
} from '../types/service';
import { fullyPairedCaseNumbers, pairZippedTestcaseFiles } from './testcaseZipPairing';
import { isUniqueViolation } from '../utils/dbErrors';

/**
 * Run `body` inside a single transaction. BEGIN/COMMIT/ROLLBACK on a dedicated
 * pool client (same pattern as problemMigration.ts), with the client always
 * released back to the pool.
 */
async function withTransaction<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');
    const result = await body(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // A failed ROLLBACK usually means the connection is already broken;
      // release() will discard it. Surface the original error.
      console.error('ROLLBACK failed during transaction cleanup:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Difficulty filtering/sorting options for the user-facing problem list. */
export interface ProblemListDifficultyOptions {
  /** Inclusive lower bound; when set, Unrated (NULL) problems are excluded. */
  difficultyMin?: number;
  /** Inclusive upper bound; when set, Unrated (NULL) problems are excluded. */
  difficultyMax?: number;
  /** Sort key; 'difficulty' sorts NULLS LAST in both directions. */
  sort?: 'difficulty';
  order?: 'asc' | 'desc';
}

export const getProblemsWithStatsForUser = async (
  /** Submitting user; null for guests (public browsing) — the user-keyed
   *  CTEs return no rows, so only the public problem columns come back. */
  userId: number | null,
  options: ProblemListDifficultyOptions = {},
): Promise<ProblemStatsRow[]> => {
  const filters: string[] = [];
  const params: unknown[] = [userId];
  if (options.difficultyMin !== undefined) {
    params.push(options.difficultyMin);
    filters.push(`p.difficulty >= $${params.length}`);
  }
  if (options.difficultyMax !== undefined) {
    params.push(options.difficultyMax);
    filters.push(`p.difficulty <= $${params.length}`);
  }
  // No difficulty filter → the default view: Unrated problems included,
  // ordered exactly as before (by id).
  const orderBy = options.sort === 'difficulty'
    ? `p.difficulty ${options.order === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, p.id`
    : 'p.id';
  const query = `
      WITH RankedSubmissions AS (
        SELECT
          s.id,
          s.user_id,
          s.problem_id,
          s.score,
          s.overall_status,
          s.results,
          s.submitted_at,
          ROW_NUMBER() OVER(PARTITION BY s.user_id, s.problem_id ORDER BY s.score DESC, s.id DESC) as rn_best,
          ROW_NUMBER() OVER(PARTITION BY s.user_id, s.problem_id ORDER BY s.id DESC) as rn_latest
        FROM submissions s
        WHERE s.user_id = $1
      ),
      UserProblemStats AS (
        SELECT
          problem_id,
          MAX(score) AS best_score,
          COUNT(*) AS submission_count
        FROM submissions
        WHERE user_id = $1
        GROUP BY problem_id
      )
      SELECT
        p.id,
        p.title,
        p.author,
        p.categories,
        p.difficulty,
        ups.best_score,
        ups.submission_count,
        latest.submitted_at AS latest_submission_at,
        latest.overall_status AS latest_submission_status,
        best.overall_status AS best_submission_status,
        best.results AS best_submission_results
      FROM problems p
      LEFT JOIN UserProblemStats ups ON p.id = ups.problem_id
      LEFT JOIN RankedSubmissions latest ON p.id = latest.problem_id AND latest.rn_latest = 1
      LEFT JOIN RankedSubmissions best ON p.id = best.problem_id AND best.rn_best = 1
      WHERE p.is_visible = true AND p.contest_id IS NULL
      ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
      ORDER BY ${orderBy}
  `;

  const result = await db.query<ProblemStatsRow>(query, params);
  return result.rows;
};

export const getVisibleProblems = async (): Promise<Array<Pick<ProblemRow, 'id' | 'title' | 'author' | 'difficulty'>>> => {
  const result = await db.query<Pick<ProblemRow, 'id' | 'title' | 'author' | 'difficulty'>>(
    'SELECT id, title, author, categories, difficulty FROM problems WHERE is_visible = true AND contest_id IS NULL ORDER BY id'
  );
  return result.rows;
};

export const getProblemDetail = async (problemId: string): Promise<ProblemDetailDTO | null> => {
  const result = await db.query<ProblemDetailDTO>(
    'SELECT id, title, author, categories, difficulty, time_limit_ms, memory_limit_mb, (problem_pdf IS NOT NULL) as has_pdf, is_visible, contest_id FROM problems WHERE id = $1',
    [problemId]
  );
  return result.rows[0] ?? null;
};

export const getProblemPdf = async (problemId: string): Promise<Buffer | null> => {
  const result = await db.query<Pick<ProblemRow, 'problem_pdf'>>('SELECT problem_pdf FROM problems WHERE id = $1', [problemId]);
  return result.rows[0]?.problem_pdf ?? null;
};

/** Single query for the PDF route: the PDF bytes plus the visibility context. */
export const getProblemPdfWithAccess = async (
  problemId: string,
): Promise<Pick<ProblemRow, 'problem_pdf' | 'is_visible' | 'contest_id' | 'title'> | null> => {
  const result = await db.query<Pick<ProblemRow, 'problem_pdf' | 'is_visible' | 'contest_id' | 'title'>>(
    'SELECT problem_pdf, is_visible, contest_id, title FROM problems WHERE id = $1',
    [problemId],
  );
  return result.rows[0] ?? null;
};

export const createProblem = async (
  payload: CreateProblemRequestBody,
): Promise<'duplicate_id' | ProblemRow> => {
  try {
    const result = await db.query<ProblemRow>(
      'INSERT INTO problems (id, title, author, categories, difficulty, collection_id, time_limit_ms, memory_limit_mb) VALUES ($1, $2, $3, $4::text[], $5, $6, $7, $8) RETURNING *',
      [payload.id, payload.title, payload.author, [...payload.categories ?? []], payload.difficulty ?? null, payload.collection_id ?? null, payload.time_limit_ms, payload.memory_limit_mb]
    );
    return result.rows[0];
  } catch (error) {
    if (isUniqueViolation(error)) return 'duplicate_id';
    throw error;
  }
};

export const updateProblem = async (
  oldId: string,
  payload: UpdateProblemRequestBody,
): Promise<'duplicate_id' | 'not_found' | ProblemRow> => {
  return withTransaction(async (client) => {
    if (oldId !== payload.id) {
      const existingProblem = await client.query<Pick<ProblemRow, 'id'>>('SELECT id FROM problems WHERE id = $1', [payload.id]);
      if (existingProblem.rows.length > 0) {
        return 'duplicate_id';
      }
    }

    // Categories are optional on update: undefined = leave unchanged, an
    // array (including the empty "uncategorized" array) = replace.
    const categoriesProvided = payload.categories !== undefined;
    // Difficulty is tri-state the same way: undefined = leave unchanged,
    // null = clear the rating (Unrated), number = set it.
    const difficultyProvided = payload.difficulty !== undefined;
    const result = await client.query<ProblemRow>(
      'UPDATE problems SET id = $1, title = COALESCE($2, title), author = COALESCE($3, author), categories = CASE WHEN $8::boolean THEN $4::text[] ELSE categories END, difficulty = CASE WHEN $9::boolean THEN $5 ELSE difficulty END, collection_id = CASE WHEN $11::boolean THEN $10 ELSE collection_id END, time_limit_ms = COALESCE($6, time_limit_ms), memory_limit_mb = COALESCE($7, memory_limit_mb) WHERE id = $12 RETURNING *',
      [payload.id, payload.title ?? null, payload.author ?? null, [...payload.categories ?? []], payload.difficulty ?? null, payload.time_limit_ms ?? null, payload.memory_limit_mb ?? null, categoriesProvided, difficultyProvided, payload.collection_id ?? null, payload.collection_id !== undefined, oldId]
    );

    if (result.rows.length === 0) {
      return 'not_found';
    }

    if (oldId !== payload.id) {
      await client.query('UPDATE contest_problems SET problem_id = $1 WHERE problem_id = $2', [payload.id, oldId]);
      await client.query('UPDATE contest_submissions SET problem_id = $1 WHERE problem_id = $2', [payload.id, oldId]);
    }

    return result.rows[0];
  });
};

export const deleteProblem = async (problemId: string): Promise<boolean> => {
  return withTransaction(async (client) => {
    await client.query('DELETE FROM submissions WHERE problem_id = $1', [problemId]);
    await client.query('DELETE FROM testcases WHERE problem_id = $1', [problemId]);
    await client.query('DELETE FROM contest_problems WHERE problem_id = $1', [problemId]);
    await client.query('DELETE FROM contest_submissions WHERE problem_id = $1', [problemId]);
    const result = await client.query<Pick<ProblemRow, 'id'>>('DELETE FROM problems WHERE id = $1 RETURNING id', [problemId]);
    return (result.rowCount ?? 0) > 0;
  });
};

export const getAdminProblems = async (): Promise<AdminProblemRow[]> => {
  const result = await db.query<AdminProblemRow>(
    'SELECT p.id, p.title, p.author, p.categories, p.difficulty, p.collection_id, col.name AS collection_name, p.is_visible, p.contest_id, c.status AS contest_status FROM problems p LEFT JOIN contests c ON p.contest_id = c.id LEFT JOIN collections col ON p.collection_id = col.id ORDER BY p.id'
  );
  return result.rows;
};

export const updateProblemVisibility = async (
  problemId: string,
  isVisible: boolean,
): Promise<Pick<ProblemRow, 'id' | 'title' | 'is_visible'> | null> => {
  const result = await db.query<Pick<ProblemRow, 'id' | 'title' | 'is_visible'>>(
    'UPDATE problems SET is_visible = $1 WHERE id = $2 RETURNING id, title, is_visible',
    [isVisible, problemId]
  );
  return result.rows[0] ?? null;
};

export const updateProblemPdf = async (problemId: string, pdfBuffer: Buffer): Promise<void> => {
  await db.query('UPDATE problems SET problem_pdf = $1 WHERE id = $2', [pdfBuffer, problemId]);
};

export const replaceProblemTestcasesFromZip = async (
  problemId: string,
  zipBuffer: Buffer,
): Promise<ReplaceProblemTestcasesFromZipResult> => {
  const zip = await unzipper.Open.buffer(zipBuffer);
  const testcaseFiles = pairZippedTestcaseFiles(zip.files);
  const pairedCases = fullyPairedCaseNumbers(testcaseFiles);

  if (pairedCases.length === 0) {
    return { kind: 'no_valid_pairs' };
  }

  // Read all pair buffers *before* opening the transaction so a corrupt zip
  // entry fails without touching existing testcases; the DELETE + INSERTs
  // then run atomically.
  const pairBuffers: Array<{ input: Buffer; output: Buffer }> = [];
  for (const key of pairedCases) {
    const pair = testcaseFiles[key];
    pairBuffers.push({
      input: await pair.in!.buffer(),
      output: await pair.out!.buffer(),
    });
  }

  return withTransaction(async (client) => {
    await client.query('DELETE FROM testcases WHERE problem_id = $1', [problemId]);

    let caseNumber = 1;
    for (const { input, output } of pairBuffers) {
      await client.query(
        'INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, $2, $3, $4)',
        [problemId, caseNumber, input.toString('utf-8'), output.toString('utf-8')]
      );
      caseNumber += 1;
    }

    return { kind: 'ok', insertedCount: pairedCases.length };
  });
};

export const getProblemExportBundle = async (problemId: string): Promise<ProblemExportBundle | null> => {
  const problemResult = await db.query<ProblemExportBundle['problem']>(
    'SELECT id, title, author, time_limit_ms, memory_limit_mb, problem_pdf FROM problems WHERE id = $1',
    [problemId]
  );

  const problem = problemResult.rows[0];
  if (!problem) {
    return null;
  }

  const testcasesResult = await db.query<ProblemExportTestcaseRow>(
    'SELECT case_number, input_data, output_data FROM testcases WHERE problem_id = $1 ORDER BY case_number ASC',
    [problemId]
  );

  return {
    problem,
    testcases: testcasesResult.rows,
  };
};

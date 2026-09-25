import * as db from '../db';
import { PoolClient } from 'pg';
import unzipper from 'unzipper';
import { AdminProblemRow, ProblemDetailDTO, ProblemRow, TestcaseRow } from '../types/models';
import { CreateProblemRequestBody, UpdateProblemRequestBody } from '../types/api';
import {
  ProblemCategoryCounts,
  ProblemExportBundle,
  ProblemExportTestcaseRow,
  ProblemsPage,
  ProblemStatsRow,
  ReplaceProblemTestcasesFromZipResult,
  TestcaseMetadataRow,
  TestcaseView,
  TestcaseViewPart,
} from '../types/service';
import { PROBLEM_LIST_CONFIG, TESTCASE_VIEWER_CONFIG } from '../constants';
import { fullyPairedCaseNumbers, pairZippedTestcaseFiles } from './testcaseZipPairing';
import { isUniqueViolation } from '../utils/dbErrors';
import { AppError } from '../middleware/errorHandler';

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

/** Full query surface of the paginated user-facing problem list. */
export interface ProblemListOptions extends ProblemListDifficultyOptions {
  /** Substring match on problem id or title (ILIKE, server-side). */
  search?: string;
  /** One category from the closed list, or 'Uncategorized' (empty array). */
  category?: string;
  /** Page size (1..MAX_LIMIT); defaults to PROBLEM_LIST_CONFIG.DEFAULT_LIMIT. */
  limit?: number;
  /** Opaque next-page token from a previous response. */
  cursor?: string;
}

/**
 * Opaque cursor payload: the last emitted row's sort key (plus the sort
 * mode it was produced under, so a cursor can never be replayed against a
 * different ordering). Encoded as base64url JSON — clients treat it as a
 * black box.
 */
interface ProblemListCursor {
  /** Sort mode the cursor was produced under ('' = default id order). */
  s: '' | 'difficulty';
  o: 'asc' | 'desc';
  /** Last emitted row's problem id (the tiebreaker in every sort mode). */
  id: string;
  /** Last emitted row's difficulty (null = Unrated); only set for difficulty sort. */
  d: number | null;
}

const encodeCursor = (cursor: ProblemListCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

/**
 * Decode and validate a cursor. Throws 400 for anything that is not a
 * cursor this service issued: undecodable base64/JSON, unknown sort mode,
 * or a sort mode that does not match the request's current sort/order (a
 * client that changed the sort must restart from the first page).
 */
const decodeCursor = (raw: string, expected: ProblemListCursor): ProblemListCursor => {
  let cursor: ProblemListCursor;
  try {
    cursor = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as ProblemListCursor;
  } catch {
    throw new AppError('Invalid cursor', 400);
  }
  if (
    typeof cursor !== 'object' || cursor === null
    || typeof cursor.id !== 'string' || cursor.id === ''
    || !['', 'difficulty'].includes(cursor.s)
    || !['asc', 'desc'].includes(cursor.o)
    || (cursor.d !== null && typeof cursor.d !== 'number')
    || cursor.s !== expected.s
    || cursor.o !== expected.o
  ) {
    throw new AppError('Invalid cursor', 400);
  }
  return cursor;
};

/**
 * Keyset predicate for rows strictly after the cursor, matching the
 * ORDER BY of the active sort mode (both put Unrated NULLS LAST):
 *  - default: id ASC
 *  - difficulty: difficulty ASC|DESC NULLS LAST, then id in the same direction
 */
const cursorCondition = (
  cursor: ProblemListCursor | null,
  params: unknown[],
): string | null => {
  if (!cursor) return null;
  if (cursor.s === '') {
    params.push(cursor.id);
    return `p.id > $${params.length}`;
  }
  const idCmp = cursor.o === 'desc' ? '<' : '>';
  if (cursor.d === null) {
    // Past every rated row already: only Unrated rows remain, tiebroken by id.
    params.push(cursor.id);
    return `(p.difficulty IS NULL AND p.id ${idCmp} $${params.length})`;
  }
  // Rated cursor row: later rated rows in sort direction, ties on difficulty
  // broken by id, then every Unrated row (NULLS LAST in both directions).
  params.push(cursor.d, cursor.id);
  const d = params.length - 1;
  const i = params.length;
  return `(
    p.difficulty ${idCmp} $${d}
    OR (p.difficulty = $${d} AND p.id ${idCmp} $${i})
    OR p.difficulty IS NULL
  )`;
};

/**
 * ANALYSIS-007: ILIKE treats user-supplied `%` and `_` as wildcards, so a
 * search like "100%" matches far more than intended. Backslash-escape both
 * (Postgres LIKE escape character). Backslashes in the search term are not
 * special for LIKE itself, but escaping them too keeps the term literal.
 */
const escapeLikePattern = (search: string): string =>
  search.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * One page of the user-facing problem list, ordered by the active sort mode.
 *
 * The problem batch is selected FIRST (filtered, cursor-positioned, limited
 * in SQL); the user's submission stats are then joined for exactly those
 * batch problem ids — the reverse of the pre-pagination shape, which
 * aggregated every submission before filtering. `limit + 1` rows are
 * fetched so hasMore/nextCursor come from the presence of an extra row.
 */
export const getProblemsWithStatsForUser = async (
  /** Submitting user; null for guests (public browsing) — the user-keyed
   *  CTEs return no rows, so only the public problem columns come back. */
  userId: number | null,
  options: ProblemListOptions = {},
): Promise<ProblemsPage> => {
  const limit = options.limit ?? PROBLEM_LIST_CONFIG.DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > PROBLEM_LIST_CONFIG.MAX_LIMIT) {
    throw new AppError(`limit must be an integer between 1 and ${PROBLEM_LIST_CONFIG.MAX_LIMIT}`, 400);
  }

  const sortMode: '' | 'difficulty' = options.sort === 'difficulty' ? 'difficulty' : '';
  const order = options.order === 'desc' ? 'desc' : 'asc';
  const cursor = options.cursor !== undefined
    ? decodeCursor(options.cursor, { s: sortMode, o: order, id: '', d: null })
    : null;

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
  if (options.search !== undefined && options.search !== '') {
    params.push(`%${escapeLikePattern(options.search)}%`);
    filters.push(`(p.id ILIKE $${params.length} OR p.title ILIKE $${params.length})`);
  }
  if (options.category === 'Uncategorized') {
    filters.push('cardinality(p.categories) = 0');
  } else if (options.category !== undefined) {
    params.push(options.category);
    filters.push(`p.categories @> ARRAY[$${params.length}]::text[]`);
  }
  const afterCursor = cursorCondition(cursor, params);
  if (afterCursor) {
    filters.push(afterCursor);
  }

  // No difficulty filter → the default view: Unrated problems included,
  // ordered exactly as before (by id). The id tiebreaker follows the sort
  // direction so the order is a total order in every mode.
  const orderBy = sortMode === 'difficulty'
    ? `p.difficulty ${order === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, p.id ${order === 'desc' ? 'DESC' : 'ASC'}`
    : 'p.id';
  const batchOrderBy = orderBy.replaceAll('p.', 'b.');
  // LIMIT is parameterized (limit + 1: the extra row signals hasMore).
  params.push(limit + 1);
  const fetchLimitParam = params.length;

  const query = `
      WITH batch AS (
        SELECT p.id, p.title, p.author, p.categories, p.difficulty
        FROM problems p
        WHERE p.is_visible = true AND p.contest_id IS NULL
        ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
        ORDER BY ${orderBy}
        LIMIT $${fetchLimitParam}
      ),
      RankedSubmissions AS (
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
        WHERE s.user_id = $1 AND s.problem_id IN (SELECT id FROM batch)
      ),
      UserProblemStats AS (
        SELECT
          s.problem_id,
          MAX(s.score) AS best_score,
          COUNT(*) AS submission_count
        FROM submissions s
        WHERE s.user_id = $1 AND s.problem_id IN (SELECT id FROM batch)
        GROUP BY s.problem_id
      )
      SELECT
        b.id,
        b.title,
        b.author,
        b.categories,
        b.difficulty,
        ups.best_score,
        ups.submission_count,
        latest.submitted_at AS latest_submission_at,
        latest.overall_status AS latest_submission_status,
        best.overall_status AS best_submission_status,
        best.results AS best_submission_results
      FROM batch b
      LEFT JOIN UserProblemStats ups ON b.id = ups.problem_id
      LEFT JOIN RankedSubmissions latest ON b.id = latest.problem_id AND latest.rn_latest = 1
      LEFT JOIN RankedSubmissions best ON b.id = best.problem_id AND best.rn_best = 1
      ORDER BY ${batchOrderBy}
  `;

  const result = await db.query<ProblemStatsRow>(query, params);
  const hasMore = result.rows.length > limit;
  const problems = hasMore ? result.rows.slice(0, limit) : result.rows;
  const last = problems[problems.length - 1];

  return {
    problems,
    hasMore,
    nextCursor: hasMore && last
      ? encodeCursor({ s: sortMode, o: order, id: last.id, d: sortMode === 'difficulty' ? last.difficulty : null })
      : null,
  };
};

/**
 * Global category tab counts for the public problem list (visible,
 * standalone problems only) — independent of any loaded batch, so the tabs
 * stay correct while the list itself streams in pages. A problem carrying
 * several categories counts toward every one of its tabs.
 */
export const getPublicProblemCategoryCounts = async (): Promise<ProblemCategoryCounts> => {
  const [categoryResult, totalsResult] = await Promise.all([
    db.query<{ name: string; count: number }>(`
      SELECT c.category AS name, COUNT(*)::int AS count
      FROM problems p
      CROSS JOIN LATERAL unnest(p.categories) AS c(category)
      WHERE p.is_visible = true AND p.contest_id IS NULL
      GROUP BY c.category
      ORDER BY count DESC, name ASC
    `),
    db.query<{ total: number; uncategorized: number }>(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE cardinality(p.categories) = 0)::int AS uncategorized
      FROM problems p
      WHERE p.is_visible = true AND p.contest_id IS NULL
    `),
  ]);

  return {
    categories: categoryResult.rows,
    uncategorized: totalsResult.rows[0]?.uncategorized ?? 0,
    total: totalsResult.rows[0]?.total ?? 0,
  };
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
      // XSYS-008: the remaining problem_id references have no foreign key
      // (rewards must survive problem deletion; provenance/drafts predate
      // FK-able schemas), so a rename must cascade to them explicitly —
      // otherwise Recently Solved keeps stale ids and the authoring republish
      // guard stops finding the live problem.
      await client.query('UPDATE user_problem_rewards SET problem_id = $1 WHERE problem_id = $2', [payload.id, oldId]);
      await client.query('UPDATE authoring_published_problems SET problem_id = $1 WHERE problem_id = $2', [payload.id, oldId]);
      await client.query('UPDATE problem_drafts SET problem_id = $1 WHERE problem_id = $2', [payload.id, oldId]);
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

export const updateProblemPdf = async (
  problemId: string,
  pdfBuffer: Buffer,
): Promise<'not_found' | 'ok'> => {
  const result = await db.query(
    'UPDATE problems SET problem_pdf = $1 WHERE id = $2 RETURNING id',
    [pdfBuffer, problemId],
  );
  // UPDATE on a nonexistent problem used to be a silent no-op (200 with 0
  // rows written) — surface it so the admin route can 404 (PROBLEM-004).
  if ((result.rowCount ?? 0) === 0) {
    return 'not_found';
  }
  return 'ok';
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

  // The zip pairs exist, but they must land somewhere: refuse the silent
  // no-op on a nonexistent problem (PROBLEM-004).
  const existsResult = await db.query<Pick<ProblemRow, 'id'>>(
    'SELECT id FROM problems WHERE id = $1',
    [problemId],
  );
  if (existsResult.rows.length === 0) {
    return { kind: 'not_found' };
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

// --- Admin testcase viewer -----------------------------------------------

const problemExists = async (problemId: string): Promise<boolean> => {
  const result = await db.query<Pick<ProblemRow, 'id'>>('SELECT id FROM problems WHERE id = $1', [problemId]);
  return result.rows.length > 0;
};

/**
 * Byte size of a UTF-8 string, matching what `length(X::bytea)` reports in
 * SQL for the metadata list.
 */
const utf8ByteLength = (value: string): number => Buffer.byteLength(value, 'utf-8');

/**
 * One side of a testcase, truncated to TESTCASE_VIEWER_CONFIG.MAX_CASE_BYTES
 * in the API: a full 64MB testcase (the per-file upload cap) shipped to a
 * browser tab freezes it, and case content is never judge-relevant at that
 * size — an admin eyeballing test data needs the head of the file, not all
 * 64MB. The true byte size always travels with the part so the UI can label
 * exactly what was cut.
 */
const toTestcaseViewPart = (content: string): TestcaseViewPart => {
  const bytes = utf8ByteLength(content);
  if (bytes <= TESTCASE_VIEWER_CONFIG.MAX_CASE_BYTES) {
    return { bytes, truncated: false, content };
  }
  // Slice by bytes, then drop a possibly-split trailing multi-byte character.
  const head = Buffer.from(content, 'utf-8').subarray(0, TESTCASE_VIEWER_CONFIG.MAX_CASE_BYTES).toString('utf-8');
  return { bytes, truncated: true, content: head };
};

/**
 * Admin testcase viewer data (staff-only; JUDGE-011 keeps testcase content
 * away from contestants). Two levels so problems with hundreds of large
 * cases stay cheap:
 *  - no caseNumber: metadata only — sizes computed in SQL (OCTET_LENGTH on
 *    the bytea representation), content columns never read.
 *  - caseNumber: one full case, each side API-truncated past 1 MiB.
 * Existence is checked first so a missing problem 404s regardless of the
 * requested case.
 */
export const getProblemTestcases = async (
  problemId: string,
  caseNumber?: number,
): Promise<
  | { kind: 'not_found' }
  | { kind: 'ok'; testcases: TestcaseMetadataRow[] }
  | { kind: 'case_not_found' }
  | { kind: 'ok_case'; testcase: TestcaseView }
> => {
  if (!(await problemExists(problemId))) {
    return { kind: 'not_found' };
  }

  if (caseNumber === undefined) {
    const result = await db.query<TestcaseMetadataRow>(
      `SELECT case_number,
              OCTET_LENGTH(input_data::bytea) AS input_bytes,
              OCTET_LENGTH(output_data::bytea) AS output_bytes
       FROM testcases WHERE problem_id = $1 ORDER BY case_number ASC`,
      [problemId],
    );
    return { kind: 'ok', testcases: result.rows };
  }

  const result = await db.query<Pick<TestcaseRow, 'case_number' | 'input_data' | 'output_data'>>(
    'SELECT case_number, input_data, output_data FROM testcases WHERE problem_id = $1 AND case_number = $2',
    [problemId, caseNumber],
  );
  const row = result.rows[0];
  if (!row) {
    return { kind: 'case_not_found' };
  }

  return {
    kind: 'ok_case',
    testcase: {
      caseNumber: row.case_number,
      input: toTestcaseViewPart(row.input_data),
      output: toTestcaseViewPart(row.output_data),
    },
  };
};

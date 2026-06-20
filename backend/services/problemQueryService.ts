import * as db from '../db';
import path from 'path';
import unzipper from 'unzipper';
import { AdminProblemRow, ProblemDetailDTO, ProblemRow } from '../types/models';
import { CreateProblemRequestBody, UpdateProblemRequestBody } from '../types/api';
import {
  ProblemExportBundle,
  ProblemExportTestcaseRow,
  ProblemStatsRow,
  ReplaceProblemTestcasesFromZipResult,
  TestcasePairMap,
} from '../types/service';

export const getProblemsWithStatsForUser = async (userId: number): Promise<ProblemStatsRow[]> => {
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
      ORDER BY p.id
  `;

  const result = await db.query<ProblemStatsRow>(query, [userId]);
  return result.rows;
};

export const getVisibleProblems = async (): Promise<Array<Pick<ProblemRow, 'id' | 'title' | 'author'>>> => {
  const result = await db.query<Pick<ProblemRow, 'id' | 'title' | 'author'>>(
    'SELECT id, title, author FROM problems WHERE is_visible = true AND contest_id IS NULL ORDER BY id'
  );
  return result.rows;
};

export const getProblemDetail = async (problemId: string): Promise<ProblemDetailDTO | null> => {
  const result = await db.query<ProblemDetailDTO>(
    'SELECT id, title, author, time_limit_ms, memory_limit_mb, (problem_pdf IS NOT NULL) as has_pdf, is_visible, contest_id FROM problems WHERE id = $1',
    [problemId]
  );
  return result.rows[0] ?? null;
};

export const getProblemPdf = async (problemId: string): Promise<Buffer | null> => {
  const result = await db.query<Pick<ProblemRow, 'problem_pdf'>>('SELECT problem_pdf FROM problems WHERE id = $1', [problemId]);
  return result.rows[0]?.problem_pdf ?? null;
};

export const createProblem = async (payload: CreateProblemRequestBody): Promise<ProblemRow> => {
  const result = await db.query<ProblemRow>(
    'INSERT INTO problems (id, title, author, time_limit_ms, memory_limit_mb) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [payload.id, payload.title, payload.author, payload.time_limit_ms, payload.memory_limit_mb]
  );
  return result.rows[0];
};

export const updateProblem = async (
  oldId: string,
  payload: UpdateProblemRequestBody,
): Promise<'duplicate_id' | 'not_found' | ProblemRow> => {
  if (oldId !== payload.id) {
    const existingProblem = await db.query<Pick<ProblemRow, 'id'>>('SELECT id FROM problems WHERE id = $1', [payload.id]);
    if (existingProblem.rows.length > 0) {
      return 'duplicate_id';
    }
  }

  const result = await db.query<ProblemRow>(
    'UPDATE problems SET id = $1, title = $2, author = $3, time_limit_ms = $4, memory_limit_mb = $5 WHERE id = $6 RETURNING *',
    [payload.id, payload.title, payload.author, payload.time_limit_ms, payload.memory_limit_mb, oldId]
  );

  if (result.rows.length === 0) {
    return 'not_found';
  }

  if (oldId !== payload.id) {
    await db.query('UPDATE contest_problems SET problem_id = $1 WHERE problem_id = $2', [payload.id, oldId]);
    await db.query('UPDATE contest_submissions SET problem_id = $1 WHERE problem_id = $2', [payload.id, oldId]);
  }

  return result.rows[0];
};

export const deleteProblem = async (problemId: string): Promise<boolean> => {
  await db.query('DELETE FROM submissions WHERE problem_id = $1', [problemId]);
  await db.query('DELETE FROM testcases WHERE problem_id = $1', [problemId]);
  await db.query('DELETE FROM contest_problems WHERE problem_id = $1', [problemId]);
  await db.query('DELETE FROM contest_submissions WHERE problem_id = $1', [problemId]);
  const result = await db.query<Pick<ProblemRow, 'id'>>('DELETE FROM problems WHERE id = $1 RETURNING id', [problemId]);
  return (result.rowCount ?? 0) > 0;
};

export const getAdminProblems = async (): Promise<AdminProblemRow[]> => {
  const result = await db.query<AdminProblemRow>(
    'SELECT p.id, p.title, p.author, p.is_visible, p.contest_id, c.status AS contest_status FROM problems p LEFT JOIN contests c ON p.contest_id = c.id ORDER BY p.id'
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
  await db.query('DELETE FROM testcases WHERE problem_id = $1', [problemId]);

  const zip = await unzipper.Open.buffer(zipBuffer);
  const testcaseFiles: TestcasePairMap<unzipper.File> = {};
  const fileRegex = /^(?:input|output)?(\d+)\.(?:in|out|txt|sol)$/i;

  for (const file of zip.files) {
    const fileName = path.basename(file.path);
    const isJunk = file.path.startsWith('__MACOSX/') || fileName.startsWith('._');

    if (file.type !== 'File' || isJunk) {
      continue;
    }

    const match = fileName.match(fileRegex);
    if (!match) {
      continue;
    }

    const number = Number.parseInt(match[1], 10);
    testcaseFiles[number] ??= {};

    const lowerFileName = fileName.toLowerCase();
    if (lowerFileName.endsWith('.in') || lowerFileName.includes('input')) {
      testcaseFiles[number].in = file;
      continue;
    }
    if (lowerFileName.endsWith('.out') || lowerFileName.endsWith('.sol') || lowerFileName.includes('output')) {
      testcaseFiles[number].out = file;
    }
  }

  const sortedKeys = Object.keys(testcaseFiles).map(Number).sort((a, b) => a - b);
  const pairedCases = sortedKeys.filter((key) => testcaseFiles[key].in && testcaseFiles[key].out);

  if (pairedCases.length === 0) {
    return { kind: 'no_valid_pairs' };
  }

  let caseNumber = 1;
  for (const key of pairedCases) {
    const pair = testcaseFiles[key];
    const inputData = await pair.in!.buffer();
    const outputData = await pair.out!.buffer();

    await db.query(
      'INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, $2, $3, $4)',
      [problemId, caseNumber, inputData.toString('utf-8'), outputData.toString('utf-8')]
    );

    caseNumber += 1;
  }

  return { kind: 'ok', insertedCount: pairedCases.length };
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

import type { PoolClient } from 'pg';
import type { Response } from 'express';
import { ZipArchive } from 'archiver';
import { logger } from '../utils/logger';
import * as db from '../db';
import { AppError } from '../middleware/errorHandler';
import type { ProblemFileRole, ProblemType } from '../constants';
import { validateProblemFileSet, type ProblemFileInput } from '../utils/headerProblemFiles';

export async function listProblemFiles(
  problemId: string,
): Promise<Array<{ role: ProblemFileRole; filename: string; bytes: number }>> {
  const result = await db.query<{ role: ProblemFileRole; filename: string; bytes: number }>(
    `SELECT role, filename, OCTET_LENGTH(content)::int AS bytes
       FROM problem_files
      WHERE problem_id = $1
      ORDER BY role, filename`,
    [problemId],
  );
  return result.rows;
}

export async function getProblemFiles(
  problemId: string,
  role: ProblemFileRole,
  client?: PoolClient,
): Promise<ProblemFileInput[]> {
  const sql = `SELECT filename, content FROM problem_files
                WHERE problem_id = $1 AND role = $2
                ORDER BY filename`;
  const result = client
    ? await client.query(sql, [problemId, role])
    : await db.query(sql, [problemId, role]);
  return result.rows.map((r: { filename: string; content: Buffer }) => ({
    filename: r.filename,
    content: r.content,
  }));
}

export async function getProblemFile(
  problemId: string,
  role: ProblemFileRole,
  filename: string,
): Promise<Buffer | null> {
  const result = await db.query(
    'SELECT content FROM problem_files WHERE problem_id = $1 AND role = $2 AND filename = $3',
    [problemId, role, filename],
  );
  return result.rows[0]?.content ?? null;
}

/** Replaces all files of one role. The caller owns the transaction. */
export async function replaceProblemFiles(
  client: PoolClient,
  problemId: string,
  role: ProblemFileRole,
  files: readonly ProblemFileInput[],
): Promise<void> {
  const problem = await client.query('SELECT submission_filename FROM problems WHERE id = $1', [problemId]);
  if (problem.rows.length === 0) throw new AppError('Problem not found', 404);

  const error = validateProblemFileSet(role, files, problem.rows[0].submission_filename ?? null);
  if (error) throw new AppError(error, 400);

  await client.query('DELETE FROM problem_files WHERE problem_id = $1 AND role = $2', [problemId, role]);
  for (const file of files) {
    await client.query(
      'INSERT INTO problem_files (problem_id, role, filename, content) VALUES ($1, $2, $3, $4)',
      [problemId, role, file.filename, file.content],
    );
  }
}

export async function getHeaderJudgeSpec(problemId: string): Promise<{
  problemType: ProblemType;
  submissionFilename: string | null;
  graderFiles: ProblemFileInput[];
} | null> {
  const result = await db.query(
    'SELECT problem_type, submission_filename FROM problems WHERE id = $1',
    [problemId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const problemType = row.problem_type as ProblemType;
  const graderFiles = problemType === 'header' ? await getProblemFiles(problemId, 'grader') : [];
  return { problemType, submissionFilename: row.submission_filename ?? null, graderFiles };
}

export async function hasGraderSource(problemId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM problem_files
        WHERE problem_id = $1 AND role = 'grader' AND filename LIKE '%.cpp'
     ) AS exists`,
    [problemId],
  );
  return Boolean(result.rows[0]?.exists);
}

export function appendStarterZip(archive: ZipArchive, files: readonly ProblemFileInput[]): void {
  for (const file of files) {
    archive.append(file.content, { name: file.filename });
  }
}

/** Streams the starter files to `res` as a ZIP attachment named `<problemId>-starter.zip`. */
export async function sendStarterZip(res: Response, problemId: string, files: readonly ProblemFileInput[]): Promise<void> {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${problemId}-starter.zip"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on('error', (err: Error) => {
    logger.error('Starter archive error', { problemId, error: err.message });
    res.destroy(err);
  });
  archive.pipe(res);
  appendStarterZip(archive, files);
  await archive.finalize();
}

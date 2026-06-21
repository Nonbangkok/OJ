import * as db from '../db';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { judge } from './judgeService';
import { ContestSubmissionRow, SubmissionRow } from '../types/models';
import { CompileCommandError } from '../types/service';
import { JUDGE_CONFIG } from '../constants';

const execPromise = promisify(exec);

// Guard the compile step against compiler bombs / pathological sources that
// could otherwise hang the single-threaded judge worker indefinitely. A
// timeout kills runaway g++ invocations; maxBuffer caps compiler output so a
// flood of diagnostics cannot exhaust memory. A timeout surfaces as a normal
// compile failure (caught below) rather than crashing the process.
//
// `env` is stripped to a minimal PATH so a malicious source cannot exfiltrate
// the backend's secrets at COMPILE time — e.g. `#include "/proc/self/environ"`
// would otherwise make g++ quote the environment (DATABASE_URL / PGPASSWORD /
// SECRET_KEY) back in its error output. (The run step is already env-stripped.)
const COMPILE_EXEC_OPTIONS = {
  timeout: JUDGE_CONFIG.COMPILE_TIMEOUT_MS,
  maxBuffer: JUDGE_CONFIG.COMPILE_MAX_BUFFER,
  env: { PATH: JUDGE_CONFIG.SANDBOX_PATH } as unknown as NodeJS.ProcessEnv,
};

/**
 * Detect an `#include` directive that would read a file outside the submission
 * (absolute path or `..` traversal). g++ resolves such includes at compile time
 * and quotes the file's contents in its diagnostics, turning a submission into
 * an arbitrary file read. Returns the offending target, or null if the source
 * is clean. Defence-in-depth alongside the compile env-strip above.
 */
export function findForbiddenInclude(code: string): string | null {
  const includeRe = /^\s*#\s*include\s*[<"]\s*([^>"]*?)\s*[>"]/;
  for (const line of code.split('\n')) {
    const match = line.match(includeRe);
    if (!match) {
      continue;
    }
    const target = match[1];
    if (target.startsWith('/') || target.includes('..')) {
      return target;
    }
  }
  return null;
}

/**
 * Replace the internal temporary source path in compiler output with a neutral
 * name so server filesystem paths are not disclosed to submitters.
 */
export function sanitizeCompilerStderr(stderr: string | undefined, sourcePath: string): string {
  if (!stderr) {
    return 'Compilation failed';
  }
  return sourcePath ? stderr.split(sourcePath).join('solution.cpp') : stderr;
}

const FORBIDDEN_INCLUDE_MESSAGE = (target: string): string =>
  `Compilation rejected: #include of a non-permitted path ("${target}") is not allowed. ` +
  `Use standard library headers (e.g. <bits/stdc++.h>) only.`;

export async function processSubmission(submissionId: number): Promise<void> {
  let filePath = '';
  let outputPath = '';

  try {
    const subRes = await db.query<SubmissionRow>(
      'SELECT * FROM submissions WHERE id = $1',
      [submissionId]
    );
    if (subRes.rows.length === 0) {
      console.error(`Submission ${submissionId} not found for processing.`);
      return;
    }
    const { problem_id, code } = subRes.rows[0];

    await db.query(`UPDATE submissions SET overall_status = 'Compiling' WHERE id = $1`, [submissionId]);

    const uniqueId = `${submissionId}_${Date.now()}`;
    filePath = path.join(__dirname, 'submissions', `${uniqueId}.cpp`);
    outputPath = path.join(__dirname, 'submissions', `${uniqueId}.out`);
    const submissionsDir = path.join(__dirname, 'submissions');

    if (!fs.existsSync(submissionsDir)) {
      fs.mkdirSync(submissionsDir, { recursive: true });
    }
    // Reject sources that try to read files outside the submission via #include
    // before compiling — closes the compile-time arbitrary file-read vector.
    const forbiddenInclude = findForbiddenInclude(code);
    if (forbiddenInclude) {
      await db.query(
        `UPDATE submissions SET overall_status = 'Compilation Error', results = $1 WHERE id = $2`,
        [JSON.stringify([{ status: 'Compilation Error', output: FORBIDDEN_INCLUDE_MESSAGE(forbiddenInclude) }]), submissionId]
      );
      return;
    }

    await fs.promises.writeFile(filePath, code);

    // Use UndefinedBehaviorSanitizer to reliably catch signed integer overflow as a runtime error.
    const compileCommand = `g++ -std=c++20 -fsanitize=signed-integer-overflow ${filePath} -o ${outputPath}`;
    try {
      await execPromise(compileCommand, COMPILE_EXEC_OPTIONS);
    } catch (compileError: unknown) {
      const error = compileError as CompileCommandError;
      console.error(`Compilation error for submission ${submissionId}:`, error.stderr);
      await db.query(
        `UPDATE submissions SET overall_status = 'Compilation Error', results = $1 WHERE id = $2`,
        [JSON.stringify([{ status: 'Compilation Error', output: sanitizeCompilerStderr(error.stderr, filePath) }]), submissionId]
      );
      return;
    } finally {
      fs.unlink(filePath, (err) => { if (err) console.error(`Error deleting .cpp file for sub ${submissionId}:`, err); });
    }

    await db.query(`UPDATE submissions SET overall_status = 'Running' WHERE id = $1`, [submissionId]);
    await fs.promises.chmod(outputPath, 0o755);
    const judgeResult = await judge(problem_id, outputPath);

    const { results, score, overallStatus, maxTimeMs, maxMemoryKb } = judgeResult;
    await db.query(
      `UPDATE submissions
       SET overall_status = $1, score = $2, results = $3, max_time_ms = $4, max_memory_kb = $5
       WHERE id = $6`,
      [overallStatus, score, JSON.stringify(results), maxTimeMs, maxMemoryKb, submissionId]
    );

  } catch (error) {
    console.error(`Critical error processing submission ${submissionId}:`, error);
    try {
      await db.query(
        `UPDATE submissions SET overall_status = 'System Error' WHERE id = $1`,
        [submissionId]
      );
    } catch (dbError) {
      console.error(`Failed to update submission ${submissionId} to System Error status:`, dbError);
    }
  } finally {
    fs.unlink(outputPath, (err) => { if (err) console.error(`Error deleting .out file for sub ${submissionId}:`, err); });
  }
}

// Process contest submissions (similar to processSubmission but for contest_submissions table)
export async function processContestSubmission(submissionId: number): Promise<void> {
  let filePath = '';
  let outputPath = '';

  try {
    const subRes = await db.query<ContestSubmissionRow>(
      'SELECT * FROM contest_submissions WHERE id = $1',
      [submissionId]
    );
    if (subRes.rows.length === 0) {
      console.error(`Contest submission ${submissionId} not found for processing.`);
      return;
    }
    const { problem_id, code } = subRes.rows[0];

    await db.query(`UPDATE contest_submissions SET overall_status = 'Compiling' WHERE id = $1`, [submissionId]);

    const uniqueId = `contest_${submissionId}_${Date.now()}`;
    filePath = path.join(__dirname, 'submissions', `${uniqueId}.cpp`);
    outputPath = path.join(__dirname, 'submissions', `${uniqueId}.out`);
    const submissionsDir = path.join(__dirname, 'submissions');

    if (!fs.existsSync(submissionsDir)) {
      fs.mkdirSync(submissionsDir, { recursive: true });
    }
    // Reject sources that try to read files outside the submission via #include
    // before compiling — closes the compile-time arbitrary file-read vector.
    const forbiddenInclude = findForbiddenInclude(code);
    if (forbiddenInclude) {
      await db.query(
        `UPDATE contest_submissions SET overall_status = 'Compilation Error', results = $1 WHERE id = $2`,
        [JSON.stringify([{ status: 'Compilation Error', output: FORBIDDEN_INCLUDE_MESSAGE(forbiddenInclude) }]), submissionId]
      );
      return;
    }

    await fs.promises.writeFile(filePath, code);

    // Use UndefinedBehaviorSanitizer to reliably catch signed integer overflow as a runtime error.
    const compileCommand = `g++ -std=c++20 -fsanitize=signed-integer-overflow ${filePath} -o ${outputPath}`;
    try {
      await execPromise(compileCommand, COMPILE_EXEC_OPTIONS);
    } catch (compileError: unknown) {
      const error = compileError as CompileCommandError;
      console.error(`Compilation error for contest submission ${submissionId}:`, error.stderr);
      await db.query(
        `UPDATE contest_submissions SET overall_status = 'Compilation Error', results = $1 WHERE id = $2`,
        [JSON.stringify([{ status: 'Compilation Error', output: sanitizeCompilerStderr(error.stderr, filePath) }]), submissionId]
      );
      return;
    } finally {
      fs.unlink(filePath, (err) => { if (err) console.error(`Error deleting .cpp file for contest sub ${submissionId}:`, err); });
    }

    await db.query(`UPDATE contest_submissions SET overall_status = 'Running' WHERE id = $1`, [submissionId]);
    await fs.promises.chmod(outputPath, 0o755);
    const judgeResult = await judge(problem_id, outputPath);

    const { results, score, overallStatus, maxTimeMs, maxMemoryKb } = judgeResult;
    await db.query(
      `UPDATE contest_submissions
       SET overall_status = $1, score = $2, results = $3, max_time_ms = $4, max_memory_kb = $5
       WHERE id = $6`,
      [overallStatus, score, JSON.stringify(results), maxTimeMs, maxMemoryKb, submissionId]
    );

  } catch (error) {
    console.error(`Critical error processing contest submission ${submissionId}:`, error);
    try {
      await db.query(
        `UPDATE contest_submissions SET overall_status = 'System Error' WHERE id = $1`,
        [submissionId]
      );
    } catch (dbError) {
      console.error(`Failed to update contest submission ${submissionId} to System Error status:`, dbError);
    }
  } finally {
    fs.unlink(outputPath, (err) => { if (err) console.error(`Error deleting .out file for contest sub ${submissionId}:`, err); });
  }
}

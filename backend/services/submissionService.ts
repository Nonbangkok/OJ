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
const COMPILE_EXEC_OPTIONS = {
  timeout: JUDGE_CONFIG.COMPILE_TIMEOUT_MS,
  maxBuffer: JUDGE_CONFIG.COMPILE_MAX_BUFFER,
} as const;

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
        [JSON.stringify([{ status: 'Compilation Error', output: error.stderr ?? 'Compilation failed' }]), submissionId]
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
        [JSON.stringify([{ status: 'Compilation Error', output: error.stderr ?? 'Compilation failed' }]), submissionId]
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

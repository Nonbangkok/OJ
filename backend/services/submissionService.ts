import * as db from '../db';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { judge } from './judgeService';
import { ContestSubmissionRow, SubmissionRow } from '../types/models';
import { CompileCommandError } from '../types/service';
import {
  JUDGE_CONFIG,
  LANGUAGE_PREPARE,
  SUBMISSION_STATUS,
  SubmissionLanguage,
} from '../constants';
import { findForbiddenInclude } from '../utils/compileGuard';
import { logger } from '../utils/logger';
import { publishRealtime } from './realtimeHub';

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

/** The neutral name substituted for the internal temp source path in
 *  compiler/checker output so server filesystem paths are not disclosed. */
const SANITIZED_SOURCE_NAME: Record<SubmissionLanguage, string> = {
  cpp: 'solution.cpp',
  python: 'solution.py',
};

/**
 * Replace the internal temporary source path in compiler/checker output with a
 * neutral name so server filesystem paths are not disclosed to submitters.
 */
export function sanitizeCompilerStderr(stderr: string | undefined, sourcePath: string, language: SubmissionLanguage = 'cpp'): string {
  if (!stderr) {
    return 'Compilation failed';
  }
  return sourcePath ? stderr.split(sourcePath).join(SANITIZED_SOURCE_NAME[language]) : stderr;
}

const FORBIDDEN_INCLUDE_MESSAGE = (target: string): string =>
  `Compilation rejected: #include of a non-permitted path ("${target}") is not allowed. ` +
  `Use standard library headers (e.g. <bits/stdc++.h>) only.`;

/**
 * Publish a realtime `submission_update` after a status/score transition has
 * been persisted. Kept tiny and side-effect free so every emission point in
 * the pipeline is one readable line; publishRealtime itself never throws.
 */
const publishSubmissionStatus = (
  submissionId: number,
  table: 'submissions' | 'contest_submissions',
  userId: number | null,
  overallStatus: string,
  score: number
): void => {
  publishRealtime({
    type: 'submission_update',
    submissionId,
    table,
    overall_status: overallStatus,
    score,
    user_id: userId,
  });
};

/**
 * Compile a submission's source and run it against the problem's testcases,
 * persisting each status transition. Shared by the standalone
 * (`submissions`) and contest (`contest_submissions`) pipelines — the only
 * differences are the table and the temp-file prefix.
 */
async function runSubmissionPipeline(
  submissionId: number,
  table: 'submissions' | 'contest_submissions',
  filePrefix: string
): Promise<void> {
  let filePath = '';
  let outputPath = '';
  // Owner of the submission — needed by the System Error handler below, so it
  // must live outside the try block alongside the file paths.
  let userId: number | null = null;
  // Language also escapes the try: the finally-block cleanup needs to know
  // whether this submission produced a compiled binary at all.
  let submissionLanguage: SubmissionLanguage = 'cpp';

  try {
    const subRes = await db.query<SubmissionRow | ContestSubmissionRow>(
      `SELECT * FROM ${table} WHERE id = $1`,
      [submissionId]
    );
    if (subRes.rows.length === 0) {
      logger.warn('submission not found for processing', { submissionId, table });
      return;
    }
    const { problem_id, code, language, user_id, contest_id } = subRes.rows[0] as
      Pick<SubmissionRow, 'problem_id' | 'code' | 'language' | 'user_id'> & { contest_id?: number };
    userId = user_id;
    submissionLanguage = (language as SubmissionLanguage) ?? 'cpp';

    await db.query(
      `UPDATE ${table} SET overall_status = '${SUBMISSION_STATUS.COMPILING}' WHERE id = $1`,
      [submissionId]
    );
    publishSubmissionStatus(submissionId, table, user_id, SUBMISSION_STATUS.COMPILING, 0);

    const prepare = LANGUAGE_PREPARE[submissionLanguage];
    const uniqueId = `${filePrefix}_${submissionId}_${Date.now()}`;
    filePath = path.join(__dirname, 'submissions', `${uniqueId}${prepare.sourceExtension}`);
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
        `UPDATE ${table} SET overall_status = '${SUBMISSION_STATUS.COMPILATION_ERROR}', results = $1 WHERE id = $2`,
        [
          JSON.stringify([{ status: SUBMISSION_STATUS.COMPILATION_ERROR, output: FORBIDDEN_INCLUDE_MESSAGE(forbiddenInclude) }]),
          submissionId,
        ]
      );
      publishSubmissionStatus(submissionId, table, user_id, SUBMISSION_STATUS.COMPILATION_ERROR, 0);
      return;
    }

    // Keep the source readable (0644) so the unprivileged judge user (`nobody`,
    // after time_wrapper's privilege drop) can read it — equivalent to how the
    // compiled C++ binary is handed over.
    await fs.promises.writeFile(filePath, code, { mode: 0o644 });

    // Language-agnostic "prepare" phase: compile (C++) or syntax-check
    // (Python via py_compile). A failure maps to Compilation Error with the
    // sanitized stderr shown to the submitter.
    const checkCommand = prepare.checkCommand(filePath, outputPath);
    try {
      await execPromise(checkCommand, COMPILE_EXEC_OPTIONS);
    } catch (compileError: unknown) {
      const error = compileError as CompileCommandError;
      logger.warn('submission compile failed', { submissionId, table, language: submissionLanguage, stderr: error.stderr });
      await db.query(
        `UPDATE ${table} SET overall_status = '${SUBMISSION_STATUS.COMPILATION_ERROR}', results = $1 WHERE id = $2`,
        [
          JSON.stringify([{ status: SUBMISSION_STATUS.COMPILATION_ERROR, output: sanitizeCompilerStderr(error.stderr, filePath, submissionLanguage) }]),
          submissionId,
        ]
      );
      publishSubmissionStatus(submissionId, table, user_id, SUBMISSION_STATUS.COMPILATION_ERROR, 0);
      return;
    }

    await db.query(
      `UPDATE ${table} SET overall_status = '${SUBMISSION_STATUS.RUNNING}' WHERE id = $1`,
      [submissionId]
    );
    publishSubmissionStatus(submissionId, table, user_id, SUBMISSION_STATUS.RUNNING, 0);

    // Compiled languages run the produced artifact; interpreted languages run
    // the source through their interpreter. The judge applies per-language
    // limit multipliers from here on.
    const artifactPath = prepare.compiledArtifactPath(outputPath);
    if (artifactPath) {
      await fs.promises.chmod(artifactPath, 0o755);
    }
    const judgeResult = await judge(
      problem_id,
      prepare.runCommand(artifactPath ?? filePath),
      submissionLanguage
    );

    const { results, score, overallStatus, maxTimeMs, maxMemoryKb } = judgeResult;
    await db.query(
      `UPDATE ${table}
       SET overall_status = $1, score = $2, results = $3, max_time_ms = $4, max_memory_kb = $5
       WHERE id = $6`,
      [overallStatus, score, JSON.stringify(results), maxTimeMs, maxMemoryKb, submissionId]
    );
    publishSubmissionStatus(submissionId, table, user_id, overallStatus, score);
    // A landed contest verdict can move the scoreboard: emit a ping so
    // connected clients refetch the authoritative payload. Chatty-free by
    // design — intermediate statuses don't ping, only final verdicts.
    if (table === 'contest_submissions' && contest_id != null) {
      publishRealtime({ type: 'scoreboard_update', contestId: contest_id });
    }

  } catch (error) {
    logger.error('submission pipeline failed', { submissionId, table, err: error });
    try {
      await db.query(
        `UPDATE ${table} SET overall_status = '${SUBMISSION_STATUS.SYSTEM_ERROR}' WHERE id = $1`,
        [submissionId]
      );
      publishSubmissionStatus(submissionId, table, userId, SUBMISSION_STATUS.SYSTEM_ERROR, 0);
    } catch (dbError) {
      logger.error('failed to record system-error status', { submissionId, table, err: dbError });
    }
  } finally {
    fs.unlink(filePath, (err) => { if (err) logger.warn('failed to delete submission source', { submissionId, err }); });
    // Compiled languages leave a binary to clean up; interpreted ones never
    // create one, so skip the unlink (its ENOENT would be pure log noise).
    if (LANGUAGE_PREPARE[submissionLanguage].compiledArtifactPath(outputPath)) {
      fs.unlink(outputPath, (err) => { if (err) logger.warn('failed to delete submission binary', { submissionId, err }); });
    }
  }
}

export async function processSubmission(submissionId: number): Promise<void> {
  await runSubmissionPipeline(submissionId, 'submissions', 'sub');
}

// Process contest submissions (same pipeline, different table)
export async function processContestSubmission(submissionId: number): Promise<void> {
  await runSubmissionPipeline(submissionId, 'contest_submissions', 'contest');
}

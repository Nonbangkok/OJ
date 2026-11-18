import * as db from '../db';
import { spawn } from 'child_process';
import { constants as osConstants } from 'os';
import path from 'path';
import type { Readable } from 'stream';
import { SUBMISSION_STATUS, JUDGE_CONFIG, LANGUAGE_LIMITS, SubmissionLanguage } from '../constants';
import { RunnableCommand } from '../constants';
import { logger } from '../utils/logger';
import {
  canDropPrivileges,
  killSandboxProcesses,
  nextSandboxIdentity,
  SandboxIdentity,
} from '../utils/sandboxProcess';
import { outputsMatch } from '../utils/outputComparison';
import {
  JudgeProblemLimitsRow,
  JudgeResult,
  JudgeTestcaseRow,
  RunResult,
} from '../types/service';

/** How the pipeline wants a submission's testcases run. */
export interface JudgeRunOptions {
  /**
   * Sandbox identity every testcase runs as: the same one the compile used
   * (a standalone call draws one from the pool).
   */
  sandbox?: SandboxIdentity;
  /**
   * The submission's workspace: the program's TMPDIR (it cannot write
   * anywhere else), and the path removed from Runtime Error output.
   */
  workspaceDir?: string;
  /**
   * Header problems: the secret grader is compiled into the program, so the
   * program's stderr is never stored (it could dump the grader from its own
   * memory, A4-08). A Runtime Error then carries only a neutral description.
   */
  hideProgramStderr?: boolean;
}

const signalName = (signal: number): string | null =>
  Object.entries(osConstants.signals).find(([, value]) => value === signal)?.[0] ?? null;

/**
 * Human-facing description of a failed run, built ONLY from the exit
 * evidence (JUDGE-001): the wrapper reports a program killed by a signal as
 * exit code 128+N. Never anything the program printed.
 */
const describeCrash = (exitCode: number | null, signal: NodeJS.Signals | null): string => {
  if (signal) {
    return `Program terminated by signal ${signal}`;
  }
  if (exitCode !== null && exitCode > JUDGE_CONFIG.SIGNAL_EXIT_BASE) {
    const name = signalName(exitCode - JUDGE_CONFIG.SIGNAL_EXIT_BASE);
    if (name) return `Program terminated by signal ${name}`;
  }
  if (exitCode !== null) {
    return `Program exited with code ${exitCode}`;
  }
  return 'Program terminated unexpectedly';
};

/** Reserved for the "[truncated N bytes]" marker inside the output cap. */
const TRUNCATION_MARKER_RESERVE = 64;

/**
 * The Runtime Error text stored for (and served to) the submitter, built from
 * the program's stderr (A9-04):
 *  - wrapper telemetry look-alikes are stripped (JUDGE-001);
 *  - the workspace path is removed, so a Python traceback names
 *    `solution.py`, not `/tmp/oj-submissions/<id>/solution.py`;
 *  - NUL bytes are dropped (a jsonb `results` column cannot hold U+0000);
 *  - the text is capped at RUNTIME_ERROR_OUTPUT_MAX_BYTES, cut on a UTF-8
 *    boundary, with a "[truncated N bytes]" marker. `totalBytes` is how much
 *    the program wrote in all, including what was drained without keeping.
 */
export function formatRuntimeErrorOutput(
  stderr: Buffer,
  options: { totalBytes?: number; workspaceDir?: string } = {}
): string {
  let text = stderr.toString('utf8').replace(/\u0000/g, '');
  const { workspaceDir } = options;
  if (workspaceDir) {
    text = text.split(`${workspaceDir}/`).join('').split(workspaceDir).join('workspace');
  }
  text = text
    .replace(/\/[^\s:"']*oj-submissions\/[^\s:"']+/g, (match) => path.basename(match))
    .replace(JUDGE_CONFIG.WRAPPER_TELEMETRY_STRIP, ' ')
    .trim();

  const bytes = Buffer.from(text, 'utf8');
  const undelivered = Math.max(0, (options.totalBytes ?? stderr.length) - stderr.length);
  const cap = JUDGE_CONFIG.RUNTIME_ERROR_OUTPUT_MAX_BYTES;
  if (bytes.length <= cap && undelivered === 0) {
    return text;
  }
  let end = Math.min(bytes.length, cap - TRUNCATION_MARKER_RESERVE);
  // Never split a multi-byte character: back off to its lead byte.
  while (end > 0 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
  const omitted = bytes.length - end + undelivered;
  return `${bytes.subarray(0, end).toString('utf8')}\n[truncated ${omitted} bytes]`;
}

interface CaseRunContext {
  sandbox: SandboxIdentity;
  workspaceDir?: string;
  hideProgramStderr: boolean;
  /** Kill the identity's processes after the run (production only). */
  sweep: boolean;
}

/** A testcase run, plus why the sandbox could not be proven clean afterwards. */
type CaseRunResult = RunResult & { sandboxError?: unknown };

/**
 * Run one testcase: `timeout -k <grace>s <limit>s time_wrapper <exe> <mem>
 * <cpu> <uid> [args]`, spawned WITHOUT a shell, with a fourth pipe on which
 * the wrapper (and nothing else) reports TIME_USED/MEM_USED (A4-04).
 * stdout is collected in full (up to EXEC_MAX_BUFFER), stderr only up to
 * RUN_STDERR_MAX_BYTES with the rest drained.
 *
 * Once `timeout` exits, the identity's remaining processes are killed
 * (`ctx.sweep`, A4-02): anything the program left running, which may still
 * hold the stdio pipes. A sweep that fails makes the run a System Error.
 */
async function runSingleCase(
  runnable: RunnableCommand,
  input: string,
  timeLimitMs: number,
  memoryLimitMb: number,
  ctx: CaseRunContext
): Promise<CaseRunResult> {
  return new Promise((resolve) => {
    // Resource limits handed to the sandbox wrapper. RLIMIT_AS gets a little
    // headroom over the problem's memory limit (runtime/loader/UBSan overhead);
    // RLIMIT_CPU gets the wall-clock limit plus slack as a hard backstop.
    // `timeLimitMs` / `memoryLimitMb` are the EFFECTIVE limits for the
    // submission's language (already multiplied by LANGUAGE_LIMITS).
    const asLimitMb = memoryLimitMb + JUDGE_CONFIG.MEMORY_LIMIT_SLACK_MB;
    const cpuLimitS = Math.ceil(timeLimitMs / 1000) + JUDGE_CONFIG.CPU_LIMIT_SLACK_S;
    // `timeout -k` grace: after the wall-clock limit, GNU timeout sends
    // SIGTERM then — if the wrapper is still alive after this many seconds —
    // SIGKILL (RUNNER-004).
    const killGraceS = Math.max(1, Math.ceil(JUDGE_CONFIG.KILL_GRACE_MS / 1000));

    // Wrapper argv layout: [wrapper] [exe] [mem_mb] [cpu_s] [uid] [args...] —
    // limits and the sandbox uid come BEFORE the runnable's own args, or the
    // wrapper would feed them to the child as program arguments.
    const args = [
      '-k', `${killGraceS}s`, `${timeLimitMs / 1000}s`,
      JUDGE_CONFIG.TIME_WRAPPER_PATH,
      runnable.command, String(asLimitMb), String(cpuLimitS), String(ctx.sandbox.uid),
      ...runnable.args,
    ];
    // Strip the backend's environment from the executed user code so a
    // submission cannot read DATABASE_URL/PGPASSWORD/SECRET_KEY via getenv().
    // PATH is the minimal sandbox PATH (the `timeout` lookup); TMPDIR points
    // at the submission's own workspace, the only place it may write (A9-05).
    // The project augments NodeJS.ProcessEnv to mark the secret keys as
    // required, so this intentionally-sparse env is asserted to that type.
    const sandboxEnv = {
      PATH: JUDGE_CONFIG.SANDBOX_PATH,
      ...(ctx.workspaceDir ? { TMPDIR: ctx.workspaceDir } : {}),
    } as unknown as NodeJS.ProcessEnv;

    const startedAt = Date.now();
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let outputLimitExceeded = false;
    const stderrChunks: Buffer[] = [];
    let stderrKept = 0;
    let stderrTotal = 0;
    const telemetryChunks: Buffer[] = [];
    let telemetryBytes = 0;
    // Set when an EPIPE/child-error event was observed — supplementary
    // evidence for the Runtime Error message, never the verdict itself.
    let hasEpipeError = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let exited = false;
    let closed = false;
    let sweepDone = false;
    let sandboxError: unknown;
    let settled = false;
    let drainTimer: NodeJS.Timeout | undefined;
    let escalationTimer: NodeJS.Timeout | undefined;

    // detached: `timeout` leads its own process group, so the escalation
    // below can kill it together with the (root) wrapper.
    const child = spawn('timeout', args, {
      env: sandboxEnv,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });

    const killGroup = (): void => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
          logger.warn('judge kill-escalation failed', { runnable: runnable.command, err });
        }
      }
    };

    const finish = (result: CaseRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(escalationTimer);
      clearTimeout(drainTimer);
      resolve(result);
    };

    const classify = (): void => {
      if (sandboxError !== undefined) {
        finish({ status: SUBMISSION_STATUS.SYSTEM_ERROR, timeMs: -1, memoryKb: -1, sandboxError });
        return;
      }
      let timeMs = -1;
      let memoryKb = -1;
      // Telemetry comes from the wrapper's own fd ONLY (A4-04). A wrapper
      // killed by `timeout`'s SIGTERM at the wall-clock limit never reports.
      const telemetry = Buffer.concat(telemetryChunks).toString('utf8');
      const timeMatch = telemetry.match(JUDGE_CONFIG.WRAPPER_TIME_REPORT);
      const memMatch = telemetry.match(JUDGE_CONFIG.WRAPPER_MEM_REPORT);
      const timeMatchFound = timeMatch !== null;
      if (timeMatch) {
        const sumSeconds = timeMatch[1].split('+').reduce((acc, val) => acc + (parseFloat(val || '0') || 0), 0);
        timeMs = Number((sumSeconds * 1000).toFixed(3));
      }
      if (memMatch) memoryKb = parseInt(memMatch[1], 10);

      const failed = exitSignal !== null || exitCode !== 0;
      // The wrapper reports the PROGRAM's death by signal as exit 128+N
      // (JUDGE-008); a signal on the spawned process itself means the
      // escalation below SIGKILLed `timeout`.
      const programSignalExitCode = exitCode !== null && exitCode > JUDGE_CONFIG.SIGNAL_EXIT_BASE
        ? exitCode - JUDGE_CONFIG.SIGNAL_EXIT_BASE
        : null;

      // 0. Output limit: stdout over EXEC_MAX_BUFFER killed the run.
      if (outputLimitExceeded) {
        finish({ status: SUBMISSION_STATUS.RUNTIME_ERROR, output: 'Output limit exceeded', timeMs, memoryKb });
        return;
      }

      // GNU `timeout` exits 124 both when IT kills the command at the limit
      // and when the command happens to exit 124 by itself. Two pieces of
      // evidence separate them: (a) a wrapper killed by timeout's SIGTERM
      // never reports its telemetry, and (b) a genuine timeout cannot fire
      // before the wall-clock limit has elapsed.
      const elapsedMs = Date.now() - startedAt;
      const timeoutEvidence = !timeMatchFound || elapsedMs >= timeLimitMs;

      // 1. TLE: the wall-clock limit killed the run — `timeout` exit 124
      //    with timeout evidence, the wrapper's RLIMIT_CPU backstop
      //    (SIGXCPU), or the Node-side SIGKILL escalation (RUNNER-004).
      if (
        (exitCode === JUDGE_CONFIG.TLE_EXIT_CODE && timeoutEvidence)
        || exitSignal === 'SIGKILL'
        || programSignalExitCode === JUDGE_CONFIG.SIGXCPU
      ) {
        finish({ status: SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED, timeMs: timeLimitMs, memoryKb });
        return;
      }

      // 2. MLE, classified by evidence (JUDGE-002): the wrapper-measured
      //    peak RSS exceeded the effective memory limit — checked on EVERY
      //    outcome, clean exit included, so the RLIMIT_AS slack cannot let
      //    an over-limit run pass — or the program died from a hard SIGKILL
      //    (OOM / over-limit kill). The REAL measured MEM_USED is reported.
      if (memoryKb > memoryLimitMb * 1024 || programSignalExitCode === JUDGE_CONFIG.SIGKILL) {
        finish({
          status: SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED,
          timeMs,
          memoryKb: memoryKb >= 0 ? memoryKb : memoryLimitMb * 1024,
        });
        return;
      }

      // 3. Runtime Error: every other failure — SIGSEGV/SIGABRT with no
      //    memory evidence, a sandbox-denied syscall (SIGSYS), and a
      //    program's OWN exit(124) (JUDGE-008). The output is the capped,
      //    path-free program stderr (A9-04), or for header problems only the
      //    neutral exit description (A4-08).
      if (failed) {
        const programStderr = ctx.hideProgramStderr
          ? ''
          : formatRuntimeErrorOutput(Buffer.concat(stderrChunks), { totalBytes: stderrTotal, workspaceDir: ctx.workspaceDir });
        const crashNote = hasEpipeError && !programStderr
          ? 'Program exited before reading all input (EPIPE on stdin)'
          : '';
        finish({
          status: SUBMISSION_STATUS.RUNTIME_ERROR,
          output: programStderr || crashNote || describeCrash(exitCode, exitSignal),
          timeMs,
          memoryKb,
        });
        return;
      }

      // 4. Success (PENDING here = "ran fine", the caller compares output).
      //    An EPIPE event alone is NOT a Runtime Error (JUDGE-006): a
      //    clean-exiting program that ignores its (large) stdin makes the
      //    judge's stdin write fail spuriously.
      finish({ status: SUBMISSION_STATUS.PENDING, output: Buffer.concat(stdoutChunks).toString('utf8'), timeMs, memoryKb });
    };

    const maybeClassify = (): void => {
      if (exited && sweepDone && closed) classify();
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (outputLimitExceeded) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > JUDGE_CONFIG.EXEC_MAX_BUFFER) {
        outputLimitExceeded = true;
        killGroup();
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTotal += chunk.length;
      const room = JUDGE_CONFIG.RUN_STDERR_MAX_BYTES - stderrKept;
      if (room > 0) {
        const kept = chunk.subarray(0, room);
        stderrChunks.push(kept);
        stderrKept += kept.length;
      }
    });
    const telemetryStream = child.stdio[JUDGE_CONFIG.WRAPPER_TELEMETRY_FD] as Readable | null | undefined;
    telemetryStream?.on('data', (chunk: Buffer) => {
      const room = JUDGE_CONFIG.WRAPPER_TELEMETRY_MAX_BYTES - telemetryBytes;
      if (room > 0) {
        telemetryChunks.push(chunk.subarray(0, room));
        telemetryBytes += Math.min(room, chunk.length);
      }
    });
    for (const stream of [child.stdout, child.stderr, telemetryStream]) {
      stream?.on('error', () => {
        /* a reset pipe only ends collection; the exit status is the verdict */
      });
    }

    // Prevent EPIPE errors from crashing the main process. The flag is only
    // EVIDENCE for the Runtime Error message (JUDGE-006).
    child.stdin?.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        hasEpipeError = true;
        logger.warn('EPIPE on stdin while feeding testcase input', { runnable: runnable.command, err: err.message });
      }
    });

    child.on('error', (err) => {
      logger.warn('judge child process error', { runnable: runnable.command, err });
      hasEpipeError = true;
      if (!exited && child.pid === undefined) {
        // Never started (e.g. `timeout` missing): nothing ran, nothing to sweep.
        finish({ status: SUBMISSION_STATUS.SYSTEM_ERROR, timeMs: -1, memoryKb: -1, sandboxError: err });
      }
    });

    child.on('exit', (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
      clearTimeout(escalationTimer);
      const sweep = ctx.sweep ? killSandboxProcesses(ctx.sandbox) : Promise.resolve();
      void sweep.then(
        () => undefined,
        (error: unknown) => { sandboxError = error; }
      ).then(() => {
        sweepDone = true;
        // Whatever still holds the stdio pipes is not the program any more
        // (in production the sweep just killed it): stop waiting after a
        // grace period rather than forever.
        drainTimer = setTimeout(() => {
          for (const stream of [child.stdout, child.stderr, telemetryStream]) stream?.destroy();
          closed = true;
          maybeClassify();
        }, JUDGE_CONFIG.RUN_STDIO_DRAIN_GRACE_MS);
        maybeClassify();
      });
    });
    child.on('close', () => {
      closed = true;
      maybeClassify();
    });

    // Node-side kill escalation (RUNNER-004): if `timeout` itself wedges past
    // the limit + grace, SIGKILL its whole process group so the run always
    // settles.
    escalationTimer = setTimeout(() => {
      if (!exited) {
        logger.warn('judge execution outlived its limits — force killing process group', {
          runnable: runnable.command, pid: child.pid, timeLimitMs,
        });
        killGroup();
      }
    }, timeLimitMs + JUDGE_CONFIG.TIMEOUT_BUFFER_MS + JUDGE_CONFIG.KILL_GRACE_MS);
    escalationTimer.unref?.();

    child.stdin?.write(input);
    child.stdin?.end();
  });
}

export async function judge(
  problemId: string,
  runnable: RunnableCommand,
  language: SubmissionLanguage,
  options: JudgeRunOptions = {}
): Promise<JudgeResult> {
  try {
    const problemRes = await db.query<JudgeProblemLimitsRow>(
      'SELECT time_limit_ms, memory_limit_mb FROM problems WHERE id = $1',
      [problemId]
    );
    if (problemRes.rows.length === 0) {
      return { overallStatus: SUBMISSION_STATUS.SYSTEM_ERROR, score: 0, results: [], maxTimeMs: 0, maxMemoryKb: 0 };
    }
    const { time_limit_ms, memory_limit_mb } = problemRes.rows[0];

    // Effective limits for this language: one problem serves every language,
    // the multipliers (in LANGUAGE_LIMITS) scale the raw limits at execution
    // time (C++ is the identity, so C++ behavior is unchanged).
    const { timeMultiplier, memoryMultiplier } = LANGUAGE_LIMITS[language];
    const effectiveTimeMs = time_limit_ms * timeMultiplier;
    const effectiveMemoryMb = memory_limit_mb * memoryMultiplier;

    const testcasesRes = await db.query<JudgeTestcaseRow>(
      'SELECT case_number, input_data, output_data FROM testcases WHERE problem_id = $1 ORDER BY case_number ASC',
      [problemId]
    );
    const testcases = testcasesRes.rows;

    if (testcases.length === 0) {
      return { overallStatus: SUBMISSION_STATUS.SYSTEM_ERROR, score: 0, results: [{ testCase: 1, status: 'No test cases found' }], maxTimeMs: 0, maxMemoryKb: 0 };
    }

    const results: JudgeResult['results'] = [];
    // Per-submission sandbox identity (RUNNER-006): every testcase of this
    // submission runs as the SAME identity the compile used (passed in by
    // the pipeline; a standalone invocation draws a fresh one from the pool).
    // Distinct identities across concurrent submissions keep their
    // RLIMIT_NPROC budgets independent.
    const context: CaseRunContext = {
      sandbox: options.sandbox ?? nextSandboxIdentity(),
      workspaceDir: options.workspaceDir,
      hideProgramStderr: options.hideProgramStderr === true,
      // Only a root backend can drop to (and sweep) a sandbox uid.
      sweep: canDropPrivileges(),
    };
    for (let i = 0; i < testcases.length; i++) {
      const { case_number, input_data, output_data } = testcases[i];

      const runResult = await runSingleCase(runnable, input_data, effectiveTimeMs, effectiveMemoryMb, context);

      // Fail closed (A4-02): a run whose leftovers could not be killed, or
      // that could not start, ends the submission as a System Error.
      if (runResult.sandboxError !== undefined) {
        logger.error('testcase run left the sandbox in an unknown state', {
          problemId, testCase: case_number, uid: context.sandbox.uid, err: runResult.sandboxError,
        });
        results.push({ testCase: case_number, status: SUBMISSION_STATUS.SYSTEM_ERROR });
        return { overallStatus: SUBMISSION_STATUS.SYSTEM_ERROR, score: 0, results, maxTimeMs: 0, maxMemoryKb: 0 };
      }

      // Now, compare output
      if (runResult.status === SUBMISSION_STATUS.PENDING) {
        // Shared exact-output comparator (see utils/outputComparison.ts):
        // outer trim + CRLF normalization (as before), plus per-line
        // trimEnd() so trailing spaces/tabs before a newline no longer WA
        // a logically correct solution. Leading and internal whitespace
        // remain significant.
        if (outputsMatch(runResult.output || '', output_data)) {
          runResult.status = SUBMISSION_STATUS.ACCEPTED;
        } else {
          runResult.status = SUBMISSION_STATUS.WRONG_ANSWER;
        }
      }

      results.push({
        testCase: case_number,
        status: runResult.status,
        timeMs: runResult.timeMs,
        memoryKb: runResult.memoryKb,
        output: runResult.status !== SUBMISSION_STATUS.ACCEPTED && runResult.status !== SUBMISSION_STATUS.WRONG_ANSWER ? runResult.output : undefined,
      });

      // PRODUCT SEMANTICS — stop-on-first-failure (JUDGE-007). Judging stops
      // at the first non-Accepted case and the remaining cases are marked
      // 'Skipped'. Consequently `score` is the PREFIX ratio (passed-so-far /
      // total), not the fraction of cases that would pass if all were run.
      // This is deliberate design: it gives immediate feedback and bounds
      // judge work, but means e.g. a WA on case 1 of 10 scores 0 regardless
      // of cases 2–10. Changing this (run all cases, score = passed/total)
      // is a product decision, not a bug fix — if changed, the frontend's
      // per-case results display already supports showing every case.
      if (runResult.status !== SUBMISSION_STATUS.ACCEPTED) {
        // To show all results, comment out the loop break.
        // For now, let's fill the rest with 'Skipped' to show the user there are more.
        for (let j = i + 1; j < testcases.length; j++) {
          results.push({ testCase: testcases[j].case_number, status: SUBMISSION_STATUS.SKIPPED });
        }
        break;
      }
    }

    const passedCases = results.filter(r => r.status === SUBMISSION_STATUS.ACCEPTED).length;
    const totalCases = testcases.length;
    const score = totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : 0;
    const firstFailed = results.find(r => r.status !== SUBMISSION_STATUS.ACCEPTED);
    const overallStatus = firstFailed ? firstFailed.status : SUBMISSION_STATUS.ACCEPTED;
    const maxTime = Math.max(0, ...results.map(r => r.timeMs || 0));
    const maxMemory = Math.max(0, ...results.map(r => r.memoryKb || 0));

    return {
      results,
      score,
      overallStatus,
      maxTimeMs: maxTime,
      maxMemoryKb: maxMemory,
      // The effective (language-scaled) limits this submission was judged
      // against — the C++ problem limits multiplied by LANGUAGE_LIMITS.
      timeLimitMs: effectiveTimeMs,
      memoryLimitMb: effectiveMemoryMb,
    };

  } catch (error) {
    logger.error('judge failed', { problemId, err: error });
    return { overallStatus: SUBMISSION_STATUS.SYSTEM_ERROR, score: 0, results: [{ testCase: 1, status: 'Could not read test cases' }], maxTimeMs: 0, maxMemoryKb: 0 };
  }
}

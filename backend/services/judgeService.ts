import * as db from '../db';
import { exec } from 'child_process';
import { SUBMISSION_STATUS, JUDGE_CONFIG, LANGUAGE_LIMITS, SubmissionLanguage } from '../constants';
import { RunnableCommand } from '../constants';
import { logger } from '../utils/logger';
import { nextSandboxIdentity, SandboxIdentity } from '../utils/sandboxProcess';
import {
  ExecutionError,
  JudgeProblemLimitsRow,
  JudgeResult,
  JudgeTestcaseRow,
  RunResult,
} from '../types/service';

/**
 * Human-facing description of a failed run, built ONLY from the exit
 * signal/code (JUDGE-001). `error.message` is deliberately never used: it is
 * Node's `Command failed: <full command line>` string, which discloses the
 * server's wrapper path, the binary's absolute filesystem path, and the
 * judge's limit arguments to the submitter.
 */
const describeCrash = (error: ExecutionError): string => {
  if (error.signal) {
    return `Program terminated by signal ${error.signal}`;
  }
  if (typeof error.code === 'number') {
    return `Program exited with code ${error.code}`;
  }
  return 'Program terminated unexpectedly';
};

async function runSingleCase(
  runnable: RunnableCommand,
  input: string,
  timeLimitMs: number,
  memoryLimitMb: number,
  sandbox: SandboxIdentity
): Promise<RunResult> {
  return new Promise((resolve) => {
    // Using custom C wrapper for microsecond precision
    const timeCommand = `./scripts/time_wrapper`;

    // Resource limits handed to the sandbox wrapper. RLIMIT_AS gets a little
    // headroom over the problem's memory limit (runtime/loader/UBSan overhead);
    // RLIMIT_CPU gets the wall-clock limit plus slack as a hard backstop.
    // `timeLimitMs` / `memoryLimitMb` are the EFFECTIVE limits for the
    // submission's language (already multiplied by LANGUAGE_LIMITS).
    const asLimitMb = memoryLimitMb + JUDGE_CONFIG.MEMORY_LIMIT_SLACK_MB;
    const cpuLimitS = Math.ceil(timeLimitMs / 1000) + JUDGE_CONFIG.CPU_LIMIT_SLACK_S;
    // `timeout -k` grace: after the wall-clock limit, GNU timeout sends
    // SIGTERM then — if the program is still alive after this many seconds —
    // SIGKILL. Without the escalation a SIGTERM-ignoring sleeper holds its
    // judge slot forever (RUNNER-004).
    const killGraceS = Math.max(1, Math.ceil(JUDGE_CONFIG.KILL_GRACE_MS / 1000));

    // Use timeout command which is reliable on Linux. The wrapper now also
    // applies setrlimit() + privilege-drop on the untrusted binary itself.
    // The runnable (compiled binary, or `python3 <src>`) uses internally
    // generated paths, which never contain shell metacharacters.
    // Wrapper argv layout: [wrapper] [exe] [mem_mb] [cpu_s] [uid] [args...] —
    // limits and the sandbox uid come BEFORE the runnable's own args, or the
    // wrapper would feed them to the child as program arguments.
    const runnableArgs = runnable.args.join(' ');
    const command = `timeout -k ${killGraceS}s ${timeLimitMs / 1000}s ${timeCommand} ${runnable.command} ${asLimitMb} ${cpuLimitS} ${sandbox.uid} ${runnableArgs}`.trim();
    // Strip the backend's environment from the executed user code so a
    // submission cannot read DATABASE_URL/PGPASSWORD/SECRET_KEY via getenv().
    // Only a minimal PATH is exposed (needed for the `timeout` lookup).
    // The project augments NodeJS.ProcessEnv to mark the secret keys as
    // required, so this intentionally-sparse env is asserted to that type.
    const sandboxEnv = { PATH: JUDGE_CONFIG.SANDBOX_PATH } as unknown as NodeJS.ProcessEnv;
    const executionOptions = {
      timeout: timeLimitMs + JUDGE_CONFIG.TIMEOUT_BUFFER_MS,
      maxBuffer: JUDGE_CONFIG.EXEC_MAX_BUFFER, // 50MB
      shell: '/bin/bash',
      env: sandboxEnv,
      // Node-side backstop to the `timeout -k` chain (RUNNER-004): if the
      // process group somehow outlives the exec timeout (e.g. `timeout`
      // itself wedged), kill it hard instead of leaking the judge slot.
      killSignal: 'SIGKILL' as const,
    };

    // Set when an EPIPE/child-error event was observed — supplementary
    // evidence for the Runtime Error message, never the verdict itself.
    let hasEpipError = false;
    const startedAt = Date.now();

    const child = exec(command, executionOptions, (error, stdout, stderr) => {
      let timeMs = -1;
      let memoryKb = -1;
      let programOutput = stdout;
      let programStderr = stderr;
      // Whether the wrapper managed to report its telemetry line — a wrapper
      // killed by `timeout`'s SIGTERM at the wall-clock limit never does.
      let timeMatchFound = false;

      if (stderr) {
        const timeMatch = stderr.match(JUDGE_CONFIG.WRAPPER_TIME_REPORT);
        const memMatch = stderr.match(JUDGE_CONFIG.WRAPPER_MEM_REPORT);
        timeMatchFound = timeMatch !== null;

        if (timeMatch) {
          try {
            const timeExpression = timeMatch[1];
            const sumSeconds = timeExpression.split('+').reduce((acc, val) => acc + parseFloat(val || '0'), 0);
            timeMs = Number((sumSeconds * 1000).toFixed(3));
          } catch (e) {
            logger.warn('failed to parse CPU time from wrapper output', { err: e });
          }
        }
        if (memMatch) memoryKb = parseInt(memMatch[1], 10);

        // Clean stderr for reporting (JUDGE-001): strip the wrapper's
        // telemetry TOKENS — not lines — so the report survives the
        // concatenation case (`...out 288 2TIME_USED:...`).
        programStderr = stderr.replace(JUDGE_CONFIG.WRAPPER_TELEMETRY_STRIP, ' ').trim();
      }

      const executionError = error as ExecutionError | null;
      // Signal-vs-exit evidence (JUDGE-008): the command runs under a shell,
      // so `executionError.signal` describes the SHELL (only set when the
      // Node-side kill escalation SIGKILLed it), while the wrapper reports
      // the PROGRAM's death as its own exit code 128+signal.
      const programSignalExitCode = typeof executionError?.code === 'number'
        && executionError.code > JUDGE_CONFIG.SIGNAL_EXIT_BASE
        ? executionError.code - JUDGE_CONFIG.SIGNAL_EXIT_BASE
        : null;

      // GNU `timeout` exits 124 both when IT kills the command at the limit
      // and when the command happens to exit 124 by itself. Two pieces of
      // evidence separate them: (a) a wrapper killed by timeout's SIGTERM
      // never prints its TIME_USED/MEM_USED line, and (b) a genuine timeout
      // cannot fire before the wall-clock limit has elapsed.
      const elapsedMs = Date.now() - startedAt;
      const timeoutEvidence = !timeMatchFound || elapsedMs >= timeLimitMs;

      // 1. TLE: the wall-clock limit killed the run — `timeout` exit 124
      //    with timeout evidence, the wrapper's RLIMIT_CPU backstop
      //    (SIGXCPU), or the Node-side SIGKILL escalation (RUNNER-004).
      if (
        (executionError !== null && executionError.code === JUDGE_CONFIG.TLE_EXIT_CODE && timeoutEvidence)
        || (executionError !== null && executionError.signal === 'SIGKILL')
        || programSignalExitCode === JUDGE_CONFIG.SIGXCPU
      ) {
        return resolve({ status: SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED, timeMs: timeLimitMs, memoryKb });
      }

      // 2. MLE, classified by evidence (JUDGE-002): the wrapper-measured
      //    peak RSS exceeded the effective memory limit — checked on EVERY
      //    outcome, clean exit included, so the RLIMIT_AS slack (which only
      //    exists to keep the loader/UBSan overhead from killing borderline
      //    programs) can no longer let an over-limit run pass as a verdict
      //    (the audit's "32MB slack unchecked") — or the program died from
      //    a hard SIGKILL (OOM / over-limit kill). The REAL measured
      //    MEM_USED is reported; the old code fabricated limit*1024.
      if (memoryKb > memoryLimitMb * 1024 || programSignalExitCode === JUDGE_CONFIG.SIGKILL) {
        return resolve({
          status: SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED,
          timeMs,
          memoryKb: memoryKb >= 0 ? memoryKb : memoryLimitMb * 1024,
        });
      }

      // 3. Runtime Error: every other failure — SIGSEGV/SIGABRT with no
      //    memory evidence, a sandbox-denied syscall (SIGSYS), and a
      //    program's OWN exit(124) (no timeout evidence → falls through the
      //    TLE branch; JUDGE-008). The output shown to the submitter is the
      //    telemetry-stripped program stderr, or a neutral signal/exit-code
      //    description — never `error.message`, which is Node's
      //    "Command failed: <full command line>" leak (JUDGE-001).
      if (executionError) {
        const crashNote = hasEpipError && !programStderr
          ? 'Program exited before reading all input (EPIPE on stdin)'
          : '';
        return resolve({
          status: SUBMISSION_STATUS.RUNTIME_ERROR,
          output: programStderr || crashNote || describeCrash(executionError),
          timeMs,
          memoryKb
        });
      }

      // 4. Success (PENDING here = "ran fine", the caller compares output).
      //    An EPIPE event alone is NOT a Runtime Error (JUDGE-006): a
      //    clean-exiting program that ignores its (large) stdin makes the
      //    judge's stdin write fail spuriously, and the exec callback can
      //    run before the stdin error handler (async flag race). Only a
      //    real failure (non-null error above) turns EPIPE into evidence.
      resolve({ status: SUBMISSION_STATUS.PENDING, output: programOutput, timeMs, memoryKb });
    });

    // Prevent EPIPE errors from crashing the main process. The flag is only
    // EVIDENCE for the Runtime Error message — it never drives the verdict
    // by itself (JUDGE-006).
    child.stdin?.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        hasEpipError = true;
        logger.warn('EPIPE on stdin while feeding testcase input', { runnable: runnable.command, err: err.message });
      }
    });

    // Also catch errors on the child process itself
    child.on('error', (err) => {
      logger.warn('judge child process error', { runnable: runnable.command, err });
      hasEpipError = true;
    });

    // Node-side kill escalation (RUNNER-004). The exec `timeout` above fires
    // SIGKILL at timeLimitMs + TIMEOUT_BUFFER_MS, but `killSignal` applies to
    // the shell `timeout` runs under — if anything in that chain ignores or
    // misses the signal, the promise would never settle and the judge slot
    // would leak. This unconditional SIGKILL of the whole process group at
    // the exec timeout + grace guarantees the callback path always runs.
    const escalationTimer = setTimeout(() => {
      if (child.pid && child.exitCode === null) {
        logger.warn('judge execution outlived its limits — force killing process group', {
          runnable: runnable.command, pid: child.pid, timeLimitMs,
        });
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
            logger.warn('judge kill-escalation failed', { runnable: runnable.command, err });
          }
        }
      }
    }, timeLimitMs + JUDGE_CONFIG.TIMEOUT_BUFFER_MS + JUDGE_CONFIG.KILL_GRACE_MS);
    // The timer must never hold the event loop open by itself: normally it is
    // cleared on close, but if the callback path already resolved without a
    // close event this keeps a lone pending escalation from blocking exit.
    escalationTimer.unref?.();
    child.on('close', () => clearTimeout(escalationTimer));

    child.stdin?.write(input);
    child.stdin?.end();
  });
}

export async function judge(
  problemId: string,
  runnable: RunnableCommand,
  language: SubmissionLanguage,
  sandboxIdentity?: SandboxIdentity
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
    const sandbox = sandboxIdentity ?? nextSandboxIdentity();
    for (let i = 0; i < testcases.length; i++) {
      const { case_number, input_data, output_data } = testcases[i];

      const runResult = await runSingleCase(runnable, input_data, effectiveTimeMs, effectiveMemoryMb, sandbox);

      // Now, compare output
      if (runResult.status === SUBMISSION_STATUS.PENDING) {
        const formattedStdout = (runResult.output || '').trim().replace(/\r\n/g, '\n');
        const formattedExpectedOutput = output_data.trim().replace(/\r\n/g, '\n');
        if (formattedStdout === formattedExpectedOutput) {
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

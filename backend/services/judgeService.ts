import * as db from '../db';
import { exec } from 'child_process';
import { SUBMISSION_STATUS, JUDGE_CONFIG } from '../constants';
import {
  ExecutionError,
  JudgeProblemLimitsRow,
  JudgeResult,
  JudgeTestcaseRow,
  RunResult,
} from '../types/service';

async function runSingleCase(
  executablePath: string,
  input: string,
  timeLimitMs: number,
  memoryLimitMb: number
): Promise<RunResult> {
  return new Promise((resolve) => {
    // Using custom C wrapper for microsecond precision
    const timeCommand = `./scripts/time_wrapper`;

    // Resource limits handed to the sandbox wrapper. RLIMIT_AS gets a little
    // headroom over the problem's memory limit (runtime/loader/UBSan overhead);
    // RLIMIT_CPU gets the wall-clock limit plus slack as a hard backstop.
    const asLimitMb = memoryLimitMb + JUDGE_CONFIG.MEMORY_LIMIT_SLACK_MB;
    const cpuLimitS = Math.ceil(timeLimitMs / 1000) + JUDGE_CONFIG.CPU_LIMIT_SLACK_S;

    // Use timeout command which is reliable on Linux. The wrapper now also
    // applies setrlimit() + privilege-drop on the untrusted binary itself.
    const command = `timeout ${timeLimitMs / 1000}s ${timeCommand} ${executablePath} ${asLimitMb} ${cpuLimitS}`;
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
      env: sandboxEnv
    };

    let hasEpipError = false;
    let epipErrorMessage = '';

    const child = exec(command, executionOptions, (error, stdout, stderr) => {
      let timeMs = -1;
      let memoryKb = -1;
      let programOutput = stdout;
      let programStderr = stderr;

      if (stderr) {
        const timeRegex = /TIME_USED:([0-9.+]+)/;
        const memRegex = /MEM_USED:(\d+)/;
        const timeMatch = stderr.match(timeRegex);
        const memMatch = stderr.match(memRegex);

        if (timeMatch) {
          try {
            const timeExpression = timeMatch[1];
            const sumSeconds = timeExpression.split('+').reduce((acc, val) => acc + parseFloat(val || '0'), 0);
            timeMs = Number((sumSeconds * 1000).toFixed(3));
          } catch (e) {
            console.error("Error parsing CPU time:", e);
          }
        }
        if (memMatch) memoryKb = parseInt(memMatch[1], 10);

        // Clean stderr for reporting
        programStderr = stderr.split('\n').filter(line => !line.includes('MEM_USED') && !line.includes('TIME_USED')).join('\n').trim();
      }

      // 1. Check for TLE first (timeout command exit code 124)
      const executionError = error as ExecutionError | null;
      if (executionError && executionError.code === JUDGE_CONFIG.TLE_EXIT_CODE) {
        return resolve({ status: SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED, timeMs: timeLimitMs, memoryKb });
      }

      // 2. Check for EPIPE (program crashed while receiving input)
      if (hasEpipError) {
        // Only treat as RE if it's not a TLE (which we checked above)
        return resolve({
          status: SUBMISSION_STATUS.RUNTIME_ERROR,
          output: epipErrorMessage || 'Program crashed while receiving input',
          timeMs,
          memoryKb
        });
      }

      // 3. Check for other errors (MLE, SIGSEGV, generic RE)
      if (executionError) {
        // Did it run out of memory?
        if (executionError.signal === 'SIGSEGV' || (stderr && stderr.toLowerCase().includes('memory'))) {
          return resolve({ status: SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED, timeMs, memoryKb: memoryLimitMb * 1024 });
        }
        // For other errors, treat as Runtime Error
        return resolve({
          status: SUBMISSION_STATUS.RUNTIME_ERROR,
          output: programStderr || executionError.message || 'Program terminated unexpectedly',
          timeMs,
          memoryKb
        });
      }

      resolve({ status: SUBMISSION_STATUS.PENDING, output: programOutput, timeMs, memoryKb });
    });

    // Prevent EPIPE errors from crashing the main process.
    child.stdin?.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        hasEpipError = true;
        epipErrorMessage = `Program crashed while receiving input: ${err.message}`;
        console.warn(`Caught EPIPE on stdin for executable ${executablePath}. Error: ${err.message}`);
      }
    });

    // Also catch errors on the child process itself
    child.on('error', (err) => {
      console.warn(`Child process error for ${executablePath}:`, err);
      if (!hasEpipError) {
        hasEpipError = true;
        epipErrorMessage = `Process error: ${err.message}`;
      }
    });

    child.stdin?.write(input);
    child.stdin?.end();
  });
}

export async function judge(problemId: string, executablePath: string): Promise<JudgeResult> {
  try {
    const problemRes = await db.query<JudgeProblemLimitsRow>(
      'SELECT time_limit_ms, memory_limit_mb FROM problems WHERE id = $1',
      [problemId]
    );
    if (problemRes.rows.length === 0) {
      return { overallStatus: SUBMISSION_STATUS.SYSTEM_ERROR, score: 0, results: [], maxTimeMs: 0, maxMemoryKb: 0 };
    }
    const { time_limit_ms, memory_limit_mb } = problemRes.rows[0];

    const testcasesRes = await db.query<JudgeTestcaseRow>(
      'SELECT case_number, input_data, output_data FROM testcases WHERE problem_id = $1 ORDER BY case_number ASC',
      [problemId]
    );
    const testcases = testcasesRes.rows;

    if (testcases.length === 0) {
      return { overallStatus: SUBMISSION_STATUS.SYSTEM_ERROR, score: 0, results: [{ testCase: 1, status: 'No test cases found' }], maxTimeMs: 0, maxMemoryKb: 0 };
    }

    const results: JudgeResult['results'] = [];
    for (const testcase of testcases) {
      const { case_number, input_data, output_data } = testcase;

      const runResult = await runSingleCase(executablePath, input_data, time_limit_ms, memory_limit_mb);

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

      // Stop on first non-Accepted result for immediate feedback
      if (runResult.status !== SUBMISSION_STATUS.ACCEPTED) {
        // To show all results, comment out the loop break.
        // For now, let's fill the rest with 'Skipped' to show the user there are more.
        const currentIndex = testcases.findIndex((testcaseRow) => testcaseRow.case_number === case_number);
        for (let j = currentIndex + 1; j < testcases.length; j++) {
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

    return { results, score, overallStatus, maxTimeMs: maxTime, maxMemoryKb: maxMemory };

  } catch (error) {
    console.error("Error during judging:", error);
    return { overallStatus: SUBMISSION_STATUS.SYSTEM_ERROR, score: 0, results: [{ testCase: 1, status: 'Could not read test cases' }], maxTimeMs: 0, maxMemoryKb: 0 };
  }
}

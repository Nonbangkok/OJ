"use strict";
const db = require('../db');
const { exec } = require('child_process');
const { SUBMISSION_STATUS, JUDGE_CONFIG } = require('../constants');
async function runSingleCase(executablePath, input, timeLimitMs, memoryLimitMb) {
    return new Promise((resolve) => {
        // Using custom C wrapper for microsecond precision
        const timeCommand = `./scripts/time_wrapper`;
        // Use timeout command which is reliable on Linux
        const command = `timeout ${timeLimitMs / 1000}s ${timeCommand} ${executablePath}`;
        const executionOptions = {
            timeout: timeLimitMs + JUDGE_CONFIG.TIMEOUT_BUFFER_MS, // 
            maxBuffer: JUDGE_CONFIG.EXEC_MAX_BUFFER, // 50MB
            shell: '/bin/bash'
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
                        const sumSeconds = timeExpression.split('+').reduce((acc, val) => acc + parseFloat(val || 0), 0);
                        timeMs = Number((sumSeconds * 1000).toFixed(3));
                    }
                    catch (e) {
                        console.error("Error parsing CPU time:", e);
                    }
                }
                if (memMatch)
                    memoryKb = parseInt(memMatch[1], 10);
                // Clean stderr for reporting
                programStderr = stderr.split('\n').filter(line => !line.includes('MEM_USED') && !line.includes('TIME_USED')).join('\n').trim();
            }
            // 1. Check for TLE first (timeout command exit code 124)
            if (error && error.code === JUDGE_CONFIG.TLE_EXIT_CODE) {
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
            if (error) {
                // Did it run out of memory?
                if (error.signal === 'SIGSEGV' || (stderr && stderr.toLowerCase().includes('memory'))) {
                    return resolve({ status: SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED, timeMs, memoryKb: memoryLimitMb * 1024 });
                }
                // For other errors, treat as Runtime Error
                return resolve({
                    status: SUBMISSION_STATUS.RUNTIME_ERROR,
                    output: programStderr || error.message || 'Program terminated unexpectedly',
                    timeMs,
                    memoryKb
                });
            }
            resolve({ status: SUBMISSION_STATUS.PENDING, output: programOutput, timeMs, memoryKb });
        });
        // Prevent EPIPE errors from crashing the main process.
        child.stdin.on('error', (err) => {
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
        child.stdin.write(input);
        child.stdin.end();
    });
}
async function judge(problemId, executablePath) {
    try {
        const problemRes = await db.query('SELECT time_limit_ms, memory_limit_mb FROM problems WHERE id = $1', [problemId]);
        if (problemRes.rows.length === 0) {
            return { overallStatus: SUBMISSION_STATUS.SYSTEM_ERROR, score: 0, results: [] };
        }
        const { time_limit_ms, memory_limit_mb } = problemRes.rows[0];
        const testcasesRes = await db.query('SELECT case_number, input_data, output_data FROM testcases WHERE problem_id = $1 ORDER BY case_number ASC', [problemId]);
        const testcases = testcasesRes.rows;
        if (testcases.length === 0) {
            return { overallStatus: SUBMISSION_STATUS.SYSTEM_ERROR, score: 0, results: [{ testCase: 1, status: 'No test cases found' }] };
        }
        const results = [];
        for (const testcase of testcases) {
            const { case_number, input_data, output_data } = testcase;
            const runResult = await runSingleCase(executablePath, input_data, time_limit_ms, memory_limit_mb);
            // Now, compare output
            if (runResult.status === SUBMISSION_STATUS.PENDING) {
                const formattedStdout = runResult.output.trim().replace(/\r\n/g, '\n');
                const formattedExpectedOutput = output_data.trim().replace(/\r\n/g, '\n');
                if (formattedStdout === formattedExpectedOutput) {
                    runResult.status = SUBMISSION_STATUS.ACCEPTED;
                }
                else {
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
                for (let j = testcases.findIndex(t => t.case_number === case_number) + 1; j < testcases.length; j++) {
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
    }
    catch (error) {
        console.error("Error during judging:", error);
        return { overallStatus: SUBMISSION_STATUS.SYSTEM_ERROR, score: 0, results: [{ testCase: 1, status: 'Could not read test cases' }] };
    }
}
module.exports = {
    judge,
};
//# sourceMappingURL=judgeService.js.map
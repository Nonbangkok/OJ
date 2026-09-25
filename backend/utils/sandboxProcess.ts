import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { JUDGE_CONFIG } from '../constants';

/**
 * Sandbox identity + bounded-process helpers for the judging pipeline
 * (security findings RUNNER-003 / RUNNER-005 / RUNNER-006).
 *
 * The authoring runner (`backend/authoring/process.ts` + `compiler.ts`) is the
 * well-hardened reference implementation; the recipes here mirror it for the
 * main judge while staying usable outside the isolated runner container.
 */

/**
 * Whether this process can drop child processes to an unprivileged uid.
 * Only the production backend container (Linux, root) qualifies; local dev
 * keeps running compiles as the invoking user.
 */
export function canDropPrivileges(): boolean {
  return process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0;
}

let sandboxUidCursor = 0;

export interface SandboxIdentity {
  uid: number;
  gid: number;
}

/**
 * Next per-submission sandbox identity (uid + gid) from the rotating pool
 * (`JUDGE_CONFIG.SANDBOX_UID_BASE` .. `+SANDBOX_UID_POOL_SIZE`).
 *
 * The pool exists so that no two LIVE submissions share an identity:
 * RLIMIT_NPROC is enforced per-uid, so a forking submission can no longer
 * starve a concurrent one (RUNNER-006), and files owned by the submission's
 * uid are genuinely private to it (RUNNER-003). Because at most
 * `MAX_CONCURRENT_JUDGES` submissions are live at once and each takes the
 * next pool slot, the most recent N < pool-size acquisitions are always
 * distinct. The gid matches the uid so group permissions never blur the
 * boundary between two submissions.
 */
export function nextSandboxIdentity(): SandboxIdentity {
  const uid = JUDGE_CONFIG.SANDBOX_UID_BASE + sandboxUidCursor;
  sandboxUidCursor = (sandboxUidCursor + 1) % JUDGE_CONFIG.SANDBOX_UID_POOL_SIZE;
  return { uid, gid: uid };
}

/** Whether `prlimit` (util-linux) is available to bound compiler processes. */
export function prlimitAvailable(): boolean {
  return existsSync(JUDGE_CONFIG.PRLIMIT_PATH);
}

/**
 * Wrap a command with `prlimit` resource caps, mirroring the authoring
 * compiler recipe (RUNNER-005). Falls back to the bare command when prlimit
 * is unavailable (local dev).
 */
export function prlimitWrap(command: string, args: readonly string[]): { command: string; args: string[] } {
  if (!prlimitAvailable()) {
    return { command, args: [...args] };
  }
  return {
    command: JUDGE_CONFIG.PRLIMIT_PATH,
    args: [
      `--as=${JUDGE_CONFIG.COMPILE_AS_LIMIT_BYTES}`,
      `--cpu=${Math.ceil(JUDGE_CONFIG.COMPILE_TIMEOUT_MS / 1000) + 1}`,
      `--nproc=${JUDGE_CONFIG.COMPILE_NPROC_LIMIT}`,
      `--fsize=${JUDGE_CONFIG.COMPILE_FSIZE_LIMIT_BYTES}`,
      '--core=0',
      '--',
      command,
      ...args,
    ],
  };
}

export interface BoundedProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** The wall-clock timeout fired and the process group was SIGKILLed. */
  timedOut: boolean;
  /** Combined output exceeded maxBufferBytes and the group was SIGKILLed. */
  outputLimitExceeded: boolean;
  /** The process could not be spawned. */
  spawnError: boolean;
  durationMs: number;
}

export interface BoundedProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  uid?: number;
  gid?: number;
  /** Wall-clock cap after which the whole process group is SIGKILLed. */
  timeoutMs: number;
  /** Cap on combined stdout+stderr bytes kept (excess is drained, not kept). */
  maxBufferBytes: number;
}

/**
 * Run a child process without a shell, optionally as an unprivileged uid,
 * with a hard wall-clock timeout and output cap. On any limit the ENTIRE
 * process group receives SIGKILL (the child is spawned detached so it leads
 * its own group) — a SIGTERM-ignoring process cannot outlive its cap.
 * Mirrors `backend/authoring/process.ts` (runBoundedProcess).
 */
export function runBoundedChildProcess(
  command: string,
  args: readonly string[],
  options: BoundedProcessOptions
): Promise<BoundedProcessResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let timedOut = false;
    let outputLimitExceeded = false;
    let spawnError = false;
    let settled = false;
    let total = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn(command, args, {
      cwd: options.cwd,
      uid: options.uid,
      gid: options.gid,
      detached: true,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const killGroup = (): void => {
      if (!child.pid) {
        child.kill('SIGKILL');
        return;
      }
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        // Not a group leader (or already gone): fall back to the direct kill.
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL');
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, options.timeoutMs);

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Descendants may otherwise outlive the direct child.
      killGroup();
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        outputLimitExceeded,
        spawnError,
        durationMs: Date.now() - started,
      });
    };

    const collect = (chunks: Buffer[]) => (chunk: Buffer): void => {
      const remaining = Math.max(0, options.maxBufferBytes - total);
      if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
      total += chunk.length;
      // Keep draining (a full pipe would block the child); just stop keeping.
      if (total > options.maxBufferBytes && !outputLimitExceeded) {
        outputLimitExceeded = true;
        killGroup();
      }
    };

    child.stdout.on('data', collect(stdoutChunks));
    child.stderr.on('data', collect(stderrChunks));
    child.on('error', () => {
      spawnError = true;
      finish(null, null);
    });
    child.on('close', (exitCode, signal) => finish(exitCode, signal));
  });
}

import { spawn } from 'child_process';
import { existsSync, realpathSync } from 'fs';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { JUDGE_CONFIG } from '../constants';
import { logger } from './logger';

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
 * Options for {@link runSandboxProcess}. Extends the bounded-process options
 * with an optional stdin payload — the only addition over
 * {@link runBoundedChildProcess}, needed so the sandboxed workspace helpers
 * can write file content without a shell.
 */
export interface SandboxProcessOptions extends BoundedProcessOptions {
  /** Written to the child's stdin, which is then closed. */
  stdin?: string;
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
  return runSandboxProcess(command, args, options);
}

/**
 * {@link runBoundedChildProcess} plus an optional stdin payload. The payload
 * is written to the child's stdin (which is then closed) — the mechanism the
 * by-construction workspace uses to hand submission source to a uid-dropped
 * `tee` (hotfix 2026-09: see SANDBOX.md, "Workspace ownership by
 * construction"). stdin write errors (e.g. the child dying early) never fail
 * the run: they surface through the child's own exit code/stderr.
 */
export function runSandboxProcess(
  command: string,
  args: readonly string[],
  options: SandboxProcessOptions
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
      stdio: [options.stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    if (options.stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => {
        /* EPIPE etc. never fail the run; the exit code is the verdict. */
      });
      child.stdin.end(options.stdin);
    }

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

    child.stdout?.on('data', collect(stdoutChunks));
    child.stderr?.on('data', collect(stderrChunks));
    child.on('error', () => {
      spawnError = true;
      finish(null, null);
    });
    child.on('close', (exitCode, signal) => finish(exitCode, signal));
  });
}

// ---------------------------------------------------------------------------
// By-construction workspace ownership (hotfix 2026-09; see SANDBOX.md)
// ---------------------------------------------------------------------------

/**
 * Environment for the uid-dropped workspace helper spawns: the minimal
 * sandbox PATH plus /bin (mkdir/chmod/rm live in /bin on Debian slim).
 */
const WORKSPACE_OP_ENV = {
  PATH: `${JUDGE_CONFIG.SANDBOX_PATH}:/bin`,
  LANG: 'C.UTF-8',
} as unknown as NodeJS.ProcessEnv;

/**
 * Why this module exists: the production backend container runs with
 * `cap_drop: ALL` and only `SETUID`/`SETGID` added back — so root inside it
 * has NO `CAP_CHOWN`, `CAP_FOWNER`, or `CAP_DAC_OVERRIDE`. Consequences that
 * broke every compile after the Phase 0 lockdown:
 *
 *  1. root cannot `chown` workspace files to the sandbox uid (the diagnosed
 *     hotfix cause: the source stayed root-owned 0600, and the uid-dropped
 *     g++ died with "Permission denied" → every submission was a
 *     Compilation Error);
 *  2. root also cannot `chmod` or even REMOVE files/dirs owned by the sandbox
 *     uid — so any design where root touches uid-owned paths after creation
 *     fails the same way (the cleanup would silently leak workspaces).
 *
 * The fix is ownership BY CONSTRUCTION: every workspace operation — create,
 * write, chmod, remove — is performed by a short-lived child process spawned
 * as the submission's sandbox identity, using the same bounded, shell-less,
 * env-stripped `runSandboxProcess` the compile uses. `chown` is never called;
 * the workspace dir and everything in it are owned by the sandbox uid from
 * the instant they exist.
 *
 * The parent directory (`<tmpdir>/oj-submissions`) is root-owned, mode 1733
 * (sticky + group/world write, NO world read): sandbox uids can create their
 * own workspaces inside it, cannot list each other's, and the sticky bit
 * (like /tmp itself) stops one uid renaming/unlinking another's workspace.
 */

/** Absolute path of the root-owned parent of all per-submission workspaces. */
export function sandboxSubmissionsRoot(): string {
  return path.join(realpathSync(os.tmpdir()), 'oj-submissions');
}

/** Options for the uid-dropped workspace operations below. */
export interface SandboxWorkspaceOptions {
  /** Sandbox identity that must own the workspace (uid = gid). */
  sandbox: SandboxIdentity;
  /** Bounding identifier used in log/error context. */
  context?: string;
}

/** Run one uid-dropped helper command, bounded and shell-less. */
async function runAsSandbox(
  sandbox: SandboxIdentity,
  command: string,
  args: readonly string[],
  options?: { stdin?: string; cwd?: string }
): Promise<BoundedProcessResult> {
  return runSandboxProcess(command, args, {
    uid: sandbox.uid,
    gid: sandbox.gid,
    env: WORKSPACE_OP_ENV,
    timeoutMs: JUDGE_CONFIG.WORKSPACE_OP_TIMEOUT_MS,
    maxBufferBytes: JUDGE_CONFIG.WORKSPACE_OP_MAX_BUFFER,
    ...(options?.stdin !== undefined ? { stdin: options.stdin } : {}),
    ...(options?.cwd ? { cwd: options.cwd } : {}),
  });
}

/**
 * Ensure the root-owned submissions parent exists with the sticky 1733 mode.
 * Safe to call concurrently (mkdir -p semantics; an existing dir keeps its
 * mode — the chmod re-asserts 1733 against a stray manual change and is a
 * no-op in the normal case). Returns the parent's absolute path.
 *
 * NOT uid-dropped: the parent is deliberately root-owned (only root can
 * manage it; sandbox uids only ever add their own workspaces inside).
 */
export async function ensureSandboxSubmissionsRoot(): Promise<string> {
  const root = sandboxSubmissionsRoot();
  await fsp.mkdir(root, { recursive: true });
  try {
    await fsp.chmod(root, JUDGE_CONFIG.SANDBOX_PARENT_DIR_MODE);
  } catch {
    // Dev machines without CAP_FOWNER on a foreign-owned tmpdir: the dir
    // exists, which is what matters; mode enforcement is production-only.
  }
  return root;
}

/**
 * Create a per-submission workspace owned by the sandbox identity BY
 * CONSTRUCTION: a uid-dropped `mktemp -d` (mode 0700) creates it, so the
 * directory is uid-owned from the instant it exists. The 0711
 * traverse-only lockdown is applied by a uid-dropped `chmod` afterwards
 * (still as the owner, which is always permitted).
 *
 * Fails (rejects) if the helper cannot run — callers fall back to the
 * non-rooted dev path via {@link canDropPrivileges}.
 */
export async function createSandboxWorkspace(
  prefix: string,
  options: SandboxWorkspaceOptions
): Promise<string> {
  const parent = await ensureSandboxSubmissionsRoot();
  const result = await runAsSandbox(options.sandbox, 'mktemp', ['-d', `${parent}/${prefix}XXXXXX`]);
  if (result.exitCode !== 0 || result.spawnError || !result.stdout.trim()) {
    throw new Error(
      `failed to create sandbox-owned workspace (exit=${result.exitCode} spawnError=${result.spawnError}): ${result.stderr.trim()}`
    );
  }
  const workspaceDir = result.stdout.trim();
  const chmod = await runAsSandbox(options.sandbox, 'chmod', ['711', workspaceDir]);
  if (chmod.exitCode !== 0) {
    throw new Error(`failed to lock down sandbox workspace mode: ${chmod.stderr.trim()}`);
  }
  return workspaceDir;
}

/**
 * Write a file inside the sandbox workspace, owned by the sandbox identity BY
 * CONSTRUCTION: content is piped on stdin to a uid-dropped `dd of=<file>
 * status=none` (no shell, no staging file, no chown — and, unlike `tee`, no
 * echo of the content back on stdout, so the spawn's output cap can never
 * truncate a large source). Mode 0600 is applied by a uid-dropped `chmod`.
 * Returns the file's absolute path.
 */
export async function writeSandboxFile(
  workspaceDir: string,
  fileName: string,
  content: string,
  options: SandboxWorkspaceOptions
): Promise<string> {
  const filePath = path.join(workspaceDir, fileName);
  const write = await runAsSandbox(options.sandbox, 'dd', [`of=${filePath}`, 'status=none'], { stdin: content });
  if (write.exitCode !== 0 || write.spawnError) {
    throw new Error(`failed to write sandbox file ${fileName} (exit=${write.exitCode} spawnError=${write.spawnError}): ${write.stderr.trim()}`);
  }
  const chmod = await runAsSandbox(options.sandbox, 'chmod', ['600', filePath]);
  if (chmod.exitCode !== 0) {
    throw new Error(`failed to set sandbox file mode for ${fileName}: ${chmod.stderr.trim()}`);
  }
  return filePath;
}

/**
 * chmod a path inside the sandbox workspace AS ITS OWNER (the sandbox
 * identity). Root cannot do this in the lockdown container (no CAP_FOWNER),
 * so every mode change on uid-owned paths must go through here.
 */
export async function chmodSandboxPath(
  targetPath: string,
  mode: string,
  options: SandboxWorkspaceOptions
): Promise<void> {
  const result = await runAsSandbox(options.sandbox, 'chmod', [mode, targetPath]);
  if (result.exitCode !== 0 || result.spawnError) {
    throw new Error(`failed to chmod ${targetPath} to ${mode}: ${result.stderr.trim()}`);
  }
}

/**
 * Recursively remove a sandbox-owned workspace AS ITS OWNER. Root cannot do
 * this in the lockdown container (no CAP_DAC_OVERRIDE over uid-owned dirs),
 * so the pipeline's finally-block cleanup must go through here. Never throws
 * (matches the old `fs.rm` fire-and-forget semantics — a cleanup failure is
 * logged, never fatal).
 */
export async function removeSandboxWorkspace(
  workspaceDir: string,
  options: SandboxWorkspaceOptions
): Promise<void> {
  try {
    const result = await runAsSandbox(options.sandbox, 'rm', ['-rf', workspaceDir]);
    if (result.exitCode !== 0 || result.spawnError) {
      throw new Error(result.stderr.trim() || `rm exited ${result.exitCode}`);
    }
  } catch (error) {
    // Mirror the previous fs.rm callback warn: cleanup failures leak a
    // workspace dir (bounded by tmp reaper) but never fail the pipeline.
    logger.warn('failed to delete submission workspace', {
      context: options.context,
      err: String(error),
    });
  }
}

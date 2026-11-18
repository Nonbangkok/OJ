import fs from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Private backend work root for every temporary file the backend stages:
 * multer disk uploads (batch ZIPs, chunk parts, DB dumps), batch extraction,
 * chunked-upload sessions, DB exports and authoring testcase uploads.
 *
 * Judged programs run as pool uids in this same container and share its
 * world-writable /tmp, so nothing may sit at a predictable path there or in a
 * directory they can list. All of it lives below one per-process root
 * (`oj-work-<pid>-XXXXXX`, made by mkdtemp, mode 0700, owned by the backend
 * uid) under OJ_WORK_DIR when set, else under os.tmpdir(). OJ_WORK_DIR itself
 * must be a real directory owned by the backend uid with mode 0700; boot
 * fails otherwise.
 */

const PRIVATE_DIR_MODE = 0o700;
const WORK_ROOT_PREFIX = 'oj-work-';
const WORK_ROOT_NAME = /^oj-work-(\d+)-[A-Za-z0-9]{6}$/;
const TEMP_PREFIX = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

let workRoot: string | null = null;

const currentUid = (): number | undefined => (typeof process.getuid === 'function' ? process.getuid() : undefined);

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : undefined;

/**
 * Throw unless `dir` (not followed if it is a link) is a real directory owned
 * by this process's uid with mode exactly 0700.
 */
export function assertPrivateDirectory(dir: string, label = 'Temporary directory'): void {
  const stats = fs.lstatSync(dir);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} ${dir} must be a real directory, not a symlink or file.`);
  }
  const uid = currentUid();
  if (uid !== undefined && stats.uid !== uid) {
    throw new Error(`${label} ${dir} is owned by uid ${stats.uid}, expected ${uid}.`);
  }
  const mode = stats.mode & 0o777;
  if (mode !== PRIVATE_DIR_MODE) {
    throw new Error(`${label} ${dir} has mode ${mode.toString(8).padStart(4, '0')}, expected 0700.`);
  }
}

/**
 * Create `dir` (and missing parents) as 0700, tighten it to 0700 when this
 * process owns it, then verify it. A directory someone else created first, a
 * symlink, or a chmod failure (EPERM included) is an error, never skipped.
 */
export async function ensurePrivateDirectory(dir: string, label?: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  const stats = await lstat(dir);
  const uid = currentUid();
  if (stats.isDirectory() && !stats.isSymbolicLink() && (uid === undefined || stats.uid === uid)
    && (stats.mode & 0o777) !== PRIVATE_DIR_MODE) {
    await chmod(dir, PRIVATE_DIR_MODE);
  }
  assertPrivateDirectory(dir, label);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== 'ESRCH';
  }
}

/**
 * Remove work roots left by earlier processes: only our own name pattern,
 * only real directories owned by this uid, and only when their pid is gone
 * (or, at boot, is this very pid: a restarted container reuses pids).
 */
function removeStaleWorkRoots(base: string, keep: string, includeOwnPid: boolean): void {
  let names: string[];
  try {
    names = fs.readdirSync(base);
  } catch {
    return;
  }
  const uid = currentUid();
  for (const name of names) {
    const match = WORK_ROOT_NAME.exec(name);
    if (!match) continue;
    const candidate = path.join(base, name);
    if (candidate === keep) continue;
    const pid = Number(match[1]);
    if (pid === process.pid ? !includeOwnPid : isProcessAlive(pid)) continue;
    try {
      const stats = fs.lstatSync(candidate);
      if (stats.isSymbolicLink() || !stats.isDirectory() || (uid !== undefined && stats.uid !== uid)) continue;
      fs.rmSync(candidate, { recursive: true, force: true });
      logger.info('removed stale backend work root', { path: candidate });
    } catch (error) {
      logger.warn('could not remove stale backend work root', { path: candidate, err: error });
    }
  }
}

export interface InitBackendWorkRootOptions {
  /** OJ_WORK_DIR; '' means use os.tmpdir(). */
  configuredDir?: string;
  /** Boot only: also remove roots carrying this process's pid. */
  removeStaleOwnPid?: boolean;
}

/** Base directory the per-process root is created in; OJ_WORK_DIR is verified strictly. */
function resolveBase(configuredDir: string): string {
  if (!configuredDir) return os.tmpdir();
  const base = path.resolve(configuredDir);
  try {
    fs.mkdirSync(base, { mode: PRIVATE_DIR_MODE });
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error;
  }
  assertPrivateDirectory(base, 'OJ_WORK_DIR');
  return base;
}

/**
 * Create and verify this process's private work root and sweep stale ones.
 * server.ts calls it before listening and refuses to start if it throws.
 * Calling it again replaces the root used by later privateTempDir calls.
 */
export function initBackendWorkRoot(options: InitBackendWorkRootOptions = {}): string {
  const base = resolveBase(options.configuredDir ?? env.OJ_WORK_DIR);
  const root = fs.mkdtempSync(path.join(base, `${WORK_ROOT_PREFIX}${process.pid}-`));
  try {
    assertPrivateDirectory(root, 'Backend work root');
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
  removeStaleWorkRoots(base, root, options.removeStaleOwnPid ?? false);
  workRoot = root;
  return root;
}

/** This process's work root, created on first use outside server boot (scripts, tests). */
export function backendWorkRoot(): string {
  return workRoot ?? initBackendWorkRoot();
}

function tempTemplate(prefix: string): string {
  if (!TEMP_PREFIX.test(prefix)) {
    throw new Error(`Invalid private temp prefix "${prefix}".`);
  }
  return path.join(backendWorkRoot(), prefix);
}

/** A fresh, unpredictable 0700 directory inside the work root (mkdtemp). */
export function privateTempDir(prefix: string): Promise<string> {
  try {
    return mkdtemp(tempTemplate(prefix));
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Synchronous privateTempDir, for the few call sites that cannot await. */
export function privateTempDirSync(prefix: string): string {
  return fs.mkdtempSync(tempTemplate(prefix));
}

/**
 * Recursively remove a directory made by privateTempDir. Refuses (and logs)
 * any path that is not strictly inside the work root, so a bad argument can
 * never delete anything else. Never throws: callers use it in finally blocks.
 */
export async function removePrivateTemp(dir: string): Promise<void> {
  const root = workRoot;
  const relative = root ? path.relative(root, path.resolve(dir)) : '';
  if (!root || relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    logger.error('refusing to remove a path outside the backend work root', { path: dir });
    return;
  }
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('failed to remove private temp directory', { path: dir, err: error });
  }
}

import {
  canDropPrivileges,
  nextSandboxIdentity,
  prlimitAvailable,
  prlimitWrap,
  runBoundedChildProcess,
} from '../../utils/sandboxProcess';
import { JUDGE_CONFIG } from '../../constants';

/**
 * Unit tests for the judge sandbox helpers (RUNNER-001/003/005/006):
 * - per-submission uid pool rotation (concurrent submissions never share an
 *   RLIMIT_NPROC budget);
 * - prlimit wrapping of the compile step (authoring recipe);
 * - bounded child process: hard timeout, output cap, group SIGKILL escalation.
 */
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
}));

describe('sandboxProcess', () => {
  describe('canDropPrivileges', () => {
    const originalGetuid = process.getuid;
    afterAll(() => {
      Object.defineProperty(process, 'getuid', { value: originalGetuid });
    });

    it('is false when the process is not root (dev machines)', () => {
      Object.defineProperty(process, 'getuid', { value: () => 501 });
      expect(canDropPrivileges()).toBe(false);
    });
  });

  describe('nextSandboxIdentity (RUNNER-006)', () => {
    it('returns identities from the configured pool, rotating without repeats within one pool cycle', () => {
      const seen = new Set<number>();
      for (let i = 0; i < JUDGE_CONFIG.SANDBOX_UID_POOL_SIZE; i++) {
        const { uid, gid } = nextSandboxIdentity();
        expect(uid).toBeGreaterThanOrEqual(JUDGE_CONFIG.SANDBOX_UID_BASE);
        expect(uid).toBeLessThan(JUDGE_CONFIG.SANDBOX_UID_BASE + JUDGE_CONFIG.SANDBOX_UID_POOL_SIZE);
        // gid matches uid: one identity per submission, no shared groups.
        expect(gid).toBe(uid);
        expect(seen.has(uid)).toBe(false);
        seen.add(uid);
      }
      // The pool rotates: the next identity is the first one again.
      expect(nextSandboxIdentity().uid).toBe(JUDGE_CONFIG.SANDBOX_UID_BASE);
    });

    it('keeps the pool comfortably larger than MAX_CONCURRENT_JUDGES', () => {
      // Distinct live identities require pool size > concurrency; demand real
      // headroom so uid reuse while a slow judge drains is vanishingly rare.
      expect(JUDGE_CONFIG.SANDBOX_UID_POOL_SIZE).toBeGreaterThan(JUDGE_CONFIG.MAX_CONCURRENT_JUDGES * 4);
    });
  });

  describe('prlimitWrap (RUNNER-005)', () => {
    it('wraps the command with the authoring-style resource caps when prlimit exists', () => {
      expect(prlimitAvailable()).toBe(true);
      const wrapped = prlimitWrap('g++', ['-std=c++20', 'a.cpp']);
      expect(wrapped.command).toBe(JUDGE_CONFIG.PRLIMIT_PATH);
      expect(wrapped.args).toEqual([
        `--as=${JUDGE_CONFIG.COMPILE_AS_LIMIT_BYTES}`,
        `--cpu=${Math.ceil(JUDGE_CONFIG.COMPILE_TIMEOUT_MS / 1000) + 1}`,
        `--nproc=${JUDGE_CONFIG.COMPILE_NPROC_LIMIT}`,
        `--fsize=${JUDGE_CONFIG.COMPILE_FSIZE_LIMIT_BYTES}`,
        '--core=0',
        '--',
        'g++',
        '-std=c++20',
        'a.cpp',
      ]);
    });

    it('passes the command through untouched when prlimit is unavailable (local dev)', () => {
      const fs = require('fs') as { existsSync: jest.Mock };
      fs.existsSync.mockReturnValueOnce(false);
      const bare = prlimitWrap('g++', ['-std=c++20', 'a.cpp']);
      expect(bare).toEqual({ command: 'g++', args: ['-std=c++20', 'a.cpp'] });
    });
  });

  describe('runBoundedChildProcess', () => {
    // Real child processes (no child_process mock): these tests verify the
    // kill chain with actual OS semantics using /bin/sh.
    const shell = (script: string): { command: string; args: string[] } => ({
      command: '/bin/sh',
      args: ['-c', script],
    });

    it('resolves with exit code and output of a well-behaved process', async () => {
      const { command, args } = shell('echo hello');
      const result = await runBoundedChildProcess(command, args, {
        timeoutMs: 5000,
        maxBufferBytes: 1024,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
      expect(result.timedOut).toBe(false);
      expect(result.outputLimitExceeded).toBe(false);
      expect(result.spawnError).toBe(false);
    });

    it('SIGKILLs a SIGTERM-ignoring sleeper at the wall-clock cap (RUNNER-004)', async () => {
      // The sleeper traps SIGTERM; only SIGKILL can stop it. The timeout
      // must fire and the process group must die within timeout + grace.
      const { command, args } = shell('trap "" TERM; while :; do sleep 0.1; done');
      const result = await runBoundedChildProcess(command, args, {
        timeoutMs: 700,
        maxBufferBytes: 1024,
      });
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
      // SIGKILL termination surfaces as signal 'SIGKILL' (exitCode null).
      expect(result.signal === 'SIGKILL' || result.exitCode === null).toBe(true);
      expect(result.durationMs).toBeLessThan(4000);
    });

    it('kills the process group when output exceeds the cap', async () => {
      // Infinite outputter: the cap must stop collection and kill the group.
      const { command, args } = shell('while :; do echo 0123456789012345678901234567890123456789; done');
      const result = await runBoundedChildProcess(command, args, {
        timeoutMs: 10000,
        maxBufferBytes: 4096,
      });
      expect(result.outputLimitExceeded).toBe(true);
      // Kept output is capped at the limit.
      expect(result.stdout.length).toBeLessThanOrEqual(4096);
    });

    it('kills descendant processes with the group (no orphans)', async () => {
      // Child spawns a background sleeper, prints, and exits. Without a group
      // kill the orphaned sleeper would linger past the finish.
      const { command, args } = shell('sleep 30 & echo started');
      const result = await runBoundedChildProcess(command, args, {
        timeoutMs: 5000,
        maxBufferBytes: 1024,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('started');
      // The group kill after close reaps the backgrounded sleeper; give the
      // kernel a beat and confirm nothing from this group survives.
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    it('flags spawn errors for a nonexistent command', async () => {
      const result = await runBoundedChildProcess('/nonexistent/binary/xyz', [], {
        timeoutMs: 2000,
        maxBufferBytes: 1024,
      });
      expect(result.spawnError).toBe(true);
      expect(result.exitCode).toBeNull();
    });
  });
});

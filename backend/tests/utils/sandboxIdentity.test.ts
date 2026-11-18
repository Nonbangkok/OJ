import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { PassThrough } from 'stream';
import { JUDGE_CONFIG } from '../../constants';

/**
 * Sandbox identity hand-out and the per-uid process sweep (audit A4-02):
 * an identity is never handed to two live pipelines, it is swept before use,
 * and one whose sweep fails stays out of circulation until a sweep passes,
 * which a later acquisition retries. The sweep itself
 * (`time_wrapper --kill-uid`) is exercised for real by the judge runtime
 * suites in the backend image; here the spawn is faked.
 */
jest.mock('child_process', () => ({ spawn: jest.fn() }));

type SandboxModule = typeof import('../../utils/sandboxProcess');

/** How the next spawned helper ends: an exit code, or killed by a signal. Default 0. */
type Outcome = number | NodeJS.Signals;
let outcomes: Outcome[] = [];

const loadModule = (): { mod: SandboxModule; spawn: jest.Mock } => {
  let mod!: SandboxModule;
  let spawn!: jest.Mock;
  jest.isolateModules(() => {
    spawn = (require('child_process') as { spawn: jest.Mock }).spawn;
    mod = require('../../utils/sandboxProcess') as SandboxModule;
  });
  spawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    Object.assign(child, { pid: 5151, stdout: new PassThrough(), stderr: new PassThrough(), kill: jest.fn() });
    const outcome = outcomes.length > 0 ? outcomes.shift()! : 0;
    setImmediate(() => {
      (child.stderr as PassThrough).end(outcome === 0 ? '' : 'error: processes of uid survived the sweep\n');
      (child.stdout as PassThrough).end();
      if (typeof outcome === 'number') child.emit('close', outcome, null);
      else child.emit('close', null, outcome);
    });
    return child;
  });
  return { mod, spawn };
};

const BASE = JUDGE_CONFIG.SANDBOX_UID_BASE;
const POOL = JUDGE_CONFIG.SANDBOX_UID_POOL_SIZE;
const SWEEPER_BASE = JUDGE_CONFIG.SANDBOX_SWEEPER_UID_BASE;
const ATTEMPTS = JUDGE_CONFIG.SANDBOX_SWEEP_ATTEMPTS;

const sweepArgs = (uid: number): string[] => ['--kill-uid', String(uid), String(SWEEPER_BASE + (uid - BASE))];
const isSweep = (call: unknown[]): boolean => (call[1] as string[])[0] === '--kill-uid';

describe('sandbox identity hand-out (A4-02)', () => {
  let killSpy: jest.SpyInstance;
  let opendirSpy: jest.SpyInstance;
  let lstatSpy: jest.SpyInstance;
  /** Top-level entries the strays scan finds, as `<root>/<name>` -> owner uid. */
  let strays: Record<string, number>;

  beforeEach(() => {
    outcomes = [];
    strays = {};
    // runSandboxProcess SIGKILLs the helper's process group when it settles.
    killSpy = jest.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill);
    opendirSpy = jest.spyOn(fs.promises, 'opendir').mockImplementation((async (root: string) => {
      const names = Object.keys(strays).filter((target) => path.dirname(target) === root).map((target) => path.basename(target));
      if (names.length === 0) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return (async function* entries() {
        for (const name of names) yield { name };
      })();
    }) as never);
    lstatSpy = jest.spyOn(fs.promises, 'lstat').mockImplementation((async (target: string) => ({
      uid: strays[target] ?? 0,
    })) as never);
  });

  afterEach(() => {
    killSpy.mockRestore();
    opendirSpy.mockRestore();
    lstatSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('gives every pool identity its own sweeper uid, outside the pool and below nobody', () => {
    const { mod } = loadModule();
    const sweepers = Array.from({ length: POOL }, (_, i) => mod.sandboxSweeperUid({ uid: BASE + i, gid: BASE + i }));

    expect(new Set(sweepers).size).toBe(POOL);
    for (const sweeper of sweepers) {
      expect(sweeper >= BASE && sweeper < BASE + POOL).toBe(false);
      expect(sweeper).toBeGreaterThan(0);
      expect(sweeper).toBeLessThan(65534);
    }
    expect(() => mod.sandboxSweeperUid({ uid: BASE + POOL, gid: BASE + POOL })).toThrow(mod.SandboxSweepError);
    expect(() => mod.sandboxSweeperUid({ uid: 0, gid: 0 })).toThrow(mod.SandboxSweepError);
  });

  it('killSandboxProcesses runs the wrapper sweep mode as root for exactly that uid and its sweeper uid', async () => {
    const { mod, spawn } = loadModule();

    await mod.killSandboxProcesses({ uid: BASE + 3, gid: BASE + 3 });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe(path.resolve(JUDGE_CONFIG.TIME_WRAPPER_PATH));
    expect(args).toEqual(['--kill-uid', String(BASE + 3), String(SWEEPER_BASE + 3)]);
    // Started as root: the helper takes its sweeper/uid credentials itself.
    expect(options.uid).toBeUndefined();
    expect(options.env).toEqual({ PATH: JUDGE_CONFIG.SANDBOX_PATH });
  });

  it('killSandboxProcesses retries a helper that was killed by a signal', async () => {
    const { mod, spawn } = loadModule();
    outcomes = ['SIGKILL', 0];

    await mod.killSandboxProcesses({ uid: BASE, gid: BASE });

    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('killSandboxProcesses throws when processes survive every attempt', async () => {
    const { mod, spawn } = loadModule();
    outcomes = Array.from({ length: ATTEMPTS }, () => 3);

    await expect(mod.killSandboxProcesses({ uid: BASE, gid: BASE })).rejects.toBeInstanceOf(mod.SandboxSweepError);
    expect(spawn).toHaveBeenCalledTimes(ATTEMPTS);
  });

  it('killSandboxProcesses refuses an identity outside the pool without running anything', async () => {
    const { mod, spawn } = loadModule();

    await expect(mod.killSandboxProcesses({ uid: 1000, gid: 1000 })).rejects.toBeInstanceOf(mod.SandboxSweepError);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('never hands out an identity a live pipeline still holds', async () => {
    const { mod } = loadModule();

    const held = await Promise.all(Array.from({ length: POOL }, () => mod.acquireSandboxIdentity({ sweep: false })));
    expect(new Set(held.map((identity) => identity.uid)).size).toBe(POOL);
    // The pool is exhausted: nothing is shared, the pipeline fails instead.
    await expect(mod.acquireSandboxIdentity({ sweep: false })).rejects.toBeInstanceOf(mod.SandboxSweepError);

    mod.releaseSandboxIdentity(held[5]);
    expect((await mod.acquireSandboxIdentity({ sweep: false })).uid).toBe(held[5].uid);
  });

  it('sweeps the uid before handing it out', async () => {
    const { mod, spawn } = loadModule();

    const identity = await mod.acquireSandboxIdentity({ sweep: true });

    expect(identity).toEqual({ uid: BASE, gid: BASE });
    expect(spawn.mock.calls.map(([, args]) => args)).toEqual([sweepArgs(BASE)]);
  });

  it('a failed hand-out sweep quarantines that uid and the acquisition moves on to the next one', async () => {
    const { mod, spawn } = loadModule();
    outcomes = Array.from({ length: ATTEMPTS }, () => 3);

    const identity = await mod.acquireSandboxIdentity({ sweep: true });

    expect(identity.uid).toBe(BASE + 1);
    expect(spawn.mock.calls.map(([, args]) => args)).toEqual([
      ...Array.from({ length: ATTEMPTS }, () => sweepArgs(BASE)),
      sweepArgs(BASE + 1),
    ]);
    // The quarantined uid is not handed out while clean ones are free.
    mod.releaseSandboxIdentity(identity);
    const next = [];
    for (let i = 0; i < POOL - 1; i++) next.push((await mod.acquireSandboxIdentity({ sweep: true })).uid);
    expect(next).not.toContain(BASE);
  });

  it('fails (System Error upstream) when no candidate identity can be swept', async () => {
    const { mod, spawn } = loadModule();
    const candidates = JUDGE_CONFIG.SANDBOX_ACQUIRE_CANDIDATES;
    outcomes = Array.from({ length: ATTEMPTS * candidates }, () => 3);

    await expect(mod.acquireSandboxIdentity({ sweep: true })).rejects.toBeInstanceOf(mod.SandboxSweepError);

    const swept = spawn.mock.calls.filter(isSweep).map(([, args]) => Number((args as string[])[1]));
    expect([...new Set(swept)]).toEqual(Array.from({ length: candidates }, (_, i) => BASE + i));
    expect(swept).toHaveLength(ATTEMPTS * candidates);
  });

  it('a quarantined uid is skipped while clean ones are free, and used only after a passing sweep', async () => {
    const { mod } = loadModule();
    const first = await mod.acquireSandboxIdentity({ sweep: false });
    mod.releaseSandboxIdentity(first, { quarantine: true });

    const others = [];
    for (let i = 0; i < POOL - 1; i++) others.push(await mod.acquireSandboxIdentity({ sweep: false }));
    expect(others.map((identity) => identity.uid)).not.toContain(first.uid);

    // Only the quarantined uid is left: it must pass a sweep first.
    outcomes = Array.from({ length: ATTEMPTS }, () => 3);
    await expect(mod.acquireSandboxIdentity({ sweep: true })).rejects.toBeInstanceOf(mod.SandboxSweepError);
    expect((await mod.acquireSandboxIdentity({ sweep: true })).uid).toBe(first.uid);
  });

  it('a quarantined uid handed out after a passing sweep first loses what its last run left behind', async () => {
    const { mod, spawn } = loadModule();
    const first = await mod.acquireSandboxIdentity({ sweep: false });
    mod.releaseSandboxIdentity(first, { quarantine: true });
    for (let i = 0; i < POOL - 1; i++) await mod.acquireSandboxIdentity({ sweep: false });
    strays = { [path.join('/dev/shm', 'left-behind')]: first.uid };

    expect((await mod.acquireSandboxIdentity({ sweep: true })).uid).toBe(first.uid);

    const calls = spawn.mock.calls.map(([command, args, options]) => ({ command, args, uid: options.uid }));
    expect(calls).toEqual([
      { command: path.resolve(JUDGE_CONFIG.TIME_WRAPPER_PATH), args: sweepArgs(first.uid), uid: undefined },
      { command: 'rm', args: ['-rf', '--', '/dev/shm/left-behind'], uid: first.uid },
    ]);
  });

  describe('retrying quarantined identities', () => {
    let now: number;

    beforeEach(() => {
      now = 1_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    const quarantineFirst = async (mod: SandboxModule): Promise<number> => {
      const first = await mod.acquireSandboxIdentity({ sweep: false });
      mod.releaseSandboxIdentity(first, { quarantine: true });
      return first.uid;
    };

    it('is not retried before the retry interval has passed', async () => {
      const { mod, spawn } = loadModule();
      const quarantined = await quarantineFirst(mod);
      now += JUDGE_CONFIG.SANDBOX_QUARANTINE_RETRY_MS - 1;

      const identity = await mod.acquireSandboxIdentity({ sweep: true });

      expect(identity.uid).not.toBe(quarantined);
      expect(spawn.mock.calls.map(([, args]) => args)).toEqual([sweepArgs(identity.uid)]);
    });

    it('a later acquisition sweeps it again, removes its leftovers as the uid, and returns it to the pool', async () => {
      const { mod, spawn } = loadModule();
      const quarantined = await quarantineFirst(mod);
      strays = {
        [path.join(mod.sandboxSubmissionsRoot(), 'sub_9_9_old')]: quarantined,
        [path.join('/tmp', 'someone-elses')]: 0,
      };
      now += JUDGE_CONFIG.SANDBOX_QUARANTINE_RETRY_MS;

      const identity = await mod.acquireSandboxIdentity({ sweep: true });

      // The retry comes first and does not take the place of a clean hand-out.
      expect(identity.uid).not.toBe(quarantined);
      const calls = spawn.mock.calls.map(([command, args, options]) => ({ command: path.basename(command), args, uid: options.uid }));
      expect(calls).toEqual([
        { command: 'time_wrapper', args: sweepArgs(quarantined), uid: undefined },
        { command: 'rm', args: ['-rf', '--', path.join(mod.sandboxSubmissionsRoot(), 'sub_9_9_old')], uid: quarantined },
        { command: 'time_wrapper', args: sweepArgs(identity.uid), uid: undefined },
      ]);
      // Back in the pool: the round-robin reaches it again without a quarantine detour.
      strays = {};
      const seen = [];
      for (let i = 0; i < POOL - 1; i++) seen.push((await mod.acquireSandboxIdentity({ sweep: true })).uid);
      expect(seen).toContain(quarantined);
    });

    it('a retry that fails keeps it quarantined and waits another interval', async () => {
      const { mod, spawn } = loadModule();
      const quarantined = await quarantineFirst(mod);
      now += JUDGE_CONFIG.SANDBOX_QUARANTINE_RETRY_MS;
      outcomes = Array.from({ length: ATTEMPTS }, () => 3);

      const first = await mod.acquireSandboxIdentity({ sweep: true });
      mod.releaseSandboxIdentity(first);
      now += 1;
      spawn.mockClear();
      const second = await mod.acquireSandboxIdentity({ sweep: true });

      expect([first.uid, second.uid]).not.toContain(quarantined);
      // No second retry inside the interval.
      expect(spawn.mock.calls.map(([, args]) => args)).toEqual([sweepArgs(second.uid)]);
    });

    it('a retry whose leftovers cannot be removed keeps it quarantined', async () => {
      const { mod, spawn } = loadModule();
      const quarantined = await quarantineFirst(mod);
      strays = { [path.join('/dev/shm', 'stuck')]: quarantined };
      now += JUDGE_CONFIG.SANDBOX_QUARANTINE_RETRY_MS;
      outcomes = [0, 1]; // the sweep passes, the uid-dropped rm fails

      const first = await mod.acquireSandboxIdentity({ sweep: true });

      expect(first.uid).not.toBe(quarantined);
      expect(spawn.mock.calls.map(([command]) => path.basename(command))).toEqual(['time_wrapper', 'rm', 'time_wrapper']);
      // Still out of circulation: a full round of hand-outs skips it.
      strays = {};
      const seen = [];
      for (let i = 0; i < POOL - 2; i++) seen.push((await mod.acquireSandboxIdentity({ sweep: true })).uid);
      expect(seen).not.toContain(quarantined);
    });

    it('a retry that just failed is not tried again by the same acquisition', async () => {
      const { mod, spawn } = loadModule();
      const quarantined = await quarantineFirst(mod);
      for (let i = 0; i < POOL - 1; i++) await mod.acquireSandboxIdentity({ sweep: false });
      now += JUDGE_CONFIG.SANDBOX_QUARANTINE_RETRY_MS;
      outcomes = Array.from({ length: ATTEMPTS }, () => 3);

      await expect(mod.acquireSandboxIdentity({ sweep: true })).rejects.toBeInstanceOf(mod.SandboxSweepError);

      expect(spawn.mock.calls.map(([, args]) => args)).toEqual(Array.from({ length: ATTEMPTS }, () => sweepArgs(quarantined)));
    });

    it('the dev path (no sweep) never retries', async () => {
      const { mod, spawn } = loadModule();
      await quarantineFirst(mod);
      now += JUDGE_CONFIG.SANDBOX_QUARANTINE_RETRY_MS;

      await mod.acquireSandboxIdentity({ sweep: false });

      expect(spawn).not.toHaveBeenCalled();
    });
  });
});

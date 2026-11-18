import { EventEmitter } from 'events';
import path from 'path';
import { PassThrough } from 'stream';
import { JUDGE_CONFIG } from '../../constants';

/**
 * Sandbox identity hand-out and the per-uid process sweep (audit A4-02):
 * an identity is never handed to two live pipelines, it is swept before use,
 * and one whose sweep fails stays out of circulation until a sweep passes.
 * The sweep itself (`time_wrapper --kill-uid`) is exercised for real by the
 * judge runtime suites in the backend image; here the spawn is faked.
 */
jest.mock('child_process', () => ({ spawn: jest.fn() }));

type SandboxModule = typeof import('../../utils/sandboxProcess');

/** Every spawn exits with the next queued code (default 0). */
let exitCodes: number[] = [];

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
    const code = exitCodes.length > 0 ? exitCodes.shift()! : 0;
    setImmediate(() => {
      (child.stderr as PassThrough).end(code === 0 ? '' : 'error: processes of uid survived the sweep\n');
      (child.stdout as PassThrough).end();
      child.emit('close', code, null);
    });
    return child;
  });
  return { mod, spawn };
};

const BASE = JUDGE_CONFIG.SANDBOX_UID_BASE;
const POOL = JUDGE_CONFIG.SANDBOX_UID_POOL_SIZE;

describe('sandbox identity hand-out (A4-02)', () => {
  let killSpy: jest.SpyInstance;

  beforeEach(() => {
    exitCodes = [];
    // runSandboxProcess SIGKILLs the helper's process group when it settles.
    killSpy = jest.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill);
  });

  afterEach(() => killSpy.mockRestore());

  it('killSandboxProcesses runs the wrapper sweep mode as root for exactly that uid', async () => {
    const { mod, spawn } = loadModule();

    await mod.killSandboxProcesses({ uid: BASE + 3, gid: BASE + 3 });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe(path.resolve(JUDGE_CONFIG.TIME_WRAPPER_PATH));
    expect(args).toEqual(['--kill-uid', String(BASE + 3)]);
    // Started as root: the helper drops to the uid itself (kill(-1) as that uid).
    expect(options.uid).toBeUndefined();
    expect(options.env).toEqual({ PATH: JUDGE_CONFIG.SANDBOX_PATH });
  });

  it('killSandboxProcesses throws when processes survive', async () => {
    const { mod } = loadModule();
    exitCodes = [3];

    await expect(mod.killSandboxProcesses({ uid: BASE, gid: BASE })).rejects.toBeInstanceOf(mod.SandboxSweepError);
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
    expect(spawn.mock.calls.map(([, args]) => args)).toEqual([['--kill-uid', String(BASE)]]);
  });

  it('a failed sweep fails the acquisition and quarantines the uid', async () => {
    const { mod } = loadModule();
    exitCodes = [3];

    await expect(mod.acquireSandboxIdentity({ sweep: true })).rejects.toBeInstanceOf(mod.SandboxSweepError);

    // The next pipeline gets a different, clean uid.
    expect((await mod.acquireSandboxIdentity({ sweep: true })).uid).toBe(BASE + 1);
  });

  it('a quarantined uid is skipped while clean ones are free, and reused only after a passing sweep', async () => {
    const { mod } = loadModule();
    const first = await mod.acquireSandboxIdentity({ sweep: false });
    mod.releaseSandboxIdentity(first, { quarantine: true });

    const others = [];
    for (let i = 0; i < POOL - 1; i++) others.push(await mod.acquireSandboxIdentity({ sweep: false }));
    expect(others.map((identity) => identity.uid)).not.toContain(first.uid);

    // Only the quarantined uid is left: it must pass a sweep first.
    exitCodes = [3];
    await expect(mod.acquireSandboxIdentity({ sweep: true })).rejects.toBeInstanceOf(mod.SandboxSweepError);
    expect((await mod.acquireSandboxIdentity({ sweep: true })).uid).toBe(first.uid);
  });
});

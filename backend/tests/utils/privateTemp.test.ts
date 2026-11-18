import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  backendWorkRoot,
  ensurePrivateDirectory,
  privateTempDir,
  privateTempDirSync,
  removePrivateTemp,
  type InitBackendWorkRootOptions,
} from '../../utils/privateTemp';

// The backend work root keeps every temp file away from judged programs,
// which share the container's world-writable /tmp (A1-01 / A2-01 / A9-02).

const mode = (p: string): number => fs.lstatSync(p).mode & 0o777;

/**
 * initBackendWorkRoot in a fresh module instance, so the root the other tests
 * use (and scratch directories removed after each test) never replaces it.
 */
function initBackendWorkRoot(options: InitBackendWorkRootOptions): string {
  let root = '';
  jest.isolateModules(() => {
    const isolated = jest.requireActual('../../utils/privateTemp') as typeof import('../../utils/privateTemp');
    root = isolated.initBackendWorkRoot(options);
  });
  return root;
}

/** A pid that has just exited, so no process owns it. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
  return Number(child.stdout.toString());
}

describe('privateTemp', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'private-temp-test-'));
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('creates a 0700 per-process root under os.tmpdir() and private dirs inside it', async () => {
    const root = backendWorkRoot();
    expect(path.dirname(root)).toBe(os.tmpdir());
    expect(path.basename(root)).toMatch(new RegExp(`^oj-work-${process.pid}-[A-Za-z0-9]{6}$`));
    expect(mode(root)).toBe(0o700);
    expect(fs.lstatSync(root).uid).toBe(process.getuid!());

    const dir = await privateTempDir('batch-');
    const syncDir = privateTempDirSync('export-');
    try {
      expect(path.dirname(dir)).toBe(root);
      expect(path.basename(dir)).toMatch(/^batch-[A-Za-z0-9]{6}$/);
      expect(mode(dir)).toBe(0o700);
      expect(path.dirname(syncDir)).toBe(root);
      expect(mode(syncDir)).toBe(0o700);
      expect(await privateTempDir('batch-')).not.toBe(dir);
    } finally {
      await removePrivateTemp(dir);
      await removePrivateTemp(syncDir);
    }
  });

  it('rejects prefixes that could leave the work root', async () => {
    for (const prefix of ['', '../escape-', 'nested/dir-', '.hidden-']) {
      await expect(privateTempDir(prefix)).rejects.toThrow(/Invalid private temp prefix/);
      expect(() => privateTempDirSync(prefix)).toThrow(/Invalid private temp prefix/);
    }
  });

  describe('OJ_WORK_DIR', () => {
    it('creates a missing directory as 0700 and puts the per-process root inside it', () => {
      const configuredDir = path.join(scratch, 'work');
      const root = initBackendWorkRoot({ configuredDir });
      expect(mode(configuredDir)).toBe(0o700);
      expect(path.dirname(root)).toBe(configuredDir);
      expect(mode(root)).toBe(0o700);
    });

    it('tightens an existing directory this uid owns to 0700 (a fresh volume mountpoint is 0755)', () => {
      const configuredDir = path.join(scratch, 'volume');
      fs.mkdirSync(configuredDir);
      fs.chmodSync(configuredDir, 0o755);
      const root = initBackendWorkRoot({ configuredDir });
      expect(mode(configuredDir)).toBe(0o700);
      expect(path.dirname(root)).toBe(configuredDir);
      expect(mode(root)).toBe(0o700);
    });

    it('refuses a symlink, even to a private directory, and never changes its target', () => {
      const real = path.join(scratch, 'real');
      fs.mkdirSync(real, { mode: 0o700 });
      const link = path.join(scratch, 'link');
      fs.symlinkSync(real, link);
      expect(() => initBackendWorkRoot({ configuredDir: link })).toThrow(/must be a real directory/);
      expect(fs.readdirSync(real)).toEqual([]);

      const open = path.join(scratch, 'open');
      fs.mkdirSync(open);
      fs.chmodSync(open, 0o755);
      const openLink = path.join(scratch, 'open-link');
      fs.symlinkSync(open, openLink);
      expect(() => initBackendWorkRoot({ configuredDir: openLink })).toThrow(/must be a real directory/);
      expect(mode(open)).toBe(0o755);
      expect(fs.readdirSync(open)).toEqual([]);
    });

    it('refuses a directory owned by another uid (e.g. pre-created by a judged program) and leaves its mode alone', () => {
      const configuredDir = path.join(scratch, 'claimed');
      fs.mkdirSync(configuredDir);
      fs.chmodSync(configuredDir, 0o755);
      const realUid = process.getuid!();
      jest.spyOn(process, 'getuid').mockReturnValue(realUid + 1);
      expect(() => initBackendWorkRoot({ configuredDir })).toThrow(new RegExp(`owned by uid ${realUid}, expected ${realUid + 1}`));
      expect(mode(configuredDir)).toBe(0o755);
      expect(fs.readdirSync(configuredDir)).toEqual([]);
    });

    it('refuses a file', () => {
      const configuredDir = path.join(scratch, 'file');
      fs.writeFileSync(configuredDir, '', { mode: 0o644 });
      expect(() => initBackendWorkRoot({ configuredDir })).toThrow(/must be a real directory/);
      expect(mode(configuredDir)).toBe(0o644);
    });

    it('refuses a missing directory whose parent does not exist', () => {
      expect(() => initBackendWorkRoot({ configuredDir: path.join(scratch, 'no', 'parent') })).toThrow(/ENOENT/);
    });
  });

  describe('stale work roots', () => {
    let base: string;

    beforeEach(() => {
      base = path.join(scratch, 'base');
      fs.mkdirSync(base, { mode: 0o700 });
    });

    const makeRoot = (name: string): string => {
      const dir = path.join(base, name);
      fs.mkdirSync(path.join(dir, 'batch-abcdef'), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(dir, 'batch-abcdef', 'grader.cpp'), 'secret');
      return dir;
    };

    it('removes roots of exited processes but keeps live ones and unrelated entries', () => {
      const dead = makeRoot(`oj-work-${deadPid()}-AbC123`);
      const live = makeRoot(`oj-work-${process.ppid}-XyZ789`);
      const ownPid = makeRoot(`oj-work-${process.pid}-Own123`);
      const unrelated = makeRoot('oj-work-notapid-abcdef');
      const linkTarget = makeRoot('target');
      const link = path.join(base, `oj-work-${deadPid()}-Link12`);
      fs.symlinkSync(linkTarget, link);

      const root = initBackendWorkRoot({ configuredDir: base });

      expect(fs.existsSync(dead)).toBe(false);
      expect(fs.existsSync(live)).toBe(true);
      expect(fs.existsSync(ownPid)).toBe(true);
      expect(fs.existsSync(unrelated)).toBe(true);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(path.join(linkTarget, 'batch-abcdef', 'grader.cpp'))).toBe(true);
      expect(fs.existsSync(root)).toBe(true);
    });

    it('at boot also removes earlier roots that carry this pid (a restarted container reuses pids)', () => {
      const ownPid = makeRoot(`oj-work-${process.pid}-Own123`);
      const live = makeRoot(`oj-work-${process.ppid}-XyZ789`);

      const root = initBackendWorkRoot({ configuredDir: base, removeStaleOwnPid: true });

      expect(fs.existsSync(ownPid)).toBe(false);
      expect(fs.existsSync(live)).toBe(true);
      expect(fs.existsSync(root)).toBe(true);
    });
  });

  describe('removePrivateTemp', () => {
    it('removes a directory inside the work root', async () => {
      const dir = await privateTempDir('cleanup-');
      fs.writeFileSync(path.join(dir, 'dump.sql'), 'x');
      await removePrivateTemp(dir);
      expect(fs.existsSync(dir)).toBe(false);
    });

    it('refuses the work root itself and anything outside it', async () => {
      const root = backendWorkRoot();
      const outside = path.join(scratch, 'keep');
      fs.mkdirSync(outside);
      await removePrivateTemp(root);
      await removePrivateTemp(outside);
      await removePrivateTemp(path.join(root, '..', path.basename(scratch)));
      expect(fs.existsSync(root)).toBe(true);
      expect(fs.existsSync(outside)).toBe(true);
    });
  });

  describe('ensurePrivateDirectory', () => {
    it('creates a missing directory and tightens one this uid owns to 0700', async () => {
      const created = path.join(scratch, 'a', 'b');
      await ensurePrivateDirectory(created);
      expect(mode(created)).toBe(0o700);

      const loose = path.join(scratch, 'loose');
      fs.mkdirSync(loose);
      fs.chmodSync(loose, 0o777);
      await ensurePrivateDirectory(loose);
      expect(mode(loose)).toBe(0o700);
    });

    it('refuses a directory owned by another uid instead of using it', async () => {
      const claimed = path.join(scratch, 'claimed');
      fs.mkdirSync(claimed);
      fs.chmodSync(claimed, 0o777);
      jest.spyOn(process, 'getuid').mockReturnValue(process.getuid!() + 1);
      await expect(ensurePrivateDirectory(claimed, 'Session root')).rejects.toThrow(/Session root .* is owned by uid/);
    });

    it('surfaces a chmod failure (EPERM included) instead of skipping it', async () => {
      const loose = path.join(scratch, 'loose');
      fs.mkdirSync(loose);
      fs.chmodSync(loose, 0o755);
      jest.spyOn(fs.promises, 'chmod').mockRejectedValueOnce(Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }));
      await expect(ensurePrivateDirectory(loose)).rejects.toMatchObject({ code: 'EPERM' });
    });

    it('refuses a symlink', async () => {
      const real = path.join(scratch, 'real');
      fs.mkdirSync(real, { mode: 0o700 });
      const link = path.join(scratch, 'link');
      fs.symlinkSync(real, link);
      await expect(ensurePrivateDirectory(link)).rejects.toThrow(/must be a real directory/);
    });
  });
});

import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AuthoringSpool } from '../../authoring/spool';
import { jobSnapshotSchema } from '../../authoring/protocol';

describe('generated input artifact transport', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'oj-inputs-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('accepts a captured generator seed without accepting arbitrary process environment', () => {
    const snapshot = { version: 1, jobId: randomUUID(), draftId: randomUUID(), revision: 1,
      kind: 'run_generator', source: 'int main(){}', seed: '12345', deadline: new Date().toISOString() };
    expect(jobSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(jobSnapshotSchema.safeParse({ ...snapshot, seed: '-1' }).success).toBe(false);
    expect(jobSnapshotSchema.safeParse({ ...snapshot, env: { SECRET: 'x' } }).success).toBe(false);
  });

  it('natural-sorts, preserves exact UTF-8 input bytes and verifies published hashes', async () => {
    const spool = new AuthoringSpool(path.join(root, 'spool'));
    await spool.initialize();
    const inputs = path.join(root, 'input');
    await mkdir(inputs);
    await writeFile(path.join(inputs, 'input10.txt'), '10\r\n');
    await writeFile(path.join(inputs, 'input2.txt'), ' 2\n');
    const id = randomUUID();
    // Methods are introduced with Slice 5; runtime assertion proves the missing behavior.
    expect(typeof (spool as any).storeInputs).toBe('function');
    const manifest = await (spool as any).storeInputs(id, inputs);
    expect(manifest.map((entry: { filename: string }) => entry.filename)).toEqual(['input2.txt', 'input10.txt']);
    expect(await (spool as any).readInput(id, 0, manifest[0])).toBe(' 2\n');
    await writeFile(path.join(root, 'spool', 'artifacts', id, '0.txt'), 'tampered');
    await expect((spool as any).readInput(id, 0, manifest[0])).rejects.toThrow();
    await spool.cleanup(id);
    expect(await spool.jobIds()).not.toContain(id);
  });

  it('rejects linked or non-text generator files without publishing a partial set', async () => {
    const spool = new AuthoringSpool(path.join(root, 'spool'));
    await spool.initialize();
    expect(typeof (spool as any).storeInputs).toBe('function');
    const inputs = path.join(root, 'input');
    await mkdir(inputs);
    await writeFile(path.join(root, 'secret'), 'private');
    await symlink(path.join(root, 'secret'), path.join(inputs, '1.in'));
    const id = randomUUID();
    await expect((spool as any).storeInputs(id, inputs)).rejects.toThrow();
    expect(await spool.jobIds()).not.toContain(id);
    await rm(path.join(inputs, '1.in'));
    await writeFile(path.join(inputs, '1.in'), Buffer.from([0xff]));
    await expect((spool as any).storeInputs(id, inputs)).rejects.toThrow();
  });
});

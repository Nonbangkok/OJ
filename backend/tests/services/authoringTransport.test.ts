import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AuthoringSpool } from '../../authoring/spool';
import { jobSnapshotSchema, jobResultSchema } from '../../authoring/protocol';
import { runBoundedProcess } from '../../authoring/process';

describe('authoring job protocol and local transport', () => {
  let root: string;
  let spool: AuthoringSpool;
  const snapshot = () => ({
    version: 1 as const, jobId: randomUUID(), draftId: randomUUID(), revision: 2,
    kind: 'compile_solution' as const, source: 'int main() { return 0; }',
    deadline: new Date(Date.now() + 60_000).toISOString(),
  });
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'oj-transport-'));
    spool = new AuthoringSpool(root);
    await spool.initialize();
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('publishes a complete immutable snapshot and tolerates duplicate delivery', async () => {
    const job = snapshot();
    await spool.deliver(job);
    await spool.deliver({ ...job, source: 'changed' });
    const claimed = await spool.claim();
    expect(claimed).toEqual(job);
    expect(await spool.claim()).toBeNull();
    expect(await readdir(path.join(root, 'staging'))).toEqual([]);
    const result = { version: 1, jobId: job.jobId, draftId: job.draftId, revision: 2,
      status: 'succeeded', errorCode: null, log: '', durationMs: 10, exitCode: 0 };
    await spool.complete(job.jobId, jobResultSchema.parse(result));
    expect(await spool.readResult(job.jobId)).toEqual(result);
    await spool.deliver(job);
    expect(await spool.claim()).toBeNull();
    await spool.cleanup(job.jobId);
    expect(await spool.readResult(job.jobId)).toBeNull();
  });

  it('rejects path traversal and unbounded or unsupported job payloads', () => {
    expect(jobSnapshotSchema.safeParse({ ...snapshot(), jobId: '../escape' }).success).toBe(false);
    expect(jobSnapshotSchema.safeParse({ ...snapshot(), source: 'x'.repeat(2 * 1024 * 1024 + 1) }).success).toBe(false);
    expect(jobSnapshotSchema.safeParse({ ...snapshot(), kind: 'run_shell' }).success).toBe(false);
  });

  it('rejects a symlink result instead of reading files outside its spool', async () => {
    const id = randomUUID();
    await writeFile(path.join(root, 'secret'), '{}');
    await symlink(path.join(root, 'secret'), path.join(root, 'results', `${id}.json`));
    await expect(spool.readResult(id)).rejects.toThrow();
    expect(await readFile(path.join(root, 'secret'), 'utf8')).toBe('{}');
  });

  it('turns work interrupted by a runner restart into a durable failure', async () => {
    const job = snapshot();
    await spool.deliver(job);
    await spool.claim();
    await new AuthoringSpool(root).recoverInterrupted();
    expect(await spool.readResult(job.jobId)).toEqual(expect.objectContaining({
      status: 'failed', errorCode: 'runner_interrupted', jobId: job.jobId,
    }));
  });

  it('kills a hanging process and bounds diagnostic bytes', async () => {
    const timeout = await runBoundedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      cwd: root, timeoutMs: 50, maxLogBytes: 100,
    });
    expect(timeout.reason).toBe('timeout');
    const flood = await runBoundedProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000))'], {
      cwd: root, timeoutMs: 5000, maxLogBytes: 100,
    });
    expect(flood.reason).toBe('output_limit');
    expect(Buffer.byteLength(flood.log)).toBeLessThanOrEqual(100);
  });

  it('does not pass backend secrets to a child process', async () => {
    process.env.AUTHORING_TEST_SECRET = 'must-not-leak';
    try {
      const result = await runBoundedProcess(process.execPath, ['-e', 'console.log(process.env.AUTHORING_TEST_SECRET ?? "absent")'], {
        cwd: root, timeoutMs: 5000, maxLogBytes: 100,
      });
      expect(result.log.trim()).toBe('absent');
    } finally { delete process.env.AUTHORING_TEST_SECRET; }
  });
});

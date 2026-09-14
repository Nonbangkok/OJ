import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AUTHORING_RUNNER, failedResult, JobResult, JobSnapshot, jobResultSchema, jobSnapshotSchema } from './protocol';

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const uuid = z.string().uuid();

/** Reads only a bounded regular file, refusing symlinks and hard links. */
async function readJson(file: string, limit: number): Promise<unknown> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) throw new Error('Invalid spool file');
    const content = await handle.readFile();
    if (content.length > limit) throw new Error('Spool file too large');
    return JSON.parse(content.toString('utf8'));
  } finally { await handle.close(); }
}

/** Root-owned spool; compiler children must never be able to access this directory. */
export class AuthoringSpool {
  constructor(readonly root: string) {
    if (!path.isAbsolute(root) || root === path.parse(root).root) throw new Error('An absolute dedicated spool directory is required');
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (!(await lstat(this.root)).isDirectory()) throw new Error('Invalid spool directory');
    await chmod(this.root, 0o700);
    for (const name of ['staging', 'ready', 'active', 'results']) {
      const dir = path.join(this.root, name);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      if (!(await lstat(dir)).isDirectory()) throw new Error('Invalid spool directory');
    }
  }

  private location(area: string, id: string): string {
    return path.join(this.root, area, uuid.parse(id));
  }

  private async exists(file: string): Promise<boolean> {
    try { await lstat(file); return true; } catch (error) { if (missing(error)) return false; throw error; }
  }

  async deliver(input: JobSnapshot): Promise<void> {
    const job = jobSnapshotSchema.parse(input);
    if (await this.exists(`${this.location('results', job.jobId)}.json`)
      || await this.exists(this.location('active', job.jobId))
      || await this.exists(this.location('ready', job.jobId))) return;
    const stage = await mkdtemp(path.join(this.root, 'staging', `${job.jobId}-`));
    try {
      await writeFile(path.join(stage, 'request.json'), JSON.stringify(job), { mode: 0o600, flag: 'wx' });
      await rename(stage, this.location('ready', job.jobId));
    } catch (error) {
      if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    } finally { await rm(stage, { recursive: true, force: true }); }
  }

  async claim(): Promise<JobSnapshot | null> {
    for (const id of (await readdir(path.join(this.root, 'ready'))).sort()) {
      if (!uuid.safeParse(id).success) continue;
      const ready = this.location('ready', id);
      if (await this.exists(`${this.location('results', id)}.json`)) {
        await rm(ready, { recursive: true, force: true });
        continue;
      }
      try { await rename(ready, this.location('active', id)); }
      catch (error) {
        if (['ENOENT', 'EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) continue;
        throw error;
      }
      try {
        const job = jobSnapshotSchema.parse(await readJson(path.join(this.location('active', id), 'request.json'), AUTHORING_RUNNER.MAX_SNAPSHOT_BYTES));
        if (job.jobId !== id) throw new Error('Snapshot identity mismatch');
        return job;
      } catch {
        // Deliberately invalid result: the backend fails the job using its trusted DB identity.
        await this.writeResult(id, { invalid: true });
      }
    }
    return null;
  }

  private async writeResult(id: string, result: unknown): Promise<void> {
    const target = `${this.location('results', id)}.json`;
    if (await this.exists(target)) return;
    const temp = path.join(this.root, 'staging', `${id}-${randomUUID()}.json`);
    try {
      await writeFile(temp, JSON.stringify(result), { flag: 'wx', mode: 0o600 });
      await rename(temp, target);
    } finally { await rm(temp, { force: true }); }
  }

  async complete(id: string, result: JobResult): Promise<void> {
    if (result.jobId !== id) throw new Error('Result identity mismatch');
    await this.writeResult(id, jobResultSchema.parse(result));
  }

  async readResult(id: string): Promise<JobResult | null> {
    try { return jobResultSchema.parse(await readJson(`${this.location('results', id)}.json`, AUTHORING_RUNNER.MAX_RESULT_BYTES)); }
    catch (error) { if (missing(error)) return null; throw error; }
  }

  async isActive(id: string): Promise<boolean> { return this.exists(this.location('active', id)); }

  async recoverInterrupted(): Promise<void> {
    for (const id of await readdir(path.join(this.root, 'active'))) {
      if (!uuid.safeParse(id).success || await this.exists(`${this.location('results', id)}.json`)) continue;
      try {
        const job = jobSnapshotSchema.parse(await readJson(path.join(this.location('active', id), 'request.json'), AUTHORING_RUNNER.MAX_SNAPSHOT_BYTES));
        if (job.jobId !== id) throw new Error('Identity mismatch');
        await this.complete(id, failedResult(job, 'runner_interrupted'));
      } catch { await this.writeResult(id, { invalid: true }); }
    }
  }

  async cleanup(id: string): Promise<void> {
    for (const area of ['ready', 'active']) await rm(this.location(area, id), { recursive: true, force: true });
    await rm(`${this.location('results', id)}.json`, { force: true });
  }

  async jobIds(): Promise<string[]> {
    const ids = new Set<string>();
    for (const area of ['ready', 'active', 'results']) {
      for (const name of await readdir(path.join(this.root, area))) {
        const id = area === 'results' ? name.replace(/\.json$/, '') : name;
        if (uuid.safeParse(id).success) ids.add(id);
      }
    }
    return [...ids];
  }

  async cleanupStaging(now: number): Promise<void> {
    for (const name of await readdir(path.join(this.root, 'staging'))) {
      const file = path.join(this.root, 'staging', name);
      try {
        if (now - (await lstat(file)).mtimeMs > AUTHORING_RUNNER.JOB_TIMEOUT_MS) await rm(file, { recursive: true, force: true });
      } catch (error) { if (!missing(error)) throw error; }
    }
  }
}

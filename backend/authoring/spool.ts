import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, opendir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AUTHORING_RUNNER, CaseInput, failedResult, InputArtifact, JobResult, JobSnapshot, jobResultSchema, jobSnapshotSchema } from './protocol';
import { TESTCASE_LIMITS, TestcaseError, validateTestcaseFilename, naturalFilenameCompare, readTestcaseFile, decodeTestcaseText } from './testcases';

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
    for (const name of ['staging', 'ready', 'active', 'results', 'artifacts']) {
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

  async deliver(input: JobSnapshot, readInput?: (index: number, artifact: CaseInput) => Promise<string>): Promise<void> {
    const job = jobSnapshotSchema.parse(input);
    if (await this.exists(`${this.location('results', job.jobId)}.json`)
      || await this.exists(this.location('active', job.jobId))
      || await this.exists(this.location('ready', job.jobId))) return;
    const stage = await mkdtemp(path.join(this.root, 'staging', `${job.jobId}-`));
    try {
      if (job.kind === 'generate_outputs') {
        if (!readInput) throw new TestcaseError('invalid_job_inputs', 'Input snapshot reader is required');
        await mkdir(path.join(stage, 'inputs'), { mode: 0o700 });
        for (const [index, artifact] of job.cases!.entries()) {
          const content = Buffer.from(await readInput(index, artifact), 'utf8');
          this.validateArtifact(content, artifact, 'invalid_job_inputs');
          await writeFile(path.join(stage, 'inputs', `${index}.txt`), content, { mode: 0o600, flag: 'wx' });
        }
      }
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
    for (const area of ['ready', 'active', 'artifacts']) await rm(this.location(area, id), { recursive: true, force: true });
    await rm(`${this.location('results', id)}.json`, { force: true });
  }

  async jobIds(): Promise<string[]> {
    const ids = new Set<string>();
    for (const area of ['ready', 'active', 'results', 'artifacts']) {
      for (const name of await readdir(path.join(this.root, area))) {
        const id = area === 'results' ? name.replace(/\.json$/, '') : name;
        if (uuid.safeParse(id).success) ids.add(id);
      }
    }
    return [...ids];
  }

  /** Freeze validated files into a root-private artifact set; publish result JSON only afterward. */
  async storeInputs(id: string, directory: string): Promise<InputArtifact[]> {
    const names: string[] = [];
    for await (const entry of await opendir(directory)) {
      if (!entry.isFile()) throw new TestcaseError('invalid_testcase_file', `Generator output must be a regular file: ${entry.name.slice(0, 255)}`);
      names.push(entry.name);
      if (names.length > TESTCASE_LIMITS.MAX_CASES) throw new TestcaseError('invalid_case_count', 'Generator exceeds 1000 input files');
    }
    names.sort(naturalFilenameCompare);
    if (!names.length || names.length > TESTCASE_LIMITS.MAX_CASES) throw new TestcaseError('invalid_case_count', 'Generator must create 1–1000 input files');
    const stage = await mkdtemp(path.join(this.root, 'staging', `${uuid.parse(id)}-`));
    const manifest: InputArtifact[] = [];
    let total = 0;
    try {
      for (const [index, name] of names.entries()) {
        validateTestcaseFilename(name);
        const content = await readTestcaseFile(path.join(directory, name));
        decodeTestcaseText(content, name);
        total += content.length;
        if (total > TESTCASE_LIMITS.MAX_TOTAL_BYTES) throw new TestcaseError('testcases_too_large', 'Generated inputs exceed 512 MiB');
        manifest.push({ filename: name, sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
        await writeFile(path.join(stage, `${index}.txt`), content, { mode: 0o600, flag: 'wx' });
      }
      await rename(stage, this.location('artifacts', id));
      return manifest;
    } finally { await rm(stage, { recursive: true, force: true }); }
  }

  async readInput(id: string, index: number, artifact: InputArtifact): Promise<string> {
    return this.readArtifact(this.location('artifacts', id), index, artifact, 'invalid_generated_inputs');
  }

  async readOutput(id: string, index: number, artifact: InputArtifact): Promise<string> {
    return this.readArtifact(this.location('artifacts', id), index, artifact, 'invalid_generated_outputs');
  }

  async readJobInput(id: string, index: number, artifact: InputArtifact): Promise<string> {
    const active = this.location('active', id);
    if (!(await lstat(active)).isDirectory()) throw new TestcaseError('invalid_job_inputs', 'Invalid active job directory');
    return this.readArtifact(path.join(active, 'inputs'), index, artifact, 'invalid_job_inputs');
  }

  private validateArtifact(content: Buffer, artifact: InputArtifact, code: string): string {
    if (content.length !== artifact.sizeBytes || createHash('sha256').update(content).digest('hex') !== artifact.sha256) {
      throw new TestcaseError(code, 'Artifact checksum mismatch');
    }
    return decodeTestcaseText(content, artifact.filename);
  }

  private async readArtifact(directory: string, index: number, artifact: InputArtifact, code: string): Promise<string> {
    if (!Number.isInteger(index) || index < 0 || index >= TESTCASE_LIMITS.MAX_CASES) throw new TestcaseError('invalid_generated_inputs', 'Invalid case index');
    try {
      if (!(await lstat(directory)).isDirectory()) throw new Error('Invalid artifact directory');
      const content = await readTestcaseFile(path.join(directory, `${index}.txt`));
      return this.validateArtifact(content, artifact, code);
    } catch (error) {
      if (!(error instanceof TestcaseError) && (error as NodeJS.ErrnoException).code
        && !['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code!)) throw error;
      throw new TestcaseError(code, `Missing or invalid artifact: ${artifact.filename}`);
    }
  }

  async beginOutputArtifacts(id: string): Promise<string> {
    return mkdtemp(path.join(this.root, 'staging', `${uuid.parse(id)}-outputs-`));
  }

  private validateOutputStage(stage: string): void {
    if (path.dirname(stage) !== path.join(this.root, 'staging')
      || !/^[a-f0-9-]{36}-outputs-[A-Za-z0-9]+$/.test(path.basename(stage))) throw new Error('Invalid output stage');
  }

  async appendOutputArtifact(stage: string, index: number, file: string): Promise<Pick<InputArtifact, 'sizeBytes' | 'sha256'>> {
    this.validateOutputStage(stage);
    if (!Number.isInteger(index) || index < 0 || index >= TESTCASE_LIMITS.MAX_CASES) throw new TestcaseError('invalid_generated_outputs', 'Invalid output index');
    const content = await readTestcaseFile(file);
    decodeTestcaseText(content, `output ${index + 1}`);
    await writeFile(path.join(stage, `${index}.txt`), content, { mode: 0o600, flag: 'wx' });
    return { sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') };
  }

  async finishOutputArtifacts(id: string, stage: string): Promise<void> {
    this.validateOutputStage(stage);
    if (!path.basename(stage).startsWith(`${uuid.parse(id)}-outputs-`)) throw new Error('Output stage identity mismatch');
    await rename(stage, this.location('artifacts', id));
  }

  async discardOutputArtifacts(stage: string): Promise<void> {
    this.validateOutputStage(stage);
    await rm(stage, { recursive: true, force: true });
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

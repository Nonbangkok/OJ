import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { AuthoringSpool } from '../../authoring/spool';
import { JobSnapshot } from '../../authoring/protocol';

let root: string;
let spool: AuthoringSpool;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'oj-output-spool-')); spool = new AuthoringSpool(path.join(root, 'spool')); await spool.initialize(); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const job = (): JobSnapshot => ({ version: 1, jobId: randomUUID(), draftId: randomUUID(), revision: 1,
  kind: 'generate_outputs', source: 'int main(){}', deadline: new Date().toISOString(),
  cases: [{ caseId: randomUUID(), caseNumber: 1, filename: '1.in', sizeBytes: 2,
    sha256: createHash('sha256').update('1\n').digest('hex') }], limits: { timeLimitMs: 1000, memoryLimitMb: 256 } });

it('publishes immutable input bytes with the request, refusing corrupt delivery or later tampering', async () => {
  const j = job();
  await expect((spool as any).deliver(j, async () => 'BAD')).rejects.toThrow();
  expect(await spool.claim()).toBeNull();
  await (spool as any).deliver(j, async () => '1\n'); await spool.claim();
  expect(await (spool as any).readJobInput(j.jobId, 0, j.cases![0])).toBe('1\n');
  await writeFile(path.join(root, 'spool', 'active', j.jobId, 'inputs', '0.txt'), '2\n');
  await expect((spool as any).readJobInput(j.jobId, 0, j.cases![0])).rejects.toThrow();
});

it('stages output files privately and publishes only a finalized complete artifact set', async () => {
  const id = randomUUID();
  expect(typeof (spool as any).beginOutputArtifacts).toBe('function');
  const stage = await (spool as any).beginOutputArtifacts(id);
  const file = path.join(root, 'stdout'); await writeFile(file, ' 42\r\n');
  const artifact = await (spool as any).appendOutputArtifact(stage, 0, file);
  expect(artifact).toEqual({ sizeBytes: 5, sha256: createHash('sha256').update(' 42\r\n').digest('hex') });
  expect(await readdir(path.join(root, 'spool', 'artifacts'))).toEqual([]);
  await (spool as any).finishOutputArtifacts(id, stage);
  expect(await readFile(path.join(root, 'spool', 'artifacts', id, '0.txt'), 'utf8')).toBe(' 42\r\n');
});

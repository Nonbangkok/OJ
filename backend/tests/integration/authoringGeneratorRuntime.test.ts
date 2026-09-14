import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateInputs } from '../../authoring/generator';
import { AuthoringSpool } from '../../authoring/spool';
import { JobSnapshot } from '../../authoring/protocol';

const describeRunner = process.platform === 'linux' && process.getuid?.() === 0 ? describe : describe.skip;
describeRunner('generator runtime filesystem and process boundaries', () => {
  let root: string;
  let spool: AuthoringSpool;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'oj-generator-'));
    await chmod(root, 0o755);
    spool = new AuthoringSpool(path.join(root, 'spool'));
    await spool.initialize();
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const job = (source: string): JobSnapshot => ({ version: 1, jobId: randomUUID(), draftId: randomUUID(),
    revision: 1, kind: 'run_generator', source, seed: '12345', deadline: new Date(Date.now() + 120_000).toISOString() });

  it('supports legacy multi-file random_device generators without seed changes', async () => {
    const j = job(`#include <fstream>
#include <random>
int main(){ std::random_device rd; std::mt19937 gen(rd());
for(int i=1;i<=10;++i) std::ofstream("./input/input"+std::to_string(i)+".txt") << gen() << "\\n"; }`);
    const result = await generateInputs(j, root, spool);
    expect(result.status).toBe('succeeded');
    expect(result.inputs?.map(i => i.filename)).toEqual(Array.from({ length: 10 }, (_, i) => `input${i + 1}.txt`));
  });

  it('cannot access host paths, write outside input, or escape its process group', async () => {
    const j = job(`#include <fstream>
#include <unistd.h>
#include <sys/types.h>
int main(){
 if(getuid()!=65534 || getgid()!=65534) return 1;
 if(std::ifstream("/etc/passwd").good() || std::ifstream("/jobs/runner.lock").good()) return 2;
 if(std::ofstream("../escape").good() || std::ofstream("/generator").good()) return 3;
 if(setsid()!=-1 || setpgid(0,0)!=-1) return 4;
 std::ofstream("./input/1.in") << "safe";
}`);
    const result = await generateInputs(j, root, spool);
    expect(result.status).toBe('succeeded');
    expect(await spool.readInput(j.jobId, 0, result.inputs![0])).toBe('safe');
  });

  it.each([
    'symlink("/generator","./input/1.in");',
    'mkfifo("./input/1.in",0600);',
    'mkdir("./input/nested",0700); std::ofstream("./input/nested/private") << "x"; chmod("./input/nested",0000);',
    'std::ofstream("./input/1.in") << "ok"; link("./input/1.in","./input/2.in");',
    'for(int i=0;i<1001;++i) std::ofstream("./input/"+std::to_string(i)+".in");',
    '',
  ])('rejects invalid generated set %# and cleans the workspace', async body => {
    const j = job(`#include <fstream>\n#include <unistd.h>\n#include <sys/stat.h>\nint main(){${body}}`);
    expect((await generateInputs(j, root, spool)).errorCode).toBe('invalid_generated_inputs');
    expect((await readdir(root)).filter(n => n.startsWith('compile-'))).toEqual([]);
    expect(await spool.jobIds()).not.toContain(j.jobId);
  });

  it('kills forked descendants on timeout without retaining partial files', async () => {
    const j = job('#include <unistd.h>\nint main(){ fork(); while(true){} }');
    const result = await generateInputs(j, root, spool, { timeoutMs: 100 });
    expect(result.status).toBe('timed_out');
    expect(result.errorCode).toBe('generator_timeout');
    expect(await spool.jobIds()).not.toContain(j.jobId);
  });

  it('reports runtime errors and diagnostic floods rather than accepting partial output', async () => {
    const failure = await generateInputs(job('int main(){return 7;}'), root, spool);
    expect(failure.errorCode).toBe('generator_runtime_error');
    const flood = await generateInputs(job('#include <cstdio>\nint main(){while(true) puts("01234567890123456789");}'), root, spool);
    expect(flood.errorCode).toBe('generator_output_limit');
    expect(Buffer.byteLength(flood.log)).toBeLessThanOrEqual(65536);
  });
});

import { chmod, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { runOutputProcess } from '../../authoring/outputProcess';
import { generateOutputs } from '../../authoring/outputs';
import { AuthoringSpool } from '../../authoring/spool';
import { AUTHORING_RUNNER, JobSnapshot } from '../../authoring/protocol';

describe('bounded solution output transport', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'oj-output-process-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const run = (source: string, input = '', overrides: Record<string, number> = {}) => runOutputProcess(
    process.execPath, ['-e', source], { cwd: root, input, outputPath: path.join(root, 'stdout'), timeoutMs: 2000,
      maxOutputBytes: 1024, maxDiagnosticBytes: 1024, maxLogBytes: 64, ...overrides });

  it('streams stdin to a private output file and keeps diagnostics separate', async () => {
    const result = await run('process.stdin.pipe(process.stdout); process.stderr.write("diagnostic");', '42\n');
    expect(result.reason).toBe('exited');
    expect(result.exitCode).toBe(0);
    expect(await readFile(path.join(root, 'stdout'), 'utf8')).toBe('42\n');
    expect(result.log).toBe('diagnostic');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('kills stdout floods and never stages bytes beyond the configured limit', async () => {
    const result = await run('setInterval(()=>process.stdout.write("x".repeat(4096)),1);');
    expect(result.reason).toBe('output_limit');
    expect((await readFile(path.join(root, 'stdout'))).length).toBeLessThanOrEqual(1024);
  });

  it('enforces total diagnostics while retaining only the display budget', async () => {
    const result = await run('setInterval(()=>process.stderr.write("e".repeat(4096)),1);');
    expect(result.reason).toBe('output_limit');
    expect(Buffer.byteLength(result.log)).toBeLessThanOrEqual(64);
  });

  it('accepts output exactly at the cap and accepts empty output with a zero-byte budget', async () => {
    expect((await run('process.stdout.write("x".repeat(1024));')).reason).toBe('exited');
    await rm(path.join(root, 'stdout'));
    expect((await run('process.exit(0)', '', { maxOutputBytes: 0 })).reason).toBe('exited');
  });

  it('honors cancellation without leaving the child running', async () => {
    const abort = new AbortController();
    abort.abort();
    const result = await runOutputProcess(process.execPath, ['-e', 'while(true){}'], {
      cwd: root, input: '', outputPath: path.join(root, 'stdout'), timeoutMs: 2000,
      maxOutputBytes: 1024, maxDiagnosticBytes: 1024, maxLogBytes: 64, signal: abort.signal,
    });
    expect(result.reason).toBe('aborted');
  });

  it('bounds a hanging process and tolerates a solution that closes stdin early', async () => {
    expect((await run('while(true){}', '', { timeoutMs: 100 })).reason).toBe('timeout');
    await rm(path.join(root, 'stdout'));
    expect((await run('process.exit(7)', 'x'.repeat(1024 * 1024))).exitCode).toBe(7);
  });
});

const describeRunner = process.platform === 'linux' && process.getuid?.() === 0 ? describe : describe.skip;
describeRunner('reference solution execution', () => {
  let root: string;
  let spool: AuthoringSpool;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'oj-output-runtime-'));
    await chmod(root, 0o755);
    spool = new AuthoringSpool(path.join(root, 'spool'));
    await spool.initialize();
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  async function job(source: string, inputs = ['21\n', '8\n'], timeLimitMs = 1000): Promise<JobSnapshot> {
    const j: JobSnapshot = { version: 1, jobId: randomUUID(), draftId: randomUUID(), revision: 1,
      kind: 'generate_outputs', source, deadline: new Date(Date.now() + 120_000).toISOString(),
      limits: { timeLimitMs, memoryLimitMb: 64 },
      cases: inputs.map((input, index) => ({ caseId: randomUUID(), caseNumber: index + 1,
        filename: `${index + 1}.in`, sizeBytes: Buffer.byteLength(input), sha256: createHash('sha256').update(input).digest('hex') })) };
    await spool.deliver(j, async index => inputs[index]);
    return (await spool.claim())!;
  }

  it('runs each frozen input and preserves case identity with separate output artifacts', async () => {
    const j = await job('#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<n*2<<"\\n";}');
    const result = await generateOutputs(j, root, spool);
    expect(result.status).toBe('succeeded');
    expect(result.outputs?.map(o => [o.caseId, o.caseNumber, o.filename])).toEqual(j.cases!.map(c => [c.caseId, c.caseNumber, c.filename]));
    expect(await spool.readInput(j.jobId, 0, result.outputs![0])).toBe('42\n');
    expect(await spool.readInput(j.jobId, 1, result.outputs![1])).toBe('16\n');
    expect(result.outputs!.every(o => Number.isInteger(o.durationMs) && o.durationMs >= 0)).toBe(true);
    expect((await readdir(root)).filter(name => name.startsWith('compile-'))).toEqual([]);
    // Compile time is added once (by compileJob) on top of the execution phase; the
    // sum must stay within the job timeout bound that jobResultSchema enforces.
    expect(Number.isInteger(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThanOrEqual(AUTHORING_RUNNER.JOB_TIMEOUT_MS);
  });

  it('cannot read host files, write its jail, open sockets, or escape the process group', async () => {
    const j = await job(`#include <fstream>
#include <iostream>
#include <unistd.h>
#include <sys/socket.h>
int main(){
 if(getuid()!=65534 || getgid()!=65534) return 1;
 if(std::ifstream("/etc/passwd").good() || std::ifstream("/jobs/runner.lock").good()) return 2;
 if(std::ofstream("/solution").good() || std::ofstream("/escape").good()) return 3;
 if(setsid()!=-1 || setpgid(0,0)!=-1) return 4;
 if(socket(AF_INET, SOCK_STREAM, 0)!=-1) return 5;
 std::cout<<"safe";
}`, ['x']);
    expect((await generateOutputs(j, root, spool)).status).toBe('succeeded');
  });

  it('stops at the first runtime failure and discards every partial output', async () => {
    const j = await job('#include <iostream>\nint main(){int n;std::cin>>n;if(n==8)return 7;std::cout<<n;}', ['21', '8', '3']);
    const result = await generateOutputs(j, root, spool);
    expect(result.errorCode).toBe('solution_runtime_error');
    expect(result.failedCase?.caseId).toBe(j.cases![1].caseId);
    expect(result.exitCode).toBe(7);
    expect(result.outputs).toBeUndefined();
    expect(await readdir(path.join(spool.root, 'artifacts'))).toEqual([]);
    expect(await readdir(path.join(spool.root, 'staging'))).toEqual([]);
  });

  it.each([
    ['int main(){while(true){}}', 'solution_timeout'],
    ['#include <unistd.h>\nint main(){fork();while(true){}}', 'solution_timeout'],
    ['#include <cstdio>\nint main(){while(true)fputs("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",stderr);}', 'solution_output_limit'],
    ['#include <cstdio>\nint main(){char x[65536]={};while(true)fwrite(x,1,sizeof(x),stdout);}', 'solution_output_limit'],
    ['#include <cstdio>\nint main(){putchar(0);}', 'invalid_generated_outputs'],
    ['#include <cstdio>\nint main(){putchar(255);}', 'invalid_generated_outputs'],
  ])('rejects bounded or invalid output %# without publishing partial artifacts', async (source, errorCode) => {
    const j = await job(source, ['x'], errorCode === 'solution_timeout' ? 100 : 3000);
    const result = await generateOutputs(j, root, spool);
    expect(result.errorCode).toBe(errorCode);
    expect(result.failedCase?.caseId).toBe(j.cases![0].caseId);
    expect(Buffer.byteLength(result.log)).toBeLessThanOrEqual(65536);
    expect(await readdir(path.join(spool.root, 'artifacts'))).toEqual([]);
  });

  it('enforces the per-case memory allowance plus slack', async () => {
    const j = await job('#include <cstdlib>\nint main(){return malloc(160*1024*1024)==nullptr ? 0 : 9;}', ['x']);
    expect((await generateOutputs(j, root, spool)).status).toBe('succeeded');
  });

  it('prevents forked address spaces from multiplying the memory allowance while allowing threads', async () => {
    const j = await job(`#include <unistd.h>
#include <thread>
int main(){
 if(fork()!=-1) return 1;
 if(vfork()!=-1) _exit(2);
 int value=0; std::thread worker([&]{value=42;}); worker.join();
 return value==42 ? 0 : 3;
}`, ['x']);
    expect((await generateOutputs(j, root, spool)).status).toBe('succeeded');
  });

  it('bounds the whole job by its deadline even when individual cases are within their limits', async () => {
    const j = await job('#include <unistd.h>\nint main(){usleep(150000);}', Array(10).fill('x'));
    j.deadline = new Date(Date.now() + 400).toISOString();
    const result = await generateOutputs(j, root, spool);
    expect(result.status).toBe('timed_out');
    expect(result.durationMs).toBeLessThan(1000);
    expect(result.outputs).toBeUndefined();
    expect(await readdir(path.join(spool.root, 'artifacts'))).toEqual([]);
  });

  it('rejects corrupt frozen inputs before running the case', async () => {
    const j = await job('int main(){}', ['x']);
    j.cases![0].sha256 = '0'.repeat(64);
    const result = await generateOutputs(j, root, spool);
    expect(result.errorCode).toBe('invalid_job_inputs');
    expect(result.outputs).toBeUndefined();
  });
});

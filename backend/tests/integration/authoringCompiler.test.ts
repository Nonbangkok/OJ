import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { compileJob } from '../../authoring/compiler';
import { JobSnapshot } from '../../authoring/protocol';

const describeRunner = process.platform === 'linux' && process.getuid?.() === 0 ? describe : describe.skip;
describeRunner('C++ compiler in the isolated authoring runtime', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'oj-compiler-')); await chmod(root, 0o755); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const job = (source: string): JobSnapshot => ({ version: 1, jobId: randomUUID(), draftId: randomUUID(),
    revision: 1, kind: 'compile_solution', source, deadline: new Date(Date.now() + 60_000).toISOString() });

  it('compiles a minimal C++20 fixture with bounded resources', async () => {
    const result = await compileJob(job('#include <concepts>\nint main(){static_assert(std::integral<int>);}'), root);
    expect(result.status).toBe('succeeded');
    expect(result.exitCode).toBe(0);
  });

  it('returns bounded neutral diagnostics for a compile error', async () => {
    const result = await compileJob(job('int main(){ missing_identifier; }'), root);
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('compile_error');
    expect(result.log).toContain('missing_identifier');
    expect(result.log).not.toContain(root);
    expect(Buffer.byteLength(result.log)).toBeLessThanOrEqual(64 * 1024);
  });

  it('rejects forbidden includes before compilation and expired jobs before execution', async () => {
    expect((await compileJob(job('#include "/etc/shadow"'), root)).errorCode).toBe('forbidden_include');
    expect((await compileJob({ ...job('int main(){}'), deadline: '2000-01-01T00:00:00.000Z' }, root)).status).toBe('timed_out');
  });

  it('cannot read root-private files even using a macro to bypass the include guard', async () => {
    const secretPath = path.join(root, 'private.hpp');
    await writeFile(secretPath, '#error UNIQUE_PRIVATE_SENTINEL', { mode: 0o600 });
    const result = await compileJob(job(`#define HEADER "${secretPath}"\n#include HEADER\nint main(){}`), root);
    expect(result.status).toBe('failed');
    expect(result.log).not.toContain('UNIQUE_PRIVATE_SENTINEL');
  });

  it('terminates compilation when the configured wall-time limit is reached', async () => {
    const result = await compileJob(job('#include <bits/stdc++.h>\nint main(){}'), root, { timeoutMs: 1 });
    expect(result.status).toBe('timed_out');
    expect(result.errorCode).toBe('compile_timeout');
  });
});

import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AuthoringSpool } from './spool';
import { compileJob } from './compiler';
import { generateInputs } from './generator';
import { generateOutputs } from './outputs';
import { buildPdf } from './pdf';
import { verifyAll } from './verify';
import { AUTHORING_RUNNER, failedResult } from './protocol';

/** Single-consumer worker; the container entrypoint holds a kernel flock across restarts. */
async function main(): Promise<void> {
  const spool = new AuthoringSpool('/jobs');
  await spool.initialize();
  await mkdir('/work', { recursive: true, mode: 0o755 });
  // Only the runner's disposable compiler directories live under this tmpfs.
  for (const name of await readdir('/work')) {
    if (/^(compile|pdf)-[A-Za-z0-9]+$/.test(name)) await rm(path.join('/work', name), { recursive: true, force: true });
  }
  await spool.recoverInterrupted();
  const abort = new AbortController();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => abort.abort());
  while (!abort.signal.aborted) {
    const job = await spool.claim();
    if (!job) { await delay(AUTHORING_RUNNER.POLL_MS, undefined, { signal: abort.signal }).catch(() => {}); continue; }
    let result;
    try { result = job.kind === 'run_generator'
      ? await generateInputs(job, '/work', spool, { signal: abort.signal })
      : job.kind === 'generate_outputs'
      ? await generateOutputs(job, '/work', spool, { signal: abort.signal })
      : job.kind === 'verify_all' ? await verifyAll(job, '/work', spool, { signal: abort.signal })
      : job.kind === 'build_pdf' ? await buildPdf(job, '/work', spool, { signal: abort.signal })
      : await compileJob(job, '/work', { signal: abort.signal }); }
    catch { result = failedResult(job, 'runner_error'); }
    await spool.complete(job.jobId, result);
  }
}

if (require.main === module) main().catch(() => { console.error('Authoring runner failed; restart required'); process.exitCode = 1; });

import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

type OutputProcessOptions = {
  cwd: string; input: string; outputPath: string; timeoutMs: number; maxOutputBytes: number;
  maxDiagnosticBytes: number; maxLogBytes: number; signal?: AbortSignal;
};
type OutputProcessResult = {
  exitCode: number | null; reason: 'exited' | 'timeout' | 'output_limit' | 'spawn_error' | 'aborted';
  log: string; durationMs: number;
};

/** Only the trusted supervisor can open the spool path. Pipe backpressure bounds memory. */
export async function runOutputProcess(command: string, args: string[], options: OutputProcessOptions): Promise<OutputProcessResult> {
  const file = await open(options.outputPath, 'wx', 0o600);
  const started = performance.now();
  try {
    const child = spawn(command, args, { cwd: options.cwd, detached: true,
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TMPDIR: '/' } as unknown as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'] });
    let reason: OutputProcessResult['reason'] = 'exited';
    let outputBytes = 0;
    let diagnosticBytes = 0;
    let retainedBytes = 0;
    const logs: Buffer[] = [];
    const kill = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL'); }
    };
    const stop = (why: OutputProcessResult['reason']) => { if (reason === 'exited') reason = why; kill(); };
    const abort = () => stop('aborted');
    const timer = setTimeout(() => stop('timeout'), options.timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    // An early exit or intentionally closed stdin is normal solution behavior.
    child.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') stop('spawn_error'); });
    child.stdin.end(options.input);
    child.stderr.on('data', (chunk: Buffer) => {
      const retain = Math.min(chunk.length, Math.max(0, options.maxLogBytes - retainedBytes));
      if (retain) { logs.push(Buffer.from(chunk.subarray(0, retain))); retainedBytes += retain; }
      diagnosticBytes += chunk.length;
      if (diagnosticBytes > options.maxDiagnosticBytes) stop('output_limit');
    });
    child.on('error', () => stop('spawn_error'));
    // Kill descendants even when the main process exits before closing inherited pipes.
    child.once('exit', kill);
    const closed = new Promise<number | null>(resolve => child.once('close', resolve));
    const collect = (async () => {
      try {
        for await (const raw of child.stdout) {
          const chunk = raw as Buffer;
          const keep = Math.min(chunk.length, Math.max(0, options.maxOutputBytes - outputBytes));
          if (keep) {
            let written = 0;
            while (written < keep) written += (await file.write(chunk, written, keep - written)).bytesWritten;
          }
          outputBytes += chunk.length;
          if (outputBytes > options.maxOutputBytes) stop('output_limit');
        }
      } catch { stop('spawn_error'); }
    })();
    try {
      const [exitCode] = await Promise.all([closed, collect]);
      return { exitCode, reason, durationMs: Math.max(0, Math.round(performance.now() - started)),
        log: Buffer.concat(logs).toString('utf8') };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      kill();
    }
  } finally { await file.close(); }
}

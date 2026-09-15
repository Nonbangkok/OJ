import { spawn } from 'node:child_process';

type ProcessOptions = { cwd: string; timeoutMs: number; maxLogBytes: number; uid?: number; gid?: number; signal?: AbortSignal; seed?: string; headless?: boolean };
type ProcessResult = { exitCode: number | null; reason: 'exited' | 'timeout' | 'output_limit' | 'spawn_error' | 'aborted'; log: string; durationMs: number };

/** Executes without a shell or inherited secrets; kills the whole process group on limits. */
export async function runBoundedProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
  const started = Date.now();
  return new Promise(resolve => {
    let reason: ProcessResult['reason'] = 'exited';
    let total = 0;
    const chunks: Buffer[] = [];
    const child = spawn(command, args, {
      cwd: options.cwd, uid: options.uid, gid: options.gid, detached: true,
      // ProcessEnv's application-level required fields must NOT be passed to children.
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TMPDIR: options.seed === undefined ? options.cwd : '/input',
        ...(options.seed === undefined ? {} : { OJ_SEED: options.seed }),
        ...(options.headless ? { QT_QPA_PLATFORM: 'offscreen' } : {}) } as unknown as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const kill = () => {
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL');
        }
      }
    };
    const stop = (why: ProcessResult['reason']) => { if (reason === 'exited') reason = why; kill(); };
    const abort = () => stop('aborted');
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(() => stop('timeout'), options.timeoutMs);
    const collect = (chunk: Buffer) => {
      const remaining = Math.max(0, options.maxLogBytes - total);
      if (remaining) chunks.push(chunk.subarray(0, remaining));
      total += chunk.length;
      if (total > options.maxLogBytes) stop('output_limit');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', () => { reason = 'spawn_error'; });
    child.on('close', exitCode => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      kill(); // Descendants may otherwise outlive the compiler parent.
      resolve({ exitCode, reason, durationMs: Date.now() - started,
        log: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

import { spawn } from 'child_process';
import type { Readable } from 'stream';

export type SpawnCommand = {
  executable: string;
  args: string[];
  /**
   * The child's whole environment, on top of PATH. The backend's own
   * environment (SECRET_KEY, DATABASE_URL, ...) is never inherited (A2-06):
   * the pg client tools get exactly what their builder puts here.
   */
  env?: Record<string, string | undefined>;
  /** Streamed into the child's stdin when set; stdin is closed otherwise. */
  stdin?: Readable;
};

const STDERR_TAIL_LIMIT = 8192;

/** Used only when the backend itself runs without PATH. */
const FALLBACK_PATH = '/usr/local/bin:/usr/bin:/bin';

/** The environment a child process starts with: PATH plus the command's own variables. */
export const buildChildEnv = (commandEnv: SpawnCommand['env'] = {}): Record<string, string | undefined> => ({
  PATH: process.env.PATH ?? FALLBACK_PATH,
  ...commandEnv,
});

/**
 * Run an external command, capturing the last 8 KiB of stderr for error
 * reporting. Resolves on exit code 0; rejects with the stderr tail (or a
 * generic exit-code message) otherwise.
 *
 * With `stdin`, a read error on that stream kills the child with SIGKILL
 * before its stdin is closed, so a tool that commits at end of input (psql
 * --single-transaction) never sees a clean EOF after a truncated read.
 */
export const runCommand = (command: SpawnCommand): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      // types/env.d.ts makes the app's own variables required on ProcessEnv;
      // a child deliberately gets none of them.
      env: buildChildEnv(command.env) as NodeJS.ProcessEnv,
      stdio: [command.stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'],
    });

    let stderrTail = '';
    let inputError: Error | undefined;

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrTail = `${stderrTail}${chunk.toString()}`;
      if (stderrTail.length > STDERR_TAIL_LIMIT) {
        stderrTail = stderrTail.slice(-STDERR_TAIL_LIMIT);
      }
    });

    const input = command.stdin;
    if (input && child.stdin) {
      // EPIPE etc.: the child stopped reading (it exited early); its exit
      // status reports why.
      child.stdin.on('error', () => undefined);
      input.on('error', (error: Error) => {
        inputError = error;
        child.kill('SIGKILL');
      });
      // pipe() (unlike pipeline()) leaves child.stdin open when the source
      // fails, so the kill above always lands before any EOF.
      input.pipe(child.stdin);
    }

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      input?.destroy();
      if (inputError) {
        reject(inputError);
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderrTail.trim() || `${command.executable} exited with code ${code}`));
    });
  });

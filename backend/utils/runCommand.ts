import { spawn } from 'child_process';

export type SpawnCommand = {
  executable: string;
  args: string[];
  env?: NodeJS.ProcessEnv | Record<string, string>;
};

const STDERR_TAIL_LIMIT = 8192;

/**
 * Run an external command, capturing the last 8 KiB of stderr for error
 * reporting. Resolves on exit code 0; rejects with the stderr tail (or a
 * generic exit-code message) otherwise.
 */
export const runCommand = (command: SpawnCommand): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      env: {
        ...process.env,
        ...command.env,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderrTail = '';

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrTail = `${stderrTail}${chunk.toString()}`;
      if (stderrTail.length > STDERR_TAIL_LIMIT) {
        stderrTail = stderrTail.slice(-STDERR_TAIL_LIMIT);
      }
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderrTail.trim() || `${command.executable} exited with code ${code}`));
    });
  });

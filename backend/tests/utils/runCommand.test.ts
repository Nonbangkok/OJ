import { PassThrough, Readable } from 'stream';
import { runCommand } from '../../utils/runCommand';

/**
 * runCommand spawns the pg client tools for database import/export. A child
 * reports through stderr + a non-zero exit, which runCommand turns into the
 * rejection message, so these probes print what they saw and exit 1.
 */
const nodeProbe = (script: string, extra: Partial<Parameters<typeof runCommand>[0]> = {}) => runCommand({
  executable: process.execPath,
  args: ['-e', script],
  ...extra,
});

const failureOf = async (promise: Promise<void>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the command to fail');
};

describe('runCommand', () => {
  const originalSecret = process.env.SECRET_KEY;

  beforeEach(() => {
    process.env.SECRET_KEY = 'backend-secret-that-must-not-leak';
  });

  afterEach(() => {
    if (originalSecret === undefined) Reflect.deleteProperty(process.env, 'SECRET_KEY');
    else process.env.SECRET_KEY = originalSecret;
  });

  it('gives the child PATH plus the command env and nothing from the backend env (A2-06)', async () => {
    const message = await failureOf(nodeProbe(
      'console.error(JSON.stringify(Object.keys(process.env).sort())); process.exit(1)',
      { env: { PGPASSWORD: 'db-password' } },
    ));

    // macOS adds __CF_USER_TEXT_ENCODING to every process it starts.
    const keys = (JSON.parse(message) as string[]).filter((key) => !key.startsWith('__CF_'));
    expect(keys).toEqual(['PATH', 'PGPASSWORD']);
  });

  it('resolves on exit 0 and rejects with the stderr tail otherwise', async () => {
    await expect(nodeProbe('process.exit(0)')).resolves.toBeUndefined();
    await expect(nodeProbe('console.error("boom"); process.exit(3)')).rejects.toThrow('boom');
    await expect(nodeProbe('process.exit(4)')).rejects.toThrow(`${process.execPath} exited with code 4`);
  });

  it('streams stdin to the child', async () => {
    const message = await failureOf(nodeProbe(
      'let s = ""; process.stdin.on("data", (c) => { s += c; }); process.stdin.on("end", () => { console.error(s); process.exit(1); });',
      { stdin: Readable.from(['hello ', 'psql']) },
    ));

    expect(message).toBe('hello psql');
  });

  it('kills the child instead of closing its stdin when the input stream fails', async () => {
    // A child that would report success on a clean EOF (like psql committing
    // a --single-transaction restore at end of input) must not get one.
    const input = new PassThrough();
    const run = nodeProbe(
      'process.stdin.on("end", () => process.exit(0)); process.stdin.resume();',
      { stdin: input },
    );
    input.write('partial dump');
    setTimeout(() => input.destroy(new Error('read failed')), 100);

    await expect(run).rejects.toThrow('read failed');
  });

  it('reports a child that exits without reading all of its input', async () => {
    const input = new PassThrough();
    const run = nodeProbe('console.error("stopped early"); process.exit(3)', { stdin: input });
    input.write('x'.repeat(1024 * 1024));

    await expect(run).rejects.toThrow('stopped early');
  });
});

import { PassThrough } from 'stream';
import { createLinePrompter } from '../../scripts/linePrompter';

const pause = () => new Promise(resolve => setTimeout(resolve, 20));

describe('createLinePrompter (piped, non-TTY input)', () => {
  it('keeps every piped answer even when they all arrive (and stdin ends) before the next question', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const prompter = createLinePrompter(input, output);

    // `printf 'alice\nsecret123\n' | node create_admin.js`: both lines and
    // EOF arrive before the script asks its second question (it awaits a DB
    // query in between).
    input.end('alice\nsecret123\n');

    const username = await prompter.ask('Username: ');
    await pause();
    const password = await prompter.askSecret('Password: ');
    prompter.close();

    expect(username).toBe('alice');
    expect(password).toBe('secret123');
  });

  it('answers null once input has ended, instead of throwing', async () => {
    const input = new PassThrough();
    const prompter = createLinePrompter(input, new PassThrough());
    input.end('only-one\n');

    await expect(prompter.ask('a: ')).resolves.toBe('only-one');
    await pause();
    await expect(prompter.ask('b: ')).resolves.toBeNull();
    prompter.close();
  });

  it('waits for an answer that has not been typed yet', async () => {
    const input = new PassThrough();
    const prompter = createLinePrompter(input, new PassThrough());

    const pending = prompter.ask('Username: ');
    await pause();
    input.write('late\n');

    await expect(pending).resolves.toBe('late');
    prompter.close();
  });

  it('writes the prompt and never echoes a piped secret', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let written = '';
    output.on('data', chunk => { written += chunk.toString(); });
    const prompter = createLinePrompter(input, output);
    input.end('hunter2-secret\n');

    await prompter.askSecret('Password: ');
    prompter.close();

    expect(written).toContain('Password: ');
    expect(written).not.toContain('hunter2-secret');
  });
});

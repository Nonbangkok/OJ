import readline from 'readline';

export interface LinePrompter {
  /** Writes the prompt and resolves with the next input line, or null once input has ended. */
  ask(prompt: string): Promise<string | null>;
  /** Like ask, but a typed answer is masked on a terminal and a piped one is never echoed. */
  askSecret(prompt: string): Promise<string | null>;
  close(): void;
}

/**
 * Line-by-line prompts for CLI scripts that work both interactively and with
 * piped input (`printf 'name\npass\n' | node script.js`).
 *
 * readline's question() alone loses piped answers: all lines (and EOF) arrive
 * at once, a line that comes in while no question is pending is dropped, and
 * a question asked after EOF throws ERR_USE_AFTER_CLOSE. Here every line is
 * queued until it is asked for, and reading past the end resolves null.
 */
export function createLinePrompter(
  input: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): LinePrompter {
  const interactive = Boolean(input.isTTY);
  const rl = readline.createInterface({ input, output, terminal: interactive });
  const queued: string[] = [];
  const waiting: Array<(line: string | null) => void> = [];
  let ended = false;

  rl.on('line', (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else queued.push(line);
  });
  rl.on('close', () => {
    ended = true;
    while (waiting.length > 0) waiting.shift()?.(null);
  });

  const nextLine = (): Promise<string | null> => {
    if (queued.length > 0) return Promise.resolve(queued.shift() ?? null);
    if (ended) return Promise.resolve(null);
    return new Promise(resolve => waiting.push(resolve));
  };

  const ask = (prompt: string): Promise<string | null> => {
    if (interactive) {
      // readline redraws the line (e.g. on Backspace) with its own prompt.
      rl.setPrompt(prompt);
      rl.prompt();
    } else {
      output.write(prompt);
    }
    return nextLine();
  };

  const askSecret = async (prompt: string): Promise<string | null> => {
    if (!interactive) {
      // Nothing to mask: piped input is not echoed by the terminal.
      const answer = await ask(prompt);
      output.write('\n');
      return answer;
    }
    // On a terminal readline echoes each key; redraw the line as asterisks
    // after every keystroke so the password never stays on screen.
    const mask = () => {
      output.write(`\x1B[2K\x1B[200D${prompt}${'*'.repeat(rl.line.length)}`);
    };
    input.on('data', mask);
    try {
      return await ask(prompt);
    } finally {
      input.removeListener('data', mask);
    }
  };

  return { ask, askSecret, close: () => rl.close() };
}

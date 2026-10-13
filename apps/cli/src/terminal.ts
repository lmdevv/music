/**
 * Reading secrets from the process's standard input, for `music login`.
 *
 * Like `files.ts`, this adapter owns the Node stream APIs and imports nothing from Effect;
 * `input.ts` wraps it in the `Input` service and types its failures.
 */

/** Whether stdin is an interactive terminal, where a prompt can ask for the key. */
export const stdinIsTerminal = (): boolean => process.stdin.isTTY;

/** Reads stdin to its end, as `printf %s "$KEY" | music login --key-stdin` delivers it. */
export const readStdin = async (): Promise<string> => {
  const chunks: Array<Buffer> = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString("utf8");
};

/** Thrown when the user presses Ctrl-C at the prompt. */
export class PromptCancelled extends Error {
  override readonly name = "PromptCancelled";
}

const enter = new Set(["\r", "\n", "\u0004"]);

const erase = new Set(["\u007f", "\b"]);

/**
 * Asks `question` on stderr and reads one line from the terminal without echoing it, so the
 * secret appears neither on screen nor in shell history. Resolves on Enter or Ctrl-D.
 */
export const promptHidden = (question: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const input = process.stdin;
    let value = "";

    const finish = (cancelled: boolean): void => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stderr.write("\n");

      if (cancelled) {
        reject(new PromptCancelled("Cancelled"));
      } else {
        resolve(value);
      }
    };

    function onData(chunk: Buffer): void {
      for (const character of chunk.toString("utf8")) {
        if (enter.has(character)) return finish(false);

        if (character === "\u0003") return finish(true);

        value = erase.has(character) ? value.slice(0, -1) : value + character;
      }
    }

    process.stderr.write(question);
    input.setRawMode(true);
    input.on("data", onData);
    input.resume();
  });

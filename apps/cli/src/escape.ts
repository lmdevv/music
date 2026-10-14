import { CONTROL_CHARACTER } from "@music/commands/text";

/**
 * Control characters in what the CLI prints, written out as `\u001b` and so on. Names are cleaned
 * as they are saved, but older data, file tags, error messages, and other servers may still hold
 * them, and a terminal would act on them: one person could rewrite what another sees.
 */
/** Every control character, as `@music/commands/text` defines them for names. */
const CONTROL = new RegExp(CONTROL_CHARACTER.source, "gu");

/** The same, less the line breaks and tabs the CLI lays its own output out with. */
const CONTROL_BUT_LAYOUT = new RegExp(`(?![\\n\\t])${CONTROL_CHARACTER.source}`, "gu");

const escapeCharacter = (character: string): string =>
  `\\u${(character.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`;

/**
 * `text` with every control character written out, line breaks and tabs included: for anything
 * from the server placed inside a line, where a line break would fake another line.
 */
export const escapeControlCharacters = (text: string): string =>
  text.replaceAll(CONTROL, escapeCharacter);

/**
 * Output the CLI built itself, with only the line breaks and tabs it laid out kept. Escaped JSON
 * stays valid JSON that decodes to the same value: control characters can only appear inside its
 * strings, where `\u009b` means the same character.
 */
export const terminalSafe = (text: string): string =>
  text.replaceAll(CONTROL_BUT_LAYOUT, escapeCharacter);

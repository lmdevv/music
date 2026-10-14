/** A loopback host: the CLI sends the key to it over plain http:// without asking. */
const isLoopbackHost = (host: string): boolean =>
  host === "localhost" ||
  host.endsWith(".localhost") ||
  host === "[::1]" ||
  /^127(?:\.\d{1,3}){3}$/u.test(host);

/**
 * Whether the CLI refuses `server` without `--insecure` (or `MUSIC_INSECURE=1`): a plain http://
 * URL to another machine would send the API key unencrypted. Mirrors `sendsKeyInCleartext` in
 * `apps/cli/src/config.ts`.
 */
export const needsInsecure = (server: string): boolean => {
  if (!URL.canParse(server)) return false;

  const url = new URL(server);

  return url.protocol === "http:" && !isLoopbackHost(url.hostname);
};

/** The `music login` command Settings → Keys suggests for this server, piping the key in. */
export const cliLoginCommand = (server: string): string =>
  `printf '%s' "$KEY" | music login --server ${server} --key-stdin${needsInsecure(server) ? " --insecure" : ""}`;

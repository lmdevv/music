/**
 * Streams that start part-way into a song: the media service's `&start=<ms>` on a transcoded
 * profile, which encodes from that point at once instead of making a seek wait for the whole
 * transcode. See `StreamTimingHeader.start` for the timeline.
 */

/** The query parameter that starts a transcoded stream at an offset, in milliseconds. */
const START_PARAMETER = "start";

/**
 * `url` (a signed stream URL) asking for the stream from `startMs` into the song. The signature
 * does not cover the offset, so the URL stays valid.
 */
export const offsetUrl = (url: string, startMs: number): string => {
  const parsed = new URL(url, globalThis.location.href);

  parsed.searchParams.set(START_PARAMETER, String(Math.max(0, Math.round(startMs))));

  return parsed.toString();
};

/**
 * A stream that ends this far before the song's catalogued length was cut off rather than
 * finished. Catalogued lengths of some files (VBR MP3 without a header) are estimates, so a
 * stream that ends a little early counts as the end.
 */
const EARLY_END_MS = 1500;

/** How long `nothingLeftAt` waits for the media service's first answer before giving up. */
const PROBE_TIMEOUT_MS = 10_000;

/** True when a stream that ended at `positionMs` stopped short of a song `durationMs` long. */
export const endedEarly = (positionMs: number, durationMs: number): boolean =>
  positionMs < durationMs - EARLY_END_MS;

/**
 * Resolves true when the media service has no audio at `url` at all: it answers `200` with an
 * empty body, as it does for an offset past the song's real end. Resolves false when it has
 * audio there, fails, cannot be reached, or sends nothing within `PROBE_TIMEOUT_MS`; a media
 * element that fails on such a stream is then a real failure, reported instead of left silent.
 */
export const nothingLeftAt = async (url: string, signal: AbortSignal): Promise<boolean> => {
  // A controller rather than `AbortSignal.any`, which Safari before 17.4 lacks.
  const limited = new AbortController();
  const abort = (): void => limited.abort();
  const timer = setTimeout(abort, PROBE_TIMEOUT_MS);

  signal.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(url, { signal: limited.signal });

    if (!response.ok || response.body === null) return false;
    const reader = response.body.getReader();
    const first = await reader.read();

    await reader.cancel();

    return first.done;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
};

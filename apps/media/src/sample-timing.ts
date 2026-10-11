/**
 * Sample-exact timing of a fragmented MP4 transcode: how many priming samples its timeline starts
 * with and how many real samples follow. The gapless player trims with these numbers, so they are
 * measured from ffmpeg's output rather than assumed per codec.
 */
import { StreamTimingHeader } from "@music/commands/models";
import { Option, Schema } from "effect";

/** More priming than this means the measurement went wrong (AAC uses 1024, FLAC none). */
const MAX_PRIMING_SAMPLES = 16_384;

const Samples = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

/** Timing stored beside each fragmented transcode and sent as response headers. */
export const SampleTiming = Schema.Struct({
  primingSamples: Samples,
  durationSamples: PositiveInt,
  sampleRate: PositiveInt,
});

export interface SampleTiming extends Schema.Schema.Type<typeof SampleTiming> {}

/**
 * Derives the timing from what ffmpeg reported. `timelineSamples` is the output stream's length
 * (`duration_ts` in samples), `realSamples` the decoded source length, and `tailPadding` the
 * silence appended before encoding. Priming is whatever the timeline holds beyond the real
 * samples and the appended tail. Returns none when the numbers do not add up.
 */
export const measureTiming = (
  timelineSamples: number,
  realSamples: number,
  tailPadding: number,
  sampleRate: number,
): Option.Option<SampleTiming> => {
  const primingSamples = timelineSamples - realSamples - tailPadding;

  if (
    !Number.isSafeInteger(primingSamples) ||
    primingSamples < 0 ||
    primingSamples > MAX_PRIMING_SAMPLES ||
    !Number.isSafeInteger(realSamples) ||
    realSamples <= 0 ||
    !Number.isSafeInteger(sampleRate) ||
    sampleRate <= 0
  ) {
    return Option.none();
  }

  return Option.some({ primingSamples, durationSamples: realSamples, sampleRate });
};

/** The response headers that carry `timing`. */
export const timingHeaders = (timing: SampleTiming): ReadonlyArray<readonly [string, string]> => [
  [StreamTimingHeader.priming, String(timing.primingSamples)],
  [StreamTimingHeader.duration, String(timing.durationSamples)],
  [StreamTimingHeader.sampleRate, String(timing.sampleRate)],
];

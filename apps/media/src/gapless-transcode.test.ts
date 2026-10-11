import { TrackId } from "@music/commands/ids";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Effect, Layer, Option } from "effect";

import { AAC_TAIL_PADDING, countFrameSamples } from "./ffmpeg.ts";
import * as Files from "./files.ts";
import { measureTiming } from "./sample-timing.ts";
import { MEDIA_TEST_TIMEOUT, temporaryDirectory, testConfig } from "./testing/fixtures.ts";
import { runScoped } from "./testing/run.ts";
import { decodeMono, sineSegment } from "./testing/sine.ts";
import * as Transcoder from "./transcoder.ts";

/** A piece of the tone that starts and ends off every codec's frame grid (1024, 1152, 4096). */
const START = 150_001;

const END = 306_337;

const LENGTH = END - START;

const transcoderAt = (dataDir: string) =>
  Layer.build(Transcoder.layer.pipe(Layer.provide(testConfig(dataDir)))).pipe(
    Effect.flatMap((context) => Transcoder.Transcoder.pipe(Effect.provideContext(context))),
  );

/** RMS difference between `actual[offset + i]` and `expected[i]` over all of `expected`. */
const rmsAt = (actual: Float32Array, expected: Float32Array, offset: number): number => {
  let sum = 0;

  for (let index = 0; index < expected.length; index += 1) {
    const difference = (actual[offset + index] ?? 0) - (expected[index] ?? 0);
    sum += difference * difference;
  }

  return Math.sqrt(sum / expected.length);
};

/** The offset within ±`range` of `around` where `actual` best matches `expected`. */
const bestOffset = (
  actual: Float32Array,
  expected: Float32Array,
  around: number,
  range: number,
): number => {
  let best = around;

  for (let offset = around - range; offset <= around + range; offset += 1) {
    if (rmsAt(actual, expected, offset) < rmsAt(actual, expected, best)) best = offset;
  }

  return best;
};

const boxNames = (bytes: Uint8Array): ReadonlyArray<string> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names: Array<string> = [];

  for (let offset = 0; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset);
    names.push(String.fromCodePoint(...bytes.subarray(offset + 4, offset + 8)));

    if (size < 8) break;
    offset += size;
  }

  return names;
};

describe("gapless transcodes", { timeout: MEDIA_TEST_TIMEOUT }, () => {
  for (const [extension, profile, priming] of [
    ["flac", "fmp4-flac", 0],
    ["mp3", "fmp4-flac", 0],
    ["m4a", "fmp4-flac", 0],
    ["flac", "fmp4-aac", 1024],
    ["mp3", "fmp4-aac", 1024],
    ["m4a", "fmp4-aac", 1024],
  ] as const) {
    it(`${extension} to ${profile}: measured timing trims to the exact source samples`, () =>
      runScoped(
        Effect.gen(function* () {
          const scratch = yield* temporaryDirectory("sine");
          const source = yield* sineSegment(scratch, "piece", extension, START, END);
          const transcoder = yield* transcoderAt(yield* temporaryDirectory("data"));

          const input = {
            trackId: TrackId.make("sine"),
            profile,
            source,
            mtimeMs: 1,
            codec: extension === "m4a" ? "aac" : extension,
          };

          const output = yield* transcoder.transcode(input);

          // Encoder delay is measured, not assumed: ffmpeg's AAC encoder primes with 1024
          // samples, FLAC with none, and the length is the source's decoded length.
          expect(Option.getOrUndefined(output.timing)).toEqual({
            primingSamples: priming,
            durationSamples: LENGTH,
            sampleRate: 48_000,
          });

          // Fragmented, with an empty moov, a fragment index for seeking, and no edit list for
          // browsers to apply on their own.
          const bytes = yield* Files.readWholeFile(output.path);
          const boxes = boxNames(bytes);

          expect(boxes.slice(0, 4)).toEqual(["ftyp", "moov", "sidx", "moof"]);
          expect(Buffer.from(bytes).includes("elst")).toBe(false);

          // After skipping the priming, the decoded output lines up with the decoded source
          // sample for sample.
          const expected = yield* decodeMono(source, scratch);
          const decoded = yield* decodeMono(output.path, scratch);

          expect(expected.length).toBe(LENGTH);

          if (profile === "fmp4-flac") {
            expect(rmsAt(decoded, expected, priming)).toBeLessThan(1e-6);
            expect(decoded.length).toBe(LENGTH);
          } else {
            expect(bestOffset(decoded, expected, priming, 48)).toBe(priming);
            expect(rmsAt(decoded, expected, priming)).toBeLessThan(0.01);
            expect(decoded.length).toBeGreaterThanOrEqual(priming + LENGTH + AAC_TAIL_PADDING);
          }

          // The second request reuses the file and its sidecar.
          const again = yield* transcoder.transcode(input);

          expect(again).toEqual(output);
          expect(yield* Files.statPath(`${output.path}.json`)).toMatchObject({ kind: "file" });
        }),
      ));
  }

  it("re-encodes when the timing sidecar is missing", () =>
    runScoped(
      Effect.gen(function* () {
        const scratch = yield* temporaryDirectory("sine");
        const source = yield* sineSegment(scratch, "piece", "flac", 0, 4800);
        const transcoder = yield* transcoderAt(yield* temporaryDirectory("data"));

        const input = {
          trackId: TrackId.make("sine"),
          profile: "fmp4-aac" as const,
          source,
          mtimeMs: 1,
          codec: "flac",
        };

        const first = yield* transcoder.transcode(input);
        yield* Files.removePath(`${first.path}.json`);
        const second = yield* transcoder.transcode(input);

        expect(second.timing).toEqual(first.timing);
        expect(yield* Files.statPath(`${first.path}.json`)).toMatchObject({ kind: "file" });
      }),
    ));
});

describe("countFrameSamples", () => {
  it("sums the duration column and skips headers", () => {
    const listing = [
      "#tb 0: 1/48000",
      "#media_type 0: audio",
      "0,          0,          0,     4096,    32768, 0x1a2b3c4d",
      "0,       4096,       4096,     1905,    15240, 0x0badf00d",
      "",
    ].join("\n");

    expect(countFrameSamples(listing)).toBe(6001);
  });
});

describe("measureTiming", () => {
  it("recovers the priming from the timeline, the real length, and the appended tail", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 16_384 }),
        fc.integer({ min: 1, max: 500_000_000 }),
        fc.constantFrom(0, AAC_TAIL_PADDING),
        fc.constantFrom(44_100, 48_000, 96_000),
        (priming, real, tail, rate) => {
          expect(measureTiming(priming + real + tail, real, tail, rate)).toEqual(
            Option.some({ primingSamples: priming, durationSamples: real, sampleRate: rate }),
          );
        },
      ),
    );
  });

  it("rejects numbers that do not add up", () => {
    expect(measureTiming(1000, 2000, 0, 48_000)).toEqual(Option.none());
    expect(measureTiming(100_000, 0, 0, 48_000)).toEqual(Option.none());
    expect(measureTiming(100_000, 1000, 0, 48_000)).toEqual(Option.none());
    expect(measureTiming(5000, 1000, 0, 0)).toEqual(Option.none());
    expect(measureTiming(5000, Number.NaN, 0, 48_000)).toEqual(Option.none());
  });
});

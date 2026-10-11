import { join } from "node:path";

import { TrackId } from "@music/commands/ids";
import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";

import * as Files from "./files.ts";
import {
  fixtureLibrary,
  MEDIA_TEST_TIMEOUT,
  probe,
  temporaryDirectory,
  testConfig,
} from "./testing/fixtures.ts";
import * as Transcoder from "./transcoder.ts";
import { runScoped } from "./testing/run.ts";

const indexOfAtom = (bytes: Uint8Array, name: string): number =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf(name, 0, "latin1");

const transcoderWith = (dataDir: string, cacheMaxBytes: number) =>
  Layer.build(Transcoder.layer.pipe(Layer.provide(testConfig(dataDir, cacheMaxBytes)))).pipe(
    Effect.flatMap((context) => Transcoder.Transcoder.pipe(Effect.provideContext(context))),
  );

describe("Transcoder", { timeout: MEDIA_TEST_TIMEOUT }, () => {
  it("writes fast-start AAC that ffprobe can read and reuses it", () =>
    runScoped(
      Effect.gen(function* () {
        const { root } = yield* fixtureLibrary;
        const dataDir = yield* temporaryDirectory("data");
        const transcoder = yield* transcoderWith(dataDir, 512 * 1024 * 1024);

        const input = {
          trackId: TrackId.make("track1"),
          profile: "aac-128" as const,
          source: join(root, "The Sine Waves/Harmonics/01 Fundamental.flac"),
          mtimeMs: 1234.5,
        };

        const output = yield* transcoder.transcode(input);

        expect(output).toBe(join(dataDir, "cache", "aac-128", "track1-1234.m4a"));
        const probed = yield* probe(output);

        expect(probed.streams).toMatchObject([
          { codec_name: "aac", sample_rate: "44100", channels: 2 },
        ]);
        const bytes = yield* Files.readWholeFile(output);

        expect(indexOfAtom(bytes, "moov")).toBeLessThan(indexOfAtom(bytes, "mdat"));

        const before = yield* Files.statPath(output);

        expect(yield* transcoder.transcode(input)).toBe(output);
        expect((yield* Files.statPath(output)).size).toBe(before.size);
        expect(yield* transcoder.ffmpegAvailable).toBe(true);
      }),
    ));

  it("evicts the least recently served files when the cache is over its limit", () =>
    runScoped(
      Effect.gen(function* () {
        const { root } = yield* fixtureLibrary;
        const dataDir = yield* temporaryDirectory("data");
        // Each fixture transcode is roughly 60 to 100 KB, so two of them overflow 150 KB.
        const transcoder = yield* transcoderWith(dataDir, 150_000);

        const transcode = (id: string, path: string) =>
          transcoder.transcode({
            trackId: TrackId.make(id),
            profile: "aac-320",
            source: join(root, path),
            mtimeMs: 1,
          });

        const first = yield* transcode("first", "Aurora Tones/First Light/01 Dawn.flac");
        yield* Effect.sleep("20 millis");

        const second = yield* transcode("second", "Aurora Tones/First Light/02 Morning Haze.flac");

        const remaining = yield* Files.listNames(join(dataDir, "cache", "aac-320"));

        expect(remaining).toEqual(["second-1.m4a"]);
        expect(second.endsWith("second-1.m4a")).toBe(true);
        expect(first.endsWith("first-1.m4a")).toBe(true);
      }),
    ));
});

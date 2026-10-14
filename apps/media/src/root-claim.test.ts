import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";
import { Effect, Layer, Schedule } from "effect";

import * as Files from "./files.ts";
import * as JobWorker from "./job-worker.ts";
import {
  fixtureLibrary,
  MEDIA_TEST_TIMEOUT,
  temporaryDirectory,
  testConfig,
} from "./testing/fixtures.ts";
import {
  isSettled,
  jobById,
  layerMemory,
  MemoryMediaBackendControl,
} from "./testing/memory-media-backend.ts";
import { runScoped } from "./testing/run.ts";

/** A job worker over the in-memory backend, with `musicRoots` as `MUSIC_ROOTS`. */
const worker = (dataDir: string, musicRoots: ReadonlyArray<string> | null = null) =>
  Effect.gen(function* () {
    const services = Layer.merge(
      layerMemory,
      testConfig(dataDir, undefined, undefined, musicRoots),
    );

    const context = yield* Layer.build(
      Layer.merge(services, JobWorker.layer.pipe(Layer.provide(services))),
    );

    return yield* MemoryMediaBackendControl.pipe(Effect.provideContext(context));
  });

const scanOf = (control: MemoryMediaBackendControl["Service"], path: string) =>
  Effect.gen(function* () {
    const libraryId = yield* control.addLibrary(path);
    const jobId = yield* control.enqueueScan(libraryId);

    const job = yield* control.jobs.pipe(
      Effect.map((jobs) => jobById(jobs, jobId)),
      Effect.repeat({ schedule: Schedule.spaced("20 millis"), until: isSettled, times: 500 }),
    );

    const tracks = (yield* control.tracks).filter((track) => track.libraryId === libraryId);

    return { job, tracks };
  });

describe("root claims", { timeout: MEDIA_TEST_TIMEOUT }, () => {
  it("refuses a link to another library's folder, indexing nothing", () =>
    runScoped(
      Effect.gen(function* () {
        const { root } = yield* fixtureLibrary;
        const control = yield* worker(yield* temporaryDirectory("data"));
        const links = yield* temporaryDirectory("links");

        // The same folder, and the folder around it, by other names.
        yield* Files.makeSymlink(root, join(links, "same"));
        yield* Files.makeSymlink(dirname(root), join(links, "around"));

        const first = yield* scanOf(control, root);

        expect(first.job?.status).toBe("done");
        expect(first.tracks).toHaveLength(10);

        for (const alias of ["same", "around"]) {
          const second = yield* scanOf(control, join(links, alias));

          expect(second.job?.outcome).toEqual({
            status: "failed",
            error: "This folder overlaps another library",
          });
          expect(second.tracks).toEqual([]);
        }
      }),
    ));

  it("refuses /proc/self/root, which names the whole file system again", () =>
    runScoped(
      Effect.gen(function* () {
        const { root } = yield* fixtureLibrary;
        const control = yield* worker(yield* temporaryDirectory("data"));
        const { job, tracks } = yield* scanOf(control, `/proc/self/root${root}`);

        expect(job?.outcome).toEqual({
          status: "failed",
          error: "A library folder can't be in /proc, /sys, or /dev",
        });
        expect(tracks).toEqual([]);
      }),
    ));

  it("scans only inside MUSIC_ROOTS, following links to their real folders", () =>
    runScoped(
      Effect.gen(function* () {
        const { root } = yield* fixtureLibrary;
        const allowed = yield* temporaryDirectory("allowed");
        const escape = join(allowed, "escape");

        yield* Files.makeSymlink(root, escape);
        const control = yield* worker(yield* temporaryDirectory("data"), [allowed]);
        const { job, tracks } = yield* scanOf(control, escape);

        expect(job?.outcome).toEqual({
          status: "failed",
          error: `Library folders must be inside ${allowed} (MUSIC_ROOTS)`,
        });
        expect(tracks).toEqual([]);
      }),
    ));
});

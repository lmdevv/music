/**
 * How many songs of a library LRCLIB has lyrics for. Reads the songs with the `music` CLI (its
 * stored login, or `MUSIC_SERVER` and `MUSIC_API_KEY`), samples some, and asks LRCLIB about each
 * through the lyrics worker's own client: the same matching, pacing, pauses, and User-Agent. A
 * song asked while LRCLIB is unavailable is asked up to three more times, each after the client's
 * pause (`Retry-After`, or a backoff from 30 seconds); one whose record cannot be read counts as
 * unreadable. Bundled and run by `scripts/lrclib-coverage.sh`.
 *
 *   scripts/lrclib-coverage.sh [--sample 100] [--seed 1]
 *
 * `MUSIC_CLI` names another CLI command; `LRCLIB_URL` points at a stand-in.
 */
import { parseArgs } from "node:util";

import { canLookUp, LyricBody } from "@music/commands/lyrics";
import { Effect, Option, Predicate, Schema } from "effect";

import { LrclibClient, make, productionOptions, USER_AGENT } from "../src/lrclib-client.ts";
import { LrclibLyrics } from "../src/lyrics/lrclib.ts";
import type { LookupQuery } from "../src/media-backend.ts";
import { runProcess } from "../src/platform/node-process.ts";

const { values } = parseArgs({
  options: {
    sample: { type: "string", default: "100" },
    seed: { type: "string", default: "1" },
  },
});

const TrackPage = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      artist: Schema.String,
      album: Schema.String,
      durationMs: Schema.Finite,
    }),
  ),
  cursor: Schema.String,
  done: Schema.Boolean,
});

/** The `music` CLI could not list the library's songs. */
class CliFailed extends Schema.TaggedError<CliFailed>()("CliFailed", {
  stderr: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `The music CLI could not list songs: ${this.stderr.trim()}`;
  }
}

const decodePage = Schema.decodeUnknownSync(Schema.fromJsonString(TrackPage));

type Song = (typeof TrackPage.Type)["items"][number];

const cli = process.env["MUSIC_CLI"] ?? "music";

/** One page of the songs the CLI's login can read, by title. */
const songPage = (cursor: string | null) =>
  Effect.tryPromise({
    try: (signal) =>
      runProcess(
        cli,
        [
          "tracks",
          "list",
          "--json",
          "--limit",
          "200",
          ...(cursor === null ? [] : ["--cursor", cursor]),
        ],
        signal,
      ),
    catch: (cause) => new CliFailed({ stderr: "", cause }),
  }).pipe(
    Effect.filterOrFail(
      (result) => result.exitCode === 0,
      (result) => new CliFailed({ stderr: result.stderr, cause: null }),
    ),
    Effect.map((result) => decodePage(result.stdout)),
  );

/** Every song the CLI's login can read. */
const allSongs = (
  cursor: string | null,
  seen: ReadonlyArray<Song>,
): Effect.Effect<ReadonlyArray<Song>, CliFailed> =>
  songPage(cursor).pipe(
    Effect.flatMap((page) =>
      page.done
        ? Effect.succeed([...seen, ...page.items])
        : allSongs(page.cursor, [...seen, ...page.items]),
    ),
  );

/** A small seeded generator (mulberry32), so a sample can be drawn again. */
const seeded = (seed: number) => {
  let state = seed >>> 0;

  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const sampleOf = <A>(
  items: ReadonlyArray<A>,
  size: number,
  random: () => number,
): ReadonlyArray<A> =>
  items
    .map((item) => ({ item, order: random() }))
    .toSorted((left, right) => left.order - right.order)
    .slice(0, size)
    .map(({ item }) => item);

type Outcome =
  | "synced"
  | "plain"
  | "instrumental"
  | "miss"
  | "no tags"
  | "unreadable"
  | "unavailable";

const OUTCOMES: ReadonlyArray<Outcome> = [
  "synced",
  "plain",
  "instrumental",
  "miss",
  "no tags",
  "unreadable",
  "unavailable",
];

const queryOf = (song: Song): LookupQuery | null =>
  canLookUp(song) ? { ...song, durationS: Math.round(song.durationMs / 1000) } : null;

const outcomeOf = (lyrics: Option.Option<LrclibLyrics>): Outcome =>
  Option.match(lyrics, {
    onNone: (): Outcome => "miss",
    onSome: LrclibLyrics.$match({
      Found: ({ sets }): Outcome =>
        sets.some((set) => LyricBody.guards.Synced(set.body)) ? "synced" : "plain",
      Instrumental: (): Outcome => "instrumental",
      Empty: (): Outcome => "miss",
    }),
  });

const program = Effect.gen(function* () {
  const songs = yield* allSongs(null, []);
  const sample = sampleOf(songs, Number(values.sample), seeded(Number(values.seed)));
  const lrclib = yield* LrclibClient;

  const outcomes = yield* Effect.forEach(sample, (song) => {
    const query = queryOf(song);

    return query === null
      ? Effect.succeed({ song, outcome: "no tags" as const, failure: null })
      : lrclib.lookup(query).pipe(
          Effect.retry({ times: 3, while: Predicate.isTagged("LrclibUnavailable") }),
          Effect.map((lyrics) => ({ song, outcome: outcomeOf(lyrics), failure: null })),
          Effect.catchTags({
            LrclibUnavailable: (error) =>
              Effect.succeed({ song, outcome: "unavailable" as const, failure: error.message }),
            LrclibMalformed: (error) =>
              Effect.succeed({ song, outcome: "unreadable" as const, failure: error.message }),
          }),
        );
  });

  const percent = (count: number): string =>
    `${((100 * count) / Math.max(1, sample.length)).toFixed(1)}%`;

  const count = (outcome: Outcome): number =>
    outcomes.filter((each) => each.outcome === outcome).length;

  const found = count("synced") + count("plain") + count("instrumental");

  const lines = [
    `LRCLIB coverage of ${sample.length} songs sampled from ${songs.length} (seed ${values.seed})`,
    `User-Agent: ${USER_AGENT}`,
    "",
    ...OUTCOMES.map(
      (outcome) =>
        `${outcome.padEnd(13)}${String(count(outcome)).padStart(5)}  ${percent(count(outcome))}`,
    ),
    "",
    `any answer   ${String(found).padStart(5)}  ${percent(found)}`,
    "",
    "Unavailable or unreadable:",
    ...[
      ...Map.groupBy(
        outcomes.flatMap((each) => (each.failure === null ? [] : [each.failure])),
        (failure) => failure,
      ),
    ].map(([failure, all]) => `  ${failure}: ${all.length}`),
    "",
    "Misses:",
    ...outcomes
      .filter((each) => each.outcome === "miss")
      .map(
        ({ song }) =>
          `  ${song.artist} - ${song.title} (${song.album}, ${Math.round(song.durationMs / 1000)} s)`,
      ),
  ];

  yield* Effect.sync(() => {
    process.stdout.write(`${lines.join("\n")}\n`);
  });
});

await Effect.runPromise(
  program.pipe(
    Effect.provideServiceEffect(
      LrclibClient,
      make(productionOptions(process.env["LRCLIB_URL"] ?? "https://lrclib.net")),
    ),
  ),
);

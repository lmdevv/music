/**
 * `devices.reconcile` through the real dispatcher: a device that played without a connection
 * hands back its plays and, when it may, its queue.
 */
import { DeviceId, TrackId } from "@music/commands/ids";
import type { LibraryId } from "@music/commands/ids";
import type { OfflinePlay, OfflineResume } from "@music/commands/models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  allTracks,
  makeBackend,
  markMissing,
  seedLibrary,
  signUp,
  trackIds,
  upsertFiles,
} from "./backend";
import type { Backend, User } from "./backend";

const PHONE = DeviceId.make("listener-phone");

const LAPTOP = DeviceId.make("listener-laptop");

const HOST = DeviceId.make("host-laptop");

const START = 1_800_000_000_000;

/** Times songs started on the phone while it was offline, before it reconnected at `START`. */
const OFFLINE = [START - 900_000, START - 600_000, START - 300_000] as const;

interface Fixture {
  readonly backend: Backend;
  readonly owner: User;
  /** Someone who can read Rock and not Secret, with a phone and a laptop, autoplay off. */
  readonly listener: User;
  /** Five songs everyone can read, `Rock 0001` to `Rock 0005`. */
  readonly rock: ReadonlyArray<TrackId>;
  /** Two songs only the owner can read. */
  readonly secret: ReadonlyArray<TrackId>;
  readonly rockLibrary: LibraryId;
  readonly secretLibrary: LibraryId;
}

const setup = async (): Promise<Fixture> => {
  const backend = makeBackend();
  const owner = await signUp(backend, "owner");
  const listener = await signUp(backend, "member");
  const rockLibrary = await seedLibrary(backend, owner, { name: "Rock", count: 5 });

  const secretLibrary = await seedLibrary(backend, owner, {
    name: "Secret",
    count: 2,
    visibility: "private",
  });

  const tracks = await allTracks(owner);

  await listener.music.run("devices.heartbeat", { deviceId: PHONE, name: "Phone", kind: "phone" });
  await listener.music.run("devices.heartbeat", { deviceId: LAPTOP, name: "Laptop", kind: "web" });
  // Autoplay would add songs after a queue's last one; off, the queue is exactly what was sent.
  await listener.music.run("queue.autoplay", { on: false });

  return {
    backend,
    owner,
    listener,
    rock: trackIds(tracks, "Rock"),
    secret: trackIds(tracks, "Secret"),
    rockLibrary: rockLibrary.libraryId,
    secretLibrary: secretLibrary.libraryId,
  };
};

const at = (list: ReadonlyArray<TrackId>, position: number): TrackId => {
  const id = list[position];

  if (id === undefined) throw new Error(`No song at ${position}`);

  return id;
};

const reconcile = (
  user: User,
  plays: ReadonlyArray<OfflinePlay>,
  resume: OfflineResume | null,
  deviceId: DeviceId = PHONE,
) => user.music.run("devices.reconcile", { deviceId, plays, resume });

/** A device's offline queue, paused on its first song with shuffle and repeat off. */
const resumeOf = (
  songs: ReadonlyArray<TrackId>,
  overrides: Partial<OfflineResume> = {},
): OfflineResume => ({
  trackIds: songs,
  index: 0,
  positionMs: 0,
  playing: false,
  shuffle: false,
  repeat: "off",
  ...overrides,
});

/** The user's history, newest first, as each song and the time it played. */
const history = async (user: User) =>
  (await user.music.read("history.list", { limit: 200 })).map((entry) => ({
    trackId: entry.track.id,
    playedAt: entry.playedAt,
  }));

const queueIds = async (user: User): Promise<ReadonlyArray<TrackId>> =>
  (await user.music.read("queue.list", {})).queue.map((entry) => entry.id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("offline plays", () => {
  it("records each play at the time the device played it, once however often it is sent", async () => {
    const { listener, rock } = await setup();

    const plays = [
      { trackId: at(rock, 0), playedAt: OFFLINE[0] },
      { trackId: at(rock, 1), playedAt: OFFLINE[1] },
      // The batch lists one play twice.
      { trackId: at(rock, 1), playedAt: OFFLINE[1] },
      { trackId: at(rock, 0), playedAt: OFFLINE[2] },
    ];

    const recorded = [
      { trackId: at(rock, 0), playedAt: OFFLINE[2] },
      { trackId: at(rock, 1), playedAt: OFFLINE[1] },
      { trackId: at(rock, 0), playedAt: OFFLINE[0] },
    ];

    expect(await reconcile(listener, plays, null)).toEqual({ adopted: false });
    expect(await history(listener)).toEqual(recorded);

    // The answer was lost, so the device sends the same plays again.
    vi.setSystemTime(START + 5000);
    await reconcile(listener, plays, null);
    expect(await history(listener)).toEqual(recorded);
  });

  it("records the same play from another device as another play", async () => {
    const { listener, rock } = await setup();
    const play = { trackId: at(rock, 0), playedAt: OFFLINE[0] };

    await reconcile(listener, [play], null, PHONE);
    await reconcile(listener, [play], null, LAPTOP);

    expect(await history(listener)).toEqual([play, play]);
  });

  it("skips songs the user can't read and IDs that name no song, recording the rest", async () => {
    const { backend, owner, listener, rock, secret, secretLibrary } = await setup();
    const { libraryId } = await seedLibrary(backend, owner, { name: "Gone", count: 0 });
    await upsertFiles(backend, libraryId, [{ path: "gone.flac", title: "Gone" }]);
    const gone = at(trackIds(await allTracks(owner), "Gone"), 0);

    await backend.run(async (ctx) => {
      const id = ctx.db.normalizeId("tracks", gone);

      if (id !== null) await ctx.db.delete(id);
    });

    const result = await reconcile(
      listener,
      [
        { trackId: at(secret, 0), playedAt: OFFLINE[0] },
        { trackId: TrackId.make("not-a-song"), playedAt: OFFLINE[0] },
        { trackId: gone, playedAt: OFFLINE[1] },
        { trackId: at(rock, 2), playedAt: OFFLINE[2] },
      ],
      null,
    );

    expect(result).toEqual({ adopted: false });
    expect(await history(listener)).toEqual([{ trackId: at(rock, 2), playedAt: OFFLINE[2] }]);

    // Nothing was kept back for later either: letting them listen to Secret shows no play of it.
    await owner.music.run("libraries.update", { libraryId: secretLibrary, visibility: "shared" });
    expect(await history(listener)).toEqual([{ trackId: at(rock, 2), playedAt: OFFLINE[2] }]);
  });

  it("keeps showing a play reported live at the time it was reported", async () => {
    const { listener, rock } = await setup();
    await listener.music.run("playback.play", { trackIds: [...rock], deviceId: PHONE });
    await listener.music.run("playback.report", {
      deviceId: PHONE,
      index: 0,
      positionMs: 100,
      playing: true,
    });

    const [play] = await history(listener);

    expect(play?.trackId).toBe(at(rock, 0));
    expect(play?.playedAt).toBeGreaterThanOrEqual(START);
    expect(play?.playedAt).toBeLessThan(START + 1000);
  });
});

describe("handing the queue back", () => {
  it("adopts a paused device's queue while the server still names it active", async () => {
    const { listener, rock } = await setup();
    await listener.music.run("playback.play", { trackIds: [...rock], deviceId: PHONE });
    await listener.music.run("playback.pause", {});

    const songs = [at(rock, 4), at(rock, 3), at(rock, 2)];

    const result = await reconcile(
      listener,
      [{ trackId: at(rock, 4), playedAt: OFFLINE[0] }],
      resumeOf(songs, { index: 1, positionMs: 42_000, shuffle: true, repeat: "all" }),
    );

    const state = await listener.music.read("playback.state", {});

    expect(result).toEqual({ adopted: true });
    expect(state.queue.map((entry) => entry.id)).toEqual(songs);

    expect({
      index: state.index,
      positionMs: state.positionMs,
      playing: state.playing,
      shuffle: state.shuffle,
      repeat: state.repeat,
      activeDevice: state.activeDevice?.id,
    }).toEqual({
      index: 1,
      positionMs: 42_000,
      playing: false,
      shuffle: true,
      repeat: "all",
      activeDevice: PHONE,
    });
  });

  it("adopts a device that still plays although another device took over", async () => {
    const { listener, rock } = await setup();
    await listener.music.run("playback.play", { trackIds: [...rock], deviceId: PHONE });
    await listener.music.run("playback.transfer", { deviceId: LAPTOP });

    const result = await reconcile(
      listener,
      [],
      resumeOf([at(rock, 1), at(rock, 2)], { index: 1, positionMs: 9000, playing: true }),
    );

    const state = await listener.music.read("playback.state", {});

    expect(result).toEqual({ adopted: true });
    expect(state.queue.map((entry) => entry.id)).toEqual([at(rock, 1), at(rock, 2)]);
    expect(state.index).toBe(1);
    expect(state.playing).toBe(true);
    expect(state.positionMs).toBe(9000);
    expect(state.activeDevice?.id).toBe(PHONE);
  });

  it("leaves playback to the device that took over when this one is paused", async () => {
    const { listener, rock } = await setup();
    await listener.music.run("playback.play", { trackIds: [...rock], deviceId: PHONE });
    await listener.music.run("playback.transfer", { deviceId: LAPTOP });
    const before = await listener.music.read("playback.state", {});
    const play = { trackId: at(rock, 4), playedAt: OFFLINE[0] };

    const result = await reconcile(
      listener,
      [play],
      resumeOf([at(rock, 4)], { positionMs: 30_000 }),
    );

    expect(result).toEqual({ adopted: false });
    expect(await listener.music.read("playback.state", {})).toEqual(before);
    expect(before.activeDevice?.id).toBe(LAPTOP);
    expect(await history(listener)).toEqual([play]);
  });

  it("never adopts without a queue to resume", async () => {
    const { listener, rock } = await setup();
    await listener.music.run("playback.play", { trackIds: [...rock], deviceId: PHONE });
    const before = await listener.music.read("playback.state", {});

    expect(await reconcile(listener, [], null)).toEqual({ adopted: false });
    expect(await listener.music.read("playback.state", {})).toEqual(before);
  });

  it("never adopts for a device that is not registered", async () => {
    const { listener, rock } = await setup();
    await listener.music.run("playback.play", { trackIds: [...rock], deviceId: PHONE });
    const before = await listener.music.read("playback.state", {});

    const result = await reconcile(
      listener,
      [],
      resumeOf([at(rock, 2)], { playing: true }),
      DeviceId.make("never-seen"),
    );

    expect(result).toEqual({ adopted: false });
    expect(await listener.music.read("playback.state", {})).toEqual(before);
  });

  it("drops songs that can't play and moves to the next one kept", async () => {
    const { backend, rockLibrary, listener, rock, secret } = await setup();
    await listener.music.run("playback.play", { trackIds: [...rock], deviceId: PHONE });
    await markMissing(backend, rockLibrary, ["Rock/0002.flac"]);

    // The phone was on the private song: the next one it may play is Rock 0003.
    const result = await reconcile(
      listener,
      [],
      resumeOf([at(rock, 0), at(secret, 0), at(rock, 1), at(rock, 2)], { index: 1 }),
    );

    const state = await listener.music.read("playback.state", {});

    expect(result).toEqual({ adopted: true });
    expect(state.queue.map((entry) => entry.id)).toEqual([at(rock, 0), at(rock, 2)]);
    expect(state.index).toBe(1);
  });

  it("never adopts a queue none of whose songs can play", async () => {
    const { listener, rock, secret } = await setup();
    await listener.music.run("playback.play", { trackIds: [...rock], deviceId: PHONE });
    const before = await listener.music.read("playback.state", {});

    const result = await reconcile(
      listener,
      [],
      resumeOf([at(secret, 0), TrackId.make("not-a-song")], { playing: true }),
    );

    expect(result).toEqual({ adopted: false });
    expect(await listener.music.read("playback.state", {})).toEqual(before);
  });

  it("counts the current song once, offline, and not again on the device's next report", async () => {
    const { listener, rock } = await setup();
    await listener.music.run("playback.play", { trackIds: [...rock], deviceId: PHONE });
    const offline = { trackId: at(rock, 2), playedAt: OFFLINE[2] };

    await reconcile(
      listener,
      [offline],
      resumeOf([at(rock, 2), at(rock, 3)], { positionMs: 60_000, playing: true }),
    );

    vi.setSystemTime(START + 5000);

    await listener.music.run("playback.report", {
      deviceId: PHONE,
      index: 0,
      trackId: at(rock, 2),
      positionMs: 65_000,
      playing: true,
    });

    expect(await history(listener)).toEqual([offline]);

    // The next song is a new play, as usual.
    vi.setSystemTime(START + 125_000);

    await listener.music.run("playback.report", {
      deviceId: PHONE,
      index: 1,
      trackId: at(rock, 3),
      positionMs: 100,
      playing: true,
    });

    expect((await history(listener)).map((play) => play.trackId)).toEqual([
      at(rock, 3),
      at(rock, 2),
    ]);
  });
});

describe("in a Jam", () => {
  it("records a member's plays but never hands the host's playback to them", async () => {
    const { owner, listener, rock } = await setup();
    await owner.music.run("devices.heartbeat", { deviceId: HOST, name: "Laptop", kind: "web" });
    await owner.music.run("playback.play", { trackIds: rock.slice(0, 3), deviceId: HOST });
    const { code } = await owner.music.run("jam.start", {});
    await listener.music.run("jam.join", { code });
    const host = await owner.music.read("playback.state", {});
    const play = { trackId: at(rock, 4), playedAt: OFFLINE[0] };

    const result = await reconcile(
      listener,
      [play],
      resumeOf([at(rock, 4)], { positionMs: 5000, playing: true }),
    );

    expect(result).toEqual({ adopted: false });
    expect(await owner.music.read("playback.state", {})).toEqual(host);
    expect(await queueIds(listener)).toEqual(rock.slice(0, 3));
    expect(await history(listener)).toEqual([play]);
  });
});

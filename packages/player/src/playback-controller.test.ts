import { AlbumId, ArtistId, DeviceId, TrackId } from "@music/commands/ids";
import type { PlaybackState, Track } from "@music/commands/models";
import { makeMusicClient } from "@music/sdk/client";
import type { CommandTransport } from "@music/sdk/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineEvent, PlayerEngine } from "./engine";
import { PlaybackController } from "./playback-controller";

const deviceId = DeviceId.make("this-browser");

const song: Track = {
  id: TrackId.make("song"),
  title: "Song",
  artist: "Artist",
  artistId: ArtistId.make("artist"),
  album: "Album",
  albumId: AlbumId.make("album"),
  trackNumber: null,
  discNumber: null,
  durationMs: 200_000,
  codec: "AAC",
  lossless: false,
  bitrate: null,
  sampleRate: null,
  bitDepth: null,
  artUrl: null,
  liked: false,
};

const session = (playing: boolean, updatedAt: number): PlaybackState => ({
  activeDevice: { id: deviceId, name: "Test", kind: "web", lastSeenAt: 0, online: true },
  queue: [song],
  index: 0,
  positionMs: 0,
  playing,
  updatedAt,
  shuffle: false,
  repeat: "off",
  volume: 1,
});

interface Mutation {
  readonly name: string;
  readonly args: unknown;
}

/** An engine that reports `playing` and `paused` as soon as it is told to play or pause. */
const instantEngine = (): PlayerEngine => {
  const listeners = new Set<(event: EngineEvent) => void>();
  const emit = (event: EngineEvent): void => listeners.forEach((listener) => listener(event));

  return {
    load: async (_source, _startMs, autoplay) => {
      if (autoplay) emit({ type: "playing" });
    },
    preload: () => {},
    play: async () => emit({ type: "playing" }),
    pause: () => emit({ type: "paused" }),
    seek: () => {},
    setVolume: () => {},
    unload: () => {},
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
};

/** A Convex transport that records every mutation and answers like the server. */
const recordingTransport = (mutations: Array<Mutation>): CommandTransport => ({
  query: async () => ({
    trackId: song.id,
    url: "http://media.test/song",
    profile: "aac-320",
    expiresAt: 0,
  }),
  mutation: async (_reference, { name, args }) => {
    mutations.push({ name, args });

    return { ok: true };
  },
});

const reports = (mutations: ReadonlyArray<Mutation>): ReadonlyArray<unknown> =>
  mutations.flatMap(({ name, args }) => (name === "playback.report" ? [args] : []));

describe("PlaybackController", () => {
  beforeEach(() => {
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not report a pause that a session snapshot ordered", async () => {
    const mutations: Array<Mutation> = [];

    const controller = new PlaybackController(
      makeMusicClient(recordingTransport(mutations)),
      { mse: null, create: instantEngine },
      {
        deviceId,
        device: { name: "Test", kind: "web" },
        canPlay: () => true,
        now: () => 1000,
        quality: "high",
        saveQuality: () => {},
      },
    );

    const stop = controller.start();
    controller.sync(session(true, 1));
    await vi.waitFor(() => expect(controller.getSnapshot().engineStatus).toBe("playing"));
    const before = reports(mutations).length;

    // A stale snapshot from an earlier Pause arrives after the user pressed Play again.
    controller.sync(session(false, 2));

    expect(controller.getSnapshot().engineStatus).toBe("paused");
    await Promise.resolve();
    expect(reports(mutations).slice(before)).toStrictEqual([]);
    stop();
  });
});

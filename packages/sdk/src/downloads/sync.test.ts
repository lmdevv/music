import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AlbumId,
  ArtistId,
  DeviceId,
  DownloadPinId,
  PlaylistId,
  TrackId,
} from "@music/commands/ids";
import type { DownloadManifest, DownloadPin, OfflineTrack } from "@music/commands/models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeMusicClient } from "../client";
import type { CommandTransport } from "../client";
import { FakeMedia, recordingTransport } from "./fake-media";
import type { Mutation } from "./fake-media";
import { nodeTransfer } from "./node-transfer";
import type { StoredCopy, VaultView } from "./plan";
import { downloadStatus, trackDownloadState } from "./status";
import { DownloadSync } from "./sync";
import { applyChange, emptyVault } from "./vault";
import type { VaultChange, VaultStore } from "./vault";

/** A vault whose rows live in memory and whose files live in a real directory. */
class DirectoryVault implements VaultStore {
  view: VaultView;
  free: number | null = 64 * 1024 ** 3;
  readonly #dir: string;

  constructor(dir: string, view: VaultView = emptyVault) {
    this.#dir = dir;
    this.view = view;
  }

  load = (): Promise<VaultView> => Promise.resolve(this.view);

  commit = (change: VaultChange): Promise<void> => {
    this.view = applyChange(this.view, change);

    return Promise.resolve();
  };

  files = async (): Promise<ReadonlyArray<string>> => {
    const names = await readdir(this.#dir, { recursive: true, withFileTypes: true });

    return names
      .values()
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(this.#dir.length + 1))
      .toArray();
  };

  uri = (file: string): string => join(this.#dir, file);

  remove = (file: string): Promise<void> => rm(join(this.#dir, file), { force: true });

  freeBytes = (): number | null => this.free;
}

const song = (id: string, title: string): OfflineTrack => ({
  id: TrackId.make(id),
  title,
  artist: "Massive Attack",
  artistId: ArtistId.make("artist"),
  album: "Blue Lines",
  albumId: AlbumId.make("blue-lines"),
  trackNumber: 1,
  discNumber: 1,
  durationMs: 1000,
  codec: "FLAC",
  lossless: true,
  bitrate: null,
  sampleRate: null,
  bitDepth: null,
  artUrl: "/media/art/cover",
});

const ALBUM: DownloadPin = {
  id: DownloadPinId.make("pin"),
  deviceId: DeviceId.make("phone"),
  target: { kind: "album", id: AlbumId.make("blue-lines") },
  createdAt: 1,
  available: true,
  title: "Blue Lines",
  subtitle: "Massive Attack",
  artUrl: "/media/art/cover",
  artHash: "cover",
};

/** How long a sync may take to settle: real HTTP and files, while other suites load the machine. */
const SETTLE = { timeout: 10_000 };

const SAFE = song("t1", "Safe from Harm");

const UNFINISHED = song("t2", "Unfinished Sympathy");

const MANIFEST: DownloadManifest = {
  pin: ALBUM,
  entries: [
    { track: SAFE, rev: "r1", artHash: "cover", state: "fetchable" },
    { track: UNFINISHED, rev: "r1", artHash: "cover", state: "fetchable" },
  ],
};

let media: FakeMedia;

let base: string;

let dir: string;

let mutations: Array<Mutation>;

let stops: Array<() => void>;

beforeEach(async () => {
  media = new FakeMedia();
  base = await media.listen();
  dir = await mkdtemp(join(tmpdir(), "download-sync-"));
  mutations = [];
  stops = [];
  media.serve("/media/stream/t1", "safe from harm");
  media.serve("/media/stream/t2", "unfinished sympathy", { preparing: 1 });
  media.serve("/media/art/cover", "jpeg", { contentType: "image/jpeg" });
});

afterEach(async () => {
  for (const stop of stops) stop();
  await media.close();
  await rm(dir, { recursive: true, force: true });
});

const transport = (): CommandTransport => recordingTransport(mutations);

const started = (vault: VaultStore): DownloadSync => {
  const sync = new DownloadSync({
    client: makeMusicClient(transport()),
    vault,
    transfer: nodeTransfer,
    deviceId: DeviceId.make("phone"),
    policy: () => ({ profileFor: () => "aac-320" }),
    resolveUrl: (url) => `${base}${url}`,
    now: Date.now,
    sleep: () => Promise.resolve(),
  });

  stops.push(sync.start());

  return sync;
};

const exists = async (file: string): Promise<boolean> =>
  stat(join(dir, file)).then(
    () => true,
    () => false,
  );

describe("DownloadSync", () => {
  it("keeps an album's songs and cover on the device once the server lists it", async () => {
    const vault = new DirectoryVault(dir);
    const sync = started(vault);
    sync.setOnline(true);
    sync.offerPins([ALBUM]);
    sync.offerManifest(ALBUM.id, MANIFEST);

    await vi.waitFor(() => {
      expect(downloadStatus(sync.getSnapshot(), ALBUM.target)).toEqual({
        kind: "downloaded",
        bytes: 33,
      });
    }, SETTLE);

    expect(await exists("audio/t1.r1.aac-320.m4a")).toBe(true);
    expect(await exists("audio/t2.r1.aac-320.m4a")).toBe(true);

    expect(sync.localCopy(SAFE.id)).toEqual({
      track: SAFE,
      uri: join(dir, "audio/t1.r1.aac-320.m4a"),
      profile: "aac-320",
      bytes: 14,
      artUri: join(dir, "art/cover"),
    });

    expect(downloadStatus(sync.getSnapshot(), { kind: "track", id: SAFE.id })).toEqual({
      kind: "included",
      by: { kind: "album", title: "Blue Lines" },
    });
  });

  it("deletes the files of a removed download at once and tells the server", async () => {
    const vault = new DirectoryVault(dir);
    const sync = started(vault);
    sync.setOnline(true);
    sync.offerPins([ALBUM]);
    sync.offerManifest(ALBUM.id, MANIFEST);

    await vi.waitFor(() => {
      expect(trackDownloadState(sync.getSnapshot(), UNFINISHED.id)).toBe("downloaded");
    }, SETTLE);

    sync.remove(ALBUM.target);

    await vi.waitFor(async () => {
      expect(await exists("audio/t1.r1.aac-320.m4a")).toBe(false);
    }, SETTLE);

    expect(await exists("art/cover")).toBe(false);
    expect(downloadStatus(sync.getSnapshot(), ALBUM.target)).toEqual({ kind: "none" });

    expect(mutations).toContainEqual({
      name: "downloads.remove",
      args: { deviceId: "phone", kind: "album", id: "blue-lines" },
    });

    sync.offerPins([]);

    await vi.waitFor(() => {
      expect(vault.view.pins.size).toBe(0);
    }, SETTLE);
  });

  it("sweeps rows whose file is gone and files no row names when it starts", async () => {
    const lost: StoredCopy = {
      track: SAFE,
      rev: "r1",
      profile: "aac-320",
      file: "audio/t1.r1.aac-320.m4a",
      bytes: 14,
      artHash: null,
    };

    await mkdir(join(dir, "audio"), { recursive: true });
    await writeFile(join(dir, "audio/stray.m4a"), "half a song");
    const vault = new DirectoryVault(dir, { ...emptyVault, copies: new Map([[SAFE.id, lost]]) });
    const sync = started(vault);

    await vi.waitFor(() => {
      expect(sync.getSnapshot().ready).toBe(true);
    }, SETTLE);

    expect(vault.view.copies.size).toBe(0);
    expect(await exists("audio/stray.m4a")).toBe(false);
  });

  it("reports songs that failed and fetches them again on retry", async () => {
    media.serve("/media/stream/t1", "safe from harm", { refusals: [500, 500] });
    const vault = new DirectoryVault(dir);
    const sync = started(vault);
    sync.setOnline(true);
    sync.offerPins([ALBUM]);
    sync.offerManifest(ALBUM.id, MANIFEST);

    await vi.waitFor(() => {
      expect(downloadStatus(sync.getSnapshot(), ALBUM.target)).toEqual({
        kind: "failed",
        failed: 1,
        total: 2,
      });
    }, SETTLE);

    media.serve("/media/stream/t1", "safe from harm");
    sync.retry(ALBUM.target);

    await vi.waitFor(() => {
      expect(downloadStatus(sync.getSnapshot(), ALBUM.target)).toMatchObject({
        kind: "downloaded",
      });
    }, SETTLE);
  });

  it("waits without fetching while the server doesn't answer", async () => {
    const sync = started(new DirectoryVault(dir));
    sync.offerPins([ALBUM]);
    sync.offerManifest(ALBUM.id, MANIFEST);

    await vi.waitFor(() => {
      expect(downloadStatus(sync.getSnapshot(), ALBUM.target)).toEqual({
        kind: "waiting",
        reason: "offline",
      });
    }, SETTLE);

    expect(media.seen).toEqual([]);
  });

  it("asks the server to download a target to this device", async () => {
    const sync = started(new DirectoryVault(dir));
    await sync.request({ kind: "playlist", id: PlaylistId.make("late-night") });

    expect(mutations).toEqual([
      { name: "downloads.add", args: { deviceId: "phone", kind: "playlist", id: "late-night" } },
    ]);
  });
});

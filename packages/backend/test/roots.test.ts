/**
 * Library folders: the real-folder claims that keep two libraries off the same files whatever
 * their paths say, who may remove a library, and what an overlap error may reveal.
 */
import { type LibraryId, UserId } from "@music/commands/ids";
import { describe, expect, it } from "vitest";

import { api } from "../convex/_generated/api";
import { MEDIA_SECRET, makeBackend, signUp } from "./backend";
import type { Backend } from "./backend";
import { failure, failureCode } from "./harness";

const OVERLAP =
  "This folder is the same as, inside, or around another library's folder (through a link or a " +
  "mount), so it was not scanned. Add a folder that holds only this library's music.";

const claim = async (backend: Backend, libraryId: LibraryId, realPath: string) => {
  const id = await backend.run(async (ctx) => ctx.db.normalizeId("libraries", libraryId));

  if (id === null) throw new Error(`${libraryId} is not a library`);

  return backend.mutation(api.media.claimRoot, { secret: MEDIA_SECRET, libraryId: id, realPath });
};

describe("real folder claims", () => {
  it("refuse a folder that is, sits inside, or holds another library's, by any name", async () => {
    const backend = makeBackend();
    const owner = await signUp(backend, "owner");
    const admin = await signUp(backend, "admin");

    const kept = await owner.music.run("libraries.create", {
      name: "Kept",
      path: "/srv/x/owner-private",
      visibility: "private",
    });

    // Not claimed yet: its added path still counts.
    const legacy = await owner.music.run("libraries.create", { name: "Old", path: "/data/old" });

    expect(await claim(backend, kept.libraryId, "/srv/x/owner-private")).toEqual({ ok: true });

    // A link elsewhere whose text says nothing of /srv/x.
    const alias = await admin.music.run("libraries.create", { name: "Alias", path: "/home/link" });

    const overlapping = await Promise.all(
      ["/srv/x", "/srv/x/owner-private", "/srv/x/owner-private/a", "/data/old"].map((real) =>
        claim(backend, alias.libraryId, real),
      ),
    );

    expect(overlapping).toEqual(Array.from({ length: 4 }, () => ({ ok: false, error: OVERLAP })));

    const system = await Promise.all(
      ["/proc/1/root", "/sys", "/dev/shm"].map((real) => claim(backend, alias.libraryId, real)),
    );

    expect(system.map((result) => result.ok)).toEqual([false, false, false]);

    // Nothing was stored for the refused claims; a folder of its own is fine, and claiming it
    // again is too.
    expect(await claim(backend, alias.libraryId, "/srv/y")).toEqual({ ok: true });
    expect(await claim(backend, alias.libraryId, "/srv/y")).toEqual({ ok: true });
    expect(await claim(backend, legacy.libraryId, "/data/old")).toEqual({ ok: true });

    const stored = await backend.run(async (ctx) =>
      (await ctx.db.query("libraries").collect()).map((library) => library.realPath ?? null),
    );

    expect(stored.toSorted((left, right) => String(left).localeCompare(String(right)))).toEqual([
      "/data/old",
      "/srv/x/owner-private",
      "/srv/y",
    ]);
  });

  it("refuse /proc, /sys, and /dev when a library is added", async () => {
    const backend = makeBackend();
    const owner = await signUp(backend, "owner");

    const codes = await Promise.all(
      ["/proc/self/root/srv/music", "/sys/x", "/dev/shm/music"].map((path) =>
        failureCode(owner.music.run("libraries.create", { name: "Sys", path })),
      ),
    );

    expect(codes).toEqual(["invalid_args", "invalid_args", "invalid_args"]);
  });
});

describe("removing and overlapping libraries", () => {
  it("lets only a library's owner or the server's owner remove it", async () => {
    const backend = makeBackend();
    const owner = await signUp(backend, "owner");
    const admin = await signUp(backend, "admin");

    const { libraryId } = await owner.music.run("libraries.create", {
      name: "Shared with you",
      path: "/music/shared-with-you",
      visibility: "restricted",
    });

    await owner.music.run("libraries.grant", { libraryId, userId: UserId.make(admin.id) });

    // The admin hears it, so may rename and rescan it, but not remove it and re-add its folder.
    expect(await failureCode(admin.music.run("libraries.update", { libraryId, name: "R" }))).toBe(
      "succeeded",
    );
    expect(await failureCode(admin.music.run("libraries.scan", { libraryId }))).toBe("succeeded");
    expect(await failureCode(admin.music.run("libraries.delete", { libraryId }))).toBe("forbidden");

    const own = await admin.music.run("libraries.create", { name: "Own", path: "/music/own" });

    expect(
      await failureCode(admin.music.run("libraries.delete", { libraryId: own.libraryId })),
    ).toBe("succeeded");
    expect(await failureCode(owner.music.run("libraries.delete", { libraryId }))).toBe("succeeded");
  });

  it("names no folder of a library the viewer can't hear in an overlap error", async () => {
    const backend = makeBackend();
    const owner = await signUp(backend, "owner");
    const admin = await signUp(backend, "admin");

    await owner.music.run("libraries.create", {
      name: "Hidden",
      path: "/srv/hidden/music",
      visibility: "private",
    });

    const attempts = await Promise.all(
      ["/srv/hidden", "/srv/hidden/music", "/srv/hidden/music/a"].map((path) =>
        failure(admin.music.run("libraries.create", { name: "Probe", path })),
      ),
    );

    expect(attempts).toEqual(
      Array.from({ length: 3 }, () => ({
        code: "conflict",
        message: "This folder overlaps another library",
      })),
    );
  });
});

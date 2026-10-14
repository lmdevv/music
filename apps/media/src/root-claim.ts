/**
 * Claims a library's real folder before a scan reads it. A link or a bind mount can give one
 * folder two names (`/proc/self/root/srv/music` is `/srv/music`), so Convex's check of the path a
 * library was added with is not enough to keep two libraries off the same files. The service
 * resolves the folder through every link, refuses one outside the allowed roots (`MUSIC_ROOTS`)
 * or in /proc, /sys, or /dev, and reports it to Convex (`media:claimRoot`) with the identity of
 * the folder and each one above it, which a bind mount can't change. Convex refuses a folder that
 * overlaps another library's by path or by identity. Nothing is indexed unless the claim
 * succeeds, and a refusal stops the library streaming; it runs again at every scan, since a
 * link's target can change.
 */
import type { LibraryId } from "@music/commands/ids";
import { isSystemFolder, SYSTEM_FOLDER_MESSAGE } from "@music/commands/system-folders";
import { Effect, Schema } from "effect";

import * as Files from "./files.ts";
import { MediaBackend } from "./media-backend.ts";
import { MediaConfig } from "./media-config.ts";
import * as NodeFiles from "./platform/node-files.ts";

/** The library's folder may not be scanned. The message is safe to show on the job. */
class RootRefused extends Schema.TaggedError<RootRefused>()("RootRefused", {
  libraryId: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

/**
 * Resolves the library's folder, checks it, and claims it with Convex. Returns the real folder,
 * which the scan then reads instead of the path the library was added with. Fails with
 * `FileError` when the folder does not resolve, and with `RootRefused` when it may not be read.
 */
export const claimRoot = Effect.fn("RootClaim.claim")(function* (library: {
  readonly id: LibraryId;
  readonly path: string;
}) {
  const backend = yield* MediaBackend;
  const { musicRoots } = yield* MediaConfig;

  // Refused here, before Convex sees it: drop any earlier claim too, so it stops streaming.
  const refuse = (reason: string) =>
    backend
      .refuseRoot(library.id)
      .pipe(Effect.andThen(Effect.fail(new RootRefused({ libraryId: library.id, reason }))));

  if (isSystemFolder(library.path)) return yield* refuse(SYSTEM_FOLDER_MESSAGE);

  const real = yield* Files.realPath(library.path);

  if (isSystemFolder(real)) return yield* refuse(SYSTEM_FOLDER_MESSAGE);

  if (musicRoots !== null) {
    // The allowed roots resolve too, so a root that is itself a link still allows its target.
    const roots = yield* Effect.forEach(musicRoots, (root) =>
      Files.realPath(root).pipe(Effect.orElseSucceed(() => root)),
    );

    if (!roots.some((root) => real === root || NodeFiles.isWithin(root, real))) {
      return yield* refuse(
        `Library folders must be inside ${musicRoots.join(" or ")} (MUSIC_ROOTS)`,
      );
    }
  }

  const rootIds = yield* Files.folderIds(real);
  const claim = yield* backend.claimRoot(library.id, real, rootIds);

  if (!claim.ok) return yield* new RootRefused({ libraryId: library.id, reason: claim.error });

  return real;
});

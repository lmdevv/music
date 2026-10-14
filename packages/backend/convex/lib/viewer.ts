import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import type { Role } from "@music/commands/models";
import { can } from "@music/commands/permissions";

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { fail } from "./errors";
import { tableId } from "./ids";
import { isStale } from "./sessions";

export type ReadCtx = Pick<QueryCtx, "db" | "auth">;

/** The signed-in user and the libraries they may read. */
export interface Viewer {
  readonly id: Id<"users">;
  readonly user: Doc<"users">;
  readonly role: Role;
  readonly libraries: ReadonlyArray<Doc<"libraries">>;
  readonly libraryIds: ReadonlySet<Id<"libraries">>;
  /**
   * Whether the viewer reads every library on the server, so a list can page one index over all
   * of them instead of one range per library they read.
   */
  readonly readsEveryLibrary: boolean;
}

/** A stored user's role; accounts from before roles were stored are members. */
export const roleOf = (user: Doc<"users">): Role => user.role ?? "member";

/**
 * Whether someone can listen to a library: its owner always; others by its visibility, where
 * `shared` lets in everyone but guests and the access list (`granted`) adds people to `shared`
 * and `restricted` libraries.
 */
export const canListen = (
  library: Doc<"libraries">,
  userId: Id<"users">,
  role: Role,
  granted: boolean,
): boolean => {
  if (library.ownerId === userId) return true;

  if (library.visibility === "private") return false;

  return granted || (library.visibility === "shared" && role !== "guest");
};

/**
 * Every library on the server, and the ones `user` can listen to. A server has a handful of
 * libraries, and a person holds at most one grant per library (`libraries.grant` adds none twice
 * and a removed library takes its grants with it), so both reads stay that small.
 */
export const listenable = async (
  ctx: ReadCtx,
  user: Doc<"users">,
): Promise<{
  readonly all: ReadonlyArray<Doc<"libraries">>;
  readonly libraries: ReadonlyArray<Doc<"libraries">>;
}> => {
  const all = await ctx.db.query("libraries").collect();

  const grants = await ctx.db
    .query("libraryAccess")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .take(all.length);

  const granted = new Set(grants.map((grant) => grant.libraryId));
  const role = roleOf(user);

  return {
    all,
    libraries: all.filter((library) =>
      canListen(library, user._id, role, granted.has(library._id)),
    ),
  };
};

/**
 * Whether `target` can listen to a library `actor` cannot. Whoever can take over `target`'s
 * account (with a password reset link) would hear it, so only the owner may then.
 */
export const listensBeyond = async (
  ctx: ReadCtx,
  actor: Doc<"users">,
  target: Doc<"users">,
): Promise<boolean> => {
  const [mine, theirs] = await Promise.all([listenable(ctx, actor), listenable(ctx, target)]);
  const readable = new Set(mine.libraries.map((library) => library._id));

  return theirs.libraries.some((library) => !readable.has(library._id));
};

/** The suspended-account message sign-in, API keys, and open sessions all show. */
export const SUSPENDED_MESSAGE = "This account is suspended. Ask an admin on this server.";

/** Loads the viewer or fails with `unauthenticated`. */
export const loadViewer = async (ctx: ReadCtx): Promise<Viewer> => {
  const userId = await getAuthUserId(ctx);

  if (userId === null) return fail("unauthenticated", "Sign in first");
  // A token outlives sign-out and key revocation by up to its one-hour lifetime unless the
  // session it names is checked here; ending a session must end its tokens at once.
  const sessionId = ctx.db.normalizeId("authSessions", (await getAuthSessionId(ctx)) ?? "");
  const session = sessionId === null ? null : await ctx.db.get(sessionId);

  if (session === null || session.userId !== userId) {
    return fail("unauthenticated", "This session has ended; sign in again");
  }

  const user = await ctx.db.get(userId);

  if (user === null) return fail("unauthenticated", "This account no longer exists");

  if (isStale(session, user)) {
    return fail("unauthenticated", "This session has ended; sign in again");
  }

  // Suspending ends every session, so this only catches a sign-in racing the suspension.
  if (user.suspendedAt !== undefined) return fail("unauthenticated", SUSPENDED_MESSAGE);

  const { all, libraries } = await listenable(ctx, user);

  return {
    id: userId,
    user,
    role: roleOf(user),
    libraries,
    libraryIds: new Set(libraries.map((library) => library._id)),
    readsEveryLibrary: libraries.length === all.length,
  };
};

/** Checks that the viewer can read a library-owned document. */
export const canRead = (viewer: Viewer, libraryId: Id<"libraries">): boolean =>
  viewer.libraryIds.has(libraryId);

/**
 * Checks that the viewer can manage a library: admins rename, rescan, and remove every library,
 * and see that it exists, whether or not they may listen to it. Who may listen is the library
 * owner's alone to change (`canChangeLibraryAccess`).
 */
export const canManage = (viewer: Viewer): boolean => can(viewer.role, "admin");

/** A person by wire ID, or a `not_found` failure. */
export const loadPerson = async (ctx: ReadCtx, id: string): Promise<Doc<"users">> =>
  (await ctx.db.get(tableId(ctx, "users", id))) ?? fail("not_found", "Person not found");

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

  const role = roleOf(user);

  // A server has a handful of libraries, and a person is on a handful of access lists.
  const [all, grants] = await Promise.all([
    ctx.db.query("libraries").collect(),
    ctx.db
      .query("libraryAccess")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  ]);

  const granted = new Set(grants.map((grant) => grant.libraryId));

  const libraries = all.filter((library) =>
    canListen(library, userId, role, granted.has(library._id)),
  );

  return {
    id: userId,
    user,
    role,
    libraries,
    libraryIds: new Set(libraries.map((library) => library._id)),
  };
};

/** Checks that the viewer can read a library-owned document. */
export const canRead = (viewer: Viewer, libraryId: Id<"libraries">): boolean =>
  viewer.libraryIds.has(libraryId);

/**
 * Checks that the viewer can manage a library: admins manage every shared and restricted library,
 * listening or not. A private library stays its owner's alone while the owner is an admin who can
 * manage it; once they are not (demoted, or it was made private for a member), any admin can, so
 * no library is ever left without someone to manage it.
 */
export const canManage = async (
  ctx: ReadCtx,
  viewer: Viewer,
  library: Doc<"libraries">,
): Promise<boolean> => {
  if (!can(viewer.role, "admin")) return false;

  if (library.visibility !== "private" || library.ownerId === viewer.id) return true;
  const owner = await ctx.db.get(library.ownerId);

  return owner === null || !can(roleOf(owner), "admin");
};

/** A person by wire ID, or a `not_found` failure. */
export const loadPerson = async (ctx: ReadCtx, id: string): Promise<Doc<"users">> =>
  (await ctx.db.get(tableId(ctx, "users", id))) ?? fail("not_found", "Person not found");

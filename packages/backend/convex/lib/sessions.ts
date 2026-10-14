import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Deletes an auth session and its refresh tokens, as Convex Auth's sign-out does. Tokens already
 * issued for it stop working at once, because `loadViewer` requires the session to exist.
 */
export const endSession = async (
  ctx: MutationCtx,
  sessionId: Id<"authSessions">,
): Promise<void> => {
  const refreshTokens = await ctx.db
    .query("authRefreshTokens")
    .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
    .collect();

  await Promise.all(refreshTokens.map((token) => ctx.db.delete(token._id)));

  if ((await ctx.db.get(sessionId)) !== null) await ctx.db.delete(sessionId);
};

/**
 * Ends every session a person has, password and API key alike, at once and in constant work:
 * sessions created before now stop counting (`users.sessionsValidAfter`, checked by
 * `loadViewer`), and their rows are purged in scheduled batches. A person can sign in any number
 * of times, so deleting them all here could exceed a mutation's limits and block the suspension.
 */
export const endUserSessions = async (ctx: MutationCtx, userId: Id<"users">): Promise<void> => {
  const now = Date.now();

  if ((await ctx.db.get(userId)) !== null) await ctx.db.patch(userId, { sessionsValidAfter: now });

  await ctx.scheduler.runAfter(0, internal.people.purgeSessions, { userId, before: now });
};

/** Whether a session was ended by `endUserSessions` but its row is not purged yet. */
export const isStale = (session: Doc<"authSessions">, user: Doc<"users">): boolean =>
  user.sessionsValidAfter !== undefined && session._creationTime < user.sessionsValidAfter;

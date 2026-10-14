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
  // Reading the person's newest session puts the end of their session range in this mutation's
  // read set, so a sign-in committing meanwhile makes it retry rather than slip past the cutoff.
  // The cutoff then covers every session that exists, including one created this millisecond;
  // anything created after this commits has a later creation time.
  const newest = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .order("desc")
    .first();

  const cutoff = Math.max(Date.now(), newest?._creationTime ?? 0);

  if ((await ctx.db.get(userId)) !== null) {
    await ctx.db.patch(userId, { sessionsValidAfter: cutoff });
  }

  await ctx.scheduler.runAfter(0, internal.people.purgeSessions, { userId, before: cutoff });
};

/** Whether a session was ended by `endUserSessions` but its row is not purged yet. */
export const isStale = (session: Doc<"authSessions">, user: Doc<"users">): boolean =>
  user.sessionsValidAfter !== undefined && session._creationTime <= user.sessionsValidAfter;

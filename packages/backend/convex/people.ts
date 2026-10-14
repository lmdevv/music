import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const PURGE_BATCH = 200;

/**
 * Deletes a person's sessions created before `before`, with their refresh tokens, a bounded batch
 * at a time. `endUserSessions` has already made them stop counting.
 */
export const purgeSessions = internalMutation({
  args: { userId: v.id("users"), before: v.number() },
  handler: async (ctx, { userId, before }) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId).lt("_creationTime", before))
      .first();

    if (session === null) return;

    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
      .take(PURGE_BATCH);

    await Promise.all(tokens.map((token) => ctx.db.delete(token._id)));

    if (tokens.length < PURGE_BATCH) await ctx.db.delete(session._id);

    await ctx.scheduler.runAfter(0, internal.people.purgeSessions, { userId, before });
  },
});

/**
 * Deletes a removed person's likes, history, and playlists in batches, rescheduling until they
 * are gone. `people.remove` has already deleted the account, so nothing reads these meanwhile.
 */
export const purgeRemovedUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const again = () => ctx.scheduler.runAfter(0, internal.people.purgeRemovedUser, { userId });

    const likes = await ctx.db
      .query("likes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(PURGE_BATCH);

    const history = await ctx.db
      .query("history")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(PURGE_BATCH);

    await Promise.all([...likes, ...history].map((doc) => ctx.db.delete(doc._id)));

    if (likes.length === PURGE_BATCH || history.length === PURGE_BATCH) {
      await again();

      return;
    }

    const playlist = await ctx.db
      .query("playlists")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .first();

    if (playlist === null) return;

    const items = await ctx.db
      .query("playlistItems")
      .withIndex("by_playlist", (q) => q.eq("playlistId", playlist._id))
      .take(PURGE_BATCH);

    await Promise.all(items.map((item) => ctx.db.delete(item._id)));

    if (items.length < PURGE_BATCH) await ctx.db.delete(playlist._id);

    await again();
  },
});

/**
 * Batched clean-up behind people management. Suspending, demoting, or removing someone must never
 * fail because they own too many rows (anyone can sign in, like, or create keys without limit), so
 * the handlers in `handlers/people.ts` change only the account in their own mutation, which takes
 * effect at once, and schedule these to tidy the rest a bounded batch at a time.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { inviterStillAllows } from "./lib/invites";

const PURGE_BATCH = 100;

const cursor = v.union(v.string(), v.null());

/**
 * Deletes a person's sessions created up to `before`, with their refresh tokens. `endUserSessions`
 * has already made them stop counting.
 */
export const purgeSessions = internalMutation({
  args: { userId: v.id("users"), before: v.number() },
  handler: async (ctx, { userId, before }) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId).lte("_creationTime", before))
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
 * Revokes the open invites someone made that their role no longer allows: after a demotion, a
 * suspension, or removal. Sign-up checks the same rule, so this only tidies the invite list.
 */
export const revokeLapsedInvites = internalMutation({
  args: { inviterId: v.id("users"), cursor },
  handler: async (ctx, { inviterId, cursor: from }) => {
    const inviter = await ctx.db.get(inviterId);

    const page = await ctx.db
      .query("invites")
      .withIndex("by_creator", (q) => q.eq("createdBy", inviterId))
      .paginate({ cursor: from, numItems: PURGE_BATCH });

    await Promise.all(
      page.page
        .filter((invite) => !invite.revoked && invite.acceptedBy === undefined)
        .filter((invite) => !inviterStillAllows(inviter, invite))
        .map((invite) => ctx.db.patch(invite._id, { revoked: true })),
    );

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.people.revokeLapsedInvites, {
        inviterId,
        cursor: page.continueCursor,
      });
    }
  },
});

/** Revokes every API key a person has, for someone made a guest. */
export const revokeKeys = internalMutation({
  args: { userId: v.id("users"), cursor },
  handler: async (ctx, { userId, cursor: from }) => {
    const now = Date.now();

    const page = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .paginate({ cursor: from, numItems: PURGE_BATCH });

    await Promise.all(
      page.page
        .filter((key) => key.revokedAt === undefined)
        .map((key) => ctx.db.patch(key._id, { revokedAt: now, sessionId: undefined })),
    );

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.people.revokeKeys, {
        userId,
        cursor: page.continueCursor,
      });
    }
  },
});

/**
 * Deletes what a removed person owned, rescheduling until it is gone: keys, devices, library
 * access, reset links, likes, history, and playlists; their libraries move to `heir`.
 * `people.remove` has already deleted the account, so none of this is reachable meanwhile.
 */
export const purgeRemovedUser = internalMutation({
  args: { userId: v.id("users"), heir: v.id("users") },
  handler: async (ctx, { userId, heir }) => {
    const again = () =>
      ctx.scheduler.runAfter(0, internal.people.purgeRemovedUser, { userId, heir });

    const owned = await Promise.all([
      ctx.db
        .query("apiKeys")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(PURGE_BATCH),
      ctx.db
        .query("devices")
        .withIndex("by_user_device", (q) => q.eq("userId", userId))
        .take(PURGE_BATCH),
      ctx.db
        .query("libraryAccess")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(PURGE_BATCH),
      ctx.db
        .query("passwordResets")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(PURGE_BATCH),
      ctx.db
        .query("likes")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(PURGE_BATCH),
      ctx.db
        .query("history")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(PURGE_BATCH),
    ]);

    // Their libraries leave the `by_owner` range as they move, so each batch takes the next ones.
    const libraries = await ctx.db
      .query("libraries")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .take(PURGE_BATCH);

    await Promise.all([
      ...owned.flat().map((doc) => ctx.db.delete(doc._id)),
      // Private libraries stay private, now to the heir; nothing on disk changes.
      ...libraries.map((library) => ctx.db.patch(library._id, { ownerId: heir })),
    ]);

    if ([...owned, libraries].some((batch) => batch.length === PURGE_BATCH)) {
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

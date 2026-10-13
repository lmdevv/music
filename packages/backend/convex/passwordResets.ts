/**
 * Password reset without email. Self-hosted servers rarely send mail, so an admin creates a
 * one-time link (`people.reset`) and hands it over; the `reset` flow of the password provider in
 * `auth.ts` redeems it. An operator locked out of the owner account can make one with the admin
 * key: `convex run passwordResets:createForEmail '{"email": "you@example.com"}'`.
 */
import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { createPasswordReset } from "./handlers/people";
import { fail } from "./lib/errors";
import { endUserSessions } from "./lib/sessions";
import { SUSPENDED_MESSAGE } from "./lib/viewer";

/**
 * Uses up the reset link with this token hash and ends every session its person has. Returns the
 * person and the password account to set the new password on, or fails saying why the link does
 * not work. Claiming before the password changes means a link works exactly once.
 */
export const redeem = internalMutation({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const reset = await ctx.db
      .query("passwordResets")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();

    if (reset === null) return fail("invalid_args", "This reset link is not valid");

    if (reset.usedAt !== undefined) {
      return fail("invalid_args", "This reset link was already used");
    }

    if (reset.expiresAt < Date.now()) return fail("invalid_args", "This reset link has expired");
    const user = await ctx.db.get(reset.userId);

    if (user === null) return fail("invalid_args", "This reset link is not valid");

    if (user.suspendedAt !== undefined) return fail("forbidden", SUSPENDED_MESSAGE);

    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", user._id).eq("provider", "password"))
      .unique();

    if (account === null) return fail("invalid_args", "This account has no password to reset");

    await ctx.db.patch(reset._id, { usedAt: Date.now() });
    await endUserSessions(ctx, user._id);

    return { userId: user._id, accountId: account.providerAccountId };
  },
});

/**
 * Makes a claimed link usable again when setting the password failed after `redeem`, so the
 * person can retry instead of needing a new link.
 */
export const release = internalMutation({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const reset = await ctx.db
      .query("passwordResets")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();

    if (reset !== null) await ctx.db.patch(reset._id, { usedAt: undefined });
  },
});

/** Makes a reset link for the account with `email`, for operators with the admin key. */
export const createForEmail = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email.trim().toLowerCase()))
      .unique();

    if (user === null) return fail("not_found", `No account with email ${email}`);

    const { token, expiresAt } = await createPasswordReset(ctx, user._id, undefined);

    return { path: `/reset/${token}`, expiresAt: new Date(expiresAt).toISOString() };
  },
});

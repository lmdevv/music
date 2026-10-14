import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { fail } from "./lib/errors";
import { inviterStillAllows } from "./lib/invites";
import type { ReadCtx } from "./lib/viewer";

/** What lets a sign-up in: being the first account, or an open invite for this email. */
type SignUpPass =
  | { readonly kind: "first" }
  | { readonly kind: "invite"; readonly invite: Doc<"invites"> };

/**
 * Checks that `email` may sign up, or fails with `signup_closed` saying why. The first account
 * needs nothing; every later one needs an open invite that its sender may still give.
 */
const signUpPass = async (
  ctx: ReadCtx,
  email: string,
  inviteCode: string | undefined,
): Promise<SignUpPass> => {
  if ((await ctx.db.query("users").first()) === null) return { kind: "first" };

  if (inviteCode === undefined)
    return fail("signup_closed", "Sign-up needs an invite from an admin");

  const invite = await ctx.db
    .query("invites")
    .withIndex("by_code", (q) => q.eq("code", inviteCode))
    .unique();

  if (invite === null || invite.revoked || invite.acceptedBy !== undefined) {
    return fail("signup_closed", "This invite is not valid");
  }

  if (invite.expiresAt < Date.now()) return fail("signup_closed", "This invite has expired");

  if (!inviterStillAllows(await ctx.db.get(invite.createdBy), invite)) {
    return fail("signup_closed", "This invite is no longer valid; ask an admin for a new one");
  }

  if (invite.email !== undefined && invite.email !== email) {
    return fail("signup_closed", `This invite is for ${invite.email}`);
  }

  return { kind: "invite", invite };
};

/**
 * Whether a sign-up may go ahead: fails with `signup_closed` unless the email may sign up, and
 * only then says whether a password account already uses it. Sign-up has no rate limit, so
 * without a valid invite every email gets the same answer, and nobody learns which have accounts.
 */
export const checkSignUp = internalQuery({
  args: { email: v.string(), inviteCode: v.union(v.string(), v.null()) },
  handler: async (ctx, { email, inviteCode }) => {
    await signUpPass(ctx, email, inviteCode ?? undefined);

    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", email),
      )
      .unique();

    return { accountExists: account !== null };
  },
});

/**
 * Creates the account for a password sign-up. The first account becomes the owner; every later
 * one needs an open invite.
 */
export const createFromSignUp = internalMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    inviteCode: v.optional(v.string()),
  },
  handler: async (ctx, { email, name, inviteCode }) => {
    const pass = await signUpPass(ctx, email, inviteCode);
    const displayName = name ?? email.split("@")[0];

    if (pass.kind === "first") {
      return ctx.db.insert("users", { email, name: displayName, role: "owner" });
    }

    const userId = await ctx.db.insert("users", {
      email,
      name: displayName,
      role: pass.invite.role,
    });

    await ctx.db.patch(pass.invite._id, { acceptedBy: userId, acceptedAt: Date.now() });

    return userId;
  },
});

import { canManagePerson } from "@music/commands/permissions";

import type { Doc } from "../_generated/dataModel";
import { roleOf } from "./viewer";
import type { ReadCtx } from "./viewer";

/** The password reset link whose token hashes to `hash`, if any. */
export const resetByHash = (ctx: ReadCtx, hash: string): Promise<Doc<"passwordResets"> | null> =>
  ctx.db
    .query("passwordResets")
    .withIndex("by_hash", (q) => q.eq("hash", hash))
    .unique();

/**
 * Whether a reset link still carries its maker's authority over `user`: the admin who made it
 * exists, is not suspended, and may still manage `user` today. A link made for a member stops
 * working once they are promoted to admin, and one made by an admin since demoted, suspended, or
 * removed stops working at once. Links an operator made with the admin key (no maker) only expire.
 */
export const resetStillAllowed = async (
  ctx: ReadCtx,
  reset: Doc<"passwordResets">,
  user: Doc<"users">,
): Promise<boolean> => {
  if (reset.createdBy === undefined) return true;
  const creator = await ctx.db.get(reset.createdBy);

  return (
    creator !== null &&
    creator.suspendedAt === undefined &&
    canManagePerson(
      { id: creator._id, role: roleOf(creator) },
      { id: user._id, role: roleOf(user) },
    )
  );
};

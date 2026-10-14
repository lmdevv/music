import type { Doc } from "../_generated/dataModel";
import type { ReadCtx } from "./viewer";

/** The password reset link whose token hashes to `hash`, if any. */
export const resetByHash = (ctx: ReadCtx, hash: string): Promise<Doc<"passwordResets"> | null> =>
  ctx.db
    .query("passwordResets")
    .withIndex("by_hash", (q) => q.eq("hash", hash))
    .unique();

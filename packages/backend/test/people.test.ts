/**
 * People management at a scale one mutation cannot hold: someone who signed in, made keys, or
 * liked songs without limit can still be suspended and removed, and the rest is cleaned up in
 * batches. Runs in memory with Convex's transaction limits tightened.
 */
import { UserId } from "@music/commands/ids";
import { describe, expect, it } from "vitest";

import type { Id } from "../convex/_generated/dataModel";
import { drainScheduled, makeBackend, signUp } from "./backend";
import type { Backend } from "./backend";
import { failureCode } from "./harness";

/** Writes per mutation in these tests: far fewer than the rows each person owns. */
const LIMIT = 150;

/** Rows each person gets, several times what one mutation may write. */
const MANY = 400;

/** Inserts `count` rows, a limit-sized batch per transaction. */
const insertMany = async (
  backend: Backend,
  count: number,
  insert: (ctx: Parameters<Parameters<Backend["run"]>[0]>[0], index: number) => Promise<void>,
): Promise<void> => {
  const from = async (start: number): Promise<void> => {
    if (start >= count) return;

    await backend.run(async (ctx) => {
      const indexes = Array.from({ length: Math.min(40, count - start) }, (_, i) => start + i);

      await Promise.all(indexes.map((index) => insert(ctx, index)));
    });

    await from(start + 40);
  };

  await from(0);
};

const countOf = (
  backend: Backend,
  table: "authSessions" | "apiKeys",
  userId: Id<"users">,
): Promise<number> =>
  backend.run(async (ctx) =>
    table === "authSessions"
      ? (
          await ctx.db
            .query("authSessions")
            .withIndex("userId", (q) => q.eq("userId", userId))
            .collect()
        ).length
      : (
          await ctx.db
            .query("apiKeys")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .collect()
        ).length,
  );

describe("people management at scale", () => {
  it("suspends someone with more sessions than a mutation can write, then purges them", async () => {
    const backend = makeBackend({ documentsWritten: LIMIT });
    const owner = await signUp(backend, "owner");
    const person = await signUp(backend, "member");

    await insertMany(backend, MANY, async (ctx) => {
      await ctx.db.insert("authSessions", {
        userId: person.id,
        expirationTime: Date.now() + 60_000,
      });
    });

    expect(
      await failureCode(owner.music.run("people.suspend", { userId: UserId.make(person.id) })),
    ).toBe("succeeded");
    expect(await failureCode(person.music.read("account.me", {}))).toBe("unauthenticated");

    await drainScheduled(backend);
    expect(await countOf(backend, "authSessions", person.id)).toBe(0);

    await owner.music.run("people.unsuspend", { userId: UserId.make(person.id) });
    expect(await failureCode(person.music.read("account.me", {}))).toBe("unauthenticated");
  });

  it("removes someone with more keys than a mutation can write, then purges them", async () => {
    const backend = makeBackend({ documentsWritten: LIMIT });
    const owner = await signUp(backend, "owner");
    const person = await signUp(backend, "member");

    await insertMany(backend, MANY, async (ctx, index) => {
      await ctx.db.insert("apiKeys", {
        userId: person.id,
        name: `key ${String(index)}`,
        prefix: "mk_test",
        hash: `hash-${String(index)}`,
      });
    });

    expect(
      await failureCode(owner.music.run("people.remove", { userId: UserId.make(person.id) })),
    ).toBe("succeeded");
    expect(await failureCode(person.music.read("account.me", {}))).toBe("unauthenticated");

    await drainScheduled(backend);
    expect(await countOf(backend, "apiKeys", person.id)).toBe(0);
    expect(await countOf(backend, "authSessions", person.id)).toBe(0);
  });

  it("revokes a new guest's keys in batches", async () => {
    const backend = makeBackend({ documentsWritten: LIMIT });
    const owner = await signUp(backend, "owner");
    const person = await signUp(backend, "member");

    await insertMany(backend, MANY, async (ctx, index) => {
      await ctx.db.insert("apiKeys", {
        userId: person.id,
        name: `key ${String(index)}`,
        prefix: "mk_test",
        hash: `hash-${String(index)}`,
      });
    });

    await owner.music.run("people.role", { userId: UserId.make(person.id), role: "guest" });
    await drainScheduled(backend);

    const open = await backend.run(
      async (ctx) =>
        (
          await ctx.db
            .query("apiKeys")
            .withIndex("by_user", (q) => q.eq("userId", person.id))
            .collect()
        ).filter((key) => key.revokedAt === undefined).length,
    );

    expect(open).toBe(0);
  });
});

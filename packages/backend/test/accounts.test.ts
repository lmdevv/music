/**
 * Sign-in, sign-up, password reset links, and library access rules, through the real Convex Auth
 * action and command dispatcher in memory. Each case is a security review finding on PR #22.
 */
import { UserId } from "@music/commands/ids";
import { makeMusicClient, type MusicClient } from "@music/sdk/client";
import { decodeJwt } from "jose";
import { sha256Hex } from "../convex/lib/crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { api, internal } from "../convex/_generated/api";
import { enableAuth, joinWithPassword, passwordFlow } from "./auth";
import { drainScheduled, makeBackend, signUp, upsertFiles } from "./backend";
import type { Backend, User } from "./backend";
import { failure, failureCode } from "./harness";

const PASSWORD = "correct-horse-battery";

const INVALID = { code: "unauthenticated", message: "Invalid email or password" };

beforeAll(enableAuth);

/** A server with its owner, an admin, and a member who has a password, ready for resets. */
const household = async (): Promise<{
  readonly backend: Backend;
  readonly owner: User;
  readonly admin: User;
  readonly member: Awaited<ReturnType<typeof joinWithPassword>>;
}> => {
  const backend = makeBackend();
  const owner = await signUp(backend, "owner");
  const admin = await signUp(backend, "admin");

  const member = await joinWithPassword(backend, owner, {
    email: "member@music.test",
    password: PASSWORD,
    role: "member",
  });

  return { backend, owner, admin, member };
};

/** Signs in with an API key, as the CLI does; null when the key no longer works. */
const keySignIn = async (backend: Backend, key: string): Promise<MusicClient | null> => {
  const result = await backend.action(api.auth.signIn, { provider: "apikey", params: { key } });
  const token = result.tokens?.token;

  if (token === undefined) return null;
  const signedIn = backend.withIdentity({ subject: decodeJwt(token).sub ?? "" });

  return makeMusicClient({
    query: (reference, args) => signedIn.query(reference, args),
    mutation: (reference, args) => signedIn.mutation(reference, args),
  });
};

const redeem = (backend: Backend, token: string) =>
  passwordFlow(backend, { flow: "reset", token, newPassword: "a-new-password-1" });

describe("password reset links", () => {
  it("work while their maker may still manage the person", async () => {
    const { backend, admin, member } = await household();
    const { token } = await admin.music.run("people.reset", { userId: member.userId });

    expect(await failureCode(redeem(backend, token))).toBe("succeeded");
  });

  it.each(["demoted", "suspended", "removed"] as const)(
    "stop working once their maker is %s",
    async (change) => {
      const { backend, owner, admin, member } = await household();
      const { token } = await admin.music.run("people.reset", { userId: member.userId });
      const adminId = UserId.make(admin.id);

      if (change === "demoted") {
        await owner.music.run("people.role", { userId: adminId, role: "member" });
      } else if (change === "suspended") {
        await owner.music.run("people.suspend", { userId: adminId });
      } else {
        await owner.music.run("people.remove", { userId: adminId });
      }

      expect(await failureCode(redeem(backend, token))).toBe("invalid_args");
    },
  );

  it("re-check their maker's rights when redeemed, not only when the maker changes", async () => {
    const { backend, admin, member } = await household();
    const { token } = await admin.music.run("people.reset", { userId: member.userId });

    // Behind the handlers' back, as an old deployment or a direct data edit could leave it.
    await backend.run(async (ctx) => {
      await ctx.db.patch(admin.id, { role: "member" });
    });

    expect(await failureCode(redeem(backend, token))).toBe("invalid_args");
    await expect(
      backend.mutation(internal.passwordResets.redeem, {
        hash: await sha256Hex(token),
        provider: "password",
        secret: "a-hash",
      }),
    ).rejects.toThrow("no longer valid");
  });

  it("check the link, set the password on the person's own account, and sign them out at once", async () => {
    const { backend, admin, member } = await household();
    const { token } = await admin.music.run("people.reset", { userId: member.userId });

    // Another account under the same email can't exist alongside, but the account is found by
    // the person, not by the email, so the password lands on theirs alone.
    const userId = await backend.mutation(internal.passwordResets.redeem, {
      hash: await sha256Hex(token),
      provider: "password",
      secret: "the-new-hash",
    });

    const after = await backend.run(async (ctx) => ({
      secrets: (await ctx.db.query("authAccounts").collect()).map((account) => [
        account.userId,
        account.secret,
      ]),
      used: (await ctx.db.query("passwordResets").collect()).map(
        (reset) => reset.usedAt !== undefined,
      ),
    }));

    expect(userId).toBe(member.id);
    expect(after.secrets.filter(([owner]) => owner === member.id)).toEqual([
      [member.id, "the-new-hash"],
    ]);
    expect(after.used).toEqual([true]);
    await expect(member.music.read("account.me", {})).rejects.toThrow("session has ended");
  });

  it("stop working once the person is promoted to admin", async () => {
    const { backend, owner, admin, member } = await household();
    const { token } = await admin.music.run("people.reset", { userId: member.userId });

    await owner.music.run("people.role", { userId: member.userId, role: "admin" });

    expect(await failureCode(redeem(backend, token))).toBe("invalid_args");
  });

  it("show as unusable, not as a form, for a suspended person", async () => {
    const { backend, owner, admin, member } = await household();
    const made = await admin.music.run("people.reset", { userId: member.userId });

    await owner.music.run("people.suspend", { userId: member.userId });

    // A link made before the suspension, by an admin.
    expect(await backend.query(api.setup.passwordReset, { token: made.token })).toEqual({
      state: "invalid",
    });
    expect(await failureCode(redeem(backend, made.token))).toBe("invalid_args");

    // An operator's link (`createForEmail`) for someone already suspended.
    const { path } = await backend.mutation(internal.passwordResets.createForEmail, {
      email: "member@music.test",
    });

    const token = path.replace("/reset/", "");

    expect(await backend.query(api.setup.passwordReset, { token })).toEqual({ state: "invalid" });
    expect(await failureCode(redeem(backend, token))).toBe("forbidden");
  });

  it("stop working for a promoted person even if the link was not voided", async () => {
    const { backend, admin, member } = await household();
    const { token } = await admin.music.run("people.reset", { userId: member.userId });

    await backend.run(async (ctx) => {
      await ctx.db.patch(member.id, { role: "admin" });
    });

    expect(await failureCode(redeem(backend, token))).toBe("invalid_args");
  });
});

/** A restricted library of the owner's that the admin is not on, with `member` added. */
const restricted = async (owner: User, memberId: UserId) => {
  const { libraryId } = await owner.music.run("libraries.create", {
    name: "Kept",
    path: "/music/kept",
    visibility: "restricted",
  });

  await owner.music.run("libraries.grant", { libraryId, userId: memberId });

  return libraryId;
};

describe("password resets around library access", () => {
  it("leave someone who hears a library the admin can't to the owner", async () => {
    const { owner, admin, member } = await household();

    await restricted(owner, member.userId);

    expect(await failureCode(admin.music.run("people.reset", { userId: member.userId }))).toBe(
      "forbidden",
    );
    expect(await failureCode(owner.music.run("people.reset", { userId: member.userId }))).toBe(
      "succeeded",
    );
  });

  it("stop working once the person is let into a library the maker can't hear", async () => {
    const { backend, owner, admin, member } = await household();
    const { token } = await admin.music.run("people.reset", { userId: member.userId });

    await restricted(owner, member.userId);

    expect(await failureCode(redeem(backend, token))).toBe("invalid_args");
  });

  it("leave a demoted admin with a private library to the owner", async () => {
    const { backend, owner, admin } = await household();

    const keeper = await joinWithPassword(backend, owner, {
      email: "keeper@music.test",
      password: PASSWORD,
      role: "admin",
    });

    await keeper.music.run("libraries.create", {
      name: "Vault",
      path: "/music/vault",
      visibility: "private",
    });
    await owner.music.run("people.role", { userId: keeper.userId, role: "member" });

    expect(await failureCode(admin.music.run("people.reset", { userId: keeper.userId }))).toBe(
      "forbidden",
    );
  });
});

/** How each kind of account from before owners is stored. */
const LEGACY_ROWS = {
  admin: { role: "admin" },
  "suspended admin": { role: "admin", suspendedAt: 1 },
  member: { role: "member" },
} as const;

/**
 * A server from before owners, with accounts of `kinds` in creation order, after its migrations
 * ran: each account's role and whether it is suspended.
 */
const migrateLegacy = async (kinds: ReadonlyArray<keyof typeof LEGACY_ROWS>) => {
  const backend = makeBackend();

  // Inserted in one transaction, in order, so creation order follows `kinds`.
  const ids = await backend.run(async (ctx) =>
    Promise.all(
      kinds.map(async (kind, index) =>
        ctx.db.insert("users", {
          email: `legacy-${String(index)}@music.test`,
          ...LEGACY_ROWS[kind],
        }),
      ),
    ),
  );

  await backend.mutation(internal.migrations.run, {});
  await drainScheduled(backend);

  const after = await backend.run(async (ctx) =>
    Promise.all(ids.map(async (id) => ctx.db.get(id))),
  );

  return after.map((user) => [user?.role, user?.suspendedAt !== undefined]);
};

describe("the promoteOwner migration", () => {
  it("never picks a suspended admin, nor lifts a suspension", async () => {
    expect(await migrateLegacy(["suspended admin", "admin", "member"])).toEqual([
      ["admin", true],
      ["owner", false],
      ["member", false],
    ]);
  });

  it("leaves a server whose only admins are suspended without an owner", async () => {
    expect(await migrateLegacy(["suspended admin", "member"])).toEqual([
      ["admin", true],
      ["member", false],
    ]);
  });
});

describe("access to a demoted admin's libraries", () => {
  it("passes to the server's owner, while other admins still can't change it", async () => {
    const { owner, admin } = await household();

    const { libraryId } = await admin.music.run("libraries.create", {
      name: "Theirs",
      path: "/music/theirs",
      visibility: "restricted",
    });

    const listed = async (user: User) =>
      (await user.music.read("libraries.list", {})).find((library) => library.id === libraryId);

    // While its owner is an admin, only they change who listens.
    expect((await listed(owner))?.accessEditable).toBe(false);
    expect(
      await failureCode(owner.music.run("libraries.update", { libraryId, visibility: "shared" })),
    ).toBe("forbidden");

    await owner.music.run("people.role", { userId: UserId.make(admin.id), role: "member" });

    // A member can't run libraries, so the server's owner now decides.
    expect((await listed(owner))?.accessEditable).toBe(true);
    expect(
      await failureCode(owner.music.run("libraries.update", { libraryId, visibility: "shared" })),
    ).toBe("succeeded");
    expect(
      await failureCode(
        owner.music.run("libraries.grant", { libraryId, userId: UserId.make(admin.id) }),
      ),
    ).toBe("succeeded");
  });

  it("stays with the library's own owner over other admins", async () => {
    const { backend, owner, admin } = await household();
    const other = await signUp(backend, "admin");

    const { libraryId } = await admin.music.run("libraries.create", {
      name: "Theirs",
      path: "/music/theirs",
      visibility: "shared",
    });

    await owner.music.run("people.role", { userId: UserId.make(admin.id), role: "member" });

    // Another admin hears it (shared) and manages it, but doesn't decide who listens.
    expect(
      await failureCode(other.music.run("libraries.update", { libraryId, visibility: "private" })),
    ).toBe("forbidden");
  });
});

describe("API keys around a demotion to guest", () => {
  it("stop at once, before the batched revocation, and stay stopped after a promotion", async () => {
    const { backend, owner, member } = await household();
    const { key } = await member.music.run("keys.create", { name: "CLI" });
    const cli = await keySignIn(backend, key);

    if (cli === null) throw new Error("A fresh key did not sign in");

    expect(await failureCode(cli.read("account.me", {}))).toBe("succeeded");

    // The batches that revoke the keys wait until the end.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    try {
      await owner.music.run("people.role", { userId: member.userId, role: "guest" });
      expect(await failureCode(cli.read("account.me", {}))).toBe("unauthenticated");
      // A guest still listens through their password session.
      expect(await failureCode(member.music.read("account.me", {}))).toBe("succeeded");

      await owner.music.run("people.role", { userId: member.userId, role: "member" });
      expect(await failureCode(cli.read("account.me", {}))).toBe("unauthenticated");
      expect(await keySignIn(backend, key)).toBeNull();
    } finally {
      vi.useRealTimers();
    }

    // Keys made after the promotion work.
    const fresh = await member.music.run("keys.create", { name: "New CLI" });

    expect(await keySignIn(backend, fresh.key)).not.toBeNull();
  });
});

describe("password sign-up and sign-in", () => {
  it("refuses a sign-up for an email that already has an account, right password or not", async () => {
    const { backend, owner } = await household();
    const { code: inviteCode } = await owner.music.run("invites.create", {});

    const attempts = await Promise.all(
      [PASSWORD, "a-wrong-password"].map((password) =>
        failure(
          passwordFlow(backend, {
            flow: "signUp",
            email: "member@music.test",
            password,
            inviteCode,
          }),
        ),
      ),
    );

    expect(attempts).toEqual([INVALID, INVALID]);
  });

  it("signs nobody into an account another sign-up made a moment before", async () => {
    const { backend, owner } = await household();

    const codes = await Promise.all(
      [0, 1].map(async () => (await owner.music.run("invites.create", {})).code),
    );

    // Both start before either account exists, each with an invite of its own and the same
    // password: the second must not come back signed in to the account the first made.
    const attempts = await Promise.all(
      codes.map(async (inviteCode) =>
        failure(
          passwordFlow(backend, {
            flow: "signUp",
            email: "twin@music.test",
            password: PASSWORD,
            inviteCode,
          }),
        ),
      ),
    );

    expect(attempts.filter((attempt) => attempt === "succeeded")).toHaveLength(1);
    expect(attempts).toContainEqual(INVALID);
  });

  it("gives a suspended account no tokens through sign-up either", async () => {
    const { backend, owner, member } = await household();
    const { code: inviteCode } = await owner.music.run("invites.create", {});

    await owner.music.run("people.suspend", { userId: member.userId });

    expect(
      await failure(
        passwordFlow(backend, {
          flow: "signUp",
          email: "member@music.test",
          password: PASSWORD,
          inviteCode,
        }),
      ),
    ).toEqual(INVALID);
  });

  it("tells nobody without a valid invite whether an email has an account", async () => {
    const { backend } = await household();

    const signUpAs = (email: string, inviteCode?: string) =>
      failureCode(
        passwordFlow(
          backend,
          inviteCode === undefined
            ? { flow: "signUp", email, password: PASSWORD }
            : { flow: "signUp", email, password: PASSWORD, inviteCode },
        ),
      );

    const codes = await Promise.all([
      signUpAs("member@music.test"),
      signUpAs("nobody@music.test"),
      signUpAs("member@music.test", "not-an-invite"),
      signUpAs("nobody@music.test", "not-an-invite"),
    ]);

    expect(codes).toEqual(["signup_closed", "signup_closed", "signup_closed", "signup_closed"]);
  });

  it("says the same for an unknown email and a wrong password", async () => {
    const { backend } = await household();

    const unknown = await failure(
      passwordFlow(backend, { flow: "signIn", email: "nobody@music.test", password: PASSWORD }),
    );

    const wrong = await failure(
      passwordFlow(backend, { flow: "signIn", email: "member@music.test", password: "wrong-one" }),
    );

    expect(unknown).toEqual(INVALID);
    expect(wrong).toEqual(INVALID);
  });

  it("keeps the rate limit distinct after too many wrong passwords", async () => {
    const { backend } = await household();

    const attempt = () =>
      failure(
        passwordFlow(backend, {
          flow: "signIn",
          email: "member@music.test",
          password: "nope-nope",
        }),
      );

    const attempts = async (
      left: number,
      seen: ReadonlyArray<unknown>,
    ): Promise<ReadonlyArray<unknown>> =>
      left === 0 ? seen : attempts(left - 1, [...seen, await attempt()]);

    const results = await attempts(12, []);

    expect(results[0]).toEqual(INVALID);
    expect(results.at(-1)).toMatchObject({ code: "rate_limited" });
  });
});

describe("library access", () => {
  it("names a library's owner by email to admins only", async () => {
    const { backend, owner, admin, member } = await household();

    await backend.run(async (ctx) => {
      await ctx.db.patch(owner.id, { name: undefined });
    });
    await owner.music.run("libraries.create", { name: "Ours", path: "/music/ours" });

    const named = await Promise.all(
      [admin, member].map(async (viewer) =>
        (await viewer.music.read("libraries.list", {})).map((library) => library.ownerName),
      ),
    );

    const email = await backend.run(async (ctx) => (await ctx.db.get(owner.id))?.email);

    expect(named).toEqual([[email], [null]]);
  });

  it("lets only a library's own owner change who listens", async () => {
    const { owner, admin, member } = await household();

    const { libraryId } = await owner.music.run("libraries.create", {
      name: "Home",
      path: "/music/home",
      visibility: "restricted",
    });

    const asAdmin = (await admin.music.read("libraries.list", {})).find(
      (library) => library.id === libraryId,
    );

    expect(asAdmin).toMatchObject({ readable: false, manageable: false, path: null });

    const refused = await Promise.all(
      [
        admin.music.run("libraries.grant", { libraryId, userId: UserId.make(admin.id) }),
        admin.music.run("libraries.grant", { libraryId, userId: member.userId }),
        admin.music.run("libraries.update", { libraryId, visibility: "shared" }),
        admin.music.run("libraries.revoke", { libraryId, userId: member.userId }),
      ].map(failureCode),
    );

    // An admin who can't hear the library can't manage it at all, so it is not found.
    expect(refused).toEqual(["not_found", "not_found", "not_found", "not_found"]);

    await owner.music.run("libraries.grant", { libraryId, userId: member.userId });
    expect((await member.music.read("libraries.list", {})).map((library) => library.id)).toContain(
      libraryId,
    );
  });
  it("lets an admin manage only libraries they can hear; the owner manages every one", async () => {
    const { owner, admin } = await household();

    const own = await admin.music.run("libraries.create", {
      name: "Admin's",
      path: "/music/admins",
      visibility: "private",
    });

    const theirs = await owner.music.run("libraries.create", {
      name: "Owner's",
      path: "/music/owners",
      visibility: "private",
    });

    // The admin's own: listed with its folder, and theirs to manage.
    expect(
      (await admin.music.read("libraries.list", {})).find(
        (library) => library.id === own.libraryId,
      ),
    ).toMatchObject({ path: "/music/admins", manageable: true });
    expect(
      await failureCode(
        admin.music.run("libraries.update", { libraryId: own.libraryId, name: "A" }),
      ),
    ).toBe("succeeded");

    // The owner's private one: no folder, and every management action is not found.
    const unheard = { libraryId: theirs.libraryId };

    const refused = await Promise.all(
      [
        admin.music.run("libraries.scan", unheard),
        admin.music.run("libraries.update", { ...unheard, name: "Mine now" }),
        admin.music.run("libraries.delete", unheard),
        admin.music.read("libraries.people", unheard),
        admin.music.run("jobs.cancel", { jobId: theirs.jobId }),
      ].map(failureCode),
    );

    expect(refused).toEqual(["not_found", "not_found", "not_found", "not_found", "not_found"]);
    expect(await failureCode(admin.music.read("jobs.get", { jobId: theirs.jobId }))).toBe(
      "not_found",
    );

    // The server's owner manages every library, the admin's private one included.
    expect(await failureCode(owner.music.run("libraries.scan", { libraryId: own.libraryId }))).toBe(
      "succeeded",
    );
    expect(
      (await owner.music.read("libraries.list", {})).find(
        (library) => library.id === own.libraryId,
      ),
    ).toMatchObject({ path: "/music/admins", manageable: true, readable: false });
  });

  it("stops the delete-and-re-add takeover of a library the admin can't hear", async () => {
    const { backend, owner, admin } = await household();

    const { libraryId } = await owner.music.run("libraries.create", {
      name: "Diary",
      path: "/music/diary",
      visibility: "private",
    });

    await upsertFiles(backend, libraryId, [{ path: "diary.flac", title: "Private Song" }]);

    const listed = (await admin.music.read("libraries.list", {})).find(
      (library) => library.id === libraryId,
    );

    // 1. The folder isn't shown. 2. Deleting it fails. 3. Adding its folder again fails too.
    expect(listed?.path).toBeNull();
    expect(await failureCode(admin.music.run("libraries.delete", { libraryId }))).toBe("not_found");
    expect(
      await failureCode(
        admin.music.run("libraries.create", { name: "Mine", path: "/music/diary" }),
      ),
    ).toBe("conflict");

    // 4. So nothing of it becomes searchable to the admin.
    const found = await admin.music.read("search", { query: "Private Song", limit: 10 });

    expect(found.tracks).toEqual([]);
  });
});

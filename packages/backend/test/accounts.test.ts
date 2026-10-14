/**
 * Sign-in, sign-up, password reset links, and library access rules, through the real Convex Auth
 * action and command dispatcher in memory. Each case is a security review finding on PR #22.
 */
import { UserId } from "@music/commands/ids";
import { sha256Hex } from "../convex/lib/crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { internal } from "../convex/_generated/api";
import { enableAuth, joinWithPassword, passwordFlow } from "./auth";
import { makeBackend, signUp } from "./backend";
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
      backend.mutation(internal.passwordResets.redeem, { hash: await sha256Hex(token) }),
    ).rejects.toThrow("no longer valid");
  });

  it("stop working once the person is promoted to admin", async () => {
    const { backend, owner, admin, member } = await household();
    const { token } = await admin.music.run("people.reset", { userId: member.userId });

    await owner.music.run("people.role", { userId: member.userId, role: "admin" });

    expect(await failureCode(redeem(backend, token))).toBe("invalid_args");
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

describe("password sign-up and sign-in", () => {
  it("refuses a sign-up for an email that already has an account, right password or not", async () => {
    const { backend } = await household();

    const attempts = await Promise.all(
      [PASSWORD, "a-wrong-password"].map((password) =>
        failure(passwordFlow(backend, { flow: "signUp", email: "member@music.test", password })),
      ),
    );

    expect(attempts).toEqual([INVALID, INVALID]);
  });

  it("gives a suspended account no tokens through sign-up either", async () => {
    const { backend, owner, member } = await household();

    await owner.music.run("people.suspend", { userId: member.userId });

    expect(
      await failure(
        passwordFlow(backend, { flow: "signUp", email: "member@music.test", password: PASSWORD }),
      ),
    ).toEqual(INVALID);
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
  it("lets only a library's own owner change who listens; other admins rename and rescan", async () => {
    const { owner, admin, member } = await household();

    const { libraryId } = await owner.music.run("libraries.create", {
      name: "Home",
      path: "/music/home",
      visibility: "restricted",
    });

    const asAdmin = (await admin.music.read("libraries.list", {})).find(
      (library) => library.id === libraryId,
    );

    expect(asAdmin).toMatchObject({ readable: false });

    const refused = await Promise.all(
      [
        admin.music.run("libraries.grant", { libraryId, userId: UserId.make(admin.id) }),
        admin.music.run("libraries.grant", { libraryId, userId: member.userId }),
        admin.music.run("libraries.update", { libraryId, visibility: "shared" }),
        admin.music.run("libraries.revoke", { libraryId, userId: member.userId }),
      ].map(failureCode),
    );

    expect(refused).toEqual(["forbidden", "forbidden", "forbidden", "forbidden"]);

    expect(
      await failureCode(admin.music.run("libraries.update", { libraryId, name: "Renamed" })),
    ).toBe("succeeded");
    expect(await failureCode(admin.music.run("libraries.scan", { libraryId }))).toBe("succeeded");

    await owner.music.run("libraries.grant", { libraryId, userId: member.userId });
    expect((await member.music.read("libraries.list", {})).map((library) => library.id)).toContain(
      libraryId,
    );
  });
});

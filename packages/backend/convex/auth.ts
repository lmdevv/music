import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import {
  convexAuth,
  createAccount,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { Scrypt } from "lucia";
import { Result, Schema } from "effect";

import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { sha256Hex } from "./lib/crypto";
import { SUSPENDED_MESSAGE } from "./lib/viewer";

/** The provider ID stored on every password account; it must never change. */
const PASSWORD = "password";

const Email = Schema.Trimmed.check(Schema.isMinLength(3));

/**
 * The password provider's flows. `signUp` and `signIn` match Convex Auth's `Password` provider;
 * `reset` redeems an admin's reset link (see `passwordResets.ts`) instead of an emailed code.
 */
const PasswordParams = Schema.Union([
  Schema.Struct({
    flow: Schema.Literal("signUp"),
    email: Email,
    password: Schema.String,
    name: Schema.optionalKey(Schema.Trimmed),
    inviteCode: Schema.optionalKey(Schema.Trimmed),
  }),
  Schema.Struct({ flow: Schema.Literal("signIn"), email: Email, password: Schema.String }),
  Schema.Struct({
    flow: Schema.Literal("reset"),
    token: Schema.String,
    newPassword: Schema.String,
  }),
]);

const decodePasswordParams = Schema.decodeUnknownResult(PasswordParams);

const SignUpProfile = Schema.Struct({
  email: Schema.String,
  name: Schema.optionalKey(Schema.String),
  inviteCode: Schema.optionalKey(Schema.String),
});

const decodeSignUpProfile = Schema.decodeUnknownResult(SignUpProfile);

const ApiKeyCredentials = Schema.Struct({ key: Schema.String.check(Schema.isMinLength(20)) });

const decodeApiKeyCredentials = Schema.decodeUnknownResult(ApiKeyCredentials);

const invalid = (message: string): never => {
  throw new ConvexError({ code: "invalid_args", message });
};

const checkPassword = (password: string): void => {
  if (password.length < 8) invalid("Use at least 8 characters for the password");
};

/** Empty optional fields from a form mean "not given". */
const given = (value: string | undefined): string | undefined =>
  value === undefined || value.length === 0 ? undefined : value;

/**
 * Hashes passwords as Convex Auth's `Password` provider does (Lucia's Scrypt), so accounts made
 * before this provider replaced it keep signing in.
 */
const scrypt = new Scrypt();

/**
 * Email and password accounts. It replaces Convex Auth's `Password` provider, which cannot refuse
 * a suspended account or take a reset link without email; everything else matches it.
 */
const password = ConvexCredentials<DataModel>({
  id: PASSWORD,
  authorize: async (params, ctx) => {
    const parsed = decodePasswordParams(params);

    if (Result.isFailure(parsed)) return invalid("Enter an email address and a password");
    const input = parsed.success;

    if (input.flow === "signUp") {
      checkPassword(input.password);
      const email = input.email.toLowerCase();
      const profile: Partial<Record<"name" | "inviteCode", string>> & { email: string } = { email };
      const name = given(input.name);
      const inviteCode = given(input.inviteCode);

      if (name !== undefined) profile.name = name;

      if (inviteCode !== undefined) profile.inviteCode = inviteCode;

      const { user } = await createAccount(ctx, {
        provider: PASSWORD,
        account: { id: email, secret: input.password },
        profile,
        shouldLinkViaEmail: false,
        shouldLinkViaPhone: false,
      });

      return { userId: user._id };
    }

    if (input.flow === "signIn") {
      // Throws on a wrong password, before anything reveals that the account is suspended.
      const { user } = await retrieveAccount(ctx, {
        provider: PASSWORD,
        account: { id: input.email.toLowerCase(), secret: input.password },
      });

      if (user.suspendedAt !== undefined) {
        throw new ConvexError({ code: "forbidden", message: SUSPENDED_MESSAGE });
      }

      return { userId: user._id };
    }

    checkPassword(input.newPassword);

    const { userId, accountId } = await ctx.runMutation(internal.passwordResets.redeem, {
      hash: await sha256Hex(input.token),
    });

    await modifyAccountCredentials(ctx, {
      provider: PASSWORD,
      account: { id: accountId, secret: input.newPassword },
    });

    return { userId };
  },
  crypto: {
    hashSecret: (secret) => scrypt.hash(secret),
    verifySecret: (secret, hash) => scrypt.verify(hash, secret),
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    password,
    ConvexCredentials<DataModel>({
      id: "apikey",
      authorize: async (credentials, ctx) => {
        const parsed = decodeApiKeyCredentials(credentials);

        if (Result.isFailure(parsed)) return null;
        const hash = await sha256Hex(parsed.success.key);

        return ctx.runMutation(internal.apiKeys.redeem, { hash });
      },
    }),
  ],
  callbacks: {
    createOrUpdateUser: async (ctx, args) => {
      if (args.existingUserId !== null) return args.existingUserId;
      const profile = decodeSignUpProfile(args.profile);

      if (Result.isFailure(profile)) return invalid("Sign-up details are incomplete");

      return ctx.runMutation(internal.users.createFromSignUp, profile.success);
    },
  },
});

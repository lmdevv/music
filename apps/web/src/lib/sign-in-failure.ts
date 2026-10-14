import { commandFailure } from "@music/sdk/errors";

/**
 * How a wrong email or password reads: Convex Auth's Password provider throws `InvalidAccountId`
 * (no such email) or `InvalidSecret` (wrong password); a provider that wraps them answers
 * "Invalid email or password". Refresh-token renewal, rate limits, and server faults read
 * differently, so they still count as errors.
 */
const WRONG_CREDENTIALS = /\b(?:InvalidAccountId|InvalidSecret)\b|Invalid email or password/;

/** Whether a Convex log line or error message reports a wrong email or password. */
export const mentionsWrongCredentials = (text: string): boolean => WRONG_CREDENTIALS.test(text);

/** Why a sign-in failed: the credentials, or anything else the server reported. */
export type SignInFailure = "credentials" | "server";

/**
 * Classifies a failed `signIn("password", …)`: an `unauthenticated` command failure or a
 * wrong-credentials message is the user's input; everything else is a server problem worth
 * saying so.
 */
export const signInFailure = (error: Error): SignInFailure =>
  commandFailure(error)?.code === "unauthenticated" || mentionsWrongCredentials(error.message)
    ? "credentials"
    : "server";

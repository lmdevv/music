/**
 * How a wrong email or password reads: Convex Auth's Password provider throws `InvalidAccountId`
 * (no such email) or `InvalidSecret` (wrong password). Refresh-token renewal, rate limits, an
 * expired session, and server faults read differently, so they still count as errors.
 */
const WRONG_CREDENTIALS = /\b(?:InvalidAccountId|InvalidSecret)\b/;

/**
 * Whether a Convex log line or error message reports a wrong email or password. The one rule the
 * Convex logger and the sign-in screen share, so they never disagree (ADS-109).
 */
export const mentionsWrongCredentials = (text: string): boolean => WRONG_CREDENTIALS.test(text);

/** Why a sign-in failed: the credentials, or anything else the server reported. */
export type SignInFailure = "credentials" | "server";

/** Classifies a failed `signIn("password", …)` by {@link mentionsWrongCredentials}. */
export const signInFailure = (error: Error): SignInFailure =>
  mentionsWrongCredentials(error.message) ? "credentials" : "server";

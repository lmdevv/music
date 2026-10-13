import type { ConvexReactClientOptions } from "convex/react";
import { Option, Schema } from "effect";

/** The Convex client's logger shape (the `logger` option without its `true`/`false` shorthands). */
type ConvexLogger = Exclude<NonNullable<ConvexReactClientOptions["logger"]>, boolean>;

/** Where log lines go; the browser console in the app. */
export type LogSink = Pick<Console, "log" | "warn" | "error">;

/**
 * Convex Auth rejects a wrong email or password by throwing in its `auth:signIn` action, and the
 * Convex client logs every failed action as a server error. These failures are expected outcomes.
 */
const EXPECTED_SIGN_IN_FAILURE =
  /^\[CONVEX A\(auth:signIn\)\][\s\S]*\b(?:InvalidSecret|InvalidAccountId|TooManyFailedAttempts)\b/;

const decodeLine = Schema.decodeUnknownOption(Schema.String);

/** Whether a Convex log line reports an expected sign-in failure rather than a fault. */
const isExpectedSignInFailure = (line: string): boolean => EXPECTED_SIGN_IN_FAILURE.test(line);

/**
 * Logs Convex client messages to `sink`, except a rejected sign-in: the sign-in screen already
 * tells the user, so it is not an error worth a console entry (ADS-109). Every other failure,
 * including other `auth:signIn` errors, still logs.
 */
export const convexLogger = (sink: LogSink): ConvexLogger => ({
  logVerbose: () => undefined,
  log: (...args: ReadonlyArray<unknown>) => sink.log(...args),
  warn: (...args: ReadonlyArray<unknown>) => sink.warn(...args),
  error: (...args: ReadonlyArray<unknown>) => {
    if (Option.exists(decodeLine(args[0]), isExpectedSignInFailure)) return;

    sink.error(...args);
  },
});

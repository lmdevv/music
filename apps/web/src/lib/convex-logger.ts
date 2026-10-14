import type { ConvexReactClientOptions } from "convex/react";
import { Option, Schema } from "effect";

/** The Convex client's logger shape (the `logger` option without its `true`/`false` shorthands). */
type ConvexLogger = Exclude<NonNullable<ConvexReactClientOptions["logger"]>, boolean>;

/** Where log lines go; the browser console in the app. */
export type LogSink = Pick<Console, "log" | "warn" | "error">;

/**
 * The Convex client logs every failed action as `[CONVEX A(<path>)] <server message>`. The prefix
 * comes from the client, so this matches however much the server says: a deployment that redacts
 * errors sends only "[Request ID: …] Server Error".
 */
const SIGN_IN_FAILURE = /^\[CONVEX A\(auth:signIn\)\] /;

const decodeLine = Schema.decodeUnknownOption(Schema.String);

const isSignInFailure = (line: string): boolean => SIGN_IN_FAILURE.test(line);

/**
 * Logs Convex client messages to `sink`, except failed sign-ins (ADS-109). Convex Auth rejects a
 * wrong email or password by throwing in `auth:signIn`, and the sign-in screen reports every
 * failure of that call itself, so the console entry adds nothing; the server keeps its own log.
 * Every other function's failure still logs.
 */
export const convexLogger = (sink: LogSink): ConvexLogger => ({
  logVerbose: () => undefined,
  log: (...args: ReadonlyArray<unknown>) => sink.log(...args),
  warn: (...args: ReadonlyArray<unknown>) => sink.warn(...args),
  error: (...args: ReadonlyArray<unknown>) => {
    if (Option.exists(decodeLine(args[0]), isSignInFailure)) return;

    sink.error(...args);
  },
});

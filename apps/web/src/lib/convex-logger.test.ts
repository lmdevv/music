import { describe, expect, it } from "vitest";

import { convexLogger } from "./convex-logger";
import type { LogSink } from "./convex-logger";

/** A sink that records what reaches each console method. */
const recordingSink = () => {
  const lines: Array<readonly [level: string, args: ReadonlyArray<unknown>]> = [];

  const sink: LogSink = {
    log: (...args) => void lines.push(["log", args]),
    warn: (...args) => void lines.push(["warn", args]),
    error: (...args) => void lines.push(["error", args]),
  };

  return { lines, sink };
};

const signInFailure = (error: string) =>
  `[CONVEX A(auth:signIn)] [Request ID: c567abd5af572dac] Server Error\nUncaught Error: ${error}\n    at retrieveAccount (index.ts:602:9)`;

describe("convexLogger", () => {
  it("drops failed sign-ins, including from a deployment that redacts error details", () => {
    const { lines, sink } = recordingSink();
    const logger = convexLogger(sink);

    logger.error(signInFailure("InvalidSecret"));
    logger.error(signInFailure("InvalidAccountId"));
    logger.error(signInFailure("TooManyFailedAttempts"));
    logger.error("[CONVEX A(auth:signIn)] [Request ID: 5f0a3c] Server Error");

    expect(lines).toEqual([]);
  });

  it("still logs every other function's errors", () => {
    const { lines, sink } = recordingSink();
    const logger = convexLogger(sink);

    const other =
      "[CONVEX M(commands:run)] [Request ID: 1] Server Error\nUncaught Error: InvalidSecret";

    logger.error(other);
    logger.warn("reconnecting");
    logger.log("%c[CONVEX Q(commands:read)] [LOG]", "color:gray", "'hello'");

    expect(lines).toEqual([
      ["error", [other]],
      ["warn", ["reconnecting"]],
      ["log", ["%c[CONVEX Q(commands:read)] [LOG]", "color:gray", "'hello'"]],
    ]);
  });
});

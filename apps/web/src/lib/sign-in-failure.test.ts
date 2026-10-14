import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import { signInFailure } from "./sign-in-failure";

describe("signInFailure", () => {
  it("reads a wrong email or password as the user's input", () => {
    expect(signInFailure(new Error("[CONVEX A(auth:signIn)] Uncaught Error: InvalidSecret"))).toBe(
      "credentials",
    );
    expect(signInFailure(new Error("Uncaught Error: InvalidAccountId"))).toBe("credentials");
    expect(
      signInFailure(
        new ConvexError({ code: "unauthenticated", message: "Invalid email or password" }),
      ),
    ).toBe("credentials");
  });

  it("reads anything else as a server problem", () => {
    expect(signInFailure(new Error("[Request ID: 5f0a3c] Server Error"))).toBe("server");
    expect(signInFailure(new Error("Missing environment variable JWT_PRIVATE_KEY"))).toBe("server");
    expect(signInFailure(new ConvexError({ code: "rate_limited", message: "Try later" }))).toBe(
      "server",
    );
  });
});

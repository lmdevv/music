import { describe, expect, it } from "vitest";

import { compareText } from "./text-order";

describe("compareText", () => {
  it("orders by code point, as Convex orders index keys", () => {
    // UTF-16 puts the emoji (a surrogate pair from U+D83D) before U+FF01; code points don't.
    expect(["！", "😀"].toSorted()).toEqual(["😀", "！"]);
    expect(compareText("😀", "！")).toBeGreaterThan(0);
    expect(compareText("abc", "abd")).toBeLessThan(0);
    expect(compareText("ab", "abc")).toBeLessThan(0);
    expect(compareText("same", "same")).toBe(0);
  });
});

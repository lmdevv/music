import { describe, expect, it } from "vitest";

import { chooseSurface, shownSurface } from "./play-on";

describe("chooseSurface", () => {
  it("opens the sheet on phones, the popover with a speaker button, the dialog without one", () => {
    expect(chooseSurface({ desktop: false, popoverMounted: true })).toBe("sheet");
    expect(chooseSurface({ desktop: true, popoverMounted: true })).toBe("popover");
    expect(chooseSurface({ desktop: true, popoverMounted: false })).toBe("dialog");
  });
});

describe("shownSurface", () => {
  it("shows nothing while closed", () => {
    expect(shownSurface(null, { desktop: true, popoverMounted: true })).toBeNull();
  });

  it("keeps the dialog when a song loads and the speaker button appears", () => {
    expect(shownSurface("dialog", { desktop: true, popoverMounted: true })).toBe("dialog");
  });

  it("shows one picker across the breakpoint", () => {
    expect(shownSurface("popover", { desktop: false, popoverMounted: true })).toBe("sheet");
    expect(shownSurface("sheet", { desktop: true, popoverMounted: true })).toBe("dialog");
    expect(shownSurface("popover", { desktop: true, popoverMounted: true })).toBe("popover");
  });
});

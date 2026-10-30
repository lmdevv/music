import type { LyricsOffer } from "@music/player/lyrics";
import { describe, expect, it } from "vitest";

import { INSPECTOR_START, pickTab, pressPanel, setOpen, shownTab } from "./inspector";

describe("shownTab", () => {
  it("follows the song until a tab is picked", () => {
    expect(shownTab(null, "ready", "lyrics")).toBe("lyrics");
    expect(shownTab(null, "none", "queue")).toBe("queue");
  });

  it("waits for the first lyrics answer", () => {
    expect(shownTab(null, "loading", null)).toBeNull();
  });

  it("keeps the last answer's tab while a new song's lyrics are looked up", () => {
    expect(shownTab(null, "loading", "queue")).toBe("queue");
  });

  it("falls back from picked lyrics the song lacks, and returns for a song that has them", () => {
    for (const offer of ["none", "instrumental"] satisfies LyricsOffer[]) {
      expect(shownTab("lyrics", offer, "queue")).toBe("queue");
    }

    expect(shownTab("lyrics", "ready", "lyrics")).toBe("lyrics");
  });

  it("keeps picked lyrics that are loading or failed, which say so themselves", () => {
    expect(shownTab("lyrics", "loading", "queue")).toBe("lyrics");
    expect(shownTab("lyrics", "failed", "queue")).toBe("lyrics");
  });

  it("keeps the queue or About whatever the song's lyrics", () => {
    expect(shownTab("queue", "ready", "lyrics")).toBe("queue");
    expect(shownTab("about", "ready", "lyrics")).toBe("about");
    expect(shownTab("about", "none", "queue")).toBe("about");
  });
});

describe("the panel's open state", () => {
  it("starts open beside the content and closed over it", () => {
    expect(INSPECTOR_START.open).toEqual({ pane: true, sheet: false });
  });

  it("keeps each placement's answer through a rotation", () => {
    const hidden = setOpen(INSPECTOR_START, "pane", false);

    expect(hidden.open).toEqual({ pane: false, sheet: false });
    expect(setOpen(hidden, "sheet", true).open).toEqual({ pane: false, sheet: true });
  });

  it("keeps the picked tab when hidden", () => {
    const picked = pickTab(INSPECTOR_START, "about");

    expect(setOpen(picked, "pane", false).picked).toBe("about");
  });
});

describe("pressPanel", () => {
  it("opens a closed panel on the button's tab", () => {
    const pressed = pressPanel(INSPECTOR_START, "sheet", "queue", "lyrics");

    expect(pressed.open.sheet).toBe(true);
    expect(pressed.picked).toBe("lyrics");
  });

  it("opens a hidden panel even when that tab was showing before", () => {
    const pressed = pressPanel(setOpen(INSPECTOR_START, "pane", false), "pane", "queue", "queue");

    expect(pressed.open.pane).toBe(true);
  });

  it("switches an open panel to the other button's tab", () => {
    const pressed = pressPanel(INSPECTOR_START, "pane", "lyrics", "queue");

    expect(pressed.open.pane).toBe(true);
    expect(pressed.picked).toBe("queue");
  });

  it("switches from About to the button's tab", () => {
    const about = pickTab(INSPECTOR_START, "about");

    expect(pressPanel(about, "pane", "about", "lyrics").picked).toBe("lyrics");
  });

  it("hides the panel when the lit button is pressed, keeping the tab", () => {
    const picked = pickTab(INSPECTOR_START, "queue");
    const pressed = pressPanel(picked, "pane", "queue", "queue");

    expect(pressed.open.pane).toBe(false);
    expect(pressed.picked).toBe("queue");
  });
});

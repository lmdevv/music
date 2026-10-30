import type { LyricsOffer } from "@music/player/lyrics";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CLOSED,
  defaultPanel,
  layoutOf,
  partsOf,
  presentationOf,
  pressedPanel,
} from "./now-playing-layout";
import type { Panel, StageView } from "./now-playing-layout";

const open = (panel: Panel): StageView => ({ open: true, panel });

const closing = (panel: Panel): StageView => ({ open: false, panel });

const panels = fc.constantFrom<Panel>("queue", "lyrics");

const views = fc.oneof(fc.constant(CLOSED), panels.map(open), panels.map(closing));

const offers = fc.constantFrom<LyricsOffer>("ready", "loading", "failed", "none", "instrumental");

/** The side pane's default after each answer in turn, starting from the queue. */
const defaultsAfter = (answers: readonly LyricsOffer[]): readonly Panel[] => {
  const shown: Panel[] = [];
  let previous: Panel = "queue";

  for (const offer of answers) {
    previous = defaultPanel(offer, previous);
    shown.push(previous);
  }

  return shown;
};

describe("presentationOf", () => {
  it("keeps the native sheet on an iPhone and fills the window on an iPad", () => {
    expect(presentationOf("iPhone")).toBe("sheet");
    expect(presentationOf("iPad")).toBe("window");
  });
});

describe("layoutOf", () => {
  it("keeps the native sheet on an iPhone at any width", () => {
    fc.assert(
      fc.property(fc.constantFrom("phone", "tablet", "wide"), fc.boolean(), (width, landscape) => {
        expect(layoutOf("sheet", width, landscape)).toBe("sheet");
      }),
    );
  });

  it("fills a phone-wide Split View window on an iPad with the single column", () => {
    expect(layoutOf("window", "phone", false)).toBe("column");
    expect(layoutOf("window", "phone", true)).toBe("column");
  });

  it("shows two panes only in a wide window on its side", () => {
    expect(layoutOf("window", "wide", true)).toBe("split");
    expect(layoutOf("window", "wide", false)).toBe("column");
    expect(layoutOf("window", "tablet", true)).toBe("column");
    expect(layoutOf("window", "tablet", false)).toBe("column");
  });
});

describe("defaultPanel", () => {
  it("picks the lyrics for a song with words to read, else the queue", () => {
    expect(defaultPanel("ready", "queue")).toBe("lyrics");
    expect(defaultPanel("none", "lyrics")).toBe("queue");
    expect(defaultPanel("instrumental", "lyrics")).toBe("queue");
    expect(defaultPanel("failed", "lyrics")).toBe("queue");
  });

  it("keeps the last settled answer's pane while the next song's lyrics load", () => {
    expect(defaultsAfter(["ready", "loading", "ready"])).toEqual(["lyrics", "lyrics", "lyrics"]);
    expect(defaultsAfter(["none", "loading", "none"])).toEqual(["queue", "queue", "queue"]);
    expect(defaultsAfter(["ready", "loading", "none"])).toEqual(["lyrics", "lyrics", "queue"]);
  });

  it("never changes the pane while a lookup is loading", () => {
    fc.assert(
      fc.property(fc.array(offers, { minLength: 1, maxLength: 12 }), (answers) => {
        const shown = defaultsAfter(answers);

        answers.forEach((offer, index) => {
          if (offer === "loading") expect(shown[index]).toBe(shown[index - 1] ?? "queue");
        });
      }),
    );
  });
});

describe("partsOf", () => {
  it("shows a phone or a tablet column exactly what the person opened, in place", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("sheet", "column"),
        views,
        offers,
        panels,
        (layout, view, offer, fallback) => {
          const parts = partsOf(layout, view, offer, fallback);

          expect(parts.stage).toBe(view);
          expect(parts.side).toBeNull();
          expect(parts.lyricsFrom).toBe("cover");
        },
      ),
    );
  });

  it("folds the controls in place while the lyrics are open or closing (B12)", () => {
    expect(partsOf("sheet", open("lyrics"), "ready", "lyrics").folds).toBe(true);
    expect(partsOf("column", closing("lyrics"), "ready", "lyrics").folds).toBe(true);
    expect(partsOf("column", open("queue"), "ready", "lyrics").folds).toBe(false);
    expect(partsOf("sheet", CLOSED, "ready", "lyrics").folds).toBe(false);
  });

  it("highlights the open panel in place, and nothing while one closes", () => {
    expect(partsOf("sheet", open("queue"), "ready", "lyrics").selected).toBe("queue");
    expect(partsOf("column", closing("queue"), "ready", "lyrics").selected).toBeNull();
    expect(partsOf("column", CLOSED, "ready", "lyrics").selected).toBeNull();
  });

  it("shows the default panel in the side pane until the person picks one (P08)", () => {
    expect(partsOf("split", CLOSED, "ready", "lyrics")).toEqual({
      stage: CLOSED,
      side: "lyrics",
      folds: false,
      lyricsFrom: "row",
      selected: "lyrics",
    });
    expect(partsOf("split", CLOSED, "none", "queue").side).toBe("queue");
  });

  it("keeps the cover and never folds the controls beside the side pane", () => {
    fc.assert(
      fc.property(views, offers, panels, (view, offer, fallback) => {
        const parts = partsOf("split", view, offer, fallback);

        expect(parts.stage).toEqual(CLOSED);
        expect(parts.folds).toBe(false);
        expect(parts.side).not.toBeNull();
        expect(parts.selected).toBe(parts.side);
      }),
    );
  });

  it("moves a panel open in place into the side pane when the iPad turns wide", () => {
    expect(partsOf("split", open("queue"), "ready", "lyrics").side).toBe("queue");
    expect(partsOf("split", open("lyrics"), "ready", "lyrics").side).toBe("lyrics");
  });

  it("shows the default pane, not a panel still closing in place, when the iPad turns wide", () => {
    expect(partsOf("split", closing("lyrics"), "none", "queue").side).toBe("queue");
  });

  it("falls back from chosen lyrics to the queue, unselected, for a song with none", () => {
    for (const offer of ["none", "instrumental"] as const) {
      const parts = partsOf("split", open("lyrics"), offer, defaultPanel(offer, "lyrics"));

      expect(parts.side).toBe("queue");
      expect(parts.selected).toBe("queue");
    }
  });

  it("keeps chosen lyrics while they load or to say they failed", () => {
    expect(partsOf("split", open("lyrics"), "loading", "queue").side).toBe("lyrics");
    expect(partsOf("split", open("lyrics"), "failed", "queue").side).toBe("lyrics");
  });

  it("returns to chosen lyrics when a later song has them", () => {
    expect(partsOf("split", open("lyrics"), "ready", "lyrics").side).toBe("lyrics");
  });
});

describe("pressedPanel", () => {
  it("opens a panel in place, and closes it when pressed again (B03)", () => {
    expect(pressedPanel("sheet", CLOSED, "queue")).toBe("queue");
    expect(pressedPanel("sheet", open("queue"), "queue")).toBeNull();
    expect(pressedPanel("column", open("lyrics"), "queue")).toBe("queue");
    expect(pressedPanel("column", closing("queue"), "queue")).toBe("queue");
  });

  it("switches the side pane to the pressed panel and never empties it", () => {
    fc.assert(
      fc.property(views, panels, panels, (view, panel, fallback) => {
        const next = pressedPanel("split", view, panel);

        expect(next).toBe(panel);
        expect(partsOf("split", next === null ? CLOSED : open(next), "ready", fallback).side).toBe(
          panel,
        );
      }),
    );
  });
});

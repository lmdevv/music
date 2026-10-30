import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CLOSED, partsOf, presentationOf, pressedPanel, LAYOUT_OF } from "./now-playing-layout";
import type { Panel, StageView } from "./now-playing-layout";

const open = (panel: Panel): StageView => ({ open: true, panel });

const closing = (panel: Panel): StageView => ({ open: false, panel });

const panels = fc.constantFrom<Panel>("queue", "lyrics");

const views = fc.oneof(fc.constant(CLOSED), panels.map(open), panels.map(closing));

describe("LAYOUT_OF", () => {
  it("keeps the phone sheet below tablet, one column on a tablet, and two panes when wide", () => {
    expect(LAYOUT_OF).toEqual({ phone: "sheet", tablet: "column", wide: "split" });
  });
});

describe("presentationOf", () => {
  it("keeps the native sheet on a phone and fills the window from tablet up", () => {
    expect(presentationOf("sheet")).toBe("sheet");
    expect(presentationOf("column")).toBe("window");
    expect(presentationOf("split")).toBe("window");
  });
});

describe("partsOf", () => {
  it("shows a phone or a tablet column exactly what the person opened, in place", () => {
    fc.assert(
      fc.property(fc.constantFrom("sheet", "column"), views, fc.boolean(), (layout, view, has) => {
        const parts = partsOf(layout, view, has);

        expect(parts.stage).toBe(view);
        expect(parts.side).toBeNull();
        expect(parts.lyricsFrom).toBe("cover");
      }),
    );
  });

  it("folds the controls in place while the lyrics are open or closing (B12)", () => {
    expect(partsOf("sheet", open("lyrics"), true).folds).toBe(true);
    expect(partsOf("column", closing("lyrics"), true).folds).toBe(true);
    expect(partsOf("column", open("queue"), true).folds).toBe(false);
    expect(partsOf("sheet", CLOSED, true).folds).toBe(false);
  });

  it("highlights the open panel in place, and nothing while one closes", () => {
    expect(partsOf("sheet", open("queue"), true).selected).toBe("queue");
    expect(partsOf("column", closing("queue"), true).selected).toBeNull();
    expect(partsOf("column", CLOSED, true).selected).toBeNull();
  });

  it("shows the lyrics in the side pane by default when the song has them (P08)", () => {
    expect(partsOf("split", CLOSED, true)).toEqual({
      stage: CLOSED,
      side: "lyrics",
      folds: false,
      lyricsFrom: "row",
      selected: "lyrics",
    });
  });

  it("shows the queue in the side pane by default when the song has no lyrics", () => {
    expect(partsOf("split", CLOSED, false).side).toBe("queue");
  });

  it("keeps the cover and never folds the controls beside the side pane", () => {
    fc.assert(
      fc.property(views, fc.boolean(), (view, has) => {
        const parts = partsOf("split", view, has);

        expect(parts.stage).toEqual(CLOSED);
        expect(parts.folds).toBe(false);
        expect(parts.side).not.toBeNull();
        expect(parts.selected).toBe(parts.side);
      }),
    );
  });

  it("moves a panel open in place into the side pane when the iPad turns wide", () => {
    expect(partsOf("split", open("queue"), true).side).toBe("queue");
    expect(partsOf("split", open("lyrics"), false).side).toBe("lyrics");
  });

  it("shows the default pane, not a panel still closing in place, when the iPad turns wide", () => {
    expect(partsOf("split", closing("lyrics"), false).side).toBe("queue");
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
      fc.property(views, panels, fc.boolean(), (view, panel, has) => {
        const next = pressedPanel("split", view, panel);

        expect(next).toBe(panel);
        expect(partsOf("split", next === null ? CLOSED : open(next), has).side).toBe(panel);
      }),
    );
  });
});

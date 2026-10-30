/**
 * The iPad's Now Playing panel (Paper page 26, B1 to B3): which tab it shows and whether it is open.
 * Its Up next and Lyrics are Now Playing's panels, and until the person picks a tab it follows
 * Now Playing's `defaultPanel`, so a song without lyrics falls back to the queue and a new song's
 * lookup doesn't flip the tab.
 */
import { lyricsButton } from "@music/player/lyrics";
import type { LyricsOffer } from "@music/player/lyrics";

import type { Panel } from "./now-playing-layout";
import type { ShellLayout } from "./shell-layout";

/** What the panel's switch offers. */
export type InspectorTab = Panel | "about";

/** Where the panel sits in the frame. */
export type InspectorPlacement = Exclude<ShellLayout["inspector"], "none">;

/** What the person chose, kept in the shell across navigation and rotation. */
export interface InspectorState {
  /** The tab they picked, or null to follow the song. */
  readonly picked: InspectorTab | null;
  /**
   * Each placement keeps its own answer: rotating to portrait doesn't drop a sheet over the page
   * because the pane was open, and rotating back finds the pane as it was left.
   */
  readonly open: Readonly<Record<InspectorPlacement, boolean>>;
}

/** Beside the content the panel starts open; over it, it waits to be asked for. */
export const INSPECTOR_START: InspectorState = {
  picked: null,
  open: { pane: true, sheet: false },
};

/**
 * The tab showing for a song whose lyrics are `offer`: the one picked, unless that is lyrics the
 * song lacks, else `fallback`, which is null until the first lyrics answer settles.
 */
export const shownTab = (
  picked: InspectorTab | null,
  offer: LyricsOffer,
  fallback: Panel | null,
): InspectorTab | null => {
  if (picked === null) return fallback;

  return picked === "lyrics" && lyricsButton(offer, false).disabled ? fallback : picked;
};

/** Chooses a tab from the panel's switch. */
export const pickTab = (state: InspectorState, tab: InspectorTab): InspectorState => ({
  ...state,
  picked: tab,
});

/** Sets whether the panel is open at `placement`. */
export const setOpen = (
  state: InspectorState,
  placement: InspectorPlacement,
  open: boolean,
): InspectorState => ({ ...state, open: { ...state.open, [placement]: open } });

/**
 * What the player bar's button for `panel` does while `shown` is the tab showing: hides the panel
 * when that button is lit, and otherwise opens the panel on `panel`.
 */
export const pressPanel = (
  state: InspectorState,
  placement: InspectorPlacement,
  shown: InspectorTab | null,
  panel: Panel,
): InspectorState =>
  state.open[placement] && shown === panel
    ? setOpen(state, placement, false)
    : setOpen(pickTab(state, panel), placement, true);

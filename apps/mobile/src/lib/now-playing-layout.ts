/**
 * What Now Playing shows at each window width (Paper page 25). On a phone (B01) and in the iPad's
 * single column (P07) the queue (B03) and the lyrics (B12) open in place of the cover. From `wide`
 * (P08, P09) the cover stays, and a side pane beside the player always holds one of the two: the
 * one the person opened, else the lyrics when the song has them, else the queue. One stage view
 * serves every width, so rotating keeps what the person opened.
 */
import type { WidthClass } from "./layout";

/** What opens in place of the cover, or shows in the side pane. */
export type Panel = "queue" | "lyrics";

/**
 * What the person opened: the cover, or a panel. Closed, `panel` is the one still closing, kept
 * until the cover is back so it can animate, then null, so nothing in it (the lyrics' frame loop)
 * runs behind the cover.
 */
export type StageView =
  | { readonly open: false; readonly panel: Panel | null }
  | { readonly open: true; readonly panel: Panel };

/** The cover, with nothing open or closing. */
export const CLOSED: StageView = { open: false, panel: null };

/**
 * Now Playing's layout: the phone's native `sheet`; the iPad's centered `column`, which fills the
 * window; or `split`, the player beside the side pane.
 */
export type NowPlayingLayout = "sheet" | "column" | "split";

/** The layout each width class gets. */
export const LAYOUT_OF: Readonly<Record<WidthClass, NowPlayingLayout>> = {
  phone: "sheet",
  tablet: "column",
  wide: "split",
};

/**
 * How Now Playing is presented: the phone's native `sheet`, which the system drags down (B11), or
 * over the whole `window` (P07), which the app drags down itself.
 */
export type NowPlayingPresentation = "sheet" | "window";

/** The presentation for a layout: only the phone's keeps the native sheet. */
export const presentationOf = (layout: NowPlayingLayout): NowPlayingPresentation =>
  layout === "sheet" ? "sheet" : "window";

/** What Now Playing renders for a stage view at one layout. */
export interface NowPlayingParts {
  /** What the player's stage shows in place: the stage view, or always the cover beside a pane. */
  readonly stage: StageView;
  /** The side pane's panel, or null when there is no side pane. */
  readonly side: Panel | null;
  /** Whether the controls fold the volume and the bottom row away for the lyrics (B12). */
  readonly folds: boolean;
  /** Where the lyrics open from: the chip on the cover, or a button in the bottom row (P08). */
  readonly lyricsFrom: "cover" | "row";
  /** The panel the bottom row highlights, if any. */
  readonly selected: Panel | null;
}

/** What renders at `layout` for `view`; `hasLyrics` picks the side pane before the person does. */
export const partsOf = (
  layout: NowPlayingLayout,
  view: StageView,
  hasLyrics: boolean,
): NowPlayingParts => {
  if (layout === "split") {
    const side = view.open ? view.panel : hasLyrics ? "lyrics" : "queue";

    return { stage: CLOSED, side, folds: false, lyricsFrom: "row", selected: side };
  }

  return {
    stage: view,
    side: null,
    folds: view.panel === "lyrics",
    lyricsFrom: "cover",
    selected: view.open ? view.panel : null,
  };
};

/**
 * What pressing the bottom row's button for `panel` opens: in place it opens the panel or closes
 * it again; the side pane switches to it and never empties.
 */
export const pressedPanel = (
  layout: NowPlayingLayout,
  view: StageView,
  panel: Panel,
): Panel | null => {
  if (layout === "split") return panel;

  return view.open && view.panel === panel ? null : panel;
};

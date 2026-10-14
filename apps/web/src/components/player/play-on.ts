/**
 * Where "Play on" shows: the player bar's popover on desktop, a dialog on desktop while the bar
 * has no speaker button (nothing loaded), and the sheet below the desktop width.
 */
export type PlayOnSurface = "popover" | "dialog" | "sheet";

/** What decides the surface: the layout width, and whether the bar's speaker button exists. */
export interface PlayOnLayout {
  readonly desktop: boolean;
  readonly popoverMounted: boolean;
}

/** The surface a newly opened "Play on" uses; it keeps it until the user closes it. */
export const chooseSurface = ({ desktop, popoverMounted }: PlayOnLayout): PlayOnSurface => {
  if (!desktop) return "sheet";

  return popoverMounted ? "popover" : "dialog";
};

/**
 * The surface to show for an open "Play on" now. Across the phone/desktop breakpoint there is only
 * ever one (ADS-106): phones show the sheet, and desktop shows what was opened, except that a
 * request made on a phone, or a popover whose button is gone, shows as the dialog.
 */
export const shownSurface = (
  opened: PlayOnSurface | null,
  { desktop, popoverMounted }: PlayOnLayout,
): PlayOnSurface | null => {
  if (opened === null) return null;

  if (!desktop) return "sheet";

  return opened === "popover" && popoverMounted ? "popover" : "dialog";
};

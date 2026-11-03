import type { ReactNode } from "react";

import { ALT, MOD } from "../../lib/keys";

/**
 * The `HOTKEYS` id of a key combination that runs one of the selected row's actions: Enter,
 * or Enter with ⌘ (Ctrl elsewhere), Shift, or Alt.
 */
export type Chord =
  | "command-menu.enter"
  | "command-menu.mod-enter"
  | "command-menu.shift-enter"
  | "command-menu.alt-enter";

/** Every chord, in the order a preview lays out its buttons. */
export const CHORDS: ReadonlyArray<Chord> = [
  "command-menu.enter",
  "command-menu.mod-enter",
  "command-menu.shift-enter",
  "command-menu.alt-enter",
];

/** How each chord is drawn on a keycap. */
export const CHORD_LABELS: Readonly<Record<Chord, string>> = {
  "command-menu.enter": "↵",
  "command-menu.mod-enter": `${MOD}↵`,
  "command-menu.shift-enter": "⇧↵",
  "command-menu.alt-enter": `${ALT}↵`,
};

/** One button in a preview, run by clicking it or by pressing its chord in the search field. */
export interface PreviewAction {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  /** Whether the action is still running; it can't run again until it settles. */
  readonly pending?: boolean;
  readonly run: () => void;
}

/**
 * A preview's actions by the chord that runs them, so no two share a chord. The Enter action is
 * the preview's main one: its button is solid, the footer names it, and clicking the row runs it.
 */
export type ChordActions = Readonly<Partial<Record<Chord, PreviewAction>>>;

/** The action `chord` runs, or null when there is none or it is disabled or still running. */
export const runnableAction = (actions: ChordActions, chord: Chord): PreviewAction | null => {
  const action = actions[chord];

  return action === undefined || action.disabled === true || action.pending === true
    ? null
    : action;
};

/**
 * The words of Library → Downloaded (Paper's D09 and D10): the category's count, the page's
 * filters and storage summary, and each download's line under its title.
 */
import type { DownloadedItem, DownloadUsage, TrackDownloadState } from "@music/sdk/downloads";
import { Match } from "effect";

import { countOf, formatBytes } from "./format";

/** The page's filter chips. */
export const DOWNLOADED_FILTERS = [
  { value: "all", label: "All" },
  { value: "albums", label: "Albums" },
  { value: "playlists", label: "Playlists" },
  { value: "songs", label: "Songs" },
] as const;

/** What the page lists. */
export type DownloadedFilter = (typeof DOWNLOADED_FILTERS)[number]["value"];

/** The downloads a filter shows; `songs` lists every song on the phone instead. */
export const downloadsFor = (
  filter: Exclude<DownloadedFilter, "songs">,
  downloads: ReadonlyArray<DownloadedItem>,
): ReadonlyArray<DownloadedItem> =>
  filter === "all"
    ? downloads
    : downloads.filter((item) => item.target.kind === (filter === "albums" ? "album" : "playlist"));

/** `55 SONGS · 3 ALBUMS · 1 PLAYLIST`, the mono line over the list. */
export const downloadedSummary = (
  usage: DownloadUsage,
  downloads: ReadonlyArray<DownloadedItem>,
): string =>
  [
    countOf(usage.tracks, "song"),
    countOf(downloads.filter((item) => item.target.kind === "album").length, "album"),
    countOf(downloads.filter((item) => item.target.kind === "playlist").length, "playlist"),
  ]
    .join(" · ")
    .toLocaleUpperCase();

/** The sentence under the summary, with the free space when iOS reports it. */
export const downloadedNote = (usage: DownloadUsage): string =>
  usage.freeBytes === null
    ? "Plays with no connection to your server."
    : `Plays with no connection to your server. ${formatBytes(usage.freeBytes)} still free on this iPhone.`;

/** The line under a download's title, the glyph before it, and its color. */
export interface DownloadedLine {
  readonly text: string;
  readonly glyph: TrackDownloadState | null;
  readonly tone: "muted" | "danger";
}

const KINDS = { track: "Song", album: "Album", playlist: "Playlist" } as const;

/** `Album · Massive Attack`, `Playlist · 24 songs`, or where a download still coming stands. */
export const downloadedLine = (item: DownloadedItem): DownloadedLine => {
  // A playlist names its songs, as D10 draws it; an album or song names its artist.
  const who =
    item.target.kind === "playlist" && item.songs !== null
      ? countOf(item.songs, "song")
      : item.subtitle;

  const line = (text: string, glyph: TrackDownloadState | null = null): DownloadedLine => ({
    text: `${text} · ${who}`,
    glyph,
    tone: "muted",
  });

  return Match.value(item.status).pipe(
    Match.discriminatorsExhaustive("kind")({
      none: () => line(KINDS[item.target.kind]),
      downloaded: () => line(KINDS[item.target.kind]),
      included: () => line(KINDS[item.target.kind]),
      unavailable: () => line("No longer available"),
      queued: () => line("Waiting to download", "queued"),
      waiting: ({ reason }) =>
        line(reason === "offline" ? "Waiting for your server" : "Waiting for space", "queued"),
      downloading: ({ done, total }) =>
        line(`Downloading ${String(done)} of ${String(total)}`, "downloading"),
      failed: ({ failed, total }): DownloadedLine => ({
        text: `Couldn’t download ${String(failed)} of ${String(total)} · ${who}`,
        glyph: "failed",
        tone: "danger",
      }),
    }),
  );
};

/** The Library row's count, such as `55 songs`; none while nothing is downloaded. */
export const downloadedCount = (usage: DownloadUsage): string | null =>
  usage.tracks === 0 ? null : countOf(usage.tracks, "song");

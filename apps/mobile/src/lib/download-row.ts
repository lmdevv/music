/**
 * The Download row of the song (A11) and playlist (C08) sheets, per Paper's downloads proposal:
 * Download, Cancel download while songs are still coming, Remove download once they're here.
 */
import type { DownloadStatus } from "@music/sdk/downloads";
import { Match } from "effect";

import { formatBytes } from "./format";

/** What pressing the row does. */
type DownloadRowAction = "download" | "remove" | "none";

/** The row's words and its press. */
export interface DownloadRowLabel {
  readonly action: DownloadRowAction;
  readonly title: string;
  readonly subtitle: string | null;
}

/** The row for a download in `status`; `canToggle` is false while adding needs the server. */
export const downloadRow = (status: DownloadStatus, canToggle: boolean): DownloadRowLabel =>
  Match.value(status).pipe(
    Match.discriminatorsExhaustive("kind")({
      none: (): DownloadRowLabel => ({
        action: canToggle ? "download" : "none",
        title: "Download",
        subtitle: canToggle ? null : "Downloads need a connection to the server",
      }),
      queued: (): DownloadRowLabel => ({
        action: "remove",
        title: "Cancel download",
        subtitle: "Waiting to download",
      }),
      downloading: ({ done, total }): DownloadRowLabel => ({
        action: "remove",
        title: "Cancel download",
        subtitle: `Downloading ${String(done)} of ${String(total)}`,
      }),
      waiting: ({ reason }): DownloadRowLabel => ({
        action: "remove",
        title: "Cancel download",
        subtitle:
          reason === "offline"
            ? "Waiting for a connection to the server"
            : "Waiting for space on this iPhone",
      }),
      failed: ({ failed, total }): DownloadRowLabel => ({
        action: "remove",
        title: "Cancel download",
        subtitle: `Couldn’t download ${String(failed)} of ${String(total)}`,
      }),
      downloaded: ({ bytes }): DownloadRowLabel => ({
        action: "remove",
        title: "Remove download",
        subtitle: `Frees ${formatBytes(bytes)} on this iPhone`,
      }),
      unavailable: (): DownloadRowLabel => ({
        action: "remove",
        title: "Remove download",
        subtitle: "No longer available",
      }),
      included: ({ by }): DownloadRowLabel => ({
        action: "none",
        title: "Downloaded",
        subtitle: `With ${by.title}`,
      }),
    }),
  );

/**
 * The Download rows of the song (A11) and playlist (C08) sheets, per Paper's downloads proposal:
 * Download, Cancel download while songs are still coming, Remove download once they're here, and
 * Retry download above Cancel download once songs failed.
 */
import type { DownloadStatus } from "@music/sdk/downloads";
import { Match } from "effect";

import { formatBytes } from "./format";

/** What pressing a row does. */
type DownloadRowAction = "download" | "retry" | "remove" | "none";

/** A row's words and its press. */
export interface DownloadRowLabel {
  readonly action: DownloadRowAction;
  readonly title: string;
  readonly subtitle: string | null;
}

/** Cancel download, with what is happening to the songs still to come. */
const cancel = (subtitle: string | null): DownloadRowLabel => ({
  action: "remove",
  title: "Cancel download",
  subtitle,
});

/** The rows for a download in `status`; `canToggle` is false while adding needs the server. */
export const downloadRows = (
  status: DownloadStatus,
  canToggle: boolean,
): ReadonlyArray<DownloadRowLabel> =>
  Match.value(status).pipe(
    Match.discriminatorsExhaustive("kind")({
      none: (): ReadonlyArray<DownloadRowLabel> => [
        {
          action: canToggle ? "download" : "none",
          title: "Download",
          subtitle: canToggle ? null : "Downloads need a connection to the server",
        },
      ],
      queued: (): ReadonlyArray<DownloadRowLabel> => [cancel("Waiting to download")],
      downloading: ({ done, total }): ReadonlyArray<DownloadRowLabel> => [
        cancel(`Downloading ${String(done)} of ${String(total)}`),
      ],
      waiting: ({ reason }): ReadonlyArray<DownloadRowLabel> => [
        cancel(
          reason === "offline"
            ? "Waiting for a connection to the server"
            : "Waiting for space on this iPhone",
        ),
      ],
      failed: ({ failed, total }): ReadonlyArray<DownloadRowLabel> => [
        {
          action: "retry",
          title: "Retry download",
          subtitle: `Couldn’t download ${String(failed)} of ${String(total)}`,
        },
        cancel(null),
      ],
      downloaded: ({ bytes }): ReadonlyArray<DownloadRowLabel> => [
        {
          action: "remove",
          title: "Remove download",
          subtitle: `Frees ${formatBytes(bytes)} on this iPhone`,
        },
      ],
      unavailable: (): ReadonlyArray<DownloadRowLabel> => [
        { action: "remove", title: "Remove download", subtitle: "No longer available" },
      ],
      included: ({ by }): ReadonlyArray<DownloadRowLabel> => [
        { action: "none", title: "Downloaded", subtitle: `With ${by.title}` },
      ],
    }),
  );

/**
 * Where the player's commands go. The playback session normally lives on the server; a device
 * that loses the server mid-song can carry on with a session of its own. The controller and the
 * player's actions send every command through a `SessionPort` and never learn which one runs.
 */
import type { MusicClient } from "@music/sdk/client";

/** Whether session commands go to the server, or to this device's own session while offline. */
export type SessionMode = "server" | "local";

/** What the controller and the player's actions send commands through. */
export interface SessionPort {
  /** Where session commands go right now. */
  readonly mode: () => SessionMode;
  /**
   * Runs a mutation. Session commands (`playback.*` and `queue.*`) go where `mode` says; every
   * other command goes to the server. Rejects the way `MusicClient.run` does, with an expected
   * failure the player shows.
   */
  readonly run: MusicClient["run"];
}

/** A session that always runs on the server: the web's, and any device without downloads. */
export const serverSession = (client: Pick<MusicClient, "run">): SessionPort => ({
  mode: () => "server",
  run: client.run,
});

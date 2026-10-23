/**
 * The commands that move the playback session. Derived from the registry, so a new `playback.*` or
 * `queue.*` mutation joins without anyone editing a list; a device's own session (the player's
 * `LocalSession`) must then handle or refuse it before the build passes.
 */
import type { MutationName } from "./registry";

/** Every `playback.*` and `queue.*` mutation: what a player routes to the session it plays. */
export type SessionMutation = Extract<MutationName, `playback.${string}` | `queue.${string}`>;

/** Whether `name` moves the playback session, as {@link SessionMutation} names them. */
export const isSessionMutation = (name: MutationName): name is SessionMutation =>
  name.startsWith("playback.") || name.startsWith("queue.");

/**
 * Where the player's commands go. The playback session normally lives on the server; a device
 * that loses the server mid-song carries on with a session of its own (`local-session.ts`) and
 * hands it back when the server answers again. The controller and the player's actions send every
 * command through a `SessionPort` and never learn which one runs.
 */
import type { TrackId } from "@music/commands/ids";
import type { OfflinePlay, PlaybackState } from "@music/commands/models";
import type { CommandArgs, CommandResult, MutationName } from "@music/commands/registry";
import { isSessionMutation } from "@music/commands/session-commands";
import type { SessionMutation } from "@music/commands/session-commands";
import type { MusicClient } from "@music/sdk/client";
import { ConvexError } from "convex/values";
import { Result } from "effect";

import {
  emptyLocal,
  localView,
  offlineResume,
  refusalFailure,
  seedLocal,
  stepLocal,
} from "./local-session";
import type { LocalContext, LocalDevice, LocalSessionState, PlayableTrack } from "./local-session";

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

/**
 * How long a session command may go unanswered before this device carries on with its own
 * session. A connection that died without the socket noticing shows up this way.
 */
export const ACK_DEADLINE_MS = 4000;

/**
 * Offline plays sent per `devices.reconcile`. Well under the server's check of a user's latest
 * 500 plays, so a batch sent again after its answer was lost is still recognised, even with plays
 * from other devices in between.
 */
const PLAYS_PER_RECONCILE = 200;

/** The first wait before a failed hand-back is tried again; it doubles up to the longest. */
const RETRY_FIRST_MS = 1000;

const RETRY_LONGEST_MS = 30_000;

/** Stands in for a callback until the real one is set. */
const doNothing = (): void => {};

/** Whether the server's connection is up, from the host's Convex client. */
export interface ConnectionSignal {
  readonly connected: () => boolean;
  /** Calls `listener` when the connection goes up or down. Returns the unsubscribe function. */
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * Where a device keeps its own session and the server's last snapshot across launches (the
 * downloads database on a phone). Writes may fail: the router carries on from memory and writes
 * again at its next change.
 */
export interface SessionStore {
  readonly load: () => Promise<StoredSessions>;
  /** Saves this device's own session, or clears it (null) once the server took it back. */
  readonly saveLocal: (state: LocalSessionState | null) => Promise<void>;
  /** Saves the server's latest snapshot, for a launch without a connection. May coalesce writes. */
  readonly saveServer: (state: PlaybackState) => Promise<void>;
}

/** What a `SessionStore` holds, each parsed when read back. */
export interface StoredSessions {
  /** This device's own session, when it played one and has not handed it back yet. */
  readonly local: LocalSessionState | null;
  readonly server: PlaybackState | null;
}

/** Time as the router sees it: the device clock and one-shot timers. */
export interface RouterClock {
  readonly now: () => number;
  /** Calls `callback` once after `ms`. Returns the function that cancels it. */
  readonly after: (ms: number, callback: () => void) => () => void;
}

/** The wall clock and `setTimeout`. */
export const systemClock: RouterClock = {
  now: Date.now,
  after: (ms, callback) => {
    const timer = setTimeout(callback, ms);

    return () => {
      clearTimeout(timer);
    };
  },
};

/** What the router shows the player. Replaced, never mutated. */
export interface RouterSnapshot {
  readonly mode: SessionMode;
  /** The session the engine follows; undefined until the server or the store answers. */
  readonly state: PlaybackState | undefined;
  /** This device's own session is being handed back; the player keeps showing it meanwhile. */
  readonly reconciling: boolean;
}

/** What a `SessionRouter` is built from. */
export interface SessionRouterDeps {
  readonly client: MusicClient;
  readonly connection: ConnectionSignal;
  readonly store: SessionStore;
  /** This device: where its own session plays. */
  readonly device: LocalDevice;
  /** A song this device can play without the server (it holds a copy), or null. */
  readonly playable: (trackId: TrackId) => PlayableTrack | null;
  readonly clock: RouterClock;
  /** Uniform in `[0, 1)`, for shuffling. */
  readonly random: () => number;
  /** Overrides `ACK_DEADLINE_MS`. */
  readonly ackDeadlineMs?: number;
}

/**
 * Routes session commands to the server while it answers, and to this device's own session while
 * it doesn't. It moves the session onto the device when the connection drops, or when a command
 * goes unanswered past the deadline, as long as this device plays the session (or nothing does)
 * and it isn't listening along to someone's Jam. When the connection is back it hands the session
 * back with `devices.reconcile`: the plays for history, then the queue, which the server adopts
 * while it still names this device active or the device still plays.
 */
export class SessionRouter implements SessionPort {
  readonly #client: MusicClient;
  readonly #connection: ConnectionSignal;
  readonly #store: SessionStore;
  readonly #device: LocalDevice;
  readonly #playable: (trackId: TrackId) => PlayableTrack | null;
  readonly #clock: RouterClock;
  readonly #random: () => number;
  readonly #ackDeadlineMs: number;
  readonly #listeners = new Set<() => void>();

  /** This device's own session; null while the session runs on the server. */
  #local: LocalSessionState | null = null;
  /** The server's latest snapshot, kept while local too, to show if the server keeps its own. */
  #server: PlaybackState | null = null;
  /** Counts commands applied locally, so a hand-back can tell the session moved while it was sent. */
  #applied = 0;
  #reconciling = false;
  #retryMs = RETRY_FIRST_MS;
  #cancelRetry: (() => void) | null = null;
  /** Session commands still out with the server; a hand-back waits until each has landed. */
  readonly #outstanding = new Set<Promise<void>>();
  /** The store, read once: the session it holds is taken up at most once. */
  #stored: Promise<StoredSessions | null> | null = null;
  #storedTaken = false;
  #snapshot: RouterSnapshot = { mode: "server", state: undefined, reconciling: false };

  constructor(deps: SessionRouterDeps) {
    this.#client = deps.client;
    this.#connection = deps.connection;
    this.#store = deps.store;
    this.#device = deps.device;
    this.#playable = deps.playable;
    this.#clock = deps.clock;
    this.#random = deps.random;
    this.#ackDeadlineMs = deps.ackDeadlineMs ?? ACK_DEADLINE_MS;
  }

  /** Where session commands go right now. */
  mode = (): SessionMode => (this.#local === null ? "server" : "local");

  /** The current snapshot. Stable between changes, for `useSyncExternalStore`. */
  getSnapshot = (): RouterSnapshot => this.#snapshot;

  /** Calls `listener` after every snapshot change. Returns the unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * Follows the connection, and picks up a session this device played offline and has not
   * handed back yet (the app closed meanwhile). Returns the function that stops it.
   */
  start(): () => void {
    const unsubscribe = this.#connection.subscribe(this.#onConnection);

    void this.#resumeStored();

    return () => {
      unsubscribe();
      this.#cancelRetry?.();
      this.#cancelRetry = null;
    };
  }

  /**
   * A snapshot of the server's session. Shown while the session runs on the server; while this
   * device plays its own, it is out of date by definition and only kept.
   */
  offerServer(state: PlaybackState): void {
    this.#server = state;

    if (this.#local !== null) return;
    this.#save(this.#store.saveServer(state));
    this.#publish(state);
  }

  /**
   * Starts this device's own session at a launch without the server: the one it played before,
   * else the server's session as it last saw it, else an empty one. Paused, since nothing plays
   * at launch.
   */
  async startLocal(): Promise<void> {
    if (this.mode() === "local") return;
    const stored = await this.#loadStored();

    this.#takeStored(stored);

    // The stored session resumed, or the connection dropped, while the store was read.
    if (this.mode() === "local") return;
    const now = this.#clock.now();
    const server = stored?.server ?? this.#server;
    const session = server === null ? emptyLocal(now) : seedLocal(server, this.#device.id);

    this.#enterLocal({ ...session, playing: false, updatedAt: now });
  }

  /** Runs a mutation; see {@link SessionPort.run}. */
  run = <Name extends MutationName>(
    name: Name,
    args: CommandArgs<Name>,
  ): Promise<CommandResult<Name>> => {
    if (!isSessionMutation(name)) return this.#client.run(name, args);

    return this.#local === null ? this.#runOnServer(name, args) : this.#runHere(name, args);
  };

  /** Sends a session command to the server, counted as outstanding until it has landed. */
  async #runOnServer<Name extends SessionMutation>(
    name: Name,
    args: CommandArgs<Name>,
  ): Promise<CommandResult<Name>> {
    let land = doNothing;

    const landed = new Promise<void>((resolve) => {
      land = resolve;
    });

    this.#outstanding.add(landed);

    try {
      return await this.#answerOrTakeOver(name, args);
    } finally {
      this.#outstanding.delete(landed);
      land();
    }
  }

  /**
   * The server's answer to a session command. Past the deadline, if this device can carry the
   * command out itself, the session moves here and the command applies here. A command answered
   * after the session moved here applies here too, so it isn't lost when the session is handed
   * back. The server may still run a command that missed its deadline; the hand-back runs after
   * it, in order, and replaces what it did.
   */
  async #answerOrTakeOver<Name extends SessionMutation>(
    name: Name,
    args: CommandArgs<Name>,
  ): Promise<CommandResult<Name>> {
    const sent = this.#client.run(name, args);

    // Handles a rejection too, so one the player no longer waits for is never left unhandled.
    const answered = sent.then(
      () => "answered" as const,
      () => "answered" as const,
    );

    let cancel = doNothing;

    const late = new Promise<"late">((resolve) => {
      cancel = this.#clock.after(this.#ackDeadlineMs, () => {
        resolve("late");
      });
    });

    const first = await Promise.race([answered, late]);

    if (first === "late" && this.#takeOver(name, args)) return this.#runHere(name, args);
    cancel();
    await answered;

    return this.mode() === "server" ? sent : this.#runHere(name, args);
  }

  /** Applies a session command to this device's own session. A refusal rejects as a failure. */
  async #runHere<Name extends SessionMutation>(
    name: Name,
    args: CommandArgs<Name>,
  ): Promise<CommandResult<Name>> {
    const local = this.#local;

    if (local === null) return this.#client.run(name, args);
    const stepped = stepLocal(name, local, args, this.#context());

    // The same failure shape the server sends, so the player shows it like any refused command.
    if (Result.isFailure(stepped)) {
      const { code, message } = refusalFailure(stepped.failure);

      throw new ConvexError({ code, message });
    }

    this.#applied += 1;
    this.#setLocal(stepped.success.state);

    return stepped.success.result;
  }

  /**
   * Moves the session onto this device for a command that went unanswered, seeded from the
   * session the player shows. Only when this device plays it (or nothing does), it isn't
   * listening along, and the command can run here; otherwise the command keeps waiting for the
   * server. Returns whether the session is now here.
   */
  #takeOver<Name extends SessionMutation>(name: Name, args: CommandArgs<Name>): boolean {
    if (this.#local !== null) return true;
    const shown = this.#snapshot.state;

    if (shown === undefined || !this.#mayTakeOver(shown)) return false;
    const seeded = seedLocal(shown, this.#device.id);

    if (Result.isFailure(stepLocal(name, seeded, args, this.#context()))) return false;
    this.#enterLocal(seeded);

    return true;
  }

  #mayTakeOver(shown: PlaybackState): boolean {
    const active = shown.activeDevice?.id ?? null;

    return !shown.following && (active === null || active === this.#device.id);
  }

  #onConnection = (): void => {
    if (this.#connection.connected()) {
      void this.#reconcile();

      return;
    }

    const shown = this.#snapshot.state;

    // The session the player shows is the server's; carrying it on here keeps it unchanged.
    if (this.#local === null && shown !== undefined && this.#mayTakeOver(shown)) {
      this.#enterLocal(seedLocal(shown, this.#device.id));
    }
  };

  async #resumeStored(): Promise<void> {
    this.#takeStored(await this.#loadStored());
  }

  /**
   * Takes up the session this device stored and did not hand back, once, paused: nothing plays
   * at launch. When a session already moved here since launch, it keeps that one and adds the
   * stored plays before its own, so none is lost.
   */
  #takeStored(stored: StoredSessions | null): void {
    const previous = stored?.local ?? null;

    if (previous === null || this.#storedTaken) return;
    this.#storedTaken = true;
    const local = this.#local;

    if (local === null) {
      this.#enterLocal({ ...previous, playing: false, updatedAt: this.#clock.now() });

      return;
    }

    this.#setLocal({ ...local, plays: [...previous.plays, ...local.plays] });
  }

  #loadStored(): Promise<StoredSessions | null> {
    this.#stored ??= this.#readStore();

    return this.#stored;
  }

  async #readStore(): Promise<StoredSessions | null> {
    try {
      return await this.#store.load();
    } catch {
      // An unreadable store holds nothing to resume.
      return null;
    }
  }

  #enterLocal(state: LocalSessionState): void {
    this.#setLocal(state);

    if (this.#connection.connected()) void this.#reconcile();
  }

  #setLocal(state: LocalSessionState): void {
    this.#local = state;
    this.#save(this.#store.saveLocal(state));
    this.#publish(localView(state, this.#device));
  }

  /**
   * Hands this device's own session back to the server, once at a time and only while
   * connected. Repeats while the session moved meanwhile; a failure is tried again later.
   */
  async #reconcile(): Promise<void> {
    if (this.#reconciling || this.#local === null || !this.#connection.connected()) return;
    this.#cancelRetry?.();
    this.#cancelRetry = null;
    this.#reconciling = true;
    this.#publish(this.#snapshot.state);

    try {
      // Commands sent before the session moved here land here first, so the hand-back has them.
      await Promise.all(this.#outstanding);
      const adopted = await this.#handBack();

      this.#retryMs = RETRY_FIRST_MS;
      this.#finishHandBack(adopted);
    } catch {
      this.#retryLater();
    } finally {
      this.#reconciling = false;
      this.#publish(this.#snapshot.state);
    }
  }

  /**
   * Sends the plays a batch at a time, dropping each batch once the server has it, and the queue
   * with the last. Again while commands applied here meanwhile. Resolves whether the server
   * adopted the queue.
   */
  async #handBack(): Promise<boolean> {
    const local = this.#local;

    if (local === null) return false;
    const applied = this.#applied;
    const plays = local.plays.slice(0, PLAYS_PER_RECONCILE);
    const last = plays.length === local.plays.length;

    const { adopted } = await this.#client.run("devices.reconcile", {
      deviceId: this.#device.id,
      plays,
      resume: last ? offlineResume(local, this.#clock.now()) : null,
    });

    this.#dropHandedBack(plays);

    return last && applied === this.#applied ? adopted : this.#handBack();
  }

  /** Forgets plays the server now holds; plays are only ever added at the end. */
  #dropHandedBack(plays: ReadonlyArray<OfflinePlay>): void {
    const local = this.#local;

    if (local === null || plays.length === 0) return;
    this.#local = { ...local, plays: local.plays.slice(plays.length) };
    this.#save(this.#store.saveLocal(this.#local));
  }

  /**
   * The session runs on the server again. When the server adopted this device's queue, the player
   * keeps showing it until the server's next snapshot, which shows the same session, so the engine
   * sees no change. Otherwise the server kept its own session, which shows now.
   */
  #finishHandBack(adopted: boolean): void {
    this.#local = null;
    this.#save(this.#store.saveLocal(null));
    this.#publish(adopted || this.#server === null ? this.#snapshot.state : this.#server);
  }

  #retryLater(): void {
    const delay = this.#retryMs;

    this.#retryMs = Math.min(delay * 2, RETRY_LONGEST_MS);

    this.#cancelRetry = this.#clock.after(delay, () => {
      this.#cancelRetry = null;
      void this.#reconcile();
    });
  }

  #context(): LocalContext {
    return {
      now: this.#clock.now(),
      device: this.#device,
      playable: this.#playable,
      random: this.#random,
    };
  }

  /** A store write that failed leaves the last good row; the next change writes again. */
  #save(write: Promise<void>): void {
    void write.catch(() => {});
  }

  #publish(state: PlaybackState | undefined): void {
    const next: RouterSnapshot = { mode: this.mode(), state, reconciling: this.#reconciling };
    const current = this.#snapshot;

    if (
      next.mode === current.mode &&
      next.state === current.state &&
      next.reconciling === current.reconciling
    ) {
      return;
    }

    this.#snapshot = next;

    for (const listener of this.#listeners) listener();
  }
}

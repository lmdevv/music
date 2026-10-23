/**
 * Whether the connected server answers, for the session phase and for the screens that change
 * while it is out of reach (D11 to D14).
 */
import { useConvexConnectionState } from "convex/react";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { SettledPhase } from "@/lib/session-phase";

/** How long a remembered server may stay silent at launch before G05 offers a way out. */
export const SILENT_AFTER_MS = 8000;

/**
 * How long a remembered server may stay silent before the app opens on the downloads (D11), or
 * shows that it lost the server (D14). Shorter than G05's wait: the downloads play either way.
 */
export const OFFLINE_AFTER_MS = 2500;

/** Whether the WebSocket has been down for `afterMs` while the app waits on it. */
export const useSilentServer = (afterMs: number = SILENT_AFTER_MS): boolean => {
  const { isWebSocketConnected } = useConvexConnectionState();
  const [silent, setSilent] = useState(false);

  useEffect(() => {
    setSilent(false);

    if (isWebSocketConnected) return undefined;

    const timer = setTimeout(() => setSilent(true), afterMs);

    return () => clearTimeout(timer);
  }, [isWebSocketConnected, afterMs]);

  return silent;
};

const ShownPhaseContext = createContext<SettledPhase | null>(null);

/** Hands the phase on show to the screens below it. */
export function ShownPhaseProvider({
  phase,
  children,
}: {
  readonly phase: SettledPhase;
  readonly children: ReactNode;
}) {
  return <ShownPhaseContext value={phase}>{children}</ShownPhaseContext>;
}

/**
 * How long the connection may be down, or a request unanswered, before the app says it lost the
 * server (G04): a blip or a return from the background recovers sooner, without a flash.
 */
const RECONNECTING_AFTER_MS = 5000;

/**
 * Whether the connection has been down, or a request waiting, for `RECONNECTING_AFTER_MS` after it
 * was up. A server that stops answering without closing the socket only shows as a closed socket
 * after Convex's 60 second silence check, so a request left waiting counts too: the player sends
 * one at least every 30 seconds.
 */
const useReconnecting = (): boolean => {
  const { isWebSocketConnected, hasEverConnected, hasInflightRequests } =
    useConvexConnectionState();

  const waiting = !isWebSocketConnected || hasInflightRequests;
  const [late, setLate] = useState(false);

  useEffect(() => {
    setLate(false);

    if (!waiting) return undefined;

    const timer = setTimeout(() => setLate(true), RECONNECTING_AFTER_MS);

    return () => clearTimeout(timer);
  }, [waiting]);

  return late && hasEverConnected;
};

/** How the app stands with its server. */
export type ServerReach =
  | "online"
  /** The server hasn't answered since launch: the app opened on the downloads (D11). */
  | "offline"
  /** The server answered this launch, then went away; Convex calls it again on its own (G04, D14). */
  | "reconnecting";

/**
 * Whether the server answers, for the screens that change while it doesn't.
 *
 * @throws When used outside `ShownPhaseProvider`, a programming error.
 */
export const useServerReach = (): ServerReach => {
  const phase = useContext(ShownPhaseContext);
  const reconnecting = useReconnecting();

  if (phase === null) throw new Error("useServerReach needs ShownPhaseProvider above it");

  if (phase.kind === "offline") return "offline";

  return reconnecting ? "reconnecting" : "online";
};

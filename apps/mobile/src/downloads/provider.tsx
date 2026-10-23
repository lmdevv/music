/**
 * Downloads on this iPhone. `DownloadsProvider` opens the signed-in account's vault, runs a
 * `DownloadSync` over it, and feeds it what the server says: this phone's downloads, each one's
 * manifest, and whether the server answers. Screens use the hooks below and never see pins,
 * manifests, revisions, or files.
 */
import type { DeviceId, DownloadPinId, TrackId } from "@music/commands/ids";
import type { DownloadTarget } from "@music/commands/models";
import {
  canToggleDownload,
  downloadStatus,
  DownloadSync,
  EMPTY_DOWNLOADS,
} from "@music/sdk/downloads";
import type {
  DownloadsSnapshot,
  DownloadStatus,
  LocalCopy,
  SyncPolicy,
} from "@music/sdk/downloads";
import { makeMusicClient } from "@music/sdk/client";
import { useReadSettled } from "@music/sdk/react";
import { chooseStreamProfile } from "@music/player/stream-quality";
import { useConvex, useConvexConnectionState } from "convex/react";
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import { expoTransfer } from "./expo-transfer";
import { openVault } from "./expo-vault";
import type { ExpoVault } from "./expo-vault";
import { loadDownloadQuality, loadPhoneId } from "../player/native-host";
import type { DownloadQuality } from "../player/native-host";
import { playsOnIos } from "../player/player-state";
import { mediaUrl } from "../lib/media-url";
import { useConnection } from "../session/connection";

/** What a song, album, or playlist row offers for its download. */
interface DownloadView {
  readonly status: DownloadStatus;
  /** Whether `toggle` does anything now: adding needs the server; removing works offline. */
  readonly canToggle: boolean;
  /** Downloads it, or removes it, cancelling what is still to come. */
  readonly toggle: () => Promise<void>;
  /** Tries its failed songs again now. */
  readonly retry: () => void;
}

/** The songs on this phone, as the player plays them. */
export interface DownloadedCopies {
  /** The copy of a song on this phone, or null; read when called. */
  readonly find: (trackId: TrackId) => LocalCopy | null;
  /** A copy failed to play: stop offering it, and fetch it again. */
  readonly discard: (trackId: TrackId) => void;
}

interface Downloads {
  readonly sync: DownloadSync | null;
  /** Stable for the provider's lifetime, whichever vault is open. */
  readonly copies: DownloadedCopies;
}

const DownloadsContext = createContext<Downloads | null>(null);

const subscribeToNothing = (): (() => void) => () => undefined;

const emptySnapshot = (): DownloadsSnapshot => EMPTY_DOWNLOADS;

/** The profile each new download is fetched in. */
const policyFor = (quality: DownloadQuality): SyncPolicy => ({
  profileFor: (track) => chooseStreamProfile(quality, track.codec, playsOnIos),
});

/** Reads one download's manifest and hands it to the sync. Renders nothing. */
function PinWatcher({
  sync,
  pinId,
}: {
  readonly sync: DownloadSync;
  readonly pinId: DownloadPinId;
}) {
  // Settled: a download removed elsewhere answers `not_found` until the list catches up.
  const manifest = useReadSettled("downloads.manifest", { pinId });

  useEffect(() => {
    if (manifest !== undefined && !(manifest instanceof Error)) sync.offerManifest(pinId, manifest);
  }, [sync, pinId, manifest]);

  return null;
}

/** Feeds `sync` this phone's downloads and the manifest of each. Renders nothing visible. */
function ServerFeed({
  sync,
  deviceId,
}: {
  readonly sync: DownloadSync;
  readonly deviceId: DeviceId;
}) {
  const { isWebSocketConnected } = useConvexConnectionState();
  const listed = useReadSettled("downloads.list", { deviceId });

  const pins = useMemo(
    () =>
      listed === undefined || listed instanceof Error
        ? null
        : (listed.find((device) => device.deviceId === deviceId)?.pins ?? []),
    [listed, deviceId],
  );

  useEffect(() => {
    sync.setOnline(isWebSocketConnected);
  }, [sync, isWebSocketConnected]);

  useEffect(() => {
    if (pins !== null) sync.offerPins(pins);
  }, [sync, pins]);

  return (pins ?? []).map((pin) => <PinWatcher key={pin.id} sync={sync} pinId={pin.id} />);
}

/**
 * Keeps the signed-in account's downloads on this phone while the app runs. Mount it inside the
 * signed-in Convex provider, above the player, which plays downloaded songs from their files.
 */
export function DownloadsProvider({ children }: { readonly children: ReactNode }) {
  const convex = useConvex();
  const { origin } = useConnection();
  const account = useReadSettled("account.me", {});
  const userId = account === undefined || account instanceof Error ? null : account.id;
  const deviceId = useMemo(() => loadPhoneId(), []);
  const [sync, setSync] = useState<DownloadSync | null>(null);
  // Read once: the setting arrives with Settings → Downloads, and applies to new downloads only.
  const policy = useRef(policyFor(loadDownloadQuality()));
  const current = useRef<DownloadSync | null>(null);

  useEffect(() => {
    if (userId === null) return undefined;
    let closed = false;
    let stop = (): void => undefined;
    const opening = openVault(origin, userId);

    const run = async (): Promise<void> => {
      let vault: ExpoVault;

      try {
        vault = await opening;
      } catch (error) {
        // The phone streams as before; downloads come back when the app opens the vault again.
        const reason = error instanceof Error ? error.message : "unknown error";
        console.warn(`Downloads are unavailable: the vault didn't open (${reason}).`);

        return;
      }

      if (closed) return;

      const created = new DownloadSync({
        client: makeMusicClient(convex),
        vault,
        transfer: expoTransfer,
        deviceId,
        policy: () => policy.current,
        resolveUrl: (url) => mediaUrl(origin, url),
        now: Date.now,
      });

      stop = created.start();
      current.current = created;
      setSync(created);
    };

    void run();

    return () => {
      closed = true;
      stop();
      current.current = null;
      setSync(null);

      void opening.then(
        (vault) => vault.close(),
        () => undefined,
      );
    };
  }, [convex, origin, userId, deviceId]);

  const copies = useMemo(
    (): DownloadedCopies => ({
      find: (trackId) => current.current?.localCopy(trackId) ?? null,
      discard: (trackId) => {
        current.current?.discard(trackId);
      },
    }),
    [],
  );

  const value = useMemo(() => ({ sync, copies }), [sync, copies]);

  return (
    <DownloadsContext value={value}>
      {sync === null ? null : <ServerFeed sync={sync} deviceId={deviceId} />}
      {children}
    </DownloadsContext>
  );
}

const useDownloads = (hook: string): Downloads => {
  const downloads = use(DownloadsContext);

  if (downloads === null) throw new Error(`${hook} must be used inside DownloadsProvider`);

  return downloads;
};

/** The current snapshot; the empty one until the vault opens. */
const useSnapshot = (sync: DownloadSync | null): DownloadsSnapshot =>
  useSyncExternalStore(sync?.subscribe ?? subscribeToNothing, sync?.getSnapshot ?? emptySnapshot);

/** The download of a song, album, or playlist on this phone, and the way to switch it. */
export const useDownload = (target: DownloadTarget): DownloadView => {
  const { sync } = useDownloads("useDownload");
  const snapshot = useSnapshot(sync);
  const status = downloadStatus(snapshot, target);
  const canToggle = canToggleDownload(snapshot, status);

  return {
    status,
    canToggle,
    toggle: async () => {
      if (sync === null || !canToggle) return;

      await (status.kind === "none" ? sync.request(target) : sync.remove(target));
    },
    retry: () => {
      sync?.retry(target);
    },
  };
};

/**
 * The songs on this phone, for the player, which plays a downloaded song from its file, online
 * too. Stable, and reads the vault when called.
 */
export const useLocalCopies = (): DownloadedCopies => useDownloads("useLocalCopies").copies;

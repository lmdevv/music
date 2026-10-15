import { usePlayer } from "@music/player/react";
import { TooltipProvider } from "@music/ui/components/tooltip";
import { CatchBoundary, useLocation } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { JamBand } from "@/components/jam/jam-band";
import { DeviceSheet } from "@/components/player/device-sheet";
import { PlayerBar } from "@/components/player/player-bar";
import { useOpenedOnce } from "@/lib/use-opened-once";
import { whenSettled } from "@/lib/when-settled";

import { ConnectionBanners } from "./banners";
import { KeyboardShortcuts } from "./keyboard";
import { PhoneChrome } from "./phone-chrome";
import { Sidebar } from "./sidebar";
import { UiStateProvider, useUi } from "./ui-state";

/** A surface the shell loads on demand, and the function that loads its chunk ahead of time. */
interface Surface {
  readonly Component: () => ReactNode;
  readonly preload: () => Promise<void>;
}

/**
 * A lazily loaded surface that renders straight away once its chunk is in. `React.lazy` alone
 * suspends on its first render even when the chunk has loaded, and React holds a revealed boundary
 * back for up to 300 ms, so a preloaded command menu still took a third of a second to open.
 */
const surface = (load: () => Promise<() => ReactNode>): Surface => {
  // The loaded component, kept for the page's life like the module it comes from.
  let ready: (() => ReactNode) | null = null;

  const pending = () => lazy(async () => ({ default: await loadReady() }));

  // `React.lazy` keeps a failure for good, so a failed load swaps in a fresh one for the next try.
  let Pending = pending();

  const loadReady = async () => {
    try {
      ready = await load();

      return ready;
    } catch (cause) {
      Pending = pending();

      throw cause;
    }
  };

  return {
    Component: () => {
      // Chosen once per mount: switching from `Pending` to the loaded component later would be a
      // different element type, and React would remount an open surface and lose its state.
      const [Shown] = useState(() => ready ?? Pending);

      return <Shown />;
    },
    preload: async () => {
      await loadReady();
    },
  };
};

// The surfaces the shell opens on demand load as their own chunks: the command menu with its
// catalog and forms, Now Playing, the queue, the Jam panel with its QR encoder, and the New
// playlist dialog. None of them is on screen when a page first loads.
const surfaces = {
  commandMenu: surface(async () => (await import("@/components/command/command-menu")).CommandMenu),
  nowPlaying: surface(async () => (await import("@/components/player/now-playing")).NowPlaying),
  queue: surface(async () => (await import("@/components/player/queue")).QueuePanel),
  jamPanel: surface(async () => (await import("@/components/jam/jam-panel")).JamPanel),
  newPlaylist: surface(
    async () => (await import("@/components/playlists/new-playlist-dialog")).NewPlaylistDialog,
  ),
};

const CommandMenu = surfaces.commandMenu.Component;

const NowPlaying = surfaces.nowPlaying.Component;

const QueuePanel = surfaces.queue.Component;

const JamPanel = surfaces.jamPanel.Component;

const NewPlaylistDialog = surfaces.newPlaylist.Component;

/**
 * Loads the surfaces' chunks once the first screen has settled, so the first ⌘K or tap on the mini
 * player opens at once instead of waiting for the network.
 */
const usePreloadSurfaces = (): void => {
  useEffect(
    () =>
      whenSettled(() => {
        for (const { preload } of Object.values(surfaces)) {
          // A chunk that fails here is asked for again when its surface opens; if that fails too,
          // the surface says so (browsers may keep a failed module until the page reloads).
          preload().catch(() => undefined);
        }
      }),
    [],
  );
};

const NoSurface = () => null;

/** Says that a surface's code didn't load, with a way to reload the page and get it. */
const reportUnloaded = () => {
  toast.error("Couldn't load this part of [music]. Reload the page to try again.", {
    action: { label: "Reload", onClick: () => window.location.reload() },
  });
};

/**
 * A lazily loaded surface. A chunk that fails to load (offline, or the server was upgraded and the
 * old chunk is gone) reports itself and renders nothing, rather than reaching the route's error
 * screen, which would replace the shell and stop the music. A new `attempt` tries again.
 */
function Loaded({ attempt, children }: { readonly attempt: number; readonly children: ReactNode }) {
  return (
    <CatchBoundary getResetKey={() => attempt} errorComponent={NoSurface} onCatch={reportUnloaded}>
      <Suspense fallback={null}>{children}</Suspense>
    </CatchBoundary>
  );
}

/**
 * Mounts a lazily loaded surface the first time it opens, and keeps it for its close animation.
 * Each opening is a new attempt, so a surface that failed to load tries again.
 */
function OnDemand({ open, children }: { readonly open: boolean; readonly children: ReactNode }) {
  const opened = useOpenedOnce(open);
  const [attempt, setAttempt] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);

  if (open !== wasOpen) {
    setWasOpen(open);

    if (open) setAttempt((count) => count + 1);
  }

  return opened ? <Loaded attempt={attempt}>{children}</Loaded> : null;
}

/**
 * The signed-in frame. Desktop: sidebar, main column, optional queue panel, and the player bar,
 * inset on white in light mode and as rounded panels on a black canvas in dark mode. Phone: the
 * page with the glass mini player and tab bar floating over it.
 */
export function AppShell({ children }: { readonly children: ReactNode }) {
  return (
    <UiStateProvider>
      {/* Only the signed-in app has tooltips, so their provider (and code) stays out of the
          sign-in and setup screens. */}
      <TooltipProvider>
        <Frame>{children}</Frame>
        <KeyboardShortcuts />
        <Surfaces />
      </TooltipProvider>
    </UiStateProvider>
  );
}

/** The dialogs and sheets the shell opens over every page. */
function Surfaces() {
  const { commandOpen, newPlaylist, nowPlaying, setNowPlaying, jamOpen } = useUi();
  const player = usePlayer();
  const { pathname } = useLocation();

  usePreloadSurfaces();

  // Going to another page closes Now Playing. It lives here, not in Now Playing, which mounts
  // only once opened and would close itself on mount.
  useEffect(() => {
    setNowPlaying(null);
  }, [pathname, setNowPlaying]);

  return (
    <>
      <OnDemand open={commandOpen}>
        <CommandMenu />
      </OnDemand>
      <OnDemand open={newPlaylist !== null}>
        <NewPlaylistDialog />
      </OnDemand>
      <OnDemand open={nowPlaying !== null && player.track !== null}>
        <NowPlaying />
      </OnDemand>
      <DeviceSheet />
      <OnDemand open={jamOpen}>
        <JamPanel />
      </OnDemand>
    </>
  );
}

function Frame({ children }: { readonly children: ReactNode }) {
  const { queueOpen } = useUi();
  const player = usePlayer();
  const hasTrack = player.track !== null;

  return (
    <div className="flex h-dvh flex-col bg-bg dark:bg-dark-canvas">
      <div className="flex min-h-0 grow lg:pt-2 lg:pl-2 lg:dark:gap-2 lg:dark:p-2">
        <Sidebar />
        <div className="flex min-w-0 grow flex-col overflow-clip lg:dark:rounded-md dark:bg-bg">
          <ConnectionBanners />
          <JamBand />
          <main
            id="main"
            className={`relative min-h-0 grow overflow-y-auto overscroll-contain ${hasTrack ? "pb-50" : "pb-35"} lg:pb-0`}
          >
            {children}
          </main>
        </div>
        {queueOpen && hasTrack ? (
          <Loaded attempt={0}>
            <QueuePanel />
          </Loaded>
        ) : null}
      </div>
      <PlayerBar />
      <PhoneChrome />
    </div>
  );
}

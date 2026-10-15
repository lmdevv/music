import { usePlayer } from "@music/player/react";
import { TooltipProvider } from "@music/ui/components/tooltip";
import { useLocation } from "@tanstack/react-router";
import { Suspense, lazy, useEffect } from "react";
import type { ReactNode } from "react";

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

// The surfaces the shell opens on demand load as their own chunks: the command menu with its
// catalog and forms, Now Playing, the queue, the Jam panel with its QR encoder, and the New
// playlist dialog. None of them is on screen when a page first loads.
const surfaces = {
  commandMenu: () => import("@/components/command/command-menu"),
  nowPlaying: () => import("@/components/player/now-playing"),
  queue: () => import("@/components/player/queue"),
  jamPanel: () => import("@/components/jam/jam-panel"),
  newPlaylist: () => import("@/components/playlists/new-playlist-dialog"),
};

const CommandMenu = lazy(async () => ({ default: (await surfaces.commandMenu()).CommandMenu }));

const NowPlaying = lazy(async () => ({ default: (await surfaces.nowPlaying()).NowPlaying }));

const QueuePanel = lazy(async () => ({ default: (await surfaces.queue()).QueuePanel }));

const JamPanel = lazy(async () => ({ default: (await surfaces.jamPanel()).JamPanel }));

const NewPlaylistDialog = lazy(async () => ({
  default: (await surfaces.newPlaylist()).NewPlaylistDialog,
}));

/**
 * Loads the surfaces' chunks once the first screen has settled, so the first ⌘K or tap on the mini
 * player opens at once instead of waiting for the network.
 */
const usePreloadSurfaces = (): void => {
  useEffect(
    () =>
      whenSettled(() => {
        for (const load of Object.values(surfaces)) {
          // A chunk that fails here loads again, and reports its error, when it is opened.
          load().catch(() => undefined);
        }
      }),
    [],
  );
};

/** Mounts a lazily loaded surface the first time it opens, and keeps it for its close animation. */
function OnDemand({ open, children }: { readonly open: boolean; readonly children: ReactNode }) {
  const opened = useOpenedOnce(open);

  return opened ? <Suspense fallback={null}>{children}</Suspense> : null;
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
          <Suspense fallback={null}>
            <QueuePanel />
          </Suspense>
        ) : null}
      </div>
      <PlayerBar />
      <PhoneChrome />
    </div>
  );
}

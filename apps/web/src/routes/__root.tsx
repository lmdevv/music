import { HeadContent, Outlet, createRootRoute, lazyRouteComponent } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { Suspense, lazy } from "react";

import "../index.css";

// Toasts and the error screen load beside the first screen rather than in front of it. A toast
// raised before the Toaster mounts still shows: it replays the toasts that are active when it
// subscribes.
const Toaster = lazy(async () => ({
  default: (await import("@music/ui/components/sonner")).Toaster,
}));

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: lazyRouteComponent(() => import("@/components/route-error"), "RouteError"),
  head: () => ({
    meta: [
      { title: "[music]" },
      { name: "description", content: "Your own music library, streamed from your server" },
    ],
  }),
});

function RootComponent() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="music-theme"
      // React never runs scripts it renders on the client; index.html sets the theme before paint.
      scriptProps={{ type: "application/json" }}
    >
      <HeadContent />
      <Outlet />
      <Suspense fallback={null}>
        <Toaster />
      </Suspense>
    </ThemeProvider>
  );
}

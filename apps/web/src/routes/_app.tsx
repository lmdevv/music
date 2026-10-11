import { PlayerProvider } from "@music/player/react";
import { setupStatus } from "@music/sdk/functions";
import { Navigate, Outlet, createFileRoute, useLocation } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";

import { AppShell } from "@/components/shell/app-shell";

export const Route = createFileRoute("/_app")({ component: AppLayout });

function AppLayout() {
  const status = useQuery(setupStatus, {});
  const { isLoading, isAuthenticated } = useConvexAuth();
  const location = useLocation();

  if (status === undefined || isLoading) return <div className="min-h-dvh bg-bg" />;

  if (!status.hasUsers) return <Navigate to="/setup" />;

  if (!isAuthenticated) {
    // While the sign-in navigation is pending this layout still renders with the new location;
    // only the first, in-app location becomes the redirect target.
    if (location.pathname === "/sign-in") return <div className="min-h-dvh bg-bg" />;

    return <Navigate to="/sign-in" search={{ redirect: location.href }} replace />;
  }

  return (
    <PlayerProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </PlayerProvider>
  );
}

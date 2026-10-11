import { Navigate, createFileRoute } from "@tanstack/react-router";

import { SettingsNav } from "@/components/settings/settings-nav";
import { useIsDesktop } from "@/lib/use-media";

export const Route = createFileRoute("/_app/settings/")({ component: SettingsIndex });

/** Phones list the sections; desktop opens Account beside the section navigation. */
function SettingsIndex() {
  const desktop = useIsDesktop();

  if (desktop) return <Navigate to="/settings/account" replace />;

  return <SettingsNav />;
}

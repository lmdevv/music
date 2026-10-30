/**
 * The round buttons at the top of a page while the iPad's sidebar is hidden (A3): show it, and
 * Search, which the sidebar would otherwise hold.
 */
import { router } from "expo-router";
import { PanelLeft, Search } from "lucide-react-native";
import { useCallback } from "react";

import { useRequestSearch } from "@/components/browse/search-activation";
import { IconButton } from "@/components/ui/icon-button";
import { DESTINATIONS } from "@/lib/shell-layout";

/** Opens the Search tab with its field focused. */
export const useOpenSearch = (): (() => void) => {
  const request = useRequestSearch();

  return useCallback(() => {
    request();
    router.navigate(DESTINATIONS.search.href);
  }, [request]);
};

/** Shows the hidden sidebar. */
export function ShowSidebarButton({ onPress }: { readonly onPress: () => void }) {
  return (
    <IconButton
      icon={PanelLeft}
      label="Show sidebar"
      tone="accent"
      size="side"
      className="bg-surface"
      onPress={onPress}
    />
  );
}

/** Opens Search. */
export function SearchButton() {
  const openSearch = useOpenSearch();

  return (
    <IconButton
      icon={Search}
      label="Search"
      size="inline"
      className="bg-surface"
      onPress={openSearch}
    />
  );
}

/**
 * Now Playing's own stack, presented as a modal sheet over the tabs that the person drags down to
 * dismiss (B01, B11), or over the whole window from the tablet width up (P07), where the page is
 * see-through so the tabs show as it drags down. The queue and the lyrics open in place inside it
 * (B03, B12), or beside the player when wide (P08, P09); the device picker and confirmations
 * present over it as form sheets. Song actions and audio details are the app's sheets, over this
 * one.
 */
import { Stack } from "expo-router";
import { useState } from "react";

import { layoutOf, presentationOf } from "@/lib/now-playing-layout";
import { useSheetOptions } from "@/lib/sheet";
import { useThemeColor } from "@/lib/theme-color";
import { useWindowLayout } from "@/lib/window-layout";

/** Over the whole window, the page under Now Playing lets the tabs show through. */
const SEE_THROUGH = { contentStyle: { backgroundColor: "transparent" } } as const;

export default function PlayerLayout() {
  const sheet = useSheetOptions();
  const canvas = useThemeColor("--color-canvas");
  const { widthClass, landscape } = useWindowLayout();
  // Presented as the window was when Now Playing opened, as the screen itself is.
  const [windowed] = useState(() => presentationOf(layoutOf(widthClass, landscape)) === "window");

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: canvas } }}>
      <Stack.Screen name="index" options={windowed ? SEE_THROUGH : undefined} />
      <Stack.Screen name="devices" options={sheet} />
      <Stack.Screen name="clear-queue" options={sheet} />
      <Stack.Screen name="unavailable" options={sheet} />
    </Stack>
  );
}

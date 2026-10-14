import { usePlayer } from "@music/player/react";
import { Sheet, SheetContent } from "@music/ui/components/sheet";
import { useEffect } from "react";

import { useUi } from "@/components/shell/ui-state";
import { useIsDesktop } from "@/lib/use-media";

import { barTools } from "./bar-tools";
import { useIsRemote } from "./controls";
import { DeviceList } from "./devices";

/**
 * The phone "Play on" sheet (Paper 07 · 04), opened from the command menu or the `d` key.
 *
 * On desktop the picker is a popover on the player bar's speaker button, which exists only while
 * the bar shows its tools (a song loaded, no buffering, error, or offline state). A request to open
 * "Play on" while there is no button, or one left open when the button goes away, is dropped here;
 * otherwise the popover would open on its own once the button came back.
 */
export function DeviceSheet() {
  const { devicesOpen, setDevicesOpen } = useUi();
  const desktop = useIsDesktop();
  const player = usePlayer();
  const remote = useIsRemote();
  const track = player.track;

  const pickerShown =
    !desktop ||
    (track !== null &&
      barTools({ status: player.status, mediaOnline: player.mediaOnline, remote }) === "tools");

  useEffect(() => {
    if (devicesOpen && !pickerShown) setDevicesOpen(false);
  }, [devicesOpen, pickerShown, setDevicesOpen]);

  return (
    <Sheet open={devicesOpen && !desktop} onOpenChange={setDevicesOpen}>
      <SheetContent
        title="Play on"
        description={track === null ? undefined : `${track.title} · ${track.artist}`}
      >
        <DeviceList touch />
      </SheetContent>
    </Sheet>
  );
}

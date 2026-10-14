import { usePlayer } from "@music/player/react";
import { Dialog, DialogContent } from "@music/ui/components/dialog";
import { Sheet, SheetContent } from "@music/ui/components/sheet";

import { useUi } from "@/components/shell/ui-state";
import { useIsDesktop } from "@/lib/use-media";

import { DeviceList } from "./devices";

/**
 * "Play on" wherever the player bar's popover isn't: the phone sheet (Paper 07 · 04), and on
 * desktop a dialog while the bar has no speaker button (nothing loaded yet). Opened from the
 * command menu or the `d` key, so moving playback is always reachable.
 */
export function DeviceSheet() {
  const { devicesOpen, setDevicesOpen, devicePopoverMounted } = useUi();
  const desktop = useIsDesktop();
  const player = usePlayer();
  const track = player.track;
  const description = track === null ? undefined : `${track.title} · ${track.artist}`;

  return (
    <>
      <Sheet open={devicesOpen && !desktop} onOpenChange={setDevicesOpen}>
        <SheetContent title="Play on" description={description}>
          <DeviceList touch />
        </SheetContent>
      </Sheet>
      <Dialog open={devicesOpen && desktop && !devicePopoverMounted} onOpenChange={setDevicesOpen}>
        <DialogContent
          title="Play on"
          description="Open [music] in any browser while signed in and it shows up here."
        >
          <DeviceList />
        </DialogContent>
      </Dialog>
    </>
  );
}

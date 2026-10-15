import type { DeviceKind } from "@music/commands/models";
import { usePlayer } from "@music/player/react";
import { LaptopIcon, SmartphoneIcon, SquareTerminalIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { toastFailure } from "@/lib/action";

/** Runs a player action and reports a failure as a toast. */
export const perform = (action: Promise<void>): void => {
  action.catch(toastFailure);
};

/** True while another device outputs the audio and this browser is a remote control. */
export const useIsRemote = (): boolean => {
  const player = usePlayer();

  return player.activeDevice !== null && !player.isThisDevice;
};

/** The icon for a device kind. */
const DEVICE_ICONS: Readonly<Record<DeviceKind, LucideIcon>> = {
  web: LaptopIcon,
  phone: SmartphoneIcon,
  cli: SquareTerminalIcon,
};

export const deviceIcon = (kind: DeviceKind): LucideIcon => DEVICE_ICONS[kind];

/** The repeat mode after the current one when the repeat control is pressed. */
export const NEXT_REPEAT = { off: "all", all: "one", one: "off" } as const;

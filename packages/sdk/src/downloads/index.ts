/**
 * Downloads, shared by every device that keeps songs: the iPhone now, the desktop app and the CLI
 * later. The server says what each download means (`downloads.manifest`); this module plans
 * what a device does about it, fetches finished files, and keeps the device's vault in line.
 * Only this entry point is public.
 */
export { planSync, SyncStep, targetKey } from "./plan";

export type {
  Desired,
  StoredArt,
  StoredCopy,
  StoredMember,
  StoredPin,
  SyncPolicy,
  VaultView,
} from "./plan";

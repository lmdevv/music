/**
 * The Download row of a sheet (A11 song actions, C08 playlist actions): Download, Cancel
 * download, or Remove download, by where the download stands on this iPhone.
 */
import type { DownloadTarget } from "@music/commands/models";
import { errorMessage } from "@music/sdk/errors";
import * as Haptics from "expo-haptics";
import { CircleArrowDown, CircleCheck, CircleMinus } from "lucide-react-native";

import { useDownload } from "@/downloads";
import { downloadRow } from "@/lib/download-row";

import { Row } from "../ui/row";
import type { TextTone } from "../ui/text";

const ICONS = {
  download: CircleArrowDown,
  remove: CircleMinus,
  none: CircleCheck,
} as const;

/** The row for `target`; `onDone` closes the sheet, `onFailure` shows why adding failed. */
export function DownloadRow({
  target,
  tone,
  onDone,
  onFailure,
}: {
  readonly target: DownloadTarget;
  /** The sheet's icon tone: C08's icons are muted, A11's are not. */
  readonly tone: TextTone;
  readonly onDone: () => void;
  readonly onFailure: (message: string) => void;
}) {
  const download = useDownload(target);
  const label = downloadRow(download.status, download.canToggle);

  const press = async () => {
    try {
      await download.toggle();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone();
    } catch (cause) {
      onFailure(cause instanceof Error ? errorMessage(cause) : "Couldn’t download it. Try again.");
    }
  };

  const leading = { kind: "icon", icon: ICONS[label.action], tone } as const;
  const onPress = label.action === "none" ? undefined : () => void press();

  return label.subtitle === null ? (
    <Row title={label.title} leading={leading} onPress={onPress} />
  ) : (
    <Row title={label.title} subtitle={label.subtitle} leading={leading} onPress={onPress} />
  );
}

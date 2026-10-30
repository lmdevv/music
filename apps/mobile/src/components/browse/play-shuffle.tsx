/**
 * Paper's Play and Shuffle pair (A05, A07): accent Play and surface Shuffle, which split the row
 * on a phone and keep their own width, at least 160pt, in an iPad header (P05).
 */
import { Play, Shuffle } from "lucide-react-native";
import { View } from "react-native";

import { Button } from "@/components/ui/button";

/**
 * Each button's width: half the row, or in an iPad header its natural width but at least Paper's
 * 160pt, so a longer label such as Add songs never truncates.
 */
export const PAIR_WIDTHS = { fill: "flex-1", natural: "min-w-ios-160" } as const;

/** How wide a Play button and its partner are. */
export type PairWidth = keyof typeof PAIR_WIDTHS;

/** Play in order and Shuffle, side by side. */
export function PlayShuffle({
  onPlay,
  onShuffle,
  pending = false,
  width = "fill",
  className,
}: {
  readonly onPlay: () => void;
  readonly onShuffle: () => void;
  /** While the songs to play are still loading. */
  readonly pending?: boolean;
  readonly width?: PairWidth;
  readonly className?: string;
}) {
  return (
    <View className={`flex-row gap-3 ${className ?? ""}`}>
      <Button
        label="Play"
        icon={Play}
        iconFilled
        pending={pending}
        onPress={onPlay}
        className={PAIR_WIDTHS[width]}
      />
      <Button
        label="Shuffle"
        variant="secondary"
        icon={Shuffle}
        pending={pending}
        onPress={onShuffle}
        className={PAIR_WIDTHS[width]}
      />
    </View>
  );
}

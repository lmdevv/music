/**
 * G04 · Reconnecting: the server dropped after the app had reached it. The notice sits under a
 * tab root's title and never blocks: what is on screen stays usable from cache, and the queue
 * keeps playing. Convex reconnects on its own (at most 16 seconds apart), and the notice goes
 * once it does.
 */
import { Wifi } from "lucide-react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { Notice } from "@/components/ui/notice";
import { useServerReach } from "@/session/server-reach";

/** The reconnecting notice while the server is away; nothing while it's there. */
export function ReconnectingNotice() {
  if (useServerReach() !== "reconnecting") return null;

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)} className="mb-1">
      <Notice
        icon={Wifi}
        title="Reconnecting to your server"
        body="Your queue is saved. Changes will be available when you reconnect."
      />
    </Animated.View>
  );
}

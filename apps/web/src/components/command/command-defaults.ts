import type { MutationName } from "@music/commands/registry";
import { usePlayer, usePlayerPosition } from "@music/player/react";
import { useRead } from "@music/sdk/react";
import { Match } from "effect";

import { NEXT_REPEAT } from "@/components/player/controls";

import type { FieldSpec, FormValues } from "./fields";

/**
 * A command form's default values from what is playing and on screen. Only the open command's
 * preview calls it, so the playback position (which ticks several times a second) re-renders
 * that form, not the whole menu.
 */
export const useCommandDefaults = (
  name: MutationName,
  fields: ReadonlyArray<FieldSpec>,
): FormValues => {
  const player = usePlayer();
  const position = usePlayerPosition();
  const me = useRead("account.me", {});
  const libraries = useRead("libraries.list", {});
  const values: Record<string, FormValues[string]> = {};

  for (const field of fields) {
    if (field.field.kind === "boolean" && !field.optional) values[field.name] = false;
  }

  const track = player.track;

  const extra: FormValues = Match.value(name).pipe(
    Match.when("likes.set", () =>
      track === null ? {} : { trackId: track.id, liked: !track.liked },
    ),
    Match.when("playback.shuffle", () => ({ on: !player.shuffle })),
    Match.when("playback.repeat", () => ({ mode: NEXT_REPEAT[player.repeat] })),
    Match.when("playback.volume", () => ({ volume: String(player.volume) })),
    Match.when("playback.seek", () => ({ positionMs: String(Math.round(position)) })),
    Match.when("playback.jump", () => ({ index: String(player.index) })),
    Match.when("account.rename", () => ({ name: me?.name ?? undefined })),
    // With one folder there is nothing to choose; removing one is left to an explicit pick.
    Match.when("libraries.scan", () =>
      libraries?.length === 1 && libraries[0] !== undefined ? { libraryId: libraries[0].id } : {},
    ),
    Match.whenOr("queue.add", "playback.play", "playlists.add", () =>
      track === null ? {} : { trackIds: [track.id] },
    ),
    Match.orElse(() => ({})),
  );

  return { ...values, ...extra };
};

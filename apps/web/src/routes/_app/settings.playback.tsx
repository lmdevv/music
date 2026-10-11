import { Kbd } from "@music/ui/components/kbd";
import { Segmented } from "@music/ui/components/segmented";
import { createFileRoute } from "@tanstack/react-router";
import { useTheme } from "next-themes";

import { SettingsHeader } from "@/components/settings/settings-ui";
import { MOD } from "@/lib/keys";

export const Route = createFileRoute("/_app/settings/playback")({ component: PlaybackSettings });

const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

type ThemeChoice = (typeof THEMES)[number]["value"];

const toChoice = (theme: string | undefined): ThemeChoice =>
  THEMES.find((option) => option.value === theme)?.value ?? "system";

const SHORTCUTS: ReadonlyArray<readonly [keys: ReadonlyArray<string>, action: string]> = [
  [["Space"], "Play or pause"],
  [["←", "→"], "Seek 10 seconds back or forward"],
  [["⇧ ←", "⇧ →"], "Previous or next song"],
  [["L"], "Like or unlike the playing song"],
  [["/"], "Search"],
  [[`${MOD}K`], "Command menu: search and run any command"],
  [["N"], "New playlist"],
  [["D"], "Play on another device"],
];

function PlaybackSettings() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex max-w-[720px] flex-col gap-7">
      <SettingsHeader
        title="Playback"
        lead="Applies to this browser. Each device remembers its own choice."
      />
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div className="flex flex-col gap-0.5">
          <span className="font-sans text-base/sm font-semibold text-text">Appearance</span>
          <span className="font-sans text-sm/xs text-text-muted">
            Now Playing always uses the album's colors.
          </span>
        </div>
        <Segmented
          label="Appearance"
          value={toChoice(theme)}
          options={THEMES}
          onChange={setTheme}
        />
      </div>
      <div className="flex flex-col gap-3">
        <span className="font-sans text-base/sm font-semibold text-text">Keyboard shortcuts</span>
        <dl className="flex flex-col">
          {SHORTCUTS.map(([keys, action]) => (
            <div
              key={action}
              className="flex h-row items-center justify-between gap-4 border-b border-border"
            >
              <dt className="font-sans text-base/sm text-text">{action}</dt>
              <dd className="flex gap-1.5">
                {keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

import { describe, expect, it } from "vitest";

import { DESTINATIONS, playlistSelection, shellOf, sidebarSelectionOf } from "./shell-layout";
import type { NavigationSnapshot } from "./shell-layout";

describe("shellOf", () => {
  it.each([
    ["phone", false, { sidebar: "none", inspector: "none", player: "accessory" }],
    ["phone", true, { sidebar: "none", inspector: "none", player: "accessory" }],
    ["tablet", false, { sidebar: "overlay", inspector: "sheet", player: "bar" }],
    ["tablet", true, { sidebar: "overlay", inspector: "sheet", player: "bar" }],
    ["wide", false, { sidebar: "pinned", inspector: "sheet", player: "bar" }],
    ["wide", true, { sidebar: "pinned", inspector: "pane", player: "bar" }],
  ] as const)("frames a %s window (on its side: %s)", (widthClass, landscape, shell) => {
    expect(shellOf(widthClass, landscape)).toEqual(shell);
  });
});

/** The app's state with `tab` focused and its stack holding `stack`, bottom first. */
const on = (tab: string, stack: NavigationSnapshot["routes"], index = 0): NavigationSnapshot => ({
  index: 0,
  routes: [
    {
      name: "(tabs)",
      state: {
        index,
        routes: [
          ...Array.from({ length: index }, (_, slot) => ({ name: `(other${String(slot)})` })),
          { name: tab, state: { routes: stack } },
        ],
      },
    },
  ],
});

describe("sidebarSelectionOf", () => {
  it("tells the tabs' roots apart", () => {
    expect(sidebarSelectionOf(on("(home)", [{ name: "index" }]))).toBe("home");
    expect(sidebarSelectionOf(on("(library)", [{ name: "index" }]))).toBe("library");
    expect(sidebarSelectionOf(on("(playlists)", [{ name: "index" }], 1))).toBe("playlists");
    expect(sidebarSelectionOf(on("(search)", [{ name: "index" }]))).toBe("search");
  });

  it("selects a place from the stack of any tab that holds it", () => {
    expect(sidebarSelectionOf(on("(library)", [{ name: "index" }, { name: "albums" }]))).toBe(
      "albums",
    );
    expect(sidebarSelectionOf(on("(home)", [{ name: "index" }, { name: "history" }]))).toBe(
      "history",
    );
    expect(
      sidebarSelectionOf(on("(library)", [{ name: "index" }, { name: "downloaded/songs" }])),
    ).toBe("downloaded");
  });

  it("keeps the place an album was opened from", () => {
    const stack = [{ name: "index" }, { name: "albums" }, { name: "album/[id]" }];

    expect(sidebarSelectionOf(on("(library)", stack))).toBe("albums");
    expect(sidebarSelectionOf(on("(home)", [{ name: "index" }, { name: "album/[id]" }]))).toBe(
      "home",
    );
  });

  it("selects an open playlist, under whatever was pushed on it", () => {
    const stack = [
      { name: "index" },
      { name: "playlist/[id]", params: { id: "abc" } },
      { name: "artist/[id]", params: { id: "xyz" } },
    ];

    expect(sidebarSelectionOf(on("(playlists)", stack))).toBe(playlistSelection("abc"));
  });

  it("selects nothing before the tabs mount", () => {
    expect(sidebarSelectionOf({ routes: [{ name: "player" }] })).toBeNull();
    expect(sidebarSelectionOf({ routes: [{ name: "(tabs)" }] })).toBeNull();
  });

  it("keeps the selection while something covers the tabs", () => {
    const app = on("(library)", [{ name: "index" }, { name: "songs" }]);
    const covered = { index: 1, routes: [...app.routes, { name: "player" }] };

    expect(sidebarSelectionOf(covered)).toBe("songs");
  });

  it("has a root destination for every tab", () => {
    const roots = Object.values(DESTINATIONS).filter((place) => place.routes.length === 0);

    expect(roots.map((place) => place.tab).toSorted()).toEqual([
      "(home)",
      "(library)",
      "(playlists)",
      "(search)",
    ]);
  });
});

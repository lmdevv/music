import { Device, PlaybackState } from "@music/commands/models";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Schema } from "effect";

import { ADMIN, cli, cspViolations, expectAudioPast, isPlayingAudio, signIn } from "./support";

test.describe.configure({ mode: "serial" });

let apiKey = "";

const decodeDevices = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Device)));

const decodeState = Schema.decodeUnknownSync(Schema.fromJsonString(PlaybackState));

const openFirstAlbum = async (page: Page): Promise<string> => {
  await page
    .getByRole("navigation", { name: "Library" })
    .getByRole("link", { name: "Albums" })
    .click();
  const card = page.locator("main a[href^='/albums/']").first();
  await expect(card).toBeVisible();
  const name = (await card.getAttribute("aria-label")) ?? (await card.textContent()) ?? "";
  await card.click();
  await expect(page).toHaveURL(/\/albums\/[^/]+$/);
  const title = (await page.getByRole("heading", { level: 1 }).first().textContent()) ?? name;
  expect(title.length).toBeGreaterThan(0);

  return title;
};

test("first run: create the admin, add /music, and the real scanner indexes it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup/);
  await page.getByLabel("Name").fill(ADMIN.name);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create admin account" }).click();
  await expect(page.getByRole("heading", { name: "Where's your music?" })).toBeVisible();
  await page.getByLabel("Library folder").fill("/music");
  await page.getByRole("button", { name: "Start scanning" }).click();
  await expect(page.getByRole("heading", { name: "Your library is ready" })).toBeVisible({
    timeout: 120_000,
  });
  await page.getByRole("button", { name: "Open my library" }).click();
  await expect(page.getByRole("heading", { name: "Recently added" })).toBeVisible();
  await expect(page.locator("main img").first()).toBeVisible();
});

test("an album plays real audio, pauses, and skips", async ({ page }) => {
  await signIn(page);
  await openFirstAlbum(page);
  await page.getByRole("button", { name: "Play", exact: true }).first().click();

  const bar = page.getByRole("region", { name: "Player" });
  await expect(bar.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expectAudioPast(page, 2);

  await bar.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(bar.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect.poll(() => isPlayingAudio(page)).toBe(false);

  await bar.getByRole("button", { name: "Play", exact: true }).click();
  await expectAudioPast(page, 1);
  const before = await page.locator("[role=row][aria-current=true]").first().textContent();
  await bar.getByRole("button", { name: "Next", exact: true }).click();
  await expect
    .poll(() => page.locator("[role=row][aria-current=true]").first().textContent())
    .not.toBe(before);
  await expectAudioPast(page, 1);
});

test("search finds songs from the scanned library", async ({ page }) => {
  await signIn(page);
  const album = await openFirstAlbum(page);
  await page.keyboard.press("/");
  await expect(page).toHaveURL(/\/search/);
  const word = album.split(" ")[0] ?? album;
  await page.locator("#search-input").fill(word);
  await expect(page.getByText("Top result")).toBeVisible();
});

test("an API key drives the CLI, and the CLI controls the browser's playback", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/keys");
  await page.getByRole("button", { name: "New key" }).click();
  await page.getByLabel("Name").fill("stack e2e");
  await page.getByRole("button", { name: "Create key" }).click();
  apiKey = (await page.getByTestId("new-api-key").textContent())?.trim() ?? "";
  expect(apiKey).toMatch(/^mk_/);
  await page.getByRole("button", { name: "Done" }).click();

  expect(cli(apiKey, ["whoami"])).toContain(ADMIN.email);

  await openFirstAlbum(page);
  await page.getByRole("button", { name: "Play", exact: true }).first().click();
  await expectAudioPast(page, 1);

  cli(apiKey, ["pause"]);
  const bar = page.getByRole("region", { name: "Player" });
  await expect(bar.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect.poll(() => isPlayingAudio(page)).toBe(false);

  cli(apiKey, ["resume"]);
  await expect(bar.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expectAudioPast(page, 1);
});

test("playback moves to a second browser and the first one stops", async ({ page, browser }) => {
  await signIn(page);
  await openFirstAlbum(page);
  await page.getByRole("button", { name: "Play", exact: true }).first().click();
  await expectAudioPast(page, 2);

  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await other.newPage();
  await signIn(phone);
  await expect(phone.getByRole("button", { name: /Open Now Playing/ })).toBeVisible();

  const devices = decodeDevices(cli(apiKey, ["devices", "list", "--json"]));
  const state = decodeState(cli(apiKey, ["now", "--json"]));

  const target = devices.find((device) => device.online && device.id !== state.activeDevice?.id);
  expect(target).toBeDefined();
  cli(apiKey, ["playback", "transfer", target?.id ?? ""]);

  await expect.poll(() => isPlayingAudio(page)).toBe(false);
  await expectAudioPast(phone, 1);
  await expect(page.getByText(/Playing on /).first()).toBeVisible();
  await other.close();
});

test("the app runs under its Content-Security-Policy and security headers", async ({ page }) => {
  const response = await page.request.get("/");
  const headers = response.headers();

  expect(headers["content-security-policy"]).toContain("script-src 'self';");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");

  await signIn(page);
  await expect(page.locator("main img").first()).toBeVisible();
  await openFirstAlbum(page);
  await page.getByRole("button", { name: "Play", exact: true }).first().click();
  await expectAudioPast(page, 1);
  await page.keyboard.press("/");
  await page.locator("#search-input").fill("a");
  await expect(page.getByText("Top result")).toBeVisible();

  expect(await cspViolations(page)).toEqual([]);
});

test("a numeric search and the Add folder dialog keep their screens", async ({ page }) => {
  await signIn(page);
  await page.goto("/search");
  await page.locator("#search-input").fill("1999");
  await expect(page).toHaveURL(/q=1999/);
  await expect(page.getByRole("heading", { name: "Not in your library" })).toBeVisible();

  await page.goto("/settings/libraries");
  await page.getByRole("button", { name: "Add folder" }).click();
  await expect(page).toHaveURL(/add=1/);
  await expect(page.getByLabel("Library folder")).toBeVisible();
});

test("playlists: create with N, add from a song's menu, remove, rename, and delete", async ({
  page,
}) => {
  const errors: Array<string> = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await signIn(page);
  await openFirstAlbum(page);

  // The name field has focus when the dialog opens, so typing and Enter create the playlist.
  await page.keyboard.press("n");
  await expect(page.getByRole("dialog", { name: "New playlist" })).toBeVisible();
  await page.keyboard.type("Road trip");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/playlists\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Road trip" })).toBeVisible();

  await page.goBack();
  const row = page.locator("main [role=row]").nth(1);
  const title = (await row.locator("[role=cell]").nth(1).textContent())?.trim() ?? "";
  await row.hover();
  await row.getByRole("button", { name: `More actions for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Add to playlist" }).click();
  await page.getByRole("menuitem", { name: "Road trip" }).click();
  await expect(page.getByText("Added to Road trip")).toBeVisible();

  await page
    .getByRole("navigation", { name: "Library" })
    .getByRole("link", { name: /Road trip/ })
    .click();
  const added = page.locator("main [role=row]").filter({ hasText: title });
  await expect(added).toBeVisible();
  await added.hover();
  await added.getByRole("button", { name: `More actions for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Remove from this playlist" }).click();
  await expect(page.getByText("Let's find something for this playlist")).toBeVisible();

  await page.getByRole("button", { name: "More actions for Road trip" }).click();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Night drive");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Night drive" })).toBeVisible();

  await page.getByRole("button", { name: "More actions for Night drive" }).click();
  await page.getByRole("menuitem", { name: "Delete playlist…" }).click();
  await page.getByRole("button", { name: "Delete playlist" }).click();
  await expect(page).toHaveURL(/\/playlists$/);
  await expect(page.getByText("Deleted Night drive")).toBeVisible();
  await expect(page.getByRole("link", { name: /Night drive/ })).toHaveCount(0);
  expect(errors.filter((text) => text.includes("Playlist not found"))).toEqual([]);
});

test("home and artists show each artist's art", async ({ page }) => {
  await signIn(page);

  const recent = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Recently played artists" }),
  });

  const circles = recent.locator("a[href^='/artists/']");

  await expect(circles.first()).toBeVisible();
  await expect(recent.locator("a[href^='/artists/'] img")).toHaveCount(await circles.count());

  await page
    .getByRole("navigation", { name: "Library" })
    .getByRole("link", { name: "Artists" })
    .click();

  const artists = page.locator("main a[href^='/artists/']");

  await expect(artists.first()).toBeVisible();
  await expect(page.locator("main a[href^='/artists/'] img")).toHaveCount(await artists.count());
});

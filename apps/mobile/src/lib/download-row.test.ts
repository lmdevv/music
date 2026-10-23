import { describe, expect, it } from "vitest";

import { downloadRow } from "./download-row";
import { formatBytes } from "./format";

describe("downloadRow", () => {
  it("offers Download, and says why not while the server is away", () => {
    expect(downloadRow({ kind: "none" }, true)).toEqual({
      action: "download",
      title: "Download",
      subtitle: null,
    });

    expect(downloadRow({ kind: "none" }, false).action).toBe("none");
  });

  it("cancels a download still coming, with its progress", () => {
    expect(downloadRow({ kind: "downloading", done: 4, total: 9 }, true)).toEqual({
      action: "remove",
      title: "Cancel download",
      subtitle: "Downloading 4 of 9",
    });
  });

  it("removes a finished download and says what it frees, as Paper's C08 row does", () => {
    expect(downloadRow({ kind: "downloaded", bytes: 1_400_000_000 }, true)).toEqual({
      action: "remove",
      title: "Remove download",
      subtitle: "Frees 1.4 GB on this iPhone",
    });
  });

  it("leaves a song its album keeps alone", () => {
    expect(
      downloadRow({ kind: "included", by: { kind: "album", title: "Blue Lines" } }, false),
    ).toEqual({ action: "none", title: "Downloaded", subtitle: "With Blue Lines" });
  });
});

describe("formatBytes", () => {
  it("writes sizes in decimal units, as iOS Settings does", () => {
    expect(formatBytes(850_000)).toBe("850 KB");
    expect(formatBytes(412_300_000)).toBe("412 MB");
    expect(formatBytes(2_400_000_000)).toBe("2.4 GB");
    expect(formatBytes(999_600_000)).toBe("1 GB");
  });
});

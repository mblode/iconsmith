import { expect, test } from "vitest";

import { replayLibraryIcon } from "./library-replay.js";

test("full-library regression reports actual raster differences and refuses empty source", async () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4H20V20H4Z" fill="#000"/></svg>';
  const r = await replayLibraryIcon("box", "filled", svg);
  expect(r.exactReplay).toBe(true);
  expect(r.errors.every((e) => e.meanAbsolutePixelError < 0.001)).toBe(true);
  await expect(
    replayLibraryIcon("missing", "filled", "<svg/>")
  ).rejects.toThrow("No drawable");
});

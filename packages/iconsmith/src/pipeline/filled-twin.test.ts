import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { assertNoFilledTwin, loadIconSet } from "./eval.js";

/**
 * The loader and its own backstop once disagreed. `loadIconSet` skipped
 * `-filled.svg` alone while `assertNoFilledTwin` checked three suffixes, so a
 * set carrying `box-2-alt-fill.svg` walked through the filter and tripped the
 * guard — found mid-run, on a real icon set, after the run had already been
 * paid for. Both now read one list, and these assertions are what stop them
 * drifting apart again.
 */
describe("filled twins never reach the conditioning corpus", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "iconsmith-filled-"));
    mkdirSync(path.join(dir, "icons-svg"));
    mkdirSync(path.join(dir, "icons-data"));
    for (const name of ["plain", "box-2-alt-fill", "thing-filled", "x-solid"]) {
      writeFileSync(
        path.join(dir, "icons-svg", `${name}.svg`),
        '<svg viewBox="0 0 24 24"><path d="M4 4L20 20" stroke="currentColor"/></svg>'
      );
      writeFileSync(
        path.join(dir, "icons-data", `${name}.json`),
        '{"tags":["t"]}'
      );
    }
  });

  it("skips every filled suffix, not just -filled", () => {
    expect(loadIconSet(dir).map((i) => i.icon)).toEqual(["plain"]);
  });

  it("leaves the guard nothing to catch on the loader's own output", () => {
    expect(() => assertNoFilledTwin(loadIconSet(dir))).not.toThrow();
  });

  it("still throws when a filled icon arrives by some other path", () => {
    expect(() =>
      assertNoFilledTwin([
        { icon: "box-2-alt-fill", svg: "<svg/>", tags: [] },
      ] as Parameters<typeof assertNoFilledTwin>[0])
    ).toThrow(/box-2-alt-fill/u);
  });
});

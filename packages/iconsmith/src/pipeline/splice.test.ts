import { describe, expect, it } from "vitest";

import { bbox, parsePath } from "../geometry/path.js";
import { splicePair, splicePaths } from "./splice.js";

const BOX = "M0 0H10V10H0Z";
const BODY = "M2 2H22V22H2Z";

describe("splicePair", () => {
  const house = new Set(["clock", "folder", "left", "user", "user-add"]);

  it("splits on the longest house prefix whose remainder is also a house slug", () => {
    expect(splicePair("folder-clock", (s) => house.has(s))).toEqual({
      badge: "clock",
      base: "folder",
    });
    expect(splicePair("user-add-left", (s) => house.has(s))).toEqual({
      badge: "left",
      base: "user-add",
    });
  });

  it("returns null when either half is missing", () => {
    expect(splicePair("folder-unicorn", (s) => house.has(s))).toBeNull();
    expect(splicePair("plus", (s) => house.has(s))).toBeNull();
  });
});

describe("splicePaths", () => {
  it("keeps the body and seats the badge in the bottom-right slot", () => {
    const out = splicePaths([BODY], [BOX]);
    expect(out[0]).toBe(BODY);
    expect(out).toHaveLength(2);
    const box = bbox(parsePath(out[1] ?? ""));
    expect(box.x0).toBeCloseTo(14, 5);
    expect(box.y0).toBeCloseTo(14, 5);
    expect(box.w).toBeCloseTo(8, 5);
    expect(box.h).toBeCloseTo(8, 5);
  });
});

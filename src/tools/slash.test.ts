/**
 * The slash rule, tested on lines whose direction is obvious by eye.
 *
 * This rule guards a convention the set already keeps perfectly, so the tests
 * that matter are the ones proving it stays quiet: a rule that fires on
 * correct work is worse than no rule, because it trains people to ignore it.
 */
import { describe, expect, it } from "vitest";

import { isSlashName, slashRule } from "./slash.js";

const target = (d: string) => ({ elements: [{ d, id: "e0" }] });

/** Top-left to bottom-right: the slash direction. */
const FALLING = "M3 3L21 21";
/** Bottom-left to top-right: the direction everything else runs. */
const RISING = "M3 21L21 3";

describe("isSlashName", () => {
  it("recognises the ways the set names a slash", () => {
    for (const n of ["bell-off", "eye-slash", "no-flash", "video-2-off"]) {
      expect(isSlashName(n)).toBe(true);
    }
  });

  it("does not claim an icon that merely has a diagonal", () => {
    for (const n of ["bell", "arrow-up-right", "offer", "no"]) {
      expect(isSlashName(n)).toBe(false);
    }
  });
});

describe("slashRule", () => {
  it("stays quiet on a correctly drawn slash", () => {
    // `bell-off` really is M3 3 L21 21. This is the case that must not fire.
    expect(slashRule(target(FALLING), { icon: "bell-off" })).toEqual([]);
  });

  it("stays quiet on an icon that is not a slash", () => {
    expect(slashRule(target(RISING), { icon: "arrow-up-right" })).toEqual([]);
  });

  it("errors on a slash running the wrong way", () => {
    const [issue] = slashRule(target(RISING), { icon: "bell-off" });
    expect(issue.rule).toBe("slash-direction");
    expect(issue.severity).toBe("error");
    expect(issue.message).toMatch(/top-left to bottom-right/u);
  });

  it("warns when a slash draws both diagonals equally", () => {
    const both = {
      elements: [
        { d: FALLING, id: "a" },
        { d: RISING, id: "b" },
      ],
    };
    const [issue] = slashRule(both, { icon: "bell-off" });
    expect(issue.severity).toBe("warn");
  });

  it("says nothing when there is no straight diagonal to judge", () => {
    // A slash drawn as a curve. Guessing at its direction would invent a defect.
    const curve = { elements: [{ d: "M4 4C8 4 12 8 12 12", id: "a" }] };
    expect(slashRule(curve, { icon: "bell-off" })).toEqual([]);
  });
});

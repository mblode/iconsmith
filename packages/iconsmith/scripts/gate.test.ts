/**
 * The gate's own tests.
 *
 * The property under test is not "does the comparison arithmetic work" — it is
 * "can the gate be made to report success without the thing it guards being
 * true". So the digest pin, the battery-shape check and the exit codes are
 * asserted here, and the pin is asserted against the file actually committed:
 * a re-baseline that forgets to move the pin fails this test rather than
 * silently passing every candidate that follows.
 *
 * The battery itself is not run here. It is 300 icons and 3,000 rasters, it
 * needs the corpus, and a test that quietly skips when the corpus is absent is
 * not a test — `npx tsx scripts/gate.ts cosine` is the way to run it.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BASELINE_SHA,
  compare,
  GUARDED,
  iconsIn,
  loadBaseline,
  PERTURBATION_TOLERANCE,
  POOLED_TOLERANCE,
} from "./gate.js";

const BASELINE = "bench/stress-cosine.v1.json";

const scratch = (): string => mkdtempSync(path.join(tmpdir(), "gate-"));

describe("the pinned baseline", () => {
  it("is the file in the repository", () => {
    const digest = createHash("sha256")
      .update(readFileSync(BASELINE, "utf-8"))
      .digest("hex");
    expect(digest).toBe(BASELINE_SHA);
  });

  it("loads, and carries the numbers the gate compares against", () => {
    const base = loadBaseline(BASELINE);
    expect(base.separation.auc).toBeCloseTo(0.8637, 4);
    expect(base.sample).toEqual({
      icons: 300,
      seed: 1,
      variant: "round-outlined-radius-3-stroke-2",
    });
    expect(base.perturbations).toHaveLength(10);
    expect(base.families.preserving.n).toBe(1483);
    expect(base.families.breaking.n).toBe(1065);
  });

  it("refuses a baseline that has been edited", () => {
    const file = path.join(scratch(), "moved-goalposts.json");
    const base = JSON.parse(readFileSync(BASELINE, "utf-8")) as {
      separation: { auc: number };
    };
    base.separation.auc = 0.2;
    writeFileSync(file, JSON.stringify(base));
    expect(() => loadBaseline(file)).toThrow(/not the baseline/u);
    // And says what a legitimate re-baseline looks like, so the fix for an
    // honest failure is not "delete the check".
    expect(() => loadBaseline(file)).toThrow(/deliberate act/u);
  });

  it("refuses a baseline that is not there", () => {
    expect(() => loadBaseline("bench/no-such-file.json")).toThrow(
      /will not run without one/u
    );
  });
});

describe("the guarded paths", () => {
  it("cover the baseline, the battery, the panel and the gate itself", () => {
    expect(GUARDED).toContain(BASELINE);
    expect(GUARDED).toContain("scripts/stress-cosine.ts");
    expect(GUARDED).toContain("src/eval/blindspot.ts");
    // A gate that does not notice edits to itself is one edit from silent.
    expect(GUARDED).toContain("scripts/gate.ts");
  });
});

describe("compare", () => {
  it("passes a drop inside the tolerance and fails one past it", () => {
    expect(compare("pooled", 0.864, 0.85, POOLED_TOLERANCE).usable).toBe(true);
    expect(compare("pooled", 0.864, 0.843, POOLED_TOLERANCE).usable).toBe(
      false
    );
  });

  it("never fails an improvement", () => {
    expect(compare("pooled", 0.864, 0.97, POOLED_TOLERANCE).usable).toBe(true);
    expect(compare("pooled", 0.864, 0.97, POOLED_TOLERANCE).delta).toBeCloseTo(
      0.106,
      6
    );
  });

  it("holds a single perturbation to the wider band, and still holds it", () => {
    // `dot-two-tiers` at 0.774 is the perturbation the structural panel exists
    // because of. Losing a fifth of what is left of it is a failure.
    expect(
      compare("dot-two-tiers", 0.774, 0.74, PERTURBATION_TOLERANCE).usable
    ).toBe(true);
    expect(
      compare("dot-two-tiers", 0.774, 0.71, PERTURBATION_TOLERANCE).usable
    ).toBe(false);
  });

  it("treats a perturbation that vanished as a total loss", () => {
    // A missing name reads as AUC 0 in `cosineGate`, which no tolerance
    // forgives; the battery-shape check names it too.
    expect(compare("gone", 0.888, 0, PERTURBATION_TOLERANCE).usable).toBe(
      false
    );
  });
});

describe("the tolerances", () => {
  it("clear the seed-to-seed spread the baseline reports, with room", () => {
    // Pooled AUC over seeds 1..5 at n=300: 0.8626..0.8707, a spread of 0.008.
    expect(POOLED_TOLERANCE).toBeGreaterThan(0.008 * 2);
    // The widest single-perturbation spread over the same seeds is translate-1
    // at 0.041.
    expect(PERTURBATION_TOLERANCE).toBeGreaterThan(0.041);
    // And are not so wide that a scorer could lose half its discrimination and
    // still pass.
    expect(POOLED_TOLERANCE).toBeLessThan(0.05);
    expect(PERTURBATION_TOLERANCE).toBeLessThan(0.1);
  });
});

describe("iconsIn", () => {
  it("reads the .svg files of a directory, sorted", () => {
    const dir = scratch();
    writeFileSync(path.join(dir, "b.svg"), "<svg/>");
    writeFileSync(path.join(dir, "a.svg"), "<svg/>");
    writeFileSync(path.join(dir, "notes.txt"), "ignored");
    expect(iconsIn(dir).map((i) => i.name)).toEqual(["a", "b"]);
  });

  it("refuses an empty directory rather than reporting a clean run", () => {
    expect(() => iconsIn(scratch())).toThrow(/no \.svg files/u);
  });

  it("refuses a directory that is not there", () => {
    expect(() => iconsIn(path.join(scratch(), "nope"))).toThrow(/cannot list/u);
  });
});

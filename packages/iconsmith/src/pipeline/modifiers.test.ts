/**
 * Modifier isolation, tested on shapes whose right answer is arithmetic.
 *
 * The corpus is 247MB and gitignored, so anything that needs it cannot run in
 * CI. Every fixture here is a rectangle or a cross whose extent and separation
 * can be worked out on paper — which is also the only way to be sure the
 * clustering is finding a badge rather than getting lucky on real icons.
 */
import { describe, expect, it } from "vitest";

import type { CorpusIcon, CorpusShape, Variant } from "../corpus/load.js";
import {
  anchorOf,
  clusterIcon,
  deriveSpec,
  elementsOf,
  familyOf,
  isolateBadge,
  splitName,
} from "./modifiers.js";
import type { Badge, ModifierGroup } from "./modifiers.js";

const shape = (d: string, strokeWidth = 2): CorpusShape => ({
  cap: "round",
  d,
  filled: false,
  strokeWidth,
});

const icon = (symbol: string, ds: string[]): CorpusIcon => ({
  shapes: ds.map((d) => shape(d)),
  symbol,
  variant: {
    corner: "round",
    key: "round-outlined-radius-3-stroke-2",
    radius: 3,
    stroke: 2,
    style: "outlined",
  } satisfies Variant,
});

/** A body filling the top-left: path bounds 3..15, visual extent 2..16. */
const BODY = "M3 3L15 3L15 15L3 15Z";
/** A plus at (18,18), arms 6 long: path bounds 15..21, visual extent 14..22. */
const PLUS = "M15 18L21 18";
const PLUS_V = "M18 15L18 21";

const badgeOf = (symbol: string, ds: string[]): Badge | null =>
  isolateBadge(symbol, clusterIcon(elementsOf(icon(symbol, ds))));

describe("anchorOf", () => {
  it("names nine slots, so a left and a right badge are not the same slot", () => {
    expect(anchorOf([18, 18])).toBe("bottom-right");
    expect(anchorOf([6, 18])).toBe("bottom-left");
    expect(anchorOf([18, 6])).toBe("top-right");
    expect(anchorOf([12, 12])).toBe("centre");
    expect(anchorOf([12, 18])).toBe("bottom");
    expect(anchorOf([6, 12])).toBe("left");
  });
});

describe("clusterIcon", () => {
  it("keeps strokes that touch in one mark", () => {
    // The two arms of a plus cross at their midpoints. They only measure as one
    // mark if the straight segments are resampled — flattening an `L` yields
    // its two endpoints, which are 4px apart.
    expect(clusterIcon(elementsOf(icon("plus", [PLUS, PLUS_V])))).toHaveLength(
      1
    );
  });

  it("separates marks that stand clear of each other", () => {
    expect(
      clusterIcon(elementsOf(icon("x", [BODY, PLUS, PLUS_V])))
    ).toHaveLength(2);
  });

  it("orders marks smallest first", () => {
    const [small, large] = clusterIcon(
      elementsOf(icon("x", [BODY, PLUS, PLUS_V]))
    );
    expect(small.extent.w).toBeLessThan(large.extent.w);
  });
});

describe("isolateBadge", () => {
  it("measures the badge's visual extent, not its path bounds", () => {
    const badge = badgeOf("thing-add", [BODY, PLUS, PLUS_V]);
    // Arms span 15..21, so the path is 6 wide and the ink is 8 wide.
    expect(badge?.extent.w).toBeCloseTo(8, 6);
    expect(badge?.extent.h).toBeCloseTo(8, 6);
    expect(badge?.anchor).toBe("bottom-right");
    expect(badge?.strokes).toBe(2);
  });

  it("measures the ink gap, not the centre-line distance", () => {
    const badge = badgeOf("thing-add", [BODY, PLUS, PLUS_V]);
    // Body corner (15,15) to the badge arm at (15,18): 3px of centre line,
    // less one stroke of ink shared between the two. Resolution is the
    // resampling interval, so this is good to about a twentieth of a pixel.
    expect(badge?.gap).toBeCloseTo(1, 1);
  });

  it("returns null for a single connected drawing", () => {
    // The suffix says modifier; the drawing is one mark. That is a redraw, and
    // the caller reports it rather than inventing a badge for it.
    expect(badgeOf("thing-2", [BODY])).toBeNull();
  });

  it("returns null when the icon has no modifier in its name", () => {
    expect(badgeOf("thing", [BODY, PLUS, PLUS_V])).toBeNull();
  });

  it("refuses to call half of a split drawing a badge", () => {
    // Two comparable halves are a `-duo`, not a badge. Calling the smaller one
    // a badge would put a 12-wide entry in a table of 8s.
    const left = "M3 3L11 3L11 21L3 21Z";
    const right = "M14 3L21 3L21 21L14 21Z";
    expect(badgeOf("thing-duo", [left, right])).toBeNull();
  });

  it("absorbs a detached second mark that belongs to the badge", () => {
    // An `info` badge is a dot above a stem: two marks that never touch. Taking
    // only the smaller measures the dot alone.
    const dot = "M18 14L18 14.01";
    const stem = "M18 17L18 21";
    const badge = badgeOf("thing-info", [BODY, dot, stem]);
    expect(badge?.strokes).toBe(2);
    expect(badge?.extent.h).toBeGreaterThan(6);
  });

  it("keeps a multi-part base out of the badge", () => {
    // The base is a frame plus an inner rule that does not touch it. The inner
    // rule is nearer the frame than the badge, so it stays with the base.
    const frame = "M2 2L16 2L16 16L2 16Z";
    const rule = "M5 9L13 9";
    const badge = badgeOf("thing-add", [frame, rule, PLUS, PLUS_V]);
    expect(badge?.strokes).toBe(2);
    expect(badge?.extent.w).toBeCloseTo(8, 6);
  });
});

const badge = (over: Partial<Badge>): Badge => ({
  anchor: "bottom-right",
  centre: [18, 18],
  extent: { h: 8, w: 8, x0: 14, x1: 22, y0: 14, y1: 22 },
  family: "thing",
  fingerprints: [],
  gap: 2,
  icon: "thing-add",
  kind: "badge",
  modifier: "add",
  strokes: 2,
  ...over,
});

const group = (badges: Badge[]): ModifierGroup => ({
  badges,
  modifier: "add",
  redrawn: [],
  shapeSpread: 0,
});

describe("deriveSpec", () => {
  it("reports full agreement when every instance matches", () => {
    const [spec] = deriveSpec([
      group([badge({}), badge({ icon: "other-add" })]),
    ]);
    expect(spec.width).toBe(8);
    expect(spec.agreement).toBe(1);
    expect(spec.badgeLike).toBe(true);
  });

  it("counts a differently sized instance against the agreement", () => {
    const odd = badge({
      extent: { h: 6, w: 6, x0: 15, x1: 21, y0: 15, y1: 21 },
      icon: "odd-add",
    });
    const [spec] = deriveSpec([
      group([badge({}), badge({ icon: "b-add" }), odd]),
    ]);
    expect(spec.agreement).toBeCloseTo(2 / 3, 6);
  });

  it("marks a centred suffix as not a badge", () => {
    const centred = badge({ anchor: "centre", centre: [12, 12] });
    const [spec] = deriveSpec([
      group([centred, badge({ ...centred, icon: "b-2" })]),
    ]);
    expect(spec.badgeLike).toBe(false);
  });

  it("rounds the canonical size onto the drawing grid", () => {
    const a = badge({
      extent: { h: 8.1, w: 8.1, x0: 14, x1: 22, y0: 14, y1: 22 },
    });
    const b = badge({
      extent: { h: 8.2, w: 8.2, x0: 14, x1: 22, y0: 14, y1: 22 },
      icon: "b-add",
    });
    const [spec] = deriveSpec([group([a, b])]);
    expect(spec.width % 0.25).toBeCloseTo(0, 9);
  });
});

describe("names", () => {
  it("splits a name into family and modifier at the first hyphen", () => {
    expect(splitName("folder-add-left")).toEqual({
      base: "folder",
      modifier: "add-left",
    });
    expect(splitName("user")).toBeNull();
    expect(familyOf("folder-add-left")).toBe("folder");
  });
});

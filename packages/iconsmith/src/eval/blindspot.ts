/**
 * The checks rendered cosine cannot make.
 *
 * `scripts/stress-cosine.ts` measured what the scorer can and cannot resolve,
 * and one of its findings is the reason this module exists: a dot redrawn two
 * tiers larger — a real, visible sizing error — scores a median cosine of
 * 0.988, which sits *inside* the band a legal 0.25-unit jitter produces (median
 * 0.992, min 0.978). No threshold on cosine separates those two, so no amount
 * of tuning the scorer turns element sizing into something it measures. The
 * same holds for a translation, which the metric punishes harder than a
 * deletion.
 *
 * So these live outside cosine entirely: geometry and ink, measured against the
 * corpus, reported as pass/fail. They are deliberately dumb. A structural check
 * that learned anything from the score it guards would be exploitable by the
 * same gradient it exists to catch.
 *
 * Every threshold is a corpus measurement rather than an opinion, and every
 * measurement quoted in a comment here was taken by
 * `scripts/gate.ts structure --calibrate`, which re-derives all of them from
 * the corpus so a number that has drifted cannot go unnoticed.
 */
import sharp from "sharp";

import type { CorpusShape } from "../corpus/load.js";
import { parseIconSvg } from "../corpus/load.js";
import { bbox, parsePath } from "../geometry/path.js";
import { SPEC } from "../tools/canvas.js";
import type { Box, Subpath } from "../types.js";

/** The corpus draws on a 24×24 viewBox throughout. */
const CANVAS = 24;
const CENTRE = CANVAS / 2;
/** The live area: 2 units of margin on all four sides. */
const MARGIN = 2;
/** The largest keyline in `SPEC.keylines`, and so the box everything fits. */
const EXTENT_MAX = CANVAS - 2 * MARGIN;
/** How far a centre may sit from `CENTRE` and still read as centred: the grid
 *  tolerance, the same 0.25 the jitter perturbation moves nodes by. */
const CENTRE_TOLERANCE = 0.25;
/** Side of each of the four corner squares the ink check looks at. */
const CORNER = 4;

/** The dot ladder, smallest first: the only visual diameters a dot is drawn at.
 *  Read from `SPEC` rather than written out, so a spec change moves the check
 *  with it instead of leaving it asserting last year's ladder. */
const DOT_TIERS = Object.values(SPEC.dots).toSorted((a, b) => a - b);
/** A closed subpath this wide or narrower is a dot; anything larger is a ring
 *  the icon means as a ring. Extent, not visual diameter — the two differ by
 *  the stroke, and confusing them is this codebase's most repeated mistake. */
const DOT_EXTENT = 2.5;
/**
 * Below this extent a stroked subpath draws no line, only its caps: the set's
 * idiom for a dot is `M12 8V8.01` with a round cap, where the stroke width is
 * the dot's diameter. Taken from `corpus/measure.ts`, which measured the same
 * marks, and wider than the 0.001 `scripts/stress-cosine.ts` uses — the battery
 * only needs dots it can grow, this needs every dot that exists.
 */
const DEGENERATE = 0.25;
/** How far off a tier a dot may sit. The grid quantum, and the widest window
 *  that still separates adjacent tiers: 2.5 and 3 are half a unit apart, so
 *  anything wider than 0.25 would let a dot pass as either. 203 of the corpus's
 *  207 dots clear it. */
const TIER_TOLERANCE = SPEC.grid;

/** Pixels per unit when measuring ink. 4px/unit puts each 4×4 corner square on
 *  a whole 16×16 block, so the corner mask is exact rather than antialiased at
 *  its own boundary — the measurement must not depend on where that boundary
 *  landed between pixels. Deliberately not `render.ts`'s 48px blurred raster:
 *  that one exists to forgive placement, and this one exists not to. */
const PX_PER_UNIT = 4;
const RASTER = CANVAS * PX_PER_UNIT;
/** Below this an icon has no ink to apportion and every fraction is 0/0. */
const EPS = 1e-9;
/**
 * Slack on the two checks that compare an extreme of the geometry to a fixed
 * line: extent against the keyline box, margin against the canvas edge.
 *
 * A twentieth of a unit — a fifth of a pixel at the 4px/unit raster, a fifth of
 * the 0.25 grid, under anything a person can see. Without it these two fail 48
 * corpus icons on extent and 69 on margin by less than this much, because a
 * cubic's approximation of a circular arc misses the true radius by a few
 * thousandths of a unit. Failing an icon for that measures the flattener rather
 * than the drawing.
 *
 * Deliberately not applied to centring, where the same error cancels between
 * the two extremes, nor to corner ink, which is a fraction and not a length.
 */
const SLOP = 0.05;
/** Two numbers that should be equal on the 0.25 grid, and are, to the last few
 *  bits of a double. */
const EXACT = 1e-6;

export interface IconMeasurement {
  /** Centre of the visual extent. */
  centre: { x: number; y: number };
  /** Share of the icon's ink falling in the four 4×4 corner squares. */
  cornerInk: number;
  /** `<path>`, `<circle>`, `<rect>` and the rest, as `parseIconSvg` resolves
   *  them. Reported but never gated: see `marks`. */
  elements: number;
  /** Visual extent: path bbox plus the stroke, half per side. Comparing a
   *  stroked bbox to a filled one measures a rendering fact rather than a
   *  design one — the mistake this codebase has made most often. */
  extent: { x: number; y: number };
  /** Dots drawn, and how many of them sit off the `SPEC.dots` ladder. This is
   *  the blind spot the panel exists for, measured directly: `dot-two-tiers` —
   *  a dot redrawn two tiers larger — scores a median cosine of 0.988, inside
   *  the band a legal jitter produces, so the scorer cannot see it at any
   *  threshold. Geometry can, exactly. */
  dots: { offTier: number; total: number };
  /** Distance from each canvas edge to the visual extent. */
  margin: { bottom: number; left: number; right: number; top: number };
  /**
   * Subpaths across every element: the count of separate marks on the canvas.
   *
   * This, not `elements`, is what the density check gates. Grouping is free —
   * the same drawing can be one element or five, and `split-element` is a
   * perturbation the stress battery confirms the scorer cannot see at all
   * (AUC 0.997 as a *preserving* change). A cap on `<path>` count would
   * therefore be satisfiable by regrouping without redrawing anything, which is
   * the exact shape of a gate that gets optimised against rather than met.
   */
  marks: number;
}

const box = (x0: number, y0: number, x1: number, y1: number): Box => ({
  h: y1 - y0,
  w: x1 - x0,
  x0,
  x1,
  y0,
  y1,
});

const union = (a: Box, b: Box): Box =>
  box(
    Math.min(a.x0, b.x0),
    Math.min(a.y0, b.y0),
    Math.max(a.x1, b.x1),
    Math.max(a.y1, b.y1)
  );

/** One shape's visual box: its geometry grown by half its stroke on each side.
 *  A filled shape grows by nothing. */
const visualBox = (d: string, strokeWidth: number): Box | null => {
  const subpaths = parsePath(d);
  if (subpaths.length === 0) {
    return null;
  }
  const b = bbox(subpaths);
  const half = strokeWidth / 2;
  return box(b.x0 - half, b.y0 - half, b.x1 + half, b.y1 + half);
};

/**
 * The dot this subpath draws, if it draws one, as a visual diameter.
 *
 * Two constructions, both of them the corpus's: a zero-length round-capped
 * segment where the cap *is* the dot and the stroke width is its diameter, and
 * a small closed ring whose visual diameter is its extent plus its stroke. The
 * same definition `scripts/stress-cosine.ts` perturbs, deliberately — a check
 * that recognised a different set of marks than the battery does would not be
 * answering the blind spot the battery found.
 */
const dotDiameter = (
  sp: Subpath,
  strokeWidth: number,
  cap: CorpusShape["cap"]
): number | null => {
  const b = bbox([sp]);
  const ext = Math.max(b.w, b.h);
  if (ext < DEGENERATE) {
    // Only under a round cap. The same near-zero segment under a butt cap draws
    // nothing at all, and under a square cap draws a square.
    return cap === "round" && strokeWidth > 0 ? strokeWidth : null;
  }
  return sp.closed && ext <= DOT_EXTENT && Math.abs(b.w - b.h) < 0.1
    ? ext + strokeWidth
    : null;
};

const offTier = (diameter: number): boolean =>
  Math.min(...DOT_TIERS.map((t) => Math.abs(t - diameter))) > TIER_TOLERANCE;

/** Ink per pixel, unblurred, at `PX_PER_UNIT`. */
const inkRaster = (svg: string): Promise<Buffer> =>
  sharp(Buffer.from(svg.replaceAll("currentColor", "#000")), { density: 300 })
    .resize(RASTER, RASTER, { background: "#fff", fit: "contain" })
    .flatten({ background: "#fff" })
    .greyscale()
    .raw()
    .toBuffer();

/** The share of an icon's ink inside the four corner squares. */
const cornerShare = (raw: Buffer): number => {
  const block = CORNER * PX_PER_UNIT;
  let total = 0;
  let corners = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const ink = (255 - raw[i]) / 255;
    if (ink <= 0) {
      continue;
    }
    total += ink;
    const px = i % RASTER;
    const py = Math.floor(i / RASTER);
    if (
      (px < block || px >= RASTER - block) &&
      (py < block || py >= RASTER - block)
    ) {
      corners += ink;
    }
  }
  return total > EPS ? corners / total : 0;
};

/**
 * Measure one icon's SVG source.
 *
 * Goes through `parseIconSvg` rather than scraping `d=` attributes: 252 icons
 * in the set place a shape as `<circle>`, `<rect>` or `<ellipse>`, and scraping
 * measures those with pieces missing.
 */
export const measureIcon = async (svg: string): Promise<IconMeasurement> => {
  const shapes = parseIconSvg(svg);
  const boxes = shapes
    .map((s) => visualBox(s.d, s.filled ? 0 : s.strokeWidth))
    .filter((b): b is Box => b !== null);
  const empty = boxes.length === 0;
  let b = empty ? box(CENTRE, CENTRE, CENTRE, CENTRE) : boxes[0];
  for (const next of boxes.slice(1)) {
    b = union(b, next);
  }
  // Stroked shapes only. The ladder in `SPEC.dots` was measured on stroked
  // construction, where a dot is a cap or a small ring plus its stroke; the
  // same subpath inside a filled shape is a hole or a counter, and reading its
  // bbox as a dot diameter fails a quarter of the set's filled icons on a
  // convention that was never about them. The generator draws only strokes, so
  // nothing it produces is excluded by this.
  const diameters = shapes.flatMap((s) =>
    s.filled || s.strokeWidth <= 0
      ? []
      : parsePath(s.d)
          .map((sp) => dotDiameter(sp, s.strokeWidth, s.cap))
          .filter((d): d is number => d !== null)
  );
  return {
    centre: { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 },
    cornerInk: empty ? 0 : cornerShare(await inkRaster(svg)),
    dots: {
      offTier: diameters.filter((d) => offTier(d)).length,
      total: diameters.length,
    },
    elements: shapes.length,
    extent: { x: b.w, y: b.h },
    margin: {
      bottom: CANVAS - b.y1,
      left: b.x0,
      right: CANVAS - b.x1,
      top: b.y0,
    },
    marks: shapes.reduce((n, s) => n + parsePath(s.d).length, 0),
  };
};

export interface StructuralCheck {
  /** Which icons this check has anything to say about. Omitted means all of
   *  them. `dot-tiers` has nothing to say about an icon that draws no dot, and
   *  counting those as passes would dilute its rate with 1,474 icons that were
   *  never asked the question. */
  applies?: (m: IconMeasurement) => boolean;
  /** The corpus's own pass rate on this check, over the icons of `HOUSE_VARIANT`
   *  drawn entirely in strokes that the check applies to. The floor is derived
   *  from it. */
  corpusRate: number;
  /** Why an icon failed. Only called when `holds` is false. */
  explain: (m: IconMeasurement) => string;
  /** True when this icon passes. */
  holds: (m: IconMeasurement) => boolean;
  name: string;
  /** The house-spec target, in the words a designer would use. */
  target: string;
}

/**
 * How far below the corpus's own pass rate a generated set may sit.
 *
 * The corpus is not perfect against its own conventions: 72% of it is centred
 * within a quarter unit on both axes, 73% keeps a full 2u margin, 76% fits the
 * 20×20 keyline box. A floor set
 * at the corpus rate fails the corpus, so every floor is the measured rate less
 * this margin — a set may draw a little worse than the set it is imitating and
 * still pass, but not a lot worse.
 *
 * 12 points is roughly one icon in eight. It is the largest slack that still
 * catches the failures these checks exist for: a candidate that stops centring,
 * or starts drawing to the canvas edge, does not lose 12 points, it loses 40.
 */
const TOLERANCE = 0.12;

/** Corpus p95 of marks per icon is 8; the cap is 9, one above, so the busiest
 *  legitimate icons are not on the boundary. Median 3, p75 5, p90 7. */
const MAX_MARKS = 9;
/**
 * Corpus p95 of corner ink is 1.5%, p99 4.3%. The cap is 2%: the pooled figure
 * is 0.37% against 11.1% for ink spread uniformly, but a cap anywhere near the
 * pooled figure fails a quarter of the corpus, because the icons that do put
 * ink in a corner put a lot there.
 */
const MAX_CORNER_INK = 0.02;

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const u = (x: number): string => x.toFixed(2);

const minMargin = (m: IconMeasurement): number =>
  Math.min(m.margin.bottom, m.margin.left, m.margin.right, m.margin.top);

export const CHECKS: readonly StructuralCheck[] = [
  {
    corpusRate: 0.974,
    explain: (m) =>
      m.marks === 0
        ? "draws nothing"
        : `${m.marks} marks across ${m.elements} element(s), over the ${MAX_MARKS} cap`,
    holds: (m) => m.marks > 0 && m.marks <= MAX_MARKS,
    name: "element-count",
    target: `1..${MAX_MARKS} marks (corpus median 3, p75 5, p90 7, p95 8)`,
  },
  {
    corpusRate: 0.762,
    explain: (m) =>
      `visual extent ${u(m.extent.x)}×${u(m.extent.y)}, over the ${EXTENT_MAX}×${EXTENT_MAX} box`,
    holds: (m) =>
      m.extent.x <= EXTENT_MAX + SLOP && m.extent.y <= EXTENT_MAX + SLOP,
    name: "extent",
    target: `visual extent fits ${EXTENT_MAX}×${EXTENT_MAX}, the largest keyline in SPEC`,
  },
  {
    corpusRate: 0.719,
    explain: (m) =>
      `centre (${u(m.centre.x)}, ${u(m.centre.y)}) is over ${CENTRE_TOLERANCE}u off (${CENTRE}, ${CENTRE})`,
    holds: (m) =>
      Math.abs(m.centre.x - CENTRE) <= CENTRE_TOLERANCE + EXACT &&
      Math.abs(m.centre.y - CENTRE) <= CENTRE_TOLERANCE + EXACT,
    name: "centred",
    target: `centre within ${CENTRE_TOLERANCE}u of (${CENTRE}, ${CENTRE}) — corpus 86% horizontally, 81% vertically, 72% on both`,
  },
  {
    corpusRate: 0.935,
    explain: (m) => `${pct(m.cornerInk)} of the ink is in the four corners`,
    holds: (m) => m.cornerInk <= MAX_CORNER_INK + EXACT,
    name: "corners-empty",
    target: `at most ${pct(MAX_CORNER_INK)} of ink in the four ${CORNER}×${CORNER} corners — the corpus pools at 0.37%, uniform ink would be 11.1%`,
  },
  {
    applies: (m) => m.dots.total > 0,
    corpusRate: 0.985,
    explain: (m) =>
      `${m.dots.offTier} of ${m.dots.total} dot(s) off the ${DOT_TIERS.join("/")} ladder by more than ${TIER_TOLERANCE}u`,
    holds: (m) => m.dots.offTier === 0,
    name: "dot-tiers",
    target: `every dot on the ${DOT_TIERS.join("/")} ladder — corpus 98.5% of its 66 dot-bearing icons, 98.1% of their 207 dots`,
  },
  {
    corpusRate: 0.731,
    explain: (m) =>
      `margin ${u(minMargin(m))}u, under ${MARGIN}u: ${Object.entries(m.margin)
        .filter(([, v]) => v < MARGIN - SLOP)
        .map(([side, v]) => `${side} ${u(v)}`)
        .join(", ")}`,
    holds: (m) => minMargin(m) >= MARGIN - SLOP,
    name: "margins",
    target: `${MARGIN}u clear on all four sides`,
  },
];

/** A rate rounded down to whole percent, so a floor never reads as more precise
 *  than the sample it came from. */
export const floorFor = (check: StructuralCheck): number =>
  Math.floor((check.corpusRate - TOLERANCE) * 100) / 100;

/**
 * Upper end of the 95% Wilson interval for `passed of n`.
 *
 * A check fails only when even this optimistic reading of the observed rate
 * sits below the floor, which is what makes the panel usable on a 24-icon bench
 * run. At n=24 a true rate equal to the corpus rate lands 12 points low by
 * chance often enough that a bare comparison would reject roughly one honest
 * run in ten, across six checks — a gate that cries wolf that often is a gate
 * somebody turns off. The interval scales the demand with the evidence: a small
 * set has to be much worse than the corpus to fail, a 300-icon set only a
 * little.
 */
export const wilsonUpper = (passed: number, n: number): number => {
  if (n === 0) {
    return 0;
  }
  const z = 1.96;
  const p = passed / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.min(1, (centre + half) / d);
};

export interface IconVerdict {
  failed: string[];
  icon: string;
  measurement: IconMeasurement;
  /** One line per failed check, naming the measurement that failed it. */
  reasons: string[];
}

export interface CheckResult {
  /** The optimistic end of `rate`, and what `floor` is actually compared to. */
  ceiling: number;
  failures: string[];
  floor: number;
  n: number;
  name: string;
  passed: number;
  rate: number;
  target: string;
  usable: boolean;
}

export interface StructuralReport {
  builtAt: string;
  checks: CheckResult[];
  icons: IconVerdict[];
  n: number;
  procedure: string;
  /** Where the icons came from, so a committed report says what it measured. */
  source: string;
  /** False when any check fell below its floor, or when there was nothing to
   *  measure. An empty run is a failure: a candidate that produced no icons
   *  must not pass the panel that exists to look at its icons. */
  usable: boolean;
  verdict: string;
}

const PROCEDURE = `Every .svg in the directory is measured geometrically, and rasterised at ${PX_PER_UNIT}px per unit without blur for the corner check — deliberately not through \`tools/render.ts\`, whose 48px blurred raster exists to forgive placement and would smear ink across the corner boundary being measured. Visual extent is the path bbox plus the stroke, half per side, unioned over the elements \`parseIconSvg\` resolves (including the \`<circle>\`, \`<rect>\` and \`<ellipse>\` that 252 icons in the set draw with). Six checks, each a corpus measurement rather than an opinion: mark count against the p95 of the 1,528 stroked icons of the house variant, visual extent against the ${EXTENT_MAX}×${EXTENT_MAX} keyline box, centring within ${CENTRE_TOLERANCE}u of (${CENTRE}, ${CENTRE}), corner ink against the p95 of the same set, every dot on the ${DOT_TIERS.join("/")} ladder, and ${MARGIN}u of margin on all four sides. A check is scored only over the icons it applies to — \`dot-tiers\` asked of an icon that draws no dot is not a pass, it is not a question — so its rate is 98.5% over the 66 dot-bearing corpus icons rather than 99.9% over all 1,528. Density is gated on marks rather than on \`<path>\` elements because grouping is free: \`split-element\` is a perturbation the cosine battery scores as no change at all, so a cap on element count is satisfiable by regrouping without redrawing. A check passes the set when the upper end of the 95% Wilson interval on its pass rate clears a floor set at the corpus's own rate less ${TOLERANCE * 100} points — the corpus is not perfect against its own conventions, so a floor at the corpus rate fails the corpus, and the interval keeps a 24-icon run from failing on sampling noise. These checks sit outside cosine on purpose: the scorer's own stress test found a dot two tiers too large scores 0.988, inside the band a legal 0.25 jitter produces, so no threshold on cosine can see a sizing error at all.`;

/** Judge one icon against every check. */
export const inspect = (
  icon: string,
  measurement: IconMeasurement
): IconVerdict => {
  const failed = CHECKS.filter(
    (c) => (c.applies?.(measurement) ?? true) && !c.holds(measurement)
  );
  return {
    failed: failed.map((c) => c.name),
    icon,
    measurement,
    reasons: failed.map((c) => `${c.name}: ${c.explain(measurement)}`),
  };
};

/** How many failures to name per check: enough to debug, few enough that a
 *  wholly broken set does not print itself into the terminal. */
const NAMED_FAILURES = 5;

const verdictOf = (checks: readonly CheckResult[], n: number): string => {
  if (n === 0) {
    return "FAIL: nothing to measure. A run that produced no icons does not pass the panel that exists to look at its icons.";
  }
  const failed = checks.filter((c) => !c.usable);
  const rates = checks.map((c) => `${c.name} ${pct(c.rate)}`).join(", ");
  if (failed.length === 0) {
    return `PASS: ${n} icons, ${rates}. Every check clears the floor the corpus sets. This is not evidence the drawings are good — only that they are not off-spec in the ways rendered cosine cannot see.`;
  }
  return `FAIL: ${failed
    .map(
      (c) =>
        `${c.name} ${pct(c.rate)} (best case ${pct(c.ceiling)}) against a ${pct(c.floor)} floor`
    )
    .join(
      "; "
    )}. Rendered cosine cannot resolve these, so no benchmark score stands in for them.`;
};

/** Run the panel over already-read SVG sources. */
export const panel = async (
  icons: readonly { name: string; svg: string }[],
  source = "(unnamed)"
): Promise<StructuralReport> => {
  const verdicts: IconVerdict[] = [];
  for (const { name, svg } of icons) {
    // One raster at a time: a set is thousands of icons and nothing here needs
    // them all in memory at once.
    // oxlint-disable-next-line no-await-in-loop
    verdicts.push(inspect(name, await measureIcon(svg)));
  }
  const total = verdicts.length;
  const checks: CheckResult[] = CHECKS.map((c) => {
    const asked = verdicts.filter((v) => c.applies?.(v.measurement) ?? true);
    const n = asked.length;
    const failures = asked.filter((v) => v.failed.includes(c.name));
    const passed = n - failures.length;
    const floor = floorFor(c);
    const ceiling = wilsonUpper(passed, n);
    return {
      ceiling,
      failures: failures
        .slice(0, NAMED_FAILURES)
        .map((v) => `${v.icon} — ${c.explain(v.measurement)}`),
      floor,
      n,
      name: c.name,
      passed,
      rate: n > 0 ? passed / n : 0,
      target: c.target,
      // A check nothing asked is not a check that failed. The run as a whole
      // still needs icons in it; that is `total`.
      usable: n === 0 || ceiling >= floor,
    };
  });
  return {
    builtAt: new Date().toISOString(),
    checks,
    icons: verdicts,
    n: total,
    procedure: PROCEDURE,
    source,
    usable: total > 0 && checks.every((c) => c.usable),
    verdict: verdictOf(checks, total),
  };
};

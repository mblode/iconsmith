/**
 * An evaluator stress test for the rendered-cosine metric.
 *
 * The eval has one tripwire on this metric: a score above SUSPICIOUS is read as
 * evidence of leakage, because two mature sets drawing the same concept only
 * reach 0.737. That catches a leak. It cannot catch the metric measuring the
 * wrong thing — a comparator that scores *formatting* rather than *depiction*
 * looks identical from the outside, and every `reach` computed from it is then
 * a proxy with a decimal point.
 *
 * So the metric is perturbed rather than trusted. Each corpus icon is rewritten
 * two ways: changes that leave the drawing the same picture (a translation, a
 * jitter inside the grid tolerance, a different draw order, a path split), and
 * changes that make it a different picture (an element deleted, mirrored,
 * scaled, moved across the canvas, a dot two tiers too big). A metric that
 * measures depiction barely moves for the first family and moves a lot for the
 * second. One that measures formatting moves for both, or for neither.
 *
 * The headline is the **AUC** — P(a random semantics-preserving cosine beats a
 * random semantics-breaking one) — computed by `eval/separation.ts`, the same
 * function that discarded the DINO style column at 0.476, so the two numbers
 * are read on one scale. That column's failure says nothing about this one:
 * style similarity across sets and fidelity to one target icon are different
 * questions. This measures only the second.
 *
 *     npx tsx scripts/stress-cosine.ts [--n 150] [--seed 1] [--output json]
 *
 * Local rasterising and arithmetic. No model is called and nothing is written.
 */
import { parseArgs } from "node:util";

import type { CorpusIcon, CorpusShape } from "../src/corpus/load.js";
import { HOUSE_VARIANT, loadCorpus } from "../src/corpus/load.js";
import { median } from "../src/eval/panel.js";
import {
  auc,
  separation,
  SEPARATION_THRESHOLD,
} from "../src/eval/separation.js";
import {
  bbox,
  mirrorX,
  parsePath,
  scale,
  serialise,
  translate,
} from "../src/geometry/path.js";
import { SPEC } from "../src/tools/canvas.js";
import { cosine, inkVector } from "../src/tools/render.js";
import type { Box, Segment, Subpath } from "../src/types.js";

/** The dot ladder, smallest first. "Two tiers larger" is +2 on this list. */
const DOT_TIERS = Object.values(SPEC.dots).toSorted((a, b) => a - b);
const TIER_JUMP = 2;
/** How far a jittered node may move: the grid tolerance, either way. */
const JITTER = SPEC.grid;
const SCALE_FACTOR = 1.5;
/** A dot is a subpath this wide or narrower; anything larger is a ring the icon
 *  means as a ring. `bbox` extent plus the stroke is the *visual* diameter —
 *  the mistake this codebase has made most often is comparing one to the other. */
const DOT_EXTENT = 2.5;
const ROUND = 0.001;

type Family = "breaking" | "preserving";

interface Perturbation {
  /** Null when the icon has nothing this perturbation can act on. Every such
   *  refusal is counted and printed: a family whose n quietly halves is a
   *  different experiment from the one described. */
  apply: (shapes: CorpusShape[], random: () => number) => CorpusShape[] | null;
  family: Family;
  name: string;
  what: string;
}

// ---------------------------------------------------------------------------
// Shapes in, SVG out
// ---------------------------------------------------------------------------

/** Rebuild an icon from its shapes. The original is re-emitted through this
 *  same function rather than read off disk, so a perturbed icon differs from
 *  its reference by the perturbation and by nothing else — not by a serialiser
 *  round trip, not by an attribute the corpus writes and this does not. */
const toSvg = (shapes: readonly CorpusShape[]): string => {
  const body = shapes
    .map((s) =>
      s.filled
        ? `<path d="${s.d}" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/>`
        : `<path d="${s.d}" fill="none" stroke="currentColor" stroke-width="${s.strokeWidth}" stroke-linecap="${s.cap}" stroke-linejoin="round"/>`
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SPEC.canvas} ${SPEC.canvas}" fill="none">${body}</svg>`;
};

const subpathsOf = (shape: CorpusShape): Subpath[] => parsePath(shape.d);

const withSubpaths = (shape: CorpusShape, sps: Subpath[]): CorpusShape => ({
  ...shape,
  d: serialise(sps),
});

/** Replace one shape with zero or more. The unit every element-level
 *  perturbation is written against. */
const replaceShape = (
  shapes: readonly CorpusShape[],
  index: number,
  next: CorpusShape[]
): CorpusShape[] => [
  ...shapes.slice(0, index),
  ...next,
  ...shapes.slice(index + 1),
];

// ---------------------------------------------------------------------------
// Deterministic choice
// ---------------------------------------------------------------------------

/** The LCG `pipeline/eval.ts` and `scripts/calibrate.ts` use, seeded per icon
 *  and per perturbation, so a run is reproducible and adding a perturbation
 *  does not reshuffle the choices the others made. */
const rng = (seed: number): (() => number) => {
  let s = Math.abs(Math.trunc(seed)) % 2_147_483_648;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
};

/** A seed per icon and perturbation. Multiplicative rather than the usual
 *  xor-shift so it stays inside the arithmetic this codebase allows itself. */
const hash = (text: string): number => {
  let h = 7;
  for (const ch of text) {
    h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 2_147_483_647;
  }
  return h;
};

/** Indices in a stable but seed-dependent order, so "pick one that works" is a
 *  random draw rather than "always the first element". */
const shuffledIndices = (n: number, random: () => number): number[] => {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// ---------------------------------------------------------------------------
// Geometry the perturbations need and `geometry/path.ts` does not export
// ---------------------------------------------------------------------------

/** A subpath drawn backwards. Same ink under round caps and joins: only the
 *  order of the nodes changes, and a cubic's two handles swap with its ends. */
const reverseSubpath = (sp: Subpath): Subpath | null => {
  if (sp.segs.some((s) => s.t === "A")) {
    // 46 arcs in the whole set. Reversing one means re-deriving its sweep, and
    // getting that subtly wrong would show up as a metric finding rather than
    // as a bug — so they are refused instead.
    return null;
  }
  const nodes: [number, number][] = [sp.start];
  const handles: ([number, number, number, number] | null)[] = [];
  for (const seg of sp.segs) {
    if (seg.t === "C") {
      handles.push([seg.p[0], seg.p[1], seg.p[2], seg.p[3]]);
      nodes.push([seg.p[4], seg.p[5]]);
    } else {
      handles.push(null);
      nodes.push([seg.p[0], seg.p[1]]);
    }
  }
  const segs: Subpath["segs"] = [];
  for (let i = nodes.length - 1; i > 0; i -= 1) {
    const h = handles[i - 1];
    const [x, y] = nodes[i - 1];
    segs.push(
      h ? { p: [h[2], h[3], h[0], h[1], x, y], t: "C" } : { p: [x, y], t: "L" }
    );
  }
  return { closed: sp.closed, segs, start: nodes.at(-1) as [number, number] };
};

/**
 * Are these two element geometries the same mark?
 *
 * Sampled along the curves and compared by Hausdorff distance, not by nodes: a
 * path may carry a redundant node on a straight edge, so the same mark can have
 * two different node sets, and `bezier`'s rounded square is one — it has a seam
 * node where a connector meets it. Judging by nodes calls its mirror image a
 * changed drawing, which seeds the breaking family with observations where
 * nothing broke.
 *
 * Geometric rather than rendered on purpose. Deciding "same mark" with the
 * scoring rasteriser would let the metric mark its own homework: any change it
 * cannot resolve would be reclassified as no change, which is exactly the blind
 * spot this script is looking for.
 */
/** Points every `STEP` units along the curve, so two drawings of one mark
 *  sample it at the same places however their nodes are arranged. */
const STEP = 0.05;
const SAME_MARK = 0.06;

const cubicAt = (a: number, b: number, c: number, d: number, t: number) => {
  const m = 1 - t;
  return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d;
};

const dist = (a: [number, number], b: [number, number]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Control-polygon length: an overestimate of the curve's, which only ever
 *  samples it more finely than asked. */
const roughLength = (from: [number, number], seg: Segment): number => {
  if (seg.t === "C") {
    const p: [number, number][] = [
      from,
      [seg.p[0], seg.p[1]],
      [seg.p[2], seg.p[3]],
      [seg.p[4], seg.p[5]],
    ];
    return dist(p[0], p[1]) + dist(p[1], p[2]) + dist(p[2], p[3]);
  }
  if (seg.t === "L") {
    return dist(from, [seg.p[0], seg.p[1]]);
  }
  return dist(from, [seg.p[5], seg.p[6]]);
};

const cloud = (sps: readonly Subpath[]): [number, number][] => {
  const out: [number, number][] = [];
  for (const sp of sps) {
    let at: [number, number] = sp.start;
    // A closed subpath inks the edge back to its start, and leaving it out of
    // the cloud makes a symmetric box look like a changed drawing when it is
    // mirrored — three of its four edges land on the other three.
    const segs: Segment[] = sp.closed
      ? [...sp.segs, { p: [...sp.start], t: "L" }]
      : sp.segs;
    for (const seg of segs) {
      const steps = Math.max(2, Math.ceil(roughLength(at, seg) / STEP));
      for (let k = 0; k <= steps; k += 1) {
        const t = k / steps;
        if (seg.t === "C") {
          const [c1x, c1y, c2x, c2y, ex, ey] = seg.p;
          out.push([
            cubicAt(at[0], c1x, c2x, ex, t),
            cubicAt(at[1], c1y, c2y, ey, t),
          ]);
        } else if (seg.t === "L") {
          out.push([
            at[0] + (seg.p[0] - at[0]) * t,
            at[1] + (seg.p[1] - at[1]) * t,
          ]);
        } else {
          out.push([seg.p[5], seg.p[6]]);
        }
      }
      at = out.at(-1) as [number, number];
    }
  }
  return out;
};

const directed = (
  a: readonly [number, number][],
  b: readonly [number, number][]
): number => {
  let worst = 0;
  for (const x of a) {
    let near = Number.POSITIVE_INFINITY;
    for (const y of b) {
      near = Math.min(near, dist(x, y));
    }
    worst = Math.max(worst, near);
  }
  return worst;
};

const sameMark = (a: readonly Subpath[], b: readonly Subpath[]): boolean => {
  const [p, r] = [cloud(a), cloud(b)];
  return (
    p.length > 0 &&
    r.length > 0 &&
    Math.max(directed(p, r), directed(r, p)) < SAME_MARK
  );
};

/** A stroked subpath's *visual* extent: its bbox inflated by half the stroke,
 *  per side. Comparing a path bbox against the canvas instead is the mistake
 *  AGENTS.md names, and here it would let a perturbation clip against the
 *  viewBox edge — the metric would then be scoring the crop, not the change. */
const visualBox = (sps: Subpath[], strokeWidth: number): Box => {
  const b = bbox(sps);
  const pad = strokeWidth / 2;
  return {
    h: b.h + strokeWidth,
    w: b.w + strokeWidth,
    x0: b.x0 - pad,
    x1: b.x1 + pad,
    y0: b.y0 - pad,
    y1: b.y1 + pad,
  };
};

const onCanvas = (box: Box): boolean =>
  box.x0 >= 0 && box.y0 >= 0 && box.x1 <= SPEC.canvas && box.y1 <= SPEC.canvas;

const centre = (sps: Subpath[]): [number, number] => {
  const b = bbox(sps);
  return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
};

/** The dot this element draws, if it draws one. Two constructions, both of them
 *  Central's: a zero-length round-capped segment where the cap *is* the dot, and
 *  a tiny closed ring whose visual diameter is its extent plus its stroke. */
const dotDiameter = (sp: Subpath, strokeWidth: number): number | null => {
  const b = bbox([sp]);
  const ext = Math.max(b.w, b.h);
  if (ext < ROUND) {
    return strokeWidth;
  }
  if (sp.closed && ext <= DOT_EXTENT && Math.abs(b.w - b.h) < 0.1) {
    return ext + strokeWidth;
  }
  return null;
};

const tierAbove = (diameter: number): number | null => {
  const i = DOT_TIERS.findIndex((t) => Math.abs(t - diameter) < ROUND);
  return i !== -1 && i + TIER_JUMP < DOT_TIERS.length
    ? DOT_TIERS[i + TIER_JUMP]
    : null;
};

// ---------------------------------------------------------------------------
// The perturbations
// ---------------------------------------------------------------------------

const translateIcon = (shapes: CorpusShape[]): CorpusShape[] | null => {
  const widest = Math.max(...shapes.map((s) => s.strokeWidth));
  const b = visualBox(shapes.flatMap(subpathsOf), widest);
  let dx = 0;
  if (b.x1 + 1 <= SPEC.canvas) {
    dx = 1;
  } else if (b.x0 - 1 >= 0) {
    dx = -1;
  }
  if (dx === 0) {
    return null;
  }
  return shapes.map((s) =>
    withSubpaths(
      s,
      subpathsOf(s).map((sp) => translate(sp, dx, 0))
    )
  );
};

/** Move every on-path node by up to the grid tolerance. Handles are left where
 *  they are: the endpoints are what a drawer places, and dragging the handles
 *  with them would be a second, larger edit wearing this one's name. */
const jitterIcon = (
  shapes: CorpusShape[],
  random: () => number
): CorpusShape[] => {
  const off = () => (random() < 0.5 ? -JITTER : JITTER);
  const nudge = (seg: Segment): Segment => {
    if (seg.t === "C") {
      const [c1x, c1y, c2x, c2y, ex, ey] = seg.p;
      return { p: [c1x, c1y, c2x, c2y, ex + off(), ey + off()], t: "C" };
    }
    if (seg.t === "L") {
      return { p: [seg.p[0] + off(), seg.p[1] + off()], t: "L" };
    }
    return seg;
  };
  return shapes.map((s) =>
    withSubpaths(
      s,
      subpathsOf(s).map((sp) => ({
        closed: sp.closed,
        segs: sp.segs.map(nudge),
        start: [sp.start[0] + off(), sp.start[1] + off()] as [number, number],
      }))
    )
  );
};

/** Paint the same ink in the opposite order — subpaths within each element, and
 *  the elements themselves. Opaque strokes of one colour, so this is the
 *  harness's own control: anything but 1.000 is a bug here, not a finding. */
const reverseOrder = (shapes: CorpusShape[]): CorpusShape[] | null => {
  const total = shapes.reduce((n, s) => n + subpathsOf(s).length, 0);
  return total < 2
    ? null
    : shapes
        .map((s) => withSubpaths(s, subpathsOf(s).toReversed()))
        .toReversed();
};

const reverseOne = (
  shapes: CorpusShape[],
  random: () => number
): CorpusShape[] | null => {
  for (const i of shuffledIndices(shapes.length, random)) {
    const sps = subpathsOf(shapes[i]);
    for (const j of shuffledIndices(sps.length, random)) {
      const reversed = reverseSubpath(sps[j]);
      if (reversed) {
        return replaceShape(shapes, i, [
          withSubpaths(shapes[i], sps.with(j, reversed)),
        ]);
      }
    }
  }
  return null;
};

/** One element becomes two covering the same ink: split between subpaths where
 *  the element has several, otherwise mid-run through a single subpath, where
 *  the round cap the set already draws closes the seam. */
const splitElement = (
  shapes: CorpusShape[],
  random: () => number
): CorpusShape[] | null => {
  for (const i of shuffledIndices(shapes.length, random)) {
    const sps = subpathsOf(shapes[i]);
    if (sps.length >= 2) {
      const at = 1 + Math.floor(random() * (sps.length - 1));
      return replaceShape(shapes, i, [
        withSubpaths(shapes[i], sps.slice(0, at)),
        withSubpaths(shapes[i], sps.slice(at)),
      ]);
    }
    const [sp] = sps;
    // A closed subpath is walked as a loop with its closing line made explicit,
    // so the two halves still cover every unit of ink the loop did.
    const segs: Segment[] = sp.closed
      ? [...sp.segs, { p: [...sp.start], t: "L" }]
      : sp.segs;
    if (segs.length >= 2) {
      const at = Math.max(1, Math.floor(segs.length / 2));
      const seam = segs[at - 1];
      const joint: [number, number] =
        seam.t === "C" ? [seam.p[4], seam.p[5]] : [seam.p[0], seam.p[1]];
      return replaceShape(shapes, i, [
        withSubpaths(shapes[i], [
          { closed: false, segs: segs.slice(0, at), start: sp.start },
        ]),
        withSubpaths(shapes[i], [
          { closed: false, segs: segs.slice(at), start: joint },
        ]),
      ]);
    }
  }
  return null;
};

const deleteElement = (
  shapes: CorpusShape[],
  random: () => number
): CorpusShape[] | null => {
  if (shapes.length < 2) {
    return null;
  }
  // The index is drawn once. Drawing it inside the filter predicate — as this
  // did — asks a fresh question of every element and usually deletes nothing,
  // which reads as "the metric ignores a deleted element" rather than as a bug.
  const drop = Math.floor(random() * shapes.length);
  return shapes.filter((_, i) => i !== drop);
};

const mirrorElement = (
  shapes: CorpusShape[],
  random: () => number
): CorpusShape[] | null => {
  for (const i of shuffledIndices(shapes.length, random)) {
    const sps = subpathsOf(shapes[i]);
    const [cx] = centre(sps);
    const flipped = sps.map((sp) => translate(mirrorX(sp), 2 * cx, 0));
    // A mirror-symmetric element flips onto itself. Counting that as a broken
    // drawing would seed the breaking family with observations where nothing
    // broke, and quietly inflate the separation this script exists to report.
    if (!sameMark(flipped, sps)) {
      return replaceShape(shapes, i, [withSubpaths(shapes[i], flipped)]);
    }
  }
  return null;
};

const scaleElement = (
  shapes: CorpusShape[],
  random: () => number
): CorpusShape[] | null => {
  for (const i of shuffledIndices(shapes.length, random)) {
    const sps = subpathsOf(shapes[i]);
    const [cx, cy] = centre(sps);
    const bigger = sps.map((sp) => scale(sp, SCALE_FACTOR, cx, cy));
    // Refused rather than clipped: an element scaled off the canvas is measuring
    // the viewBox as much as the metric.
    if (onCanvas(visualBox(bigger, shapes[i].strokeWidth))) {
      return replaceShape(shapes, i, [withSubpaths(shapes[i], bigger)]);
    }
  }
  return null;
};

/** Move one element into the diagonally opposite quadrant — the largest move
 *  that still lands the element on the canvas. */
const moveElement = (
  shapes: CorpusShape[],
  random: () => number
): CorpusShape[] | null => {
  if (shapes.length < 2) {
    return null;
  }
  const half = SPEC.canvas / 2;
  for (const i of shuffledIndices(shapes.length, random)) {
    const sps = subpathsOf(shapes[i]);
    const b = visualBox(sps, shapes[i].strokeWidth);
    const [cx, cy] = centre(sps);
    const target = (c: number, extent: number): number => {
      const to = c < half ? SPEC.canvas * 0.75 : SPEC.canvas * 0.25;
      return Math.min(Math.max(to, extent / 2), SPEC.canvas - extent / 2);
    };
    const dx = target(cx, b.w) - cx;
    const dy = target(cy, b.h) - cy;
    if (Math.hypot(dx, dy) >= 1) {
      return replaceShape(shapes, i, [
        withSubpaths(
          shapes[i],
          sps.map((sp) => translate(sp, dx, dy))
        ),
      ]);
    }
  }
  return null;
};

/** Redraw one dot two tiers larger, in the construction it was drawn in: a
 *  cap-form dot by widening its stroke, a ring by growing its radius. The
 *  element is split out first so only the dot changes size. */
const growDot = (
  shapes: CorpusShape[],
  random: () => number
): CorpusShape[] | null => {
  for (const i of shuffledIndices(shapes.length, random)) {
    const sps = subpathsOf(shapes[i]);
    for (const j of shuffledIndices(sps.length, random)) {
      const diameter = dotDiameter(sps[j], shapes[i].strokeWidth);
      const target = diameter === null ? null : tierAbove(diameter);
      if (target === null || diameter === null) {
        continue;
      }
      const rest = sps.filter((_, k) => k !== j);
      const b = bbox([sps[j]]);
      const ext = Math.max(b.w, b.h);
      const dot =
        ext < ROUND
          ? { ...shapes[i], d: serialise([sps[j]]), strokeWidth: target }
          : withSubpaths(shapes[i], [
              scale(
                sps[j],
                (target - shapes[i].strokeWidth) / ext,
                ...centre([sps[j]])
              ),
            ]);
      return replaceShape(
        shapes,
        i,
        rest.length > 0 ? [withSubpaths(shapes[i], rest), dot] : [dot]
      );
    }
  }
  return null;
};

const PERTURBATIONS: Perturbation[] = [
  {
    apply: translateIcon,
    family: "preserving",
    name: "translate-1",
    what: "the whole icon moved 1 unit sideways",
  },
  {
    apply: jitterIcon,
    family: "preserving",
    name: "jitter-0.25",
    what: "every node moved by the grid tolerance",
  },
  {
    apply: reverseOrder,
    family: "preserving",
    name: "reverse-draw-order",
    what: "subpaths and elements emitted back to front",
  },
  {
    apply: reverseOne,
    family: "preserving",
    name: "reverse-one-subpath",
    what: "one subpath drawn in the opposite direction",
  },
  {
    apply: splitElement,
    family: "preserving",
    name: "split-element",
    what: "one element split into two covering the same ink",
  },
  {
    apply: deleteElement,
    family: "breaking",
    name: "delete-element",
    what: "one element removed",
  },
  {
    apply: mirrorElement,
    family: "breaking",
    name: "mirror-element",
    what: "one element mirrored where it stands",
  },
  {
    apply: scaleElement,
    family: "breaking",
    name: "scale-element-1.5",
    what: "one element 1.5x its size",
  },
  {
    apply: moveElement,
    family: "breaking",
    name: "move-element",
    what: "one element moved to the opposite quadrant",
  },
  {
    apply: growDot,
    family: "breaking",
    name: "dot-two-tiers",
    what: "one dot redrawn two tiers larger",
  },
];

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

const percentile = (xs: readonly number[], p: number): number => {
  if (xs.length === 0) {
    return 0;
  }
  const s = xs.toSorted((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};

interface Spread {
  max: number;
  median: number;
  min: number;
  n: number;
  p25: number;
  p75: number;
}

const spread = (xs: readonly number[]): Spread => ({
  max: xs.length > 0 ? Math.max(...xs) : 0,
  median: median(xs),
  min: xs.length > 0 ? Math.min(...xs) : 0,
  n: xs.length,
  p25: percentile(xs, 0.25),
  p75: percentile(xs, 0.75),
});

/**
 * The threshold that best splits the two families, and what it costs.
 *
 * AUC says whether *some* threshold orders the families; this says which one
 * and how badly it misfires, which is the form the question takes when someone
 * asks whether a 0.02 drop in a `reach` number means anything.
 */
const bestThreshold = (
  preserving: readonly number[],
  breaking: readonly number[]
): { falseAlarm: number; missed: number; value: number; youden: number } => {
  let best = { falseAlarm: 1, missed: 1, value: 0, youden: -1 };
  for (const t of [...preserving, ...breaking].toSorted((a, b) => a - b)) {
    const falseAlarm =
      preserving.filter((x) => x < t).length / preserving.length;
    const missed = breaking.filter((x) => x >= t).length / breaking.length;
    const youden = 1 - falseAlarm - missed;
    if (youden > best.youden) {
      best = { falseAlarm, missed, value: t, youden };
    }
  }
  return best;
};

/** How far the two distributions reach into each other. AUC is the pairwise
 *  version of this; the counts are the readable one. */
const overlap = (
  preserving: readonly number[],
  breaking: readonly number[]
): {
  breakingAbovePreservingMin: number;
  preservingBelowBreakingMax: number;
} => {
  const lo = Math.min(...preserving);
  const hi = Math.max(...breaking);
  return {
    breakingAbovePreservingMin: breaking.filter((x) => x >= lo).length,
    preservingBelowBreakingMax: preserving.filter((x) => x <= hi).length,
  };
};

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

interface Measured {
  cosine: number;
  perturbation: string;
  symbol: string;
}

/** Only stroked icons. A filled icon carries its holes in one element under
 *  `fill-rule="evenodd"`, so splitting that element fills the holes in — the
 *  "same ink" perturbation would stop preserving the ink, and the family would
 *  be measuring this script's mistake. */
const stroked = (icon: CorpusIcon): boolean =>
  icon.shapes.length > 0 &&
  icon.shapes.every((s) => !s.filled && s.strokeWidth > 0);

/** The main sample also needs a second element, since deleting, mirroring or
 *  moving *the* element of a one-element icon is not the perturbation the
 *  family is named for. The dot pass does not: it resizes a mark inside an
 *  element and leaves the rest of the icon alone. */
const usable = (icon: CorpusIcon): boolean =>
  stroked(icon) && icon.shapes.length >= 2;

const measureIcon = async (
  icon: CorpusIcon,
  only?: (p: Perturbation) => boolean
): Promise<{ refused: string[]; scores: Measured[] }> => {
  const reference = await inkVector(toSvg(icon.shapes));
  const scores: Measured[] = [];
  const refused: string[] = [];
  for (const p of PERTURBATIONS) {
    if (only && !only(p)) {
      continue;
    }
    const next = p.apply(icon.shapes, rng(hash(`${icon.symbol}/${p.name}`)));
    if (!next || next.length === 0) {
      refused.push(p.name);
      continue;
    }
    // One raster at a time: a run is a few thousand renders and nothing here
    // needs them all in memory at once.
    // oxlint-disable-next-line no-await-in-loop
    const ink = await inkVector(toSvg(next));
    scores.push({
      cosine: cosine(reference, ink),
      perturbation: p.name,
      symbol: icon.symbol,
    });
  }
  return { refused, scores };
};

interface Report {
  builtAt: string;
  families: Record<Family, Spread>;
  inversions: string[];
  /** Every observation, so the run can be re-analysed without re-running it —
   *  the question "what is the AUC without X" is the first one anyone asks. */
  observations: Measured[];
  overlap: ReturnType<typeof overlap>;
  perturbations: {
    auc: number;
    family: Family;
    name: string;
    refused: number;
    spread: Spread;
    what: string;
  }[];
  procedure: string;
  reference: { unrelatedIcons: Spread };
  sample: { icons: number; seed: number; variant: string };
  separation: ReturnType<typeof separation>;
  separationWithoutFalseAlarms: ReturnType<typeof separation>;
  threshold: ReturnType<typeof bestThreshold>;
  verdict: string;
}

const DOT = "dot-two-tiers";
const dotOnly = (p: Perturbation): boolean => p.name === DOT;
const notDot = (p: Perturbation): boolean => !dotOnly(p);

const PROCEDURE =
  "Each sampled icon is re-emitted from its parsed shapes, then perturbed ten ways and re-rendered through `tools/render.ts` unchanged (SIZE 48, BLUR 1.6, density 200). Five perturbations preserve the depiction — translation by 1 unit, node jitter within the 0.25 grid tolerance, reversed subpath and element order, one subpath reversed in direction, one element split in two over the same ink. Five break it — one element deleted, mirrored in place, scaled 1.5x, moved to the opposite quadrant, and one dot redrawn two tiers up the SPEC.dots ladder. Sample: stroked icons of the house variant with two or more elements, seeded shuffle. A perturbation with nothing to act on refuses rather than degrading (a mirror-symmetric element is refused for the mirror, since flipping it changes no drawing). Headline = AUC over the pooled families through `eval/separation.ts`, the same instrument that discarded the style column at 0.476. The `dot-two-tiers` sample is drawn from the icons that own an eligible dot rather than from the main sample, which is why its n differs.";

/** A perturbation the metric cannot see, or one it sees when it should not.
 *  Both are read off the same number: a perturbation's own AUC against the
 *  pooled opposite family, against the same 0.65 bar the panel already uses to
 *  discard a column. Under the bar, this one change is invisible to the metric
 *  — or, on the preserving side, is scored as if the drawing had changed. */
const underBar = (
  perturbations: readonly { auc: number; family: Family; name: string }[],
  family: Family
): string[] =>
  perturbations
    .filter((p) => p.family === family && p.auc < SEPARATION_THRESHOLD)
    .map((p) => p.name);

/** Pairs where a change that kept the drawing scored *lower* than one that
 *  destroyed it. One of these is worth more than the headline: it says the
 *  ordering the metric imposes is not the ordering of the thing it measures. */
const inversions = (
  perturbations: readonly { family: Family; name: string; spread: Spread }[]
): string[] => {
  const out: string[] = [];
  for (const kept of perturbations.filter((p) => p.family === "preserving")) {
    for (const broke of perturbations.filter((p) => p.family === "breaking")) {
      if (kept.spread.median < broke.spread.median) {
        out.push(
          `${kept.name} (${kept.spread.median.toFixed(3)}) < ${broke.name} (${broke.spread.median.toFixed(3)})`
        );
      }
    }
  }
  return out;
};

const headline = (value: number): string => {
  if (value >= 0.95) {
    return `Rendered cosine separates a preserved drawing from a broken one at AUC ${value.toFixed(3)}: it is measuring depiction, not formatting.`;
  }
  if (value >= SEPARATION_THRESHOLD) {
    return `Rendered cosine separates the families at AUC ${value.toFixed(3)} — above the ${SEPARATION_THRESHOLD} bar, but a single pair is not decidable from the score alone.`;
  }
  return `Rendered cosine FAILS the stress test at AUC ${value.toFixed(3)}: it moves as much for a change that keeps the drawing as for one that destroys it, so every reach computed from it is a proxy.`;
};

const verdictOf = (
  value: number,
  blind: string[],
  falseAlarms: string[],
  inverted: string[]
): string => {
  const parts: string[] = [];
  if (inverted.length > 0) {
    parts.push(
      `INVERTED: ${inverted.join("; ")}. A change that kept the picture moved the metric further than one that destroyed it, so the ordering it imposes is not the ordering of depiction.`
    );
  }
  parts.push(headline(value));
  if (blind.length > 0) {
    parts.push(
      `Blind to (own AUC below ${SEPARATION_THRESHOLD}): ${blind.join(", ")} — these break the drawing and the metric cannot tell.`
    );
  }
  if (falseAlarms.length > 0) {
    parts.push(
      `Scored as damage though nothing was redrawn: ${falseAlarms.join(", ")}.`
    );
  }
  return parts.join(" ");
};

const run = async (args: {
  corpus: string;
  n: number;
  seed: number;
}): Promise<Report> => {
  const corpus = await loadCorpus(args.corpus);
  const order = shuffledIndices(corpus.symbols.length, rng(args.seed));
  const scores: Measured[] = [];
  const refusals = new Map<string, number>();
  const record = (r: { refused: string[]; scores: Measured[] }) => {
    scores.push(...r.scores);
    for (const name of r.refused) {
      refusals.set(name, (refusals.get(name) ?? 0) + 1);
    }
  };

  const sampled: CorpusIcon[] = [];
  for (const i of order) {
    if (sampled.length >= args.n) {
      break;
    }
    // The sample is taken in shuffled order and stops at `n`, so the reads
    // cannot be batched ahead.
    // oxlint-disable-next-line no-await-in-loop
    const icon = await corpus.load(corpus.symbols[i], HOUSE_VARIANT);
    if (!usable(icon)) {
      continue;
    }
    sampled.push(icon);
    // oxlint-disable-next-line no-await-in-loop -- see above
    record(await measureIcon(icon, notDot));
  }

  // The dot ladder only has room above the two smallest tiers, so eligible dots
  // are rare enough that a blind sample would land two or three of them. This
  // one is drawn from the icons that have one — the same corpus, a different
  // denominator, said out loud in the procedure and in the printed n.
  for (const i of order) {
    // oxlint-disable-next-line no-await-in-loop -- one icon at a time, as above
    const icon = await corpus.load(corpus.symbols[i], HOUSE_VARIANT);
    const seeded = rng(hash(`${icon.symbol}/${DOT}`));
    if (!stroked(icon) || !growDot(icon.shapes, seeded)) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- see above
    record(await measureIcon(icon, dotOnly));
  }

  const by = (name: string) =>
    scores.filter((s) => s.perturbation === name).map((s) => s.cosine);
  const familyScores = (family: Family) =>
    scores
      .filter(
        (s) =>
          PERTURBATIONS.find((p) => p.name === s.perturbation)?.family ===
          family
      )
      .map((s) => s.cosine);
  const preserving = familyScores("preserving");
  const breaking = familyScores("breaking");

  const perturbations = PERTURBATIONS.map((p) => {
    const own = by(p.name);
    const other = p.family === "preserving" ? breaking : preserving;
    return {
      auc: p.family === "preserving" ? auc(own, other) : auc(other, own),
      family: p.family,
      name: p.name,
      refused: refusals.get(p.name) ?? 0,
      spread: spread(own),
      what: p.what,
    };
  });

  const unrelated: number[] = [];
  for (let i = 0; i + 1 < sampled.length; i += 2) {
    // oxlint-disable-next-line no-await-in-loop -- two rasters at a time
    const [a, b] = await Promise.all([
      inkVector(toSvg(sampled[i].shapes)),
      inkVector(toSvg(sampled[i + 1].shapes)),
    ]);
    unrelated.push(cosine(a, b));
  }

  const sep = separation("rendered-cosine", preserving, breaking);
  const inverted = inversions(perturbations);
  // The same headline with the false-alarm perturbations taken out. It answers
  // the question the headline provokes — how much of the failure is *this* one
  // change — without anybody having to re-run the script to find out.
  const alarms = new Set(underBar(perturbations, "preserving"));
  const withoutAlarms = separation(
    `rendered-cosine, minus ${[...alarms].join(", ") || "nothing"}`,
    scores
      .filter(
        (x) =>
          !alarms.has(x.perturbation) &&
          PERTURBATIONS.find((p) => p.name === x.perturbation)?.family ===
            "preserving"
      )
      .map((x) => x.cosine),
    breaking
  );

  return {
    builtAt: new Date().toISOString(),
    families: { breaking: spread(breaking), preserving: spread(preserving) },
    inversions: inverted,
    observations: scores,
    overlap: overlap(preserving, breaking),
    perturbations,
    procedure: PROCEDURE,
    reference: { unrelatedIcons: spread(unrelated) },
    sample: { icons: sampled.length, seed: args.seed, variant: HOUSE_VARIANT },
    separation: sep,
    separationWithoutFalseAlarms: withoutAlarms,
    threshold: bestThreshold(preserving, breaking),
    verdict: verdictOf(
      sep.auc,
      underBar(perturbations, "breaking"),
      underBar(perturbations, "preserving"),
      inverted
    ),
  };
};

const f = (n: number): string => n.toFixed(3);

const print = (report: Report): void => {
  const lines: string[] = [
    `rendered-cosine stress test — ${report.sample.icons} icons of ${report.sample.variant}, seed ${report.sample.seed}`,
    "",
    "perturbation          family      n   median    p25    p75    min    AUC  refused",
  ];
  for (const p of report.perturbations) {
    lines.push(
      [
        p.name.padEnd(21),
        p.family.padEnd(11),
        String(p.spread.n).padStart(3),
        f(p.spread.median).padStart(8),
        f(p.spread.p25).padStart(7),
        f(p.spread.p75).padStart(6),
        f(p.spread.min).padStart(7),
        f(p.auc).padStart(7),
        String(p.refused).padStart(8),
      ].join(" ")
    );
  }
  const { breaking, preserving } = report.families;
  lines.push(
    "",
    `preserving  n=${preserving.n}  median ${f(preserving.median)}  IQR ${f(preserving.p25)}-${f(preserving.p75)}  min ${f(preserving.min)}`,
    `breaking    n=${breaking.n}  median ${f(breaking.median)}  IQR ${f(breaking.p25)}-${f(breaking.p75)}  max ${f(breaking.max)}`,
    `unrelated icons (context, not scored): median ${f(report.reference.unrelatedIcons.median)} over ${report.reference.unrelatedIcons.n} pairs`,
    "",
    `overlap: ${report.overlap.breakingAbovePreservingMin} of ${breaking.n} broken icons score above the worst preserved one; ${report.overlap.preservingBelowBreakingMax} of ${preserving.n} preserved icons score below the best broken one`,
    `best threshold ${f(report.threshold.value)}: ${(report.threshold.falseAlarm * 100).toFixed(1)}% of preserved drawings fall below it, ${(report.threshold.missed * 100).toFixed(1)}% of broken ones sit above it`,
    "",
    report.separation.verdict,
    report.separationWithoutFalseAlarms.verdict,
    report.verdict
  );
  process.stdout.write(`${lines.join("\n")}\n`);
};

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      corpus: { default: "corpus", type: "string" },
      n: { default: "150", type: "string" },
      output: { default: "text", type: "string" },
      seed: { default: "1", type: "string" },
    },
  });
  const report = await run({
    corpus: values.corpus,
    n: Number(values.n),
    seed: Number(values.seed),
  });
  if (values.output === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    print(report);
  }
};

if (process.argv[1]?.endsWith("stress-cosine.ts")) {
  await main();
}

export {
  bestThreshold,
  deleteElement,
  growDot,
  jitterIcon,
  mirrorElement,
  moveElement,
  overlap,
  percentile,
  PERTURBATIONS,
  reverseOne,
  reverseOrder,
  reverseSubpath,
  run,
  scaleElement,
  splitElement,
  spread,
  toSvg,
  translateIcon,
};

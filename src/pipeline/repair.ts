/**
 * The mechanical fix path: corrections that need no design judgement.
 *
 * The bar for landing here is not "we measured a defect". It is "the correction
 * is forced" — there is exactly one thing the value could have been meant to
 * be, and the drawing does not change when it is applied. Everything else is a
 * redraw wearing a cleanup's clothes, and goes to the review pile instead.
 *
 * Two rules follow from that, and both cost coverage on purpose:
 *
 *   - **A stroke of 1.995 is residue; a stroke of 1.8 is a decision.** Snapping
 *     the first to 2 restores what was intended. Snapping the second is someone
 *     deciding, six months later and without looking, that a designer was
 *     wrong. Only near-2 residue is snapped; deliberate off-tier widths are
 *     denoised to a clean value at most, and anything else is left alone.
 *   - **A contour of exactly zero area is residue; a sliver 1.8px across is a
 *     sparkle.** Both measure as "near zero area" and only the first can be
 *     deleted without changing the picture.
 *
 * Every correction is proved inert by rendering before and after and comparing.
 * A fix that moves the render is reclassified as a redraw and reported as a
 * failure of the fix, not as a cost of it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Corpus, CorpusIcon, CorpusShape } from "../corpus/load.js";
import { bbox, parsePath } from "../geometry/path.js";
import { flatten } from "../parts/shape.js";
import { similarity } from "../tools/render.js";
import type { Subpath } from "../types.js";

/**
 * The house stroke of the *variant being repaired*, not a constant.
 *
 * Hardcoding 2 was wrong and loudly so: in the stroke-1 variants it flagged
 * every correctly drawn shape as a deliberate departure, turning a 70-item
 * review pile into an 1,840-item one. What counts as residue is relative to
 * what the variant is drawn at.
 */
const houseStroke = (icon: CorpusIcon): number => icon.variant.stroke;
/**
 * Distance from the house stroke within which a width is float residue rather
 * than a decision. Set from the corpus: the residue clusters at 1.995 and
 * 2.0556, while the nearest deliberate widths are 1.9 and 2.2. Anything wider
 * than this window would start snapping 1.9 to 2, which is a redraw.
 */
const RESIDUE_WINDOW = 0.06;
/** Grid deliberate stroke widths sit on. 1.90004 is 1.9 with float noise. */
const WIDTH_GRID = 0.05;
/** How far from a clean grid value a width can sit and still be noise. */
const DENOISE_WINDOW = 0.02;
/**
 * Enclosed area below which a contour is a *candidate* spur.
 *
 * Deliberately the same 0.01 `corpus/audit.ts` audits at, so this module and
 * the audit agree on what they are talking about. It is a looser bar than
 * "removable", and on purpose: 0.01 catches `bag-2-sparkle`'s 1.3e-3 sliver,
 * which spans 1.8px and genuinely renders. Candidacy is a detection question;
 * removability is settled downstream by rendering the icon with and without
 * the contour and refusing to drop anything that moves the picture.
 */
const SPUR_AREA = 0.01;
/** Below this a contour has no extent worth measuring at all. */
const DEGENERATE_EXTENT = 0.05;
/** Below this two renders are the same picture. */
export const INERT = 0.9995;

export type FixKind = "denoise-stroke" | "remove-spur" | "snap-stroke";

export interface Fix {
  /** What it became. */
  after: string;
  /** What it was. */
  before: string;
  kind: FixKind;
  /** Why this one was safe to make automatically. */
  reason: string;
  /** Index of the shape in the icon. */
  shape: number;
}

export interface Review {
  /** What a human has to decide. */
  question: string;
  shape: number;
  value: string;
}

/** Signed area of a closed polygon, by the shoelace formula. */
const area = (points: [number, number][]): number => {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
};

const span = (sp: Subpath): number => {
  const b = bbox([sp]);
  return Math.max(b.w, b.h);
};

/**
 * A contour that encloses nothing and spans nothing.
 *
 * Both halves are needed. `arrow-left-right` carries a closed contour with
 * exactly zero area and 2.3px of span — an out-and-back line, invisible and
 * removable. `bag-2-sparkle` carries one with 1.3e-3 of area and 1.8px of span
 * — a real sliver that renders. Testing area alone deletes the second.
 */
/**
 * A contour that might be residue, on the audit's definition.
 *
 * `closed || filled` rather than `filled` alone: a closed contour inside a
 * *stroked* shape is just as dead, and gating on the shape's fill missed the
 * eleven stroked-only icons the corpus audit found. An *open* stroked subpath
 * is excluded because it encloses nothing by construction — including those
 * would flag every straight line in the set, which was this module's first bug.
 */
export const isSpurCandidate = (sp: Subpath, filled: boolean): boolean =>
  (sp.closed || filled) &&
  area(flatten(sp, 8)) < SPUR_AREA &&
  span(sp) > DEGENERATE_EXTENT;

/** Round onto a grid without reintroducing the float dust being removed:
 *  `Math.round(1.90004 / 0.05) * 0.05` is 1.9000000000000001. */
const round = (v: number, grid: number): number =>
  Number((Math.round(v / grid) * grid).toFixed(4));

export interface StrokeVerdict {
  kind: "denoise" | "keep" | "review" | "snap";
  reason: string;
  width: number;
}

/**
 * What to do about one shape's stroke width.
 *
 * The three-way split is the whole design of this module. `snap` is a value
 * that can only have meant 2. `denoise` is a value that meant something else,
 * cleaned of float dust but left at what it meant. `review` is a value that
 * neither explains, handed to a person.
 */
export const classifyStroke = (width: number, house = 2): StrokeVerdict => {
  if (width === 0) {
    return { kind: "keep", reason: "filled shape, no stroke", width };
  }
  if (width === house) {
    return { kind: "keep", reason: "already the house stroke", width };
  }
  const off = Math.abs(width - house);
  if (off <= RESIDUE_WINDOW) {
    return {
      kind: "snap",
      reason: `${width} is within ${RESIDUE_WINDOW} of the variant's ${house} stroke: transform residue, not a thinner line`,
      width: house,
    };
  }
  const clean = round(width, WIDTH_GRID);
  if (
    Math.abs(width - clean) > 1e-9 &&
    Math.abs(width - clean) <= DENOISE_WINDOW
  ) {
    return {
      kind: "denoise",
      reason: `${width} is ${clean} carrying float dust; the drawing keeps its own weight`,
      width: clean,
    };
  }
  return {
    kind: "review",
    reason: `${width} is a deliberate departure from the variant's ${house} stroke; snapping it would be a redraw`,
    width,
  };
};

export interface RepairResult {
  fixes: Fix[];
  icon: string;
  review: Review[];
  shapes: CorpusShape[];
  svg: string;
}

/** Rebuild an icon's markup from its shapes. */
export const toSVG = (shapes: CorpusShape[]): string => {
  const body = shapes
    .map((s) =>
      s.strokeWidth === 0
        ? `<path d="${s.d}" fill="currentColor"/>`
        : `<path d="${s.d}" stroke="currentColor" stroke-width="${s.strokeWidth}" stroke-linecap="${s.cap}" stroke-linejoin="round" fill="none"/>`
    )
    .join("");
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
};

/**
 * Rebuild `d` keeping only the wanted contours.
 *
 * The original text of each contour is reused rather than re-emitted, so a
 * removal cannot perturb the coordinates of anything it kept — the whole claim
 * of this fix is that nothing else moved.
 */
const serialiseKept = (d: string, all: Subpath[], kept: Subpath[]): string => {
  const chunks = d.split(/(?=[Mm])/u).filter((c) => c.trim().length > 0);
  if (chunks.length !== all.length) {
    // Parse and text disagree on contour count; refuse rather than guess.
    return d;
  }
  const keepIndex = new Set(all.map((sp, i) => (kept.includes(sp) ? i : -1)));
  return chunks.filter((_, i) => keepIndex.has(i)).join("");
};

/** Serialise subpaths back to path data via the shared writer. */
const drop = (d: string, remove: (sp: Subpath) => boolean): string | null => {
  const subpaths = parsePath(d);
  const kept = subpaths.filter((sp) => !remove(sp));
  if (kept.length === subpaths.length) {
    return null;
  }
  // Path data is rebuilt only by removing whole contours from the original
  // string's parse; no geometry is authored here.
  return kept.length === 0 ? "" : serialiseKept(d, subpaths, kept);
};

export const repairIcon = (icon: CorpusIcon): RepairResult => {
  const fixes: Fix[] = [];
  const review: Review[] = [];
  const shapes: CorpusShape[] = [];

  for (const [i, shape] of icon.shapes.entries()) {
    let { d, strokeWidth } = shape;

    const verdict = classifyStroke(strokeWidth, houseStroke(icon));
    if (verdict.kind === "snap" || verdict.kind === "denoise") {
      fixes.push({
        after: String(verdict.width),
        before: String(strokeWidth),
        kind: verdict.kind === "snap" ? "snap-stroke" : "denoise-stroke",
        reason: verdict.reason,
        shape: i,
      });
      strokeWidth = verdict.width;
    } else if (verdict.kind === "review") {
      review.push({
        question: verdict.reason,
        shape: i,
        value: `stroke-width ${strokeWidth}`,
      });
    }

    // Spurs are only meaningful inside a filled contour: in a stroked drawing
    // an open path legitimately encloses no area, and every straight line in
    // the set would match.
    if (shape.filled) {
      const stripped = drop(d, (sp) => isSpur(sp));
      if (stripped !== null && stripped !== "") {
        fixes.push({
          after: `${parsePath(stripped).length} contours`,
          before: `${parsePath(d).length} contours`,
          kind: "remove-spur",
          reason:
            "closed contour enclosing no area and spanning none: geometry residue with nothing to render",
          shape: i,
        });
        d = stripped;
      }
    }

    shapes.push({ ...shape, d, strokeWidth });
  }

  return { fixes, icon: icon.symbol, review, shapes, svg: toSVG(shapes) };
};

export interface Verified extends RepairResult {
  /** Rendered similarity of before against after. */
  score: number;
  /** The render did not move: the fix is mechanical as claimed. */
  inert: boolean;
}

/**
 * Apply the fixes and prove they changed nothing visible.
 *
 * The proof is the point. Without it this module is a set of plausible
 * assertions about SVG semantics; with it, each one is checked against a
 * renderer on the actual icon.
 */
export const verifyIcon = async (icon: CorpusIcon): Promise<Verified> => {
  const result = repairIcon(icon);
  if (result.fixes.length === 0) {
    return { ...result, inert: true, score: 1 };
  }
  const score = await similarity(toSVG(icon.shapes), result.svg);
  return { ...result, inert: score >= INERT, score };
};

export interface RepairOptions {
  corpus: Corpus;
  /** Staging directory. Never `corpus/`, never the shipped package. */
  out?: string;
  /** Measure and report without writing anything. */
  dryRun?: boolean;
  symbols?: string[];
  variant?: string;
}

export interface RepairReport {
  /** Icons whose render moved: the fix was not mechanical after all. */
  failed: Verified[];
  /** Icons corrected and proved inert. */
  fixed: Verified[];
  fixCounts: Record<FixKind, number>;
  out: string | null;
  /** Icons with something a person has to decide. */
  review: Verified[];
  scanned: number;
  variant: string;
}

const HOUSE_VARIANT = "round-outlined-radius-3-stroke-2";

export const repairSet = async (
  options: RepairOptions
): Promise<RepairReport> => {
  const {
    corpus,
    dryRun = false,
    out = null,
    variant = HOUSE_VARIANT,
  } = options;
  if (out && (out.includes("corpus") || out.includes("blode-icons"))) {
    throw new Error(
      `Refusing to write to "${out}": corrected icons go to a staging directory, never over the corpus or the shipped package.`
    );
  }

  const symbols = (options.symbols ?? corpus.symbols).filter((s) =>
    corpus.has(s, variant)
  );
  const loaded = await Promise.all(
    symbols.map(async (s) => await corpus.load(s, variant))
  );
  const verified = await Promise.all(loaded.map((i) => verifyIcon(i)));

  const changed = verified.filter((v) => v.fixes.length > 0);
  const fixed = changed.filter((v) => v.inert);
  const failed = changed.filter((v) => !v.inert);
  const review = verified.filter((v) => v.review.length > 0);

  const fixCounts: Record<FixKind, number> = {
    "denoise-stroke": 0,
    "remove-spur": 0,
    "snap-stroke": 0,
  };
  for (const v of fixed) {
    for (const f of v.fixes) {
      fixCounts[f.kind] += 1;
    }
  }

  if (out && !dryRun) {
    await mkdir(out, { recursive: true });
    await Promise.all(
      fixed.map((v) => writeFile(path.join(out, `${v.icon}.svg`), `${v.svg}\n`))
    );
    await writeFile(
      path.join(out, "repairs.json"),
      `${JSON.stringify(
        {
          failed: failed.map((v) => ({ icon: v.icon, score: v.score })),
          fixed: fixed.map((v) => ({
            fixes: v.fixes,
            icon: v.icon,
            score: v.score,
          })),
          review: review.map((v) => ({ icon: v.icon, review: v.review })),
          variant,
        },
        null,
        2
      )}\n`
    );
  }

  return {
    failed,
    fixCounts,
    fixed,
    out: dryRun ? null : out,
    review,
    scanned: symbols.length,
    variant,
  };
};

export const formatRepairReport = (r: RepairReport): string => {
  const lines = [
    `mechanical repair — ${r.scanned} icons in ${r.variant}`,
    "",
    `  snap-stroke     ${String(r.fixCounts["snap-stroke"]).padStart(4)}  float residue restored to the house stroke`,
    `  denoise-stroke  ${String(r.fixCounts["denoise-stroke"]).padStart(4)}  deliberate width cleaned of float dust, weight kept`,
    `  remove-spur     ${String(r.fixCounts["remove-spur"]).padStart(4)}  contour enclosing and spanning nothing`,
    "",
    `  ${r.fixed.length} icon(s) corrected and proved visually inert (similarity >= ${INERT})`,
    `  ${r.review.length} icon(s) left for review`,
  ];
  if (r.failed.length > 0) {
    lines.push(
      "",
      `  ${r.failed.length} FIX(ES) MOVED THE RENDER and were withheld:`,
      ...r.failed.map((v) => `    ${v.icon}  similarity ${v.score.toFixed(5)}`)
    );
  }
  if (r.out) {
    lines.push("", `  written to ${r.out}`);
  }
  return lines.join("\n");
};

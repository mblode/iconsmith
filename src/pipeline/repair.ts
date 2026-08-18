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
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
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
/** Largest end-to-end gap that reads as a failure to close rather than a
 *  deliberate break. Every intentional break in the set is a full stroke or
 *  wider; the one accidental gap is 0.003. */
const NEAR_CLOSED_GAP = 0.05;
/** Shapes smaller than this have no meaningful open/closed distinction. */
const MIN_SHAPE_EXTENT = 1;
/** Below this two renders are the same picture. */
export const INERT = 0.9995;

export type FixKind =
  | "close-gap"
  | "denoise-stroke"
  | "remove-spur"
  | "snap-stroke"
  | "unify-caps";

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

/** A correction that can be applied on its own, so it can be proved on its own. */
export interface Proposal {
  apply: (shapes: CorpusShape[]) => CorpusShape[];
  /** Contour index for removals, so they can be applied back-to-front. */
  contour: number;
  fix: Fix;
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
 * Remove one contour from path data by index.
 *
 * The original text of every surviving contour is reused rather than
 * re-emitted, so a removal cannot perturb the coordinates of anything it kept
 * — which is the entire claim being made about this fix.
 */
/** Close one contour by appending `Z`, leaving every coordinate untouched. */
export const closeContour = (d: string, index: number): string => {
  const chunks = d.split(/(?=[Mm])/u).filter((c) => c.trim().length > 0);
  if (chunks.length !== parsePath(d).length || index >= chunks.length) {
    return d;
  }
  return chunks
    .map((c, i) => (i === index && !/[Zz]\s*$/u.test(c.trim()) ? `${c}Z` : c))
    .join("");
};

export const dropContour = (d: string, index: number): string => {
  const chunks = d.split(/(?=[Mm])/u).filter((c) => c.trim().length > 0);
  if (chunks.length !== parsePath(d).length || index >= chunks.length) {
    // Text and parse disagree about where contours begin; refuse rather than
    // cut the string in the wrong place.
    return d;
  }
  return chunks.filter((_, i) => i !== index).join("");
};

/**
 * Every correction this icon is a candidate for, each applicable on its own.
 *
 * Proposing independently applicable fixes rather than one rewritten icon is
 * what lets the proof be per-fix. An icon with three dead contours and one
 * visible sliver should lose the three, not have all four rejected because the
 * bundle moved the render.
 */
export const proposeFixes = (icon: CorpusIcon): Proposal[] => {
  const proposals: Proposal[] = [];
  const house = houseStroke(icon);

  for (const [i, shape] of icon.shapes.entries()) {
    const verdict = classifyStroke(shape.strokeWidth, house);
    if (verdict.kind === "snap" || verdict.kind === "denoise") {
      proposals.push({
        apply: (shapes) =>
          shapes.map((s, j) =>
            j === i ? { ...s, strokeWidth: verdict.width } : s
          ),
        contour: -1,
        fix: {
          after: String(verdict.width),
          before: String(shape.strokeWidth),
          kind: verdict.kind === "snap" ? "snap-stroke" : "denoise-stroke",
          reason: verdict.reason,
          shape: i,
        },
      });
    }

    for (const [c, sp] of parsePath(shape.d).entries()) {
      if (!isSpurCandidate(sp, shape.filled)) {
        continue;
      }
      proposals.push({
        apply: (shapes) =>
          shapes.map((s, j) =>
            j === i ? { ...s, d: dropContour(s.d, c) } : s
          ),
        contour: c,
        fix: {
          after: "removed",
          before: `contour ${c}, area ${area(flatten(sp, 8)).toExponential(1)}`,
          kind: "remove-spur",
          reason:
            "contour enclosing no area: residue of a stroke the design tool outlined",
          shape: i,
        },
      });
    }
  }

  // An open subpath whose ends all but meet. Every other open subpath in the
  // set has a gap of a full stroke or more — a deliberate break — so a gap of a
  // few thousandths is a path that failed to close. Exactly one icon in the
  // corpus qualifies, which is what a rule this narrow should yield.
  for (const [i, shape] of icon.shapes.entries()) {
    for (const [c, sp] of parsePath(shape.d).entries()) {
      if (sp.closed) {
        continue;
      }
      const ends = flatten(sp, 8);
      const [head] = ends;
      const tail = ends.at(-1);
      if (!(head && tail)) {
        continue;
      }
      const gap = Math.hypot(head[0] - tail[0], head[1] - tail[1]);
      if (gap > 0 && gap <= NEAR_CLOSED_GAP && span(sp) >= MIN_SHAPE_EXTENT) {
        proposals.push({
          apply: (shapes) =>
            shapes.map((sh, j) =>
              j === i ? { ...sh, d: closeContour(sh.d, c) } : sh
            ),
          contour: -1,
          fix: {
            after: "closed",
            before: `gap ${gap.toFixed(4)}`,
            kind: "close-gap",
            reason: `open subpath whose ends are ${gap.toFixed(4)} apart on a ${span(sp).toFixed(1)}-unit shape: a path that failed to close, not a deliberate break`,
            shape: i,
          },
        });
      }
    }
  }

  // Caps are an icon-level decision, not a shape-level one: the defect is
  // disagreement *within* one drawing, so it cannot be seen one shape at a time.
  // Only caps that actually show. A closed subpath has no ends, so its linecap
  // attribute is inert; counting it reports a default rather than a drawing
  // decision, and inflates "mixed caps" from 49 icons to 266.
  const capped = icon.shapes
    .map((sh, i) => ({
      cap: sh.cap,
      i,
      visible:
        sh.strokeWidth > 0 &&
        parsePath(sh.d).some(
          (sp) => !sp.closed && span(sp) > DEGENERATE_EXTENT
        ),
    }))
    .filter((sh) => sh.visible);
  const caps = new Set(capped.map((c) => c.cap));
  if (caps.size > 1 && caps.has("round")) {
    // Only when round is present. An icon drawn entirely in square caps is a
    // blocky subject drawn deliberately — `bank`, `boat`, `bridge` — and
    // rounding it would be a redraw, not a repair.
    for (const c of capped.filter((x) => x.cap !== "round")) {
      proposals.push({
        apply: (shapes) =>
          shapes.map((s, j) =>
            j === c.i ? { ...s, cap: "round" as const } : s
          ),
        contour: -1,
        fix: {
          after: "round",
          before: c.cap,
          kind: "unify-caps",
          reason: `icon mixes ${[...caps].join(" and ")} caps within one drawing; the majority and the house default are round`,
          shape: c.i,
        },
      });
    }
  }

  return proposals;
};

/**
 * Apply a set of proposals to one icon.
 *
 * Removals go last and in descending contour order. Dropping contour 3 renumbers
 * contour 4, so applying removals in the order they were proposed deletes the
 * wrong geometry the moment an icon has two of them — and icons with eight are
 * common.
 */
export const applyAll = (
  shapes: CorpusShape[],
  proposals: Proposal[]
): CorpusShape[] => {
  const removals = proposals.filter((p) => p.fix.kind === "remove-spur");
  const rest = proposals.filter((p) => p.fix.kind !== "remove-spur");
  let out = shapes;
  for (const p of rest) {
    out = p.apply(out);
  }
  for (const p of removals.toSorted((a, b) => b.contour - a.contour)) {
    out = p.apply(out);
  }
  return out;
};

export const repairIcon = (icon: CorpusIcon): RepairResult => {
  const proposals = proposeFixes(icon);
  const review: Review[] = [];
  const house = houseStroke(icon);

  for (const [i, shape] of icon.shapes.entries()) {
    const verdict = classifyStroke(shape.strokeWidth, house);
    if (verdict.kind === "review") {
      review.push({
        question: verdict.reason,
        shape: i,
        value: `stroke-width ${shape.strokeWidth}`,
      });
    }
  }
  const stroked = icon.shapes.filter(
    (sh) =>
      sh.strokeWidth > 0 &&
      parsePath(sh.d).some((sp) => !sp.closed && span(sp) > DEGENERATE_EXTENT)
  );
  if (stroked.length > 0 && stroked.every((sh) => sh.cap !== "round")) {
    review.push({
      question:
        "every stroke in this icon uses a non-round cap; square caps cluster on blocky subjects and read as deliberate",
      shape: -1,
      value: `all caps ${stroked[0].cap}`,
    });
  }

  const shapes = applyAll(icon.shapes, proposals);
  return {
    fixes: proposals.map((p) => p.fix),
    icon: icon.symbol,
    review,
    shapes,
    svg: toSVG(shapes),
  };
};

/** One shape's attribute changes, to be applied to the original source text. */
export interface ShapeEdit {
  /** Attribute name to value. A value replaces an existing attribute or is
   *  inserted before the closing bracket if the element does not carry one. */
  attrs: Record<string, string>;
  shape: number;
}

const ELEMENT = /<(?<tag>path|circle|ellipse|rect|line)\b[^>]*>/gu;

const setAttr = (el: string, name: string, value: string): string => {
  const existing = new RegExp(`(\\s${name}\\s*=\\s*")[^"]*(")`, "u");
  if (existing.test(el)) {
    return el.replace(existing, `$1${value}$2`);
  }
  // Insert before the element's closing bracket, keeping self-closing form.
  return el.replace(
    /\s*\/?>$/u,
    (tail) => ` ${name}="${value}"${tail.trimStart()}`
  );
};

/**
 * Apply edits to the *original file text*, changing nothing else.
 *
 * Re-serialising the document from parsed shapes was the wrong instinct: it
 * rewrote the `<svg>` header on all 98 staged files, adding explicit width and
 * height — a behavioural change to how an inlined icon scales that nobody asked
 * for — and buried 373 real fixes in a diff where every line read as changed.
 * The same principle already governed spur removal, where surviving contours
 * keep their original text; this extends it to the whole document.
 *
 * Returns null when the element count does not match the parsed shape count, so
 * an icon whose markup this cannot index confidently is left alone rather than
 * edited at a guessed offset.
 */
export const editSource = (
  svg: string,
  shapeCount: number,
  edits: ShapeEdit[]
): string | null => {
  ELEMENT.lastIndex = 0;
  const elements = [...svg.matchAll(ELEMENT)];
  if (elements.length !== shapeCount) {
    return null;
  }
  const byShape = new Map<number, Record<string, string>>();
  for (const e of edits) {
    byShape.set(e.shape, { ...byShape.get(e.shape), ...e.attrs });
  }

  let out = "";
  let cursor = 0;
  for (const [i, m] of elements.entries()) {
    const attrs = byShape.get(i);
    const start = m.index ?? 0;
    out += svg.slice(cursor, start);
    let [el] = m;
    if (attrs) {
      // A geometry change on a non-path element cannot be expressed in place:
      // the loader synthesised its `d` from cx/r/x/y, so writing one back would
      // be authoring geometry rather than editing it.
      if (attrs.d !== undefined && !el.startsWith("<path")) {
        return null;
      }
      for (const [name, value] of Object.entries(attrs)) {
        el = setAttr(el, name, value);
      }
    }
    out += el;
    cursor = start + m[0].length;
  }
  return out + svg.slice(cursor);
};

/** The edits needed to turn the original shapes into the repaired ones. */
export const editsFor = (
  before: CorpusShape[],
  after: CorpusShape[]
): ShapeEdit[] => {
  const edits: ShapeEdit[] = [];
  for (const [i, b] of before.entries()) {
    const a = after[i];
    if (!a) {
      continue;
    }
    const attrs: Record<string, string> = {};
    if (a.d !== b.d) {
      attrs.d = a.d;
    }
    if (a.strokeWidth !== b.strokeWidth && b.strokeWidth > 0) {
      attrs["stroke-width"] = String(a.strokeWidth);
    }
    if (a.cap !== b.cap) {
      attrs["stroke-linecap"] = a.cap;
    }
    if (Object.keys(attrs).length > 0) {
      edits.push({ attrs, shape: i });
    }
  }
  return edits;
};

export interface Verified extends RepairResult {
  /** The original file text with only the accepted changes applied, or null
   *  when the markup could not be indexed confidently. This is what gets
   *  written; `svg` is a normalised rebuild used only for comparison. */
  source: string | null;
  /** Fixes proposed but withheld because applying them moved the render. */
  rejected: Fix[];
  /** Rendered similarity of the original against the accepted result. */
  score: number;
  /** Everything proposed was accepted. */
  inert: boolean;
}

/**
 * Apply each proposed fix only if it leaves the picture where it was.
 *
 * The proof is the point, and it is per fix. Without it this module is a set of
 * plausible assertions about SVG semantics; with it, each one is checked
 * against a renderer on the actual icon, and the ones that turn out to be
 * redraws are handed back rather than shipped.
 */
export const verifyIcon = async (
  icon: CorpusIcon,
  originalSource?: string
): Promise<Verified> => {
  const base = repairIcon(icon);
  const proposals = proposeFixes(icon);
  if (proposals.length === 0) {
    return { ...base, inert: true, rejected: [], score: 1, source: null };
  }

  const before = toSVG(icon.shapes);
  // Each proposal is judged against the *original*, never against the running
  // result. Judging cumulatively made every contour index after the first
  // removal point at the wrong contour, which rejected 143 sound fixes and
  // would eventually have removed visible geometry.
  const scores = await Promise.all(
    proposals.map((p) => similarity(before, toSVG(p.apply(icon.shapes))))
  );
  const accepted: Fix[] = [];
  const rejected: Fix[] = [];
  const keep: Proposal[] = [];
  for (const [i, p] of proposals.entries()) {
    if (scores[i] >= INERT) {
      keep.push(p);
      accepted.push(p.fix);
    } else {
      rejected.push(p.fix);
    }
  }

  // Contour removals shift every later index, so they are applied last and in
  // descending order; everything else is index-stable.
  const shapes = applyAll(icon.shapes, keep);
  const score =
    accepted.length > 0 ? await similarity(before, toSVG(shapes)) : 1;
  const source =
    originalSource && accepted.length > 0
      ? editSource(
          originalSource,
          icon.shapes.length,
          editsFor(icon.shapes, shapes)
        )
      : null;
  return {
    fixes: accepted,
    icon: icon.symbol,
    inert: rejected.length === 0,
    rejected,
    review: base.review,
    score,
    shapes,
    source,
    svg: toSVG(shapes),
  };
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
  /** Icons where a proposal was rejected and withheld. The icon's other fixes
   *  still apply; this is not "the fix broke the icon". */
  withheld: Verified[];
  /** Icons with inert fixes that could not be expressed as an in-place edit. */
  unwritable: Verified[];
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
    symbols.map(async (s) => ({
      icon: await corpus.load(s, variant),
      source: await corpus.svg(s, variant),
    }))
  );
  const verified = await Promise.all(
    loaded.map((l) => verifyIcon(l.icon, l.source))
  );

  const changed = verified.filter((v) => v.fixes.length > 0);
  // An icon whose markup could not be indexed has no writable output, so it is
  // not "fixed" however inert its fixes were. Counting it as fixed is what let
  // the written set drift from the reported set.
  const fixed = changed.filter((v) => v.inert && v.source !== null);
  const withheld = changed.filter((v) => !v.inert);
  const unwritable = changed.filter((v) => v.inert && v.source === null);
  const review = verified.filter((v) => v.review.length > 0);

  const fixCounts: Record<FixKind, number> = {
    "close-gap": 0,
    "denoise-stroke": 0,
    "remove-spur": 0,
    "snap-stroke": 0,
    "unify-caps": 0,
  };
  for (const v of fixed) {
    for (const f of v.fixes) {
      fixCounts[f.kind] += 1;
    }
  }

  if (out && !dryRun) {
    await mkdir(out, { recursive: true });
    // Clear the directory first. Leaving it be let two files from an earlier,
    // buggy run survive into a later one, where they were indistinguishable
    // from current output and appeared in no section of the report — a reviewer
    // would have been reading a diff produced by code that no longer exists.
    const stale = await readdir(out);
    await Promise.all(stale.map((f) => rm(path.join(out, f), { force: true })));
    await Promise.all(
      fixed.map((v) =>
        writeFile(path.join(out, `${v.icon}.svg`), v.source as string)
      )
    );
    await writeFile(
      path.join(out, "repairs.json"),
      `${JSON.stringify(
        {
          fixed: fixed.map((v) => ({
            fixes: v.fixes,
            icon: v.icon,
            score: v.score,
          })),
          review: review.map((v) => ({ icon: v.icon, review: v.review })),
          variant,
          withheld: withheld.map((v) => ({ icon: v.icon, score: v.score })),
        },
        null,
        2
      )}\n`
    );
  }

  return {
    fixCounts,
    fixed,
    out: dryRun ? null : out,
    review,
    scanned: symbols.length,
    unwritable,
    variant,
    withheld,
  };
};

export const formatRepairReport = (r: RepairReport): string => {
  const lines = [
    `mechanical repair — ${r.scanned} icons in ${r.variant}`,
    "",
    `  snap-stroke     ${String(r.fixCounts["snap-stroke"]).padStart(4)}  float residue restored to the house stroke`,
    `  denoise-stroke  ${String(r.fixCounts["denoise-stroke"]).padStart(4)}  deliberate width cleaned of float dust, weight kept`,
    `  remove-spur     ${String(r.fixCounts["remove-spur"]).padStart(4)}  contour enclosing no area`,
    `  unify-caps      ${String(r.fixCounts["unify-caps"]).padStart(4)}  cap brought into line with the rest of its own icon`,
    `  close-gap       ${String(r.fixCounts["close-gap"]).padStart(4)}  subpath that all but closed itself`,
    "",
    `  ${r.fixed.length} icon(s) corrected and proved visually inert (similarity >= ${INERT})`,
    `  ${r.review.length} icon(s) left for review`,
  ];
  if (r.withheld.length > 0) {
    lines.push(
      "",
      `  ${r.withheld.length} icon(s) had a proposal withheld for moving the render:`,
      ...r.withheld.map(
        (v) =>
          `    ${v.icon}  ${v.rejected.map((f) => f.kind).join(", ")} (kept ${v.fixes.length} other fix(es))`
      )
    );
  }
  if (r.unwritable.length > 0) {
    lines.push(
      "",
      `  ${r.unwritable.length} icon(s) could not be edited in place and were not written:`,
      ...r.unwritable.map((v) => `    ${v.icon}`)
    );
  }
  if (r.out) {
    lines.push("", `  written to ${r.out}`);
  }
  return lines.join("\n");
};

/**
 * The icon language.
 *
 * Designed for a model to write, not for a machine to parse conveniently. Three
 * properties matter, in this order:
 *
 *   1. **Terse.** One op per line, no punctuation tax. Roughly a third of the
 *      tokens of the equivalent JSON, which is a third of the attention spent on
 *      braces instead of geometry.
 *   2. **No arithmetic.** `fill`, `center` and named anchors are the operations
 *      the model gets wrong when made to compute them: keyline scaling and
 *      centring are pure functions of the content, so code does them exactly.
 *   3. **Named parts.** Nothing can reason about `p0031`; everything can reason
 *      about `cloud`.
 *
 * Grammar (whitespace-separated, # starts a comment):
 *
 *   icon     <slug>
 *   keyline  circle | square | wide | tall
 *   part     <name> [at <x>,<y> | at <anchor>] [size <n> | fill] [turn cw|half|ccw]
 *   rect     <x>,<y> <w>x<h> [r<n>]
 *   circle   <cx>,<cy> r<n>
 *   line     <x>,<y> <x>,<y> [<x>,<y> ...]
 *   dot      <cx>,<cy> [terminal|more|floating|node]
 *   center                      -- recentre everything on (12,12)
 *   fit                         -- scale everything to the declared keyline
 *   cohort   [<name>]           -- scale everything to the family's extent
 *
 * `#` starts a comment only at the start of a token, so the `#` inside a cohort
 * key (`bell#filled`, the style-split key `inferCohort` produces) survives.
 *
 * `turn` names one of three quarter-turns — never an angle. The clusterer folds
 * a mark and its quarter-turns into one part (over blode-icons that merged the
 * horizontal and vertical strokes into a single part covering 808 icons), so
 * without a turn the language could place only the orientation the medoid
 * happened to be drawn at. Naming the turns rather than taking degrees is what
 * keeps `part tip turn 37` unwritable, and every node on the grid.
 *
 * `cohort` versus `fit`: both are a single similarity transform onto a target
 * extent, so the last one wins and running `fit` after `cohort` throws the
 * inheritance away — that is reported as an error rather than silently obeyed.
 * When a program declares both a `keyline` and a `cohort`, the cohort wins: the
 * keyline is a nominal box, the cohort is the box the icons this one swaps with
 * *measurably occupy*, and a 1px disagreement between the two is exactly the
 * flicker `cohort-align` exists to catch (437 findings across 186 families in
 * blode-icons, 371 of them ≥1px). The keyline still governs `part ... fill`.
 */
import type { DotRole, Keyline, Part } from "../types.js";
import { Canvas, SPEC } from "./canvas.js";
import type { Cohort, CohortTarget } from "./cohort.js";
import { COHORT_TOLERANCE, canonicalExtent, findCohort } from "./cohort.js";

const CENTRE = SPEC.canvas / 2;

const ANCHORS: Record<string, [number, number]> = {
  bottom: [12, 18],
  "bottom-left": [7, 17],
  "bottom-right": [17, 17],
  center: [12, 12],
  left: [6, 12],
  right: [18, 12],
  top: [12, 6],
  "top-left": [7, 7],
  "top-right": [17, 7],
};

/** The three turns that are not the identity, clockwise. Names, not degrees:
 *  a number here would be a coordinate by another name. */
const TURNS: Record<string, number> = { ccw: 3, cw: 1, half: 2 };

const OPS = [
  "icon",
  "keyline",
  "part",
  "rect",
  "circle",
  "line",
  "dot",
  "center",
  "fit",
  "cohort",
];

const KEYLINES = Object.keys(SPEC.keylines) as Keyline[];
const ROLES = Object.keys(SPEC.dots) as DotRole[];

const isKeyline = (v: string): v is Keyline =>
  (KEYLINES as string[]).includes(v);
const isRole = (v: string): v is DotRole => (ROLES as string[]).includes(v);

const pair = (tok: string | undefined): [number, number] => {
  const [a, b] = String(tok).split(",").map(Number.parseFloat);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    throw new TypeError(`bad coordinate "${tok}" — expected <x>,<y>`);
  }
  return [a, b];
};

/** A leading `r` or `size` sigil is optional sugar; the number is what matters. */
const num = (tok: string | undefined, what: string): number => {
  const v = Number(String(tok).replace(/^[a-z]/iu, ""));
  if (Number.isNaN(v)) {
    throw new TypeError(`bad ${what} "${tok}"`);
  }
  return v;
};

const placePart = (
  canvas: Canvas,
  byName: Map<string, Part>,
  t: string[],
  keyline: Keyline | null
): void => {
  const p = byName.get(t[1]);
  if (!p) {
    throw new Error(
      `unknown part "${t[1]}" — call listParts to see the vocabulary`
    );
  }
  const atIdx = t.indexOf("at");
  const sizeIdx = t.indexOf("size");
  const turnIdx = t.indexOf("turn");
  let turn = 0;
  if (turnIdx !== -1) {
    const name = t[turnIdx + 1];
    if (!(name in TURNS)) {
      throw new Error(
        `unknown turn "${name}" — expected one of ${Object.keys(TURNS).join(", ")}`
      );
    }
    turn = TURNS[name];
  }
  // A quarter-turn transposes the part's extent, so every measurement below —
  // where `fill` scales to, where the centre lands — is taken on the turned
  // shape rather than on the canonical one.
  const [pw, ph] = turn % 2 === 0 ? [p.w, p.h] : [p.h, p.w];
  const span = Math.max(pw, ph) || 1;
  let k = 1;
  if (t.includes("fill")) {
    const [kw, kh] = SPEC.keylines[keyline ?? "square"];
    k = Math.min(
      (kw - SPEC.stroke) / (pw || 1),
      (kh - SPEC.stroke) / (ph || 1)
    );
  } else if (sizeIdx !== -1) {
    k = num(t[sizeIdx + 1], "size") / span;
  }
  const w = pw * k;
  const h = ph * k;
  let cx = CENTRE;
  let cy = CENTRE;
  if (atIdx !== -1) {
    const a = t[atIdx + 1];
    const anchor = ANCHORS[a];
    if (anchor) {
      [cx, cy] = anchor;
    } else {
      // A bare coordinate names the top-left; an anchor names the centre.
      const [px, py] = pair(a);
      cx = px + w / 2;
      cy = py + h / 2;
    }
  }
  canvas.part({ id: p.id, scale: k, turn, x: cx - w / 2, y: cy - h / 2 });
};

/** Translate every element so the content bbox centres on (12,12). */
export const recentre = (canvas: Canvas): void => {
  const b = canvas.bbox();
  if (!b) {
    return;
  }
  canvas.transform(1, CENTRE - (b.x0 + b.w / 2), CENTRE - (b.y0 + b.h / 2));
};

/**
 * Scale content so its visual extent matches the keyline, and centre it.
 *
 * Applied as one transform, not scale-then-centre: an intermediate step can put
 * geometry outside 0..24, where the canvas clamp would eat it.
 */
export const fitKeyline = (canvas: Canvas, keyline: Keyline): void => {
  const b = canvas.bbox();
  if (!b) {
    return;
  }
  const [kw, kh] = SPEC.keylines[keyline];
  // The keyline is a visual extent, so the stroke's half-width on each side
  // comes off before the path bbox is asked to match it.
  const k = Math.min(
    (kw - SPEC.stroke) / (b.w || 1),
    (kh - SPEC.stroke) / (b.h || 1)
  );
  const cx = b.x0 + b.w / 2;
  const cy = b.y0 + b.h / 2;
  canvas.transform(k, CENTRE - k * cx, CENTRE - k * cy);
};

const span = (t: [number, number]): number => t[1] - t[0];

/** How far an achieved extent sits from the one that was asked for. */
const missBy = (t: [number, number] | null, lo: number, hi: number): number =>
  t ? Math.max(Math.abs(lo - t[0]), Math.abs(hi - t[1])) : 0;

/**
 * Scale and translate the drawing onto a family's measured extent.
 *
 * Two things it deliberately does not do:
 *
 * - **One scale, not two.** The transform is a similarity, so a drawing whose
 *   aspect ratio differs from the cohort's cannot land on both axes at once.
 *   The y extent wins when both are conventional, because y is the axis a swap
 *   flickers on: a family's widths legitimately vary (a badge hangs off the
 *   right) while its top and bottom edges are the rhythm — the same asymmetry
 *   `cohort.ts` opens with. What is left over on x is reported, not hidden.
 * - **Nothing on an unconventional axis.** A family with no agreement on an
 *   axis has nothing to inherit there, so that axis is simply centred on 12 —
 *   the behaviour of `center`, which is what the icon would have got anyway.
 *
 * Returns a message when the result does not fully land, else null.
 */
const alignCohort = (canvas: Canvas, target: CohortTarget): string | null => {
  const b = canvas.bbox();
  if (!b) {
    return "nothing drawn yet — put the geometry down first, then cohort";
  }
  if (!(target.x || target.y)) {
    return "that cohort has no agreed extent on either axis, so there is nothing to inherit; draw to the keyline instead";
  }
  const kx = target.x ? span(target.x) / (b.w || 1) : null;
  const ky = target.y ? span(target.y) / (b.h || 1) : null;
  const k = ky ?? kx ?? 1;
  const shift = (t: [number, number] | null, lo: number, size: number) =>
    t ? t[0] - k * lo : CENTRE - k * (lo + size / 2);
  canvas.transform(k, shift(target.x, b.x0, b.w), shift(target.y, b.y0, b.h));

  const after = canvas.bbox();
  if (!after) {
    return null;
  }
  const dx = missBy(target.x, after.x0, after.x1);
  const dy = missBy(target.y, after.y0, after.y1);
  if (Math.max(dx, dy) <= COHORT_TOLERANCE) {
    return null;
  }
  // Only reachable when the two axes wanted different scales: the drawing is
  // the wrong shape for the family, which no transform can fix. Redrawing it
  // narrower or wider is the fix, so say so with the number.
  return (
    `drawn shape does not fit the cohort: x is off by ${dx.toFixed(2)}px, y by ${dy.toFixed(2)}px ` +
    `(target x ${target.x?.[0].toFixed(2) ?? "-"}..${target.x?.[1].toFixed(2) ?? "-"}, ` +
    `y ${target.y?.[0].toFixed(2) ?? "-"}..${target.y?.[1].toFixed(2) ?? "-"}). ` +
    "Redraw it to the family's proportions rather than scaling harder."
  );
};

export interface RunResult {
  canvas: Canvas;
  errors: string[];
  icon: string | null;
  keyline: Keyline | null;
}

/** The four ops that put geometry on the canvas. Returns false if `op` is not
 *  one of them, so `run` can carry on to the ops that change state instead. */
const drawOp = (canvas: Canvas, t: string[], op: string): boolean => {
  if (op === "rect") {
    const [x, y] = pair(t[1]);
    const [w, h] = String(t[2]).split("x").map(Number.parseFloat);
    if (Number.isNaN(w) || Number.isNaN(h)) {
      throw new TypeError(`bad size "${t[2]}" — expected <w>x<h>`);
    }
    canvas.rect({ h, r: t[3] ? num(t[3], "radius") : 2, w, x, y });
  } else if (op === "circle") {
    const [cx, cy] = pair(t[1]);
    canvas.circle({ cx, cy, r: num(t[2], "radius") });
  } else if (op === "line") {
    canvas.line({ points: t.slice(1).map(pair) });
  } else if (op === "dot") {
    const [cx, cy] = pair(t[1]);
    const role = t[2] ?? "terminal";
    if (!isRole(role)) {
      throw new Error(
        `unknown dot role "${role}" — expected one of ${ROLES.join(", ")}`
      );
    }
    canvas.dot({ cx, cy, role });
  } else {
    return false;
  }
  return true;
};

/** Resolve the named family and conform the drawing to it. Returns a message
 *  when the drawing could not fully land on it, else null. */
const applyCohort = (
  canvas: Canvas,
  cohorts: Cohort[],
  key: string | null
): string | null => {
  if (!key) {
    throw new Error(
      "cohort needs a name, or an `icon <slug>` line to infer one from"
    );
  }
  const found = findCohort(cohorts, key);
  if (!found) {
    throw new Error(
      cohorts.length > 0
        ? `no measured cohort for "${key}" — known: ${cohorts.map((c) => c.name).join(", ")}`
        : `no cohorts were supplied, so "${key}" has no measured extent to inherit`
    );
  }
  const message = alignCohort(canvas, canonicalExtent(found));
  return message && `cohort "${found.name}": ${message}`;
};

/** Whether the drawing has already inherited a family extent. */
interface Layout {
  cohort: boolean;
}

/**
 * `fit` and `cohort` are the same operation against different targets — a
 * nominal keyline, or the box the family measurably occupies — so they are
 * handled as one. The last one applied wins, which makes a `fit` written after
 * a `cohort` a silent discard of the inheritance; it is refused instead.
 */
const layoutOp = (
  canvas: Canvas,
  t: string[],
  ctx: {
    cohorts: Cohort[];
    icon: string | null;
    keyline: Keyline | null;
    layout: Layout;
  }
): string | null => {
  if (t[0].toLowerCase() === "fit") {
    if (ctx.layout.cohort) {
      throw new Error(
        "fit after cohort undoes the family extent it just inherited — drop one of them; cohort is the stricter target"
      );
    }
    fitKeyline(canvas, ctx.keyline ?? "square");
    return null;
  }
  const message = applyCohort(canvas, ctx.cohorts, t[1] ?? ctx.icon);
  ctx.layout.cohort = true;
  return message;
};

export interface RunOptions {
  /**
   * The families this program may join, already measured — normally
   * `buildCohorts` over an existing set, which is what `forge lint --dir
   * --cohorts` builds too. Passing measured cohorts rather than a directory
   * keeps `tools/` free of I/O and means the drawing-time target and the
   * lint-time expectation come out of one call.
   */
  cohorts?: Cohort[];
}

/**
 * @param src   program text
 * @param parts vocabulary; a part is addressable by id or by name
 */
export const run = (
  src: string,
  parts: Part[] = [],
  { cohorts = [] }: RunOptions = {}
): RunResult => {
  const byName = new Map<string, Part>();
  for (const p of parts) {
    byName.set(p.id, p);
    if (p.name) {
      byName.set(p.name, p);
    }
  }
  const canvas = new Canvas(parts);
  let keyline: Keyline | null = null;
  let icon: string | null = null;
  const errors: string[] = [];

  // A `#` only opens a comment where a token starts, so `cohort bell#filled`
  // keeps its key while `rect 2,3 8x6  # body` still loses its tail.
  const lines = src
    .split("\n")
    .map((l) => l.replace(/(?<lead>^|\s)#.*$/u, "").trim())
    .filter(Boolean);
  const layout: Layout = { cohort: false };

  for (const [n, line] of lines.entries()) {
    const t = line.split(/\s+/u);
    const [head] = t;
    const op = head.toLowerCase();
    try {
      if (op === "icon") {
        icon = t[1] ?? null;
      } else if (op === "keyline") {
        const [, name] = t;
        if (!isKeyline(name)) {
          throw new Error(
            `unknown keyline "${name}" — expected one of ${KEYLINES.join(", ")}`
          );
        }
        keyline = name;
      } else if (op === "part") {
        placePart(canvas, byName, t, keyline);
      } else if (op === "center" || op === "centre") {
        recentre(canvas);
      } else if (op === "fit" || op === "cohort") {
        const message = layoutOp(canvas, t, { cohorts, icon, keyline, layout });
        if (message) {
          errors.push(`line ${n + 1} (${line}): ${message}`);
        }
      } else if (!drawOp(canvas, t, op)) {
        throw new Error(
          `unknown op "${op}" — expected one of ${OPS.join(", ")}`
        );
      }
    } catch (error) {
      errors.push(`line ${n + 1} (${line}): ${(error as Error).message}`);
    }
  }
  return { canvas, errors, icon, keyline };
};

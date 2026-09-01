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
 *   finish   outlined | filled
 *   part     <name> [at <x>,<y> | at <anchor>] [size <n> | fill] [turn cw|half|ccw] [flip]
 *   rect     <x>,<y> <w>x<h> [r<n>]
 *   circle   <cx>,<cy> r<n>
 *   arc      <cx>,<cy> r<n> quarter|half|three-quarter from top|right|bottom|left [ccw]
 *   diamond  <cx>,<cy> r<n>
 *   hole     rect <x>,<y> <w>x<h> [r<n>]
 *   hole     circle <cx>,<cy> r<n>
 *   hole     line <x>,<y> <x>,<y> [<x>,<y> ...] [off-axis]
 *   line     <x>,<y> <x>,<y> [<x>,<y> ...] [off-axis]
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
 * `flip` mirrors the part, and is a bare word for the same reason `off-axis`
 * is: the program says *that* the mark is reversed and nothing else. The
 * clusterer folds a mark and its reflection together — over blode-icons 19
 * mirror pairs had both halves inside one icon, a cube's two faces and a
 * basket's two sides among them — so one word covers both, and the placement
 * says which. It must be written, never inferred: a check mark, a comma, an `S`
 * and every letterform are chiral, so an implicit mirror is a backwards glyph
 * rather than another orientation. Reflection is applied before the turn.
 *
 * `finish` says whether the icon is a stroked skeleton or a solid shape, and
 * it is a line rather than a flag on the run because a program is the whole
 * description of an icon: reading one should not require knowing what was
 * passed alongside it. It is a property of the document, so it must be
 * declared before any geometry — a `rect` means a different set of corner
 * radii and a `dot` a different diameter under each finish, and a program that
 * could switch halfway would silently restate what it had already drawn.
 *
 * `hole` is the subtract op, and it is only legal under `finish filled`. It
 * cuts the solid drawn most recently, which is the order a drawing is made in;
 * the shape it cuts with is a `rect` or a `circle`, written exactly as it
 * would be as a solid and quantised by exactly the same code, so a hole cannot
 * carry a coordinate a solid could not. Holes are what the outlined-only
 * vocabulary could not express at all: 932 of the set's 2,085 filled icons
 * knock one out, so without this word fill mode reaches under half the set.
 *
 * `arc` is the open curve `circle` does not draw. Central's strike-through is
 * two half-arcs and a bar; wifi is concentric half-arcs. The model names a
 * pole, a named sweep and optionally `ccw`; the cubics are the ones `circle`
 * already uses. A polyline of grid points is a different shape.
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
import type { DotRole, Finish, IconDoc, Keyline, Part } from "../types.js";
import { ARC_FROM, ARC_SWEEP, Canvas, SPEC } from "./canvas.js";
import type { ArcFrom, ArcSweep, Spec } from "./canvas.js";
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
 *  a number here would be a coordinate by another name. Exported because
 *  `pipeline/tools.ts` offers the same three to a model, and a second table
 *  would let a program and a generation mean different things by `cw`. */
export const TURNS: Record<string, number> = { ccw: 3, cw: 1, half: 2 };

/**
 * Permission for a line to leave 0/45/90, spelled out in the program.
 *
 * A word rather than an angle, for the same reason `turn` names its quarters:
 * the program says *that* the edge is diagonal, and the endpoints — both on the
 * grid — say by how much. That is the convention the set already draws to. Its
 * off-axis edges land on rational slopes (atan(1/2), the 3-4-5 triangle,
 * atan(3)) precisely because they run between two grid points, so naming the
 * slope as well would be stating twice what the coordinates already fix.
 */
const OFF_AXIS = "off-axis";
const CCW = "ccw";

/** Permission to mirror a part, spelled out in the program. See the grammar
 *  note above: chirality is the one symmetry that must be asked for. */
const FLIP = "flip";

const OPS = [
  "icon",
  "keyline",
  "finish",
  "part",
  "rect",
  "circle",
  "arc",
  "diamond",
  "hole",
  "line",
  "dot",
  "center",
  "fit",
  "cohort",
];

const FINISHES: Finish[] = ["filled", "outlined"];

const isFinish = (v: string): v is Finish => (FINISHES as string[]).includes(v);

const KEYLINES = Object.keys(SPEC.keylines) as Keyline[];
const ROLES = Object.keys(SPEC.dots) as DotRole[];

const isKeyline = (v: string): v is Keyline =>
  (KEYLINES as string[]).includes(v);
const isRole = (v: string): v is DotRole => (ROLES as string[]).includes(v);
const isArcFrom = (v: string): v is ArcFrom =>
  (ARC_FROM as readonly string[]).includes(v);
const isArcSweep = (v: string): v is ArcSweep =>
  (ARC_SWEEP as readonly string[]).includes(v);

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
  const flip = t.includes(FLIP);
  // A quarter-turn transposes the part's extent, so every measurement below —
  // where `fill` scales to, where the centre lands — is taken on the turned
  // shape rather than on the canonical one. A reflection maps w to w and h to
  // h, so it changes none of them.
  const [pw, ph] = turn % 2 === 0 ? [p.w, p.h] : [p.h, p.w];
  const span = Math.max(pw, ph) || 1;
  let k = 1;
  if (t.includes("fill")) {
    const [kw, kh] = SPEC.keylines[keyline ?? "square"];
    // The keyline is a visual extent, so what the path may occupy is the
    // keyline less the ink either side of it — a full stroke width when the
    // shape will be stroked, nothing when it will be filled.
    k = Math.min(
      (kw - canvas.inkWidth) / (pw || 1),
      (kh - canvas.inkWidth) / (ph || 1)
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
  canvas.part({ flip, id: p.id, scale: k, turn, x: cx - w / 2, y: cy - h / 2 });
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
  const skeleton = canvas.skeletonBbox();
  if (!(b && skeleton)) {
    return;
  }
  const [kw, kh] = SPEC.keylines[keyline];
  // A keyline is a visual extent, and scaling by `k` does not multiply that
  // extent by `k`, because ink keeps its width. So solve
  // `k · skeleton + ink = target` rather than `k · painted = target`.
  //
  // Stroked drawings always had the constant term — the stroke, taken off
  // before the path bbox was asked to match it. Filled ones were assumed to
  // have none, "where the path already is the boundary", which is true of a
  // disc and false of a bar: a bar's path is a stroke already expanded, so
  // scaling it scales the ink too.
  const ink = canvas.inkExtent();
  const k = Math.min(
    (kw - ink.x) / (skeleton.w || 1),
    (kh - ink.y) / (skeleton.h || 1)
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
 * Returns a message when the result does not fully land, else null. Exported
 * because `pipeline/tools.ts` offers the same op to a model directly, and a
 * second implementation of it would be a second answer to "where does this
 * icon sit", which is the question the whole cohort machinery exists to make
 * have one answer.
 */
export const alignCohort = (
  canvas: Canvas,
  target: CohortTarget
): string | null => {
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
  finish: Finish;
  icon: string | null;
  keyline: Keyline | null;
}

/**
 * The finish, read before the canvas exists.
 *
 * A `Canvas` takes its finish at construction and cannot change it afterwards
 * — `dot` and every corner radius already mean different things under the two
 * — so the one declaration in the program has to be found before the first
 * primitive runs. That is why this is a scan rather than an op handled in
 * order; the op still exists in the loop, and there it enforces that the
 * declaration came before any geometry rather than being obeyed a second time.
 *
 * The first declaration wins, and a bad one is ignored here rather than
 * thrown: `run` reports a program's mistakes line by line and returns what it
 * could draw, so the diagnostic belongs to the op in the loop, where it has a
 * line number to attach itself to.
 */
const scanFinish = (lines: string[]): Finish => {
  for (const line of lines) {
    const t = line.split(/\s+/u);
    if (t[0].toLowerCase() === "finish" && isFinish(t[1])) {
      return t[1];
    }
  }
  return "outlined";
};

/** `rect <x>,<y> <w>x<h> [r<n>]`, shared by the solid and by `hole rect`, so
 *  the two cannot drift into meaning different things by the same words. */
const rectArgs = (
  t: string[]
): { h: number; r: number; w: number; x: number; y: number } => {
  const [x, y] = pair(t[0]);
  const [w, h] = String(t[1]).split("x").map(Number.parseFloat);
  if (Number.isNaN(w) || Number.isNaN(h)) {
    throw new TypeError(`bad size "${t[1]}" — expected <w>x<h>`);
  }
  return { h, r: t[2] ? num(t[2], "radius") : 2, w, x, y };
};

/** `hole <shape> ...` — the same shapes as solids, subtracted instead. */
const holeOp = (canvas: Canvas, t: string[]): void => {
  const [, shape] = t;
  if (shape === "rect") {
    canvas.hole({ ...rectArgs(t.slice(2)), shape: "rect" });
  } else if (shape === "circle") {
    const [cx, cy] = pair(t[2]);
    canvas.hole({ cx, cy, r: num(t[3], "radius"), shape: "circle" });
  } else if (shape === "line") {
    canvas.hole({
      offAxis: t.includes(OFF_AXIS),
      points: t
        .slice(2)
        .filter((v) => v !== OFF_AXIS)
        .map(pair),
      shape: "line",
    });
  } else {
    throw new Error(
      `hole needs a shape to cut with: "rect", "circle", or "line" — got "${shape ?? ""}"`
    );
  }
};

/** The ops that put geometry on the canvas. Returns false if `op` is not
 *  one of them, so `run` can carry on to the ops that change state instead. */
const drawOp = (canvas: Canvas, t: string[], op: string): boolean => {
  if (op === "rect") {
    canvas.rect(rectArgs(t.slice(1)));
  } else if (op === "circle") {
    const [cx, cy] = pair(t[1]);
    canvas.circle({ cx, cy, r: num(t[2], "radius") });
  } else if (op === "diamond") {
    const [cx, cy] = pair(t[1]);
    canvas.diamond({ cx, cy, reach: num(t[2], "reach") });
  } else if (op === "arc") {
    const [centre, radiusTok, sweep, fromKw, from] = t.slice(1);
    const [cx, cy] = pair(centre);
    if (sweep === undefined || !isArcSweep(sweep)) {
      throw new Error(
        `arc sweep "${sweep ?? ""}" — expected one of ${ARC_SWEEP.join(", ")}`
      );
    }
    if (fromKw !== "from" || from === undefined || !isArcFrom(from)) {
      throw new Error(
        `arc needs \`from top|right|bottom|left\` — got "${[fromKw, from].filter(Boolean).join(" ")}"`
      );
    }
    canvas.arc({
      ccw: t.includes(CCW),
      cx,
      cy,
      from,
      r: num(radiusTok, "radius"),
      sweep,
    });
  } else if (op === "hole") {
    holeOp(canvas, t);
  } else if (op === "line") {
    canvas.line({
      offAxis: t.includes(OFF_AXIS),
      points: t
        .slice(1)
        .filter((v) => v !== OFF_AXIS)
        .map(pair),
    });
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

/**
 * The `finish` line, checked rather than obeyed.
 *
 * `scanFinish` has already applied it — the canvas cannot exist without it —
 * so all that is left here is to refuse the two ways of writing it that would
 * mean something other than what was drawn: a finish this scan did not take
 * (an unknown word, or a second, contradicting declaration), and one that
 * arrives after geometry it therefore did not govern.
 */
const finishOp = (canvas: Canvas, t: string[], applied: Finish): void => {
  const [, name] = t;
  if (!isFinish(name)) {
    throw new Error(
      `unknown finish "${name ?? ""}" — expected one of ${FINISHES.join(", ")}`
    );
  }
  if (name !== applied || canvas.elements.length > 0) {
    throw new Error(
      "finish is a property of the whole icon and has to be declared before " +
        "anything is drawn: a rect takes its corner radii and a dot its " +
        "diameter from the finish, so shapes drawn either side of this line " +
        "would not mean the same thing. Move it to the top."
    );
  }
};

export interface RunOptions {
  /**
   * The families this program may join, already measured — normally
   * `buildCohorts` over an existing set, which is what `iconsmith lint --dir
   * --cohorts` builds too. Passing measured cohorts rather than a directory
   * keeps `tools/` free of I/O and means the drawing-time target and the
   * lint-time expectation come out of one call.
   */
  cohorts?: Cohort[];
  /** Stroke, family radius, optical size. Defaults to the house 24/2/3 cut. */
  spec?: Spec;
}

const defaults = ({ cohorts = [], spec = SPEC }: RunOptions = {}): {
  cohorts: Cohort[];
  spec: Spec;
} => ({
  cohorts,
  spec,
});

/**
 * @param src   program text
 * @param parts vocabulary; a part is addressable by id or by name
 */
export const run = (
  src: string,
  parts: Part[] = [],
  options: RunOptions = {}
): RunResult => {
  const { cohorts, spec } = defaults(options);
  const byName = new Map<string, Part>();
  for (const p of parts) {
    byName.set(p.id, p);
    if (p.name) {
      byName.set(p.name, p);
    }
  }
  let keyline: Keyline | null = null;
  let icon: string | null = null;
  const errors: string[] = [];

  // A `#` only opens a comment where a token starts, so `cohort bell#filled`
  // keeps its key while `rect 2,3 8x6  # body` still loses its tail. The source
  // line number is carried through the filter so an error names the line the
  // author wrote, not its position among the non-blank ones — a program with
  // comments or blank lines would otherwise point the repair loop at the wrong
  // line.
  const numbered = src
    .split("\n")
    .map((l, index): [number, string] => [
      index + 1,
      l.replace(/(?<lead>^|\s)#.*$/u, "").trim(),
    ])
    .filter(([, text]) => text.length > 0);
  const lines = numbered.map(([, text]) => text);
  const finish = scanFinish(lines);
  const canvas = new Canvas(parts, { finish, spec });
  const layout: Layout = { cohort: false };

  for (const [n, line] of numbered) {
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
      } else if (op === "finish") {
        finishOp(canvas, t, finish);
      } else if (op === "part") {
        placePart(canvas, byName, t, keyline);
      } else if (op === "center" || op === "centre") {
        recentre(canvas);
      } else if (op === "fit" || op === "cohort") {
        const message = layoutOp(canvas, t, { cohorts, icon, keyline, layout });
        if (message) {
          errors.push(`line ${n} (${line}): ${message}`);
        }
      } else if (!drawOp(canvas, t, op)) {
        throw new Error(
          `unknown op "${op}" — expected one of ${OPS.join(", ")}`
        );
      }
    } catch (error) {
      errors.push(`line ${n} (${line}): ${(error as Error).message}`);
    }
  }
  return { canvas, errors, finish, icon, keyline };
};

/**
 * Does this program reproduce this document exactly?
 *
 * The `.icon` DSL is a strict subset of `IconDoc`: `twin.ts`'s `programFromDoc`
 * has no word for a `raw` escape and drops it, so a filled diagonal bar leaves
 * the program while staying in the drawing. A program that does not replay to
 * the same document is a lossy record of the icon, not its source — which is
 * why `.icon.partial` exists as a separate name.
 *
 * The comparison surface is the document rather than the SVG: `parseIconSvg`
 * keeps geometry and drops the declaration, so two documents that differ only
 * in `keyline` would render identically and compare equal.
 */
export const completeProgram = (
  doc: IconDoc,
  program: string | undefined,
  parts: readonly Part[] = [],
  // Replay under the same run options that drew `doc`. Without the cohorts, a
  // program ending in `cohort` throws ("no cohorts were supplied…") on replay
  // and is falsely called incomplete; without the spec, a non-default cut
  // draws a different document and compares unequal. Both default to the house
  // cut, so callers that drew under it can omit this.
  options: RunOptions = {}
): boolean => {
  if (!program || doc.draw.some((op) => op.op === "raw")) {
    return false;
  }
  const replay = run(program, [...parts], options);
  if (replay.errors.length > 0) {
    return false;
  }
  return (
    JSON.stringify(
      replay.canvas.toJSON({ icon: replay.icon, keyline: replay.keyline })
    ) === JSON.stringify(doc)
  );
};

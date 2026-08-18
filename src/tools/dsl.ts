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
 *   part     <name> [at <x>,<y> | at <anchor>] [size <n> | fill]
 *   rect     <x>,<y> <w>x<h> [r<n>]
 *   circle   <cx>,<cy> r<n>
 *   line     <x>,<y> <x>,<y> [<x>,<y> ...]
 *   dot      <cx>,<cy> [terminal|more|floating]
 *   center                      -- recentre everything on (12,12)
 *   fit                         -- scale everything to the declared keyline
 */
import type { DotRole, Keyline, Part } from "../types.js";
import { Canvas, SPEC } from "./canvas.js";

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
  const span = Math.max(p.w, p.h) || 1;
  let k = 1;
  if (t.includes("fill")) {
    const [kw, kh] = SPEC.keylines[keyline ?? "square"];
    k = Math.min(
      (kw - SPEC.stroke) / (p.w || 1),
      (kh - SPEC.stroke) / (p.h || 1)
    );
  } else if (sizeIdx !== -1) {
    k = num(t[sizeIdx + 1], "size") / span;
  }
  const w = p.w * k;
  const h = p.h * k;
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
  canvas.part({ id: p.id, scale: k, x: cx - w / 2, y: cy - h / 2 });
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

/**
 * @param src   program text
 * @param parts vocabulary; a part is addressable by id or by name
 */
export const run = (src: string, parts: Part[] = []): RunResult => {
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

  const lines = src
    .split("\n")
    .map((l) => l.replace(/#.*$/u, "").trim())
    .filter(Boolean);

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
      } else if (op === "fit") {
        fitKeyline(canvas, keyline ?? "square");
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

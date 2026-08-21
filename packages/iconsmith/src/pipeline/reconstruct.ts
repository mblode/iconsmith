/**
 * Reconstruction: the house icon is the program.
 *
 * Keyed generation asks a coding agent to rediscover a drawing that is already
 * on disk. Matching each house subpath to a vocabulary part and replaying the
 * placement is a compiler; cosine near 1.0 is the compiler working, not a leak.
 * The leak was a silhouette with no `part` ops. This module does not invent
 * unkeyed icons — there is nothing to compile from.
 *
 * A closed circular subpath is a `circle`, not a `part`. The vocabulary's
 * nearest ring is a cluster medoid — slightly oval — and `part` scales it
 * uniformly onto a square box, so the nodes of `pull-request` come out
 * squashed. The primitive stays round because `canvas.circle` draws one.
 *
 * A mixed-size cluster is the same trap at another scale. Fingerprinting
 * folds the house `star` (19 units) in with the 5-unit decorative mark;
 * the medoid is the small one, and placing it at size 19 with `flip` cooks
 * the points. When the canonical size is far from the target but the
 * cluster's `sizeRange` still covers it, the house path itself is the part.
 */
import { bbox, parsePath, serialise, translate } from "../geometry/path.js";
import { fingerprint, flatten, match } from "../parts/shape.js";
import { declareKeyline } from "../tools/declare.js";
import type { Declared } from "../tools/declare.js";
import { lint } from "../tools/lint.js";
import type { Finish, Issue, Part, Subpath } from "../types.js";
import type { GenerateLike } from "./harness.js";

const GRID = 4;
/** Same grid the extractor seats a part on, so a local house path is a part. */
const PART_GRID = 0.25;
const MATCH_OK = 0.12;
/** Canonical vs target. Past this the medoid is a different drawing, not
 *  the same mark at another size — `star` is 3.6×, and that is the cook. */
const MIXED_SCALE = 2;
/** A 4-unit chevron in a mixed cluster is still a chevron. Identity is
 *  for the mark that fills the canvas — the house star, not `p0391`. */
const HOUSE_SPAN = 12;
/** Same 5% test as `circleRadius` in `corpus/measure.ts`. Pipeline does not
 *  import `corpus/`, so the check lives here rather than being shared. */
const ROUNDNESS = 0.05;
const EPS = 1e-6;

const TURN_WORD: Record<number, string> = {
  1: "cw",
  2: "half",
  3: "ccw",
};

const quant = (n: number): number => Math.round(n * GRID) / GRID;

/** A closed circular subpath as a DSL `circle`, or null when it is a square
 *  rounded-rect, an oval, or anything else whose points do not share a radius.
 *  The bbox must already be square — that is what keeps `ellipse-flat` out. */
const asCircle = (
  sp: Subpath
): { cx: number; cy: number; r: number } | null => {
  if (!sp.closed) {
    return null;
  }
  const poly = flatten(sp);
  if (poly.length < 8) {
    return null;
  }
  const box = bbox([sp]);
  const span = Math.max(box.w, box.h);
  if (span < EPS || Math.abs(box.w - box.h) / span > ROUNDNESS) {
    return null;
  }
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const r = span / 2;
  const off =
    Math.max(
      ...poly.map(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - r))
    ) / r;
  if (off > ROUNDNESS) {
    return null;
  }
  return { cx: quant(cx), cy: quant(cy), r: quant(r) };
};

/** The cluster folded a small medoid with a large instance of the same
 *  fingerprint. Placing the medoid at the large size is the cooked star. */
const mixedSize = (part: Part, target: number): boolean => {
  const native = Math.max(part.w, part.h) || 1;
  const range = part.sizeRange;
  if (!range) {
    return false;
  }
  const [lo, hi] = range;
  const inRange = target >= lo * 0.9 && target <= hi * 1.1;
  const ratio = Math.max(target, native) / Math.min(target, native);
  return inRange && ratio > MIXED_SCALE && target >= HOUSE_SPAN;
};

const asLocal = (slug: string, n: number, sp: Subpath): Part => {
  const box = bbox([sp]);
  return {
    closed: sp.closed,
    d: serialise([translate(sp, -box.x0, -box.y0)], { grid: PART_GRID }),
    h: box.h,
    icons: [slug],
    id: `${slug}-${n}`,
    instances: 1,
    name: slug,
    nodes: sp.segs.length,
    sizeRange: [Math.max(box.w, box.h), Math.max(box.w, box.h)],
    w: box.w,
  };
};

const placeLocal = (
  slug: string,
  n: number,
  sp: Subpath,
  extras: Part[],
  lines: string[]
): number => {
  const house = asLocal(slug, n, sp);
  extras.push(house);
  const box = bbox([sp]);
  const size = quant(Math.max(box.w, box.h));
  lines.push(
    `part ${house.id} at ${quant(box.x0)},${quant(box.y0)} size ${size || 1}`
  );
  return n + 1;
};

/**
 * A `.icon` program that rebuilds these path `d`s from primitives and `parts`.
 * Circles stay `circle`. Vocabulary matches become `part` ops. Anything else —
 * unmatched, or a mixed-size cluster whose medoid would cook — is the house
 * subpath itself, parked in `extras` and placed by id. Keyed compile therefore
 * still draws when the extract is empty: the house file is the vocabulary for
 * that icon, which is reconstruction, not a model inventing geometry.
 *
 * No `keyline` line, and no `fit`. Both would be the compiler overruling
 * Central about the size of Central's own drawing: a compile reproduces an
 * extent that already exists, so the box is a measurement rather than a
 * choice. {@link compileArm} measures it and declares it when it lands on one.
 */
export const compileIcon = (
  slug: string,
  paths: readonly string[],
  parts: readonly Part[],
  extras: Part[] = []
): string => {
  const fps = parts.map((p) => {
    const [sp] = parsePath(p.d);
    return { fp: sp ? fingerprint(sp) : null, part: p };
  });
  const lines = [`icon ${slug}`];
  let local = 0;
  for (const d of paths) {
    for (const sp of parsePath(d)) {
      const ring = asCircle(sp);
      if (ring) {
        lines.push(`circle ${ring.cx},${ring.cy} r${ring.r}`);
        continue;
      }
      const fp = fingerprint(sp);
      let best: {
        d: number;
        flip: boolean;
        id: string;
        part: Part;
        turn: number;
      } | null = null;
      for (const row of fps) {
        if (!row.fp) {
          continue;
        }
        const m = match(fp, row.fp);
        if (m.d < (best?.d ?? Number.POSITIVE_INFINITY)) {
          best = {
            d: m.d,
            flip: m.flip,
            id: row.part.id,
            part: row.part,
            turn: m.turn,
          };
        }
      }
      const box = bbox([sp]);
      const size = quant(Math.max(box.w, box.h));
      if (!best || best.d > MATCH_OK || mixedSize(best.part, size)) {
        local = placeLocal(slug, local, sp, extras, lines);
        continue;
      }
      const turn = TURN_WORD[best.turn];
      const bits = [
        "part",
        best.id,
        "at",
        `${quant(box.x0)},${quant(box.y0)}`,
        "size",
        String(size || 1),
      ];
      if (turn) {
        bits.push("turn", turn);
      }
      if (best.flip) {
        bits.push("flip");
      }
      lines.push(bits.join(" "));
    }
  }
  return `${lines.join("\n")}\n`;
};

/** Stamp a finish onto a compiled program without disturbing a declaration
 *  that is already there. Filled house files have to be run as filled, or
 *  the compiler strokes the solid's outline and the twin is a different
 *  drawing. */
export const finishProgram = (source: string, finish: Finish): string =>
  /^finish\b/mu.test(source)
    ? source.replace(/^finish\s+\w+/mu, `finish ${finish}`)
    : source.replace(/^(?<icon>icon[^\n]*\n)/u, `$<icon>finish ${finish}\n`);

/**
 * Compile one paint of a house file: the path data, the extras it parks,
 * and the finish that paint actually is.
 *
 * Two house files of one slug are two reconstructions, not one skeleton
 * re-painted. The outlined compile of `plus-large` is four open strokes;
 * the filled house file is a single evenodd plus. Deriving the second from
 * the first is the fallback for a net-new icon. When both files exist,
 * compile each.
 */
export const compilePaint = (
  slug: string,
  paths: readonly string[],
  finish: Finish = "outlined",
  parts: readonly Part[] = []
): Declared & { extras: Part[] } => {
  const extras: Part[] = [];
  const bare = finishProgram(compileIcon(slug, paths, parts, extras), finish);
  return { extras, ...declareKeyline(bare, slug, [...parts, ...extras]) };
};

/** Thrown when there is nothing to compile: no target paths, or no part in
 *  the vocabulary matched them. Distinct from a compiled program that lints
 *  badly, which is a score rather than an error. */
export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompileError";
  }
}

/** The ops a program ran, in order — the compiler's answer to the built-in
 *  loop's tool-call trace. */
const traceOf = (source: string): string[] =>
  source
    .split("\n")
    .map((l) => l.replace(/(?<lead>^|\s)#.*$/u, "").trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/u)[0].toLowerCase());

const hasCompileOp = (source: string): boolean =>
  source.split("\n").some((l) => /^\s*(?:part|circle)\s/u.test(l));

/**
 * Keyed reconstruction as a `GenerateFn`.
 *
 * `cost` is absent: there is no model. Absent means "not measured", and filling
 * zeros would enter a free compiler into the eval's dollar column as a paid
 * arm that cost nothing.
 */
export const compileArm = (): GenerateLike => (concept, options) => {
  const paths = options.targetPaths;
  if (paths === undefined) {
    return Promise.reject(
      new CompileError(
        `compile needs targetPaths to draw \`${concept.name}\`. ` +
          "Keyed reconstruction has nothing to compile from without path data."
      )
    );
  }
  const painted = compilePaint(
    concept.name,
    paths,
    "outlined",
    options.parts ?? []
  );
  if (!hasCompileOp(painted.source)) {
    return Promise.reject(
      new CompileError(
        `compile produced no part or circle ops for \`${concept.name}\`. ` +
          "Nothing in the vocabulary matched the target paths."
      )
    );
  }
  const { program, source } = painted;
  const issues: Issue[] = [
    ...program.errors.map((message) => ({
      message,
      rule: "dsl",
      severity: "error" as const,
    })),
    ...lint(program.canvas, { keyline: program.keyline }),
  ];
  const trace = traceOf(source);
  const brief = `compile ${concept.name}`;
  return Promise.resolve({
    brief,
    clean: issues.every((i) => i.severity !== "error"),
    doc: program.canvas.toJSON({
      icon: program.icon ?? concept.name,
      keyline: program.keyline,
    }),
    issues,
    program: source,
    steps: trace.length,
    svg: program.canvas.toSVG(),
    text: brief,
    trace,
  });
};

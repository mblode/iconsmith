/**
 * The corpus: 2,085 Central symbols drawn 30 ways each.
 *
 * This is the specification. The house spec was originally written from an
 * article about Cursor's set, but blode-icons is ~96% Central-derived, and
 * Central packs tighter — Cursor's numbers flag most of Central as broken. So
 * every constant downstream is measured from here, not read from prose.
 *
 * Loading is lazy on purpose: 62,550 files is 247MB, and nothing needs more
 * than a sample at a time. The index holds names; `load` reads one icon.
 */
import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { InputError } from "../commands/read.js";

export type Corner = "round" | "square";
export type Style = "filled" | "outlined";

/** A variant key decomposed. `radius` is Central's corner tier (0..3), which is
 *  a family-wide setting, not the per-shape radius a given corner turns out to
 *  use — those are measured, in `measure.ts`. */
export interface Variant {
  corner: Corner;
  key: string;
  radius: number;
  stroke: number;
  style: Style;
}

/** One drawable element. `strokeWidth` is 0 for a filled shape, which is what
 *  makes visual extent = bbox + strokeWidth correct for both styles at once.
 *  `cap` matters because Central draws dots as zero-length round-capped
 *  segments, where the stroke width *is* the dot's diameter. */
export interface CorpusShape {
  cap: "butt" | "round" | "square";
  d: string;
  filled: boolean;
  fillRule?: "nonzero" | "evenodd";
  strokeWidth: number;
}

export interface CorpusIcon {
  shapes: CorpusShape[];
  symbol: string;
  variant: Variant;
}

export interface Corpus {
  has: (symbol: string, variant: string) => boolean;
  load: (symbol: string, variant: string) => Promise<CorpusIcon>;
  origin: string;
  pathTo: (symbol: string, variant: string) => string;
  root: string;
  /** The raw SVG source, for callers that want to diff or re-render it rather
   *  than measure it. */
  svg: (symbol: string, variant: string) => Promise<string>;
  symbols: string[];
  variant: (key: string) => Variant | undefined;
  variants: Variant[];
}

/**
 * The variant blode-icons is drawn in. Verified by comparison: Central's
 * `round-outlined-radius-3-stroke-2` output is byte-identical to the
 * corresponding `icons-svg/*.svg` in blode-icons. Calibration that targets the
 * house set targets this key.
 */
export const HOUSE_VARIANT = "round-outlined-radius-3-stroke-2";

/** The filled twin of {@link HOUSE_VARIANT}: same 2,085 concepts, same corner
 *  tier and nominal stroke, drawn as solids. A filled card scored against the
 *  outlined variant is a finish mismatch, not a drawing score. */
export const FILLED_VARIANT = "round-filled-radius-3-stroke-2";

const KEY =
  /^(?<corner>round|square)-(?<style>filled|outlined)-radius-(?<radius>\d+(?:\.\d+)?)-stroke-(?<stroke>\d+(?:\.\d+)?)$/u;

/** `round-outlined-radius-2-stroke-1.5` → its four axes. Null when the name is
 *  not a variant directory (`corpus.json` lands here too).
 *
 *  Note that the four axes are not a full product: `square` exists only at
 *  radius 0, so the grid is 5 corner options (square-0, round-0/1/2/3) × 3
 *  strokes × 2 styles = 30, not 2 × 4 × 3 × 2 = 48. A key this function accepts
 *  is not necessarily a variant the corpus ships; ask `corpus.variant(key)` for
 *  that. */
export const parseVariantKey = (key: string): Variant | null => {
  const g = KEY.exec(key)?.groups;
  if (!g) {
    return null;
  }
  return {
    corner: g.corner as Corner,
    key,
    radius: Number(g.radius),
    stroke: Number(g.stroke),
    style: g.style as Style,
  };
};

/** The inverse of `parseVariantKey`, so callers name a variant by its axes
 *  rather than building the string by hand. Round-trips for every key the
 *  corpus ships; it does not check that the combination exists. */
export const variantKey = (v: {
  corner: Corner;
  radius: number;
  stroke: number;
  style: Style;
}): string => `${v.corner}-${v.style}-radius-${v.radius}-stroke-${v.stroke}`;

const ELEMENT = /<(?<tag>path|circle|ellipse|rect|line)\b[^>]*>/gu;
const ATTR = /(?<name>[a-zA-Z][a-zA-Z0-9-]*)\s*=\s*"(?<value>[^"]*)"/gu;
/** Circular arc → cubic handle ratio for a 90° quadrant. */
const K = 0.5523;

const num = (v: string | undefined, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** An axis-aligned ellipse as four cubic quadrants. Central's `<circle>` and
 *  `<ellipse>` elements are ~7% of shapes; dropping them would bias every
 *  extent and dot measurement towards icons drawn only with paths. */
const ellipseToPath = (
  cx: number,
  cy: number,
  rx: number,
  ry: number
): string => {
  const hx = rx * K;
  const hy = ry * K;
  return [
    `M${cx + rx} ${cy}`,
    `C${cx + rx} ${cy + hy} ${cx + hx} ${cy + ry} ${cx} ${cy + ry}`,
    `C${cx - hx} ${cy + ry} ${cx - rx} ${cy + hy} ${cx - rx} ${cy}`,
    `C${cx - rx} ${cy - hy} ${cx - hx} ${cy - ry} ${cx} ${cy - ry}`,
    `C${cx + hx} ${cy - ry} ${cx + rx} ${cy - hy} ${cx + rx} ${cy}`,
    "Z",
  ].join("");
};

/** A rounded rectangle, corners as quadrant cubics so their radii are
 *  measurable by the same estimator that reads them out of path data. */
const rectToPath = (
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): string => {
  const rr = Math.min(r, w / 2, h / 2);
  if (rr <= 0) {
    return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  }
  const k = rr * K;
  return [
    `M${x + rr} ${y}`,
    `H${x + w - rr}`,
    `C${x + w - rr + k} ${y} ${x + w} ${y + rr - k} ${x + w} ${y + rr}`,
    `V${y + h - rr}`,
    `C${x + w} ${y + h - rr + k} ${x + w - rr + k} ${y + h} ${x + w - rr} ${y + h}`,
    `H${x + rr}`,
    `C${x + rr - k} ${y + h} ${x} ${y + h - rr + k} ${x} ${y + h - rr}`,
    `V${y + rr}`,
    `C${x} ${y + rr - k} ${x + rr - k} ${y} ${x + rr} ${y}`,
    "Z",
  ].join("");
};

const geometry = (
  tag: string,
  a: Record<string, string>
): string | undefined => {
  if (tag === "path") {
    return a.d;
  }
  if (tag === "circle") {
    return ellipseToPath(num(a.cx), num(a.cy), num(a.r), num(a.r));
  }
  if (tag === "ellipse") {
    return ellipseToPath(num(a.cx), num(a.cy), num(a.rx), num(a.ry));
  }
  if (tag === "rect") {
    return rectToPath(
      num(a.x),
      num(a.y),
      num(a.width),
      num(a.height),
      num(a.rx ?? a.ry)
    );
  }
  return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
};

/** Definitions describe resources, never foreground ink. This flat geometry
 * reader does not resolve masks, clipping, use instances or transforms; callers
 * requiring visual fidelity must compare the actual rendered source. */
const RESOURCE_CONTAINERS = new Set([
  "defs",
  "clipPath",
  "mask",
  "symbol",
  "pattern",
  "marker",
  "linearGradient",
  "radialGradient",
]);
const PAINT_ATTRIBUTES = new Set([
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "fill-rule",
]);

const foregroundMarkup = (svg: string): string => {
  const stack: { excluded: boolean; paint: Record<string, string> }[] = [];
  const visible: string[] = [];
  const withoutComments = svg.replaceAll(/<!--[\s\S]*?-->/gu, "");
  for (const token of withoutComments.matchAll(
    /<(?<closing>\/)?(?<tag>[a-zA-Z][\w:-]*)\b[^>]*>/gu
  )) {
    const tag = token.groups?.tag ?? "";
    if (token.groups?.closing) {
      stack.pop();
      continue;
    }
    const parent = stack.at(-1);
    const paint = { ...parent?.paint };
    const local = new Set<string>();
    for (const attr of token[0].matchAll(ATTR)) {
      const name = attr.groups?.name ?? "";
      local.add(name);
      if (PAINT_ATTRIBUTES.has(name)) {
        paint[name] = attr.groups?.value ?? "";
      }
    }
    const excluded = Boolean(parent?.excluded) || RESOURCE_CONTAINERS.has(tag);
    if (!excluded) {
      const inherited = Object.entries(paint)
        .filter(([name]) => !local.has(name))
        .map(([name, value]) => ` ${name}="${value}"`)
        .join("");
      visible.push(
        token[0].replace(/(?<close>\/?>)$/u, `${inherited}$<close>`)
      );
    }
    if (!/\/\s*>$/u.test(token[0])) {
      stack.push({ excluded, paint });
    }
  }
  return visible.join("\n");
};

export const parseIconSvg = (svg: string): CorpusShape[] => {
  const shapes: CorpusShape[] = [];
  for (const el of foregroundMarkup(svg).matchAll(ELEMENT)) {
    const attrs: Record<string, string> = {};
    for (const a of el[0].matchAll(ATTR)) {
      attrs[a.groups?.name ?? ""] = a.groups?.value ?? "";
    }
    const d = geometry(el.groups?.tag ?? "", attrs);
    if (!d) {
      continue;
    }
    const stroked = attrs.stroke !== undefined && attrs.stroke !== "none";
    const filled = attrs.fill !== "none";
    if (!stroked && !filled) {
      continue;
    }
    shapes.push({
      cap: (attrs["stroke-linecap"] ?? "butt") as CorpusShape["cap"],
      d,
      filled,
      ...(attrs["fill-rule"]
        ? { fillRule: attrs["fill-rule"] as "nonzero" | "evenodd" }
        : {}),
      strokeWidth: stroked ? num(attrs["stroke-width"], 1) : 0,
    });
  }
  return shapes;
};

const SVG = ".svg";

/**
 * What a corpus is and where to get one, said once.
 *
 * The corpus is not in the repository — it is 62,550 files of a third-party
 * set — so a missing one is the *normal* state of a fresh clone rather than a
 * broken install. `ENOENT ... open 'corpus/corpus.json'` names neither of those
 * facts, so every read here is translated the way `commands/read.ts` translates
 * the ones on the command line.
 */
const CORPUS_HELP =
  "A corpus is a directory of icon .svg files with a corpus.json index beside them; it is not shipped with iconsmith. Pass --corpus <dir> to point at one.";

const corpusError = (root: string, why: string, error?: unknown): InputError =>
  new InputError(
    `Cannot read the corpus at "${root}": ${why} ${CORPUS_HELP}`,
    error
  );

const explainCorpus = (root: string, error: unknown): InputError => {
  const errno = (error as NodeJS.ErrnoException).code;
  if (errno === "ENOENT") {
    return corpusError(root, "no such directory.", error);
  }
  if (errno === "ENOTDIR") {
    return corpusError(root, "that is not a directory.", error);
  }
  if (errno === "EACCES") {
    return corpusError(root, "permission denied.", error);
  }
  return corpusError(root, `${(error as Error).message}.`, error);
};

/**
 * Index the corpus by symbol × variant. Reads 30 directory listings and
 * `corpus.json`; no icon file is opened until `load` asks for one.
 */
export const loadCorpus = async (root = "corpus"): Promise<Corpus> => {
  const index = path.join(root, "corpus.json");
  let text: string;
  try {
    text = await readFile(index, "utf-8");
  } catch (error) {
    throw explainCorpus(root, error);
  }
  let meta: { icons: string[]; origin: string };
  try {
    meta = JSON.parse(text) as { icons: string[]; origin: string };
  } catch (error) {
    // Separated from the read: "there is no corpus" and "the corpus index is
    // corrupt" have different fixes, and one message for both hides which.
    throw new InputError(
      `"${index}" is not valid JSON: ${(error as Error).message}. Expected the corpus index: {"origin": string, "icons": string[]}.`,
      error
    );
  }
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    throw explainCorpus(root, error);
  }
  // One listing per variant directory — 30 of them, a fixed count set by the
  // shape of the corpus rather than its size — so these run together. The
  // per-icon reads in `measure.ts` are the unbounded walk and stay sequential.
  const listings = await Promise.all(
    entries
      .map((e) => (e.isDirectory() ? parseVariantKey(e.name) : null))
      .filter((v): v is Variant => v !== null)
      .map(async (v) => ({
        files: await readdir(path.join(root, v.key)),
        variant: v,
      }))
  );
  const variants: Variant[] = [];
  const present = new Map<string, Set<string>>();
  for (const { files, variant: v } of listings) {
    variants.push(v);
    present.set(
      v.key,
      new Set(
        files.filter((f) => f.endsWith(SVG)).map((f) => f.slice(0, -SVG.length))
      )
    );
  }
  variants.sort((x, y) => x.key.localeCompare(y.key));
  const byKey = new Map(variants.map((v) => [v.key, v]));
  const pathTo = (symbol: string, variant: string) =>
    path.join(root, variant, `${symbol}${SVG}`);
  // Async even for the guard, so a bad variant name is a rejected promise like
  // every other failure here rather than a synchronous throw the caller has to
  // catch differently.
  const svg = async (symbol: string, variant: string) => {
    if (!byKey.has(variant)) {
      throw new Error(`Unknown corpus variant "${variant}".`);
    }
    return await readFile(pathTo(symbol, variant), "utf-8");
  };

  return {
    has: (symbol, variant) => present.get(variant)?.has(symbol) ?? false,
    load: async (symbol, variant) => ({
      shapes: parseIconSvg(await svg(symbol, variant)),
      symbol,
      variant: byKey.get(variant) as Variant,
    }),
    origin: meta.origin,
    pathTo,
    root,
    svg,
    symbols: meta.icons,
    variant: (key) => byKey.get(key),
    variants,
  };
};

/**
 * `n` symbols spread evenly across the alphabetical set. Deterministic by
 * construction, so a measurement quoted in a comment can be reproduced.
 */
export const sampleSymbols = (symbols: string[], n: number): string[] => {
  if (n >= symbols.length) {
    return [...symbols];
  }
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(symbols[Math.floor((i * symbols.length) / n)]);
  }
  return out;
};

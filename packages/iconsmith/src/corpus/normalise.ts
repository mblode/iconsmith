/**
 * Put ten icon sets on one grid, so a number measured across them means one
 * thing.
 *
 * `parseIconSvg` is exactly right for Central, whose files state every
 * presentation attribute on the element that draws and always use a 24-unit
 * viewBox. Point it at the third-party packs unchanged and three separate
 * things go wrong, each of which silently produces a plausible wrong number
 * rather than an error:
 *
 * 1. **Inherited attributes.** Lucide and Tabler put `stroke="currentColor"`
 *    and `stroke-width="2"` on the root `<svg>` and nothing on the paths. Read
 *    element-only, every Lucide icon is unstroked, its edge count is 0, and the
 *    set reports 0.0% off-axis edges — which reads as "Lucide is perfectly
 *    axial" and means "we did not look".
 *
 * 2. **Invisible elements.** Every Tabler icon opens with
 *    `<path stroke="none" d="M0 0h24v24H0z"/>`, a full-canvas hit area that
 *    draws nothing. Counted as ink, it pins every Tabler visual extent to
 *    exactly 24×24 and the whole set lands `off` every keyline.
 *
 * 3. **Foreign viewBoxes.** Phosphor draws on 256 units and Radix on 15.
 *    Comparing either against a 24-unit keyline compares a drawing to a ruler
 *    from a different box.
 *
 * All three are fixed here, before anything measures: attributes are inherited
 * from the root, elements that draw nothing are dropped, and the geometry is
 * scaled to 24 units. What comes out is a `CorpusShape[]` on the house grid,
 * which is the only input the measurers were ever calibrated for.
 */
import { parsePath, scale, serialise, translate } from "../geometry/path.js";
import type { CorpusShape } from "./load.js";
import { parseIconSvg } from "./load.js";

/** The grid every measurement in this project is expressed in. */
export const GRID = 24;

const ROOT = /<svg\b(?<attrs>[^>]*)>/iu;
const ELEMENT =
  /<(?<tag>path|circle|ellipse|rect|line)\b(?<attrs>[^>]*?)(?<slash>\/?)>/gu;
const ATTR = /(?<name>[a-zA-Z-]+)\s*=\s*"(?<value>[^"]*)"/gu;

/** The presentation attributes that decide whether and how a shape draws.
 *  `fill` and `stroke` are read by `parseIconSvg`; the other two are read by
 *  everything that measures a stroke's extent or its ends. */
const INHERITED = ["fill", "stroke", "stroke-width", "stroke-linecap"] as const;

const attrsOf = (s: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(ATTR)) {
    out[m.groups?.name ?? ""] = m.groups?.value ?? "";
  }
  return out;
};

const viewBoxOf = (attrs: Record<string, string>): number[] | null => {
  const parts = (attrs.viewBox ?? "")
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  return parts.length === 4 && parts.every((n) => Number.isFinite(n))
    ? parts
    : null;
};

/**
 * Rewrite each shape element to carry the root's presentation attributes where
 * it states none of its own.
 *
 * Done on the text rather than on `parseIconSvg`'s output because the output
 * cannot express the difference that matters: an element with no `stroke`
 * attribute and one with `stroke="none"` both arrive as `strokeWidth: 0`, and
 * only the first should inherit. Tabler's hit-area rect is the second.
 */
const inherit = (svg: string): string => {
  const root = attrsOf(ROOT.exec(svg)?.groups?.attrs ?? "");
  const defaults = INHERITED.filter((k) => root[k] !== undefined);
  if (defaults.length === 0) {
    return svg;
  }
  ELEMENT.lastIndex = 0;
  return svg.replace(ELEMENT, (match: string, ...rest: unknown[]) => {
    const g = rest.at(-1) as { attrs: string; slash: string; tag: string };
    const own = attrsOf(g.attrs);
    const add = defaults
      .filter((k) => own[k] === undefined)
      .map((k) => ` ${k}="${root[k]}"`)
      .join("");
    return add === "" ? match : `<${g.tag}${g.attrs}${add}${g.slash}>`;
  });
};

export interface NormalIcon {
  /** The factor the geometry was multiplied by to reach the 24 grid. 1 for a
   *  set already drawn on it. */
  scale: number;
  shapes: CorpusShape[];
  /** As stated by the file, `[minX, minY, width, height]`, or null when it
   *  states none — in which case nothing is scaled and the numbers are read at
   *  face value. */
  viewBox: number[] | null;
}

/**
 * Every drawn shape of an icon, on the 24 grid.
 *
 * Non-square viewBoxes are scaled by their larger side, which keeps the drawing
 * undistorted at the cost of the shorter axis not filling 24. Every set here is
 * square, so this is a guard rather than a behaviour.
 */
export const normaliseIconSvg = (svg: string): NormalIcon => {
  const vb = viewBoxOf(attrsOf(ROOT.exec(svg)?.groups?.attrs ?? ""));
  const drawn = parseIconSvg(inherit(svg)).filter(
    // Neither filled nor stroked: it draws nothing, whatever its geometry says.
    (s) => s.filled || s.strokeWidth > 0
  );

  const k = vb ? GRID / Math.max(vb[2], vb[3]) : 1;
  if (k === 1 && (!vb || (vb[0] === 0 && vb[1] === 0))) {
    return { scale: 1, shapes: drawn, viewBox: vb };
  }

  const [minX, minY] = vb ?? [0, 0];
  return {
    scale: k,
    shapes: drawn.map((s) => ({
      ...s,
      d: serialise(
        parsePath(s.d)
          .map((sp) => translate(sp, -minX, -minY))
          .map((sp) => scale(sp, k))
      ),
      strokeWidth: s.strokeWidth * k,
    })),
    viewBox: vb,
  };
};

/**
 * The normalised shapes back as an SVG, for the measurers that take source text
 * rather than shapes — `auditIcon` and `parsePieces` both re-parse.
 *
 * Round-tripping rather than passing the original through is what makes those
 * two see the same drawing as everything else: the same inheritance, the same
 * dropped hit-areas, the same grid.
 */
export const canonicalSvg = (shapes: readonly CorpusShape[]): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}">${shapes
    .map(
      (s) =>
        `<path d="${s.d}" fill="${s.filled ? "#000" : "none"}"${
          s.strokeWidth > 0
            ? ` stroke="#000" stroke-width="${s.strokeWidth}" stroke-linecap="${s.cap}"`
            : ""
        }/>`
    )
    .join("")}</svg>`;

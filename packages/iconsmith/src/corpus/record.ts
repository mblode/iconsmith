/**
 * One record per drawn identity.
 *
 * The unit is the *drawing*, not the file. Central ships 2,085 symbols finished
 * 30 ways — 62,550 files — and blode-icons ships each icon outlined and filled.
 * Keying on the file would make `grep folder-open` return 31 hits from one set
 * and answer no question anybody asks. Keying on the identity makes it return
 * one, with every concrete file listed under `renderings`, which is what makes
 * JSONL worth choosing over a database in the first place.
 *
 * Two rules hold this file together.
 *
 * 1. **No I/O.** Everything here takes SVG text and file facts already read by
 *    the caller and returns plain data. That is what lets the record schema be
 *    unit-tested against a string literal, and what keeps `build.ts` the only
 *    thing that touches a disk.
 *
 * 2. **Scalars, short arrays and strings only. Every float vector goes to a
 *    `.f32` sidecar.** A `Fingerprint.norm` is 64 points — 128 floats — and an
 *    ink vector is 2,304. Inlining either turns a ~20 MB greppable file into
 *    ~400 MB of digits with the readable fields buried, which defeats the
 *    format. `measureRendering` therefore returns the vectors *beside* the
 *    record rather than inside it; the writer decides where they land and
 *    stamps the `{file, row}` address back on.
 *
 * Nothing here derives a measurement of its own. Every number comes from a
 * measurer that already exists and is already tested — `measureIcon`,
 * `auditIcon`, `visualExtent`/`nearestKeyline`, `iconEdgeAngles`, `lint`,
 * `cohortOf`, `fingerprint`. A second implementation of any of them is how the
 * corpus and the linter start disagreeing about the same icon.
 */
import { parsePath, PathError } from "../geometry/path.js";
import { fingerprint } from "../parts/shape.js";
import { iconEdgeAngles, offAxisEdges } from "../tools/angle.js";
import type { Conformance } from "../tools/keyline.js";
import {
  conformance,
  nearestKeyline,
  visualExtent as pieceVisualExtent,
} from "../tools/keyline.js";
import { parsePieces } from "../tools/legibility.js";
import { lint } from "../tools/lint.js";
import type { Fingerprint, Keyline } from "../types.js";
import type { CurveClass } from "./audit.js";
import { auditIcon, freeformShare } from "./audit.js";
import type { CorpusShape } from "./load.js";
import { measureIcon } from "./measure.js";
import { canonicalSvg, normaliseIconSvg } from "./normalise.js";

/** Bump when a field changes meaning or disappears. `forge corpus check`
 *  refuses a store built by a different version rather than half-reading it. */
export const RECORD_SCHEMA_VERSION = 1;

/**
 * Where an icon may be used, recorded at the source and never inferred later.
 *
 * `conditioning` is the house set and Central, which the generator may learn
 * from. `analysis-only` is everything under someone else's licence: it may be
 * measured, compared and reported on, and it may not reach the drawer. This
 * field is the truth the type-level gate is built on, so it is written from the
 * source registry and never from the geometry.
 */
export type Usage = "analysis-only" | "conditioning";

export interface RecordProvenance {
  /** Where the set comes from — a homepage or a package name.
   *
   *  Deliberately *not* called `origin`. `Provenance["origin"]` in `types.ts`
   *  is a derivation kind — `central | derived | literal | original` — and
   *  `pipeline/licence.ts` allowlists on it. Two fields called `origin` holding
   *  a URL and an enum is how a bridge between the two silently passes the
   *  wrong one to `asReference`. */
  homepage: string;
  /** SPDX identifier where one exists, else the licence's own name. */
  licence: string;
  /** The source id, repeated inside provenance so a record survives being
   *  lifted out of the file it was read from. */
  set: string;
  usage: Usage;
  version: string | null;
}

/** A float vector's address in a sidecar: which file, which row. Dimension and
 *  row count live in the manifest, so a reader mmaps the file and seeks. */
export interface VectorRef {
  file: string;
  row: number;
}

/** One concrete file. Everything measurable about the drawing as finished in
 *  this variant; nothing that is a property of the identity. */
export interface Rendering {
  angles: {
    /** Straight runs at least `MIN_EDGE` long, in stroked shapes only. */
    edges: number;
    offAxis: number;
    /** Share of `edges` more than `ANGLE_TOLERANCE` from 0/45/90/135. */
    offAxisShare: number;
    /** Worst single deviation, in degrees. 0 when nothing is off-axis. */
    worstOffBy: number;
  };
  bytes: number;
  /** Centre of the visual extent — 12,12 for a perfectly centred icon. */
  centre: [number, number];
  /** Named faults in the file itself, not in the drawing. `nan-path`: a shape
   *  whose path data carries a non-numeric coordinate; it is excluded from
   *  every measurement on this rendering, so the numbers describe what is left
   *  rather than pretending the file was clean. */
  defects: string[];
  curves: {
    byClass: Partial<Record<CurveClass, number>>;
    /** Share of shaped cubics whose control points do not describe an arc. */
    freeform: number;
    total: number;
  };
  /** Visual diameters of circles small enough to read as dots. */
  dots: number[];
  extent: { vx: number; vy: number; x0: number; y0: number };
  /** Address of this rendering's per-subpath fingerprints, `count` rows from
   *  `row`. Only the canonical rendering carries them — see `measureRendering`. */
  fingerprints: (VectorRef & { count: number }) | null;
  gaps: {
    tightest: number | null;
    /** The tightest gap between shapes that are actually apart. Overlaps are
     *  construction, not spacing, and no minimum-gap rule has an opinion. */
    tightestSeparated: number | null;
  };
  grid: { onGrid: number; onHalf: number };
  /** Address of this rendering's ink vector, filled only by the `--vectors`
   *  stage. Null otherwise, so a base build and a vector build differ in this
   *  field alone. */
  ink: VectorRef | null;
  keyline: {
    conformance: Conformance;
    deviation: number;
    nearest: Keyline;
  };
  lint: { errors: number; rules: string[]; warnings: number };
  /** Smallest distance from the visual extent to a canvas edge. */
  margin: number;
  /** Path relative to the source root. Absolute paths would make the store
   *  machine-specific for no gain; the manifest holds the root. */
  path: string;
  quality: {
    /** Linecaps of stroked elements with a visible end. */
    caps: string[];
    /** Smallest end-to-end gap on an open subpath that nearly closes. */
    nearClosedMin: number | null;
    /** Closed contours enclosing no area: outline-expander residue. */
    spurContours: number;
    spurRetraces: number;
  };
  /** Corner radii, deduplicated and sorted. */
  radii: number[];
  /** What the file's own geometry was multiplied by to reach the 24 grid — 8
   *  for Phosphor's 256-unit drawings, 1.6 for Radix's 15. Every other number
   *  on this rendering is post-scale, and this is what says so. */
  scale: number;
  sha256: string;
  shapes: number;
  /** Distinct stroke widths present, sorted. `0` means a filled shape, and
   *  that zero is load-bearing: visual extent is bbox + stroke, per shape. */
  strokes: number[];
  style: "filled" | "mixed" | "outlined";
  subpaths: number;
  /** The variant key this file is the drawing finished in — a corpus variant
   *  key for Central, `outlined`/`filled` for the house set, the pack's own
   *  weight or style name for a third-party pack. */
  variant: string;
}

export interface IconRecord {
  /** Blode's category, where the set states one. */
  category: string | null;
  /** The icons this one swaps with — `cohortOf`, manifest first. */
  cohort: string | null;
  /** The UI intents this icon is the single canonical answer to. Usually 0 or
   *  1; an array because `_concepts.json` maps concept → slug, and a slug is
   *  allowed to answer more than one question. */
  concepts: string[];
  id: string;
  provenance: RecordProvenance;
  renderings: Rendering[];
  schema: number;
  set: string;
  slug: string;
  tags: string[];
}

/** A file the caller has already read, ready to be measured. */
export interface RenderingInput {
  bytes: number;
  /** True for the one rendering that stands for the identity. Only this one is
   *  fingerprinted: a fingerprint describes the *drawing*, and Central's 30
   *  finishes of it would write the same shape to the sidecar 30 times over —
   *  30 × 2,085 × ~3 subpaths × 512 B is 96 MB of duplicate geometry. */
  canonical: boolean;
  /** Relative to the source root. */
  path: string;
  sha256: string;
  svg: string;
  variant: string;
}

export interface MeasuredRendering {
  /** One per subpath of the canonical rendering, in document order; empty
   *  otherwise. The writer appends these to the sidecar and fills in
   *  `rendering.fingerprints`. */
  fingerprints: Fingerprint[];
  rendering: Rendering;
}

/** Four decimal places. At a 24-unit grid that is 1/400th of a stroke width —
 *  far below anything measurable — and it is what makes two builds of an
 *  unchanged tree produce byte-identical files. */
const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const r4s = (ns: number[]): number[] => ns.map(r4);

const distinct = (ns: number[]): number[] =>
  [...new Set(ns.map(r4))].toSorted((a, b) => a - b);

/**
 * True when a shape's path data cannot be parsed.
 *
 * One file in 90,650 cannot: `corpus/round-filled-radius-1-stroke-1.5/burger.svg`
 * ships `...L20.9839 10.5Lnan nanL...`, an export defect in Central's own
 * source. A corpus walk that dies on it dies on the 8,000th file of 62,550 and
 * takes the whole build with it, so the shape is dropped and the rendering says
 * so in `defects`. Dropping it silently would be worse than crashing: the icon
 * would quietly measure as if it had one fewer shape.
 *
 * This is the one place in the codebase that is *meant* to survive malformed
 * path data. Everywhere else a `PathError` should reach the caller: the parser
 * used to hand back NaN coordinates instead of throwing, which is how a
 * three-shape icon measured as two with nothing said about it.
 */
const unparseable = (d: string, source: string): boolean => {
  try {
    parsePath(d, { source });
    return false;
  } catch (error) {
    if (error instanceof PathError) {
      return true;
    }
    throw error;
  }
};

const styleOf = (shapes: CorpusShape[]): Rendering["style"] => {
  const stroked = shapes.some((s) => s.strokeWidth > 0);
  const filled = shapes.some((s) => s.strokeWidth === 0);
  if (stroked && filled) {
    return "mixed";
  }
  return stroked ? "outlined" : "filled";
};

/**
 * Measure one file.
 *
 * The lint elements are built from `parseIconSvg` with each shape's *real*
 * stroke width. Passing a uniform stroke instead makes the `off-axis` rule
 * measure the residue of Figma's outline expander — every filled contour read
 * as a 2-unit stroke — rather than anyone's drawing, and that alone drags
 * apparent conformance across the corpus from ~85% to ~70%.
 */
export const measureRendering = (input: RenderingInput): MeasuredRendering => {
  const normal = normaliseIconSvg(input.svg);
  const shapes = normal.shapes.filter((s) => !unparseable(s.d, input.path));
  const defects = shapes.length === normal.shapes.length ? [] : ["nan-path"];
  // Every measurer that re-parses source text gets the *normalised* drawing,
  // so `auditIcon` and `parsePieces` see the same shapes, grid and stroke
  // widths as `measureIcon` rather than the file's own conventions.
  const svg = canonicalSvg(shapes);
  // `measureIcon` reads nothing off the variant; it is on `CorpusIcon` for
  // callers that carry one, and a third-party pack file has none to give.
  const variant = {
    corner: "round" as const,
    key: input.variant,
    radius: 0,
    stroke: 0,
    style: "outlined" as const,
  };
  const measured = measureIcon({ shapes, symbol: input.path, variant });
  const audit = auditIcon(input.path, svg);

  // Stroked shapes only. An outline-expanded fill has no edges in the sense
  // this rule means, and counting its contour would report the expander.
  const strokedPaths = shapes.filter((s) => s.strokeWidth > 0).map((s) => s.d);
  const edges = iconEdgeAngles(strokedPaths);
  const off = offAxisEdges(edges);

  // 1 is SVG's own default `stroke-width`, and `canonicalSvg` always states a
  // width on anything stroked, so the fallback is never reached.
  const pieces = parsePieces(svg, 1);
  const extent = pieceVisualExtent(pieces);
  const near = nearestKeyline(extent.vx, extent.vy);

  const issues = lint({
    elements: shapes.map((s, i) => ({
      d: s.d,
      id: `${i}`,
      strokeWidth: s.strokeWidth,
    })),
  });

  const byClass: Partial<Record<CurveClass, number>> = {};
  for (const c of audit.curves) {
    byClass[c.cls] = (byClass[c.cls] ?? 0) + 1;
  }

  const nearClosed = audit.nearClosed.map((n) => n.gap);

  const fingerprints = input.canonical
    ? shapes
        .flatMap((s) => parsePath(s.d, { source: input.path }))
        .map(fingerprint)
    : [];

  return {
    fingerprints,
    rendering: {
      angles: {
        edges: edges.length,
        offAxis: off.length,
        offAxisShare: edges.length === 0 ? 0 : r4(off.length / edges.length),
        worstOffBy: r4(Math.max(0, ...off.map((e) => e.offBy))),
      },
      bytes: input.bytes,
      centre: [r4(measured.centre[0]), r4(measured.centre[1])],
      curves: {
        byClass,
        freeform: r4(freeformShare(audit.curves)),
        total: audit.curves.length,
      },
      defects,
      dots: r4s(measured.dots),
      extent: {
        vx: r4(extent.vx),
        vy: r4(extent.vy),
        x0: r4(extent.x0),
        y0: r4(extent.y0),
      },
      fingerprints: null,
      gaps: {
        tightest:
          measured.tightestGap === null ? null : r4(measured.tightestGap),
        tightestSeparated:
          measured.tightestSeparated === null
            ? null
            : r4(measured.tightestSeparated),
      },
      grid: { onGrid: r4(measured.onGrid), onHalf: r4(measured.onHalf) },
      ink: null,
      keyline: {
        conformance: conformance(near.deviation),
        deviation: r4(near.deviation),
        nearest: near.nearest,
      },
      lint: {
        errors: issues.filter((i) => i.severity === "error").length,
        rules: [...new Set(issues.map((i) => i.rule))].toSorted(),
        warnings: issues.filter((i) => i.severity === "warn").length,
      },
      margin: r4(measured.margin),
      path: input.path,
      quality: {
        caps: [...new Set(audit.caps)].toSorted(),
        nearClosedMin:
          nearClosed.length === 0 ? null : r4(Math.min(...nearClosed)),
        spurContours: audit.spurContours,
        spurRetraces: audit.spurRetraces,
      },
      radii: distinct(measured.radii),
      scale: r4(normal.scale),
      sha256: input.sha256,
      shapes: shapes.length,
      strokes: distinct(measured.strokes),
      style: styleOf(shapes),
      subpaths: audit.subpaths,
      variant: input.variant,
    },
  };
};

export interface RecordInput {
  category?: string | null;
  cohort?: string | null;
  concepts?: string[];
  provenance: RecordProvenance;
  renderings: Rendering[];
  set: string;
  slug: string;
  tags?: string[];
}

/**
 * Assemble one identity's record. Renderings are sorted by variant so two
 * builds that walked the directory in different orders still produce the same
 * line.
 */
export const buildRecord = (input: RecordInput): IconRecord => ({
  category: input.category ?? null,
  cohort: input.cohort ?? null,
  concepts: [...(input.concepts ?? [])].toSorted(),
  id: `${input.set}/${input.slug}`,
  provenance: input.provenance,
  renderings: [...input.renderings].toSorted((a, b) =>
    a.variant.localeCompare(b.variant)
  ),
  schema: RECORD_SCHEMA_VERSION,
  set: input.set,
  slug: input.slug,
  tags: [...(input.tags ?? [])].toSorted(),
});

/**
 * `JSON.stringify` with keys in sorted order at every depth.
 *
 * Insertion order would do for records this file builds, but not for one that
 * has been copied forward from a previous build, merged, or hand-edited — and
 * "the store is diffable" is only true if it survives all three. Sorting is one
 * line and makes the claim unconditional.
 */
export const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

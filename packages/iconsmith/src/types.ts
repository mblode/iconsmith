/**
 * The shared contract. Every module in the pipeline speaks these types, so they
 * live here rather than beside whichever module happened to need one first.
 */

/** A parsed path segment. Quadratics are elevated to cubics on parse, so only
 *  these three forms exist downstream. Arcs are preserved rather than
 *  approximated — there are few of them and silently distorting them would be
 *  invisible in review. */
export type Segment =
  | { t: "L"; p: [number, number] }
  | { t: "C"; p: [number, number, number, number, number, number] }
  | { t: "A"; p: [number, number, number, number, number, number, number] };

export interface Subpath {
  closed: boolean;
  segs: Segment[];
  start: [number, number];
}

export interface Box {
  h: number;
  w: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** A shape's comparable form: resampled, position- and scale-normalised. */
export interface Fingerprint {
  aspect: number;
  bbox: Box;
  closed: boolean;
  curves: number;
  nodes: number;
  norm: [number, number][];
  size: number;
}

/** One entry in the extracted vocabulary. `name` is assigned later by a vision
 *  pass; nothing can reason about `p0031`, everything can reason about `cloud`. */
export interface Part {
  closed: boolean;
  d: string;
  /** How many instances the set draws unmirrored (index 0) and mirrored
   *  (index 1) relative to `d`. The clusterer folds a mark and its reflection
   *  into one part — a cube's two faces, a basket's two sides — so this is what
   *  says whether the *set* ever mirrors this mark. Evidence, not permission:
   *  a placement must still ask for `flip` by name, because reflection is the
   *  one symmetry that can be simply wrong (a check mark, a comma, an `S`).
   *  Optional for the same reason as `turns`: a hand-written part has none. */
  flips?: [number, number];
  h: number;
  icons: string[];
  id: string;
  instances: number;
  name?: string;
  nodes: number;
  sizeRange: [number, number];
  /** How many instances the set draws at each clockwise quarter-turn of `d` —
   *  index 1 is 90° clockwise, 2 is upside down, 3 is 90° anticlockwise. It is
   *  evidence, not permission: a placement may use any turn, but this is the
   *  one thing that says whether the *set* does. Optional because a hand-written
   *  part has no measured orientations; the extractor always fills it. */
  turns?: [number, number, number, number];
  w: number;
}

export type Keyline =
  | "circle"
  | "landscape"
  | "portrait"
  | "square"
  | "tall"
  | "wide";
export type DotRole = "floating" | "more" | "node" | "terminal";

/** The document format: a recipe, not a rendering. Diffable, re-renderable at
 *  any stroke width, and a `part` is a reference so editing the part updates
 *  every icon that uses it. `raw` is the fidelity escape hatch for geometry the
 *  primitives cannot express. */
/**
 * How an icon puts ink down: stroked skeleton, or solid shape.
 *
 * A property of the document, never of an element — 2,078 of the 2,085 filled
 * icons measured in `bench/filled-language.v1.json` carry no stroke anywhere,
 * so a mixture is the set being inconsistent rather than a construction the
 * language should offer. See `CanvasOptions.finish` for the full argument.
 */
export type Finish = "filled" | "outlined";

export type DrawOp =
  | {
      /** Present when the arc runs counter-clockwise. Absent, not `false`,
       *  when it follows `circle` (top → right → bottom → left). */
      ccw?: true;
      cx: number;
      cy: number;
      from: "bottom" | "left" | "right" | "top";
      op: "arc";
      r: number;
      sweep: "half" | "quarter" | "three-quarter";
    }
  | {
      cx: number;
      cy: number;
      /** Present when this shape is cut out of the solid before it rather than
       *  drawn as ink of its own. Absent, not `false`, when it is not — like
       *  `offAxis` and `flip`, the key appears with the geometry. Only legal
       *  under a filled `finish`: there is no solid to cut in a stroked icon. */
      knockout?: true;
      op: "circle";
      r: number;
    }
  | {
      cx: number;
      cy: number;
      /** Centre to vertex, as asked for. The filled paint pads it by half a
       *  stroke so both paints occupy one visual extent; that padding is ink
       *  and is re-derived on replay rather than stored. */
      op: "diamond";
      reach: number;
    }
  | { cx: number; cy: number; op: "dot"; role: DotRole }
  | { d: string; fillRule?: "nonzero"; op: "raw" }
  | {
      h: number;
      /** See the note on `circle`. */
      knockout?: true;
      op: "rect";
      r: number;
      w: number;
      x: number;
      y: number;
    }
  | {
      /** Present when the part was reflected in x before being turned.
       *  Absent, not `false`, when it was not — like `line`'s `offAxis`, the
       *  key appears with the geometry, so a diff showing `flip` shows a real
       *  change of chirality rather than a change of how it was requested. */
      flip?: true;
      id: string;
      op: "part";
      scale: number;
      /** Clockwise quarter-turns, 0-3. A closed set, never a free angle. */
      turn: number;
      x: number;
      y: number;
    }
  | {
      /** See the note on `circle`. A line knockout is the filled bar of that
       *  stroke subtracted — a tick cut out of a badge, not a free path. */
      knockout?: true;
      /** Present when a segment sits off every permitted axis. Off-axis edges
       *  are legitimate — 29.3% of the set's stroked icons have one, on
       *  rational slopes between two grid points — but the canvas refuses them
       *  unless asked, so this is what records that they were. Absent, not
       *  `false`, when the line is axial: the key appears with the geometry. */
      offAxis?: boolean;
      op: "line";
      points: [number, number][];
    };

export interface IconDoc {
  draw: DrawOp[];
  /** Absent means `outlined`, which is what every document written before fill
   *  mode existed is — so the key appears only on the icons that need it. */
  finish?: Finish;
  icon: string | null;
  keyline: Keyline | null;
  provenance?: Provenance;
}

/** Captured at import time because it cannot be reconstructed afterwards: once
 *  geometry has been conformed, nothing in it says where it came from. */
export interface Provenance {
  date: string;
  icon?: string;
  licenses?: string[];
  origin: "central" | "derived" | "literal" | "original";
  set?: string;
  version?: string;
}

export type Severity = "error" | "warn";

export interface Issue {
  /**
   * The DSL modifier the program used to ask for the geometry this finding is
   * about, when there is one — today only `off-axis`.
   *
   * It does not lower the severity. A declared diagonal is still a `warn`,
   * because a `warn` *is* the request to confirm a choice was deliberate, and
   * the declaration is the choice rather than the confirmation. What it changes
   * is who the finding is addressed to: an undeclared finding asks for a fix,
   * a declared one asks a reviewer to agree.
   */
  declared?: string;
  message: string;
  rule: string;
  severity: Severity;
}

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
export type DrawOp =
  | { cx: number; cy: number; op: "circle"; r: number }
  | { cx: number; cy: number; op: "dot"; role: DotRole }
  | { d: string; op: "raw" }
  | { h: number; op: "rect"; r: number; w: number; x: number; y: number }
  | {
      id: string;
      op: "part";
      scale: number;
      /** Clockwise quarter-turns, 0-3. A closed set, never a free angle. */
      turn: number;
      x: number;
      y: number;
    }
  | {
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
  message: string;
  rule: string;
  severity: Severity;
}

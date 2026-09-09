/**
 * Finish-aware marks: the same icon in outlined and filled.
 *
 * A two-point `line` under `finish filled` is that stroke expanded: axis
 * aligned becomes a 2-wide `rect`, a diagonal a stadium of the same width.
 * A ring is a `circle` when stroked and a `circle` plus `hole` when filled.
 * The composer writes both programs; the model never emits a coordinate.
 */
import { frame, hbar, mass, program, ring, vbar } from "../tools/twin.js";
import type { Finish } from "../types.js";

const plus = (slug: string, finish: Finish): string =>
  program(slug, finish, "square", [
    hbar(finish, 4, 12, 16),
    vbar(finish, 12, 4, 16),
  ]);

const minus = (slug: string, finish: Finish): string =>
  // A lone `line` is a hairline: lint's substance rule exists because the
  // set's `minus` family is the only icon whose subject *is* a bar. A 2-tall
  // rounded rect has no inner hole after the stroke, so it reads as a solid
  // segment rather than a pill. Filled is that rect expanded by half a stroke.
  program(slug, finish, null, [mass(finish, 4, 11, 16, 2, 1)]);

const equal = (slug: string, finish: Finish): string =>
  // A bar pair is not a keyline. Claiming square would error: declared
  // miss is an error, an undeclared miss is a warning.
  program(slug, finish, null, [
    hbar(finish, 4, 9, 16),
    hbar(finish, 4, 15, 16),
  ]);

const hamburgerMenu = (slug: string, finish: Finish): string =>
  // House `bars-three` parks the three strokes on the 6-unit grid
  // (y=6/12/18), not a compressed 8-unit stack. Width stays 4–20 so
  // the 2-unit live margin still holds; the miss was vertical span.
  program(slug, finish, null, [
    hbar(finish, 4, 6, 16),
    hbar(finish, 4, 12, 16),
    hbar(finish, 4, 18, 16),
  ]);

const moreVertical = (slug: string, finish: Finish): string =>
  program(slug, finish, null, [
    "dot 12,6 node",
    "dot 12,12 node",
    "dot 12,18 node",
  ]);

const viewGrid = (slug: string, finish: Finish): string =>
  // 6×6 r2 at 4 and 14: a 4-unit gutter so the 2-unit stroke still leaves a
  // gap at 24px, and the tiles stay squares rather than 5×5 discs. Path bbox
  // is 16, square keyline 18, so fit is identity (k=1) and the two paints
  // stay on the same 0.25 snaps.
  program(slug, finish, "square", [
    mass(finish, 4, 4, 6, 6, 2),
    mass(finish, 14, 4, 6, 6, 2),
    mass(finish, 4, 14, 6, 6, 2),
    mass(finish, 14, 14, 6, 6, 2),
  ]);

const battery = (slug: string, finish: Finish): string =>
  // Cap sits on the body's right edge (x=18). Outlined is a tall `frame`
  // (3×6 slit) so it does not read as a tag. Filled is the same outer as
  // a solid nub: a hollow filled terminal collapses at 24px. Body is a
  // `mass` in both paints.
  program(slug, finish, null, [
    mass(finish, 3, 8, 15, 8, 2),
    ...(finish === "filled"
      ? [mass("filled", 18, 9, 3, 6, 1)]
      : frame("outlined", 18, 9, 3, 6, 1)),
    "center",
  ]);

const ban = (slug: string, finish: Finish): string =>
  program(slug, finish, "square", [
    ...ring(finish, 12, 12, 8),
    "line 6,6 18,18 off-axis",
  ]);

const timeline = (slug: string, finish: Finish): string =>
  // Nodes sit in the gaps, not on the bar: a line through discs merges into
  // a barbell at 24px. `node` (4) is larger than the 2-unit stroke so the
  // beads read; hollow rings cut crescents. Outer nodes are the ends.
  program(slug, finish, null, [
    hbar(finish, 8, 12, 1),
    hbar(finish, 15, 12, 1),
    "dot 5,12 node",
    "dot 12,12 node",
    "dot 19,12 node",
  ]);

const flag = (slug: string, finish: Finish): string =>
  // Fly sits below the pole top so the mark reads as a flag, not a P.
  // Unrounded so a radius cannot bump through the stem. Filled expands the
  // fly on the free sides only — a full `mass` would swallow half the pole.
  program(slug, finish, null, [
    vbar(finish, 6, 4, 16),
    finish === "filled" ? "rect 7,6 12x10" : "rect 7,6 11x8",
  ]);

export const MARKS = {
  ban,
  battery,
  equal,
  flag,
  "hamburger-menu": hamburgerMenu,
  minus,
  "more-vertical": moreVertical,
  plus,
  timeline,
  "view-grid": viewGrid,
} as const;

export type MarkName = keyof typeof MARKS;

export const MARK_NAMES = Object.keys(MARKS) as MarkName[];

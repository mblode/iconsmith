/**
 * Host object constructions: the same icon in outlined and filled.
 *
 * MARKS are the ten net-new twins with no house file. These are unkeyed
 * objects the agent loop has been hired to draw — compass, microscope,
 * wifi — and got wrong in ways lint already names: a diamond off 45°,
 * a 0.50px gap, a wifi fan that drifted to 20×11.5. The composer writes
 * both programs; the model never emits a coordinate.
 *
 * Reach draws these before hiring an agent, the same "host DRAW first"
 * rule MARKS already enjoy. `--agent` still skips them.
 */
import {
  fan,
  frame,
  hbar,
  lozenge,
  mass,
  program,
  ring,
  vbar,
} from "../tools/twin.js";
import type { Finish } from "../types.js";

export const compass = (slug: string, finish: Finish): string =>
  // Circle on the 20×20 keyline (r=9 + stroke). Needle is a true 45°
  // lozenge — equal run and rise — so every edge sits on 135°. A kite
  // that is only grid-legal (the 114.4°/155.6° needle) is 20.6° off.
  program(slug, finish, "circle", [
    ...ring(finish, 12, 12, 9),
    ...lozenge(finish, 12, 12, 5),
  ]);

export const microscope = (slug: string, finish: Finish): string =>
  // Optical stack on tall 16×20. Neighbours clear 1px on the centre-line
  // so flatten cannot report a 0.50px almost-touch. Portrait 18×20 would
  // push the stage to x=3–21, and that ink sits in the 4×4 corners the
  // panel caps at 2%. Tall keeps x at 4–20 — width 16, corners empty.
  program(slug, finish, "tall", [
    ...ring(finish, 12, 5, 2),
    mass(finish, 10.5, 8, 3, 6, 1),
    ...ring(finish, 12, 17, 2),
    hbar(finish, 5, 20.5, 14),
  ]);

export const wifi = (slug: string, finish: Finish): string =>
  // Upper semicircles of r=9/6/3 at cy=14 plus a terminal at y=19.
  // Path 18×14 + stroke → visual 20×16, the wide keyline, chosen rather
  // than the 20×11.5 a lone semicircle drifts to. Δr=3 so the ink gap
  // is exactly minGap.
  program(slug, finish, "wide", [
    ...fan(finish, 12, 14, [9, 6, 3]),
    "dot 12,19 terminal",
  ]);

export const briefcase = (slug: string, finish: Finish): string =>
  // Case on landscape 20×18: a frame for the body, a clasp bar across it, and
  // the handle as three bars rather than one polyline — a polyline encloses
  // nothing under fill, so writing it as bars means both paints run the same
  // ops. The handle's feet land on the body's top edge, which is coincident
  // rather than close, and `gap` only measures pairs that are apart.
  program(slug, finish, "landscape", [
    ...frame(finish, 3, 9, 18, 11, 2),
    vbar(finish, 9, 5, 4),
    hbar(finish, 9, 5, 6),
    vbar(finish, 15, 5, 4),
    hbar(finish, 3, 13, 18),
  ]);

export const cake = (slug: string, finish: Finish): string =>
  // Body on wide 20×16, three candles on the 4-unit grid, three flames as
  // floating dots. A dot has no straight edge, so the flames cost nothing in
  // `off-axis`, and the candles clear the body by a unit on the centre-line.
  program(slug, finish, "wide", [
    ...frame(finish, 3, 13, 18, 6, 3),
    vbar(finish, 7, 8, 3),
    vbar(finish, 12, 8, 3),
    vbar(finish, 17, 8, 3),
    "dot 7,5.5 floating",
    "dot 12,5.5 floating",
    "dot 17,5.5 floating",
  ]);

export const cookie = (slug: string, finish: Finish): string =>
  // Ring on the 20×20 circle keyline with four floating chips. The chips sit
  // on the 45° diagonals at radius 4.24, which clears the ring's inner ink by
  // more than a unit — the control case for a punched filled ring.
  program(slug, finish, "circle", [
    ...ring(finish, 12, 12, 9),
    "dot 9,9 floating",
    "dot 15,9 floating",
    "dot 9,15 floating",
    "dot 15,15 floating",
  ]);

export const database = (slug: string, finish: Finish): string =>
  // Three stacked platters on portrait 18×20, 3 units apart on the
  // centre-line so the ink gap is exactly `minGap`. Equal sizes on purpose: a
  // stack that tapers reads as a cup, not a store.
  program(slug, finish, "portrait", [
    ...frame(finish, 4, 3, 16, 4, 2),
    ...frame(finish, 4, 10, 16, 4, 2),
    ...frame(finish, 4, 17, 16, 4, 2),
  ]);

export const fingerprint = (slug: string, finish: Finish): string =>
  // Three concentric upper arcs on the 20×20 circle keyline, with the core
  // ridge running down from the centre. Δr=3 puts the ink gap at `minGap`;
  // the ridge starts on the centre, 3 units clear of the innermost arc's ends.
  program(slug, finish, "circle", [
    ...fan(finish, 12, 12, [9, 6, 3]),
    vbar(finish, 12, 12, 9),
  ]);

export const strikethrough = (slug: string, finish: Finish): string =>
  // A letterform crossed by the strike, on wide 20×16. The strike is one bar
  // over the full width so it reads as struck rather than underlined, and it
  // crosses the stem rather than notching it — a crossing is ink over ink,
  // which is what `cut` exists to tell apart from a gap.
  program(slug, finish, "wide", [
    hbar(finish, 6, 5, 12),
    vbar(finish, 12, 5, 14),
    hbar(finish, 3, 12, 18),
  ]);

export const umbrella = (slug: string, finish: Finish): string =>
  // Canopy as one upper half-arc on landscape 20×18, stem down the centre,
  // hook as a foot bar meeting the stem end. Both meet at a point rather than
  // near one, so the pair is coincident and `gap` has nothing to measure.
  program(slug, finish, "landscape", [
    ...fan(finish, 12, 12, [9]),
    vbar(finish, 12, 12, 7),
    hbar(finish, 8, 19, 4),
  ]);

export const GLYPHS = {
  briefcase,
  cake,
  compass,
  cookie,
  database,
  fingerprint,
  microscope,
  strikethrough,
  umbrella,
  wifi,
} as const;

export type GlyphName = keyof typeof GLYPHS;

export const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[];

/** Why the host wrote this object this way. The view shows it as the brief
 *  when a sidecar was never written — success-path reasoning, not a failure. */
export const GLYPH_WHY: Record<GlyphName, string> = {
  briefcase:
    "Frame body on landscape 20×18 with a clasp bar across it. The handle is three bars, not one polyline — a polyline encloses nothing under fill, so bars keep both paints on the same ops.",
  cake: "Stadium body on wide 20×16, three candles on the 4-unit grid, three flames as floating dots. A dot has no straight edge, so the flames cost nothing in off-axis.",
  compass:
    "Circle on the 20×20 keyline. The needle is a true 45° lozenge (equal run and rise), so every edge sits on 135° — a kite that is only grid-legal sits 20.6° off.",
  cookie:
    "Ring on the 20×20 circle keyline with four floating chips on the 45° diagonals, clear of the ring's inner ink by more than a unit.",
  database:
    "Three equal platters on portrait 18×20, 3 units apart on the centre-line so the ink gap is exactly minGap. A stack that tapers reads as a cup, not a store.",
  fingerprint:
    "Three concentric upper arcs on the 20×20 circle keyline with the core ridge running down from the centre. Δr=3 puts the ink gap at minGap.",
  microscope:
    "Optical stack on the tall 16×20 keyline. Neighbours clear 1px on the centre-line; the stage stays at x=4–20 so ink does not enter the 4×4 corners the panel caps at 2%.",
  strikethrough:
    "A letterform crossed by a full-width strike on wide 20×16. The strike crosses the stem rather than notching it — a crossing is ink over ink, which is what `cut` exists to tell apart from a gap.",
  umbrella:
    "Canopy as one upper half-arc on landscape 20×18, stem down the centre, hook as a foot bar meeting the stem's end. They meet at a point, so gap has nothing to measure.",
  wifi: "Upper semicircles r=9/6/3 at (12,14) plus a terminal at y=19. Path 18×14 + stroke is 20×16, the wide keyline, chosen rather than a drifted 20×11.5 fan.",
};

export const isGlyphName = (name: string): name is GlyphName =>
  Object.hasOwn(GLYPHS, name);

/** `compass-filled` → `{ finish: "filled", glyph: "compass" }`. */
export const glyphFromSlug = (
  slug: string
): { finish: Finish; glyph: GlyphName } | null => {
  const filled = slug.endsWith("-filled");
  const stem = filled ? slug.slice(0, -"-filled".length) : slug;
  if (!isGlyphName(stem)) {
    return null;
  }
  return { finish: filled ? "filled" : "outlined", glyph: stem };
};

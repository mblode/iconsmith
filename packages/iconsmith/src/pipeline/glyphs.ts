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
import { fan, hbar, lozenge, mass, program, ring } from "../tools/twin.js";
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

export const GLYPHS = {
  compass,
  microscope,
  wifi,
} as const;

export type GlyphName = keyof typeof GLYPHS;

export const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[];

/** Why the host wrote this object this way. The view shows it as the brief
 *  when a sidecar was never written — success-path reasoning, not a failure. */
export const GLYPH_WHY: Record<GlyphName, string> = {
  compass:
    "Circle on the 20×20 keyline. The needle is a true 45° lozenge (equal run and rise), so every edge sits on 135° — a kite that is only grid-legal sits 20.6° off.",
  microscope:
    "Optical stack on the tall 16×20 keyline. Neighbours clear 1px on the centre-line; the stage stays at x=4–20 so ink does not enter the 4×4 corners the panel caps at 2%.",
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

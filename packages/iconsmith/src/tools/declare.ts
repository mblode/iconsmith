/**
 * Declare the keyline a program actually occupies, or declare none.
 *
 * `keylineIssue` holds a *declared* keyline to an **error**, because an icon
 * that states an intent and misses it is a contradiction inside one document.
 * Declaring none and matching none is a **warn** — off-keyline is legal, since
 * Central's key shapes are guidelines. So the rung only works if whatever
 * writes the `keyline` line measures before it claims, and three separate
 * writers had each decided they could skip that:
 *
 * - `compileIcon` wrote `keyline square` on every keyed compile, which failed
 *   `fingerprint` at 18.5×19.8 for missing a box it had never been aimed at.
 * - `replay` appended `keyline square` to every analog, on the reasoning that
 *   an analog ends in `fit` and so keeps the promise. `fit` scales content into
 *   the live area and preserves its aspect, so it makes nothing square that was
 *   not: a 3-node fan fits at 18.0×15.5 and the promise breaks.
 * - `hub` hardcoded `keyline square` beside geometry measuring 18.0×15.5.
 *
 * All three are the same mistake, so this is the one place that gets to make
 * the claim. A program routed through here either names the keyline it measures
 * or names none, and both are honest.
 */
import type { Part } from "../types.js";
import { run as runDsl } from "./dsl.js";
import { declarableKeyline } from "./lint.js";
import { visualSize } from "./twin.js";

/** A program with its keyline declaration reconciled against its geometry, and
 *  the run that measured it — returned so a caller does not draw twice. */
export interface Declared {
  program: ReturnType<typeof runDsl>;
  source: string;
}

/**
 * Draw `bare`, measure it, and splice in the keyline it earns.
 *
 * A program that already declares one is left alone: the declaration is then
 * the author's claim and `keylineIssue` is the right thing to check it with.
 * A program that fails to run is returned as it is, because an extent measured
 * from a refused drawing is not a measurement.
 */
export const declareKeyline = (
  bare: string,
  slug: string,
  parts: readonly Part[] = []
): Declared => {
  const first = runDsl(bare, [...parts]);
  if (first.errors.length > 0 || /^keyline\b/mu.test(bare)) {
    return { program: first, source: bare };
  }
  const extent = visualSize(first.canvas);
  const keyline =
    extent === null ? null : declarableKeyline(extent.w, extent.h);
  if (keyline === null) {
    return { program: first, source: bare };
  }
  // Spliced after `icon`, where the grammar wants it. Geometrically inert, so
  // the drawing measured above is still the drawing.
  const source = bare.replace(
    `icon ${slug}\n`,
    `icon ${slug}\nkeyline ${keyline}\n`
  );
  return { program: runDsl(source, [...parts]), source };
};

/**
 * Badge combinator: two house drawings, one program.
 *
 * Most of the inventory gap is `base-modifier` (`folder-clock`, `user-plus`).
 * The body is already in the set; the badge is too. Asking an agent to
 * rediscover both and composite them is the hivemind. Scaling the badge onto
 * the bottom-right slot and compiling the concatenated paths is a host
 * coordinate — `canvas.ts` still places — and the house files remain the
 * authors of the geometry.
 */
import {
  bbox,
  parsePath,
  scale,
  serialise,
  translate,
} from "../geometry/path.js";

/** Visual span of the badge after scale, in design units. */
const BADGE = 8;
/** Top-left of that 8×8 box. Live margin is 2; 14+8=22. */
const SLOT = 14;

/**
 * Longest house prefix whose remainder is also a house slug.
 *
 * `folder-clock` → folder × clock. `user-add-left` prefers `user-add` × `left`
 * when that pair exists, else walks left until one does.
 */
export const splicePair = (
  name: string,
  hasHouse: (slug: string) => boolean
): { badge: string; base: string } | null => {
  const bits = name.split("-");
  if (bits.length < 2) {
    return null;
  }
  for (let i = bits.length - 1; i >= 1; i -= 1) {
    const base = bits.slice(0, i).join("-");
    const badge = bits.slice(i).join("-");
    if (hasHouse(base) && hasHouse(badge)) {
      return { badge, base };
    }
  }
  return null;
};

/** Body paths plus the badge scaled into the bottom-right slot. */
export const splicePaths = (
  body: readonly string[],
  badge: readonly string[]
): string[] => {
  const sps = badge.flatMap((d) => parsePath(d));
  if (sps.length === 0) {
    return [...body];
  }
  const box = bbox(sps);
  const span = Math.max(box.w, box.h, 1e-6);
  const k = BADGE / span;
  const placed = sps.map((sp) => {
    const sized = scale(sp, k, box.x0, box.y0);
    return translate(sized, SLOT - box.x0, SLOT - box.y0);
  });
  return [...body, ...placed.map((sp) => serialise([sp]))];
};

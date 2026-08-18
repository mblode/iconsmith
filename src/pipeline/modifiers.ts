/**
 * Modifier consistency: do the badges the set already ships agree with each
 * other?
 *
 * The coverage gap is mostly base + modifier — `file-lock`, `folder-check`,
 * `user-remove` — so generating it is only safe once there is a canonical
 * answer for "how big is a badge, where does it sit, how much clear space does
 * it get". This derives that answer from the shipped set, and reports where the
 * shipped set disagrees with itself.
 *
 * **How a badge is isolated.** Not by recognising it: a plus and a check share
 * no geometry, and a badge drawn tomorrow would be invisible to a matcher keyed
 * on the ones drawn today. Not by subtracting the base either, which was the
 * first attempt and is wrong for a reason worth recording — *badging redraws
 * the base*. `user` draws its shoulders as one closed path 13.8 wide; `user-add`
 * redraws them as an open path 8.0 wide to clear the badge. Subtracting shared
 * geometry therefore captures the redrawn base along with the badge, and
 * reports a 19×18 "badge" on a 24×24 canvas.
 *
 * What actually separates a badge from its base is ink: a badge is a mark that
 * does not touch the thing it modifies. So the icon is split into
 * single-linkage clusters of touching strokes, and the badge is the small
 * cluster standing apart. That needs no base to ship — and none does: there is
 * no `file`, `folder`, `square` or `list` icon in the corpus.
 *
 * Fingerprinting still earns its place, one level up: clustering says *where*
 * the badge is, and `parts/shape.js` says whether two instances of `-add` are
 * the same plus or two different ones.
 *
 * **Visual extent, not path bbox.** Every measurement is path bounds inflated
 * by the stroke, half per side. A badge measured as a path bbox reads 2px
 * smaller than it looks, which on an 8px badge is a quarter of it.
 */
import type { Corpus, CorpusIcon } from "../corpus/load.js";
import { bbox, parsePath } from "../geometry/path.js";
import { distance, fingerprint, flatten, resample } from "../parts/shape.js";
import type { Cohort, CohortMember } from "../tools/cohort.js";
import { buildCohorts, drift, splits } from "../tools/cohort.js";
import type { Box, Fingerprint, Subpath } from "../types.js";

/**
 * Centre-line distance below which two strokes are one mark.
 *
 * Two 2px strokes whose centre lines are 0.5px apart overlap heavily — they
 * read as one shape, not two. This is deliberately tight: the question a badge
 * poses is whether it stands clear, and a loose threshold would merge a badge
 * into the base it is meant to be clear of.
 */
const TOUCHING = 0.5;
/** Points per polyline when measuring separation. A straight `L` segment
 *  flattens to its two endpoints, so two crossing strokes measure 4px apart
 *  unless the line itself is resampled — which cost an hour to find. */
const SAMPLES = 64;
const FLATTEN = 8;
/**
 * Largest share of the icon's area a cluster may cover and still be a badge.
 *
 * Above this the icon was redrawn or split into equal parts (`user-duo`), and
 * calling the smaller half a badge would put a 19×18 entry in a table of 8×8s.
 * Two equal halves each cover ~45%, so the cap sits below that rather than at
 * it; the largest real badge measured (`cursor`, 11.25×11.25) covers 32%.
 */
const BADGE_MAX_SHARE = 0.35;
/** Beyond this a badge is really an overlay: `-off` draws a slash across the
 *  whole icon, which is a different design element with different rules. */
const OVERLAY_MIN_SPAN = 14;
/** Families smaller than this have no convention to hold. */
const MIN_FAMILY = 3;
/** Distance from the canvas centre before a badge counts as being on a side. */
const SLOT_TOLERANCE = 3;
const CENTRE = 12;

type Point = [number, number];

export interface Element {
  path: Subpath;
  points: Point[];
  stroke: number;
}

export const elementsOf = (icon: CorpusIcon): Element[] =>
  icon.shapes.flatMap((shape) =>
    parsePath(shape.d).map((path) => ({
      path,
      points: resample(flatten(path, FLATTEN), SAMPLES),
      stroke: shape.strokeWidth,
    }))
  );

/** Closest approach between two point sets. */
const nearest = (a: Point[], b: Point[]): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const [x, y] of a) {
    for (const [u, v] of b) {
      const d = (x - u) ** 2 + (y - v) ** 2;
      if (d < best) {
        best = d;
      }
    }
  }
  return Math.sqrt(best);
};

export interface Cluster {
  centre: Point;
  elements: Element[];
  /** Visual extent: path bounds plus the stroke, half per side. */
  extent: Box;
}

/** Inflate path bounds to the visual extent a reader sees. */
const visualExtent = (b: Box, stroke: number): Box => ({
  h: b.h + stroke,
  w: b.w + stroke,
  x0: b.x0 - stroke / 2,
  x1: b.x1 + stroke / 2,
  y0: b.y0 - stroke / 2,
  y1: b.y1 + stroke / 2,
});

/**
 * Split an icon into marks: groups of strokes that touch, by single linkage.
 * Smallest first, so the badge candidate is at the head.
 */
export const clusterIcon = (elements: Element[]): Cluster[] => {
  const parent = elements.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) {
      root = parent[root];
    }
    parent[i] = root;
    return root;
  };
  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      if (nearest(elements[i].points, elements[j].points) <= TOUCHING) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, Element[]>();
  for (const [i, e] of elements.entries()) {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), e]);
  }
  return [...groups.values()]
    .map((group) => {
      const raw = bbox(group.map((e) => e.path));
      const extent = visualExtent(raw, group[0].stroke);
      return {
        centre: [raw.x0 + raw.w / 2, raw.y0 + raw.h / 2] as Point,
        elements: group,
        extent,
      };
    })
    .toSorted((a, b) => a.extent.w * a.extent.h - b.extent.w * b.extent.h);
};

export type Anchor =
  | "bottom"
  | "bottom-left"
  | "bottom-right"
  | "centre"
  | "left"
  | "right"
  | "top"
  | "top-left"
  | "top-right";

/**
 * Which slot a badge occupies. Nine slots rather than four corners, because
 * `folder-add-left` and `folder-add-right` are a deliberate pair that a
 * four-corner model would report as the same placement.
 */
const side = (v: number, low: string, high: string): string => {
  if (v < CENTRE - SLOT_TOLERANCE) {
    return low;
  }
  return v > CENTRE + SLOT_TOLERANCE ? high : "";
};

export const anchorOf = ([x, y]: Point): Anchor => {
  const h = side(x, "left", "right");
  const v = side(y, "top", "bottom");
  if (h && v) {
    return `${v}-${h}` as Anchor;
  }
  return (v || h || "centre") as Anchor;
};

/** What the smaller mark in an icon turned out to be. */
export type BadgeKind = "badge" | "overlay";

export interface Badge {
  anchor: Anchor;
  centre: Point;
  extent: Box;
  family: string;
  /** Shape signature, for asking whether two instances draw the same mark. */
  fingerprints: Fingerprint[];
  /**
   * Ink gap to the rest of the icon: closest centre-line approach less one
   * stroke width, since each side contributes half a stroke of ink. Negative
   * means the marks overlap, which is a drawing choice rather than a defect.
   */
  gap: number;
  icon: string;
  kind: BadgeKind;
  modifier: string;
  /** Strokes making up the badge. A plus is two; that is not a defect. */
  strokes: number;
}

export interface NameSplit {
  base: string;
  modifier: string;
}

/** The family key: everything before the first hyphen. */
export const familyOf = (icon: string): string => icon.split("-")[0];

export const splitName = (icon: string): NameSplit | null => {
  const i = icon.indexOf("-");
  return i === -1
    ? null
    : { base: icon.slice(0, i), modifier: icon.slice(i + 1) };
};

/**
 * The badge in one icon, or null when it has none.
 *
 * Null covers three honest outcomes that the caller reports separately: a
 * single connected drawing (the suffix names a redraw, not a badge), a split
 * into two comparable halves, and an icon whose name carries no modifier.
 */
export const isolateBadge = (
  icon: string,
  clusters: Cluster[]
): Badge | null => {
  const split = splitName(icon);
  if (!split || clusters.length < 2) {
    return null;
  }
  // The base is the largest mark. The badge is the smallest, plus any other
  // mark that sits closer to it than to the base — an `info` badge is a dot
  // above a stem, two marks that never touch, and the dot alone measures 2×2.
  // Absorbing by proximity rather than taking every non-base mark is what keeps
  // a multi-part *base* (the inner detail of a `square-*`) out of the badge.
  const base = clusters.at(-1);
  const candidates = clusters.slice(0, -1);
  if (!base || candidates.length === 0) {
    return null;
  }
  const basePoints = base.elements.flatMap((e) => e.points);
  // Seed with the mark furthest from the icon's centre, not the smallest one.
  // A badge sits out at a corner; the smallest mark is often a thin inner
  // detail of the base — a rule inside a frame — sitting right on the centre.
  const iconBox = bbox(clusters.flatMap((c) => c.elements.map((e) => e.path)));
  const middle: Point = [
    iconBox.x0 + iconBox.w / 2,
    iconBox.y0 + iconBox.h / 2,
  ];
  const fromMiddle = (c: Cluster) =>
    Math.hypot(c.centre[0] - middle[0], c.centre[1] - middle[1]);
  let [outermost] = candidates;
  for (const c of candidates) {
    if (fromMiddle(c) > fromMiddle(outermost)) {
      outermost = c;
    }
  }
  const badge = [outermost];
  const pool = candidates.filter((c) => c !== outermost);
  for (let changed = true; changed;) {
    changed = false;
    const mine = badge.flatMap((c) => c.elements.flatMap((e) => e.points));
    for (const [i, c] of pool.entries()) {
      const pts = c.elements.flatMap((e) => e.points);
      if (nearest(pts, mine) < nearest(pts, basePoints)) {
        badge.push(c);
        pool.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  const elements = badge.flatMap((c) => c.elements);
  const raw = bbox(elements.map((e) => e.path));
  const [{ stroke }] = elements;
  const extent = visualExtent(raw, stroke);
  const centre: Point = [raw.x0 + raw.w / 2, raw.y0 + raw.h / 2];

  const whole = (iconBox.w + stroke) * (iconBox.h + stroke);
  if ((extent.w * extent.h) / whole > BADGE_MAX_SHARE) {
    return null;
  }

  const span = Math.max(extent.w, extent.h);
  return {
    anchor: anchorOf(centre),
    centre,
    extent,
    family: familyOf(icon),
    fingerprints: elements.map((e) => fingerprint(e.path)),
    gap:
      nearest(
        elements.flatMap((e) => e.points),
        base.elements.flatMap((e) => e.points)
      ) - stroke,
    icon,
    kind: span >= OVERLAY_MIN_SPAN ? "overlay" : "badge",
    modifier: split.modifier,
    strokes: elements.length,
  };
};

export interface ModifierGroup {
  badges: Badge[];
  modifier: string;
  /** Icons naming this modifier that draw one connected mark: redrawn, not
   *  badged. A large share means the suffix is not a badge at all. */
  redrawn: string[];
  /** Median pairwise fingerprint distance between instances. High means the
   *  same modifier is drawn as two different shapes. */
  shapeSpread: number;
}

export interface ModifierSpec {
  /** Share of instances matching this spec's slot and size. */
  agreement: number;
  anchor: Anchor;
  /**
   * Whether this suffix names a badge at all.
   *
   * Decided by measurement rather than by a word list: a badge sits in a corner
   * as a separate small mark. A suffix whose instances sit dead centre is
   * naming something else — `-2` is a variant index, `-circle` and `-square`
   * are containers, `-up`/`-down` are directions — and folding those into a
   * badge spec would derive a canonical size for things that are not badges.
   */
  badgeLike: boolean;
  clearance: number;
  height: number;
  kind: BadgeKind;
  modifier: string;
  n: number;
  /** True when instances draw meaningfully different shapes for one name. */
  shapesDiffer: boolean;
  width: number;
}

export interface ModifierReport {
  cohorts: Cohort[];
  groups: ModifierGroup[];
  /** Modifier names found on the filenames, before any measurement. */
  vocabulary: number;
  redrawn: number;
  spec: ModifierSpec[];
  symbols: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) {
    return Number.NaN;
  }
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const commonest = <T>(xs: T[]): T | undefined => {
  const counts = new Map<T, number>();
  for (const x of xs) {
    counts.set(x, (counts.get(x) ?? 0) + 1);
  }
  return [...counts].toSorted((a, b) => b[1] - a[1])[0]?.[0];
};

/** Round to the drawing grid, so a derived spec is expressible on it. */
const toGrid = (v: number, grid = 0.25): number =>
  Number.isFinite(v) ? Math.round(v / grid) * grid : v;

/** Same size, to within half the grid. */
const SIZE_TOLERANCE = 0.5;
/** Fingerprint distance above which two badges are different drawings. */
const SHAPE_DIFFERS = 0.06;

/**
 * Distance between two badges as drawings, independent of stroke order.
 *
 * A plus is two strokes and nothing says which is listed first, so pairing by
 * index reports two identical pluses as different shapes. Each stroke is
 * matched to its closest counterpart instead, both ways.
 */
const oneWay = (from: Fingerprint[], to: Fingerprint[]): number => {
  let sum = 0;
  for (const f of from) {
    const best = Math.min(...to.map((t) => distance(f, t)));
    sum += Number.isFinite(best) ? best : 1;
  }
  return sum / from.length;
};

const badgeDistance = (a: Fingerprint[], b: Fingerprint[]): number => {
  if (a.length === 0 || b.length === 0) {
    return 1;
  }
  return (oneWay(a, b) + oneWay(b, a)) / 2;
};

/** How much the instances of one modifier disagree about what to draw. */
const spreadOf = (badges: Badge[]): number => {
  const ds: number[] = [];
  for (let i = 0; i < badges.length; i += 1) {
    for (let j = i + 1; j < badges.length; j += 1) {
      ds.push(badgeDistance(badges[i].fingerprints, badges[j].fingerprints));
    }
  }
  return ds.length ? median(ds) : 0;
};

/**
 * The spec a generator needs: one size, one slot, one clearance per modifier,
 * plus how much of the shipped set actually agrees with it.
 *
 * Agreement is the number that matters. A canonical size derived from six icons
 * that agree is a spec; the same number from six that disagree is an average,
 * and drawing to an average adds a seventh way of being wrong.
 */
export const deriveSpec = (groups: ModifierGroup[]): ModifierSpec[] =>
  groups
    .filter((g) => g.badges.length > 0)
    .map((g) => {
      const anchor = commonest(g.badges.map((b) => b.anchor)) ?? "centre";
      const inSlot = g.badges.filter((b) => b.anchor === anchor);
      const width = toGrid(median(inSlot.map((b) => b.extent.w)));
      const height = toGrid(median(inSlot.map((b) => b.extent.h)));
      const agreeing = inSlot.filter(
        (b) =>
          Math.abs(b.extent.w - width) <= SIZE_TOLERANCE &&
          Math.abs(b.extent.h - height) <= SIZE_TOLERANCE
      );
      return {
        agreement: agreeing.length / g.badges.length,
        anchor,
        badgeLike:
          anchor.includes("-") &&
          commonest(g.badges.map((b) => b.kind)) === "badge",
        clearance: toGrid(median(inSlot.map((b) => b.gap))),
        height,
        kind: commonest(g.badges.map((b) => b.kind)) ?? "badge",
        modifier: g.modifier,
        n: g.badges.length,
        shapesDiffer: g.shapeSpread > SHAPE_DIFFERS,
        width,
      };
    })
    .toSorted((a, b) => b.n - a.n || a.modifier.localeCompare(b.modifier));

export interface AnalyseOptions {
  corpus: Corpus;
  /** Only measure modifiers with at least this many instances. */
  minInstances?: number;
  variant?: string;
}

export const HOUSE_VARIANT = "round-outlined-radius-3-stroke-2";

/**
 * Measure every badge in the set, group by modifier, derive the spec.
 *
 * Cohorts are keyed by modifier rather than by family, because the question is
 * whether `-add` means the same thing on a folder as on a user. A split cohort
 * is a modifier drawn at two sizes or in two slots — the same defect class as
 * the folder family's y1=19 against y1=20, and just as invisible per icon.
 */
export const analyse = async (
  options: AnalyseOptions
): Promise<ModifierReport> => {
  const { corpus, minInstances = 2, variant = HOUSE_VARIANT } = options;
  const symbols = corpus.symbols.filter((s) => corpus.has(s, variant));

  const families = new Map<string, string[]>();
  for (const s of symbols) {
    const key = familyOf(s);
    families.set(key, [...(families.get(key) ?? []), s]);
  }

  const byModifier = new Map<string, Badge[]>();
  const redrawnBy = new Map<string, string[]>();
  const names = new Set<string>();

  // Every icon in every family large enough to hold a convention, measured in
  // one pass. Families are collapsed first rather than awaited one at a time,
  // so the whole set is a single wait rather than one per family.
  const wanted = [...families.values()]
    .filter((members) => members.length >= MIN_FAMILY)
    .flat();
  const loaded = await Promise.all(
    wanted.map(async (name) => ({
      badge: isolateBadge(
        name,
        clusterIcon(elementsOf(await corpus.load(name, variant)))
      ),
      name,
    }))
  );

  for (const { badge, name } of loaded) {
    const split = splitName(name);
    if (!split) {
      continue;
    }
    names.add(split.modifier);
    if (badge) {
      byModifier.set(split.modifier, [
        ...(byModifier.get(split.modifier) ?? []),
        badge,
      ]);
    } else {
      redrawnBy.set(split.modifier, [
        ...(redrawnBy.get(split.modifier) ?? []),
        name,
      ]);
    }
  }

  const groups: ModifierGroup[] = [...names]
    .map((modifier) => {
      const badges = byModifier.get(modifier) ?? [];
      return {
        badges,
        modifier,
        redrawn: redrawnBy.get(modifier) ?? [],
        shapeSpread: spreadOf(badges),
      };
    })
    .toSorted(
      (a, b) =>
        b.badges.length - a.badges.length ||
        a.modifier.localeCompare(b.modifier)
    );

  const measured = groups.filter((g) => g.badges.length >= minInstances);
  const manifest = Object.fromEntries(
    measured.map((g) => [g.modifier, g.badges.map((b) => b.icon)])
  );
  const members: CohortMember[] = measured.flatMap((g) =>
    g.badges.map((b) => ({ box: b.extent, name: b.icon }))
  );

  return {
    cohorts: buildCohorts(members, { manifest }),
    groups,
    redrawn: [...redrawnBy.values()].flat().length,
    spec: deriveSpec(measured),
    symbols: symbols.length,
    vocabulary: names.size,
  };
};

const pct = (v: number): string => `${(100 * v).toFixed(0)}%`;

export const formatReport = (r: ModifierReport): string => {
  const row = (s: ModifierSpec) =>
    `  ${s.modifier.padEnd(16)}${String(s.n).padStart(2)}  ` +
    `${`${s.width.toFixed(2)}×${s.height.toFixed(2)}`.padEnd(12)}` +
    `${(s.kind === "overlay" ? `${s.anchor} (overlay)` : s.anchor).padEnd(13)} ` +
    `${s.clearance.toFixed(2).padStart(5)}  ${pct(s.agreement).padStart(4)}  ` +
    `${s.shapesDiffer ? "DIFFER" : "same"}`;

  const badges = r.spec.filter((s) => s.badgeLike);
  const others = r.spec.filter((s) => !s.badgeLike);
  const lines = [
    `modifier consistency — ${r.symbols} symbols, ${r.vocabulary} modifier names, ${r.spec.length} measurable`,
    "",
    `  BADGES (${badges.length}) — a separate mark in a corner slot`,
    "  modifier          n  extent       slot          clear  agree  shape",
  ];
  for (const s of badges) {
    lines.push(row(s));
  }
  lines.push(
    "",
    `  NOT BADGES (${others.length}) — centred or spanning, so the suffix names a`,
    "  variant, a container or a direction rather than a badge",
    "  modifier          n  extent       slot          clear  agree  shape"
  );
  for (const s of others) {
    lines.push(row(s));
  }

  const split = r.cohorts.filter((c) => splits(c).length > 0);
  lines.push(
    "",
    `  ${split.length} modifier(s) split across two or more groups:`
  );
  for (const c of split) {
    for (const axis of splits(c)) {
      lines.push(`    ${c.name} disagrees on ${axis.axis}:`);
      for (const [i, g] of axis.groups.entries()) {
        lines.push(
          `      ${String(g.members.length).padStart(2)}x  ${g.lo.toFixed(2)}..${g.hi.toFixed(2)}` +
            `${i === 0 ? "  (majority)" : `  (+${drift(axis, g).toFixed(2)}px)`}  ${g.members.join(", ")}`
        );
      }
    }
  }
  if (r.redrawn > 0) {
    lines.push(
      "",
      `  ${r.redrawn} icon(s) name a modifier but draw one connected mark — a redraw, not a badge.`
    );
  }
  return lines.join("\n");
};

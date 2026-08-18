/**
 * Cohort alignment: the check no per-icon rule can make.
 *
 * An icon is not judged alone. `folder-open` replaces `folder-1` in a list when
 * a disclosure toggles, so the two must occupy the same box — if they don't,
 * the row twitches. That agreement is invisible to every rule in `lint.ts`,
 * because every rule there sees one icon at a time: a family can be uniformly,
 * deliberately off-centre and still be right, and a family can be perfectly
 * centred icon by icon and still flicker when swapped.
 *
 * So the unit of measurement is the cohort, not the icon. Two decisions shape
 * the rest of the file:
 *
 * 1. **Per axis, not per box.** A folder family's widths legitimately vary — a
 *    badge hangs off the right — while its top and bottom edges are a rhythm
 *    that must hold. Clustering on the whole box lets one wide sibling hide the
 *    vertical convention it does obey. So the x extent and the y extent are
 *    clustered separately and reported separately.
 * 2. **Agreement is per edge.** Recentring an icon moves both of its edges, so
 *    an icon that shares even one edge value with a sibling cannot be recentred
 *    without breaking an alignment it currently has. That is what suppresses
 *    the per-icon `centred` rule, and it is the whole of the argument.
 *
 * What this deliberately does not do: it compares outer extents only. A badge
 * that shifted inside an otherwise identically-sized icon is invisible here.
 */
import { bbox, parsePath } from "../geometry/path.js";
import type { Box } from "../types.js";

/** One icon's contribution to a cohort: its name and its path bbox. */
export interface CohortMember {
  box: Box;
  name: string;
}

export type Axis = "x" | "y";

/** Members that agree on one axis' extent within tolerance. */
export interface CohortGroup {
  hi: number;
  lo: number;
  members: string[];
}

export interface CohortAxis {
  axis: Axis;
  /**
   * Whether a deviation from the largest group means anything. A family whose
   * members all sit at different extents has no convention to violate, and
   * reporting eleven "violations" against an arbitrary twelfth is noise.
   */
  conventional: boolean;
  /** True when the top two groups tie: neither side is obviously the fix. */
  even: boolean;
  /** Largest first; ties broken by first member name, so output is stable. */
  groups: CohortGroup[];
}

export interface Cohort {
  members: CohortMember[];
  name: string;
  x: CohortAxis;
  y: CohortAxis;
}

/**
 * An explicit statement of which icons swap for each other, keyed by cohort
 * name. This exists because name prefixes are not a swap graph: `play` and
 * `pause` share no prefix and must align; `user` and `user-group` share one and
 * need not.
 *
 * A manifest rather than a `swapsWith` field per icon, because swapping is
 * symmetric and transitive: per-icon lists have to be kept mutually consistent
 * by hand across every member, and a half-updated one silently splits a cohort
 * in two — the exact defect this module exists to find. A cohort is stated once
 * here, and reads as the reviewable artifact it is.
 */
export type CohortManifest = Record<string, string[]>;

/** Extents closer than this are the same extent. Matches the drawing grid's
 *  quarter-pixel, below which nothing in the set is placed deliberately. */
export const COHORT_TOLERANCE = 0.25;
/** A cohort of one has nothing to agree with. */
const MIN_COHORT = 2;
/** A convention needs a plurality, and a plurality of one is not one. */
const MIN_GROUP = 2;
/**
 * Share of a cohort the top two groups must cover before a minority reads as a
 * mistake rather than as a family that was never uniform to begin with.
 *
 * Calibrated against blode-icons, where the gate is the whole difference
 * between a report and a wall. At 0.6 the inferred `arrow` cohort — 83 icons
 * spread over 12 extents, because prefix inference lumps `arrow-up` in with
 * `arrow-up-circle` — contributes 46 "violations" nobody would act on. At 0.85
 * it drops out as what it is (a family with no single convention) and the
 * corpus reports 143 icons across 79 cohorts, each a genuine odd one out.
 */
const CONVENTION_COVERAGE = 0.85;

const FILLED = /-filled$/u;
const TRAILING_INDEX = /-\d+$/u;

/**
 * The default cohort key when no manifest covers an icon: the first
 * hyphen-delimited segment, kept separate per style.
 *
 * Style is part of the key because a filled icon and its outline sibling are
 * drawn to different silhouettes on purpose and never swap for each other.
 */
export const inferCohort = (icon: string): string => {
  const filled = FILLED.test(icon);
  const stem = icon.replace(FILLED, "").replace(TRAILING_INDEX, "");
  const [head] = stem.split("-");
  return filled ? `${head}#filled` : head;
};

/** The cohort an icon belongs to: a manifest entry if one names it, else the
 *  inferred prefix. The manifest wins, so a hand-written cohort can pull
 *  `pause` in beside `play` and split `user-group` away from `user`. */
export const cohortOf = (icon: string, manifest?: CohortManifest): string => {
  if (manifest) {
    for (const [name, members] of Object.entries(manifest)) {
      if (members.includes(icon)) {
        return name;
      }
    }
  }
  return inferCohort(icon);
};

const extent = (box: Box, axis: Axis): [number, number] =>
  axis === "x" ? [box.x0, box.x1] : [box.y0, box.y1];

const clusterAxis = (
  members: CohortMember[],
  axis: Axis,
  tol: number
): CohortAxis => {
  const groups: CohortGroup[] = [];
  for (const m of members.toSorted((a, b) => a.name.localeCompare(b.name))) {
    const [lo, hi] = extent(m.box, axis);
    const hit = groups.find(
      (g) => Math.abs(g.lo - lo) <= tol && Math.abs(g.hi - hi) <= tol
    );
    if (hit) {
      hit.members.push(m.name);
    } else {
      groups.push({ hi, lo, members: [m.name] });
    }
  }
  const ranked = groups.toSorted(
    (a, b) =>
      b.members.length - a.members.length ||
      a.members[0].localeCompare(b.members[0])
  );
  const top = ranked[0]?.members.length ?? 0;
  const second = ranked[1]?.members.length ?? 0;
  return {
    axis,
    conventional:
      members.length >= MIN_COHORT &&
      top >= MIN_GROUP &&
      (top + second) / members.length >= CONVENTION_COVERAGE,
    even: ranked.length > 1 && top === second,
    groups: ranked,
  };
};

export interface CohortOptions {
  manifest?: CohortManifest;
  tolerance?: number;
}

/** Group measured icons into cohorts and cluster each cohort on both axes. */
export const buildCohorts = (
  members: CohortMember[],
  { manifest, tolerance = COHORT_TOLERANCE }: CohortOptions = {}
): Cohort[] => {
  const byCohort = new Map<string, CohortMember[]>();
  for (const m of members) {
    const key = cohortOf(m.name, manifest);
    const bucket = byCohort.get(key);
    if (bucket) {
      bucket.push(m);
    } else {
      byCohort.set(key, [m]);
    }
  }
  return [...byCohort]
    .map(([name, bucket]) => ({
      members: bucket,
      name,
      x: clusterAxis(bucket, "x", tolerance),
      y: clusterAxis(bucket, "y", tolerance),
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
};

/**
 * The extent a *new* member of this family should be drawn to, per axis.
 *
 * `null` on an axis the family has no convention on: with the members spread
 * over extents that never agreed, there is nothing for a new icon to inherit,
 * and snapping it to whichever group happens to be largest would invent a
 * convention rather than join one. `conventional` is the same gate `isSplit`
 * uses, so what `cohort` in the DSL draws to and what `cohort-align` in `lint`
 * complains about are one decision, made once.
 */
export interface CohortTarget {
  x: [number, number] | null;
  y: [number, number] | null;
}

const agreed = (a: CohortAxis): [number, number] | null =>
  a.conventional ? [a.groups[0].lo, a.groups[0].hi] : null;

export const canonicalExtent = (c: Cohort): CohortTarget => ({
  x: agreed(c.x),
  y: agreed(c.y),
});

/**
 * The cohort a DSL program names, by any of the three things a caller has to
 * hand: the cohort key itself (`bell#filled`), the name of an icon already in
 * it (`bell-active-filled`), or the name of the icon being drawn — which is
 * *not* a member yet, so it resolves through the same prefix inference that
 * put its siblings in the cohort in the first place.
 */
export const findCohort = (
  cohorts: Cohort[],
  key: string
): Cohort | undefined =>
  cohorts.find((c) => c.name === key) ??
  cohorts.find((c) => c.members.some((m) => m.name === key)) ??
  cohorts.find((c) => c.name === inferCohort(key));

/** An axis whose members disagree about where the family's edges sit. Swapping
 *  across the groups moves the icon; that is the flicker. */
export const isSplit = (a: CohortAxis): boolean =>
  a.conventional && a.groups.length > 1;

/** Every split axis in a cohort, worst first — the deliverable view. */
export const splits = (c: Cohort): CohortAxis[] =>
  [c.y, c.x].filter((a) => isSplit(a));

/** How far the minority sits from the canonical group on this axis. */
export const drift = (a: CohortAxis, g: CohortGroup): number =>
  Math.max(Math.abs(g.lo - a.groups[0].lo), Math.abs(g.hi - a.groups[0].hi));

/** The measurement a cohort is built from: an icon's own path bbox. */
export const measure = (paths: string[]): Box =>
  bbox(paths.flatMap((d) => parsePath(d)));

const SAMPLE = 3;
const sample = (names: string[]): string =>
  names.length <= SAMPLE
    ? names.join(", ")
    : `${names.slice(0, SAMPLE).join(", ")} +${names.length - SAMPLE} more`;

/** The cohort context for one icon, as `lint` consumes it. */
export interface CohortView {
  cohort: Cohort;
  name: string;
}

export interface CohortVerdict {
  /**
   * True when the icon shares at least one bbox edge with a sibling. Recentring
   * moves both edges, so such an icon cannot be nudged onto (12,12) without
   * breaking an alignment it already holds — which is why this suppresses the
   * per-icon `centred` rule rather than merely softening it.
   */
  agrees: boolean;
  /** One message per split axis this icon is on the wrong side of. */
  messages: string[];
}

const EDGES = ["x0", "y0", "x1", "y1"] as const;

const sharesAnEdge = (
  { box, name }: CohortMember,
  members: CohortMember[],
  tol: number
): boolean =>
  members.some(
    (o) =>
      o.name !== name && EDGES.some((e) => Math.abs(o.box[e] - box[e]) <= tol)
  );

const axisMessage = (
  cohort: Cohort,
  a: CohortAxis,
  name: string
): string | null => {
  const group = a.groups.find((g) => g.members.includes(name));
  const [canonical] = a.groups;
  if (!(group && isSplit(a)) || group === canonical) {
    return null;
  }
  const others = group.members.filter((m) => m !== name);
  const with_ =
    others.length > 0
      ? ` with ${others.length} sibling(s) (${sample(others)})`
      : " alone";
  const tie = a.even
    ? " The two groups are the same size, so either can be the one that moves — pick one and conform the other."
    : "";
  return (
    `Cohort "${cohort.name}" disagrees on its ${a.axis} extent. ${name} spans ${a.axis} ${group.lo.toFixed(2)}..${group.hi.toFixed(2)}${with_}, ` +
    `while ${canonical.members.length} span ${canonical.lo.toFixed(2)}..${canonical.hi.toFixed(2)} (${sample(canonical.members)}). ` +
    `Swapping across the split jumps the icon ${drift(a, group).toFixed(2)}px.${tie}`
  );
};

/** Where one icon stands in its cohort. */
export const verdict = (
  { cohort, name }: CohortView,
  tolerance = COHORT_TOLERANCE
): CohortVerdict => {
  const self = cohort.members.find((m) => m.name === name);
  return {
    agrees: self ? sharesAnEdge(self, cohort.members, tolerance) : false,
    messages: [
      axisMessage(cohort, cohort.y, name),
      axisMessage(cohort, cohort.x, name),
    ].filter((m): m is string => m !== null),
  };
};

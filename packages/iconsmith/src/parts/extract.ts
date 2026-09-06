/**
 * Extract the parts vocabulary from a set of outline SVGs.
 *
 * Every subpath in every icon becomes a candidate part. Candidates are
 * clustered by shape (position- and scale-invariant, and invariant under the
 * four quarter-turns plus the two axis reflections), and each cluster becomes
 * one part with a canonical drawing — the member closest to the cluster centre.
 * Each member's own placement is kept, so `turns` and `flips` say which of
 * those six the set actually draws. The square's other two symmetries, the
 * diagonal reflections, are excluded on measurement; see `shape.ts`.
 *
 * ONE SET, TWO DRAWING STYLES. An "outline" directory is rarely all outline.
 * blode-icons ships 2,221 outline files of which 358 carry no stroke at all:
 * some are brand glyphs drawn as filled shapes (Apple, Anthropic, Behance) and
 * the rest are strokes already expanded into filled contours by the exporter.
 * An expanded stroke contributes its *outline* as candidates — cap discs, join
 * wedges, and the plain rectangle that is the body of a straight run — and 18
 * of the 50 most-used parts over the whole directory were that residue. Those
 * are not vocabulary; they exist because of how 16% of the files were exported.
 * So the extractor separates the styles rather than making every caller
 * pre-filter by hand. See `styleOf` for the rule and `ExtractOptions.styles`
 * for the default.
 *
 * This module is a library. `extractParts` reads a directory and returns the
 * vocabulary plus summary stats; `writeParts` is the only function here that
 * writes anything, and nothing prints. The CLI wires the two together.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { CorpusShape } from "../corpus/load.js";
import { parseIconSvg } from "../corpus/load.js";
import { bbox, parsePath, serialise, translate } from "../geometry/path.js";
import type { Fingerprint, Part, Subpath } from "../types.js";
import { distance, fingerprint, foldedAspect, match } from "./shape.js";

/** Clustering distance below which two subpaths are the same part. */
const DEFAULT_THRESHOLD = 0.06;
/** Sub-pixel marks are dots and terminals, not parts. */
const MIN_PART_SIZE = 1.2;
/** Members compared when picking a cluster's canonical drawing. Clusters are
 *  tight enough that the medoid of a sample is the medoid of the cluster. */
const CANONICAL_SAMPLE = 24;
/** An outlier distance counts as one full unit rather than infinity, which
 *  would otherwise swamp a medoid's score. */
const OUTLIER_COST = 1;
/** Bucket keys saturate here; past a dozen nodes the count stops discriminating. */
const NODE_BUCKET_CAP = 12;
/** Aspect is bucketed in thirds — coarse enough that near-matches share a bucket. */
const ASPECT_BUCKETS = 3;
/** Quarter-turns in a full turn. */
const TURN_COUNT = 4;
const COVERAGE_POINTS = [50, 200, 500];
const PERCENT = 100;
const DECIMALS = 2;
const ID_WIDTH = 4;
const JSON_INDENT = 2;

/** How an icon is drawn: in strokes, or as filled contours (an expanded stroke
 *  or a filled brand glyph). */
export type IconStyle = "expanded" | "stroked";

/** Which style the vocabulary is taken from. `auto` prefers stroked icons and
 *  falls back to expanded ones when the set has no stroked icon at all. */
export type StyleSelection = "all" | "auto" | IconStyle;

export interface ExtractOptions {
  /** Skip clusters used by fewer than this many distinct icons. */
  minUses?: number;
  /** Decide which filenames in the directory are icons. Defaults to `*.svg`
   *  excluding `*-filled.svg`, the filled twin of an outline icon. */
  select?: (file: string) => boolean;
  /**
   * Which drawing style contributes candidates. Defaults to `auto`, which takes
   * stroked icons when the set has any and every icon when it has none — so a
   * set that is *entirely* outline-expanded still yields a vocabulary rather
   * than an empty list, while a mixed set is not polluted by stroke residue.
   */
  styles?: StyleSelection;
  /** Mean normalised point distance below which two subpaths cluster together. */
  threshold?: number;
}

/** How many of the directory's icons are drawn each way, and which of them the
 *  vocabulary was actually taken from. */
export interface StyleSplit {
  expanded: number;
  stroked: number;
  used: StyleSelection;
}

export interface ExtractSummary {
  /** Subpaths considered, before clustering. */
  candidates: number;
  /** Percentage of icons touched by the top N parts, keyed by N. */
  coverage: Record<number, number>;
  /** Icons the vocabulary was extracted from — `styles.stroked` of the
   *  `scanned` files, under the default. */
  icons: number;
  parts: number;
  /** Files matching `select`, before the style split. */
  scanned: number;
  /** Parts appearing in more than one icon — the vocabulary actually shared. */
  shared: number;
  styles: StyleSplit;
}

export interface ExtractResult {
  parts: Part[];
  summary: ExtractSummary;
  threshold: number;
}

interface Candidate {
  fp: Fingerprint;
  slug: string;
  sp: Subpath;
}

/** A candidate once it has joined a cluster, with the placement it joined at:
 *  a reflection in x and then clockwise quarter-turns, carrying the cluster
 *  head's drawing onto this one. Captured here because `match` already worked
 *  it out — recovering it later would mean running the whole comparison a
 *  second time. */
interface Member {
  c: Candidate;
  flip: boolean;
  turn: number;
}

const isOutlineIcon = (file: string): boolean =>
  file.endsWith(".svg") && !file.endsWith("-filled.svg");

const round = (n: number): number => Number(n.toFixed(DECIMALS));

/**
 * The drawing style of one icon, from the stroke on each of its paths.
 *
 * The evidence is per path — `parseIconSvg` reports stroke width 0 for a filled
 * shape — but the verdict is per icon, and that asymmetry is the point. A
 * per-path filter would also delete the filled shapes that live inside stroked
 * drawings: 252 of blode-icons' 2,221 outline files mix a filled dot, sparkle
 * or solid arrowhead into an otherwise stroked icon, and those are real marks
 * that belong in the vocabulary. What makes a filled contour residue is not
 * that it is filled, it is that the icon around it has no stroke anywhere —
 * which is only visible one level up, at the icon.
 */
const styleOf = (shapes: CorpusShape[]): IconStyle =>
  shapes.some((s) => s.strokeWidth > 0) ? "stroked" : "expanded";

/** Every subpath of one icon's shapes, as clustering candidates. */
const candidatesFrom = (shapes: CorpusShape[], slug: string): Candidate[] => {
  const out: Candidate[] = [];
  for (const shape of shapes) {
    for (const sp of parsePath(shape.d)) {
      if (sp.segs.length === 0) {
        continue;
      }
      const fp = fingerprint(sp);
      if (fp.size < MIN_PART_SIZE) {
        continue;
      }
      out.push({ fp, slug, sp });
    }
  }
  return out;
};

/**
 * Bucket key. Closedness, node count and aspect all survive the invariances
 * `distance` claims, so two candidates that could ever match land in the same
 * bucket — which keeps clustering near-linear instead of comparing every
 * candidate against every other.
 *
 * Aspect is folded, not raw: a quarter-turn transposes w and h, so a raw key
 * files a turned instance away from its original and no distance is ever taken.
 *
 * Reflection needs nothing added here, and that is worth stating rather than
 * leaving to be rediscovered: mirroring in x maps w to w and h to h, so a
 * mirrored instance already shares its original's key, node count and
 * closedness. Unlike the rotation fold, the metric change alone is live.
 */
const bucketKey = (c: Candidate): string => {
  const shape = c.fp.closed ? "c" : "o";
  const nodes = Math.min(c.fp.nodes, NODE_BUCKET_CAP);
  const aspect = Math.round(foldedAspect(c.fp.aspect) * ASPECT_BUCKETS);
  return `${shape}:${nodes}:${aspect}`;
};

const cluster = (candidates: Candidate[], threshold: number): Member[][] => {
  const buckets = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const bucket = buckets.get(bucketKey(c));
    if (bucket) {
      bucket.push(c);
    } else {
      buckets.set(bucketKey(c), [c]);
    }
  }

  const clusters: Member[][] = [];
  for (const group of buckets.values()) {
    const local: Member[][] = [];
    for (const c of group) {
      let hit: Member[] | null = null;
      let bestD = Number.POSITIVE_INFINITY;
      let bestTurn = 0;
      let bestFlip = false;
      for (const members of local) {
        const [head] = members;
        const { d, flip, turn } = match(c.fp, head.c.fp);
        if (d < threshold && d < bestD) {
          bestD = d;
          bestTurn = turn;
          bestFlip = flip;
          hit = members;
        }
      }
      if (hit) {
        hit.push({ c, flip: bestFlip, turn: bestTurn });
      } else {
        local.push([{ c, flip: false, turn: 0 }]);
      }
    }
    clusters.push(...local);
  }
  return clusters;
};

/** The member with the lowest total distance to the rest of the cluster. */
const medoid = (members: Member[]): Member => {
  const sample = members.slice(0, CANONICAL_SAMPLE);
  let [best] = members;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const m of sample) {
    let sum = 0;
    for (const o of sample) {
      sum += Math.min(distance(m.c.fp, o.c.fp), OUTLIER_COST);
    }
    if (sum < bestScore) {
      bestScore = sum;
      best = m;
    }
  }
  return best;
};

/**
 * The placement carrying the medoid's drawing onto `m`, given both members'
 * placements from the cluster head.
 *
 * With `g = R_t ∘ M^f` the answer is `g_m ∘ g_head⁻¹`, and in the dihedral
 * group of the square `M R_t = R_{-t} M`, so a reflection between the two flips
 * the sign of the turn: when exactly one of the pair is mirrored the turns
 * *add* rather than subtract. Subtracting unconditionally — which is what the
 * rotation-only version did — mis-files a mirrored member's turn by 2t.
 */
const relative = (m: Member, head: Member): { flip: boolean; turn: number } => {
  const flip = m.flip !== head.flip;
  const turn = flip ? m.turn + head.turn : m.turn - head.turn;
  return { flip, turn: ((turn % TURN_COUNT) + TURN_COUNT) % TURN_COUNT };
};

const toPart = (members: Member[], id: string): Part => {
  const best = medoid(members);
  const b = bbox([best.c.sp]);
  // Normalised to the origin so the part can be placed anywhere.
  const canonical = translate(best.c.sp, -b.x0, -b.y0);
  const sizes = members.map((m) => round(m.c.fp.size));
  // Placements are recorded against the canonical drawing, not against the
  // cluster head, which is whichever member happened to arrive first.
  const turns: [number, number, number, number] = [0, 0, 0, 0];
  const flips: [number, number] = [0, 0];
  for (const m of members) {
    const { flip, turn } = relative(m, best);
    turns[turn] += 1;
    flips[flip ? 1 : 0] += 1;
  }
  return {
    closed: best.c.sp.closed,
    // Preserve the admitted designer contour. Placement owns grid policy;
    // snapping handles here irreversibly changes curvature before placement.
    d: serialise([canonical]),
    flips,
    h: b.h,
    icons: [...new Set(members.map((m) => m.c.slug))].toSorted(),
    id,
    instances: members.length,
    nodes: best.c.sp.segs.length,
    sizeRange: [Math.min(...sizes), Math.max(...sizes)],
    turns,
    w: b.w,
  };
};

/** Percentage of the set's icons that the first `n` parts between them cover. */
export const coverage = (
  parts: Part[],
  n: number,
  totalIcons: number
): number => {
  if (totalIcons === 0) {
    return 0;
  }
  const seen = new Set<string>();
  for (const p of parts.slice(0, n)) {
    for (const icon of p.icons) {
      seen.add(icon);
    }
  }
  return (PERCENT * seen.size) / totalIcons;
};

/**
 * Read a directory of SVGs and return the parts vocabulary.
 * Files are read one at a time and reduced to fingerprints immediately, so peak
 * memory tracks the number of subpaths rather than the size of the icon set.
 */
export const extractParts = (
  dir: string,
  options: ExtractOptions = {}
): ExtractResult => {
  const {
    minUses = 1,
    select = isOutlineIcon,
    styles = "auto",
    threshold = DEFAULT_THRESHOLD,
  } = options;

  const files = readdirSync(dir).filter((file) => select(file));
  const drawn: { shapes: CorpusShape[]; slug: string; style: IconStyle }[] = [];
  const counts: Record<IconStyle, number> = { expanded: 0, stroked: 0 };
  for (const file of files) {
    const shapes = parseIconSvg(readFileSync(path.join(dir, file), "utf-8"));
    const style = styleOf(shapes);
    counts[style] += 1;
    drawn.push({ shapes, slug: path.basename(file, ".svg"), style });
  }

  // `auto` only excludes expanded icons when there is something left to extract
  // from. A set drawn entirely as expanded outlines is not a mixed set with
  // residue in it; it is that set's own vocabulary, and returning nothing would
  // be a worse answer than returning it.
  let used: StyleSelection = styles;
  if (styles === "auto") {
    used = counts.stroked > 0 ? "stroked" : "all";
  }
  const included = drawn.filter((d) => used === "all" || d.style === used);

  const candidates: Candidate[] = [];
  for (const { shapes, slug } of included) {
    candidates.push(...candidatesFrom(shapes, slug));
  }

  const parts: Part[] = [];
  for (const members of cluster(candidates, threshold)) {
    if (new Set(members.map((m) => m.c.slug)).size < minUses) {
      continue;
    }
    const id = `p${parts.length.toString().padStart(ID_WIDTH, "0")}`;
    parts.push(toPart(members, id));
  }

  // Most-used first: the head of this list is the vocabulary worth naming.
  const ranked = parts.toSorted(
    (a, b) => b.icons.length - a.icons.length || b.instances - a.instances
  );

  const cov: Record<number, number> = {};
  for (const n of COVERAGE_POINTS) {
    cov[n] = coverage(ranked, n, included.length);
  }

  return {
    parts: ranked,
    summary: {
      candidates: candidates.length,
      coverage: cov,
      icons: included.length,
      parts: ranked.length,
      scanned: files.length,
      shared: ranked.filter((p) => p.icons.length > 1).length,
      styles: { ...counts, used },
    },
    threshold,
  };
};

/** The only function here that touches the filesystem for output. */
export const writeParts = (result: ExtractResult, outPath: string): void => {
  const doc = {
    generated: result.summary.icons,
    parts: result.parts,
    threshold: result.threshold,
  };
  writeFileSync(outPath, `${JSON.stringify(doc, null, JSON_INDENT)}\n`);
};

/**
 * Extract the parts vocabulary from a set of outline SVGs.
 *
 * Every subpath in every icon becomes a candidate part. Candidates are
 * clustered by shape (position- and scale-invariant, rotation-invariant for
 * closed rings), and each cluster becomes one part with a canonical drawing —
 * the member closest to the cluster centre.
 *
 * This module is a library. `extractParts` reads a directory and returns the
 * vocabulary plus summary stats; `writeParts` is the only function here that
 * writes anything, and nothing prints. The CLI wires the two together.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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
const GRID = 0.25;
const PERCENT = 100;
const DECIMALS = 2;
const ID_WIDTH = 4;
const JSON_INDENT = 2;

export interface ExtractOptions {
  /** Skip clusters used by fewer than this many distinct icons. */
  minUses?: number;
  /** Decide which filenames in the directory are icons. Defaults to `*.svg`
   *  excluding `*-filled.svg`, the filled twin of an outline icon. */
  select?: (file: string) => boolean;
  /** Mean normalised point distance below which two subpaths cluster together. */
  threshold?: number;
}

export interface ExtractSummary {
  /** Subpaths considered, before clustering. */
  candidates: number;
  /** Percentage of icons touched by the top N parts, keyed by N. */
  coverage: Record<number, number>;
  icons: number;
  parts: number;
  /** Parts appearing in more than one icon — the vocabulary actually shared. */
  shared: number;
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

/** A candidate once it has joined a cluster, with the orientation it joined at:
 *  clockwise quarter-turns carrying the cluster head's drawing onto this one.
 *  Captured here because `match` already worked it out — recovering it later
 *  would mean running the whole comparison a second time. */
interface Member {
  c: Candidate;
  turn: number;
}

const D_ATTR = /\sd="(?<d>[^"]+)"/gu;

const isOutlineIcon = (file: string): boolean =>
  file.endsWith(".svg") && !file.endsWith("-filled.svg");

const round = (n: number): number => Number(n.toFixed(DECIMALS));

/** Every subpath of one SVG's path data, as clustering candidates. */
const candidatesFrom = (svg: string, slug: string): Candidate[] => {
  const out: Candidate[] = [];
  for (const m of svg.matchAll(D_ATTR)) {
    for (const sp of parsePath(m[1])) {
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
      for (const members of local) {
        const [head] = members;
        const { d, turn } = match(c.fp, head.c.fp);
        if (d < threshold && d < bestD) {
          bestD = d;
          bestTurn = turn;
          hit = members;
        }
      }
      if (hit) {
        hit.push({ c, turn: bestTurn });
      } else {
        local.push([{ c, turn: 0 }]);
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

const toPart = (members: Member[], id: string): Part => {
  const best = medoid(members);
  const b = bbox([best.c.sp]);
  // Normalised to the origin so the part can be placed anywhere.
  const canonical = translate(best.c.sp, -b.x0, -b.y0);
  const sizes = members.map((m) => round(m.c.fp.size));
  // Turns are recorded against the canonical drawing, not against the cluster
  // head, which is whichever member happened to arrive first. Both are turns
  // from the head, so the difference is the turn from the medoid to the member.
  const turns: [number, number, number, number] = [0, 0, 0, 0];
  for (const m of members) {
    turns[(m.turn - best.turn + TURN_COUNT) % TURN_COUNT] += 1;
  }
  return {
    closed: best.c.sp.closed,
    d: serialise([canonical], { grid: GRID }),
    h: round(b.h),
    icons: [...new Set(members.map((m) => m.c.slug))].toSorted(),
    id,
    instances: members.length,
    nodes: best.c.sp.segs.length,
    sizeRange: [Math.min(...sizes), Math.max(...sizes)],
    turns,
    w: round(b.w),
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
    threshold = DEFAULT_THRESHOLD,
  } = options;

  const files = readdirSync(dir).filter((file) => select(file));
  const candidates: Candidate[] = [];
  for (const file of files) {
    const svg = readFileSync(path.join(dir, file), "utf-8");
    candidates.push(...candidatesFrom(svg, path.basename(file, ".svg")));
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
    cov[n] = coverage(ranked, n, files.length);
  }

  return {
    parts: ranked,
    summary: {
      candidates: candidates.length,
      coverage: cov,
      icons: files.length,
      parts: ranked.length,
      shared: ranked.filter((p) => p.icons.length > 1).length,
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

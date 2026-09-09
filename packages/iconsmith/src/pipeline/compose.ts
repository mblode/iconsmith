/**
 * Where the raster dies.
 *
 * An image model is good at composition — how many things there are, which is
 * the big one, what sits inside what — and it is not good at anything this
 * project guarantees. So the picture is read *here*, into words, and the words
 * are what travel. Nothing downstream of this module has the picture in a form
 * it could measure: `Proposal` carries a 3×3 cell name, a size band, a shape
 * word, adjacency sentences, a part-id shortlist, and a deliberately blurred
 * 48px thumbnail. There is no canvas unit anywhere in it, and no field a
 * coordinate could hide in.
 *
 * This is the reason there is no tracer. A vectoriser would hand the drawer
 * path data, and path data is exactly what `canvas.ts` exists to be the only
 * author of. The bargain here is the opposite one: the image model gets to
 * decide *what and roughly where*, in the same vocabulary the canvas already
 * speaks, and the drawer decides everything else.
 *
 * The internal geometry — component bounding boxes in analysis-grid pixels —
 * is local to this file by construction: it is a non-exported type, it never
 * reaches a return value, and `assertNoGeometry` re-checks the finished
 * proposal at runtime for the case where someone widens a field later.
 */
import { generateObject } from "ai";
import sharp from "sharp";
import { z } from "zod";

import { bbox, parsePath } from "../geometry/path.js";
import { foldedAspect } from "../parts/shape.js";
import { cosine } from "../tools/render.js";
import type { Part } from "../types.js";
import type { ApiCost } from "./cost.js";
import { tokenUsageOf } from "./cost.js";
import { gatewayCostTracker, resolveModel } from "./gateway.js";

/** Analysis raster. Coarse on purpose: at 64px a 24-unit icon's stroke is ~5px,
 *  so components merge the way they read at small size, which is the level the
 *  composition is being described at. Finer would resolve detail the proposal
 *  is not allowed to carry anyway. */
const GRID = 64;
/** Ink threshold on the greyscale raster, 0–1. Image models return soft edges
 *  and JPEG ringing; a third of full black is well clear of both. */
const INK = 0.35;
/** Components below this share of the raster are speckle, not elements. */
const MIN_AREA = 0.003;
/** The most blocks a proposal describes. Past eight the description is longer
 *  than the icon and the model stops reading it; the set's icons are 1–6
 *  elements. */
const MAX_BLOCKS = 8;
/** Thumbnail edge, and its blur.
 *
 *  The blur is not cosmetic and it is not the scoring blur — `render.ts` owns
 *  that one, calibrated against 0.737, and it is not this module's to reuse or
 *  to change. This one is here so the thumbnail cannot be read as geometry: at
 *  48px with a 1.2px blur a stroke has no measurable position, and what
 *  survives is mass and arrangement, which is all the proposal is claiming. */
const THUMB = 48;
const THUMB_BLUR = 1.2;
/** Mask edge for shape matching against the parts vocabulary. */
const MASK = 32;
/** Parts rasterised per block. The vocabulary runs to thousands; the ones worth
 *  offering are the ones the set actually draws often, so candidates are taken
 *  in instance order after an aspect filter. */
const CANDIDATES = 96;
/** Aspect gap past which two shapes cannot be the same mark. Mirrors
 *  `shape.ts`'s own tolerance, taken on the folded aspect so a mark and its
 *  quarter-turn compare equal. */
const ASPECT_TOLERANCE = 0.4;
/** Cosine floor for a part to be worth naming. Below this the shortlist is
 *  noise dressed as a suggestion, which costs the model a search. */
const PART_FLOOR = 0.62;
/** Part ids offered. A shortlist, not a ranking to work through. */
const MAX_PARTS = 6;

/** Where a block sits, in ninths. */
type Cell =
  | "bottom-left"
  | "bottom-right"
  | "bottom"
  | "center"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "top";

/** How big a block is relative to the largest one in the proposal. */
type SizeBand = "dominant" | "large" | "medium" | "small" | "tiny";

/** A block's silhouette, to one word. */
type ShapeWord = "square" | "tall" | "wide";

/** One thing in the proposed composition. Three words, and nothing else. */
export interface ProposalBlock {
  cell: Cell;
  shape: ShapeWord;
  size: SizeBand;
}

/**
 * A composition, in the canvas's own vocabulary.
 *
 * Every field is either a word from a closed set, a count of blocks, or the
 * blurred thumbnail. `elements` is the only number, and it is an element count
 * — never a measurement. See `assertNoGeometry`.
 */
export interface Proposal {
  /** Sentences over block ordinals: "block 2 sits inside block 1". */
  adjacency: string[];
  blocks: ProposalBlock[];
  /** `blocks.length`, stated because it is the first thing the model needs. */
  elements: number;
  /** Part ids from the extracted vocabulary whose shape resembles a block. A
   *  shortlist to search from, not an instruction to place. */
  parts: string[];
  /** 48px, blurred, base64 PNG. Mass and arrangement; no readable geometry. */
  thumbnail: string;
}

/** A connected component, in analysis-grid pixels. Not exported, and never
 *  reachable from a `Proposal`: this is the type the invariant is about. */
interface Region {
  mask: Uint8Array;
  pixels: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const cellName = (cx: number, cy: number): Cell => {
  const col = Math.min(2, Math.floor((cx / GRID) * 3));
  const row = Math.min(2, Math.floor((cy / GRID) * 3));
  const rows = ["top", "center", "bottom"] as const;
  const cols = ["left", "center", "right"] as const;
  if (row === 1 && col === 1) {
    return "center";
  }
  if (row === 1) {
    return cols[col] as Cell;
  }
  if (col === 1) {
    return rows[row] as Cell;
  }
  return `${rows[row]}-${cols[col]}` as Cell;
};

const sizeBand = (extent: number, largest: number): SizeBand => {
  const share = largest > 0 ? extent / largest : 0;
  if (share >= 0.92) {
    return "dominant";
  }
  if (share >= 0.6) {
    return "large";
  }
  if (share >= 0.38) {
    return "medium";
  }
  if (share >= 0.2) {
    return "small";
  }
  return "tiny";
};

const shapeWord = (w: number, h: number): ShapeWord => {
  const ratio = w / Math.max(h, 1);
  if (ratio >= 1.3) {
    return "wide";
  }
  if (ratio <= 1 / 1.3) {
    return "tall";
  }
  return "square";
};

/**
 * A ceiling on decoded pixels, because `image` here came from outside.
 *
 * `compose` is the one place in this package that rasterises a buffer the
 * caller supplied rather than one the canvas produced, and sharp's default
 * ceiling is 268 megapixels — high enough that a small file declaring enormous
 * dimensions costs gigabytes to decode. The drawings this reads are 24-unit
 * icons; anything past a few megapixels is not a reference, it is a bill.
 */
const MAX_INPUT_PIXELS = 16_000_000;

/** Ink map of the image at the analysis grid: 1 where there is a mark. */
const inkMap = async (image: Buffer): Promise<Uint8Array> => {
  const raw = await sharp(image, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize(GRID, GRID, { background: "#fff", fit: "contain" })
    .flatten({ background: "#fff" })
    .greyscale()
    .raw()
    .toBuffer();
  const out = new Uint8Array(GRID * GRID);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = (255 - raw[i]) / 255 > INK ? 1 : 0;
  }
  return out;
};

/** Eight-connected components, flood filled with an explicit stack: the icons
 *  that read as one mark at 16px are the ones whose ink touches. */
const regions = (ink: Uint8Array): Region[] => {
  const seen = new Uint8Array(ink.length);
  const found: Region[] = [];
  for (let start = 0; start < ink.length; start += 1) {
    if (ink[start] === 0 || seen[start] === 1) {
      continue;
    }
    const mask = new Uint8Array(ink.length);
    const stack = [start];
    seen[start] = 1;
    let pixels = 0;
    let x0 = GRID;
    let y0 = GRID;
    let x1 = 0;
    let y1 = 0;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const x = i % GRID;
      const y = (i - x) / GRID;
      mask[i] = 1;
      pixels += 1;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) {
            continue;
          }
          const j = ny * GRID + nx;
          if (ink[j] === 1 && seen[j] === 0) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    found.push({ mask, pixels, x0, x1, y0, y1 });
  }
  const floor = MIN_AREA * GRID * GRID;
  return found
    .filter((r) => r.pixels >= floor)
    .toSorted(
      (a, b) =>
        Math.max(b.x1 - b.x0, b.y1 - b.y0) - Math.max(a.x1 - a.x0, a.y1 - a.y0)
    )
    .slice(0, MAX_BLOCKS);
};

const overlaps = (a: Region, b: Region): boolean =>
  a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

const contains = (a: Region, b: Region): boolean =>
  a.x0 <= b.x0 && a.y0 <= b.y0 && a.x1 >= b.x1 && a.y1 >= b.y1;

/**
 * Pairwise arrangement, as sentences.
 *
 * Only the relations that survive being said out loud: containment, overlap,
 * and the four sides. Distance is not one of them — "0.4 of the canvas apart"
 * is a measurement wearing a word's clothes, and the drawer has a grid of its
 * own to decide spacing on.
 */
const adjacency = (found: Region[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < found.length; i += 1) {
    for (let j = i + 1; j < found.length; j += 1) {
      const a = found[i];
      const b = found[j];
      const label = `block ${j + 1}`;
      const other = `block ${i + 1}`;
      if (contains(a, b)) {
        out.push(`${label} sits inside ${other}`);
        continue;
      }
      if (contains(b, a)) {
        out.push(`${other} sits inside ${label}`);
        continue;
      }
      if (overlaps(a, b)) {
        out.push(`${label} overlaps ${other}`);
        continue;
      }
      const acx = (a.x0 + a.x1) / 2;
      const bcx = (b.x0 + b.x1) / 2;
      const acy = (a.y0 + a.y1) / 2;
      const bcy = (b.y0 + b.y1) / 2;
      const side =
        Math.abs(bcx - acx) >= Math.abs(bcy - acy)
          ? (bcx > acx && "right of") || "left of"
          : (bcy > acy && "below") || "above";
      out.push(`${label} sits ${side} ${other}`);
    }
  }
  return out;
};

/** A block's silhouette, normalised to its own box: position- and
 *  scale-independent, which is the only sense in which it can be compared to a
 *  part drawn somewhere else at some other size. */
const blockMask = (r: Region): number[] => {
  const w = r.x1 - r.x0 + 1;
  const h = r.y1 - r.y0 + 1;
  const out = Array.from({ length: MASK * MASK }, () => 0);
  for (let y = 0; y < MASK; y += 1) {
    for (let x = 0; x < MASK; x += 1) {
      const sx = r.x0 + Math.min(w - 1, Math.floor((x / MASK) * w));
      const sy = r.y0 + Math.min(h - 1, Math.floor((y / MASK) * h));
      out[y * MASK + x] = r.mask[sy * GRID + sx];
    }
  }
  return out;
};

/** Rasterised part silhouettes, keyed by path data so a vocabulary reused
 *  across a whole benchmark run is rendered once. */
const partCache = new Map<string, number[]>();

const partMask = async (p: Part): Promise<number[]> => {
  const hit = partCache.get(p.d);
  if (hit) {
    return hit;
  }
  const b = bbox(parsePath(p.d));
  // One stroke width of padding, so a mark's own stroke is inside the box it is
  // measured in — the same reason `lint.ts` inflates a path bbox before
  // comparing it to anything.
  const pad = 1;
  const view = `${b.x0 - pad} ${b.y0 - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}"><path d="${p.d}" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const raw = await sharp(Buffer.from(svg), { density: 300 })
    .resize(MASK, MASK, { background: "#fff", fit: "fill" })
    .flatten({ background: "#fff" })
    .greyscale()
    .raw()
    .toBuffer();
  const out = Array.from(raw, (v) => ((255 - v) / 255 > INK ? 1 : 0));
  partCache.set(p.d, out);
  return out;
};

/**
 * Part ids whose mark resembles one of the blocks.
 *
 * Raster against raster, deliberately. The alternative — vectorise the block
 * and fingerprint it — is the tracer this project refuses, and it would buy
 * nothing: the output is a list of *names to search*, and a name is as good
 * arrived at by silhouette as by fingerprint.
 */
const shortlist = async (found: Region[], parts: Part[]): Promise<string[]> => {
  if (parts.length === 0) {
    return [];
  }
  // Candidates are gathered for every block before anything is rasterised, so
  // a part that suits two blocks is rendered once and the whole shortlist is
  // one round of work rather than one per block.
  const perBlock = found.map((r) => {
    const want = foldedAspect((r.x1 - r.x0 + 1) / Math.max(r.y1 - r.y0 + 1, 1));
    return parts
      .filter(
        (p) =>
          Math.abs(foldedAspect(p.w / Math.max(p.h, 0.001)) - want) <=
          ASPECT_TOLERANCE
      )
      .toSorted((a, b) => b.instances - a.instances)
      .slice(0, CANDIDATES);
  });
  const unique = [...new Map(perBlock.flat().map((p) => [p.d, p])).values()];
  const masks = new Map(
    await Promise.all(
      unique.map(async (p) => [p.d, await partMask(p)] as const)
    )
  );

  const scored = new Map<string, number>();
  for (const [i, r] of found.entries()) {
    const mine = blockMask(r);
    for (const p of perBlock[i]) {
      const score = cosine(mine, masks.get(p.d) ?? []);
      const key = p.name ?? p.id;
      if (score >= PART_FLOOR) {
        scored.set(key, Math.max(scored.get(key) ?? 0, score));
      }
    }
  }
  return [...scored.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, MAX_PARTS)
    .map(([id]) => id);
};

const thumbnail = async (image: Buffer): Promise<string> => {
  const png = await sharp(image, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize(THUMB, THUMB, { background: "#fff", fit: "contain" })
    .flatten({ background: "#fff" })
    .greyscale()
    .blur(THUMB_BLUR)
    .png()
    .toBuffer();
  return png.toString("base64");
};

export interface ComposeOptions {
  /** Cancels the optional vision reader; pixel-only work remains synchronous. */
  abortSignal?: AbortSignal;
  /**
   * A vision model to read the composition with, or null for the pixel reader
   * alone.
   *
   * Both readers emit the same closed vocabulary — the model's schema has no
   * free-text and no numeric field but block ordinals — so this changes how
   * well the composition is read and cannot change what a proposal may carry.
   * `assertNoGeometry` runs on the result either way.
   *
   * It is here because the pixel reader systematically under-segments the case
   * the arm exists for. A cloud drawn behind a folder is one connected region
   * of ink, so "cloud behind folder, two elements, one overlapping the other"
   * reads as "one dominant square" — the composition is exactly what is lost.
   * Splitting ink on strokes is the vectoriser this project refuses, so the
   * other way to count elements is to ask something that can see.
   */
  model?: string | null;
  /** Receives the live vision reader's billed operation. */
  onCost?: (cost: ApiCost) => void;
  /** The extracted vocabulary, for the part shortlist. Omit it and the
   *  proposal simply carries no part suggestions. */
  parts?: Part[];
}

const blockSchema = z.object({
  cell: z.enum([
    "bottom-left",
    "bottom-right",
    "bottom",
    "center",
    "left",
    "right",
    "top-left",
    "top-right",
    "top",
  ]),
  shape: z.enum(["square", "tall", "wide"]),
  size: z.enum(["dominant", "large", "medium", "small", "tiny"]),
});

/**
 * The only shape a vision model may answer in.
 *
 * There is no field here a coordinate fits in. `a` and `b` are ordinals into
 * the block list, the rest are enums, and the adjacency *sentences* are built
 * locally from the relation words rather than written by the model — so the
 * grammar `assertNoGeometry` enforces is one this file owns end to end.
 */
const readSchema = z.object({
  blocks: z.array(blockSchema).max(MAX_BLOCKS),
  relations: z
    .array(
      z.object({
        a: z.number().int().describe("1-based index of the first block"),
        b: z.number().int().describe("1-based index of the second block"),
        relation: z.enum([
          "above",
          "below",
          "inside",
          "left of",
          "overlaps",
          "right of",
        ]),
      })
    )
    .max(MAX_BLOCKS * MAX_BLOCKS),
});

const RELATION_SENTENCE: Record<string, (a: number, b: number) => string> = {
  above: (a, b) => `block ${a} sits above block ${b}`,
  below: (a, b) => `block ${a} sits below block ${b}`,
  inside: (a, b) => `block ${a} sits inside block ${b}`,
  "left of": (a, b) => `block ${a} sits left of block ${b}`,
  overlaps: (a, b) => `block ${a} overlaps block ${b}`,
  "right of": (a, b) => `block ${a} sits right of block ${b}`,
};

const READ_PROMPT = `This is a sketch of a single icon. Describe how it is
composed, and nothing else about it.

An element is a thing a designer would have drawn as one shape: a body, a
badge, a lid, a dial face, an arrow. Two shapes whose outlines touch or overlap
are still two elements. Count them the way the icon was composed, not the way
the ink connects.

For each element give its cell in a 3×3 grid, its size relative to the largest
element, and whether its silhouette is wide, tall or square. Then give how the
elements sit together. Order the elements largest first. Do not describe stroke
weight, style, subject matter or quality.`;

/** The vision reader. Returns null on any failure, so `compose` falls back to
 *  the pixel reader rather than losing the icon. */
const readWithModel = async (
  image: Buffer,
  model: string,
  onCost?: (cost: ApiCost) => void,
  abortSignal?: AbortSignal
): Promise<Pick<Proposal, "adjacency" | "blocks"> | null> => {
  try {
    abortSignal?.throwIfAborted();
    const costTracker = gatewayCostTracker();
    const result = await generateObject({
      abortSignal,
      messages: [
        {
          content: [
            { data: image, mediaType: "image/png", type: "file" },
            { text: READ_PROMPT, type: "text" },
          ],
          role: "user",
        },
      ],
      model: resolveModel(model),
      schema: readSchema,
    });
    costTracker.record(result.providerMetadata);
    onCost?.(
      await costTracker.measure({
        model,
        operation: "proposal-reading",
        usage: tokenUsageOf(result.usage),
      })
    );
    const n = result.object.blocks.length;
    return {
      adjacency: result.object.relations
        .filter(
          (r) => r.a >= 1 && r.a <= n && r.b >= 1 && r.b <= n && r.a !== r.b
        )
        .map((r) => RELATION_SENTENCE[r.relation](r.a, r.b)),
      blocks: result.object.blocks,
    };
  } catch {
    abortSignal?.throwIfAborted();
    return null;
  }
};

/** The words a `Proposal` is allowed to contain, for the runtime check. */
const CELLS: ReadonlySet<string> = new Set([
  "bottom-left",
  "bottom-right",
  "bottom",
  "center",
  "left",
  "right",
  "top-left",
  "top-right",
  "top",
]);
const BANDS: ReadonlySet<string> = new Set([
  "dominant",
  "large",
  "medium",
  "small",
  "tiny",
]);
const SHAPES: ReadonlySet<string> = new Set(["square", "tall", "wide"]);
/** Adjacency sentences, as a grammar: nothing else may be said. */
const ADJACENCY =
  /^block \d+ (?:sits (?:inside|left of|right of|above|below)|overlaps) block \d+$/u;

const bad = (why: string): never => {
  throw new Error(
    `proposal carries ${why}. A proposal may contain element counts, coarse ` +
      "cells, size bands, adjacency words, part ids and a blurred thumbnail, " +
      "and nothing else: a coordinate reaching a Canvas from a raster is the " +
      "one thing this pipeline exists to prevent."
  );
};

/**
 * The invariant, checked rather than asserted.
 *
 * The types already make a coordinate unrepresentable — every field is a word
 * from a closed set, a count, or an opaque raster. This runs the same check at
 * runtime, so a later widening ("just add the bounding box, it's only for
 * debugging") fails a test instead of quietly becoming a tracer. `propose`
 * calls it on every proposal it hands out.
 */
export const assertNoGeometry = (p: Proposal): void => {
  if (!Number.isInteger(p.elements) || p.elements !== p.blocks.length) {
    bad(`elements=${p.elements}, which is not the block count`);
  }
  for (const b of p.blocks) {
    if (!CELLS.has(b.cell)) {
      bad(`the cell "${b.cell}", which is not one of the nine`);
    }
    if (!BANDS.has(b.size)) {
      bad(`the size "${b.size}", which is not one of the bands`);
    }
    if (!SHAPES.has(b.shape)) {
      bad(`the shape "${b.shape}", which is not one of the three`);
    }
    if (Object.keys(b).length !== 3) {
      bad(`a block with the extra field(s) ${Object.keys(b).join(", ")}`);
    }
  }
  for (const line of p.adjacency) {
    if (!ADJACENCY.test(line)) {
      bad(
        `the adjacency line "${line}", which is not one of the six relations`
      );
    }
  }
  for (const id of p.parts) {
    if (/\d+\.\d/u.test(id)) {
      bad(`the part id "${id}", which reads as a measurement`);
    }
  }
};

/**
 * Read a proposal image into words.
 *
 * The picture goes in; nothing that came out of it can be drawn with. This is
 * the whole of the raster's contribution to the icon.
 */
export const compose = async (
  image: Buffer,
  { abortSignal, model = null, onCost, parts = [] }: ComposeOptions = {}
): Promise<Proposal> => {
  abortSignal?.throwIfAborted();
  // The regions are computed whichever reader is used: the part shortlist is a
  // silhouette question, and a silhouette is a thing the pixels answer better
  // than a description of them does.
  const found = regions(await inkMap(image));
  const largest = Math.max(
    1,
    ...found.map((r) => Math.max(r.x1 - r.x0, r.y1 - r.y0))
  );
  const pixels = {
    adjacency: adjacency(found),
    blocks: found.map((r) => ({
      cell: cellName((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2),
      shape: shapeWord(r.x1 - r.x0 + 1, r.y1 - r.y0 + 1),
      size: sizeBand(Math.max(r.x1 - r.x0, r.y1 - r.y0), largest),
    })),
  };
  const read =
    (model ? await readWithModel(image, model, onCost, abortSignal) : null) ??
    pixels;
  const proposal: Proposal = {
    ...read,
    elements: read.blocks.length,
    parts: await shortlist(found, parts),
    thumbnail: await thumbnail(image),
  };
  assertNoGeometry(proposal);
  return proposal;
};

/** The proposal as the model reads it: the words, without the thumbnail, which
 *  is attached as an image rather than described. */
export const describeProposal = (p: Proposal): string => {
  if (p.elements === 0) {
    return "The proposal came back empty — draw the concept without it.";
  }
  const blocks = p.blocks
    .map((b, i) => `- block ${i + 1}: ${b.size}, ${b.shape}, sitting ${b.cell}`)
    .join("\n");
  const near =
    p.parts.length > 0
      ? `\n\nParts whose shape resembles a block: ${p.parts.join(", ")}. Search them with listParts before drawing anything from scratch.`
      : "";
  return `${p.elements} element(s):\n${blocks}${p.adjacency.length > 0 ? `\n\nArrangement:\n${p.adjacency.map((a) => `- ${a}`).join("\n")}` : ""}${near}`;
};

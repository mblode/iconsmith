/**
 * The reconstruction eval.
 *
 * Hold out icons a real set already draws, hand the model only the name, the
 * category and the tags, and see how close what it draws lands to what the set
 * actually shipped. The target is never shown; if it were, this would measure
 * copying.
 *
 * **A score on its own says nothing.** 0.69 is either good or terrible
 * depending on what the scale means here, so every run reports four numbers:
 *
 *   floor      a random icon from the set against the target — what "no
 *              information" scores, given that all icons share a canvas, a
 *              stroke width and a lot of white
 *   baseline   0.737, the measured median rendered cosine between two mature
 *              icon sets drawing the same concept. This is the target: it is
 *              what "a different professional set's take on this concept"
 *              scores, and it is the most a reconstruction can honestly aim at
 *   treatment  what this pipeline scored
 *   ceiling    1.0, the target against itself
 *
 * Treatment near the ceiling is not success, it is a bug — most likely the
 * target leaking into the prompt or the two SVGs being the same file.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { LanguageModel } from "ai";

import { cosine, inkVector } from "../tools/render.js";
import type { Part } from "../types.js";
import { generate, resolveModel } from "./generate.js";
import type { GenerateOptions, GenerateResult } from "./generate.js";
import type { Concept } from "./prompt.js";
import type { Neighbour } from "./tools.js";

/** Median rendered cosine between two mature sets drawing the same concept. */
export const BASELINE = 0.737;
export const CEILING = 1;
/** Above this, disbelieve the run before believing the pipeline. */
const SUSPICIOUS = 0.95;

export interface EvalIcon {
  category?: string;
  icon: string;
  svg: string;
  tags: string[];
}

export interface LoadOptions {
  /** Per-icon metadata: `{ icon, category, tags }`. Default `<dir>/icons-data`. */
  dataDir?: string;
  /** Outline SVGs. Default `<dir>/icons-svg`. */
  svgDir?: string;
}

/**
 * Read an icon set laid out as blode-icons is: SVGs beside per-icon metadata.
 * Filled twins are skipped — they are a second rendering of an icon already in
 * the set, not a second icon, and scoring against one measures fill.
 */
export const loadIconSet = (
  dir: string,
  options: LoadOptions = {}
): EvalIcon[] => {
  const svgDir = options.svgDir ?? path.join(dir, "icons-svg");
  const dataDir = options.dataDir ?? path.join(dir, "icons-data");
  const out: EvalIcon[] = [];
  for (const file of readdirSync(svgDir)) {
    if (!file.endsWith(".svg") || file.endsWith("-filled.svg")) {
      continue;
    }
    const icon = path.basename(file, ".svg");
    let meta: { category?: string; tags?: string[] } = {};
    try {
      meta = JSON.parse(
        readFileSync(path.join(dataDir, `${icon}.json`), "utf-8")
      );
    } catch {
      // Metadata is optional: an icon with no tags is still a valid target,
      // just a harder one. Dropping it would quietly bias the sample toward
      // well-documented icons.
    }
    out.push({
      category: meta.category,
      icon,
      svg: readFileSync(path.join(svgDir, file), "utf-8"),
      tags: meta.tags ?? [],
    });
  }
  return out.toSorted((a, b) => a.icon.localeCompare(b.icon));
};

/** Modulus of the LCG below: 2^31, which stays exact in a double through the
 *  multiply. */
const LCG_M = 2_147_483_648;

/**
 * Deterministic PRNG, so a held-out sample is reproducible from its seed. A
 * plain LCG: this shuffles a list and picks a comparison icon, and nothing
 * about either needs statistical quality — only that two runs of one seed
 * agree.
 */
const rng = (seed: number): (() => number) => {
  let s = Math.abs(Math.trunc(seed)) % LCG_M;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % LCG_M;
    return s / LCG_M;
  };
};

export const holdOut = <T>(items: T[], n: number, seed: number): T[] => {
  const random = rng(seed);
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
};

export const median = (xs: number[]): number => {
  if (xs.length === 0) {
    return 0;
  }
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export interface IconScore {
  category?: string;
  /** Lint had no errors. */
  clean: boolean;
  /** Set when generation threw; `score` is then 0. */
  error?: string;
  /** A random other icon against the target — this icon's share of the floor. */
  floor: number;
  icon: string;
  issues: number;
  score: number;
  steps: number;
  tags: string[];
}

export interface EvalReport {
  baseline: number;
  ceiling: number;
  /** Median floor across the sample. */
  floor: number;
  icons: IconScore[];
  mean: number;
  model: string;
  n: number;
  seed: number;
  /** Set when the result is too good to be true. */
  suspect: string | null;
  /** Median score across the sample — median, to match how the baseline was
   *  measured. Comparing a mean against a median baseline is not a comparison. */
  treatment: number;
}

/** The seam every test reaches through: swap the generator, keep the scoring. */
export type GenerateFn = (
  concept: Concept,
  options: GenerateOptions
) => Promise<GenerateResult>;

export interface EvalOptions {
  concurrency?: number;
  /** Root of the icon set, or pass `icons` directly. */
  dir?: string;
  generate?: GenerateFn;
  icons?: EvalIcon[];
  load?: LoadOptions;
  maxSteps?: number;
  model?: LanguageModel;
  n?: number;
  onIcon?: (score: IconScore) => void;
  parts?: Part[];
  seed?: number;
}

/** Fixed-size worker pool. Generations are long and network-bound; running them
 *  one at a time makes a 20-icon eval an afternoon. */
const pool = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const out: R[] = Array.from({ length: items.length });
  let cursor = 0;
  // Each worker takes the next index and recurses rather than looping, so the
  // await is not inside a loop; the recursion is one frame per item a single
  // worker handles, and every frame is released at its await.
  const worker = async (): Promise<void> => {
    const i = cursor;
    if (i >= items.length) {
      return;
    }
    cursor += 1;
    out[i] = await fn(items[i], i);
    await worker();
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)
  );
  return out;
};

export const evaluate = async (options: EvalOptions): Promise<EvalReport> => {
  const {
    concurrency = 2,
    dir,
    generate: gen = generate,
    load,
    maxSteps,
    model,
    n = 10,
    onIcon,
    parts = [],
    seed = 1,
  } = options;

  const all = options.icons ?? (dir ? loadIconSet(dir, load) : []);
  if (all.length === 0) {
    throw new Error("No icons to evaluate: pass `dir` or `icons`.");
  }
  // Resolved once, before any work: a missing key should fail on the first line
  // of output, not `n` times after the first generation has already run.
  const resolved = resolveModel(model);
  const held = holdOut(all, n, seed);
  const heldNames = new Set(held.map((i) => i.icon));

  // The corpus the model may compare against excludes every held-out icon.
  // Leaving them in would hand it the answer through the back door.
  const corpus: Neighbour[] = all
    .filter((i) => !heldNames.has(i.icon))
    .map((i) => ({ name: i.icon, svg: i.svg, tags: i.tags }));

  // A second stream, so the floor's choices do not shift when the holdout does.
  const floorRandom = rng(seed + 7919);

  const scores = await pool(held, concurrency, async (target) => {
    // The floor: a random icon that is not the target, scored the same way. It
    // moves with the set, which a hardcoded constant would not. Drawn from the
    // whole set rather than the corpus, so holding out everything still leaves
    // a floor to compare against.
    const others = all.filter((i) => i.icon !== target.icon);
    const other = others[Math.floor(floorRandom() * others.length)];
    const [targetInk, otherInk] = await Promise.all([
      inkVector(target.svg),
      other ? inkVector(other.svg) : Promise.resolve([]),
    ]);
    const base: IconScore = {
      category: target.category,
      clean: false,
      floor: cosine(otherInk, targetInk),
      icon: target.icon,
      issues: 0,
      score: 0,
      steps: 0,
      tags: target.tags,
    };

    let out: IconScore;
    try {
      const result = await gen(
        {
          category: target.category,
          name: target.icon,
          tags: target.tags,
        },
        { corpus, maxSteps, model: resolved, parts }
      );
      out = {
        ...base,
        clean: result.clean,
        issues: result.issues.length,
        score: cosine(await inkVector(result.svg), targetInk),
        steps: result.steps,
      };
    } catch (error) {
      out = { ...base, error: (error as Error).message };
    }
    onIcon?.(out);
    return out;
  });

  const values = scores.map((s) => s.score);
  const treatment = median(values);
  return {
    baseline: BASELINE,
    ceiling: CEILING,
    floor: median(scores.map((s) => s.floor)),
    icons: scores.toSorted((a, b) => a.score - b.score),
    mean: values.reduce((a, b) => a + b, 0) / (values.length || 1),
    model: typeof resolved === "string" ? resolved : resolved.modelId,
    n: scores.length,
    seed,
    suspect:
      treatment > SUSPICIOUS
        ? `Treatment ${treatment.toFixed(3)} is above ${SUSPICIOUS} — two mature sets drawing the same concept only reach ${BASELINE}. Suspect the target leaking into the prompt or into the corpus before believing this.`
        : null,
    treatment,
  };
};

const bar = (v: number): string =>
  "█".repeat(Math.round(v * 30)).padEnd(30, "·");

export const formatReport = (report: EvalReport): string => {
  const row = (label: string, v: number, note: string) =>
    `  ${label.padEnd(10)} ${v.toFixed(3)}  ${bar(v)}  ${note}`;
  const clean = report.icons.filter((i) => i.clean).length;
  const failed = report.icons.filter((i) => i.error);
  const lines = [
    `reconstruction eval — ${report.n} icons, ${report.model}, seed ${report.seed}`,
    "",
    row("floor", report.floor, "a random icon against the target"),
    row("baseline", report.baseline, "two mature sets, same concept"),
    row("treatment", report.treatment, "this pipeline (median)"),
    row("ceiling", report.ceiling, "the target against itself"),
    "",
    `  mean ${report.mean.toFixed(3)} · ${clean}/${report.n} lint clean · ${median(report.icons.map((i) => i.steps)).toFixed(0)} steps median`,
  ];
  if (report.suspect) {
    lines.push("", `  ! ${report.suspect}`);
  }
  if (failed.length) {
    lines.push(
      "",
      `  ${failed.length} failed to generate:`,
      ...failed.map((f) => `    ${f.icon}: ${f.error}`)
    );
  }
  const worst = report.icons.filter((i) => !i.error).slice(0, 5);
  if (worst.length) {
    lines.push(
      "",
      "  weakest reconstructions:",
      ...worst.map(
        (i) =>
          `    ${i.score.toFixed(3)}  ${i.icon}${i.clean ? "" : "  (lint errors)"}`
      )
    );
  }
  return lines.join("\n");
};

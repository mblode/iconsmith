/**
 * The registration bake-off.
 *
 * `stress-cosine.ts` found one inversion in the rendered-cosine metric: moving
 * the whole icon 1 unit — which changes no drawing — costs more than deleting
 * an element outright. This runs that same battery under candidate
 * registration-invariant scores, so the choice between them is made on the
 * corpus rather than on an argument.
 *
 * The perturbations, the sampling order, the seeds and the rasteriser are the
 * ones `stress-cosine.ts` uses, imported rather than restated: only the
 * comparison of the two rasters changes, which is the whole point of the
 * comparison. Its `plain` column reproduces `bench/stress-cosine.v1.json`
 * number for number at `--n 300 --seed 1`, which is what says the harness was
 * copied faithfully rather than rewritten.
 *
 *     npx tsx scripts/stress-registration.ts [--n 300] [--seed 1] [--output json]
 *
 * Local rasterising and arithmetic. No model is called and nothing is written.
 */
import { parseArgs } from "node:util";

import type { CorpusIcon } from "../src/corpus/load.js";
import { HOUSE_VARIANT, loadCorpus } from "../src/corpus/load.js";
import { median } from "../src/eval/panel.js";
import { auc, separation } from "../src/eval/separation.js";
import { centroidCosine, registeredCosine } from "../src/tools/registration.js";
import { cosine, inkVector } from "../src/tools/render.js";
import { growDot, PERTURBATIONS, toSvg } from "./stress-cosine.js";

type Family = "breaking" | "preserving";

/** The scores under test. Each takes two ink vectors and returns a similarity;
 *  `plain` is the committed metric, kept in the table as the control. */
const SCORES: { how: (a: number[], b: number[]) => number; name: string }[] = [
  { how: cosine, name: "plain" },
  { how: (a, b) => registeredCosine(a, b, 1), name: "window-1px" },
  { how: (a, b) => registeredCosine(a, b, 2), name: "window-2px" },
  { how: (a, b) => registeredCosine(a, b, 3), name: "window-3px" },
  { how: (a, b) => registeredCosine(a, b, 4), name: "window-4px" },
  { how: (a, b) => registeredCosine(a, b, 6), name: "window-6px" },
  { how: centroidCosine, name: "centroid" },
  {
    how: (a, b) => Math.max(cosine(a, b), centroidCosine(a, b)),
    name: "centroid-max",
  },
];

// ---------------------------------------------------------------------------
// Copied from stress-cosine.ts, which does not export them. Copied rather than
// re-derived: a different shuffle or a different seed is a different sample,
// and the two runs would stop being comparable without saying so.
// ---------------------------------------------------------------------------

const rng = (seed: number): (() => number) => {
  let s = Math.abs(Math.trunc(seed)) % 2_147_483_648;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
};

const hash = (text: string): number => {
  let h = 7;
  for (const ch of text) {
    h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 2_147_483_647;
  }
  return h;
};

const shuffledIndices = (n: number, random: () => number): number[] => {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const stroked = (icon: CorpusIcon): boolean =>
  icon.shapes.length > 0 &&
  icon.shapes.every((s) => !s.filled && s.strokeWidth > 0);

const usable = (icon: CorpusIcon): boolean =>
  stroked(icon) && icon.shapes.length >= 2;

const percentile = (xs: readonly number[], p: number): number => {
  if (xs.length === 0) {
    return 0;
  }
  const s = xs.toSorted((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};

interface Spread {
  max: number;
  median: number;
  min: number;
  n: number;
  p25: number;
  p75: number;
}

const spread = (xs: readonly number[]): Spread => ({
  max: xs.length > 0 ? Math.max(...xs) : 0,
  median: median(xs),
  min: xs.length > 0 ? Math.min(...xs) : 0,
  n: xs.length,
  p25: percentile(xs, 0.25),
  p75: percentile(xs, 0.75),
});

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** One perturbed icon, scored every way at once. The rasters are the expensive
 *  part and they do not depend on the score, so they are made once. */
interface Measured {
  by: Record<string, number>;
  perturbation: string;
  symbol: string;
}

const DOT = "dot-two-tiers";

const measureIcon = async (
  icon: CorpusIcon,
  wanted: (name: string) => boolean
): Promise<Measured[]> => {
  const reference = await inkVector(toSvg(icon.shapes));
  const out: Measured[] = [];
  for (const p of PERTURBATIONS) {
    if (!wanted(p.name)) {
      continue;
    }
    const next = p.apply(icon.shapes, rng(hash(`${icon.symbol}/${p.name}`)));
    if (!next || next.length === 0) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- one raster at a time
    const ink = await inkVector(toSvg(next));
    const by: Record<string, number> = {};
    for (const s of SCORES) {
      by[s.name] = s.how(reference, ink);
    }
    out.push({ by, perturbation: p.name, symbol: icon.symbol });
  }
  return out;
};

const familyOf = (name: string): Family =>
  PERTURBATIONS.find((p) => p.name === name)?.family ?? "breaking";

interface ScoreReport {
  families: Record<Family, Spread>;
  inversions: string[];
  name: string;
  perturbations: {
    auc: number;
    family: Family;
    name: string;
    spread: Spread;
  }[];
  separation: ReturnType<typeof separation>;
}

const analyse = (name: string, scores: readonly Measured[]): ScoreReport => {
  const at = (m: Measured) => m.by[name];
  const familyScores = (family: Family) =>
    scores.filter((s) => familyOf(s.perturbation) === family).map(at);
  const preserving = familyScores("preserving");
  const breaking = familyScores("breaking");
  const perturbations = PERTURBATIONS.map((p) => {
    const own = scores.filter((s) => s.perturbation === p.name).map(at);
    const other = p.family === "preserving" ? breaking : preserving;
    return {
      auc: p.family === "preserving" ? auc(own, other) : auc(other, own),
      family: p.family,
      name: p.name,
      spread: spread(own),
    };
  });
  const inversions: string[] = [];
  for (const kept of perturbations.filter((p) => p.family === "preserving")) {
    for (const broke of perturbations.filter((p) => p.family === "breaking")) {
      if (kept.spread.median < broke.spread.median) {
        inversions.push(
          `${kept.name} (${kept.spread.median.toFixed(3)}) < ${broke.name} (${broke.spread.median.toFixed(3)})`
        );
      }
    }
  }
  return {
    families: { breaking: spread(breaking), preserving: spread(preserving) },
    inversions,
    name,
    perturbations,
    separation: separation(name, preserving, breaking),
  };
};

/** The scores whose per-observation values are kept in the written report. */
const KEPT = ["plain", "window-2px", "centroid"];

const PROCEDURE =
  "The `scripts/stress-cosine.ts` battery, unchanged — same perturbations, same sample, same seeds, same rasteriser (SIZE 48, BLUR 1.6, density 200) — with only the comparison of the two ink vectors swapped. Each perturbed icon is rastered once and scored by every candidate, so the candidates are compared on identical observations rather than on separate runs. `plain` is `render.ts`'s committed cosine and reproduces `bench/stress-cosine.v1.json` exactly at --n 300 --seed 1, which is what says the harness was copied faithfully. `window-Npx` is the maximum cosine over whole-pixel offsets of up to N in x and y (2px = 1 canvas unit); `centroid` aligns the two ink centres of mass, rounded to the pixel; `centroid-max` takes the better of centroid and no shift. Per-perturbation AUC is that perturbation against the pooled opposite family, as in the original.";

const run = async (args: { corpus: string; n: number; seed: number }) => {
  const corpus = await loadCorpus(args.corpus);
  const order = shuffledIndices(corpus.symbols.length, rng(args.seed));
  const scores: Measured[] = [];
  const sampled: CorpusIcon[] = [];

  for (const i of order) {
    if (sampled.length >= args.n) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop -- the sample stops at n
    const icon = await corpus.load(corpus.symbols[i], HOUSE_VARIANT);
    if (!usable(icon)) {
      continue;
    }
    sampled.push(icon);
    // oxlint-disable-next-line no-await-in-loop -- see above
    scores.push(...(await measureIcon(icon, (name) => name !== DOT)));
  }

  for (const i of order) {
    // oxlint-disable-next-line no-await-in-loop -- one icon at a time, as above
    const icon = await corpus.load(corpus.symbols[i], HOUSE_VARIANT);
    if (
      !stroked(icon) ||
      !growDot(icon.shapes, rng(hash(`${icon.symbol}/${DOT}`)))
    ) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- see above
    scores.push(...(await measureIcon(icon, (name) => name === DOT)));
  }

  // Unrelated icons, scored every way. Context, not a family: it says what
  // registration does to the *bottom* of the scale, which is what decides
  // whether a reach computed against the old baseline still means anything.
  const unrelated: Record<string, number[]> = {};
  for (let i = 0; i + 1 < sampled.length; i += 2) {
    // oxlint-disable-next-line no-await-in-loop -- two rasters at a time
    const [a, b] = await Promise.all([
      inkVector(toSvg(sampled[i].shapes)),
      inkVector(toSvg(sampled[i + 1].shapes)),
    ]);
    for (const s of SCORES) {
      (unrelated[s.name] ??= []).push(s.how(a, b));
    }
  }

  return {
    builtAt: new Date().toISOString(),
    /** Every observation, so "what is the AUC without X" can be answered
     *  without re-running — but only under the three scores anyone will ask it
     *  of: the committed metric, the one this ships, and the one it beat. */
    observations: scores.map((s) => ({
      ...s,
      by: Object.fromEntries(KEPT.map((k) => [k, s.by[k]])),
    })),
    procedure: PROCEDURE,
    reference: Object.fromEntries(
      SCORES.map((s) => [s.name, spread(unrelated[s.name] ?? [])])
    ),
    reports: SCORES.map((s) => analyse(s.name, scores)),
    sample: { icons: sampled.length, seed: args.seed, variant: HOUSE_VARIANT },
  };
};

const f = (n: number): string => n.toFixed(3);

const print = (report: Awaited<ReturnType<typeof run>>): void => {
  const lines: string[] = [
    `registration bake-off — ${report.sample.icons} icons of ${report.sample.variant}, seed ${report.sample.seed}`,
  ];
  for (const r of report.reports) {
    lines.push(
      "",
      `## ${r.name}  pooled AUC ${f(r.separation.auc)}`,
      "perturbation          family      n   median    p25    p75    min    AUC"
    );
    for (const p of r.perturbations) {
      lines.push(
        [
          p.name.padEnd(21),
          p.family.padEnd(11),
          String(p.spread.n).padStart(3),
          f(p.spread.median).padStart(8),
          f(p.spread.p25).padStart(7),
          f(p.spread.p75).padStart(6),
          f(p.spread.min).padStart(7),
          f(p.auc).padStart(7),
        ].join(" ")
      );
    }
    lines.push(
      `preserving median ${f(r.families.preserving.median)}  breaking median ${f(r.families.breaking.median)}`,
      r.inversions.length > 0
        ? `INVERTED: ${r.inversions.join("; ")}`
        : "no inversions"
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
};

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      corpus: { default: "corpus", type: "string" },
      n: { default: "150", type: "string" },
      output: { default: "text", type: "string" },
      seed: { default: "1", type: "string" },
    },
  });
  const report = await run({
    corpus: values.corpus,
    n: Number(values.n),
    seed: Number(values.seed),
  });
  if (values.output === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    print(report);
  }
};

if (process.argv[1]?.endsWith("stress-registration.ts")) {
  await main();
}

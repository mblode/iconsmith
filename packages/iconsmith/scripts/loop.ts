/**
 * One iteration of the improvement loop.
 *
 * Propose a policy variant, measure it against the incumbent on the same
 * icons and the same seeds, and accept only if the win survives every gate.
 *
 * The gates are the point. A scorer with a known inverted gradient will be
 * exploited by anything that optimises against it, so acceptance is not "the
 * number went up": it is a paired test, a minimum effect the metric can
 * actually resolve, and no regression on the things cosine cannot see.
 *
 * This script REFUSES TO RUN without a calibration file. An uncalibrated loop
 * accepts noise and calls it progress, and it does so at machine speed.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { evaluate, scored } from "../src/pipeline/eval.js";
import type { IconScore } from "../src/pipeline/eval.js";
import { DEFAULT_POLICY, setEnabled } from "../src/pipeline/policy.js";
import type { Policy } from "../src/pipeline/policy.js";

const erf = (x: number): number => {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-a * a);
  return s * y;
};

/** Paired one-sided Wilcoxon signed-rank. Ties dropped, average ranks. */
export const wilcoxon = (deltas: number[]): { n: number; p: number } => {
  const nonZero = deltas.filter((d) => d !== 0);
  const n = nonZero.length;
  if (n < 6) {
    return { n, p: 1 };
  }
  const byAbs = nonZero
    .map((d, i) => ({ abs: Math.abs(d), i, sign: Math.sign(d) }))
    .toSorted((a, b) => a.abs - b.abs);
  const ranks: number[] = Array.from({ length: n }, () => 0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && byAbs[j + 1].abs === byAbs[i].abs) {
      j += 1;
    }
    const avg = (i + j + 2) / 2;
    for (let k = i; k <= j; k += 1) {
      ranks[k] = avg;
    }
    i = j + 1;
  }
  let wPlus = 0;
  for (let k = 0; k < n; k += 1) {
    if (byAbs[k].sign > 0) {
      wPlus += ranks[k];
    }
  }
  // Normal approximation with continuity correction; n>=6 by the guard above.
  const mean = (n * (n + 1)) / 4;
  const sd = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24);
  const z = (wPlus - mean - 0.5) / sd;
  const p = 0.5 * (1 - erf(z / Math.SQRT2));
  return { n, p };
};

const byIcon = (scores: readonly IconScore[]): Map<string, number> => {
  const out = new Map<string, number>();
  for (const s of scores) {
    if (scored(s)) {
      out.set(s.icon, s.score);
    }
  }
  return out;
};

const median = (sorted: readonly number[]): number => {
  if (sorted.length === 0) {
    return 0;
  }
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
};

const cleanRate = (s: readonly IconScore[]): number =>
  s.length === 0 ? 0 : s.filter((x) => scored(x) && x.clean).length / s.length;

/**
 * Three outcomes, not two, and `crash` is not a bad score.
 *
 * An arm that lost generations did not draw badly — it did not draw. Letting
 * it compete on a median computed from whatever survived is how an infra
 * wobble gets recorded as evidence about a design language. autoresearch
 * makes the same split: `keep | discard | crash`, with crashes counted as
 * failures rather than scored.
 */
export type Status = "crash" | "discard" | "keep";

export interface Verdict {
  accepted: boolean;
  cleanDelta: number;
  medianDelta: number;
  n: number;
  p: number;
  reasons: string[];
  status: Status;
}

/** The acceptance rule, separated from the running so it can be tested. */
export const judge = (
  champion: readonly IconScore[],
  variant: readonly IconScore[],
  noiseFloor: number,
  errors?: { champion: number; variant: number }
): Verdict => {
  const a = byIcon(champion);
  const b = byIcon(variant);
  const deltas: number[] = [];
  for (const [icon, before] of a) {
    const after = b.get(icon);
    if (after !== undefined) {
      deltas.push(after - before);
    }
  }
  const medianDelta = median(deltas.toSorted((x, y) => x - y));
  const { n, p } = wilcoxon(deltas);
  const cleanDelta = cleanRate(variant) - cleanRate(champion);

  const reasons: string[] = [];

  // Checked before anything is scored: a run that lost generations is not a
  // run that scored badly, and the two must not be averaged into one number.
  const lost = (errors?.champion ?? 0) + (errors?.variant ?? 0);
  if (lost > 0) {
    return {
      accepted: false,
      cleanDelta,
      medianDelta,
      n,
      p,
      reasons: [
        `${lost} generation(s) errored (${errors?.champion ?? 0} champion, ${errors?.variant ?? 0} variant). The arms did not both run; find out why before comparing them.`,
      ],
      status: "crash",
    };
  }

  if (deltas.length === 0) {
    reasons.push("no paired icons — the arms did not draw the same set");
  }
  if (medianDelta < noiseFloor) {
    reasons.push(
      `median delta ${medianDelta.toFixed(4)} is under the measured noise floor ${noiseFloor.toFixed(4)}, so it carries no information about drawing quality`
    );
  }
  if (p >= 0.05) {
    reasons.push(`paired signed-rank p=${p.toFixed(3)} is not below 0.05`);
  }
  if (cleanDelta < 0) {
    reasons.push(
      `lint-clean rate fell by ${Math.abs(cleanDelta).toFixed(3)} — a score bought by drawing worse is not a win`
    );
  }
  return {
    accepted: reasons.length === 0,
    cleanDelta,
    medianDelta,
    n,
    p,
    reasons,
    status: reasons.length === 0 ? "keep" : "discard",
  };
};

const LEDGER = path.join(import.meta.dirname, "..", "bench", "ledger.jsonl");

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
  };

  const calibrationPath =
    arg("calibration") ??
    path.join(import.meta.dirname, "..", "bench", "noise-floor.json");
  if (!existsSync(calibrationPath)) {
    process.stderr.write(
      `No calibration at "${calibrationPath}".\n\n` +
        "The acceptance threshold IS the measured seed-to-seed spread, so a run\n" +
        "without one cannot tell a real gain from noise — it would accept noise\n" +
        "and call it progress. Measure it first:\n\n" +
        "  iconsmith eval --dir <set> --slice 30 --seeds 1,2,3 --max-spend <usd>\n\n" +
        'then write the spread to that path as { "noiseFloor": <number> }.\n'
    );
    process.exit(2);
  }
  const { noiseFloor } = JSON.parse(readFileSync(calibrationPath, "utf-8")) as {
    noiseFloor: number;
  };

  const enable = (arg("enable") ?? "").split(",").filter(Boolean);
  if (enable.length === 0) {
    process.stderr.write(
      "Pass --enable <principle-id,...> to form a variant.\n"
    );
    process.exit(2);
  }
  let variantPolicy: Policy = DEFAULT_POLICY;
  for (const id of enable) {
    variantPolicy = setEnabled(variantPolicy, id, true);
  }

  const common = {
    benchmark: JSON.parse(
      readFileSync(
        arg("bench") ??
          path.join(import.meta.dirname, "..", "bench", "reconstruction.json"),
        "utf-8"
      )
    ).entries.slice(0, Number(arg("slice") ?? 30)),
    dir: arg("dir") as string,
    maxSpendUsd: Number(arg("max-spend") ?? 5),
    model: arg("model"),
    seed: Number(arg("seed") ?? 1),
  };

  process.stderr.write("champion…\n");
  const champion = await evaluate(common);
  process.stderr.write("variant…\n");
  const variant = await evaluate({ ...common, policy: variantPolicy });

  const verdict = judge(champion.icons, variant.icons, noiseFloor, {
    champion: champion.benchmark.errors,
    variant: variant.benchmark.errors,
  });
  const entry = {
    accepted: verdict.accepted,
    championTreatment: champion.treatment,
    enabled: enable,
    medianDelta: verdict.medianDelta,
    n: verdict.n,
    noiseFloor,
    p: verdict.p,
    reasons: verdict.reasons,
    status: verdict.status,
    variantTreatment: variant.treatment,
  };
  appendFileSync(LEDGER, `${JSON.stringify(entry)}\n`);

  process.stdout.write(
    `${verdict.status.toUpperCase()}  median ${verdict.medianDelta.toFixed(4)}  p=${verdict.p.toFixed(3)}  n=${verdict.n}\n`
  );
  for (const r of verdict.reasons) {
    process.stdout.write(`  · ${r}\n`);
  }
};

if (process.argv[1]?.endsWith("loop.ts")) {
  await main();
}

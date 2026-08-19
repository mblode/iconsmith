/**
 * Run the judge's sanity gate and write the verdict into the calibration.
 *
 * Shown a shipped icon and an unrelated one, both for the same concept, the
 * judge has to prefer the shipped one at least 90% of the time. Below that its
 * column is discarded rather than discounted: a judge that cannot answer the
 * easy question is not a weak instrument, it is noise, and averaging noise into
 * a headline moves the headline for reasons nobody can recover.
 *
 * This is the only part of the panel that costs money. It is deliberately one
 * cheap call per trial with no retries.
 *
 *     npx tsx scripts/judge-gate.ts [--n 30] [--model claude-haiku-4-5-20251001]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { runGate } from "../src/eval/judge-model.js";
import type { GateItem } from "../src/eval/judge-model.js";
import { scoreGate } from "../src/eval/judge.js";
import { loadRecords } from "../src/pipeline/bench.js";
import { resolveModel } from "../src/pipeline/generate.js";

const STORE = ".corpus";
const OUT = "bench/calibration.v1.json";
const HOUSE = "blode-icons";

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

const n = Number(arg("n", "30"));
const seed = Number(arg("seed", "1"));
/** A namespaced id routes through the AI Gateway; a bare one needs an Anthropic
 *  key. Defaulting on which credential is present means the gate runs with
 *  whichever the machine has rather than failing on the one it does not. */
const modelId = arg(
  "model",
  process.env.AI_GATEWAY_API_KEY
    ? "anthropic/claude-haiku-4.5"
    : "claude-haiku-4-5-20251001"
);

const rng = (s0: number): (() => number) => {
  let s = Math.abs(Math.trunc(s0)) % 2_147_483_648;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
};

const main = async (): Promise<void> => {
  const manifest = JSON.parse(
    readFileSync(path.join(STORE, "manifest.json"), "utf-8")
  ) as { sources: { id: string; root: string }[] };
  const root =
    manifest.sources.find((s) => s.id === HOUSE)?.root ??
    (() => {
      throw new Error(`no ${HOUSE} source in ${STORE}/manifest.json`);
    })();

  const records = loadRecords(path.join(STORE, "icons.jsonl")).filter(
    (r) => r.provenance.set === HOUSE
  );
  const svgOf = (slug: string): string =>
    readFileSync(path.join(root, "icons-svg", `${slug}.svg`), "utf-8");

  // The decoy is drawn from far away in the alphabetised set rather than at
  // random-with-replacement, so no trial ever pairs an icon with its own cohort
  // sibling and asks the judge to tell `folder-add` from `folder-cloud`. That
  // is a hard question; the gate is meant to be the easy one.
  const random = rng(seed);
  const chosen = new Set<number>();
  const items: GateItem[] = [];
  while (items.length < n && chosen.size < records.length) {
    const i = Math.floor(random() * records.length);
    if (chosen.has(i)) {
      continue;
    }
    chosen.add(i);
    const real = records[i];
    const j =
      (i + Math.floor(records.length / 2) + items.length) % records.length;
    const decoy = records[j];
    if (decoy.cohort !== null && decoy.cohort === real.cohort) {
      continue;
    }
    items.push({
      concept: real.slug.replaceAll("-", " "),
      decoy: svgOf(decoy.slug),
      icon: real.slug,
      real: svgOf(real.slug),
    });
  }

  process.stdout.write(`${items.length} trials against ${modelId}…\n`);
  const trials = await runGate(resolveModel(modelId), items, seed);
  const result = scoreGate(trials);
  process.stdout.write(`${result.verdict}\n`);
  for (const miss of trials.filter((t) => t.pick !== t.answer)) {
    process.stdout.write(
      `  missed: ${miss.icon} (picked ${miss.pick ?? "nothing"})\n`
    );
  }

  const calibration = JSON.parse(readFileSync(OUT, "utf-8")) as {
    judge?: { procedure?: string; runs?: unknown[] };
    [key: string]: unknown;
  };
  // Every run is kept, passes and failures alike. A gate file that held only
  // the model that passed would read as "the judge works" and hide that the
  // cheap model does not — which is the fact a reader needs before choosing one.
  const runs = calibration.judge?.runs ?? [];
  calibration.judge = {
    procedure:
      "Forced choice between the shipped icon for a concept and an icon of an " +
      "unrelated concept, presentation order randomised from the run seed. " +
      "Below 90% the judge column is discarded, not discounted.",
    runs: [
      ...runs.filter((r) => (r as { model?: string }).model !== modelId),
      {
        gate: result,
        measuredAt: new Date().toISOString(),
        missed: trials.filter((t) => t.pick !== t.answer).map((t) => t.icon),
        model: modelId,
        seed,
      },
    ],
  };
  writeFileSync(OUT, `${JSON.stringify(calibration, null, 2)}\n`);
  process.stdout.write(`${OUT} updated\n`);
  if (!result.passed) {
    process.exitCode = 1;
  }
};

await main();

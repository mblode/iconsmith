/**
 * Turn a seeded baseline run into the loop's acceptance threshold.
 *
 * `evaluate`'s seeded report already computes the number — the highest
 * per-seed treatment minus the lowest — and says what it is for: a later
 * change smaller than the spread has moved nothing. This lifts it out of the
 * run's prose and writes it where `scripts/loop.ts` looks, because a loop
 * that reads a threshold someone typed in is a loop that will be given a
 * flattering one.
 */
import { readFileSync, writeFileSync } from "node:fs";

const SPREAD = /^\s*spread\s+(?<value>[0-9]*\.?[0-9]+)/mu;
/** `reconstruction eval — 0/30 benchmark icons` — a replicate that never ran. */
const SAMPLE =
  /^reconstruction eval — (?<n>\d+)\/(?<of>\d+) benchmark icons/gmu;
const CAPPED = /Stopped after \$[\d.]+ of a \$[\d.]+ cap/u;
const TREATMENT = /^\s*treatment\s+(?<value>[0-9]*\.?[0-9]+)/mu;

export const parseSpread = (
  text: string
): { spread: number; treatment: number | null } => {
  // A replicate that drew nothing reports treatment 0.000, and that zero goes
  // straight into the spread — which is how a seed that never ran becomes a
  // noise floor of 0.672 and rejects every experiment forever. Same bug as an
  // errored generation scoring 0.0 into a median, one level up.
  const samples = [...text.matchAll(SAMPLE)].map((m) => Number(m.groups?.n));
  const empty = samples.filter((n) => n === 0).length;
  if (empty > 0) {
    throw new Error(
      `${empty} of ${samples.length} replicates drew no icons at all, and a replicate that did not run reports treatment 0.000 — which enters the spread as though it were a score. This run cannot produce a threshold. Re-run with a spend cap high enough for every seed.`
    );
  }
  if (samples.length > 1 && new Set(samples).size > 1) {
    throw new Error(
      `Replicates drew different numbers of icons (${samples.join(", ")}). Their treatments are medians over different samples, so the spread between them measures the sample, not the seed.`
    );
  }
  if (CAPPED.test(text)) {
    throw new Error(
      "This run hit its spend cap, so at least one replicate scored a prefix of the benchmark rather than the whole of it. The report says so itself: the sample is a prefix, and treatment is not comparable to a complete run."
    );
  }
  const s = SPREAD.exec(text);
  if (!s) {
    throw new Error(
      "No `spread` line in that run. The threshold is the seed-to-seed " +
        "spread, so a single-seed run cannot produce one — re-run with " +
        "`--seeds 1,2,3`."
    );
  }
  const t = TREATMENT.exec(text);
  return {
    spread: Number(s.groups?.value),
    treatment: t ? Number(t.groups?.value) : null,
  };
};

const main = (): void => {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    process.stderr.write(
      "usage: noise-floor.ts <eval-output.txt> [bench/noise-floor.json]\n"
    );
    process.exit(2);
  }
  const parsed = parseSpread(readFileSync(input, "utf-8"));
  const target = output ?? "bench/noise-floor.json";
  writeFileSync(
    target,
    `${JSON.stringify(
      {
        measuredFrom: input,
        noiseFloor: parsed.spread,
        note: "The loop rejects any median delta below this. It is the observed variation between identical runs, so a change smaller than it has moved nothing.",
        treatment: parsed.treatment,
      },
      null,
      2
    )}\n`
  );
  process.stdout.write(
    `noiseFloor ${parsed.spread.toFixed(4)} written to ${target}\n`
  );
};

if (process.argv[1]?.endsWith("noise-floor.ts")) {
  main();
}

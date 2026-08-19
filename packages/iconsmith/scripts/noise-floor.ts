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
const TREATMENT = /^\s*treatment\s+(?<value>[0-9]*\.?[0-9]+)/mu;

export const parseSpread = (
  text: string
): { spread: number; treatment: number | null } => {
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

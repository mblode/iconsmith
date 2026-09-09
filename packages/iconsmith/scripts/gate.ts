import { execFileSync } from "node:child_process";
/**
 * The gates the improvement loop does not get to write.
 *
 * The Darwin Gödel Machine faked a log showing tests had passed when they never
 * ran; instrumented against that and asked to fix it, it removed the markers
 * the reward function used to detect hallucination — "despite our explicit
 * instruction not to do so" (arXiv 2505.22954). An explicit natural-language
 * instruction did not hold. So nothing here asks: every check is a comparison
 * against a committed number, and every failure is an exit code.
 *
 * Two gates, for the two ways a candidate can win without improving anything:
 *
 * 1. `cosine` — re-runs the frozen perturbation battery against the *current*
 *    scorer and compares its discrimination to `bench/stress-cosine.v1.json`.
 *    A candidate that raises its benchmark score by degrading the scorer's
 *    ability to tell a broken drawing from an intact one is rejected on this
 *    alone, whatever the benchmark says.
 *
 * 2. `structure` — the panel of checks cosine cannot make, over a directory of
 *    generated icons. The battery found the scorer blind to element sizing: a
 *    dot two tiers too large lands inside the noise band a legal jitter
 *    produces, so no threshold on cosine ever sees it. These checks are
 *    geometry and ink against corpus-measured targets, and they are outside the
 *    scorer entirely.
 *
 *     npx tsx scripts/gate.ts cosine [--output json]
 *     npx tsx scripts/gate.ts structure --dir <path> [--output json] [--brief]
 *     npx tsx scripts/gate.ts structure --calibrate   # re-derive the corpus rates
 *
 * Exit 0 when every gate passes, 1 when one fails, 2 when the gate cannot
 * honestly run — a missing baseline, an edited one, a battery whose shape no
 * longer matches what the baseline describes. The last case matters most: a
 * gate that degrades to "no findings" when tampered with is not a gate.
 *
 * Local rasterising and arithmetic. No model is called and nothing is written.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { HOUSE_VARIANT, loadCorpus, parseIconSvg } from "../src/corpus/load.js";
import type { CheckResult, StructuralReport } from "../src/eval/blindspot.js";
import { CHECKS, floorFor, measureIcon, panel } from "../src/eval/blindspot.js";
import { run } from "./stress-cosine.js";

const BASELINE = "bench/stress-cosine.v1.json";

/**
 * SHA-256 of `bench/stress-cosine.v1.json` as committed in 666edb4.
 *
 * The baseline is the whole comparison: rewrite it and the gate reports success
 * against whatever the candidate happens to score. Pinning the digest here
 * means moving the goalposts takes two edits in two files instead of one, and
 * both land in the diff a human reads. It is not a security boundary — nothing
 * inside a repo the loop can edit is — it is a tripwire that makes the tamper
 * legible rather than silent.
 */
const BASELINE_SHA =
  "ad11063b184e29316dffee1b6045025e37325a2596839bbebe7a1d5193530525";

/**
 * Paths whose contents define what "passing" means. If any of them is modified
 * relative to the last commit, the gate says so: a candidate that improved its
 * score by editing the thing that scores it is the failure mode this whole file
 * exists for, and the loop has no business writing here.
 */
const GUARDED = [
  "bench/stress-cosine.v1.json",
  "scripts/gate.ts",
  "scripts/stress-cosine.ts",
  "src/eval/blindspot.ts",
  "src/eval/separation.ts",
];

/**
 * How far the pooled AUC may fall below the baseline before the gate fails.
 *
 * The battery is deterministic — the same seed and the same scorer reproduce
 * `0.8636990746456713` exactly — so at a fixed seed there is no sampling noise
 * to absorb. The tolerance instead answers "how big is a difference that means
 * nothing", and reseeding is the only honest measure of that: over seeds 1..5
 * at n=300 the pooled AUC runs 0.8637, 0.8707, 0.8626, 0.8676, 0.8657 — a
 * spread of 0.008, sd 0.003.
 *
 * 0.02 is 2.5× that spread, ~6 sd. A refactor that changes the raster by a
 * rounding error moves the AUC in the fourth decimal and passes; a scorer that
 * has genuinely stopped discriminating loses far more than 0.02 (deleting the
 * blur from render.ts, measured, costs 0.051). The cost of the slack is the band
 * between: a change that costs 0.01–0.02 of real discrimination passes the
 * pooled test. That band is covered from the other side by the per-perturbation
 * tolerance, since a real loss of discrimination shows up concentrated in one
 * or two perturbations long before it shows up pooled.
 */
const POOLED_TOLERANCE = 0.02;

/**
 * The same, per perturbation. Wider because these are noisier: over seeds 1..5
 * the per-perturbation AUCs move by up to 0.014 (`scale-element-1.5`
 * 0.778–0.792, `move-element` 0.925–0.938), and `translate-1` by 0.041
 * (0.416–0.457) because it is measured against a family it overlaps.
 *
 * 0.05 clears the widest of those with room to spare, and still catches the
 * failure it is for: the scorer going blind to one *kind* of damage while the
 * pooled number holds up. `dot-two-tiers` is the case that matters — n=12,
 * AUC 0.774, and the perturbation the panel in `eval/blindspot.ts` exists
 * because of. A drop of 0.05 there is a fifth of the discrimination that
 * perturbation has left.
 */
const PERTURBATION_TOLERANCE = 0.05;

interface Spread {
  max: number;
  median: number;
  min: number;
  n: number;
  p25: number;
  p75: number;
}

interface Baseline {
  families: Record<"breaking" | "preserving", Spread>;
  perturbations: {
    auc: number;
    family: string;
    name: string;
    spread: Spread;
  }[];
  sample: { icons: number; seed: number; variant: string };
  separation: { auc: number };
}

class GateError extends Error {
  name = "GateError";
}

const read = (file: string): string => {
  try {
    return readFileSync(file, "utf-8");
  } catch (error) {
    throw new GateError(
      `cannot read "${file}": ${(error as Error).message}. The gate compares against a committed baseline and will not run without one.`
    );
  }
};

const sha256 = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

const loadBaseline = (file: string): Baseline => {
  const text = read(file);
  const digest = sha256(text);
  if (digest !== BASELINE_SHA) {
    throw new GateError(
      `"${file}" is not the baseline this gate was written against.\n` +
        `  expected sha256 ${BASELINE_SHA}\n  found    sha256 ${digest}\n` +
        "A re-baseline is a deliberate act: re-run the battery, commit the new file, and update BASELINE_SHA in scripts/gate.ts in the same commit, so the change is visible."
    );
  }
  return JSON.parse(text) as Baseline;
};

/** Guarded paths modified since the last commit. Untracked ones are reported
 *  separately: before the gate is first committed every file here is untracked,
 *  and refusing to run then would mean the gate could never be introduced. */
const dirtyGuarded = (): { modified: string[]; untracked: string[] } => {
  let out: string;
  try {
    out = execFileSync("git", ["status", "--porcelain", "--", ...GUARDED], {
      encoding: "utf-8",
    });
  } catch {
    // Not a git checkout, or no git. The digest check still stands.
    return { modified: [], untracked: [] };
  }
  const modified: string[] = [];
  const untracked: string[] = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const file = line.slice(3).trim();
    (line.startsWith("??") ? untracked : modified).push(file);
  }
  return { modified, untracked };
};

const f = (n: number): string => n.toFixed(3);
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

// ---------------------------------------------------------------------------
// Gate 1 — the frozen perturbation battery
// ---------------------------------------------------------------------------

interface Comparison {
  baseline: number;
  current: number;
  delta: number;
  name: string;
  tolerance: number;
  usable: boolean;
}

const compare = (
  name: string,
  baseline: number,
  current: number,
  tolerance: number
): Comparison => ({
  baseline,
  current,
  delta: current - baseline,
  name,
  tolerance,
  usable: current >= baseline - tolerance,
});

interface CosineGateReport {
  builtAt: string;
  /** The battery's own shape, checked against the baseline's. A run whose
   *  families have a different size is not the experiment the baseline
   *  describes, and its AUC is not comparable to the baseline's. */
  integrity: { message: string; usable: boolean };
  perturbations: Comparison[];
  pooled: Comparison;
  procedure: string;
  sample: { icons: number; seed: number; variant: string };
  usable: boolean;
  verdict: string;
}

const GATE_PROCEDURE = `The perturbation battery of \`scripts/stress-cosine.ts\` re-run against the current scorer at the baseline's own sample (300 icons of the house variant, seed 1) and compared to \`${BASELINE}\`. Pooled AUC may fall ${POOLED_TOLERANCE} below the baseline and any single perturbation's own AUC ${PERTURBATION_TOLERANCE}, both set from the seed-to-seed spread the baseline itself reports: 0.008 pooled over seeds 1..5, up to 0.041 for a single perturbation. Before comparing, the run's family sizes are checked against the baseline's — a battery that has been shortened produces a different experiment, and its AUC is not comparable to the number it would be compared against. The baseline file is checked against a digest pinned in this script, and every path that defines what passing means is checked for uncommitted edits.`;

const verdictFor = (
  pooled: Comparison,
  perturbations: readonly Comparison[],
  integrity: { message: string; usable: boolean }
): string => {
  if (!integrity.usable) {
    return `CANNOT RUN: ${integrity.message}`;
  }
  const degraded = perturbations.filter((p) => !p.usable);
  const parts: string[] = [];
  if (!pooled.usable) {
    parts.push(
      `FAIL: pooled AUC ${f(pooled.current)} against a baseline of ${f(pooled.baseline)}, a drop of ${f(-pooled.delta)} past the ${POOLED_TOLERANCE} tolerance. The scorer discriminates worse than the one the benchmark numbers were measured with, so no benchmark score taken with it means anything.`
    );
  }
  if (degraded.length > 0) {
    parts.push(
      `FAIL: ${degraded
        .map(
          (p) => `${p.name} ${f(p.current)} vs ${f(p.baseline)} (${f(p.delta)})`
        )
        .join(
          "; "
        )}. The scorer has gone blind to a kind of damage it could see before; pooled AUC can hold while this happens, which is why it is checked separately.`
    );
  }
  if (parts.length > 0) {
    return parts.join(" ");
  }
  return `PASS: pooled AUC ${f(pooled.current)} against a baseline of ${f(pooled.baseline)} (${pooled.delta >= 0 ? "+" : ""}${f(pooled.delta)}), no perturbation down more than ${PERTURBATION_TOLERANCE}. The scorer still separates a broken drawing from an intact one as well as it did when the benchmark was calibrated. It says nothing about whether the scorer is *good* — the baseline it is held to has an inverted gradient on translation and cannot see a dot two tiers too large.`;
};

const cosineGate = async (args: {
  baseline: string;
  corpus: string;
}): Promise<CosineGateReport> => {
  const base = loadBaseline(args.baseline);
  const report = await run({
    corpus: args.corpus,
    n: base.sample.icons,
    seed: base.sample.seed,
  });

  const shapeIssues: string[] = [];
  for (const family of ["breaking", "preserving"] as const) {
    const want = base.families[family].n;
    const got = report.families[family].n;
    if (want !== got) {
      shapeIssues.push(`${family} family has ${got} observations, not ${want}`);
    }
  }
  const names = new Set(report.perturbations.map((p) => p.name));
  for (const p of base.perturbations) {
    if (!names.has(p.name)) {
      shapeIssues.push(`perturbation "${p.name}" is gone`);
    }
  }
  const integrity = {
    message:
      shapeIssues.length === 0
        ? `battery matches the baseline: ${base.perturbations.length} perturbations, ${base.families.preserving.n} preserving and ${base.families.breaking.n} breaking observations`
        : `the battery is not the one the baseline describes — ${shapeIssues.join("; ")}. Re-baseline deliberately, or restore scripts/stress-cosine.ts.`,
    usable: shapeIssues.length === 0,
  };

  const pooled = compare(
    "pooled",
    base.separation.auc,
    report.separation.auc,
    POOLED_TOLERANCE
  );
  const byName = new Map(report.perturbations.map((p) => [p.name, p]));
  const perturbations = base.perturbations.map((p) =>
    compare(p.name, p.auc, byName.get(p.name)?.auc ?? 0, PERTURBATION_TOLERANCE)
  );

  return {
    builtAt: new Date().toISOString(),
    integrity,
    perturbations,
    pooled,
    procedure: GATE_PROCEDURE,
    sample: report.sample,
    usable:
      integrity.usable && pooled.usable && perturbations.every((p) => p.usable),
    verdict: verdictFor(pooled, perturbations, integrity),
  };
};

const printCosine = (r: CosineGateReport): void => {
  const lines = [
    `perturbation battery — ${r.sample.icons} icons of ${r.sample.variant}, seed ${r.sample.seed}`,
    "",
    "measure               baseline  current    delta  tolerance",
    [
      "pooled AUC".padEnd(21),
      f(r.pooled.baseline).padStart(8),
      f(r.pooled.current).padStart(9),
      f(r.pooled.delta).padStart(8),
      f(r.pooled.tolerance).padStart(11),
    ].join(" "),
  ];
  for (const p of r.perturbations) {
    lines.push(
      [
        p.name.padEnd(21),
        f(p.baseline).padStart(8),
        f(p.current).padStart(9),
        f(p.delta).padStart(8),
        f(p.tolerance).padStart(11),
        p.usable ? "" : "  DEGRADED",
      ].join(" ")
    );
  }
  lines.push("", r.integrity.message, "", r.verdict);
  process.stdout.write(`${lines.join("\n")}\n`);
};

// ---------------------------------------------------------------------------
// Gate 2 — the structural panel
// ---------------------------------------------------------------------------

const iconsIn = (dir: string): { name: string; svg: string }[] => {
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((x) => x.endsWith(".svg"))
      .toSorted();
  } catch (error) {
    throw new GateError(
      `cannot list "${dir}": ${(error as Error).message}. The structural panel takes a directory of generated .svg icons.`
    );
  }
  if (files.length === 0) {
    throw new GateError(`no .svg files in "${dir}".`);
  }
  return files.map((file) => ({
    name: file.replace(/\.svg$/u, ""),
    svg: readFileSync(path.join(dir, file), "utf-8"),
  }));
};

const printStructure = (r: StructuralReport): void => {
  const lines = [
    `structural panel — ${r.n} icons from ${r.source}`,
    "",
    "check              passed     rate   best   floor",
  ];
  for (const c of r.checks) {
    lines.push(
      [
        c.name.padEnd(18),
        `${c.passed}/${c.n}`.padStart(7),
        pct(c.rate).padStart(8),
        pct(c.ceiling).padStart(6),
        pct(c.floor).padStart(7),
        c.usable ? "" : "  UNDER",
      ].join(" ")
    );
  }
  for (const c of r.checks.filter((x: CheckResult) => x.failures.length > 0)) {
    lines.push("", `${c.name} — target: ${c.target}`);
    for (const failure of c.failures) {
      lines.push(`  ${failure}`);
    }
  }
  lines.push("", r.verdict);
  process.stdout.write(`${lines.join("\n")}\n`);
};

/**
 * Re-derive every corpus rate the checks are calibrated against.
 *
 * The floors are only meaningful while they describe the set: if the corpus
 * moves and the constants do not, the gate is holding candidates to a standard
 * nothing has met since. This prints both, side by side, and says which have
 * drifted.
 */
const calibrate = async (root: string): Promise<number> => {
  const corpus = await loadCorpus(root);
  const measurements = [];
  for (const symbol of corpus.symbols) {
    if (!corpus.has(symbol, HOUSE_VARIANT)) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- one icon at a time
    const svg = await corpus.svg(symbol, HOUSE_VARIANT);
    const shapes = parseIconSvg(svg);
    // The house set as the checks describe it: drawn entirely in strokes.
    if (
      shapes.length === 0 ||
      !shapes.every((s) => !s.filled && s.strokeWidth > 0)
    ) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- see above
    measurements.push(await measureIcon(svg));
  }
  const lines = [
    `corpus calibration — ${measurements.length} stroked icons of ${HOUSE_VARIANT}`,
    "",
    "check                 n  recorded  measured   drift",
  ];
  let drifted = 0;
  for (const check of CHECKS) {
    // Over the icons the check applies to, not over all of them: `dot-tiers`
    // asked of an icon that draws no dot is not a pass, it is not a question,
    // and averaging 1,474 of those in reports 99.9% for a check the corpus
    // actually passes 98.1% of the time.
    const asked = measurements.filter((m) => check.applies?.(m) ?? true);
    const rate =
      asked.length === 0
        ? 1
        : asked.filter((m) => check.holds(m)).length / asked.length;
    const drift = rate - check.corpusRate;
    // A tenth of the tolerance the floors are set with: smaller than that and
    // the floor does not move at whole-percent precision.
    if (Math.abs(drift) > 0.012) {
      drifted += 1;
    }
    lines.push(
      [
        check.name.padEnd(18),
        String(asked.length).padStart(6),
        pct(check.corpusRate).padStart(8),
        pct(rate).padStart(9),
        `${drift >= 0 ? "+" : ""}${(drift * 100).toFixed(1)}`.padStart(7),
        Math.abs(drift) > 0.012 ? "  DRIFTED" : "",
      ].join(" ")
    );
  }
  lines.push(
    "",
    `floors in force: ${CHECKS.map((c) => `${c.name} ${pct(floorFor(c))}`).join(", ")}`,
    drifted === 0
      ? "PASS: every recorded corpus rate still describes the corpus."
      : `FAIL: ${drifted} recorded rate(s) no longer describe the corpus. The floors are derived from them, so they are now holding candidates to a standard the set itself does not meet.`
  );
  process.stdout.write(`${lines.join("\n")}\n`);
  return drifted === 0 ? 0 : 1;
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `usage:
  npx tsx scripts/gate.ts cosine    [--corpus corpus] [--baseline ${BASELINE}] [--output json]
  npx tsx scripts/gate.ts structure --dir <path> [--output json] [--brief]
  npx tsx scripts/gate.ts structure --calibrate [--corpus corpus]

exit 0 pass, 1 gate failed, 2 the gate could not honestly run.`;

const warnIfDirty = (): void => {
  const { modified, untracked } = dirtyGuarded();
  if (modified.length > 0) {
    process.stderr.write(
      `TAMPER: uncommitted edits to ${modified.join(", ")}. These paths define what passing means; the loop does not write here. Commit them deliberately or restore them — the result below is measured against an edited gate.\n`
    );
  }
  if (untracked.length > 0) {
    process.stderr.write(
      `note: ${untracked.join(", ")} are not committed yet.\n`
    );
  }
};

const main = async (): Promise<number> => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      baseline: { default: BASELINE, type: "string" },
      brief: { default: false, type: "boolean" },
      calibrate: { default: false, type: "boolean" },
      corpus: { default: "corpus", type: "string" },
      dir: { type: "string" },
      output: { default: "text", type: "string" },
    },
  });
  const json = values.output === "json";
  const [which] = positionals;

  if (which === "cosine") {
    warnIfDirty();
    const report = await cosineGate({
      baseline: values.baseline,
      corpus: values.corpus,
    });
    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printCosine(report);
    }
    return report.usable ? 0 : 1;
  }

  if (which === "structure") {
    warnIfDirty();
    if (values.calibrate) {
      return await calibrate(values.corpus);
    }
    if (!values.dir) {
      throw new GateError(
        `the structural panel needs icons to look at. Pass --dir <path>, or --calibrate to re-derive the corpus rates.\n\n${USAGE}`
      );
    }
    const report = await panel(iconsIn(values.dir), values.dir);
    if (json) {
      // The per-icon measurements are the bulk of this and usually the reason
      // to want it: a failing check is not actionable without the numbers
      // behind it. `--brief` drops them for the version that goes in bench/,
      // where 2,085 measurements are a diff nobody reads.
      const out = values.brief ? { ...report, icons: [] } : report;
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    } else {
      printStructure(report);
    }
    return report.usable ? 0 : 1;
  }

  throw new GateError(
    `${which ? `unknown gate "${which}".` : "which gate?"}\n\n${USAGE}`
  );
};

if (process.argv[1]?.endsWith("gate.ts")) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof GateError ? error.message : String(error)}\n`
    );
    process.exitCode = 2;
  }
}

export {
  BASELINE_SHA,
  compare,
  GUARDED,
  iconsIn,
  loadBaseline,
  PERTURBATION_TOLERANCE,
  POOLED_TOLERANCE,
};

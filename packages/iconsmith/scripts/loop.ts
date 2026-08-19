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
 * accepts noise and calls it progress, and it does so at machine speed. It also
 * refuses to run without `program.md`, which is the human's standing
 * instruction file: the loop reads it and never writes it.
 *
 * A kept iteration is committed to an experiment branch, so the branch tip is
 * the champion and rollback is a ref move. A discarded or crashed one writes
 * nothing anywhere. See the ratchet block below for how that is held.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { panel } from "../src/eval/blindspot.js";
import type { StructuralReport } from "../src/eval/blindspot.js";
import { formatStaged, twoStage } from "../src/pipeline/accept.js";
import type { StagedVerdict } from "../src/pipeline/accept.js";
import { entriesOf, loadBenchmark, slice } from "../src/pipeline/bench.js";
import type { BenchmarkEntry } from "../src/pipeline/bench.js";
import { evaluate, scored } from "../src/pipeline/eval.js";
import type { EvalReport, IconScore } from "../src/pipeline/eval.js";
import {
  DEFAULT_POLICY,
  parsePolicy,
  setEnabled,
} from "../src/pipeline/policy.js";
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

/**
 * The blind-spot panel for both arms, or `null` when it did not run.
 *
 * `null` is not "no news". Rendered cosine cannot resolve element sizing — the
 * scorer's own stress test scores a dot two tiers too large at 0.988, inside
 * the band a legal 0.25 jitter produces — so a cosine win with no panel behind
 * it is exactly the win an optimiser finds first. The rule below treats a
 * missing panel as a reason to refuse, never as a pass.
 */
export interface StructuralArms {
  champion: StructuralReport;
  variant: StructuralReport;
}

export interface JudgeOptions {
  errors?: { champion: number; variant: number };
  structural?: StructuralArms | null;
}

/**
 * The gate cosine cannot stand in for.
 *
 * Not "the variant panel passes": a champion that already sits under a corpus
 * floor would then block every successor forever, and the question the loop
 * asks is whether a change made things worse. So the rule is per check, and it
 * is a *regression* rule — a check the champion cleared and the variant does
 * not. Rates that wobble without crossing a floor are left alone, because the
 * Wilson interval those floors are built from is what absorbs that wobble.
 */
const structuralReasons = (
  structural: StructuralArms | null | undefined
): string[] => {
  if (!structural) {
    return [
      "the structural panel did not run, so element sizing, badge placement and margin were not checked — rendered cosine cannot resolve any of them, and a win only cosine endorses is the first thing an optimiser finds",
    ];
  }
  const { champion, variant } = structural;
  if (variant.n === 0) {
    return [
      "the structural panel measured nothing on the variant; a candidate that produced no icons does not pass the panel that exists to look at its icons",
    ];
  }
  const held = new Set(
    champion.checks.filter((c) => c.usable).map((c) => c.name)
  );
  const lost = variant.checks.filter((c) => held.has(c.name) && !c.usable);
  return lost.map(
    (c) =>
      `structural check \`${c.name}\` held for the champion and fails for the variant: ${(c.rate * 100).toFixed(0)}% against a ${(c.floor * 100).toFixed(0)}% floor — cosine cannot see this`
  );
};

/**
 * Run the blind-spot panel over an arm's generated SVGs.
 *
 * Returns null when there is nothing to measure — every generation in the arm
 * threw, so no drawing reached the panel. That is a refusal downstream, not a
 * pass: `structuralReasons` treats a missing panel as the reason to discard.
 *
 * It rasterises, and it is called once per arm per stage rather than once per
 * run, because the panel has to be scored over the icons the stage is actually
 * judging. That is local work on a 96x96 raster and it costs nothing; caching
 * it would trade a real correctness property for no measurable saving.
 */
export const structuralOf = async (
  scores: readonly IconScore[],
  source: string
): Promise<StructuralReport | null> => {
  const icons = scores
    .filter(scored)
    .map((s) => ({ name: s.icon, svg: s.svg }));
  return icons.length === 0 ? null : await panel(icons, source);
};

/** The acceptance rule, separated from the running so it can be tested. */
export const judge = (
  champion: readonly IconScore[],
  variant: readonly IconScore[],
  noiseFloor: number,
  { errors, structural }: JudgeOptions = {}
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
  reasons.push(...structuralReasons(structural));
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

/* ─────────────────────────── the ratchet ───────────────────────────
 *
 * A kept iteration advances a branch. The branch tip IS the champion, so there
 * is no champion-state file to drift from what actually survived, and rollback
 * is `git update-ref`.
 *
 * Nothing here touches the working tree or the index. The commit is assembled
 * with plumbing — `hash-object`, a scratch index, `commit-tree`, `update-ref`
 * — against the branch tip, so a loop running while a person edits files
 * cannot write over them: there is no code path that writes a file in the
 * repository at all. That is the structural half of the read-only boundary.
 * The other half is the check before the ref moves: the assembled commit is
 * diffed against its parent, and the ref only advances if the diff is exactly
 * the policy path and nothing program.md freezes. `program.md`, the gates and
 * the tests are unreachable by construction, and that check proves it per
 * commit rather than promising it in prose.
 */
/** Repo-relative. The ledger is appended before the commit is made, so it is
 *  the one tracked path allowed to be dirty when the ratchet fires. */
const LEDGER_REL = "packages/iconsmith/bench/ledger.jsonl";

const git = (cwd: string, args: string[], input?: string): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

const NULL_SHA = "0".repeat(40);

/** Paths, one per line, indented. Every refusal names what it refused over. */
const bullets = (paths: readonly string[]): string =>
  paths.map((p) => `  ${p}`).join("\n");

export class RatchetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RatchetError";
  }
}

/**
 * Tracked paths that differ from HEAD, ignoring the ledger this script appends
 * to. `diff --name-only` rather than `status --porcelain`: it names paths
 * without a status prefix to slice off, and untracked files are none of the
 * loop's business.
 */
export const dirtyPaths = (
  cwd: string,
  ignore: readonly string[]
): string[] => {
  const diff = spawnSync("git", ["diff", "--name-only", "HEAD"], {
    cwd,
    encoding: "utf-8",
  });
  if (diff.status !== 0) {
    throw new RatchetError(
      `cannot read the working tree state:\n${diff.stderr?.trim() ?? ""}`
    );
  }
  return diff.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !ignore.includes(line));
};

/**
 * Advance the experiment branch, compare-and-swap.
 *
 * The whole concurrency story, in one call. Two overlapping runs both measured
 * against the tip they saw at the start; the second to finish is comparing
 * against a champion that no longer exists, and git refuses its update rather
 * than letting it silently overwrite the first.
 */
export const advanceRef = (
  cwd: string,
  branch: string,
  sha: string,
  expected: string
): void => {
  const swap = spawnSync(
    "git",
    ["update-ref", `refs/heads/${branch}`, sha, expected],
    { cwd, encoding: "utf-8" }
  );
  if (swap.status !== 0) {
    throw new RatchetError(
      `refusing to ratchet: ${branch} moved while this iteration was running.\n` +
        `${swap.stderr?.trim() ?? ""}\n\n` +
        "Another loop run took the branch. This result was measured against a\n" +
        "champion that is no longer the tip, so it is not comparable. The ref\n" +
        "was not advanced.\n"
    );
  }
};

export interface RatchetOptions {
  /** The experiment branch. Created off HEAD if it does not exist yet. */
  branch: string;
  cwd: string;
  /** Full commit message, subject and scorecard. */
  message: string;
  /** Repo-relative path of the one file a kept iteration may write. */
  policyPath: string;
  /** The winning policy, serialised. */
  policyJson: string;
  /** The paths program.md declares off limits. The ratchet checks the commit
   *  against this list rather than trusting its own single-path construction. */
  frozen: readonly string[];
}

export interface Ratcheted {
  branch: string;
  parent: string;
  sha: string;
}

/**
 * Commit the winning policy to the experiment branch. Throws rather than
 * committing something other than what was asked for.
 */
export const ratchet = (options: RatchetOptions): Ratcheted => {
  const { branch, cwd, frozen, message, policyPath, policyJson } = options;
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);

  if (frozen.includes(policyPath)) {
    throw new RatchetError(
      `refusing to ratchet: program.md freezes ${policyPath}, so the loop may not write it.`
    );
  }
  if (policyPath.startsWith("/") || policyPath.split("/").includes("..")) {
    throw new RatchetError(
      `refusing to ratchet: policy path "${policyPath}" is not a plain repo-relative path.`
    );
  }

  // The arms were measured against the working tree. If it does not match its
  // commit, a branch tip claiming the result would be attributing a score to
  // source that never ran. Nothing here can clobber the edit; it just cannot
  // honestly record a result on top of it.
  const dirty = dirtyPaths(root, [LEDGER_REL]);
  if (dirty.length > 0) {
    throw new RatchetError(
      `refusing to ratchet: the working tree has uncommitted changes.
${bullets(dirty)}

The arms were measured against these files, so a commit of the policy alone
would record the win against source that is not in any commit. Nothing was
written. Commit or stash, then re-run.
`
    );
  }

  const exists =
    spawnSync(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      {
        cwd: root,
      }
    ).status === 0;
  const base = exists
    ? git(root, ["rev-parse", `refs/heads/${branch}`])
    : git(root, ["rev-parse", "HEAD"]);

  const blob = git(root, ["hash-object", "-w", "--stdin"], policyJson);

  // A scratch index, so the caller's staged work is not read or disturbed.
  const index = path.join(
    mkdtempSync(path.join(tmpdir(), "iconsmith-ratchet-")),
    "index"
  );
  const plumb = (args: string[]): string =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf-8",
      env: { ...process.env, GIT_INDEX_FILE: index },
    }).trim();
  plumb(["read-tree", base]);
  plumb([
    "update-index",
    "--add",
    "--cacheinfo",
    `100644,${blob},${policyPath}`,
  ]);
  const tree = plumb(["write-tree"]);

  const sha = git(root, ["commit-tree", tree, "-p", base, "-m", message]);

  // Verify, then advance. Even a bug above cannot land a commit that touches
  // program.md, a gate, or a test on the experiment branch.
  const touched = git(root, [
    "diff-tree",
    "-r",
    "--name-only",
    "--no-commit-id",
    base,
    sha,
  ])
    .split("\n")
    .filter(Boolean);
  if (touched.length === 0) {
    throw new RatchetError(
      `refusing to ratchet: the winning policy is byte-identical to ${branch}. Nothing to record.`
    );
  }
  const trespass = touched.filter((t) => frozen.includes(t));
  if (
    touched.length !== 1 ||
    touched[0] !== policyPath ||
    trespass.length > 0
  ) {
    throw new RatchetError(
      `refusing to ratchet: the commit touches paths outside the policy.
${bullets(touched)}

A kept iteration may write ${policyPath} and nothing else. The ref was not
advanced; the commit object is unreferenced and will be collected.
`
    );
  }

  advanceRef(root, branch, sha, exists ? base : NULL_SHA);
  return { branch, parent: base, sha };
};

/**
 * Frozen paths where the experiment branch has diverged from `base`.
 *
 * The ratchet cannot write these — it commits one path and checks — but a hand
 * commit onto the branch can. This is the check that catches it, and it reads
 * its list from program.md, so freezing something new is an edit to a markdown
 * file rather than a change to this script.
 */
export const frozenDrift = (
  cwd: string,
  branch: string,
  base: string,
  frozen: readonly string[]
): string[] => {
  const shown = spawnSync(
    "git",
    ["diff", "--name-only", base, `refs/heads/${branch}`],
    { cwd, encoding: "utf-8" }
  );
  if (shown.status !== 0) {
    return [];
  }
  return shown.stdout
    .split("\n")
    .filter(Boolean)
    .filter((p) => frozen.includes(p));
};

/** The champion policy is the branch tip, read back. Never a state file. */
export const championFromBranch = (
  cwd: string,
  branch: string,
  policyPath: string
): Policy | null => {
  const shown = spawnSync(
    "git",
    ["show", `refs/heads/${branch}:${policyPath}`],
    {
      cwd,
      encoding: "utf-8",
    }
  );
  if (shown.status !== 0) {
    return null;
  }
  return parsePolicy(JSON.parse(shown.stdout));
};

/* ───────────────────── program.md, the control surface ─────────────────────
 *
 * The human writes it, the loop reads it. The loop never writes it — see the
 * diff check in `ratchet` — and it is not the artefact under optimisation.
 * Its ```frozen block is machine-read: adding a path there is a standing
 * instruction the loop obeys on the next iteration without anyone editing
 * this script.
 */
export interface Program {
  frozen: string[];
  sha: string;
  text: string;
}

const FROZEN_BLOCK = /```frozen\n(?<body>[\s\S]*?)```/gu;

export const parseProgram = (text: string): string[] => {
  const frozen: string[] = [];
  for (const m of text.matchAll(FROZEN_BLOCK)) {
    for (const line of (m.groups?.body ?? "").split("\n")) {
      const entry = line.replace(/#.*$/u, "").trim();
      if (entry) {
        frozen.push(entry);
      }
    }
  }
  return frozen;
};

export const readProgram = (file: string): Program => {
  const text = readFileSync(file, "utf-8");
  return {
    frozen: parseProgram(text),
    sha: createHash("sha256").update(text).digest("hex").slice(0, 12),
    text,
  };
};

/* ────────────────────────────── the lock ──────────────────────────────
 *
 * Two loop runs at once would spend twice and compare against two different
 * champions, and only one of them could keep. Exclusive create, refuse loudly,
 * release in a finally.
 */
export const acquireLock = (file: string, branch: string): (() => void) => {
  try {
    writeFileSync(
      file,
      `${JSON.stringify({ branch, pid: process.pid, startedAt: new Date().toISOString() })}\n`,
      { flag: "wx" }
    );
  } catch {
    throw new RatchetError(
      `another loop run holds ${file}:\n  ${readFileSync(file, "utf-8").trim()}\n\n` +
        "Two runs would spend twice and measure against two different champions.\n" +
        "If that process is gone, delete the file and re-run.\n"
    );
  }
  return () => {
    rmSync(file, { force: true });
  };
};

const WORKSPACE = path.join(import.meta.dirname, "..");
const LEDGER = path.join(WORKSPACE, "bench", "ledger.jsonl");
const LOCK = path.join(WORKSPACE, "bench", ".loop.lock");
const PROGRAM = path.join(WORKSPACE, "program.md");
/** Repo-relative, because that is what the ratchet commits by. */
const POLICY_PATH = "packages/iconsmith/src/pipeline/policy.default.json";
const BRANCH = "iconsmith/loop";

/** The scorecard, in the commit message. `git log` is then the ledger a person
 *  reads, and it carries the evidence next to the change it bought. */
const scorecard = (
  verdict: Verdict,
  enabled: readonly string[],
  noiseFloor: number,
  program: Program
): string =>
  [
    `loop: keep ${enabled.join(",")}`,
    "",
    `median delta   ${verdict.medianDelta.toFixed(4)}  (noise floor ${noiseFloor.toFixed(4)})`,
    `paired p       ${verdict.p.toFixed(4)}  (signed-rank, n=${verdict.n})`,
    `lint-clean     ${verdict.cleanDelta >= 0 ? "+" : ""}${verdict.cleanDelta.toFixed(4)}`,
    `enabled        ${enabled.join(", ")}`,
    `program.md     ${program.sha}`,
    "",
    "Accepted by scripts/loop.ts. The gates are paired significance, a median",
    "over the measured noise floor, and no fall in the lint-clean rate.",
  ].join("\n");

type Arg = (name: string) => string | undefined;

/** Annotated on the declaration, not the arrow: that is what lets TypeScript
 *  treat a call as terminating, so the checks below narrow. */
const refuse: (message: string) => never = (message) => {
  process.stderr.write(message);
  process.exit(2);
};

interface Preflight {
  branch: string;
  enable: string[];
  noiseFloor: number;
  program: Program;
  set: string;
}

/**
 * Everything that can refuse the run, before a single token is spent. A run
 * that could not record its result should not cost anything to discover that.
 */
const preflight = (arg: Arg): Preflight => {
  if (!existsSync(PROGRAM)) {
    refuse(
      `No program.md at "${PROGRAM}".

It is the standing instruction file: what to try, what is off limits, and which
paths the loop may never write. The loop reads it and does not write it.
Without it there is nothing steering this run.
`
    );
  }
  const program = readProgram(PROGRAM);
  if (program.frozen.includes(POLICY_PATH)) {
    refuse(
      `program.md freezes ${POLICY_PATH}, which is the only file the loop can
write. Nothing can be kept. Unfreeze it or stop running the loop.
`
    );
  }

  const calibrationPath =
    arg("calibration") ?? path.join(WORKSPACE, "bench", "noise-floor.json");
  if (!existsSync(calibrationPath)) {
    refuse(
      `No calibration at "${calibrationPath}".

The acceptance threshold IS the measured seed-to-seed spread, so a run without
one cannot tell a real gain from noise — it would accept noise and call it
progress. Measure it first:

  iconsmith eval --dir <set> --slice 30 --seeds 1,2,3 --max-spend <usd>

then write the spread to that path as { "noiseFloor": <number> }.
`
    );
  }
  const { noiseFloor } = JSON.parse(readFileSync(calibrationPath, "utf-8")) as {
    noiseFloor: number;
  };

  const enable = (arg("enable") ?? "").split(",").filter(Boolean);
  if (enable.length === 0) {
    refuse("Pass --enable <principle-id,...> to form a variant.\n");
  }

  // The set is named, not guessed: every icon the run does not hold out is
  // shown to the model, so a run against someone else's pack is a licence
  // breach from its first call. `evaluate` checks the name it is given.
  const set = arg("set");
  if (!set) {
    refuse(
      `Pass --set <name> naming the set at --dir. Every icon not held out is
shown to the model, so the run has to state what it is conditioning on.
`
    );
  }

  const branch = arg("branch") ?? BRANCH;

  const dirty = dirtyPaths(WORKSPACE, [LEDGER_REL]);
  if (dirty.length > 0) {
    refuse(
      `The working tree has uncommitted changes:
${bullets(dirty)}

The arms are measured against these files, so a kept result could not be
attributed to any commit. Commit or stash first.
`
    );
  }

  // The ratchet cannot commit a frozen path, but a person or another process
  // can. If one has drifted on the experiment branch, the champion is not the
  // thing the gates were written against and the run means nothing.
  const drift = frozenDrift(WORKSPACE, branch, "HEAD", program.frozen);
  if (drift.length > 0) {
    refuse(
      `${branch} has diverged from HEAD in paths program.md freezes:
${bullets(drift)}

Those files are the gates and the calibration this loop is judged against.
Reconcile the branch before running another iteration.
`
    );
  }

  return { branch, enable, noiseFloor, program, set };
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const arg: Arg = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
  };

  const { branch, enable, noiseFloor, program, set } = preflight(arg);

  const release = acquireLock(LOCK, branch);

  try {
    // The champion is the branch tip, read back — not a state file that can
    // disagree with what actually survived.
    const champPolicy =
      championFromBranch(WORKSPACE, branch, POLICY_PATH) ?? DEFAULT_POLICY;
    let variantPolicy: Policy = champPolicy;
    for (const id of enable) {
      variantPolicy = setEnabled(variantPolicy, id, true);
    }

    // The benchmark is loaded through `parseBenchmark`, not `JSON.parse`: it is
    // what refuses a file whose splits overlap, and an entry in two splits
    // means the slice that proposes a change is also the slice that judges it.
    const benchmark = loadBenchmark(
      arg("bench") ?? path.join(WORKSPACE, "bench", "reconstruction.json")
    );
    const cap = arg("slice") === undefined ? undefined : Number(arg("slice"));
    const feedback = slice(entriesOf(benchmark.entries, "feedback"), cap);
    const selection = slice(entriesOf(benchmark.entries, "selection"), cap);
    // `sealed` is named nowhere in this file on purpose. It is opened once, by
    // a person, after the campaign is over; anything that could route to it
    // automatically would spend it.

    const common = {
      dir: arg("dir") as string,
      maxSpendUsd: Number(arg("max-spend") ?? 5),
      model: arg("model"),
      provenance: {
        date: new Date().toISOString().slice(0, 10),
        origin: "original" as const,
        set,
        usage: "conditioning" as const,
      },
      seed: Number(arg("seed") ?? 1),
    };

    const arms = async (
      entries: readonly BenchmarkEntry[],
      label: string
    ): Promise<{ champion: EvalReport; variant: EvalReport }> => {
      process.stderr.write(`${label}: champion…\n`);
      const c = await evaluate({
        ...common,
        benchmark: entries,
        policy: champPolicy,
      });
      process.stderr.write(`${label}: variant…\n`);
      const v = await evaluate({
        ...common,
        benchmark: entries,
        policy: variantPolicy,
      });
      return { champion: c, variant: v };
    };

    const screenArms = await arms(feedback, "screen");
    let championIcons = screenArms.champion.icons;
    let variantIcons = screenArms.variant.icons;
    let errors = {
      champion: screenArms.champion.benchmark.errors,
      variant: screenArms.variant.benchmark.errors,
    };

    // The panel is built inside the judge, from the scores the judge was
    // handed, so it measures the slice being decided rather than whichever
    // icons happen to have accumulated. Building it outside would hand the
    // selection stage a panel spanning the feedback icons too — and would
    // re-judge the screen against a wider panel than the one that passed it.
    //
    // It belongs at the screen and not after it: rasterising is local and free,
    // while the selection slice is 130 generations. A candidate that improves
    // cosine while losing a structural check is screened out before anything
    // pays for it.
    const stagedWith = async (): Promise<StagedVerdict<Verdict>> =>
      await twoStage<Verdict>({
        champion: championIcons,
        entries: benchmark.entries,
        judge: async (a, b, floor) => {
          const champion = await structuralOf(a, "champion");
          const variant = await structuralOf(b, "variant");
          return judge(a, b, floor, {
            errors,
            // Either arm measuring nothing leaves the comparison with no
            // champion to regress against, which `judge` refuses.
            structural: champion && variant ? { champion, variant } : null,
          });
        },
        noiseFloor,
        variant: variantIcons,
      });

    let staged = await stagedWith();
    if (staged.stage !== "screened-out") {
      // Only a candidate that beat the incumbent on the icons it was written
      // against pays for the 130 it has never seen.
      const decide = await arms(selection, "decide");
      championIcons = [...championIcons, ...decide.champion.icons];
      variantIcons = [...variantIcons, ...decide.variant.icons];
      errors = {
        champion: errors.champion + decide.champion.benchmark.errors,
        variant: errors.variant + decide.variant.benchmark.errors,
      };
      staged = await stagedWith();
    }
    const verdict = staged.selection ?? staged.screen;

    let commit: string | null = null;
    let ratchetError: string | null = null;
    if (staged.accepted) {
      try {
        commit = ratchet({
          branch,
          cwd: WORKSPACE,
          frozen: program.frozen,
          message: scorecard(verdict, enable, noiseFloor, program),
          policyJson: `${JSON.stringify(variantPolicy, null, 2)}\n`,
          policyPath: POLICY_PATH,
        }).sha;
      } catch (error) {
        ratchetError = error instanceof Error ? error.message : String(error);
      }
    }

    const entry = {
      accepted: staged.accepted,
      branch,
      commit,
      enabled: enable,
      icons: staged.spent,
      medianDelta: verdict.medianDelta,
      n: verdict.n,
      noiseFloor,
      p: verdict.p,
      programSha: program.sha,
      ratchetError,
      reasons: verdict.reasons,
      screenMedian: staged.screen.medianDelta,
      stage: staged.stage,
      status: verdict.status,
    };
    appendFileSync(LEDGER, `${JSON.stringify(entry)}\n`);

    process.stdout.write(`${formatStaged(staged)}\n`);
    for (const r of verdict.reasons) {
      process.stdout.write(`  · ${r}\n`);
    }
    if (commit) {
      process.stdout.write(`  → ${branch} ${commit.slice(0, 12)}\n`);
    } else if (ratchetError) {
      process.stderr.write(`${ratchetError}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write("  → tree and branch untouched\n");
    }
  } finally {
    release();
  }
};

if (process.argv[1]?.endsWith("loop.ts")) {
  await main();
}

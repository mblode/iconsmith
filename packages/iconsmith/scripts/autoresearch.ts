/**
 * Generation-pipeline meta-loop. Karpathy's org, not his train.py.
 *
 * A human writes `autoresearch.md`. This loop reads it and never writes it.
 * The training surface is the generation pipeline (pipeline / tools /
 * commands / tests / SKILL / generate prompts), not two analog files.
 * One change per round, a documented scoreboard, keep or revert.
 * After each measure it writes `.staging/autoresearch/NEXT.md` for a human
 * (or Cursor Automation) to paste into a new Cloud Agent — this environment
 * can list Cloud Agents and cannot launch one.
 * The policy campaign (`program.md` + `loop.ts`) and the harness campaign
 * (`lab.md` + `research.ts`) are not this file and stay intact.
 *
 *   npx tsx scripts/autoresearch.ts --rounds 3
 *   npx tsx scripts/autoresearch.ts --rounds 50
 *
 * `--rounds` omitted defaults to 1. Overnight is `--rounds 50`.
 * Exhausted playbook rows stay idle and still write NEXT.md.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { analogArm, analogConstructions } from "../src/pipeline/analog.js";
import { PAINT_RECIPES, recipeFor } from "../src/pipeline/recipe.js";
import { evaluateTwins } from "./twin-eval.js";

export const HOLD_OUT_UNKNOWN = ["star", "compass", "quokka", "xyzzy"] as const;

export const DEFAULT_PROBED = [
  "home",
  "house",
  "cactus",
  "lighthouse",
  "telescope",
  "checkmark",
  "wall-clock",
  "plus-sign",
  "heart",
  "bell",
  "lock",
  "ring",
  "mushroom",
  "hourglass",
  "sailboat",
] as const;

export const DEFAULT_BRANCH = "iconsmith/autoresearch";
export const WORKER_BRANCHES = [
  "iconsmith/autoresearch",
  "cursor/autoresearch-c1f5",
] as const;
export const DEFAULT_ROUNDS = 1;
export const OVERNIGHT_ROUNDS = 50;
export const CLOUD_AGENTS_URL = "https://cursor.com/agents";
export const NEXT_REL = ".staging/autoresearch/NEXT.md";
export const CLOUD_ROUND_REL = "packages/iconsmith/scripts/cloud-round.md";
/** One change plus its neighbour test. A fourth path is a dump. */
export const MAX_TOUCHED = 3;

const WORKSPACE = path.join(import.meta.dirname, "..");
const STANDING_NAME = "autoresearch.md";
const RESULTS_REL = ".staging/autoresearch/results.tsv";
const DENIED_PREFIXES = [
  ".staging/",
  "packages/iconsmith/.staging/",
  "packages/iconsmith/corpus/",
] as const;
const LIMITS_TOTAL = /totalText:\s*(?<n>[\d_]+)/u;

const FENCE = (name: string): RegExp =>
  new RegExp(`\`\`\`${name}\\n(?<body>[\\s\\S]*?)\`\`\``, "gu");

const PLAYBOOK_ITEM =
  /^(?<n>\d+)\.\s+\*\*(?<id>[a-z0-9-]+)\*\*\s+[—-]\s+(?<text>.+)$/gmu;

export type Status = "crash" | "discard" | "idle" | "keep";

export interface PlaybookItem {
  id: string;
  n: number;
  text: string;
}

export interface Standing {
  editable: string[];
  frozen: string[];
  holdout: string[];
  playbook: PlaybookItem[];
  probed: string[];
  sha: string;
  text: string;
}

export interface Scoreboard {
  correctAndClean: number;
  gapErrors: number;
  holdoutsUnknown: boolean;
  recipeClean: boolean;
  recipeHoles: number;
  testsOk: boolean;
  twinEval:
    | { empty: number; filled: number; outlined: number }
    | { skipped: string };
  twinPairErrors: number;
  typecheckOk: boolean;
}

export interface Decision {
  reasons: string[];
  status: Status;
}

export interface ApplyResult {
  description: string;
  kind: "applied" | "skip";
}

export interface RoundRecord {
  commit: string;
  description: string;
  metric: string;
  status: Status;
}

export interface CampaignOptions {
  branch?: string;
  cwd?: string;
  floor?: "analog" | "full";
  house?: string;
  propose?: boolean | string;
  restoreBranch?: boolean;
  rounds: number;
  standing?: string;
}

export interface CampaignDeps {
  applyEdit?: (
    item: PlaybookItem,
    standing: Standing,
    root: string
  ) => ApplyResult;
  measure?: (root: string, standing: Standing) => Promise<Scoreboard>;
  propose?: (standing: Standing, root: string) => Promise<ApplyResult | null>;
}

export class AutoresearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutoresearchError";
  }
}

const git = (cwd: string, args: string[], input?: string): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

const bullets = (paths: readonly string[]): string =>
  paths.map((p) => `  ${p}`).join("\n");

const linesOf = (body: string): string[] =>
  body
    .split("\n")
    .map((line) => line.replace(/#.*$/u, "").trim())
    .filter(Boolean);

export const parseFence = (text: string, name: string): string[] => {
  const out: string[] = [];
  for (const m of text.matchAll(FENCE(name))) {
    out.push(...linesOf(m.groups?.body ?? ""));
  }
  return out;
};

export const parsePlaybook = (text: string): PlaybookItem[] => {
  const items: PlaybookItem[] = [];
  for (const m of text.matchAll(PLAYBOOK_ITEM)) {
    items.push({
      id: m.groups?.id ?? "",
      n: Number(m.groups?.n),
      text: (m.groups?.text ?? "").trim(),
    });
  }
  return items.filter((item) => item.id.length > 0);
};

export const parseStanding = (text: string): Standing => {
  const holdout = parseFence(text, "holdout");
  const probed = parseFence(text, "probed");
  return {
    editable: parseFence(text, "editable"),
    frozen: parseFence(text, "frozen"),
    holdout: holdout.length > 0 ? holdout : [...HOLD_OUT_UNKNOWN],
    playbook: parsePlaybook(text),
    probed: probed.length > 0 ? probed : [...DEFAULT_PROBED],
    sha: createHash("sha256").update(text).digest("hex").slice(0, 12),
    text,
  };
};

export const readStanding = (file: string): Standing => {
  if (!existsSync(file)) {
    throw new AutoresearchError(
      `No autoresearch.md at "${file}".\n\n` +
        "It is the standing instruction file: what to try, what is off limits,\n" +
        "and which paths this campaign may write. The loop reads it and does\n" +
        "not write it. Without it there is nothing steering this run.\n"
    );
  }
  return parseStanding(readFileSync(file, "utf-8"));
};

const allowedUntracked = (rel: string): boolean => {
  const norm = rel.replace(/^\.\//u, "").replace(/\/$/u, "");
  return (
    norm === RESULTS_REL ||
    norm === NEXT_REL ||
    norm === "results.tsv" ||
    norm === "NEXT.md" ||
    norm === ".staging" ||
    norm === "packages/iconsmith/.staging" ||
    norm.startsWith(".staging/autoresearch") ||
    norm.startsWith("packages/iconsmith/.staging/autoresearch")
  );
};

export const pathMatches = (rel: string, pattern: string): boolean => {
  const norm = rel.replaceAll("\\", "/").replace(/^\.\//u, "");
  const pat = pattern.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (pat === norm) {
    return true;
  }
  if (pat.endsWith("/**")) {
    const prefix = pat.slice(0, -3);
    return norm === prefix || norm.startsWith(`${prefix}/`);
  }
  if (pat.endsWith("/*")) {
    const prefix = pat.slice(0, -2);
    if (norm === prefix) {
      return true;
    }
    if (!norm.startsWith(`${prefix}/`)) {
      return false;
    }
    return !norm.slice(prefix.length + 1).includes("/");
  }
  return false;
};

export const isDeniedPath = (rel: string): boolean => {
  const norm = rel.replaceAll("\\", "/").replace(/^\.\//u, "");
  return DENIED_PREFIXES.some(
    (prefix) => norm === prefix.slice(0, -1) || norm.startsWith(prefix)
  );
};

export const isFrozenPath = (rel: string, standing: Standing): boolean =>
  standing.frozen.some((pattern) => pathMatches(rel, pattern));

export const isEditablePath = (rel: string, standing: Standing): boolean =>
  !isDeniedPath(rel) &&
  !isFrozenPath(rel, standing) &&
  standing.editable.some((pattern) => pathMatches(rel, pattern));

/**
 * Tracked edits plus untracked files, minus the untracked ledger.
 * `status --porcelain` rather than `diff --name-only`: the campaign must
 * refuse a stray untracked file the way it refuses a dirty analog.ts.
 */
export const dirtyPaths = (cwd: string): string[] => {
  const shown = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf-8",
  });
  if (shown.status !== 0) {
    throw new AutoresearchError(
      `cannot read the working tree state:\n${shown.stderr?.trim() ?? ""}`
    );
  }
  return shown.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
    .map((line) => ({
      path: line.slice(3).replace(/^.* -> /u, ""),
      raw: line,
    }))
    .filter((row) => !(row.raw.startsWith("??") && allowedUntracked(row.path)))
    .map((row) => row.path);
};

export const assertClean = (cwd: string): void => {
  const dirty = dirtyPaths(cwd);
  if (dirty.length > 0) {
    throw new AutoresearchError(
      `The working tree has uncommitted changes:\n${bullets(dirty)}\n\n` +
        "The arms are measured against these files, so a kept result could\n" +
        "not be attributed to any commit. Commit or stash first. Untracked\n" +
        `${RESULTS_REL} is allowed.\n`
    );
  }
};

const touchedAgainst = (cwd: string, base: string): string[] =>
  spawnSync("git", ["diff", "--name-only", base], {
    cwd,
    encoding: "utf-8",
  })
    .stdout.split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export const assertEditableOnly = (
  touched: readonly string[],
  standing: Standing
): void => {
  const frozenHit = touched.filter((p) => isFrozenPath(p, standing));
  if (frozenHit.length > 0) {
    throw new AutoresearchError(
      `refusing to keep: the edit touched frozen paths:\n${bullets(frozenHit)}`
    );
  }
  const denied = touched.filter((p) => isDeniedPath(p));
  if (denied.length > 0) {
    throw new AutoresearchError(
      `refusing to keep: the edit dumped denied paths:\n${bullets(denied)}`
    );
  }
  const extra = touched.filter((p) => !isEditablePath(p, standing));
  if (extra.length > 0) {
    throw new AutoresearchError(
      `refusing to keep: the commit touches paths outside the editable set.\n${bullets(touched)}`
    );
  }
  if (touched.length === 0) {
    throw new AutoresearchError(
      "refusing to keep: the working tree is byte-identical to HEAD."
    );
  }
  if (touched.length > MAX_TOUCHED) {
    throw new AutoresearchError(
      `refusing to keep: ${touched.length} paths is an unbounded dump (max ${MAX_TOUCHED}).`
    );
  }
};

export const restoreTree = (cwd: string, base = "HEAD"): void => {
  spawnSync("git", ["reset", "--hard", base], { cwd, encoding: "utf-8" });
};

export const metricOf = (board: Scoreboard): string => {
  const twin =
    "skipped" in board.twinEval
      ? "twin=skip"
      : `twin=${board.twinEval.outlined.toFixed(3)}/${board.twinEval.filled.toFixed(3)}/empty=${board.twinEval.empty}`;
  return [
    `correct=${board.correctAndClean}`,
    `holes=${board.recipeHoles}`,
    `pair=${board.twinPairErrors}`,
    `gap=${board.gapErrors}`,
    `recipes=${board.recipeClean ? "clean" : "dirty"}`,
    `holdout=${board.holdoutsUnknown ? "unknown" : "drawn"}`,
    `tests=${board.testsOk ? "ok" : "red"}`,
    twin,
  ].join(" ");
};

const floorHolds = (board: Scoreboard): string[] => {
  const reasons: string[] = [];
  if (!board.testsOk) {
    reasons.push("tests red");
  }
  if (!board.typecheckOk) {
    reasons.push("typecheck red");
  }
  if (!board.recipeClean) {
    reasons.push("recipe set is not analog-clean");
  }
  if (!board.holdoutsUnknown) {
    reasons.push("a hold-out left unknown (star/compass/quokka/xyzzy)");
  }
  if (!("skipped" in board.twinEval)) {
    if (board.twinEval.outlined < 0.99) {
      reasons.push(
        `twin-eval outlined ${board.twinEval.outlined.toFixed(3)} < 0.99`
      );
    }
    if (
      Number.isFinite(board.twinEval.filled) &&
      board.twinEval.filled < 0.99
    ) {
      reasons.push(
        `twin-eval filled ${board.twinEval.filled.toFixed(3)} < 0.99`
      );
    }
    if (board.twinEval.empty > 0) {
      reasons.push(`twin-eval empty ${board.twinEval.empty}`);
    }
  }
  return reasons;
};

/** Keep only when every floor holds and one advance number improves. */
export const decide = (before: Scoreboard, after: Scoreboard): Decision => {
  if (!after.testsOk) {
    return { reasons: ["tests red"], status: "crash" };
  }
  const floor = floorHolds(after);
  if (floor.length > 0) {
    return { reasons: floor, status: "discard" };
  }
  const advances: string[] = [];
  if (after.correctAndClean > before.correctAndClean) {
    advances.push(
      `correctAndClean ${before.correctAndClean} → ${after.correctAndClean}`
    );
  }
  if (after.recipeHoles < before.recipeHoles) {
    advances.push(`recipeHoles ${before.recipeHoles} → ${after.recipeHoles}`);
  }
  if (after.twinPairErrors < before.twinPairErrors) {
    advances.push(
      `twinPairErrors ${before.twinPairErrors} → ${after.twinPairErrors}`
    );
  }
  if (after.gapErrors < before.gapErrors) {
    advances.push(`gapErrors ${before.gapErrors} → ${after.gapErrors}`);
  }
  if (advances.length === 0) {
    return {
      reasons: ["floor held but no advance metric improved"],
      status: "discard",
    };
  }
  return { reasons: advances, status: "keep" };
};

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

const analogOf = (name: string, finish: "filled" | "outlined") =>
  analogArm()({ name }, { finish });

const isUnknown = (name: string): boolean =>
  analogConstructions(name, [], name, false)[0]?.id === "unknown";

const recipeDraws = (id: string): boolean =>
  analogConstructions(id, [], id, false)[0]?.id === id;

export const recipeHolesOf = (): number =>
  PAINT_RECIPES.filter((recipe) => !recipeDraws(recipe.id)).length;

export const leftoverOf = (standing: Standing, board: Scoreboard): string => {
  const holes = PAINT_RECIPES.filter((recipe) => !recipeDraws(recipe.id)).map(
    (recipe) => recipe.id
  );
  if (holes.length > 0) {
    return `recipe-without-drawing: ${holes.join(", ")}`;
  }
  for (const name of standing.probed) {
    if (standing.holdout.includes(name)) {
      continue;
    }
    if (isUnknown(name)) {
      return (
        `concept-correct net-new: analog still unknown for ${name}. ` +
        "One family or one mapping, not a kin dump. tree-house stays unknown."
      );
    }
  }
  if (recipeFor("heart") === null) {
    return "heart-recipe: family exists, paint recipe missing";
  }
  if (recipeFor("bell") === null) {
    return "bell-recipe: family exists, paint recipe missing";
  }
  if (board.twinPairErrors > 0) {
    return `twin-pair errors still ${board.twinPairErrors} (empty / extent / finish)`;
  }
  if (board.gapErrors > 0) {
    return `gap errors still ${board.gapErrors}`;
  }
  return (
    "no scripted leftover; one honest generation-pipeline change that " +
    "advances the scoreboard without raising LIMITS.totalText or volunteering glyphs"
  );
};

export interface CloudBriefInput {
  branch: string;
  lastKeep: string;
  leftover: string;
  metric: string;
  standing: Standing;
}

export const renderCloudBrief = (input: CloudBriefInput): string => {
  const editable = input.standing.editable.join("\n");
  const frozen = input.standing.frozen.join("\n");
  return [
    "# Cloud Agent spawn brief",
    "",
    `Paste this file into a **new** Cloud Agent at ${CLOUD_AGENTS_URL}.`,
    "",
    "The `cursor-cloud` MCP can list/inspect Cloud Agents. It cannot launch one.",
    "This VM has no spawn CLI or API token either. Do not invent a launcher.",
    "",
    "## Repo and branch",
    "",
    `- Work ONLY on \`${WORKER_BRANCHES[0]}\` or \`${WORKER_BRANCHES[1]}\` (this run: \`${input.branch}\`).`,
    "- Do not edit `cursor/filled-twins-c1f5`.",
    "- Do not merge. Commit + push. If the floor drops, revert.",
    "- Do not commit secrets, corpus, results.tsv, or NEXT.md.",
    "",
    "## Current metric / last keep",
    "",
    `- metric: \`${input.metric}\``,
    `- last keep: ${input.lastKeep}`,
    `- standing sha: \`${input.standing.sha}\``,
    "",
    "## The one leftover to attack",
    "",
    input.leftover,
    "",
    "One change. Hacky complexity is a discard. Do not volunteer star/compass/quokka/xyzzy.",
    "Do not raise LIMITS.totalText.",
    "",
    "## Editable",
    "",
    "```",
    editable,
    "```",
    "",
    "## Frozen",
    "",
    "```",
    frozen,
    "```",
    "",
    "## After the edit",
    "",
    "Run the tests you invoke. Commit + push editable paths only. Do not merge.",
    "If the floor drops, revert.",
    "",
  ].join("\n");
};

export const nextPath = (root: string): string =>
  existsSync(path.join(root, "packages/iconsmith"))
    ? path.join(root, "packages/iconsmith", NEXT_REL)
    : path.join(root, NEXT_REL);

export const writeCloudBrief = (
  root: string,
  input: CloudBriefInput
): string => {
  const dest = nextPath(root);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, renderCloudBrief(input));
  return dest;
};

export const findCloudAgentLauncher = (): string | null => {
  for (const cmd of [
    "cursor-cloud-spawn",
    "cursor-agent-spawn",
    "agent-spawn",
  ]) {
    const found = spawnSync("which", [cmd], { encoding: "utf-8" });
    if (found.status === 0 && found.stdout.trim().length > 0) {
      return found.stdout.trim();
    }
  }
  return null;
};

const countIssues = async (
  names: readonly string[],
  rule: string
): Promise<number> => {
  let n = 0;
  for (const name of names) {
    for (const finish of ["outlined", "filled"] as const) {
      // oxlint-disable-next-line no-await-in-loop
      const drawn = await analogOf(name, finish);
      n += drawn.issues.filter(
        (issue) => issue.rule === rule && issue.severity === "error"
      ).length;
    }
  }
  return n;
};

const runVitest = (root: string, files: readonly string[]): boolean => {
  const workspace = path.join(root, "packages/iconsmith");
  const cwd = existsSync(path.join(workspace, "package.json"))
    ? workspace
    : root;
  return (
    spawnSync("npx", ["vitest", "run", "--passWithNoTests", ...files], {
      cwd,
      encoding: "utf-8",
    }).status === 0
  );
};

const runTypecheck = (root: string): boolean => {
  const workspace = path.join(root, "packages/iconsmith");
  const cwd = existsSync(path.join(workspace, "package.json"))
    ? workspace
    : root;
  return (
    spawnSync("npx", ["tsc", "--noEmit"], { cwd, encoding: "utf-8" }).status ===
    0
  );
};

export const measureScoreboard = async (
  root: string,
  standing: Standing,
  options: { floor?: "analog" | "full"; house?: string } = {}
): Promise<Scoreboard> => {
  const floor = options.floor ?? "analog";
  const testsOk =
    floor === "full"
      ? runVitest(root, [])
      : runVitest(root, [
          "src/pipeline/analog.test.ts",
          "src/pipeline/recipe.test.ts",
        ]);
  const typecheckOk = floor === "full" ? runTypecheck(root) : true;

  const recipeDrawings = await Promise.all(
    PAINT_RECIPES.flatMap((recipe) =>
      (["outlined", "filled"] as const).map((finish) =>
        analogOf(recipe.id, finish)
      )
    )
  );
  const recipeClean = recipeDrawings.every((drawn) => drawn.clean);

  const probedPairs = await Promise.all(
    standing.probed.map(async (name) => {
      const rows = await Promise.all(
        (["outlined", "filled"] as const).map((finish) =>
          analogOf(name, finish)
        )
      );
      return rows.every(
        (row) =>
          row.clean &&
          typeof row.brief === "string" &&
          !row.brief.startsWith("analog unknown ")
      );
    })
  );
  const correctAndClean = probedPairs.filter(Boolean).length;

  const holdoutsUnknown = standing.holdout.every((name) => isUnknown(name));
  const twinPairErrors =
    (await countIssues(standing.probed, "empty")) +
    (await countIssues(standing.probed, "extent")) +
    (await countIssues(standing.probed, "finish"));
  const gapErrors = await countIssues(standing.probed, "gap");

  let twinEval: Scoreboard["twinEval"] = { skipped: "house files not given" };
  const { house } = options;
  if (house && existsSync(house) && existsSync(path.join(house, "outlined"))) {
    const out = path.join(root, ".staging/autoresearch/twin-eval");
    const rows = await evaluateTwins(house, out);
    const outlined = rows.map((r) => r.cosineOutlined);
    const filled = rows
      .map((r) => r.cosineFilled)
      .filter((n): n is number => n !== null);
    twinEval = {
      empty: rows.filter((r) => r.emptyOutlined || r.emptyFilled).length,
      filled: filled.length === 0 ? Number.NaN : mean(filled),
      outlined: mean(outlined),
    };
  } else if (house) {
    twinEval = { skipped: `house missing at ${house}` };
  }

  return {
    correctAndClean,
    gapErrors,
    holdoutsUnknown,
    recipeClean,
    recipeHoles: recipeHolesOf(),
    testsOk,
    twinEval,
    twinPairErrors,
    typecheckOk,
  };
};

const workspaceFile = (root: string, rel: string): string => {
  const nested = path.join(root, rel);
  if (existsSync(nested)) {
    return nested;
  }
  return path.join(root, rel.replace(/^packages\/iconsmith\//u, ""));
};

export const totalTextLimit = (root: string): number | null => {
  const file = workspaceFile(root, "packages/iconsmith/src/pipeline/policy.ts");
  if (!existsSync(file)) {
    return null;
  }
  const match = LIMITS_TOTAL.exec(readFileSync(file, "utf-8"));
  const raw = match?.groups?.n;
  return raw === undefined ? null : Number(raw.replaceAll("_", ""));
};

const neighborTestsOf = (
  root: string,
  touched: readonly string[]
): string[] => {
  const extra: string[] = [];
  for (const rel of touched) {
    const local = rel.replace(/^packages\/iconsmith\//u, "");
    if (local.endsWith(".test.ts")) {
      extra.push(local);
    } else if (local.endsWith(".ts")) {
      const testRel = local.replace(/\.ts$/u, ".test.ts");
      if (
        existsSync(path.join(root, "packages/iconsmith", testRel)) ||
        existsSync(path.join(root, testRel))
      ) {
        extra.push(testRel);
      }
    } else if (local.endsWith("SKILL.md")) {
      extra.push("src/pipeline/skill.test.ts");
    }
  }
  return extra;
};

const insertOnce = (
  source: string,
  find: string,
  replace: string,
  label: string
): string => {
  if (!source.includes(find)) {
    throw new AutoresearchError(`playbook ${label}: anchor not found`);
  }
  if (source.includes(replace) && replace !== find) {
    return source;
  }
  return source.replace(find, replace);
};

const HOME_FN = `/** Roof diamond on a body — a house, not a tent (tent is a floor bar). */
export const home = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    ...lozenge(finish, 12, 9, 5),
    mass(finish, 7, 13, 10, 6, 1),
  ]);

`;

const HEART_RECIPE = `  {
    filled:
      "two lobes and a diamond point as one evenodd compound. Not a disc, and not a volunteered star.",
    id: "heart",
    outlined: "two lobes and a diamond point. Not a box.",
    tokens: ["heart"],
  },
`;

const BELL_RECIPE = `  {
    filled:
      "dome, skirt, and clapper as one mass. Not a hub, and not a volunteered glyph.",
    id: "bell",
    outlined: "dome, skirt, clapper. Not a hub.",
    tokens: ["bell"],
  },
`;

const applyHomeFamily = (root: string): ApplyResult => {
  const file = workspaceFile(root, "packages/iconsmith/src/pipeline/analog.ts");
  let src = readFileSync(file, "utf-8");
  if (src.includes("export const home =")) {
    return { description: "home family already present", kind: "skip" };
  }
  src = insertOnce(
    src,
    `/**
 * A framed mark with a centre node. The honest drawing when no token, kin,
 * or named part answers — not a hub, which is an org chart.
 */
export const unknown`,
    `${HOME_FN}/**
 * A framed mark with a centre node. The honest drawing when no token, kin,
 * or named part answers — not a hub, which is an org chart.
 */
export const unknown`,
    "home-family"
  );
  src = insertOnce(
    src,
    "  heart,\n  horn,",
    "  heart,\n  home,\n  horn,",
    "home-family FAMILY_DRAW"
  );
  src = insertOnce(
    src,
    String.raw`export const HEART_HINT = /\b(?:hearts?)\b/iu;`,
    String.raw`export const HEART_HINT = /\b(?:hearts?)\b/iu;
export const HOME_HINT = /^(?:homes?|houses?)$/iu;`,
    "home-family HOME_HINT"
  );
  src = insertOnce(
    src,
    `  { hint: HEART_HINT, id: "heart" },`,
    `  { hint: HEART_HINT, id: "heart" },\n  { hint: HOME_HINT, id: "home" },`,
    "home-family FAMILY_HINTS"
  );
  writeFileSync(file, src);
  return { description: "add home family (roof + body)", kind: "applied" };
};

const applyRecipe = (
  root: string,
  id: "bell" | "heart",
  block: string
): ApplyResult => {
  const file = workspaceFile(root, "packages/iconsmith/src/pipeline/recipe.ts");
  const src = readFileSync(file, "utf-8");
  if (src.includes(`id: "${id}"`)) {
    return { description: `${id} recipe already present`, kind: "skip" };
  }
  const next = insertOnce(
    src,
    `    tokens: ["lock"],
  },
];`,
    `    tokens: ["lock"],
  },
${block}];`,
    `${id}-recipe`
  );
  writeFileSync(file, next);
  return { description: `add ${id} paint recipe`, kind: "applied" };
};

const cactusHasGapError = async (): Promise<boolean> =>
  (await countIssues(["cactus"], "gap")) > 0;

const towerTubeHasGapError = async (): Promise<boolean> =>
  (await countIssues(["lighthouse", "telescope", "tower"], "gap")) > 0;

const checkmarkDirty = async (): Promise<boolean> => {
  for (const finish of ["outlined", "filled"] as const) {
    // oxlint-disable-next-line no-await-in-loop
    const drawn = await analogOf("checkmark", finish);
    if (!drawn.clean) {
      return true;
    }
  }
  return false;
};

export const playbookDone = async (item: PlaybookItem): Promise<boolean> => {
  switch (item.id) {
    case "recipe-drawings": {
      return recipeHolesOf() === 0;
    }
    case "cactus-gap": {
      return !(await cactusHasGapError());
    }
    case "tower-tube-gap": {
      return !(await towerTubeHasGapError());
    }
    case "checkmark-clean": {
      return !(await checkmarkDirty());
    }
    case "home-family": {
      return !isUnknown("home");
    }
    case "heart-recipe": {
      return recipeFor("heart") !== null;
    }
    case "bell-recipe": {
      return recipeFor("bell") !== null;
    }
    case "skill-steer":
    case "twin-pair":
    case "gap-error": {
      return true;
    }
    default: {
      return false;
    }
  }
};

export const applyPlaybook = (
  item: PlaybookItem,
  root: string
): ApplyResult => {
  switch (item.id) {
    case "recipe-drawings":
    case "cactus-gap":
    case "tower-tube-gap":
    case "checkmark-clean": {
      return { description: `${item.id} already holds; no edit`, kind: "skip" };
    }
    case "home-family": {
      return applyHomeFamily(root);
    }
    case "heart-recipe": {
      return applyRecipe(root, "heart", HEART_RECIPE);
    }
    case "bell-recipe": {
      return applyRecipe(root, "bell", BELL_RECIPE);
    }
    case "skill-steer":
    case "twin-pair":
    case "gap-error": {
      return {
        description: `${item.id}: Cloud Agent leftover (local skip)`,
        kind: "skip",
      };
    }
    default: {
      throw new AutoresearchError(`unknown playbook id ${item.id}`);
    }
  }
};

const openRouterKey = (): string | undefined => {
  if (process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY;
  }
  const file = "/tmp/openrouter.env";
  if (!existsSync(file)) {
    return undefined;
  }
  const text = readFileSync(file, "utf-8");
  const lined = /^OPENROUTER_API_KEY=(?<key>.+)$/mu.exec(text);
  const key = (lined?.groups?.key ?? text).trim();
  return key.length > 0 ? key : undefined;
};

const applyUnifiedOrReplace = (
  root: string,
  standing: Standing,
  payload: { find?: string; path: string; replace?: string }
): ApplyResult => {
  const rel = payload.path.split(path.sep).join("/");
  if (!isEditablePath(rel, standing)) {
    throw new AutoresearchError(`propose refused ${rel}`);
  }
  if (rel.endsWith(STANDING_NAME)) {
    throw new AutoresearchError("propose refused to write autoresearch.md");
  }
  const file = workspaceFile(root, rel);
  const src = readFileSync(file, "utf-8");
  if (!(payload.find && payload.replace) || !src.includes(payload.find)) {
    throw new AutoresearchError("propose find/replace missing");
  }
  writeFileSync(file, src.replace(payload.find, payload.replace));
  return { description: `propose patch ${rel}`, kind: "applied" };
};

const proposeOpenRouter = async (
  standing: Standing,
  root: string
): Promise<ApplyResult | null> => {
  const key = openRouterKey();
  if (!key) {
    return null;
  }
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      body: JSON.stringify({
        messages: [
          {
            content:
              'Propose one small find/replace on exactly one editable generation-pipeline file. JSON only: {"path","find","replace"}. ' +
              `editable=${standing.editable.join(", ")}. Frozen wins. Do not write autoresearch.md. Do not raise LIMITS.totalText. Do not volunteer star/compass/quokka/xyzzy.`,
            role: "system",
          },
          {
            content: standing.playbook.map((i) => `${i.n}. ${i.id}`).join("\n"),
            role: "user",
          },
        ],
        model: "openai/gpt-4.1-mini",
      }),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  );
  if (!response.ok) {
    return null;
  }
  const json = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  const match = /\{[\s\S]*\}/u.exec(content);
  if (!match) {
    return null;
  }
  return applyUnifiedOrReplace(
    root,
    standing,
    JSON.parse(match[0]) as { find?: string; path: string; replace?: string }
  );
};

const resultsPath = (root: string): string =>
  existsSync(path.join(root, "packages/iconsmith"))
    ? path.join(root, "packages/iconsmith", RESULTS_REL)
    : path.join(root, RESULTS_REL);

export const appendLedger = (
  file: string,
  row: RoundRecord,
  standingSha: string
): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file)) {
    writeFileSync(file, "commit\tmetric\tstatus\tdescription\tprogram\n");
  }
  appendFileSync(
    file,
    `${row.commit}\t${row.metric}\t${row.status}\t${row.description}\t${standingSha}\n`
  );
};

const commitKeep = (
  root: string,
  standing: Standing,
  message: string
): string => {
  const touched = touchedAgainst(root, "HEAD");
  assertEditableOnly(touched, standing);
  for (const rel of touched) {
    git(root, ["add", "--", rel]);
  }
  assertEditableOnly(
    git(root, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean),
    standing
  );
  git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
};

const ensureBranch = (root: string, branch: string): string => {
  const current = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const exists =
    spawnSync(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      { cwd: root }
    ).status === 0;
  if (!exists) {
    git(root, ["branch", branch]);
  }
  if (current !== branch) {
    git(root, ["checkout", branch]);
  }
  return current;
};

const measureFresh = (
  root: string,
  options: { floor?: "analog" | "full"; house?: string }
): Scoreboard => {
  const workspace = path.join(root, "packages/iconsmith");
  const cwd = existsSync(path.join(workspace, "scripts/autoresearch.ts"))
    ? workspace
    : root;
  const args = [
    "tsx",
    path.join(cwd, "scripts/autoresearch.ts"),
    "--measure-json",
  ];
  if (options.house) {
    args.push("--house", options.house);
  }
  if (options.floor) {
    args.push("--floor", options.floor);
  }
  const out = execFileSync("npx", args, { cwd, encoding: "utf-8" });
  const line = out
    .trim()
    .split("\n")
    .toReversed()
    .find((row) => row.startsWith("{"));
  if (!line) {
    throw new AutoresearchError("measure-json produced no scoreboard");
  }
  return JSON.parse(line) as Scoreboard;
};

const pickPlaybook = async (
  standing: Standing,
  tried: Set<string>,
  useDone: boolean
): Promise<PlaybookItem | null> => {
  for (const candidate of standing.playbook) {
    if (tried.has(candidate.id)) {
      continue;
    }
    // Sequential: later items must not run until earlier skips are known.
    // oxlint-disable-next-line no-await-in-loop
    if (useDone && (await playbookDone(candidate))) {
      tried.add(candidate.id);
      continue;
    }
    return candidate;
  }
  return null;
};

const proposeEdit = async (
  standing: Standing,
  root: string,
  options: CampaignOptions,
  deps: CampaignDeps
): Promise<ApplyResult | null> => {
  if (deps.propose) {
    return await deps.propose(standing, root);
  }
  if (options.propose === true) {
    return await proposeOpenRouter(standing, root);
  }
  if (typeof options.propose === "string") {
    const hook = spawnSync(options.propose, {
      cwd: root,
      encoding: "utf-8",
      shell: true,
    });
    if (hook.status === 0 && hook.stdout.trim()) {
      return applyUnifiedOrReplace(
        root,
        standing,
        JSON.parse(hook.stdout) as {
          find?: string;
          path: string;
          replace?: string;
        }
      );
    }
  }
  return null;
};

const note = (
  records: RoundRecord[],
  ledger: string,
  standingSha: string,
  row: RoundRecord
): void => {
  records.push(row);
  appendLedger(ledger, row, standingSha);
  const head =
    row.status === "keep"
      ? `${row.status}\t${row.commit.slice(0, 12)}`
      : row.status;
  process.stdout.write(`${head}\t${row.description}\n`);
};

const crashOf = (description: string, error: unknown): RoundRecord => ({
  commit: "-",
  description: `${description}: ${
    error instanceof Error ? error.message : String(error)
  }`.replaceAll("\t", " "),
  metric: "-",
  status: "crash",
});

const nextEdit = async (
  standing: Standing,
  root: string,
  options: CampaignOptions,
  deps: CampaignDeps,
  tried: Set<string>
): Promise<{ applied: ApplyResult; item: PlaybookItem | null } | null> => {
  const proposed = await proposeEdit(standing, root, options, deps);
  if (proposed) {
    return { applied: proposed, item: null };
  }
  while (true) {
    // oxlint-disable-next-line no-await-in-loop
    const item = await pickPlaybook(
      standing,
      tried,
      deps.applyEdit === undefined
    );
    if (!item) {
      return null;
    }
    tried.add(item.id);
    const applied = deps.applyEdit
      ? deps.applyEdit(item, standing, root)
      : applyPlaybook(item, root);
    if (applied.kind !== "skip") {
      return { applied, item };
    }
  }
};

const guardStanding = (
  root: string,
  standingFile: string,
  standing: Standing,
  before: string
): void => {
  if (readFileSync(standingFile, "utf-8") !== before) {
    throw new AutoresearchError("loop wrote autoresearch.md");
  }
  const touched = touchedAgainst(root, "HEAD");
  if (touched.some((p) => p.endsWith(STANDING_NAME))) {
    throw new AutoresearchError("loop wrote autoresearch.md");
  }
  assertEditableOnly(touched, standing);
};

const settle = (
  root: string,
  standing: Standing,
  applied: ApplyResult,
  item: PlaybookItem | null,
  before: Scoreboard,
  after: Scoreboard
): RoundRecord => {
  const afterLimit = totalTextLimit(root);
  const shown = spawnSync(
    "git",
    ["show", "HEAD:packages/iconsmith/src/pipeline/policy.ts"],
    { cwd: root, encoding: "utf-8" }
  );
  const headMatch = shown.status === 0 ? LIMITS_TOTAL.exec(shown.stdout) : null;
  const beforeLimit =
    headMatch?.groups?.n === undefined
      ? null
      : Number(headMatch.groups.n.replaceAll("_", ""));
  if (beforeLimit !== null && afterLimit !== null && afterLimit > beforeLimit) {
    restoreTree(root);
    return {
      commit: git(root, ["rev-parse", "HEAD"]),
      description: `${applied.description}; LIMITS.totalText raised`,
      metric: metricOf(after),
      status: "discard",
    };
  }
  const verdict = decide(before, after);
  if (verdict.status !== "keep") {
    restoreTree(root);
    return {
      commit: git(root, ["rev-parse", "HEAD"]),
      description: `${applied.description}; ${verdict.reasons.join("; ")}`,
      metric: metricOf(after),
      status: verdict.status,
    };
  }
  const sha = commitKeep(
    root,
    standing,
    `autoresearch: keep ${item?.id ?? "propose"}\n\n${verdict.reasons.join("\n")}\n${metricOf(after)}\nstanding ${standing.sha}`
  );
  return {
    commit: sha,
    description: `${applied.description}; ${verdict.reasons.join("; ")}`,
    metric: metricOf(after),
    status: "keep",
  };
};

export const runCampaign = async (
  options: CampaignOptions,
  deps: CampaignDeps = {}
): Promise<RoundRecord[]> => {
  const root = git(options.cwd ?? WORKSPACE, ["rev-parse", "--show-toplevel"]);
  const standingFile = options.standing ?? path.join(WORKSPACE, STANDING_NAME);
  const standing = readStanding(standingFile);
  assertClean(root);
  const original = ensureBranch(root, options.branch ?? DEFAULT_BRANCH);
  const ledger = resultsPath(root);
  const tried = new Set<string>();
  const records: RoundRecord[] = [];
  let lastKeep = "none";
  const branch = options.branch ?? DEFAULT_BRANCH;
  const takeBoard = async (): Promise<Scoreboard> =>
    deps.measure
      ? await deps.measure(root, standing)
      : measureFresh(root, {
          floor: options.floor,
          house: options.house,
        });
  const brief = (board: Scoreboard): void => {
    writeCloudBrief(root, {
      branch,
      lastKeep,
      leftover: leftoverOf(standing, board),
      metric: metricOf(board),
      standing,
    });
  };

  try {
    for (let spent = 0; spent < options.rounds;) {
      const standingBefore = readFileSync(standingFile, "utf-8");
      // oxlint-disable-next-line no-await-in-loop
      const before = await takeBoard();
      // oxlint-disable-next-line no-await-in-loop
      const picked = await nextEdit(standing, root, options, deps, tried);
      if (!picked) {
        note(records, ledger, standing.sha, {
          commit: git(root, ["rev-parse", "HEAD"]),
          description: "playbook exhausted; Cloud Agent brief written",
          metric: metricOf(before),
          status: "idle",
        });
        brief(before);
        spent += 1;
        continue;
      }
      try {
        guardStanding(root, standingFile, standing, standingBefore);
        const extra = neighborTestsOf(root, touchedAgainst(root, "HEAD"));
        // oxlint-disable-next-line no-await-in-loop
        const after = await takeBoard();
        if (
          extra.length > 0 &&
          options.floor !== "full" &&
          !runVitest(root, extra)
        ) {
          after.testsOk = false;
        }
        const row = settle(
          root,
          standing,
          picked.applied,
          picked.item,
          before,
          after
        );
        if (row.status === "keep") {
          lastKeep = `${row.commit.slice(0, 12)} ${row.description}`;
        }
        note(records, ledger, standing.sha, row);
        brief(row.status === "crash" ? before : after);
      } catch (error) {
        restoreTree(root);
        if (readFileSync(standingFile, "utf-8") !== standingBefore) {
          writeFileSync(standingFile, standingBefore);
        }
        note(
          records,
          ledger,
          standing.sha,
          crashOf(picked.applied.description, error)
        );
        brief(before);
      }
      spent += 1;
    }
  } finally {
    if (options.restoreBranch !== false) {
      const now = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
      if (now !== original) {
        git(root, ["checkout", original]);
      }
    }
  }
  return records;
};

const refuse = (message: string): never => {
  process.stderr.write(message);
  process.exit(2);
};

export const main = async (argv = process.argv.slice(2)): Promise<void> => {
  const { values } = parseArgs({
    args: argv,
    options: {
      branch: { type: "string" },
      floor: { type: "string" },
      house: { type: "string" },
      "measure-json": { type: "boolean" },
      propose: { type: "string" },
      rounds: { type: "string" },
    },
    strict: true,
  });
  const {
    branch,
    floor: floorArg,
    house: houseArg,
    "measure-json": measureJson,
    propose: proposeArg,
    rounds: roundsArg,
  } = values;
  const floor = floorArg === "full" ? "full" : "analog";
  const house =
    houseArg ??
    (existsSync("/tmp/eval-20/house/outlined")
      ? "/tmp/eval-20/house"
      : undefined);
  if (measureJson) {
    const standing = readStanding(path.join(WORKSPACE, STANDING_NAME));
    const board = await measureScoreboard(
      path.join(WORKSPACE, ".."),
      standing,
      {
        floor,
        house,
      }
    );
    process.stdout.write(`${JSON.stringify(board)}\n`);
    return;
  }
  const rounds = roundsArg === undefined ? DEFAULT_ROUNDS : Number(roundsArg);
  if (!Number.isInteger(rounds) || rounds < 1) {
    refuse("--rounds must be a positive integer.\n");
  }
  if (roundsArg === undefined) {
    process.stderr.write(
      `--rounds omitted; default ${DEFAULT_ROUNDS}. Overnight is --rounds ${OVERNIGHT_ROUNDS}.\n`
    );
  }
  let propose: boolean | string = false;
  if (proposeArg === "" || proposeArg === "true") {
    propose = true;
  } else if (proposeArg !== undefined) {
    propose = proposeArg;
  }
  try {
    const records = await runCampaign({
      branch: branch ?? DEFAULT_BRANCH,
      floor,
      house,
      propose,
      rounds,
    });
    const keeps = records.filter((r) => r.status === "keep").length;
    process.stdout.write(
      `${records.length} round(s): ${keeps} keep, ${
        records.filter((r) => r.status === "discard").length
      } discard, ${records.filter((r) => r.status === "crash").length} crash, ${
        records.filter((r) => r.status === "idle").length
      } idle\n`
    );
  } catch (error) {
    refuse(`${error instanceof Error ? error.message : String(error)}\n`);
  }
};

if (process.argv[1]?.endsWith("autoresearch.ts")) {
  await main();
}

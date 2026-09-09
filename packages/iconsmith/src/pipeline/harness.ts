/**
 * The same drawing procedure, run by somebody else's agent.
 *
 * `generate.ts` drives a model through the SDK's tool loop. This drives an
 * external coding-agent CLI — Claude Code, Codex, Cursor, Gemini CLI — over the
 * skill in `SKILL.md`, and takes back a `.icon` program rather than a sequence
 * of tool calls. The program goes through the *same* `run` from `tools/dsl.ts`,
 * which constructs its own `Canvas` and calls the same constrained primitives,
 * so the guarantee is unchanged: there is no op in that language that takes
 * path data, and `raw` is unreachable from it. A harness cannot draw off-spec
 * geometry any more than the built-in loop can.
 *
 * It is shaped as a `GenerateFn` — the seam `eval.ts` already reaches through —
 * rather than as a command beside one. That is the whole point. A skill that
 * exists in code but not in the eval tree is the one that ships broken: if the
 * benchmark scores the built-in loop while people run the skill, we measure the
 * arm nobody uses and ship the arm nobody measures. Behind `GenerateFn`, one
 * scorer runs either arm.
 *
 * Written structurally rather than importing `GenerateFn` from `eval.ts`, for
 * the reason `propose.ts` gives: an arm should not depend on the module that
 * measures it.
 */
import { spawn as spawnProcess } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Cohort } from "../tools/cohort.js";
import { run as runDsl } from "../tools/dsl.js";
import { lint } from "../tools/lint.js";
import type { Finish, Issue } from "../types.js";
import {
  AUDIT_FILE,
  audit,
  PREVIEW_FILE,
  writeAudit,
  writePreview,
} from "./audit.js";
import type { AuditAsk, AuditResult } from "./audit.js";
import { describeProposal } from "./compose.js";
import type { ApiCost } from "./cost.js";
import { applyGatewayEnv } from "./gateway.js";
import type { GenerateOptions, GenerateResult } from "./generate.js";
import { pairAdapted } from "./pair.js";
import type { CohortBrief, Concept } from "./prompt.js";
import type { PartHint } from "./search.js";
import { assembleAddressable, assembleVocabulary } from "./select.js";
import packagedSkillJson from "./skill.json" with { type: "json" };

/** What a harness invocation asks the operating system for. Passed to
 *  {@link Spawn} as one object so a fake can assert on it whole. */
export interface HarnessInvocation {
  /** Cancels the child or in-process Gateway adapter with its owning turn. */
  abortSignal?: AbortSignal;
  args: string[];
  command: string;
  /** The scratch directory. The agent is expected to write its program here,
   *  and nothing outside it is part of the contract. */
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface HarnessRun {
  /** Null when the process was killed by a signal, which includes the timeout. */
  code: number | null;
  /** Provider calls made by an in-process harness adapter. */
  costs?: ApiCost[];
  stderr: string;
  stdout: string;
}

/** Stdout then stderr. Codex `--json` is a JSONL stream on stdout; a crash
 *  dumps the session on stderr. Both are the thinking; dropping either is how
 *  a sample looks rogue with no record of why. */
const joinLog = (run: HarnessRun): string => {
  const out = run.stdout.trim();
  const err = run.stderr.trim();
  if (out && err) {
    return `${out}\n\n--- stderr ---\n${err}\n`;
  }
  return `${out}${err}`;
};

/**
 * The injection seam.
 *
 * Every path into a subprocess goes through this one function, so a test passes
 * a fake that writes a `.icon` file and returns, and no test ever shells out to
 * a real agent or spends a token. It is the only seam, deliberately: a second
 * one would be a code path that behaves differently from the real thing.
 */
export type Spawn = (invocation: HarnessInvocation) => Promise<HarnessRun>;

/** Thrown when the harness itself failed — it exited non-zero, timed out, or
 *  wrote no program. Distinct from a program that ran and drew badly, which is
 *  a score rather than an error. */
export class HarnessError extends Error {
  readonly brief: string;
  readonly log: string;
  readonly program: string | null;
  constructor(
    message: string,
    extras: { brief?: string; log?: string; program?: string | null } = {}
  ) {
    super(message);
    this.name = "HarnessError";
    this.brief = extras.brief ?? "";
    this.log = extras.log ?? "";
    this.program = extras.program ?? null;
  }
}

/** Long enough for an agent to read a skill, draw, lint and fix; short enough
 *  that a wedged CLI cannot hold a benchmark open overnight. */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** The file the agent is told to write, relative to the scratch directory. */
const PROGRAM_FILE = "icon.icon";
/**
 * The vocabulary, written beside the brief when the caller supplies one.
 *
 * Without it this arm is not the same experiment as the built-in loop. That
 * loop's model has `listParts` and `part`; an external agent has neither, so it
 * draws every folder and every chevron from scratch and the route comparison
 * reads as a model difference when it is a tooling difference. Worse, the skill
 * tells it `part` exists — so it writes one, runs `iconsmith draw` to check its
 * own work, gets "no parts file", and spends the timeout trying to find one.
 * Measured: a brief that mentions parts without shipping them ran to the full
 * 10-minute kill; the same brief with this file finished in about two minutes.
 */
const PARTS_FILE = "parts.json";
/** The brief, written beside it so an agent that reads files rather than argv
 *  has somewhere to look, and so a failed run leaves the question on disk. */
const BRIEF_FILE = "BRIEF.md";
const SKILL_FILE = "SKILL.md";

/**
 * The packaged skill as a JavaScript string.
 *
 * `SKILL.md` lives at the package root for agents and humans. The JSON copy
 * is bundled into the CLI so isolated runtimes can stage the same instructions
 * even when the source Markdown is unavailable beside the executable.
 *
 * `skill.test.ts` asserts this text equals the package-root file.
 */
export const packagedSkillText: string = packagedSkillJson.lines.join("\n");

/** Find a workspace or installed-package asset after this module has been
 * bundled into a web-agent runtime, where `import.meta.url` no longer sits
 * beside the original package files. */
const findFromCwd = (relatives: readonly string[]): string | null => {
  let cursor = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    for (const relative of relatives) {
      const candidate = path.join(cursor, relative);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return null;
};

/** The packaged CLI, so `iconsmith draw` in the skill is a command the agent
 *  can actually run. Same lookup as {@link skillPath}: src vs dist. Missing
 *  is fine — a test never builds `dist/`, and the brief still asks for a
 *  program file, which is the deliverable. */
const cliPath = (): string | null => {
  for (const rel of ["./cli.js", "../../dist/cli.js"]) {
    const candidate = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return findFromCwd([
    path.join("packages", "iconsmith", "dist", "cli.js"),
    path.join("node_modules", "iconsmith", "dist", "cli.js"),
  ]);
};

/** Put `iconsmith` on PATH inside the scratch directory. The skill tells the
 *  agent to `iconsmith draw` / `lint`; a temp dir has neither the package
 *  binary nor a global install, so without this the agent invents geometry
 *  it never compiled. */
const stageCli = (dir: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const cli = cliPath();
  if (!cli) {
    return env;
  }
  symlinkSync(cli, path.join(dir, "iconsmith"));
  return { ...env, PATH: `${dir}${path.delimiter}${env.PATH ?? ""}` };
};

/**
 * The packaged skill on disk, when this module still sits next to it.
 *
 * Two candidates because the module sits at `src/pipeline/harness.ts` in the
 * repo and at `dist/index.js` once bundled, and the skill ships at the package
 * root in both. Specifiers are static `new URL("…", import.meta.url)` literals
 * rather than a loop variable, so file tracers can follow them. Missing is
 * not fatal for {@link harnessArm}: it writes {@link packagedSkillText}.
 */
const trySkillPath = (): string | null => {
  const besideSource = fileURLToPath(
    new URL("../../SKILL.md", import.meta.url)
  );
  if (existsSync(besideSource)) {
    return besideSource;
  }
  const besideDist = fileURLToPath(new URL("../SKILL.md", import.meta.url));
  if (existsSync(besideDist)) {
    return besideDist;
  }
  return findFromCwd([
    path.join("packages", "iconsmith", "SKILL.md"),
    path.join("node_modules", "iconsmith", "SKILL.md"),
  ]);
};

export const skillPath = (): string => {
  const found = trySkillPath();
  if (found) {
    return found;
  }
  throw new HarnessError(
    "SKILL.md was not found beside this build. Pass `skill` with its path."
  );
};

/** Copy the skill into scratch when it is a real file. A stub path is left
 *  unchanged so tests can name one without touching the disk. When the caller
 *  did not pass a path and none sits beside this build, write the inlined
 *  copy — that is the Studio / Eve path. */
const stageSkill = (dir: string, skill?: string): string => {
  const dest = path.join(dir, SKILL_FILE);
  if (skill !== undefined) {
    if (!existsSync(skill)) {
      return skill;
    }
    copyFileSync(skill, dest);
    return dest;
  }
  const found = trySkillPath();
  if (found) {
    copyFileSync(found, dest);
    return dest;
  }
  writeFileSync(dest, packagedSkillText);
  return dest;
};

const axisLine = (t: [number, number] | null, name: string): string =>
  t
    ? `- ${name} spans ${t[0].toFixed(2)}..${t[1].toFixed(2)}.`
    : `- ${name} has no agreed extent in this family; centre it.`;

/** One shortlisted mark, as the brief shows it: id, name and where the set
 *  draws it, and no geometry. Exported because the `program` arm shows the
 *  same shortlist and a second format would make the two briefs differ in
 *  something other than the thing under test. */
export const hintLine = (h: PartHint): string => {
  const seen = h.seenIn.length > 0 ? ` — seen in ${h.seenIn.join(", ")}` : "";
  return h.name
    ? `- \`${h.name}\` (\`${h.id}\`)${seen}`
    : `- \`${h.id}\`${seen}`;
};

export interface BriefContext {
  /** Absolute path of the `.icon` file the agent must write. */
  file: string;
  /** Which paint this run draws. The skill describes both; the brief
   *  names this one so a filled spawn does not write an outline. */
  finish?: Finish;
  /** Search hits for this concept, listed in the brief so the agent does not
   *  have to invent `listParts`. Ids are addressable; names are when present. */
  hints: readonly PartHint[];
  keyline: string | null;
  /** Absolute path of the written vocabulary, when there is one. `null` means
   *  the agent has no `part` available and the brief says so rather than
   *  letting the skill promise an op that cannot run. */
  parts: string | null;
  /** Composition extracted from an image-model sketch. Words only: no path
   *  data or coordinates can cross this seam. */
  proposal?: string | null;
  /** Absolute path of the skill that carries the procedure. */
  skill: string;
}

/**
 * The per-icon brief.
 *
 * Thin on purpose, and it says nothing about *how* to draw: that is the skill's
 * job, and restating it here would be a second instruction path that drifts
 * from the file this arm exists to exercise. Name, senses, category, the family
 * extent when there is one, and where to put the program.
 */
export const harnessBrief = (
  concept: Concept,
  ctx: BriefContext,
  cohort?: CohortBrief | null
): string => {
  const lines = [
    `Read the skill at ${ctx.skill} and follow it.`,
    "",
    `Draw the icon \`${concept.name}\`.`,
  ];
  if (ctx.finish === "filled") {
    lines.push(
      "Paint: filled. A shape is its silhouette; interior canvas is `hole`; open `line` and `arc` strokes expand through the host.",
      "Occupy the same visual extent the outline would — preserve structural openings and identifying details; do not flood the bbox.",
      "Compose the named object from listed parts and primitives. A frame with a centre dot is not the concept."
    );
  } else {
    lines.push(
      "Paint: outlined. Compose the named object from listed parts and primitives, not a generic frame-and-dot."
    );
  }
  if (concept.category) {
    lines.push(`Category: ${concept.category}.`);
  }
  if (concept.tags?.length) {
    lines.push(`It also means: ${concept.tags.join(", ")}.`);
  }
  if (ctx.keyline) {
    lines.push(`Use the \`${ctx.keyline}\` keyline.`);
  }
  if (ctx.parts) {
    lines.push(
      "",
      `The set's vocabulary is at ${ctx.parts} — read \`id\` and \`name\`, not the path data. \`part\` accepts either. Prefer a listed mark over redrawing a common shape.`
    );
    if (ctx.hints.length > 0) {
      lines.push(
        "These matched this concept (the same ranking `listParts` uses):",
        ...ctx.hints.map(hintLine)
      );
    }
    lines.push(
      `Check your work with \`iconsmith draw ${ctx.file} --parts ${ctx.parts}\`; without the flag every \`part\` op fails.`
    );
  } else {
    lines.push(
      "",
      "No parts vocabulary is available in this run, so the `part` op has nothing to place. Draw with the primitives."
    );
  }
  if (ctx.proposal) {
    lines.push(
      "",
      "An image-model sketch was reduced to this composition hypothesis:",
      ctx.proposal,
      "Use it as semantic and layout evidence, not as geometry. The DSL remains the only drawing source."
    );
  }
  if (cohort) {
    lines.push(
      "",
      `This icon joins the \`${cohort.name}\` family${cohort.members?.length ? `, alongside ${cohort.members.join(", ")}` : ""}.`,
      "Those icons replace each other in place, so they occupy the same box:",
      axisLine(cohort.extent.x, "x"),
      axisLine(cohort.extent.y, "y"),
      "End the program with `cohort` rather than `fit`.",
      ""
    );
  }
  lines.push(
    "",
    `Write the finished DSL program to ${ctx.file} and nothing else to that path.`,
    "Do not write SVG. The program is the deliverable."
  );
  return lines.join("\n");
};

/** The default argv: Claude Code's non-interactive prompt form. Overridable,
 *  because `codex exec`, `cursor-agent -p` and `gemini -p` each spell it
 *  differently and none of them is more canonical than another. */
const defaultArgs = (brief: string): string[] => ["-p", brief];

/** Collect a child process into a {@link HarnessRun}. A killed child reports a
 *  null code, which the caller turns into a `HarnessError`. Eve executes this
 *  in its own runtime, where detached process groups and child pipe handles can
 *  fail with `spawn EBADF` on macOS. Keep the child attached and collect its
 *  output through ordinary files in the already-isolated scratch directory. */
const nodeSpawn: Spawn = async (invocation) => {
  const stdoutPath = path.join(invocation.cwd, ".harness-stdout.log");
  const stderrPath = path.join(invocation.cwd, ".harness-stderr.log");
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  let child: ReturnType<typeof spawnProcess>;
  try {
    child = spawnProcess(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      detached: false,
      env: invocation.env,
      signal: invocation.abortSignal,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
  } catch (error) {
    closeSync(stdoutFd);
    closeSync(stderrFd);
    throw error;
  }
  const killer = setTimeout(() => {
    if (child.pid === undefined) {
      return;
    }
    try {
      child.kill("SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, invocation.timeoutMs);
  try {
    // `once` rejects if the child emits `error` — a command that is not on PATH
    // — and resolves with the close arguments otherwise.
    const [code] = (await once(child, "close")) as [number | null];
    return {
      code,
      stderr: readFileSync(stderrPath, "utf-8"),
      stdout: readFileSync(stdoutPath, "utf-8"),
    };
  } finally {
    clearTimeout(killer);
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
};

/** Keep native sign-in homes, but never inherit provider billing overrides.
 * CLI settings can also select a provider; subscription callers must use the
 * CLI's native configuration isolation flags, not arbitrary user profiles.
 */
export const subscriptionEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        !/^(?:ANTHROPIC_|OPENAI_|AZURE_OPENAI_|AI_GATEWAY_|OPENROUTER_|GEMINI_|GOOGLE_API_KEY$|CURSOR_API_|CLAUDE_CODE_USE_|CLAUDE_CODE_OAUTH_TOKEN$|CLAUDE_CODE_SIMPLE$|VERCEL_OIDC_TOKEN$)/u.test(
          key
        )
    )
  );

const harnessEnv = (
  billing: "subscription" | "gateway" | undefined,
  command: string,
  dir: string,
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv =>
  billing === "gateway"
    ? applyGatewayEnv(command, dir, stageCli(dir, env))
    : subscriptionEnv(stageCli(dir, env));

export interface HarnessOptions {
  /** Build the command line from the brief. Default: `["-p", brief]`. */
  args?: (brief: string, ctx: BriefContext) => string[];
  /**
   * Host-side look at the rendered drawing. When omitted the arm skips the
   * preview, the audit, and the repair spawn — existing tests stay one-spawn
   * and never reach the gateway. Pass `ask` to enable the seam; production
   * and the demo can do that later without changing the default.
   */
  ask?: AuditAsk;
  /** The families this program may join, already measured — `buildCohorts`
   *  over the set, the same value `iconsmith lint --cohorts` builds. Without
   *  them the `cohort` op has no measured extent to inherit and says so. */
  cohorts?: Cohort[];
  /** Subscription sign-in by default. Gateway billing must be explicit. */
  billing?: "subscription" | "gateway";
  /** The agent CLI. Default `claude`. */
  command?: string;
  env?: NodeJS.ProcessEnv;
  /** Keep the scratch directory after a successful run, to read the program
   *  and the brief. A failed run always keeps it, and names it in the error. */
  keep?: boolean;
  /**
   * How many times to re-spawn after a scored audit that is not ok. Each pass
   * sees the latest preview and findings. `0` disables repair.
   */
  repairs?: number;
  /** Where scratch directories are made. Default the system temp directory. */
  root?: string;
  /** Path to the skill the agent is pointed at. Default: the packaged one. */
  skill?: string;
  /** Swapped in every test; the real one spawns a child process. */
  spawn?: Spawn;
  timeoutMs?: number;
}

/**
 * A generation, structurally. Identical to `eval.ts`'s `GenerateFn`; see the
 * file header for why it is restated rather than imported.
 */
export type GenerateLike = (
  concept: Concept,
  options: GenerateOptions
) => Promise<GenerateResult>;

/** The ops a program ran, in order — the harness arm's answer to the built-in
 *  loop's tool-call trace. It is the program itself, which is the only account
 *  of how this icon was arrived at that survives the subprocess. */
const traceOf = (source: string): string[] =>
  source
    .split("\n")
    .map((l) => l.replace(/(?<lead>^|\s)#.*$/u, "").trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/u)[0].toLowerCase());

/** Which marks this generation may address, and the shortlist that ranked
 *  them: supplied `hints` win, otherwise SELECT searches. Exported so an arm
 *  that is being compared against this one resolves its vocabulary the same
 *  way rather than approximating it. */
export const vocabularyFor = (
  concept: Concept,
  generateOptions: GenerateOptions
): {
  addressable: ReturnType<typeof assembleAddressable>;
  hints: PartHint[];
} => {
  const parts = generateOptions.parts ?? [];
  const aliases = generateOptions.aliases ?? new Map();
  if (generateOptions.hints === undefined) {
    return assembleVocabulary(
      concept,
      parts,
      aliases,
      generateOptions.select ?? "auto"
    );
  }
  return {
    addressable: assembleAddressable(parts, generateOptions.hints),
    hints: generateOptions.hints,
  };
};

/**
 * Findings the host already wrote beside the program. The agent rewrites
 * `icon.icon`; it does not draw from the raster or invent path data.
 */
/**
 * Findings the host already wrote beside the program. The agent rewrites
 * `icon.icon`; it does not draw from the raster or invent path data.
 *
 * Lint errors go in beside the vision findings. They used to be computed after
 * this loop had finished and then discarded, which meant the one class of
 * finding that names its own remedy — `keyline` interpolates the exact scale
 * factor, `extent` the exact mismatch — was never shown to the agent that
 * could act on it. Errors only: a `warn` is a request to confirm a choice was
 * deliberate, and asking an agent to repair one is asking it to undraw the
 * set's own habits.
 */
const appendRepair = (
  base: string,
  reviewed: AuditResult,
  issues: readonly Issue[] = []
): string =>
  [
    base,
    "",
    `The host audited the drawing. Look at ${PREVIEW_FILE} and ${AUDIT_FILE}.`,
    ...reviewed.findings.map((f) => `- ${f.kind}: ${f.message}`),
    ...issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => `- ${issue.rule}: ${issue.message}`),
    `Edit ${PROGRAM_FILE} only. Do not write SVG. Do not emit path data.`,
  ].join("\n");

const programIssues = (
  drawn: ReturnType<typeof runDsl>,
  source: string,
  finish: Finish | undefined,
  parts: GenerateOptions["parts"],
  spec: GenerateOptions["spec"]
): Issue[] =>
  pairAdapted(
    [
      ...drawn.errors.map((message) => ({
        message,
        rule: "dsl" as const,
        severity: "error" as const,
      })),
      ...lint(drawn.canvas, { keyline: drawn.keyline }),
    ],
    finish ?? "outlined",
    source,
    parts ?? [],
    spec
  );

/**
 * An external coding agent as a `GenerateFn`.
 *
 * Native child-process harnesses cannot expose a bill, so their cost remains
 * absent. In-process adapters may return `HarnessRun.costs`; every repair pass
 * is accumulated on the generated result rather than disappearing as setup.
 */
export const harnessArm =
  (options: HarnessOptions = {}): GenerateLike =>
  async (concept, generateOptions) => {
    generateOptions.abortSignal?.throwIfAborted();
    const {
      args = defaultArgs,
      billing,
      ask,
      cohorts = [],
      command = "claude",
      env = process.env,
      keep = false,
      repairs = 1,
      root = tmpdir(),
      skill,
      spawn = nodeSpawn,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    } = options;

    const dir = mkdtempSync(path.join(root, "iconsmith-harness-"));
    const file = path.join(dir, PROGRAM_FILE);
    // The skill is a capability, same as `parts.json`: name it in the brief
    // only if the agent can actually open it. `codex exec --sandbox
    // workspace-write` cannot read a path outside the scratch directory.
    const skillForBrief = stageSkill(dir, skill);
    const runEnv = harnessEnv(billing, command, dir, env);
    const { parts = [], spec } = generateOptions;
    const { addressable, hints } = vocabularyFor(concept, generateOptions);
    let partsFile: string | null = null;
    if (addressable.length > 0) {
      partsFile = path.join(dir, PARTS_FILE);
      // The shape `iconsmith draw --parts` reads. `generated` and `threshold`
      // describe an extraction run this arm did not do.
      writeFileSync(
        partsFile,
        `${JSON.stringify({ parts: addressable }, null, 2)}\n`
      );
    }
    const ctx: BriefContext = {
      file,
      finish: generateOptions.finish,
      hints,
      keyline: generateOptions.keyline ?? null,
      parts: partsFile,
      proposal: generateOptions.proposal
        ? describeProposal(generateOptions.proposal)
        : null,
      skill: skillForBrief,
    };
    const brief = harnessBrief(concept, ctx, generateOptions.cohort);
    writeFileSync(path.join(dir, BRIEF_FILE), `${brief}\n`);

    const logs: string[] = [];
    const apiCosts: ApiCost[] = [];
    const runAgent = async (prompt: string): Promise<HarnessRun> => {
      generateOptions.abortSignal?.throwIfAborted();
      const run = await spawn({
        abortSignal: generateOptions.abortSignal,
        args: args(prompt, ctx),
        command,
        cwd: dir,
        env: runEnv,
        timeoutMs,
      });
      logs.push(joinLog(run));
      apiCosts.push(...(run.costs ?? []));
      const fail = (why: string): never => {
        throw new HarnessError(
          `${command} ${why} while drawing \`${concept.name}\`. Scratch kept at ${dir}.`,
          {
            brief: prompt,
            log: logs.join("\n\n"),
            program: existsSync(file) ? readFileSync(file, "utf-8") : null,
          }
        );
      };
      if (run.code === null) {
        fail(`was killed (no exit code; the timeout is ${timeoutMs}ms)`);
      }
      if (run.code !== 0) {
        fail(`exited ${run.code}: ${run.stderr.trim() || "(no stderr)"}`);
      }
      if (!existsSync(file)) {
        fail(`wrote no program at ${PROGRAM_FILE}`);
      }
      return run;
    };

    let last = await runAgent(brief);
    let source = readFileSync(file, "utf-8");
    let program = runDsl(source, parts, { cohorts, spec });

    // No `ask` means no gateway and no second spawn. Passing one runs the
    // host screenshot, then `audit` (sanitize + fail-open live there), then
    // at most one rewrite of the program.
    let reviewed: AuditResult | undefined;
    if (ask !== undefined) {
      const screen = async (): Promise<AuditResult> => {
        generateOptions.abortSignal?.throwIfAborted();
        const svg = program.canvas.toSVG();
        await writePreview(dir, svg);
        const next = await audit({
          abortSignal: generateOptions.abortSignal,
          ask,
          concept,
          finish: program.canvas.finish,
          kind: generateOptions.lookKind,
          references: generateOptions.lookReferences ?? [],
          svg,
          twin: generateOptions.lookTwin,
        });
        writeAudit(dir, next);
        return next;
      };
      const repairFrom = async (remaining: number): Promise<void> => {
        generateOptions.abortSignal?.throwIfAborted();
        reviewed = await screen();
        if (reviewed.ok || !reviewed.scorable || remaining <= 0) {
          return;
        }
        const revised = appendRepair(
          brief,
          reviewed,
          programIssues(program, source, generateOptions.finish, parts, spec)
        );
        writeFileSync(path.join(dir, BRIEF_FILE), `${revised}\n`);
        // A repair spawn that fails is not a failed run. The program already
        // compiled and the host has already paid for a look at it; discarding
        // it because the agent's *second* answer was not a program throws away
        // the only artefact the run produced, and bills the audit for nothing.
        // Same rule as an audit that throws, one seam along. Measured: of 53
        // scratch directories one Studio campaign left behind, 17 held a
        // finished program, a preview and a scored audit — the arm reported
        // dead on every concept had in fact drawn every one of them.
        try {
          last = await runAgent(revised);
        } catch (error) {
          // Only a harness failure. A cancellation arrives here too, and
          // laundering one into a finished icon would report a turn the caller
          // stopped as a turn that drew.
          if (!(error instanceof HarnessError)) {
            throw error;
          }
          logs.push(`Repair abandoned: ${error.message}`);
          return;
        }
        source = readFileSync(file, "utf-8");
        program = runDsl(source, parts, { cohorts, spec });
        await repairFrom(remaining - 1);
      };
      await repairFrom(Math.max(0, repairs));
    }

    // A refused op is an error against this drawing, not a broken run: the
    // program is what the agent produced, and a run that half-drew scores as a
    // half-drawn icon. Carrying them as issues keeps `clean` honest and leaves
    // the eval's median measuring drawings rather than infrastructure.
    const issues = programIssues(
      program,
      source,
      generateOptions.finish,
      parts,
      spec
    );
    if (!keep) {
      rmSync(dir, { force: true, recursive: true });
    }

    const trace = traceOf(source);
    return {
      apiCosts: apiCosts.length > 0 ? apiCosts : undefined,
      audit: reviewed,
      brief,
      clean: issues.every((i) => i.severity !== "error"),
      doc: program.canvas.toJSON({
        icon: program.icon ?? concept.name,
        keyline: program.keyline,
      }),
      issues,
      log: logs.join("\n\n"),
      program: source,
      // Ops written, not model turns: how many turns the external agent took is
      // its own business and it does not report it.
      steps: trace.length,
      svg: program.canvas.toSVG(),
      text: last.stdout.trim(),
      trace,
    };
  };

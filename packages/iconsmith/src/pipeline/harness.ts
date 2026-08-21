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
  existsSync,
  mkdtempSync,
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
import { applyGatewayEnv } from "./gateway.js";
import type { GenerateOptions, GenerateResult } from "./generate.js";
import type { CohortBrief, Concept } from "./prompt.js";
import type { PartHint } from "./search.js";
import { assembleAddressable, assembleVocabulary } from "./select.js";

/** What a harness invocation asks the operating system for. Passed to
 *  {@link Spawn} as one object so a fake can assert on it whole. */
export interface HarnessInvocation {
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
  stderr: string;
  stdout: string;
}

/** Stdout then stderr. Codex `--json` is a JSONL stream on stdout; a crash
 *  dumps the session on stderr. Both are the thinking; dropping either is how
 *  a sample looks rogue with no record of why. */
export const joinLog = (run: HarnessRun): string => {
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
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

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

/** Copy the skill into scratch when it is a real file. A stub path is left
 *  unchanged so tests can name one without touching the disk. */
const stageSkill = (dir: string, skill: string): string => {
  if (!existsSync(skill)) {
    return skill;
  }
  const dest = path.join(dir, SKILL_FILE);
  copyFileSync(skill, dest);
  return dest;
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
  return null;
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
 * The packaged skill.
 *
 * Two candidates because the module sits at `src/pipeline/harness.ts` in the
 * repo and at `dist/index.js` once bundled, and the skill ships at the package
 * root in both. Resolved by looking, rather than by branching on which build
 * this is, so there is no configuration under which the wrong one is silently
 * used.
 */
export const skillPath = (): string => {
  for (const rel of ["../../SKILL.md", "../SKILL.md"]) {
    const candidate = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new HarnessError(
    "SKILL.md was not found beside this build. Pass `skill` with its path."
  );
};

const axisLine = (t: [number, number] | null, name: string): string =>
  t
    ? `- ${name} spans ${t[0].toFixed(2)}..${t[1].toFixed(2)}.`
    : `- ${name} has no agreed extent in this family; centre it.`;

const hintLine = (h: PartHint): string => {
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
      "Paint: filled. A shape is its silhouette; interior canvas is `hole`; `line` is illegal.",
      "Occupy the same visual extent the outline would — expand the stroke, do not flood the bbox.",
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

/** Collect a child process into a {@link HarnessRun}. The timeout kills the
 *  process group rather than leaving a nested agent CLI holding the run open;
 *  a killed child reports a null code, which the caller turns into a
 *  `HarnessError`. `spawn`'s own `timeout` only signals the direct child, and
 *  `codex exec` wraps a second binary that kept running past it. */
const nodeSpawn: Spawn = async (invocation) => {
  const child = spawnProcess(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    detached: true,
    env: invocation.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const killer = setTimeout(() => {
    if (child.pid === undefined) {
      return;
    }
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, invocation.timeoutMs);
  try {
    // `once` rejects if the child emits `error` — a command that is not on PATH
    // — and resolves with the close arguments otherwise.
    const [code] = (await once(child, "close")) as [number | null];
    return { code, stderr, stdout };
  } finally {
    clearTimeout(killer);
  }
};

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
  /** The agent CLI. Default `claude`. */
  command?: string;
  env?: NodeJS.ProcessEnv;
  /** Keep the scratch directory after a successful run, to read the program
   *  and the brief. A failed run always keeps it, and names it in the error. */
  keep?: boolean;
  /**
   * Whether to re-spawn after an audit that is not ok. Default 1, and this
   * slice only spends that one: the host writes the new preview and stops.
   * `0` disables the repair spawn.
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

const vocabularyFor = (
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
const appendRepair = (base: string, reviewed: AuditResult): string =>
  [
    base,
    "",
    `The host audited the drawing. Look at ${PREVIEW_FILE} and ${AUDIT_FILE}.`,
    ...reviewed.findings.map((f) => `- ${f.kind}: ${f.message}`),
    `Edit ${PROGRAM_FILE} only. Do not write SVG. Do not emit path data.`,
  ].join("\n");

/**
 * An external coding agent as a `GenerateFn`.
 *
 * `cost` is deliberately absent from the result. The external harness bills on
 * its own account and reports nothing this process can observe, and
 * `GenerateCost`'s own docstring says absent means "not measured", never
 * "free" — filling it with zeros would enter a paid arm into the eval's dollar
 * column at nothing, which is worse than a blank.
 */
export const harnessArm =
  (options: HarnessOptions = {}): GenerateLike =>
  async (concept, generateOptions) => {
    const {
      args = defaultArgs,
      ask,
      cohorts = [],
      command = "claude",
      env = process.env,
      keep = false,
      repairs = 1,
      root = tmpdir(),
      skill = skillPath(),
      spawn = nodeSpawn,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    } = options;

    const dir = mkdtempSync(path.join(root, "iconsmith-harness-"));
    const file = path.join(dir, PROGRAM_FILE);
    // The skill is a capability, same as `parts.json`: name it in the brief
    // only if the agent can actually open it. `codex exec --sandbox
    // workspace-write` cannot read a path outside the scratch directory.
    const skillForBrief = stageSkill(dir, skill);
    const runEnv = applyGatewayEnv(command, dir, stageCli(dir, env));
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
      skill: skillForBrief,
    };
    const brief = harnessBrief(concept, ctx, generateOptions.cohort);
    writeFileSync(path.join(dir, BRIEF_FILE), `${brief}\n`);

    const logs: string[] = [];
    const runAgent = async (prompt: string): Promise<HarnessRun> => {
      const run = await spawn({
        args: args(prompt, ctx),
        command,
        cwd: dir,
        env: runEnv,
        timeoutMs,
      });
      logs.push(joinLog(run));
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
        const svg = program.canvas.toSVG();
        await writePreview(dir, svg);
        const next = await audit({
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
      reviewed = await screen();
      if (!reviewed.ok && reviewed.scorable && repairs > 0) {
        const revised = appendRepair(brief, reviewed);
        writeFileSync(path.join(dir, BRIEF_FILE), `${revised}\n`);
        last = await runAgent(revised);
        source = readFileSync(file, "utf-8");
        program = runDsl(source, parts, { cohorts, spec });
        reviewed = await screen();
      }
    }

    // A refused op is an error against this drawing, not a broken run: the
    // program is what the agent produced, and a run that half-drew scores as a
    // half-drawn icon. Carrying them as issues keeps `clean` honest and leaves
    // the eval's median measuring drawings rather than infrastructure.
    const issues: Issue[] = [
      ...program.errors.map((message) => ({
        message,
        rule: "dsl",
        severity: "error" as const,
      })),
      ...lint(program.canvas, { keyline: program.keyline }),
    ];
    if (!keep) {
      rmSync(dir, { force: true, recursive: true });
    }

    const trace = traceOf(source);
    return {
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

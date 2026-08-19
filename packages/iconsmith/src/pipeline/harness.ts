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
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Cohort } from "../tools/cohort.js";
import { run as runDsl } from "../tools/dsl.js";
import { lint } from "../tools/lint.js";
import type { Issue } from "../types.js";
import type { GenerateOptions, GenerateResult } from "./generate.js";
import type { CohortBrief, Concept } from "./prompt.js";

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
  constructor(message: string) {
    super(message);
    this.name = "HarnessError";
  }
}

/** Long enough for an agent to read a skill, draw, lint and fix; short enough
 *  that a wedged CLI cannot hold a benchmark open overnight. */
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** The file the agent is told to write, relative to the scratch directory. */
const PROGRAM_FILE = "icon.icon";
/** The brief, written beside it so an agent that reads files rather than argv
 *  has somewhere to look, and so a failed run leaves the question on disk. */
const BRIEF_FILE = "BRIEF.md";

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

export interface BriefContext {
  /** Absolute path of the `.icon` file the agent must write. */
  file: string;
  keyline: string | null;
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
  if (concept.category) {
    lines.push(`Category: ${concept.category}.`);
  }
  if (concept.tags?.length) {
    lines.push(`It also means: ${concept.tags.join(", ")}.`);
  }
  if (ctx.keyline) {
    lines.push(`Use the \`${ctx.keyline}\` keyline.`);
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
 *  child rather than leaving it holding the run open; a killed child reports a
 *  null code, which the caller turns into a `HarnessError`. */
const nodeSpawn: Spawn = async (invocation) => {
  const child = spawnProcess(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    timeout: invocation.timeoutMs,
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  // `once` rejects if the child emits `error` — a command that is not on PATH
  // — and resolves with the close arguments otherwise.
  const [code] = (await once(child, "close")) as [number | null];
  return { code, stderr, stdout };
};

export interface HarnessOptions {
  /** Build the command line from the brief. Default: `["-p", brief]`. */
  args?: (brief: string, ctx: BriefContext) => string[];
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
      cohorts = [],
      command = "claude",
      env = process.env,
      keep = false,
      root = tmpdir(),
      skill = skillPath(),
      spawn = nodeSpawn,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    } = options;

    const dir = mkdtempSync(path.join(root, "iconsmith-harness-"));
    const file = path.join(dir, PROGRAM_FILE);
    const ctx: BriefContext = {
      file,
      keyline: generateOptions.keyline ?? null,
      skill,
    };
    const brief = harnessBrief(concept, ctx, generateOptions.cohort);
    writeFileSync(path.join(dir, BRIEF_FILE), `${brief}\n`);

    const fail = (why: string): never => {
      throw new HarnessError(
        `${command} ${why} while drawing \`${concept.name}\`. Scratch kept at ${dir}.`
      );
    };

    const result = await spawn({
      args: args(brief, ctx),
      command,
      cwd: dir,
      env,
      timeoutMs,
    });
    if (result.code === null) {
      fail(`was killed (no exit code; the timeout is ${timeoutMs}ms)`);
    }
    if (result.code !== 0) {
      fail(`exited ${result.code}: ${result.stderr.trim() || "(no stderr)"}`);
    }
    if (!existsSync(file)) {
      fail(`wrote no program at ${PROGRAM_FILE}`);
    }

    const source = readFileSync(file, "utf-8");
    const program = runDsl(source, generateOptions.parts ?? [], { cohorts });
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
      clean: issues.every((i) => i.severity !== "error"),
      doc: program.canvas.toJSON({
        icon: program.icon ?? concept.name,
        keyline: program.keyline,
      }),
      issues,
      // Ops written, not model turns: how many turns the external agent took is
      // its own business and it does not report it.
      steps: trace.length,
      svg: program.canvas.toSVG(),
      text: result.stdout.trim(),
      trace,
    };
  };

/**
 * A drawing arm whose model writes a *builder program* in JavaScript instead
 * of writing the `.icon` file out by hand.
 *
 * The DSL has no arithmetic on purpose (`tools/dsl.ts`: naming the turns is
 * what keeps `part tip turn 37` unwritable). The price is that repetition is
 * transcription — eight teeth around a ring is eight authored `part` lines,
 * and eight authored lines is eight chances to drift. This arm gives the model
 * loops and variables and keeps every coordinate on the host side.
 *
 * The JavaScript is **not** a second icon format. Host functions append DSL
 * lines; the emitted program then goes through the same `run` from
 * `tools/dsl.ts` as every other arm, so lint, twin, `view` and replay are
 * unchanged. Two things keep the one invariant intact:
 *
 * 1. There is no `raw` host function, exactly as `raw` has no DSL word. The
 *    sandbox has no filesystem, no network and no `eval`, and the only values
 *    that cross the boundary are arguments to declared functions — so there is
 *    no route by which path data reaches the document.
 * 2. {@link completeProgram} is asserted on the way out: the emitted `.icon`
 *    must replay to a byte-identical document. A drawing the DSL cannot
 *    express fails here rather than being described in prose as impossible.
 *
 * The model's code runs in QuickJS on a worker thread (`run`, from
 * vercel-labs), which is what makes evaluating it something other than `eval`.
 */
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import { run as runSandbox } from "run";
import type { HostFunctions, RunLimits } from "run";

import { SPEC } from "../tools/canvas.js";
import type { Spec, Canvas } from "../tools/canvas.js";
import type { Cohort } from "../tools/cohort.js";
import { completeProgram, run as runDsl } from "../tools/dsl.js";
import { lint } from "../tools/lint.js";
import type { Finish, IconDoc, Issue, Keyline, Part } from "../types.js";
import type { ApiCost } from "./cost.js";
import { tokenUsageOf } from "./cost.js";
import { DEFAULT_MODEL, gatewayCostTracker, resolveModel } from "./gateway.js";
import type { GenerateLike } from "./harness.js";

/**
 * Enough calls for a dense icon and its helpers, and not enough for a runaway
 * loop. The package default is 256; a `place.grid` of 6×6 spends 36 on its own
 * before the composition around it, so 256 is a limit a legitimate program can
 * reach and this one is not.
 */
const MAX_BRIDGE_REQUESTS = 1024;
const TIMEOUT_MS = 10_000;

/** The three turns that are not the identity. Names, never degrees — the same
 *  table `tools/dsl.ts` exports, reached through the DSL text rather than
 *  duplicated, so a program and a generation cannot mean different things. */
const TURN_NAMES = new Set(["ccw", "cw", "half"]);

export interface ProgramRunOptions {
  cohorts?: Cohort[];
  limits?: RunLimits;
  spec?: Spec;
}

export interface ProgramRunResult {
  canvas: Canvas;
  doc: IconDoc;
  /** DSL errors, host-function refusals and any throw that escaped the
   *  sandbox, in the order they happened. Never thrown: a program that fails
   *  halfway still reports what it drew, matching the DSL's own contract. */
  errors: string[];
  finish: Finish;
  icon: string | null;
  issues: Issue[];
  keyline: Keyline | null;
  /** The `.icon` program the JavaScript emitted. This is the artefact. */
  program: string;
  /** The op heads in order — this arm's answer to a tool-call trace. */
  trace: string[];
}

/** Format a number for a DSL token. Trailing zeros would parse but they make
 *  the emitted program a worse diff than a hand-written one. */
const n = (value: number, what: string): string => {
  if (!Number.isFinite(value)) {
    throw new TypeError(
      `${what} must be a finite number, got ${String(value)}`
    );
  }
  return String(Math.round(value * 1000) / 1000);
};

const pair = (x: number, y: number, what: string): string =>
  `${n(x, `${what} x`)},${n(y, `${what} y`)}`;

/** A word that has to survive tokenisation: the DSL splits on whitespace, so a
 *  slug or part name containing any would silently become two tokens. */
const word = (value: unknown, what: string): string => {
  const text = String(value ?? "").trim();
  if (text === "" || /\s/u.test(text)) {
    throw new Error(`${what} must be a single word, got "${String(value)}"`);
  }
  return text;
};

const turnSuffix = (turn: unknown): string => {
  if (turn === undefined || turn === null) {
    return "";
  }
  const name = word(turn, "turn");
  if (!TURN_NAMES.has(name)) {
    throw new Error(
      `unknown turn "${name}" — expected one of ${[...TURN_NAMES].toSorted().join(", ")}. ` +
        "Turns are named quarters; a number here would be a coordinate by another name."
    );
  }
  return ` turn ${name}`;
};

interface PartPlacement {
  at?: string;
  fill?: boolean;
  flip?: boolean;
  name: string;
  size?: number;
  turn?: string;
}

/** `part <name> [at ...] [size n | fill] [turn ...] [flip]`, in grammar order.
 *  `size` and `fill` are alternatives in the grammar, so asking for both is a
 *  refusal rather than a silent precedence rule. */
const partLine = (place: PartPlacement): string => {
  if (place.fill && place.size !== undefined) {
    throw new Error(
      "a part takes `size` or `fill`, not both: `fill` scales to the keyline, " +
        "so a size beside it is either redundant or contradicted"
    );
  }
  const bits = [`part ${word(place.name, "part name")}`];
  if (place.at !== undefined) {
    bits.push(`at ${place.at}`);
  }
  if (place.fill) {
    bits.push("fill");
  } else if (place.size !== undefined) {
    bits.push(`size ${n(place.size, "size")}`);
  }
  bits.push(turnSuffix(place.turn).trimStart());
  if (place.flip) {
    bits.push("flip");
  }
  return bits.filter(Boolean).join(" ");
};

/**
 * The measurements `place.*` needs to centre a part on a point.
 *
 * A bare `at x,y` in the DSL names the *top-left*; an anchor names the centre.
 * The helpers here take centres, because "put it here" is the intent and the
 * corner is an implementation detail of the grammar — so they do the same
 * conversion `placePart` does, from the same part dimensions.
 */
const centred = (
  parts: readonly Part[],
  name: string,
  cx: number,
  cy: number,
  size?: number
): { at: string; size?: number } => {
  const part = parts.find((p) => p.id === name || p.name === name);
  if (!part) {
    throw new Error(
      `unknown part "${name}" — call check.parts() to see the vocabulary`
    );
  }
  const span = Math.max(part.w, part.h) || 1;
  const k = size === undefined ? 1 : size / span;
  return { at: pair(cx - (part.w * k) / 2, cy - (part.h * k) / 2, "at"), size };
};

/**
 * Wrap every host function so a refusal is recorded with its reason.
 *
 * The sandbox deliberately scrubs host error detail on the way back to the
 * guest — every throw reaches the program as `Host function failed.` — which
 * is right for a runtime that cannot know what its host functions might say,
 * and useless for a repair loop. So the reason is kept on this side, where
 * `errors` is assembled, and the guest still gets the scrubbed throw.
 */
const guarded = (
  groups: HostFunctions,
  onError: (message: string) => void
): HostFunctions =>
  Object.fromEntries(
    Object.entries(groups).map(([group, fns]) => [
      group,
      Object.fromEntries(
        Object.entries(fns).map(([name, fn]) => [
          name,
          (...args: never[]) => {
            try {
              return fn(...args);
            } catch (error) {
              onError(`${group}.${name}: ${(error as Error).message}`);
              throw error;
            }
          },
        ])
      ),
    ])
  );

/**
 * Execute a model-authored builder program and return the `.icon` it emitted.
 *
 * Never throws for a fault in the program: a sandbox timeout, a refused
 * argument and a mid-program exception all land in `errors` alongside whatever
 * the program managed to draw first, because a half-drawn icon with a reason
 * is more use to a repair loop than an exception is.
 */
export const runProgram = async (
  source: string,
  parts: Part[] = [],
  options: ProgramRunOptions = {}
): Promise<ProgramRunResult> => {
  const lines: string[] = [];
  const errors: string[] = [];
  const emit = (line: string): string => {
    lines.push(line);
    return line;
  };
  const spec = options.spec ?? SPEC;

  /** Replay what has been emitted so far. `check.*` needs a real canvas rather
   *  than a promise about one, and the DSL is cheap enough to re-run: the
   *  programs this arm writes are tens of lines, not thousands. */
  const replay = () =>
    runDsl(lines.join("\n"), parts, { cohorts: options.cohorts, spec });

  const hostFunctions: HostFunctions = {
    check: {
      describe: () => replay().canvas.describe(),
      lint: () => {
        const { canvas, errors: dslErrors, keyline } = replay();
        return {
          errors: dslErrors,
          issues: lint(canvas, { keyline }),
        };
      },
      parts: () =>
        parts.map((p) => ({
          h: p.h,
          id: p.id,
          name: p.name ?? null,
          w: p.w,
        })),
      program: () => lines.join("\n"),
    },
    draw: {
      arc: (a: {
        ccw?: boolean;
        cx: number;
        cy: number;
        from: string;
        r: number;
        sweep: string;
      }) =>
        emit(
          `arc ${pair(a.cx, a.cy, "arc")} r${n(a.r, "r")} ${word(a.sweep, "sweep")} from ${word(a.from, "from")}${a.ccw ? " ccw" : ""}`
        ),
      center: () => emit("center"),
      circle: (a: { cx: number; cy: number; r: number }) =>
        emit(`circle ${pair(a.cx, a.cy, "circle")} r${n(a.r, "r")}`),
      cohort: (name?: string) =>
        emit(name === undefined ? "cohort" : `cohort ${word(name, "cohort")}`),
      diamond: (a: { cx: number; cy: number; r: number }) =>
        emit(`diamond ${pair(a.cx, a.cy, "diamond")} r${n(a.r, "r")}`),
      dot: (a: { cx: number; cy: number; role?: string }) =>
        emit(
          `dot ${pair(a.cx, a.cy, "dot")}${a.role ? ` ${word(a.role, "role")}` : ""}`
        ),
      fit: () => emit("fit"),
      hole: (a: {
        cx?: number;
        cy?: number;
        h?: number;
        offAxis?: boolean;
        points?: [number, number][];
        r?: number;
        shape: string;
        w?: number;
        x?: number;
        y?: number;
      }) => {
        const shape = word(a.shape, "hole shape");
        if (shape === "circle") {
          return emit(
            `hole circle ${pair(a.cx ?? 0, a.cy ?? 0, "hole")} r${n(a.r ?? 0, "r")}`
          );
        }
        if (shape === "rect") {
          return emit(
            `hole rect ${pair(a.x ?? 0, a.y ?? 0, "hole")} ${n(a.w ?? 0, "w")}x${n(a.h ?? 0, "h")}${a.r === undefined ? "" : ` r${n(a.r, "r")}`}`
          );
        }
        if (shape === "line") {
          const pts = a.points ?? [];
          return emit(
            `hole line ${pts.map((p) => pair(p[0], p[1], "hole line")).join(" ")}${a.offAxis ? " off-axis" : ""}`
          );
        }
        throw new Error(
          `unknown hole shape "${shape}" — expected circle, line or rect`
        );
      },
      line: (a: { offAxis?: boolean; points: [number, number][] }) =>
        emit(
          `line ${a.points.map((p) => pair(p[0], p[1], "line")).join(" ")}${a.offAxis ? " off-axis" : ""}`
        ),
      part: (a: {
        at?: [number, number] | string;
        fill?: boolean;
        flip?: boolean;
        name: string;
        size?: number;
        turn?: string;
      }) => {
        let at: string | undefined;
        if (Array.isArray(a.at)) {
          at = pair(a.at[0], a.at[1], "at");
        } else if (a.at !== undefined) {
          at = word(a.at, "at");
        }
        return emit(
          partLine({
            at,
            fill: a.fill,
            flip: a.flip,
            name: a.name,
            size: a.size,
            turn: a.turn,
          })
        );
      },
      rect: (a: { h: number; r?: number; w: number; x: number; y: number }) =>
        emit(
          `rect ${pair(a.x, a.y, "rect")} ${n(a.w, "w")}x${n(a.h, "h")}${a.r === undefined ? "" : ` r${n(a.r, "r")}`}`
        ),
    },
    icon: {
      finish: (value: string) => emit(`finish ${word(value, "finish")}`),
      keyline: (value: string) => emit(`keyline ${word(value, "keyline")}`),
      name: (slug: string) => emit(`icon ${word(slug, "icon")}`),
    },
    place: {
      /**
       * `count` copies of a part spaced evenly along a column. The host owns
       * the spacing; the model owns the count.
       */
      column: (a: {
        count: number;
        gap: number;
        cx: number;
        name: string;
        size?: number;
        turn?: string;
        y: number;
      }) =>
        Array.from({ length: a.count }, (_, i) =>
          emit(
            partLine({
              ...centred(parts, a.name, a.cx, a.y + i * a.gap, a.size),
              name: a.name,
              turn: a.turn,
            })
          )
        ),
      grid: (a: {
        cols: number;
        gapX: number;
        gapY: number;
        name: string;
        rows: number;
        size?: number;
        x: number;
        y: number;
      }) =>
        Array.from({ length: a.rows * a.cols }, (_, i) => {
          const col = i % a.cols;
          const row = Math.floor(i / a.cols);
          return emit(
            partLine({
              ...centred(
                parts,
                a.name,
                a.x + col * a.gapX,
                a.y + row * a.gapY,
                a.size
              ),
              name: a.name,
            })
          );
        }),
      /**
       * The four quarter positions with the turns that match them — the one
       * rotational symmetry the grammar can say, because `turn` names quarters
       * and nothing finer. A `count` of anything but four belongs in `ring`,
       * which places unrotated copies.
       */
      quarters: (a: {
        cx: number;
        cy: number;
        name: string;
        radius: number;
        size?: number;
      }) =>
        (["", "cw", "half", "ccw"] as const).map((turn, i) => {
          const angle = (i * Math.PI) / 2;
          return emit(
            partLine({
              ...centred(
                parts,
                a.name,
                a.cx + a.radius * Math.sin(angle),
                a.cy - a.radius * Math.cos(angle),
                a.size
              ),
              name: a.name,
              turn: turn === "" ? undefined : turn,
            })
          );
        }),
      /**
       * `count` copies evenly around a circle, unrotated. Orientation is not
       * offered because the grammar has only quarter turns: a ring of six
       * facing outward is not something the DSL can say, and a helper that
       * silently rounded to the nearest quarter would be drawing something the
       * model did not ask for.
       */
      ring: (a: {
        count: number;
        cx: number;
        cy: number;
        name: string;
        radius: number;
        size?: number;
        start?: number;
      }) =>
        Array.from({ length: a.count }, (_, i) => {
          const angle =
            ((a.start ?? 0) * Math.PI) / 180 + (i * 2 * Math.PI) / a.count;
          return emit(
            partLine({
              ...centred(
                parts,
                a.name,
                a.cx + a.radius * Math.sin(angle),
                a.cy - a.radius * Math.cos(angle),
                a.size
              ),
              name: a.name,
            })
          );
        }),
      row: (a: {
        count: number;
        cy: number;
        gap: number;
        name: string;
        size?: number;
        turn?: string;
        x: number;
      }) =>
        Array.from({ length: a.count }, (_, i) =>
          emit(
            partLine({
              ...centred(parts, a.name, a.x + i * a.gap, a.cy, a.size),
              name: a.name,
              turn: a.turn,
            })
          )
        ),
    },
  };

  try {
    const result = await runSandbox({
      hostFunctions: guarded(hostFunctions, (message) => errors.push(message)),
      limits: {
        maxBridgeRequests: MAX_BRIDGE_REQUESTS,
        timeoutMs: TIMEOUT_MS,
        ...options.limits,
      },
      source,
    });
    if (result.status === "interrupted") {
      // No host function here calls `interrupt`, so this is unreachable rather
      // than unhandled. Recorded as an error instead of ignored, because an
      // interrupted run has drawn only part of its program.
      errors.push("the program suspended on an interrupt and did not finish");
    }
  } catch (error) {
    errors.push((error as Error).message);
  }

  const program = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  const replayed = runDsl(program, parts, {
    cohorts: options.cohorts,
    spec,
  });
  errors.push(...replayed.errors);
  const doc = replayed.canvas.toJSON({
    icon: replayed.icon,
    keyline: replayed.keyline,
  });

  // The guarantee, asserted rather than asserted-in-prose: whatever the
  // JavaScript did, the `.icon` it produced replays to this exact document.
  // Anything the DSL cannot express fails here.
  if (lines.length > 0 && !completeProgram(doc, program, parts)) {
    errors.push(
      "the emitted program does not replay to the document it drew — " +
        "the JavaScript produced something the DSL cannot express"
    );
  }

  return {
    canvas: replayed.canvas,
    doc,
    errors,
    finish: replayed.finish,
    icon: replayed.icon,
    issues: lint(replayed.canvas, { keyline: replayed.keyline }),
    keyline: replayed.keyline,
    program,
    trace: lines.map((l) => l.split(/\s+/u)[0].toLowerCase()),
  };
};

/**
 * The drawing contract, as the model receives it.
 *
 * It is a system prompt rather than a staged `SKILL.md` because this arm has
 * no scratch directory to stage one into — the sandbox has no filesystem, and
 * that is the point. Two rules carry the weight: every call is awaited, and
 * there is nothing here that takes path data.
 */
export const PROGRAM_SKILL = [
  "You are Iconsmith's drawing harness. You write a JavaScript program that",
  "builds one icon by calling the host API below. You never write SVG, never",
  "write path data, and never compute a `d` string — there is no function here",
  "that would accept one.",
  "",
  "The program runs in a sandbox with no modules, no network and no clock.",
  "Top-level `await` and `return` are available.",
  "",
  "EVERY host call must be awaited. A call you do not await is detached and the",
  "run fails — ordering is the whole meaning of a program here.",
  "",
  "Declarations, in this order and before any geometry:",
  "  await icon.name(slug)                    e.g. 'compass'",
  "  await icon.keyline(k)                    circle | square | wide | tall",
  "  await icon.finish(f)                     outlined | filled",
  "",
  "Geometry on the 24x24 grid:",
  "  await draw.rect({ x, y, w, h, r })",
  "  await draw.circle({ cx, cy, r })",
  "  await draw.arc({ cx, cy, r, sweep, from, ccw })",
  "      sweep: quarter | half | three-quarter; from: top | right | bottom | left",
  "  await draw.diamond({ cx, cy, r })",
  "  await draw.line({ points: [[x, y], ...], offAxis })",
  "  await draw.dot({ cx, cy, role })         terminal | more | floating | node",
  "  await draw.hole({ shape, ... })          filled icons only; cuts the last solid",
  "  await draw.part({ name, at, size, fill, turn, flip })",
  "      `at` is [x, y] (top-left) or an anchor name; `turn` is cw | half | ccw",
  "  await draw.center() / draw.fit() / draw.cohort(name)",
  "",
  "Repetition, where the host computes the positions:",
  "  await place.ring({ name, count, cx, cy, radius, size, start })",
  "  await place.quarters({ name, cx, cy, radius, size })",
  "  await place.row({ name, count, x, cy, gap, size, turn })",
  "  await place.column({ name, count, cx, y, gap, size, turn })",
  "  await place.grid({ name, cols, rows, x, y, gapX, gapY, size })",
  "",
  "Checking your own work, at any point:",
  "  await check.lint()      { issues, errors } for what you have drawn so far",
  "  await check.describe()  what is on the canvas",
  "  await check.parts()     the vocabulary you may place",
  "  await check.program()   the .icon program your calls have written",
  "",
  "Turns are named quarters. There is no way to rotate by an arbitrary angle,",
  "because every node stays on the grid. Use the loop for repetition and the",
  "primitives for placement; the host quantises everything you pass it.",
  "",
  "Return only the JavaScript program. No prose, no Markdown fence.",
].join("\n");

export interface ProgramAskRequest {
  abortSignal?: AbortSignal;
  prompt: string;
  system: string;
}

/** The model call, injectable for the same reason `Spawn` is: a second code
 *  path that behaved differently from the real one would not be a test. */
export type ProgramAsk = (request: ProgramAskRequest) => Promise<{
  cost?: ApiCost;
  finishReason?: string;
  text: string;
}>;

export interface ProgramOptions {
  apiKey?: string;
  ask?: ProgramAsk;
  /** Measured extents per family, so a `cohort` op has a table to align
   *  against — the same value `iconsmith lint --cohorts` builds, and the same
   *  field `HarnessOptions` carries for the same reason. */
  cohorts?: Cohort[];
  limits?: RunLimits;
  model?: LanguageModel;
}

const defaultAsk =
  (options: ProgramOptions): ProgramAsk =>
  async ({ abortSignal, prompt, system }) => {
    abortSignal?.throwIfAborted();
    const costTracker = gatewayCostTracker(options.apiKey);
    const model = options.model ?? DEFAULT_MODEL;
    const result = await generateText({
      abortSignal,
      messages: [{ content: prompt, role: "user" }],
      model: resolveModel(model, options.apiKey),
      system,
    });
    costTracker.record(result.providerMetadata);
    return {
      cost: await costTracker.measure({
        model: typeof model === "string" ? model : model.modelId,
        operation: "program-arm",
        usage: tokenUsageOf(result.totalUsage),
      }),
      finishReason: result.finishReason,
      text: result.text,
    };
  };

/** Strip a Markdown fence the instructions asked for and the model wrote
 *  anyway. Anything else is returned as-is and fails in the sandbox, where the
 *  error names a line of what the model actually sent. */
const sourceFrom = (text: string): string => {
  const fenced =
    /```(?:javascript|js|ts|typescript)?\n(?<body>[\s\S]*?)```/u.exec(text);
  return (fenced?.groups?.body ?? text).trim();
};

/** The vocabulary, names and measurements only — never path data, for the same
 *  reason the harness arm's `parts.json` carries none. */
const vocabularyFor = (parts: readonly Part[]): string =>
  parts.length === 0
    ? "No parts vocabulary is available; draw with the primitives."
    : parts
        .filter((p) => p.name)
        .map((p) => `- ${p.name} (${p.w}x${p.h})`)
        .join("\n");

/**
 * The `program` arm: a model writing a builder program rather than a `.icon`
 * file.
 *
 * The experiment it exists to run is against the `agent` arm — same model,
 * same concept, a loop instead of an unrolled list — so it deliberately keeps
 * everything else the same, including emitting a `.icon` as its artefact.
 */
export const programArm =
  (options: ProgramOptions = {}): GenerateLike =>
  async (concept, generateOptions = {}) => {
    const ask = options.ask ?? defaultAsk(options);
    const { finish = "outlined", spec } = generateOptions;
    const parts = generateOptions.parts ?? [];
    const brief = [
      `Draw an icon for: ${concept.name}`,
      ...(concept.category ? [`Category: ${concept.category}`] : []),
      "",
      `Finish: ${finish}`,
      "",
      "Addressable parts (names and measurements only; no path data):",
      vocabularyFor(parts),
    ].join("\n");

    const response = await ask({
      abortSignal: generateOptions.abortSignal,
      prompt: brief,
      system: PROGRAM_SKILL,
    });

    const drawn = await runProgram(sourceFrom(response.text), [...parts], {
      cohorts: options.cohorts,
      limits: options.limits,
      spec,
    });

    const issues: Issue[] = [
      ...drawn.errors.map((message): Issue => ({
        message,
        rule: "dsl",
        severity: "error",
      })),
      ...drawn.issues,
    ];

    return {
      apiCosts: response.cost ? [response.cost] : undefined,
      brief,
      clean: !issues.some((issue) => issue.severity === "error"),
      doc: drawn.doc,
      issues,
      program: drawn.program,
      steps: 1,
      svg: drawn.canvas.toSVG(),
      text: response.text,
      trace: drawn.trace,
    };
  };

/**
 * Two products, not two seeds of one pipeline.
 *
 * A concept the set already draws has an **answer key**. That is reconstruction:
 * compile house subpaths onto vocabulary parts. Cosine against the real icon
 * is comparable to the numbers everything else in this repo is calibrated to:
 * 0.482 floor, 0.737 two-professional-sets baseline, 0.740 measured treatment.
 * Compile with parts may score ≥0.95; that is the compiler working. A leak is
 * ≥0.95 *and* zero `part` ops *and a model wrote the program*. Host marks are
 * a third product: `ROUTES.mark` writes them; 0 parts is not a leak. Do not
 * spawn an agent to rediscover a file.
 *
 * A concept the set does **not** draw has no key, and that is the actual
 * product claim — reach. The first sample is a stack of the set's own
 * `ellipse-flat` rim — a cylinder, not a retitled `server`. It is judged by
 * the structural panel and by lint, and a cosine is never quoted for it,
 * because there is nothing to be cosine *to*. Reporting one would mean
 * scoring it against whichever icon happened to be nearest, which measures
 * the store rather than the drawing.
 *
 * Remaining slots, when DEMO_N>1, are SELECT islands (`slug`, `tagged`,
 * `exact`, `contrast`, `empty`) through an external agent — competing searches,
 * not five seeds of one. Independent N from one shortlist estimates luck on
 * that hill. Selection is `pick()`: structural panel, then lint errors, then
 * part ops, then cosine — never the model's own opinion of its work.
 *
 * The alias table reaches the agent arm through `harnessArm`, which writes the
 * vocabulary into the scratch directory and names it in the brief. An earlier
 * version appended a `searchParts` shortlist to the brief instead; it told the
 * agent about parts it had no file to place from, and every sample ran to the
 * 10-minute kill. The vocabulary file is the fix and the shortlist is
 * redundant beside it — the agent searches the same names for itself.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { loadAliases } from "../src/corpus/aliases.js";
import {
  FILLED_VARIANT,
  HOUSE_VARIANT,
  parseIconSvg,
} from "../src/corpus/load.js";
import { inspect, measureIcon } from "../src/eval/blindspot.js";
import { extractParts } from "../src/parts/extract.js";
import { nameParts } from "../src/parts/vocabulary.js";
import { STACK_PART, hub, stack } from "../src/pipeline/analog.js";
import { audit, gatewayAsk, persistLook, shot } from "../src/pipeline/audit.js";
import type { AuditAsk, AuditResult } from "../src/pipeline/audit.js";
import { gatewayToken } from "../src/pipeline/gateway.js";
import { HarnessError, harnessArm } from "../src/pipeline/harness.js";
import type { HarnessOptions, Spawn } from "../src/pipeline/harness.js";
import { MARK_TWINS, stagesHouse } from "../src/pipeline/kind.js";
import { markArm } from "../src/pipeline/mark.js";
import type { MarkName } from "../src/pipeline/marks.js";
import { pick } from "../src/pipeline/pick.js";
import type { Concept } from "../src/pipeline/prompt.js";
import { compileArm } from "../src/pipeline/reconstruct.js";
import { searchParts } from "../src/pipeline/search.js";
import { hintDiversity, islands } from "../src/pipeline/select.js";
import type { SelectKind } from "../src/pipeline/select.js";
import { run as runDsl } from "../src/tools/dsl.js";
import { lint } from "../src/tools/lint.js";
import { cosine, inkVector } from "../src/tools/render.js";
import type { Finish, Part } from "../src/types.js";

const VARIANT_DIR = path.join("corpus", HOUSE_VARIANT);
const OUT = path.join(".staging", "demo");
const N = Number(process.env.DEMO_N ?? 1);
const SHORTLIST = 16;

/** Ten net-new marks, each drawn outlined and filled. Exact slugs are
 *  absent, so cosine on the sample stays null. House twins come from
 *  `MARK_TWINS` — same-construction and same-concept stage a sibling;
 *  house-motif and none do not. */
export interface DemoSpec {
  concept: Concept;
  key: string | null;
  make?: "hub" | "stack";
  mark?: MarkName;
}

const CONCEPTS: DemoSpec[] = [
  {
    concept: { category: "Actions", name: "plus", tags: ["add", "create"] },
    key: null,
    mark: "plus",
  },
  {
    concept: {
      category: "Actions",
      name: "minus",
      tags: ["remove", "subtract"],
    },
    key: null,
    mark: "minus",
  },
  {
    concept: { category: "Actions", name: "equal", tags: ["equals", "math"] },
    key: null,
    mark: "equal",
  },
  {
    concept: {
      category: "Actions",
      name: "hamburger-menu",
      tags: ["menu", "nav", "list"],
    },
    key: null,
    mark: "hamburger-menu",
  },
  {
    concept: {
      category: "Actions",
      name: "more-vertical",
      tags: ["kebab", "overflow", "more"],
    },
    key: null,
    mark: "more-vertical",
  },
  {
    concept: {
      category: "Actions",
      name: "view-grid",
      tags: ["grid", "apps", "tiles"],
    },
    key: null,
    mark: "view-grid",
  },
  {
    concept: {
      category: "Devices",
      name: "battery",
      tags: ["power", "charge"],
    },
    key: null,
    mark: "battery",
  },
  {
    concept: {
      category: "Actions",
      name: "ban",
      tags: ["block", "prohibited", "no"],
    },
    key: null,
    mark: "ban",
  },
  {
    concept: {
      category: "Development",
      name: "timeline",
      tags: ["history", "events", "steps"],
    },
    key: null,
    mark: "timeline",
  },
  {
    concept: { category: "Actions", name: "flag", tags: ["marker", "report"] },
    key: null,
    mark: "flag",
  },
];

const FINISHES: Finish[] = ["outlined", "filled"];

/**
 * What the alias-widened search reaches for this concept.
 *
 * Recorded, not sent. The agent gets the whole vocabulary and searches it
 * itself; this is the measurement of whether `corpus/aliases.ts` puts anything
 * new within reach of *this* concept, which is the number Phase 1 is a bet on.
 */
const reachOf = (
  concept: Concept,
  parts: Part[],
  aliases: ReadonlyMap<string, readonly string[]>
): { withAliases: number; withoutAliases: number } => {
  const query = `${concept.name} ${concept.tags?.join(" ") ?? ""}`;
  return {
    withAliases: searchParts(parts, query, SHORTLIST, aliases).length,
    withoutAliases: searchParts(parts, query, SHORTLIST).length,
  };
};

interface Sample {
  clean: boolean;
  cosine: number | null;
  errors: number;
  n: number;
  /** `part` ops the program ran that resolved to a real shape. The column
   *  PLAN.md asks for: it turns "reach" from an idea into a count. */
  partsFound: number;
  policy: SelectKind | "analog" | "compile" | "mark";
  /** Structural checks this drawing failed. Fewer is better, and this is the
   *  first key, because cosine cannot see any of them. */
  structural: string[];
  svg: string;
  /** Host look, when the demo ran with an `ask`. */
  audit?: AuditResult;
  /** Nearest house twin, scored in the matching finish. Not `cosine`: these
   *  marks are unkeyed and must not quote an answer-key score. */
  house?: { cosine: number; slug: string };
}

/** A lost sample still occupies a card so the thinking can be opened. Empty
 *  on purpose: ranking must not treat this as a drawing that scored zero. */
const EMPTY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"></svg>\n';

const STAGE_SUFFIXES = [
  ".brief.md",
  ".log.jsonl",
  ".icon",
  ".preview.png",
  ".audit.json",
] as const;

const writeIf = (file: string, body: string | null | undefined): void => {
  if (body === null || body === undefined || body === "") {
    return;
  }
  writeFileSync(file, body.endsWith("\n") ? body : `${body}\n`);
};

/** Brief, thinking, program — the stages the viewer opens. Written beside the
 *  SVG so they survive the scratch directory being deleted. */
const persistStages = (
  dir: string,
  stem: string,
  stages: { brief?: string; log?: string; program?: string | null }
): void => {
  writeIf(path.join(dir, `${stem}.brief.md`), stages.brief);
  writeIf(path.join(dir, `${stem}.log.jsonl`), stages.log);
  writeIf(path.join(dir, `${stem}.icon`), stages.program);
};

const copyStages = (dir: string, fromStem: string, toStem: string): void => {
  for (const suffix of [...STAGE_SUFFIXES, ".json"]) {
    const from = path.join(dir, `${fromStem}${suffix}`);
    if (existsSync(from)) {
      copyFileSync(from, path.join(dir, `${toStem}${suffix}`));
    }
  }
};

const stagesOf = (
  error: unknown
): { brief: string; log: string; program: string | null } => {
  if (error instanceof HarnessError) {
    return {
      brief: error.brief,
      log: error.log || error.message,
      program: error.program,
    };
  }
  return { brief: "", log: (error as Error).message, program: null };
};

const houseSvg = async (
  slug: string,
  finish: Finish = "outlined"
): Promise<string | null> => {
  const { readFile } = await import("node:fs/promises");
  const variant = finish === "filled" ? FILLED_VARIANT : HOUSE_VARIANT;
  try {
    return await readFile(path.join("corpus", variant, `${slug}.svg`), "utf-8");
  } catch {
    return null;
  }
};

const scoreProgram = async (
  source: string,
  parts: readonly Part[],
  name: string,
  n: number,
  policy: Sample["policy"],
  targetInk: number[] | null
): Promise<Sample> => {
  const drawn = runDsl(source, [...parts]);
  const svg = drawn.canvas.toSVG();
  const measurement = await measureIcon(svg);
  const ink = targetInk ? await inkVector(svg) : null;
  const verdict = inspect(name, measurement);
  const lintErrors = lint(drawn.canvas, { keyline: drawn.keyline }).filter(
    (issue) => issue.severity === "error"
  ).length;
  return {
    clean:
      drawn.errors.length === 0 &&
      lintErrors === 0 &&
      verdict.failed.length === 0,
    cosine: ink && targetInk ? cosine(ink, targetInk) : null,
    errors: drawn.errors.length + lintErrors,
    n,
    partsFound: source.split("\n").filter((l) => l.startsWith("part ")).length,
    policy,
    structural: verdict.failed,
    svg,
  };
};

const writeSample = (
  dir: string,
  stem: string,
  sample: Sample,
  stages: { brief: string; log: string; program: string | null }
): void => {
  persistStages(dir, stem, stages);
  writeFileSync(path.join(dir, `${stem}.svg`), sample.svg);
  const { svg: _svg, ...recorded } = sample;
  writeFileSync(
    path.join(dir, `${stem}.json`),
    `${JSON.stringify(recorded, null, 2)}\n`
  );
};

const noteAudit = (reviewed: AuditResult): void => {
  if (reviewed.ok) {
    return;
  }
  const detail =
    reviewed.reason ?? reviewed.findings.map((f) => f.message).join("; ");
  process.stderr.write(`  audit: ${detail}\n`);
};

/** Screenshot always; vision only when the caller passed an ask. */
const stageLook = async (
  dir: string,
  stem: string,
  sample: Sample,
  stages: { brief: string; log: string; program: string | null },
  ask: AuditAsk | undefined,
  concept: Concept,
  finish: Finish,
  references: readonly Buffer[] = [],
  kind?: "analog" | "compile" | "mark"
): Promise<Sample> => {
  const reviewed =
    sample.audit ??
    (ask
      ? await audit({
          ask,
          concept,
          finish,
          kind,
          references,
          svg: sample.svg,
        })
      : undefined);
  if (reviewed) {
    noteAudit(reviewed);
  }
  const next = { ...sample, audit: reviewed };
  writeSample(dir, stem, next, stages);
  await persistLook(dir, stem, next.svg, reviewed);
  return next;
};

const MARK_SELECTED_BY =
  "finish-aware mark: outlined uses line, filled uses a 2-wide rect or a hole";

/** Both finishes of one mark, in parallel: neither draw needs the other. */
const drawMarks = (
  dir: string,
  spec: DemoSpec,
  ask?: AuditAsk
): Promise<Sample[]> => {
  const { concept, mark } = spec;
  const { name } = concept;
  if (mark === undefined) {
    throw new Error(`drawMarks needs a mark for ${name}`);
  }
  const twin = MARK_TWINS[mark];
  const draw = markArm();
  return Promise.all(
    FINISHES.map(async (finish, i) => {
      const slug = finish === "filled" ? `${name}-filled` : name;
      const house = stagesHouse(twin)
        ? await houseSvg(twin.slug, finish)
        : null;
      if (house) {
        writeFileSync(path.join(dir, `${slug}.house.svg`), house);
      }
      const references = house ? [await shot(house)] : [];
      const drawn = await draw(
        { name: slug },
        {
          ask,
          lookKind: "mark",
          lookReferences: references,
          lookTwin: twin,
        }
      );
      const { brief, program: source } = drawn;
      if (source === undefined || brief === undefined) {
        throw new Error(`markArm produced no program for ${slug}`);
      }
      process.stderr.write(`${slug}: ${brief}…\n`);
      const sample = await scoreProgram(source, [], slug, i + 1, "mark", null);
      let scored: Sample = { ...sample, audit: drawn.audit };
      if (house && twin.slug !== null) {
        const [ours, theirs] = await Promise.all([
          inkVector(sample.svg),
          inkVector(house),
        ]);
        scored = {
          ...scored,
          house: { cosine: cosine(ours, theirs), slug: twin.slug },
        };
      }
      return stageLook(
        dir,
        slug,
        scored,
        { brief, log: "", program: source },
        ask,
        { name },
        finish,
        references,
        "mark"
      );
    })
  );
};

const markReport = (
  name: string,
  mark: MarkName,
  samples: Sample[]
): Record<string, unknown> => ({
  concept: name,
  drawn: samples.length,
  hasAnswerKey: false,
  lost: 0,
  requested: 2,
  samples: samples.map(({ svg: _svg, ...recorded }) => recorded),
  selectedBy: MARK_SELECTED_BY,
  twin: MARK_TWINS[mark],
  winner: "mark",
});

interface Vocab {
  aliases: Awaited<ReturnType<typeof loadAliases>>["aliases"];
  parts: Part[];
}

const analogWhy = (make: "hub" | "stack"): string =>
  make === "hub" ? "hub of circle nodes" : `stack of ${STACK_PART}`;

const pickWhy = (policy: Sample["policy"], make: "hub" | "stack"): string => {
  if (policy === "analog") {
    return analogWhy(make);
  }
  return "structural panel, then lint errors, then part ops, then cosine; remaining samples are SELECT islands, not seeds";
};

const flushReport = (out: string, report: Record<string, unknown>[]): void => {
  writeFileSync(
    path.join(out, "demo.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
};

/** Codex argv the demo and the e2e share. The full brief is BRIEF.md. */
export const demoArgs = (_brief: string): string[] => [
  "exec",
  "--skip-git-repo-check",
  // Implies workspace-write and cannot be combined with `--sandbox`.
  "--approve-for-me",
  "--json",
  "--color",
  "never",
  // Passing the brief as argv *and* leaving stdin attached made Codex wait
  // for "additional input".
  "Read BRIEF.md and follow it.",
];

/** The demo's harness: Codex, gateway vision, one repair. Tests override
 *  `ask` and `spawn` so the path is the same without a network. */
export const codexArm = (over: HarnessOptions = {}) =>
  harnessArm({
    args: demoArgs,
    ask: gatewayAsk,
    command: "codex",
    keep: process.env.DEMO_KEEP === "1",
    ...over,
  });

const loadVocab = async (): Promise<Vocab> => {
  process.stderr.write(`extracting parts from ${VARIANT_DIR}…\n`);
  const parts = nameParts(extractParts(VARIANT_DIR, {}).parts);
  const { aliases, from } = await loadAliases();
  process.stderr.write(
    `${parts.length} parts; alias tables: ${from.join(", ") || "none"}\n`
  );
  return { aliases, parts };
};

interface DemoCtx {
  ask?: AuditAsk | undefined;
  keep?: boolean;
  n: number;
  spawn?: Spawn;
}

const defaultAsk = (
  over: AuditAsk | null | undefined
): AuditAsk | undefined => {
  if (over !== undefined) {
    return over ?? undefined;
  }
  return gatewayToken() ? gatewayAsk : undefined;
};

const runKeyed = async (
  dir: string,
  concept: Concept,
  target: string,
  targetInk: number[],
  parts: Part[],
  ask: AuditAsk | undefined,
  reach: { withAliases: number; withoutAliases: number }
): Promise<Record<string, unknown>> => {
  // Keyed is reconstruction. Asking Codex to rediscover the house icon is
  // the architecture that scored 0.58–0.79; compiling the house subpaths
  // onto vocabulary parts scored 0.999. Do not spend N agent draws on it.
  process.stderr.write(`${concept.name}: compiling from house…\n`);
  const drawn = await compileArm()(concept, {
    parts,
    targetPaths: parseIconSvg(target).map((s) => s.d),
  });
  const source = drawn.program ?? "";
  const brief = drawn.brief ?? `compile ${concept.name}`;
  persistStages(dir, concept.name, {
    brief,
    log: drawn.log ?? "",
    program: source,
  });
  const measurement = await measureIcon(drawn.svg);
  const ink = await inkVector(drawn.svg);
  const verdict = inspect(concept.name, measurement);
  const sample: Sample = {
    audit: drawn.audit,
    clean: drawn.clean && verdict.failed.length === 0,
    cosine: cosine(ink, targetInk),
    errors: drawn.issues.filter((i) => i.severity === "error").length,
    n: 1,
    partsFound: drawn.trace.filter((op) => op === "part").length,
    policy: "compile",
    structural: verdict.failed,
    svg: drawn.svg,
  };
  await stageLook(
    dir,
    `${concept.name}-1`,
    sample,
    {
      brief,
      log: drawn.log ?? "",
      program: source,
    },
    ask,
    concept,
    "outlined"
  );
  copyStages(dir, `${concept.name}-1`, concept.name);
  writeFileSync(path.join(dir, `${concept.name}.svg`), sample.svg);
  writeFileSync(path.join(dir, `${concept.name}.house.svg`), target);
  const { svg: _svg, ...recorded } = sample;
  return {
    concept: concept.name,
    drawn: 1,
    hasAnswerKey: true,
    lost: 0,
    reach,
    requested: 1,
    samples: [recorded],
    selectedBy: "compile house subpaths onto vocabulary parts",
    winner: "compile",
  };
};

const runLegacyConcept = async (
  dir: string,
  concept: Concept,
  key: string | null,
  make: "hub" | "stack" | undefined,
  vocab: Vocab,
  ctx: DemoCtx
): Promise<Record<string, unknown>> => {
  const { aliases, parts } = vocab;
  const { ask, n: sampleN, spawn } = ctx;
  // Two products, run one after the other. Keyed compiles; unkeyed analogs
  // first. Codex only runs for remaining SELECT islands when DEMO_N>1.
  const target = key ? await houseSvg(key) : null;
  const targetInk = target ? await inkVector(target) : null;
  const reach = reachOf(concept, parts, aliases);

  if (target && targetInk) {
    return runKeyed(dir, concept, target, targetInk, parts, ask, reach);
  }

  const analogMake = make ?? "stack";
  const analogSource =
    analogMake === "hub" ? hub(concept.name) : stack(concept.name, parts);
  const analogBrief =
    analogMake === "hub"
      ? `hub of circle nodes as ${concept.name}`
      : `stack of ${STACK_PART} as ${concept.name}`;
  process.stderr.write(`${concept.name}: ${analogBrief}…\n`);
  // oxlint-disable-next-line no-await-in-loop
  const analogSample = await scoreProgram(
    analogSource,
    parts,
    concept.name,
    1,
    "analog",
    null
  );
  const analogLooked = await stageLook(
    dir,
    `${concept.name}-1`,
    analogSample,
    {
      brief: analogBrief,
      log: "",
      program: analogSource,
    },
    ask,
    concept,
    "outlined"
  );
  const samples: Sample[] = [analogLooked];
  let lost = 0;
  const remaining = sampleN - 1;
  const plans =
    remaining > 0 ? islands(concept, parts, aliases, remaining) : [];
  if (plans.length > 0) {
    process.stderr.write(
      `${concept.name} islands: ${plans.map((p) => `${p.kind}(${p.hints.length})`).join(", ")} diversity ${hintDiversity(plans).toFixed(2)}\n`
    );
  }

  if (remaining > 0) {
    const arm = codexArm({
      ask,
      keep: ctx.keep,
      spawn,
    });

    for (let i = 0; i < remaining; i += 1) {
      const n = i + 2;
      const stem = `${concept.name}-${n}`;
      const plan = plans[i];
      if (!plan) {
        throw new Error(`island ${n} missing`);
      }
      process.stderr.write(
        `${concept.name} sample ${n}/${sampleN} [${plan.kind}]…\n`
      );
      let result: Awaited<ReturnType<typeof arm>>;
      try {
        // oxlint-disable-next-line no-await-in-loop
        result = await arm(concept, {
          aliases,
          hints: plan.hints,
          parts,
          select: plan.kind,
        });
      } catch (error) {
        // A crashed sample is a lost sample, not a zero. A zero would enter the
        // median as though the agent had drawn something bad. The stages still
        // land on disk so the viewer can open the thinking.
        lost += 1;
        process.stderr.write(`  lost: ${(error as Error).message}\n`);
        persistStages(dir, stem, stagesOf(error));
        writeFileSync(path.join(dir, `${stem}.svg`), EMPTY_SVG);
        writeFileSync(
          path.join(dir, `${stem}.json`),
          `${JSON.stringify({ lost: true, n, policy: plan.kind }, null, 2)}\n`
        );
        continue;
      }
      persistStages(dir, stem, {
        brief: result.brief,
        log: result.log,
        program: result.program,
      });
      // Sequential on purpose: these are N−1 runs of an external agent against
      // one machine, and `Promise.all` over them would measure contention
      // rather than the drawings.
      // oxlint-disable-next-line no-await-in-loop
      const measurement = await measureIcon(result.svg);
      const verdict = inspect(concept.name, measurement);
      const sample: Sample = {
        audit: result.audit,
        clean: result.clean,
        cosine: null,
        errors: result.issues.filter((x) => x.severity === "error").length,
        n,
        partsFound: result.trace.filter((op) => op === "part").length,
        policy: plan.kind,
        structural: verdict.failed,
        svg: result.svg,
      };
      // oxlint-disable-next-line no-await-in-loop
      const looked = await stageLook(
        dir,
        stem,
        sample,
        {
          brief: result.brief ?? "",
          log: result.log ?? "",
          program: result.program ?? null,
        },
        ask,
        concept,
        "outlined"
      );
      samples.push(looked);
    }
  }

  const best = pick(samples);
  writeFileSync(path.join(dir, `${concept.name}.svg`), best.svg);
  copyStages(dir, `${concept.name}-${best.n}`, concept.name);
  return {
    concept: concept.name,
    drawn: samples.length,
    hasAnswerKey: false,
    lost,
    reach,
    requested: sampleN,
    samples: samples.map(({ svg: _svg, ...recorded }) => recorded),
    select:
      plans.length > 0
        ? {
            diversity: hintDiversity(plans),
            islands: plans.map((p) => ({
              hints: p.hints.map((h) => h.name ?? h.id),
              kind: p.kind,
            })),
          }
        : undefined,
    selectedBy: pickWhy(best.policy, analogMake),
    winner: best.policy,
  };
};

export interface DemoRunOptions {
  /** Injected look. `undefined` uses the live gateway when a token is
   *  present; `null` is preview-only, even on a machine that has a key. */
  ask?: AuditAsk | null;
  concepts?: readonly DemoSpec[];
  keep?: boolean;
  n?: number;
  out?: string;
  spawn?: Spawn;
  vocab?: Vocab;
}

export const runDemo = async (
  options: DemoRunOptions = {}
): Promise<Record<string, unknown>[]> => {
  const out = options.out ?? OUT;
  const specs = options.concepts ?? CONCEPTS;
  const ask = defaultAsk(options.ask);
  const ctx: DemoCtx = {
    ask,
    keep: options.keep ?? process.env.DEMO_KEEP === "1",
    n: options.n ?? N,
    spawn: options.spawn,
  };
  rmSync(out, { force: true, recursive: true });
  mkdirSync(out, { recursive: true });
  const vocab =
    options.vocab ??
    (specs.some((c) => c.mark === undefined)
      ? await loadVocab()
      : { aliases: new Map(), parts: [] });
  if (vocab.parts.length === 0) {
    process.stderr.write("marks only — skipping vocabulary extract\n");
  }
  const report = await Promise.all(
    specs.map(async (spec) => {
      const { concept, key, make, mark } = spec;
      const dir = path.join(out, concept.name);
      mkdirSync(dir, { recursive: true });
      if (mark) {
        return markReport(concept.name, mark, await drawMarks(dir, spec, ask));
      }
      return runLegacyConcept(dir, concept, key, make, vocab, ctx);
    })
  );
  flushReport(out, report);
  return report;
};

if (process.argv[1]?.endsWith("demo.ts")) {
  const report = await runDemo();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

/**
 * The harness campaign's judge.
 *
 * `scripts/loop.ts` is the policy loop: Wilcoxon, a noise floor, 190 icons,
 * one file it may write. This is the loop for what you look at in
 * `iconsmith view` — two concepts, best-of-N through an external agent.
 *
 * It refuses to call N=1 a finding. That is the same two-stage rule as
 * `program.md`: the screen is "not obviously broken"; the decision is N≥5
 * against gates cosine cannot game. Cosine ≥ 0.95 with no `part` ops is a leak
 * (silhouette copy, when a model wrote the program). The same cosine *with*
 * parts is reconstruction. A host mark matching the same construction at
 * ≥0.95 is also reconstruction — `twin.ts` wrote it; 0 `part` ops is not a
 * leak. Cosine on an unkeyed concept is a scoring bug, not reach.
 *
 *   npx tsx scripts/research.ts
 *   npx tsx scripts/research.ts --demo .staging/demo/demo.json
 *
 * Exit 0 when the decision set has arrived, 1 when it has not, 2 when the
 * file is missing or malformed. Appends one JSONL row under
 * `.staging/research/lab.jsonl`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { BASELINE } from "../src/pipeline/eval.js";
import { pick } from "../src/pipeline/pick.js";
import type { RankedSample } from "../src/pipeline/pick.js";

/** Same band `view.ts` uses: a single pair is not decidable to three places. */
export const AT_BASELINE = 0.02;
/** Above this, disbelieve the drawing before believing the pipeline. */
export const SUSPICIOUS = 0.95;

export interface DemoSample extends RankedSample {
  clean: boolean;
  /** `compile` is keyed reconstruction; `analog` is unkeyed replay of a
   *  neighbor; `mark` is a host twin. All three are deterministic, so N=1
   *  is a decision — gates still apply. A leak is high cosine with no `part`
   *  ops *and a model wrote the program*, not a compiled or host near-copy. */
  policy?: string;
}

export interface DemoConcept {
  concept: string;
  hasAnswerKey: boolean;
  requested: number;
  samples: DemoSample[];
}

export type Stage = "screen" | "decide";

export interface ConceptVerdict {
  arrived: boolean;
  concept: string;
  reasons: string[];
  stage: Stage;
}

export interface LabVerdict {
  arrived: boolean;
  concepts: ConceptVerdict[];
  stage: Stage;
}

const keyedGates = (chosen: DemoSample): string[] => {
  const reasons: string[] = [];
  if (chosen.structural.length > 0) {
    reasons.push(`panel ${chosen.structural.join(",")}`);
  }
  if (chosen.partsFound < 1) {
    reasons.push("no part ops");
  }
  if (chosen.cosine === null) {
    reasons.push("keyed concept has no cosine");
  } else if (chosen.cosine >= SUSPICIOUS && chosen.partsFound < 1) {
    reasons.push(`leak ${chosen.cosine.toFixed(3)}`);
  } else if (chosen.cosine < BASELINE - AT_BASELINE) {
    reasons.push(`cosine ${chosen.cosine.toFixed(3)} below baseline`);
  }
  return reasons;
};

const unkeyedGates = (picked: DemoSample): string[] => {
  const reasons: string[] = [];
  if (picked.structural.length > 0) {
    reasons.push(`panel ${picked.structural.join(",")}`);
  }
  if (picked.partsFound < 1) {
    reasons.push("no part ops");
  }
  if (picked.cosine !== null) {
    reasons.push("unkeyed concept must not quote a cosine");
  }
  return reasons;
};

const markGates = (chosen: DemoSample): string[] => {
  const reasons: string[] = [];
  if (chosen.structural.length > 0) {
    reasons.push(`panel ${chosen.structural.join(",")}`);
  }
  if (chosen.cosine !== null) {
    reasons.push("mark must not quote an answer-key cosine");
  }
  return reasons;
};

const gatesOf = (chosen: DemoSample, hasAnswerKey: boolean): string[] => {
  if (chosen.policy === "mark") {
    return markGates(chosen);
  }
  if (chosen.policy === "compile" || hasAnswerKey) {
    return keyedGates(chosen);
  }
  return unkeyedGates(chosen);
};

export const judgeConcept = (row: DemoConcept): ConceptVerdict => {
  const compiled = row.samples.some((s) => s.policy === "compile");
  const analog =
    !row.hasAnswerKey && row.samples.some((s) => s.policy === "analog");
  const marked = row.samples.some((s) => s.policy === "mark");
  const stage: Stage =
    row.requested >= 5 || compiled || analog || marked ? "decide" : "screen";
  if (row.samples.length === 0) {
    return {
      arrived: false,
      concept: row.concept,
      reasons: ["no samples"],
      stage,
    };
  }
  const chosen = pick(row.samples);
  const reasons = gatesOf(chosen, row.hasAnswerKey);
  const gatesHold = reasons.length === 0;
  let note = reasons;
  if (gatesHold) {
    note =
      stage === "decide"
        ? ["arrived"]
        : ["screen pass — not a finding until N≥5"];
  }
  return {
    arrived: stage === "decide" && gatesHold,
    concept: row.concept,
    reasons: note,
    stage,
  };
};

export const judgeLab = (rows: readonly DemoConcept[]): LabVerdict => {
  const concepts = rows.map(judgeConcept);
  const stage: Stage = concepts.every((c) => c.stage === "decide")
    ? "decide"
    : "screen";
  return {
    arrived: stage === "decide" && concepts.every((c) => c.arrived),
    concepts,
    stage,
  };
};

const asSample = (raw: unknown): DemoSample => {
  const s = raw as DemoSample;
  if (
    typeof s.clean !== "boolean" ||
    typeof s.errors !== "number" ||
    typeof s.partsFound !== "number" ||
    !Array.isArray(s.structural)
  ) {
    throw new TypeError("sample is missing clean/errors/partsFound/structural");
  }
  if (s.cosine !== null && typeof s.cosine !== "number") {
    throw new TypeError("sample cosine must be a number or null");
  }
  return s;
};

export const parseDemo = (text: string): DemoConcept[] => {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new TypeError("demo.json must be an array of concepts");
  }
  return parsed.map((row) => {
    const r = row as DemoConcept;
    if (typeof r.concept !== "string" || typeof r.hasAnswerKey !== "boolean") {
      throw new TypeError("concept row is missing concept/hasAnswerKey");
    }
    return {
      concept: r.concept,
      hasAnswerKey: r.hasAnswerKey,
      requested: Number(r.requested),
      samples: (r.samples ?? []).map(asSample),
    };
  });
};

const format = (verdict: LabVerdict): string => {
  const lines = [
    `stage ${verdict.stage}  ${verdict.arrived ? "ARRIVED" : "not yet"}`,
    `baseline ${BASELINE}  leak ≥ ${SUSPICIOUS}  band ±${AT_BASELINE}`,
    "",
  ];
  for (const c of verdict.concepts) {
    lines.push(
      `${c.concept}  ${c.stage}  ${c.arrived ? "arrived" : "short"}  ${c.reasons.join("; ")}`
    );
  }
  return `${lines.join("\n")}\n`;
};

const NOTEBOOK = path.join(".staging", "research", "lab.jsonl");

const main = (): void => {
  const { values } = parseArgs({
    options: { demo: { type: "string" } },
    strict: true,
  });
  const file = values.demo ?? path.join(".staging", "demo", "demo.json");
  if (!existsSync(file)) {
    process.stderr.write(
      `No demo at "${file}". Run DEMO_N=1 npx tsx scripts/demo.ts first.\n`
    );
    process.exit(2);
  }
  let rows: DemoConcept[];
  try {
    rows = parseDemo(readFileSync(file, "utf-8"));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(2);
  }
  const verdict = judgeLab(rows);
  mkdirSync(path.dirname(NOTEBOOK), { recursive: true });
  appendFileSync(
    NOTEBOOK,
    `${JSON.stringify({
      arrived: verdict.arrived,
      at: new Date().toISOString(),
      demo: file,
      hypothesis: process.env.LAB_HYPOTHESIS ?? null,
      stage: verdict.stage,
      verdict: verdict.concepts,
    })}\n`
  );
  process.stdout.write(format(verdict));
  process.exit(verdict.arrived ? 0 : 1);
};

if (process.argv[1]?.endsWith("research.ts")) {
  main();
}

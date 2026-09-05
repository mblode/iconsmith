/** One revision-selected exploration through the live engine and tournament.
 * This is not the sealed pilot and cannot qualify a style. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { generate } from "../src/pipeline/generate.js";
import type { StyleArtifact } from "../src/pipeline/style.js";
import {
  compileStyle,
  createStyleRevision,
  replayStyle,
  selectStyle,
} from "../src/pipeline/style.js";
import { runPairTournament } from "../src/pipeline/tournament.js";
import { png } from "../src/tools/render.js";

const { values } = parseArgs({
  options: {
    brief: { type: "string" },
    companion: { type: "boolean" },
    concept: { type: "string" },
    "dry-run": { type: "boolean" },
    effort: { type: "string" },
    master: { type: "string" },
    "max-output-tokens": { default: "4096", type: "string" },
    "max-usd": { type: "string" },
    model: { type: "string" },
    out: { type: "string" },
    revision: { type: "string" },
    steps: { default: "8", type: "string" },
  },
});
if (
  !values.concept ||
  !values.master ||
  !values.revision ||
  !values.out ||
  !values.model
) {
  throw new Error(
    "Required: --revision <json> --master <id> --concept <name> --model <id> --out <new-directory>; live runs also require --max-usd <ceiling>"
  );
}
const maxUsd = Number(values["max-usd"]);
const maxOutputTokens = Number(values["max-output-tokens"]);
if (
  !Number.isInteger(maxOutputTokens) ||
  maxOutputTokens < 1 ||
  maxOutputTokens > 16_384
) {
  throw new Error("--max-output-tokens must be an integer from 1 to 16384");
}
if (
  values.effort &&
  (!values.model.startsWith("anthropic/") ||
    !["low", "medium", "high"].includes(values.effort))
) {
  throw new Error(
    "--effort supports low, medium or high on an Anthropic model"
  );
}
const steps = Number(values.steps);
if (!values["dry-run"] && (!Number.isFinite(maxUsd) || maxUsd <= 0)) {
  throw new Error("A live run requires an explicit positive --max-usd ceiling");
}
if (!Number.isInteger(steps) || steps < 1 || steps > 32) {
  throw new Error("--steps must be an integer from 1 to 32");
}
const revision = createStyleRevision(
  JSON.parse(readFileSync(values.revision, "utf-8"))
);
const style = selectStyle(revision, values.master);
const concept = {
  name: values.concept,
  ...(values.brief ? { guidance: readFileSync(values.brief, "utf-8") } : {}),
};
const plan = {
  companion: values.companion === true,
  concept: values.concept,
  effort: values.effort ?? null,
  guidance: concept.guidance ?? null,
  master: style.master,
  maxCalls: steps * 2 + 3,
  maxOutputTokens,
  maxUsd: Number.isFinite(maxUsd) ? maxUsd : null,
  model: values.model,
  revision: revision.hash,
  steps,
};
if (values["dry-run"]) {
  process.stdout.write(
    `${JSON.stringify({ mode: "dry-run", paidCalls: 0, plan })}\n`
  );
} else {
  const out = path.resolve(values.out);
  mkdirSync(out, { recursive: false });
  writeFileSync(path.join(out, "plan.json"), JSON.stringify(plan, null, 2));
  writeFileSync(
    path.join(out, "revision.json"),
    JSON.stringify(revision.definition, null, 2)
  );
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  let companion: StyleArtifact | undefined;
  const tournament = await runPairTournament({
    abortSignal: controller.signal,
    budget: { maxCalls: plan.maxCalls, maxUsd },
    candidates: [
      {
        generate: async (finish) => {
          const generated = await generate(concept, {
            abortSignal: controller.signal,
            companion:
              values.companion && finish === "filled" ? companion : undefined,
            finish,
            maxOutputTokens,
            maxSteps: steps,
            // Leave half the pair reservation for independent reviews and rescue.
            maxUsd: maxUsd / 4,
            model: plan.model,
            providerOptions: values.effort
              ? { anthropic: { effort: values.effort } }
              : undefined,
            style,
          });
          writeFileSync(
            path.join(out, `${finish}.attempt.json`),
            JSON.stringify(generated, null, 2)
          );
          writeFileSync(path.join(out, `${finish}.attempt.svg`), generated.svg);
          if (values.companion && finish === "outlined") {
            const artifact = compileStyle(style, generated.program ?? "");
            if (replayStyle(style, artifact) !== generated.svg) {
              throw new Error("Companion program differs from generated SVG");
            }
            companion = artifact;
          }
          return generated;
        },
        id: "direct-constrained",
        label: "Direct constrained generation",
        reserveCalls: plan.maxCalls,
        reserveUsd: maxUsd,
        serial: true,
      },
    ],
    concept,
    onProgress: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
    style,
  }).catch((error: unknown) => {
    writeFileSync(
      path.join(out, "interrupted.json"),
      JSON.stringify(
        {
          actualUsd: null,
          cancelled: controller.signal.aborted,
          outcome: "blocked",
          reason:
            "Run interrupted; reconcile provider spend before another attempt",
        },
        null,
        2
      )
    );
    throw error;
  });
  // Persist failures and spend before rendering any secondary artifact.
  writeFileSync(
    path.join(out, "result.json"),
    JSON.stringify(
      { qualification: "unvalidated-exploration", tournament },
      null,
      2
    )
  );
  const specimens = tournament.candidates.flatMap((candidate) =>
    candidate.paints.map((paint) => ({ candidate, paint }))
  );
  await Promise.all(
    specimens.map(async ({ candidate, paint }) => {
      const stem = `${candidate.id}-${paint.finish}`;
      writeFileSync(path.join(out, `${stem}.svg`), paint.result.svg);
      writeFileSync(path.join(out, `${stem}.icon`), paint.result.program ?? "");
      if (paint.programComplete && paint.styleEligible) {
        const artifact = compileStyle(style, paint.result.program ?? "");
        replayStyle(style, artifact);
        writeFileSync(
          path.join(out, `${stem}.artifact.json`),
          JSON.stringify(artifact, null, 2)
        );
      }
      writeFileSync(
        path.join(out, `${stem}.native.png`),
        await png(paint.result.svg, style.spec.size)
      );
    })
  );
  process.stdout.write(
    `${JSON.stringify({ accepted: tournament.winner !== null, out, qualification: "unvalidated-exploration" })}\n`
  );
  process.exitCode = tournament.winner ? 0 : 1;
}

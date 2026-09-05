/** Offline representation and tournament wiring evidence. No model calls and
 * no quality claim. Run: npx tsx scripts/style-lab.ts --dry-run --out <dir> */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { decidePilot } from "../src/eval/foundry-gate.js";
import { LOOK_RUBRIC } from "../src/pipeline/audit.js";
import type { GenerateResult } from "../src/pipeline/generate.js";
import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import {
  STYLE_COMPILER,
  compileStyle,
  createStyleRevision,
  replayStyle,
  selectStyle,
} from "../src/pipeline/style.js";
import { runPairTournament } from "../src/pipeline/tournament.js";
import { specAt } from "../src/tools/canvas.js";
import { run } from "../src/tools/dsl.js";
import { lint } from "../src/tools/lint.js";
import { png, sheet } from "../src/tools/render.js";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean" },
    out: { type: "string" },
  },
});
if (!values["dry-run"] || !values.out) {
  throw new Error(
    "Use --dry-run --out <new-directory>; this lab makes no paid calls"
  );
}
const out = path.resolve(values.out);
mkdirSync(out, { recursive: false });
const programs = {
  container: "rect 4,4 16x16 r3",
  diamond: "diamond 12,12 7",
  disc: "circle 12,12 r7",
};
const unsupported = [
  {
    capability: "model-selected butt caps",
    program: "linecap butt\nline 4,12 20,12",
  },
  {
    capability: "new arbitrary cubic without a reference part",
    program: "curve 4,12 8,4 16,20 20,12",
  },
  {
    capability: "per-segment stroke width",
    program: "stroke 1.25\nline 4,12 20,12",
  },
];
const profiles = [
  { id: "house-spec-fixture", radius: 3, stroke: 2 },
  { id: "thin-tight-fixture", radius: 1, stroke: 1.5 },
];
const artifacts: Record<string, unknown>[] = [];
const svgs: string[] = [];
for (const profile of profiles) {
  const revision = createStyleRevision({
    calibration: "unvalidated",
    compiler: STYLE_COMPILER,
    id: profile.id,
    masters: {
      large: specAt({
        radius: profile.radius,
        size: 24,
        stroke: profile.stroke,
      }),
      small: specAt({
        radius: profile.radius,
        size: 16,
        stroke: profile.stroke,
      }),
    },
    parts: [],
    policy: DEFAULT_POLICY,
    references: [],
    rubric: `${LOOK_RUBRIC.split("\n\n").slice(1).join("\n\n")}\nThis fixture uses a ${profile.stroke}-unit stroke and maximum ${profile.radius}-unit corner radius on a 24-unit canvas. Judge at the supplied native size.`,
  });
  writeFileSync(
    path.join(out, `${profile.id}.json`),
    JSON.stringify(revision.definition, null, 2)
  );
  for (const master of ["small", "large"]) {
    const style = selectStyle(revision, master);
    for (const [name, body] of Object.entries(programs)) {
      // Deliberately injected: only plumbing is under test. A constant verdict
      // is not an evaluation result and never advances the real pilot.
      // oxlint-disable-next-line eslint/no-await-in-loop -- keep specimen order and bound raster work to one fixture at a time.
      const tournament = await runPairTournament({
        ask: () =>
          Promise.resolve({
            findings: [],
            pq: 10,
            reason: "Injected wiring verdict; no quality evidence",
            sc: 10,
          }),
        candidates: [
          {
            generate: (finish): Promise<GenerateResult> => {
              const program = `icon ${name}\nfinish ${finish}\n${body}`;
              const artifact = compileStyle(style, program);
              const compiled = run(program, [...style.parts], {
                spec: style.spec,
              });
              const issues = lint(compiled.canvas, {
                keyline: compiled.keyline,
              });
              return Promise.resolve({
                clean: !issues.some((issue) => issue.severity === "error"),
                doc: compiled.canvas.toJSON({
                  icon: compiled.icon,
                  keyline: compiled.keyline,
                }),
                issues,
                program,
                steps: 0,
                styleKey: style.key,
                svg: artifact.svg,
                text: "Host-authored capability fixture",
                trace: [],
              });
            },
            id: "compiler-fixture",
            label: "Compiler fixture; not generation",
          },
        ],
        concept: { name },
        style,
      });
      const [candidate] = tournament.candidates;
      for (const paint of candidate.paints) {
        const artifact = compileStyle(style, paint.result.program ?? "");
        replayStyle(style, artifact);
        const stem = `${profile.id}-${master}-${name}-${paint.finish}`;
        writeFileSync(path.join(out, `${stem}.svg`), artifact.svg);
        writeFileSync(path.join(out, `${stem}.icon`), artifact.program);
        writeFileSync(
          path.join(out, `${stem}.json`),
          JSON.stringify(artifact, null, 2)
        );
        writeFileSync(
          path.join(out, `${stem}.native.png`),
          // oxlint-disable-next-line eslint/no-await-in-loop -- bound native raster memory to one specimen.
          await png(artifact.svg, style.spec.size)
        );
        writeFileSync(
          path.join(out, `${stem}.2x.png`),
          // oxlint-disable-next-line eslint/no-await-in-loop -- bound native raster memory to one specimen.
          await png(artifact.svg, style.spec.size * 2)
        );
        svgs.push(artifact.svg);
        artifacts.push({
          artifact: `${stem}.json`,
          exactReplay: true,
          issues: paint.result.issues,
          master,
          nativeSize: style.spec.size,
          structural: paint.programComplete && paint.styleEligible,
          tournamentAcceptedWithInjectedJudge: paint.accepted,
        });
      }
      if (candidate.failure) {
        artifacts.push({
          failure: candidate.failure,
          master,
          name,
          profile: profile.id,
        });
      }
    }
  }
}
const probes = unsupported.map((probe) => ({
  ...probe,
  errors: run(probe.program).errors,
}));
writeFileSync(
  path.join(out, "contact-sheet.png"),
  await sheet(svgs, { cols: 6, size: 96 })
);
const report = {
  advancement: decidePilot({
    actualUsd: 0,
    ceilingUsd: 1,
    frozenManifestHash: "",
    holdoutExposed: false,
    items: [],
    observations: [],
    observedManifestHash: "",
    requiredDefects: ["blocked-counter", "weight", "junction", "family"],
    trials: [],
  }),
  artifacts,
  blockers: [
    "No real generation or evaluator qualification was run",
    "Fixture profiles vary supported stroke/radius controls; they do not establish a contrasting product style",
    "Automatic family anchors, optical treatments and sealed holdout pilot remain unproven",
  ],
  manualArtworkInterventions: 0,
  mode: "deterministic-capability-fixture",
  paidCalls: 0,
  probes,
  usd: 0,
};
writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
process.stdout.write(
  `${JSON.stringify({ artifacts: artifacts.length, outcome: report.advancement.outcome, report: path.join(out, "report.json") })}\n`
);

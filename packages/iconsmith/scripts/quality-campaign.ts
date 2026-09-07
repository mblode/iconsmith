/** Campaign freeze/report, independent AI review and historical label ingestion. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { writeAiReviewAssessment } from "./ai-review-assessment.js";
import { runAiReviewCampaign } from "./ai-review-campaign.js";
import { reportCampaign, writeCampaignManifest } from "./campaign-manifest.js";
import { reviewImagesWithCodex } from "./local-codex-review.js";
import { reviewImages } from "./local-review.js";
import {
  freezeQualificationReceipt,
  ingestHumanLabelFiles,
} from "./quality-labels.js";
import {
  captureRuntimeIdentity,
  verifyRuntimeIdentity,
} from "./runtime-identity.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    campaign: { type: "string" },
    "claude-command": { type: "string" },
    "codex-command": { type: "string" },
    execute: { type: "boolean" },
    instrument: { type: "string" },
    labels: { multiple: true, type: "string" },
    manifest: { type: "string" },
    out: { type: "string" },
    packet: { type: "string" },
    "per-reviewer-ms": { type: "string" },
    predictions: { type: "string" },
    provenance: { type: "string" },
    results: { type: "string" },
    roster: { type: "string" },
    "stop-file": { type: "string" },
  },
});
const [action, kind] = positionals;
const corpus = path.resolve(import.meta.dirname, "../.corpus");
const productionTypeScript = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return productionTypeScript(file);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [file]
      : [];
  });

if (action === "assess-ai" && values.campaign && values.out) {
  console.log(
    JSON.stringify(
      writeAiReviewAssessment(
        path.resolve(values.campaign),
        path.resolve(values.out)
      )
    )
  );
} else if (
  action === "freeze" &&
  (kind === "catalog" || kind === "development") &&
  values.out
) {
  console.log(
    JSON.stringify(
      writeCampaignManifest(
        values.out,
        kind,
        path.join(corpus, "manifest.json"),
        path.join(corpus, "icons.jsonl")
      )
    )
  );
} else if (action === "report" && values.manifest && values.results) {
  console.log(
    JSON.stringify(
      reportCampaign(
        JSON.parse(readFileSync(values.manifest, "utf-8")),
        JSON.parse(readFileSync(values.results, "utf-8"))
      )
    )
  );
} else if (
  action === "freeze-qualification" &&
  values.out &&
  values.instrument &&
  values.roster
) {
  console.log(
    JSON.stringify(
      freezeQualificationReceipt(values.out, values.instrument, values.roster)
    )
  );
} else if (
  action === "ingest-labels" &&
  values.provenance &&
  values.predictions &&
  values.labels?.length
) {
  const result = ingestHumanLabelFiles(
    values.provenance,
    values.labels,
    values.predictions
  );
  if (values.out) {
    writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`, {
      flag: "wx",
    });
  }
  console.log(JSON.stringify(result));
} else if (
  action === "ai-review" &&
  values.packet &&
  values.out &&
  values["codex-command"] &&
  values["claude-command"] &&
  path.isAbsolute(values["codex-command"]) &&
  path.isAbsolute(values["claude-command"])
) {
  const packetFile = path.resolve(values.packet);
  const packetDirectory = path.dirname(packetFile);
  const packet = JSON.parse(readFileSync(packetFile, "utf-8"));
  packet.stimuli = packet.stimuli.map(
    (row: { image: string; familyReferences: string[] }) => ({
      ...row,
      familyReferences: row.familyReferences.map((file) =>
        path.resolve(packetDirectory, file)
      ),
      image: path.resolve(packetDirectory, row.image),
    })
  );
  const runtime = captureRuntimeIdentity(
    values["codex-command"],
    values["claude-command"]
  );
  console.log(
    JSON.stringify(
      await runAiReviewCampaign({
        execute: values.execute,
        input: packet,
        maxPackets: 1,
        out: path.resolve(values.out),
        perReviewerMaxMs: Number(values["per-reviewer-ms"] ?? "480000"),
        routes: [
          {
            command: runtime.manifest.author.executable,
            id: "codex",
            invoke: (request) =>
              reviewImagesWithCodex({
                ...request,
                command: runtime.manifest.author.executable,
                maxStageMs: 480_000,
                model: "gpt-6-astra",
              }),
            model: "gpt-6-astra",
          },
          {
            command: runtime.manifest.reviewer.executable,
            id: "claude",
            invoke: (request) =>
              reviewImages({
                ...request,
                command: runtime.manifest.reviewer.executable,
                maxStageMs: 480_000,
              }),
            model: "claude-opus-5",
          },
        ],
        runtimeIdentity: runtime,
        stopFile: values["stop-file"]
          ? path.resolve(values["stop-file"])
          : undefined,
        toolingFiles: [
          ...productionTypeScript(import.meta.dirname),
          ...productionTypeScript(path.resolve(import.meta.dirname, "../src")),
          path.resolve(import.meta.dirname, "../../../package-lock.json"),
          path.resolve(import.meta.dirname, "../package.json"),
        ],
        verifyRuntime: (identity) =>
          verifyRuntimeIdentity(
            identity as ReturnType<typeof captureRuntimeIdentity>
          ),
      })
    )
  );
} else {
  throw new Error(
    "Usage: quality-campaign.ts freeze catalog|development --out FILE | report --manifest FILE --results FILE | freeze-qualification --instrument FILE --roster FILE --out FILE | ingest-labels --provenance FILE --labels FILE... --predictions FILE [--out FILE] | ai-review --packet FILE --out DIR --codex-command ABS --claude-command ABS [--per-reviewer-ms N] [--stop-file FILE] [--execute] | assess-ai --campaign DIR --out FILE"
  );
}

/** Canonical local foundry: pinned style, native author, independent review. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { subscriptionEnv } from "../src/pipeline/harness.js";
import { createStyleRevision } from "../src/pipeline/style.js";
import { writeDurableJson } from "./durable-json.js";
import { parseFamilyReferencePacket } from "./family-reference-packet.js";
import { prepareAuthorContext } from "./local-author-context.js";
import {
  configureNativeStyleRoute,
  nativeRetrievalReview,
  readNativeRouteManifest,
} from "./local-native-config.js";
import {
  bindDiagnosticFinalizationPlan,
  readDiagnosticFinalizationPlan,
} from "./local-native-interruption-diagnostic.js";
import { retrieveLocalStyle } from "./local-retrieval.js";
import { prepareLocalRuntime } from "./local-runtime.js";
import {
  normalizeLocalGenerationTerminal,
  runLocalStyle,
} from "./local-style-run.js";
import { readParentRequestClock } from "./review-budget.js";
import {
  captureRuntimeIdentity,
  verifyRuntimeIdentity,
} from "./runtime-identity.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    brief: { type: "string" },
    "campaign-hash": { type: "string" },
    codex: { type: "string" },
    "deadline-at": { type: "string" },
    "diagnostic-finalization-plan": { type: "string" },
    "diagnostic-finalization-plan-sha256": { type: "string" },
    exclude: { multiple: true, type: "string" },
    family: { type: "string" },
    "family-packet": { type: "string" },
    finish: { type: "string" },
    help: { short: "h", type: "boolean" },
    library: { type: "string" },
    "library-hash": { type: "string" },
    "library-set": { type: "string" },
    master: { type: "string" },
    "max-wall-ms": { default: "1200000", type: "string" },
    meanings: { type: "string" },
    model: { type: "string" },
    "native-route": { type: "string" },
    "native-route-hash": { type: "string" },
    qualification: { default: false, type: "boolean" },
    "request-id": { type: "string" },
    revision: { type: "string" },
    "runtime-manifest": { type: "string" },
    sketch: { type: "string" },
    "sketch-source": { type: "string" },
    "slot-id": { multiple: true, type: "string" },
    "stop-file": { type: "string" },
    "tooling-hash": { type: "string" },
  },
});
if (values.help) {
  writeSync(
    1,
    `Usage: npm run generate:local -- <concept> <new-output-directory> [options]

Required:
  --revision <file>       Pinned style revision JSON
  --master <name>         Master declared in that revision
  --meanings <file>       JSON array of 3–12 plausible labels, including the concept

Options:
  --finish outlined|filled  Omit to generate both paints
  --brief <file>            Design guidance in Markdown
  --codex <executable>      Author CLI (defaults to ChatGPT app bundle, then PATH)
  --model <id>              Author model (default: gpt-6-astra)
  --max-wall-ms <number>    Total time budget (default: 1200000)
  --library <directory>    Retrieve references from your SVG library
  --library-set <name>     Required with --library
  --exclude <concept>      Repeat to exclude retrieval subjects
  -h, --help               Show help without authentication or generation

Build first with npm run build:local. The default route requires native
ChatGPT and Claude subscription logins and a compatible restricted runtime.
Generation consumes subscription usage; no API-key fallback is used.
Use a new output directory whose parent already exists.
See docs/local-foundry.md for revision setup, advanced contained routes,
provenance and review limitations. A review-clear result is not craft approval.\n`
  );
  process.exit(0);
}
const authorCommand =
  values.codex ??
  (existsSync("/Applications/ChatGPT.app/Contents/Resources/codex")
    ? "/Applications/ChatGPT.app/Contents/Resources/codex"
    : "codex");
const authorModel = values.model ?? "gpt-6-astra";
const [concept, destination] = positionals;
if (
  positionals.length !== 2 ||
  !concept ||
  !destination ||
  !values.revision ||
  !values.master ||
  !values.meanings
) {
  throw new Error(
    "Usage: local-generate.ts <concept> <new-output-directory> --revision <file> --master <name> --meanings <json-file> [--finish outlined|filled] [--brief <file>]"
  );
}
if (Boolean(values["request-id"]) !== Boolean(values["tooling-hash"])) {
  throw new Error("--request-id and --tooling-hash must be supplied together");
}
if (values.finish && !["outlined", "filled"].includes(values.finish)) {
  throw new Error("--finish must be outlined or filled; omit for both.");
}
if (Boolean(values.sketch) !== Boolean(values["sketch-source"]?.trim())) {
  throw new Error(
    "--sketch and a nonempty --sketch-source must be supplied together."
  );
}
if (Boolean(values.library) !== Boolean(values["library-set"])) {
  throw new Error("--library and --library-set must be supplied together");
}
if (
  (values["library-hash"] && !values.library) ||
  (values.library &&
    values["request-id"] &&
    !/^[a-f0-9]{64}$/u.test(values["library-hash"] ?? ""))
) {
  throw new Error(
    "Parent-issued library retrieval requires a valid --library-hash"
  );
}
if (values.qualification && !values.library) {
  throw new Error("Qualification requires automatic library retrieval");
}
if (values["family-packet"] && !values.library) {
  throw new Error("--family-packet requires --library and --library-set");
}
const hasDiagnosticPlan = Boolean(values["diagnostic-finalization-plan"]);
if (
  hasDiagnosticPlan !==
    Boolean(values["diagnostic-finalization-plan-sha256"]) ||
  (hasDiagnosticPlan &&
    (!values["campaign-hash"] ||
      !values.family ||
      values["slot-id"]?.length !== 2 ||
      !values["family-packet"] ||
      !values["native-route"] ||
      !values["request-id"])) ||
  (!hasDiagnosticPlan &&
    (values["campaign-hash"] || values.family || values["slot-id"]))
) {
  throw new Error(
    "Diagnostic finalization requires its plan/hash, campaign, family, two slots, shared packet, native route and request id"
  );
}
const { deadlineAt, maxWallMs, startedAt } = readParentRequestClock({
  deadlineAt: values["deadline-at"],
  maxWallMs: values["max-wall-ms"],
  now: Date.now(),
});
const stageTimings: Record<string, number> = {};
const env = subscriptionEnv(process.env);
const out = path.resolve(destination);
let route = "pinned-control";
if (values.library) {
  route = "automatic-retrieval";
}
if (values["family-packet"]) {
  route = "shared-family-packet";
}
if (Boolean(values["native-route"]) !== Boolean(values["native-route-hash"])) {
  throw new Error(
    "--native-route and --native-route-hash must be supplied together"
  );
}
if (
  values["native-route"] &&
  (values["runtime-manifest"] || values.qualification)
) {
  throw new Error(
    "Native development route cannot inherit legacy runtime identity or claim qualification"
  );
}
const nativeManifest = values["native-route"]
  ? readNativeRouteManifest(
      path.resolve(values["native-route"]),
      values["native-route-hash"] ?? ""
    )
  : undefined;
const diagnosticFamilyPacket = hasDiagnosticPlan
  ? parseFamilyReferencePacket(
      JSON.parse(
        readFileSync(path.resolve(values["family-packet"] ?? ""), "utf-8")
      )
    )
  : undefined;
const diagnosticFinalization =
  hasDiagnosticPlan && nativeManifest && diagnosticFamilyPacket
    ? bindDiagnosticFinalizationPlan({
        actual: {
          campaignHash: values["campaign-hash"] ?? "",
          concept,
          deadlineAt,
          family: values.family ?? "",
          familyPacket: {
            file: path.resolve(values["family-packet"] ?? ""),
            packetHash: diagnosticFamilyPacket.packetHash,
            sha256: createHash("sha256")
              .update(readFileSync(path.resolve(values["family-packet"] ?? "")))
              .digest("hex"),
          },
          image: nativeManifest.manifest.image,
          master: values.master,
          maxWallMs,
          requestId: values["request-id"] ?? "",
          revisionFile: path.resolve(values.revision),
          revisionHash: createHash("sha256")
            .update(readFileSync(path.resolve(values.revision)))
            .digest("hex"),
          routeHash: nativeManifest.hash,
          slotIds: values["slot-id"] ?? [],
        },
        loaded: readDiagnosticFinalizationPlan({
          file: path.resolve(values["diagnostic-finalization-plan"] ?? ""),
          sha256: values["diagnostic-finalization-plan-sha256"] ?? "",
        }),
      })
    : undefined;
if (values["stop-file"] && !nativeManifest) {
  throw new Error("Shared campaign stop requires the contained native route");
}
if (
  nativeManifest &&
  ((values.codex &&
    values.codex !== nativeManifest.manifest.author.executable.path) ||
    (values.model && values.model !== nativeManifest.manifest.author.model))
) {
  throw new Error("Native launch arguments disagree with the frozen route");
}
const legacyRuntimeIdentity = () =>
  values["runtime-manifest"]
    ? verifyRuntimeIdentity(
        JSON.parse(readFileSync(values["runtime-manifest"], "utf-8")),
        env
      )
    : captureRuntimeIdentity(authorCommand, "claude", env);
const runtimeIdentity = nativeManifest
  ? {
      hash: nativeManifest.hash,
      manifest: {
        author: {
          command: nativeManifest.manifest.author.executable.path,
          executable: nativeManifest.manifest.author.executable.path,
        },
        reviewer: {
          command: nativeManifest.manifest.reviewers[0].executable.path,
          executable: nativeManifest.manifest.reviewers[0].executable.path,
        },
      },
    }
  : legacyRuntimeIdentity();
if (
  !nativeManifest &&
  (runtimeIdentity.manifest.author.command !== authorCommand ||
    runtimeIdentity.manifest.reviewer.command !== "claude")
) {
  throw new Error("Runtime manifest commands do not match generation route");
}
mkdirSync(out, { recursive: false });
writeDurableJson(path.join(out, "runtime-identity.json"), runtimeIdentity);
writeDurableJson(path.join(out, "run.json"), {
  author: nativeManifest?.manifest.author.provider ?? "codex",
  authorCommand: runtimeIdentity.manifest.author.executable,
  billing: "subscription",
  concept,
  deadlineAt,
  maxWallMs,
  requestId: values["request-id"],
  requestedModel: nativeManifest?.manifest.author.model ?? authorModel,
  requestedReasoningEffort: "high",
  reviewer:
    nativeManifest?.manifest.reviewers.map((reviewer) => reviewer.model) ??
    "claude",
  route,
  runtimeHash: runtimeIdentity.hash,
  startedAt: new Date(startedAt).toISOString(),
  toolingHash: values["tooling-hash"],
});
let activeStage = "preflight";
let stageStartedAt = startedAt;
try {
  if (!nativeManifest) {
    const codex = spawnSync(
      runtimeIdentity.manifest.author.executable,
      ["login", "status"],
      {
        encoding: "utf-8",
        env,
        timeout: Math.max(1, deadlineAt - Date.now()),
      }
    );
    if (
      codex.status !== 0 ||
      !`${codex.stdout}${codex.stderr}`.includes("Logged in using ChatGPT")
    ) {
      throw new Error(
        `The native author login check failed. ChatGPT login is required. ${codex.error?.message ?? codex.stderr?.trim() ?? "No status diagnostic returned."}`
      );
    }
    if (Date.now() >= deadlineAt) {
      throw new Error("Run deadline exhausted during authentication");
    }
    const claude = spawnSync(
      runtimeIdentity.manifest.reviewer.executable,
      ["auth", "status"],
      {
        encoding: "utf-8",
        env,
        timeout: Math.max(1, deadlineAt - Date.now()),
      }
    );
    const auth = claude.status === 0 ? JSON.parse(claude.stdout) : null;
    if (auth?.loggedIn !== true || auth.authMethod !== "claude.ai") {
      throw new Error(
        "The independent reviewer must be signed in using Claude's native subscription."
      );
    }
  }
  const nativeRoute = nativeManifest
    ? configureNativeStyleRoute({
        campaignStopFile: values["stop-file"]
          ? path.resolve(values["stop-file"])
          : undefined,
        deadlineAt,
        manifest: nativeManifest.manifest,
        out,
        requestId: values["request-id"] ?? `local-${startedAt}`,
        retrievalCalls: values.library && !values["family-packet"] ? 2 : 0,
        routeHash: nativeManifest.hash,
        startedAt,
        ...(diagnosticFinalization ? { diagnosticFinalization } : {}),
      })
    : undefined;
  stageTimings.preflight = Date.now() - startedAt;
  let revisionPath = path.resolve(values.revision);
  activeStage = "retrieval";
  stageStartedAt = Date.now();
  if (values.library) {
    await retrieveLocalStyle({
      concept,
      deadlineAt:
        nativeRoute && !values["family-packet"]
          ? nativeRoute.budget.retrievalDeadlineAt
          : deadlineAt,
      exclusions: values.exclude,
      expectedLibraryTreeHash: values["library-hash"],
      familyPacket: values["family-packet"]
        ? JSON.parse(
            readFileSync(path.resolve(values["family-packet"]), "utf-8")
          )
        : undefined,
      library: path.resolve(values.library),
      master: values.master,
      out: path.join(out, "retrieval"),
      review:
        nativeRoute && !values["family-packet"]
          ? nativeRetrievalReview(nativeRoute)
          : undefined,
      revision: createStyleRevision(
        JSON.parse(readFileSync(revisionPath, "utf-8"))
      ),
      set: values["library-set"] ?? "",
    });
    revisionPath = path.join(out, "retrieval", "revision.json");
  }
  stageTimings.retrieval = Date.now() - stageStartedAt;
  if (Date.now() >= deadlineAt) {
    throw new Error("Run deadline exhausted before author launch");
  }
  activeStage = "generation";
  stageStartedAt = Date.now();
  const result = await runLocalStyle({
    args: (brief, permissionArgs, images) => [
      "exec",
      "--ignore-user-config",
      "--json",
      "--model",
      authorModel,
      "-c",
      'model_reasoning_effort="high"',
      "--skip-git-repo-check",
      "-c",
      'approval_policy="never"',
      "-c",
      "project_doc_max_bytes=0",
      "-c",
      'web_search="disabled"',
      ...permissionArgs,
      ...images.flatMap((image) => ["--image", image]),
      "--",
      brief,
    ],
    command: runtimeIdentity.manifest.author.executable,
    composition: values.sketch
      ? {
          path: path.resolve(values.sketch),
          source: values["sketch-source"] ?? "",
        }
      : undefined,
    concept,
    deadlineAt,
    env,
    finish: values.finish as "outlined" | "filled" | undefined,
    guidance: [
      values.brief ? readFileSync(values.brief, "utf-8") : "",
      values.library
        ? `Automatic retrieval observations (reference evidence, not mandatory construction instructions): ${readFileSync(path.join(out, "retrieval", "selection.json"), "utf-8")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    master: values.master,
    maxWallMs,
    meanings: JSON.parse(readFileSync(values.meanings, "utf-8")),
    nativeRoute,
    out,
    prepareRuntime: nativeManifest
      ? undefined
      : async (directory) => {
          const runtime = await prepareLocalRuntime(
            directory,
            runtimeIdentity.manifest.author.executable,
            env
          );
          const context = prepareAuthorContext(
            runtimeIdentity.manifest.author.executable,
            directory,
            env
          );
          return {
            ...runtime,
            permissionArgs: [...runtime.permissionArgs, ...context.args],
            protectedFiles: [...runtime.protectedFiles, context.receiptName],
          };
        },
    reviewerCommand: runtimeIdentity.manifest.reviewer.executable,
    revisionPath,
  });
  stageTimings.generation = Date.now() - stageStartedAt;
  if (nativeManifest) {
    readNativeRouteManifest(
      path.resolve(values["native-route"] ?? ""),
      nativeManifest.hash
    );
  } else {
    verifyRuntimeIdentity(
      runtimeIdentity as ReturnType<typeof captureRuntimeIdentity>,
      env
    );
  }
  const completedAt = Date.now();
  const normalized = normalizeLocalGenerationTerminal(
    result,
    completedAt >= deadlineAt
  );
  const terminal = {
    ...normalized,
    deadlineAt,
    deadlineExceeded: completedAt >= deadlineAt,
    elapsedMs: completedAt - startedAt,
    requestId: values["request-id"],
    route,
    runtimeHash: runtimeIdentity.hash,
    stageTimings,
    toolingHash: values["tooling-hash"],
  };
  writeDurableJson(path.join(out, "request.json"), terminal);
  console.log(JSON.stringify(terminal));
  if (
    result.status !== "delivered" ||
    terminal.qualityStatus !== "review-clear"
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  const completedAt = Date.now();
  stageTimings[activeStage] = completedAt - stageStartedAt;
  writeDurableJson(path.join(out, "request.json"), {
    actualUsd: null,
    deadlineAt,
    deadlineExceeded: completedAt >= deadlineAt,
    elapsedMs: completedAt - startedAt,
    error: String(error),
    master: values.master,
    maxWallMs,
    nativeSize: Number(values.master),
    qualityStatus:
      completedAt >= deadlineAt ? "deadline-exhausted" : "not-reviewed",
    requestId: values["request-id"],
    route,
    runtimeHash: runtimeIdentity.hash,
    stageTimings,
    status: "incomplete",
    toolingHash: values["tooling-hash"],
  });
  writeFileSync(path.join(out, "failure.txt"), String(error));
  throw error;
}

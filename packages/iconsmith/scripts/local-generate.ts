/** Canonical local foundry: pinned style, native author, independent review. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { subscriptionEnv } from "../src/pipeline/harness.js";
import { createStyleRevision } from "../src/pipeline/style.js";
import { prepareAuthorContext } from "./local-author-context.js";
import { retrieveLocalStyle } from "./local-retrieval.js";
import { prepareLocalRuntime } from "./local-runtime.js";
import { runLocalStyle } from "./local-style-run.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    brief: { type: "string" },
    codex: {
      default: existsSync("/Applications/ChatGPT.app/Contents/Resources/codex")
        ? "/Applications/ChatGPT.app/Contents/Resources/codex"
        : "codex",
      type: "string",
    },
    exclude: { multiple: true, type: "string" },
    finish: { type: "string" },
    library: { type: "string" },
    "library-set": { type: "string" },
    master: { type: "string" },
    "max-wall-ms": { default: "600000", type: "string" },
    meanings: { type: "string" },
    model: { default: "gpt-6-astra", type: "string" },
    qualification: { default: false, type: "boolean" },
    revision: { type: "string" },
    sketch: { type: "string" },
    "sketch-source": { type: "string" },
  },
});
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
if (values.qualification && !values.library) {
  throw new Error("Qualification requires automatic library retrieval");
}
const startedAt = Date.now();
const maxWallMs = Number(values["max-wall-ms"]);
if (!Number.isFinite(maxWallMs) || maxWallMs <= 0) {
  throw new Error("Run wall budget must be positive and finite");
}
const deadlineAt = startedAt + maxWallMs;
const stageTimings: Record<string, number> = {};
const env = subscriptionEnv(process.env);
const out = path.resolve(destination);
mkdirSync(out, { recursive: false });
writeFileSync(
  path.join(out, "run.json"),
  JSON.stringify(
    {
      author: "codex",
      authorCommand: values.codex,
      billing: "subscription",
      concept,
      deadlineAt,
      maxWallMs,
      requestedModel: values.model,
      requestedReasoningEffort: "high",
      reviewer: "claude",
      route: values.library ? "automatic-retrieval" : "pinned-control",
      startedAt: new Date(startedAt).toISOString(),
    },
    null,
    2
  )
);
let activeStage = "preflight";
let stageStartedAt = startedAt;
try {
  const codex = spawnSync(values.codex, ["login", "status"], {
    encoding: "utf-8",
    env,
    timeout: Math.max(1, deadlineAt - Date.now()),
  });
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
  const claude = spawnSync("claude", ["auth", "status"], {
    encoding: "utf-8",
    env,
    timeout: Math.max(1, deadlineAt - Date.now()),
  });
  const auth = claude.status === 0 ? JSON.parse(claude.stdout) : null;
  if (auth?.loggedIn !== true || auth.authMethod !== "claude.ai") {
    throw new Error(
      "The independent reviewer must be signed in using Claude's native subscription."
    );
  }
  stageTimings.preflight = Date.now() - startedAt;
  let revisionPath = path.resolve(values.revision);
  activeStage = "retrieval";
  stageStartedAt = Date.now();
  if (values.library) {
    await retrieveLocalStyle({
      concept,
      deadlineAt,
      exclusions: values.exclude,
      library: path.resolve(values.library),
      master: values.master,
      out: path.join(out, "retrieval"),
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
      values.model,
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
    command: values.codex,
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
    out,
    prepareRuntime: async (directory) => {
      const runtime = await prepareLocalRuntime(directory, values.codex, env);
      const context = prepareAuthorContext(values.codex, directory, env);
      return {
        ...runtime,
        permissionArgs: [...runtime.permissionArgs, ...context.args],
        protectedFiles: [...runtime.protectedFiles, context.receiptName],
      };
    },
    revisionPath,
  });
  stageTimings.generation = Date.now() - stageStartedAt;
  const terminal = {
    ...result,
    deadlineAt,
    deadlineExceeded: Date.now() >= deadlineAt,
    elapsedMs: Date.now() - startedAt,
    route: values.library ? "automatic-retrieval" : "pinned-control",
    stageTimings,
  };
  if (terminal.deadlineExceeded) {
    terminal.qualityStatus = "deadline-exhausted";
  }
  writeFileSync(
    path.join(out, "request.json"),
    JSON.stringify(terminal, null, 2)
  );
  console.log(JSON.stringify(terminal));
  if (
    result.status !== "delivered" ||
    terminal.qualityStatus !== "review-clear"
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  stageTimings[activeStage] = Date.now() - stageStartedAt;
  writeFileSync(
    path.join(out, "request.json"),
    JSON.stringify(
      {
        actualUsd: null,
        deadlineAt,
        deadlineExceeded: Date.now() >= deadlineAt,
        elapsedMs: Date.now() - startedAt,
        error: String(error),
        route: values.library ? "automatic-retrieval" : "pinned-control",
        stageTimings,
        status: "incomplete",
      },
      null,
      2
    )
  );
  writeFileSync(path.join(out, "failure.txt"), String(error));
  throw error;
}

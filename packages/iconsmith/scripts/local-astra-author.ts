/** Native Astra adapter for the shared host-orchestrated structured lifecycle. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { subscriptionEnv } from "../src/pipeline/harness.js";
import { prepareAuthorContext } from "./local-author-context.js";
import { readAuthorTrace } from "./local-author-evidence.js";
import {
  constructionJsonSchema,
  finalReviewJsonSchema,
} from "./local-claude-author.js";
import { reviewImagesWithCodex } from "./local-codex-review.js";
import { runOwnedProcess } from "./local-process.js";
import { runStructuredAuthor } from "./local-structured-author.js";
import type { StructuredAuthorOptions } from "./local-structured-author.js";
import { executableIdentity, resolveExecutable } from "./runtime-identity.js";

export const ASTRA_STRUCTURED_AUTHOR_MODEL = "gpt-6-astra";
/** Codex strict schemas require every declared property to be required. */
export const astraConstructionJsonSchema = {
  ...constructionJsonSchema,
  properties: {
    ...constructionJsonSchema.properties,
    programs: {
      ...constructionJsonSchema.properties.programs,
      properties: {
        filled: { type: ["string", "null"] },
        outlined: { type: ["string", "null"] },
      },
      required: ["filled", "outlined"],
    },
  },
} as const;

const normalizeAstraConstruction = (value: unknown) => {
  if (typeof value !== "object" || value === null || !("programs" in value)) {
    return value;
  }
  const { programs } = value;
  if (typeof programs !== "object" || programs === null) {
    return value;
  }
  return {
    ...value,
    programs: Object.fromEntries(
      Object.entries(programs).filter(([, program]) => program !== null)
    ),
  };
};
interface Identity {
  cliVersion: string;
  executable: string;
  executableSha256: string;
  loggedIn: true;
}
interface Invocation {
  deadlineAt: number;
  env: NodeJS.ProcessEnv;
  images?: Readonly<Record<string, Uint8Array>>;
  out: string;
  prompt: string;
  schema: object;
}
export interface NativeAstraAuthorOptions {
  command?: string;
  concept: string;
  deadlineAt: number;
  env?: NodeJS.ProcessEnv;
  out: string;
  referenceImages: Readonly<Record<string, Uint8Array>>;
  invoke?: (request: Invocation) => Promise<unknown>;
  preflight?: (
    env: NodeJS.ProcessEnv,
    deadlineAt: number,
    command: string
  ) => Identity;
  review?: typeof reviewImagesWithCodex;
}
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const nativePreflight = (
  env: NodeJS.ProcessEnv,
  deadlineAt: number,
  requestedCommand: string
): Identity => {
  const command = resolveExecutable(requestedCommand, env.PATH);
  const auth = spawnSync(command, ["login", "status"], {
    encoding: "utf-8",
    env,
    timeout: Math.max(1, Math.min(10_000, deadlineAt - Date.now())),
  });
  const executable = executableIdentity(command, env);
  if (
    Date.now() >= deadlineAt ||
    auth.status !== 0 ||
    !`${auth.stdout}${auth.stderr}`.includes("Logged in using ChatGPT") ||
    !executable.version
  ) {
    throw new Error(
      "Native Astra subscription login and CLI identity are required"
    );
  }
  return {
    cliVersion: executable.version,
    executable: executable.executable,
    executableSha256: executable.sha256,
    loggedIn: true,
  };
};
const parseOutput = (stdout: string) => {
  const messages = stdout
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const event = JSON.parse(line);
      return event.type === "item.completed" &&
        event.item?.type === "agent_message"
        ? [event.item.text]
        : [];
    });
  const parsed = messages.flatMap((text, index) => {
    try {
      return [{ index, value: JSON.parse(text) }];
    } catch {
      return [];
    }
  });
  if (parsed.length !== 1 || parsed[0]?.index !== messages.length - 1) {
    throw new Error("Missing unambiguous Astra structured response");
  }
  return parsed[0].value;
};
export const validateAstraStructuredTrace = (trace: string) => {
  const records = trace
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (
    records.some(
      (record) =>
        record.type === "response_item" &&
        ["function_call", "custom_tool_call", "local_shell_call"].includes(
          record.payload?.type
        )
    )
  ) {
    throw new Error("Astra structured author used a prohibited tool");
  }
  const models = new Set(
    records
      .filter((record) => record.type === "turn_context")
      .map((record) => record.payload?.model)
      .filter(Boolean)
  );
  if (models.size !== 1 || !models.has(ASTRA_STRUCTURED_AUTHOR_MODEL)) {
    throw new Error(
      "Astra structured author model identity differed from the pin"
    );
  }
};
const invokeNative = async (request: Invocation) => {
  if (Date.now() >= request.deadlineAt) {
    throw new Error("Astra deadline exhausted before context preparation");
  }
  const cwd = request.out;
  const context = prepareAuthorContext(
    request.env.CODEX_COMMAND ?? "codex",
    cwd,
    request.env
  );
  if (Date.now() >= request.deadlineAt) {
    throw new Error("Astra deadline exhausted during context preparation");
  }
  const schemaFile = path.join(cwd, "schema.json");
  writeFileSync(schemaFile, JSON.stringify(request.schema));
  const imageDir = path.join(cwd, "images");
  const images = request.images ?? {};
  if (Object.keys(images).length) {
    mkdirSync(imageDir);
  }
  const imageArgs = Object.entries(images).flatMap(([name, bytes]) => {
    const file = path.join(imageDir, name);
    writeFileSync(file, bytes);
    return ["--image", file];
  });
  const noTools = `Do not call any tool, shell, filesystem, network, search, or MCP function. Use only this prompt and attached images. ${request.prompt}`;
  const result = await runOwnedProcess({
    args: [
      "exec",
      "--ignore-user-config",
      "--json",
      "--model",
      ASTRA_STRUCTURED_AUTHOR_MODEL,
      "-c",
      'model_reasoning_effort="high"',
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "-c",
      'approval_policy="never"',
      "-c",
      "project_doc_max_bytes=0",
      "-c",
      'web_search="disabled"',
      ...context.args,
      "--output-schema",
      schemaFile,
      ...imageArgs,
      "--",
      noTools,
    ],
    command: request.env.CODEX_COMMAND ?? "codex",
    cwd,
    env: request.env,
    maxBuffer: 24 * 1024 * 1024,
    timeoutMs: Math.max(1, request.deadlineAt - Date.now()),
  });
  writeFileSync(
    path.join(cwd, "process.json"),
    JSON.stringify(result, null, 2)
  );
  if (result.code !== 0 || result.killed) {
    throw new Error("Astra structured stage did not complete");
  }
  const trace = readAuthorTrace(result.stdout, cwd, request.env);
  validateAstraStructuredTrace(trace);
  return parseOutput(result.stdout);
};
export const nativeAstraAuthorAdapters = (
  options: NativeAstraAuthorOptions
) => {
  const env = subscriptionEnv(options.env ?? process.env);
  if (!options.concept.trim()) {
    throw new Error("Native structured author requires an intended concept");
  }
  const identity = (options.preflight ?? nativePreflight)(
    env,
    options.deadlineAt,
    options.command ?? "codex"
  );
  env.CODEX_COMMAND = identity.executable;
  const referenceHashes = Object.fromEntries(
    Object.entries(options.referenceImages).map(([name, image]) => [
      name,
      digest(image),
    ])
  );
  if (
    !Object.keys(referenceHashes).length ||
    Object.keys(referenceHashes).some(
      (name) => !/^[a-z0-9-]+\.png$/u.test(name)
    )
  ) {
    throw new Error(
      "Native structured author requires a visual reference packet"
    );
  }
  let stage = 0,
    written = false;
  const stageOut = (name: string, create = true) => {
    if (!written) {
      writeFileSync(
        path.join(options.out, "native-astra-author.json"),
        JSON.stringify(
          {
            actualCliVersion: identity.cliVersion,
            billing: "subscription",
            concept: options.concept,
            craftApproved: false,
            executable: identity.executable,
            executableSha256: identity.executableSha256,
            instrumentQualified: false,
            mechanism: "experimental-native-structured-author",
            referenceHashes,
            requestedModel: ASTRA_STRUCTURED_AUTHOR_MODEL,
            selfInspection: true,
          },
          null,
          2
        )
      );
      written = true;
    }
    const out = path.join(
      options.out,
      `${String(stage).padStart(2, "0")}-${name}`
    );
    stage += 1;
    if (create) {
      mkdirSync(out);
    }
    return out;
  };
  const invoke = options.invoke ?? invokeNative;
  const review = options.review ?? reviewImagesWithCodex;
  return {
    construct: (
      request: Parameters<StructuredAuthorOptions["construct"]>[0]
    ) => {
      const out = stageOut(request.stage);
      const { deadlineAt } = request;
      if (Date.now() >= deadlineAt) {
        throw new Error(
          "Structured construction cannot consume final stage reserve"
        );
      }
      const prompt = `${request.prompt}\nIntended concept: ${options.concept}. Return only editable Iconsmith constrained DSL programs in the schema. Never emit SVG, raw path data, or prose. The host parser and checker are authoritative. Previous host-valid programs: ${JSON.stringify(request.previousPrograms)}. Host-observed defects permitted for this repair: ${JSON.stringify(request.defects)}.`;
      writeFileSync(
        path.join(out, "request.json"),
        JSON.stringify(
          {
            model: ASTRA_STRUCTURED_AUTHOR_MODEL,
            prompt,
            schema: astraConstructionJsonSchema,
            stageDeadlineAt: deadlineAt,
            visualReferences: referenceHashes,
          },
          null,
          2
        )
      );
      return invoke({
        deadlineAt,
        env,
        images: options.referenceImages,
        out,
        prompt,
        schema: astraConstructionJsonSchema,
      }).then(normalizeAstraConstruction);
    },
    finalize: (request: Parameters<StructuredAuthorOptions["finalize"]>[0]) => {
      const out = stageOut("finalize");
      const prompt = `Write the final author review only. You cannot change or return geometry. Report representation uncertainty separately from visible defects. Inspection: ${JSON.stringify(request.inspection)}. Program hashes: ${JSON.stringify(request.programHashes)}.`;
      return invoke({
        deadlineAt: request.deadlineAt,
        env,
        out,
        prompt,
        schema: finalReviewJsonSchema,
      });
    },
    inspect: async (
      request: Parameters<StructuredAuthorOptions["inspect"]>[0]
    ) => {
      const images = Object.fromEntries([
        ...Object.entries(options.referenceImages).map(([name, image]) => [
          `anchor-${name}`,
          image,
        ]),
        ...Object.entries(request.proofs).flatMap(([finish, proof]) =>
          proof ? [[`${finish}-proof.png`, proof]] : []
        ),
      ]);
      const result = await review({
        command: identity.executable,
        deadlineAt: request.deadlineAt,
        images,
        model: ASTRA_STRUCTURED_AUTHOR_MODEL,
        out: stageOut("author-self-review", false),
        questions: Object.keys(request.proofs).map((finish) => ({
          choices: ["pass", "fail", "uncertain"],
          id: `author-self-review-${finish}`,
          prompt: `Assess intended ${options.concept} in ${finish}-proof.png against the supplied family anchors. Choose pass only when no observed or uncertain visible geometry, meaning, native legibility, or paint-consistency defect remains; choose fail for a named observed defect; choose uncertain for a specific unresolved visual doubt. This is author self-review and not independent qualification.`,
        })),
      });
      if (result.status !== "complete" || !result.answers) {
        throw new Error("Author self-review did not inspect every exact proof");
      }
      const defects = Object.entries(result.answers).flatMap(([id, answer]) =>
        answer.choice === "fail"
          ? [
              {
                description: answer.evidence,
                finish: id.replace("author-self-review-", ""),
                id,
                kind: "visual" as const,
                treatment:
                  answer.treatment || "Repair only the named visible region.",
              },
            ]
          : []
      );
      return {
        defects,
        inspectionEvidence: Object.values(result.answers)
          .map((answer) => answer.evidence)
          .join(" "),
        uncertainties: Object.entries(result.answers).flatMap(([id, answer]) =>
          answer.choice === "uncertain"
            ? [
                {
                  description: answer.evidence,
                  finish: id.replace("author-self-review-", ""),
                },
              ]
            : []
        ),
      };
    },
  } satisfies Pick<
    StructuredAuthorOptions,
    "construct" | "finalize" | "inspect"
  >;
};
export const runNativeAstraStructuredAuthor = (
  options: Omit<
    StructuredAuthorOptions,
    "construct" | "finalize" | "inspect" | "model"
  > &
    NativeAstraAuthorOptions
) =>
  runStructuredAuthor({
    ...options,
    ...nativeAstraAuthorAdapters(options),
    model: ASTRA_STRUCTURED_AUTHOR_MODEL,
  });

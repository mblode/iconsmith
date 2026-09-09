/** Runnable native-Claude adapters for the opt-in structured-author contender. */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { subscriptionEnv } from "../src/pipeline/harness.js";
import {
  runNativeContainerCommand,
  validateNativeCliContainerConfig,
} from "./local-container-runtime.js";
import type { NativeCliContainerConfig } from "./local-container-runtime.js";
import type { NativeCallContainerFactory } from "./local-native-call-factory.js";
import { reviewImages } from "./local-review.js";
import {
  runStructuredAuthor,
  STRUCTURED_AUTHOR_MODEL,
} from "./local-structured-author.js";
import type { StructuredAuthorOptions } from "./local-structured-author.js";

const responseSchema = z
  .object({
    is_error: z.boolean().optional(),
    model: z.string().optional(),
    permission_denials: z.array(z.unknown()).optional(),
    structured_output: z.unknown().optional(),
    subtype: z.string().optional(),
    type: z.string(),
  })
  .passthrough();

export const constructionJsonSchema = {
  additionalProperties: false,
  properties: {
    addressedDefectIds: { items: { type: "string" }, type: "array" },
    programs: {
      additionalProperties: false,
      properties: {
        filled: { type: "string" },
        outlined: { type: "string" },
      },
      type: "object",
    },
  },
  required: ["addressedDefectIds", "programs"],
  type: "object",
} as const;

export const finalReviewJsonSchema = {
  additionalProperties: false,
  properties: {
    reviewMarkdown: { type: "string" },
    unresolved: {
      items: {
        additionalProperties: false,
        properties: {
          description: { type: "string" },
          id: { type: "string" },
          kind: { enum: ["representation", "visual"], type: "string" },
        },
        required: ["description", "id", "kind"],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["reviewMarkdown", "unresolved"],
  type: "object",
} as const;

export type NativeClaudeAuthorEffort = "medium" | "high";

export const claudeStructuredArgs = (
  schema: object,
  effort: NativeClaudeAuthorEffort = "high"
) => [
  "-p",
  "--restricted",
  "--safe-mode",
  "--setting-sources",
  "",
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--no-session-persistence",
  "--no-chrome",
  "--tools",
  "",
  "--allowedTools",
  "",
  "--permission-mode",
  "dontAsk",
  "--effort",
  effort,
  "--model",
  STRUCTURED_AUTHOR_MODEL,
  "--output-format",
  "stream-json",
  "--input-format",
  "stream-json",
  "--verbose",
  "--json-schema",
  JSON.stringify(schema),
];

interface PreflightIdentity {
  authMethod: "claude.ai" | "unverified";
  cliVersion: string;
  executable: string;
  executableSha256: string;
  loggedIn: boolean;
}

const containerIdentity = (
  container: NativeCliContainerConfig
): PreflightIdentity => {
  validateNativeCliContainerConfig(container);
  return {
    authMethod: "unverified",
    cliVersion: container.nativeCliVersion,
    executable: container.nativeCommand,
    executableSha256: container.nativeExecutableSha256,
    loggedIn: false,
  };
};

interface StructuredInvocation {
  command: string;
  deadlineAt: number;
  env: NodeJS.ProcessEnv;
  effort: NativeClaudeAuthorEffort;
  images?: Readonly<Record<string, Uint8Array>>;
  out: string;
  prompt: string;
  schema: object;
}

export const claudeStreamInput = (
  prompt: string,
  images: Readonly<Record<string, Uint8Array>> = {}
) => {
  const content = [
    { text: prompt, type: "text" },
    ...Object.entries(images).flatMap(([name, image]) => [
      { text: `Visual reference packet image: ${name}`, type: "text" },
      {
        source: {
          data: Buffer.from(image).toString("base64"),
          media_type: "image/png",
          type: "base64",
        },
        type: "image",
      },
    ]),
  ];
  return `${JSON.stringify({ message: { content, role: "user" }, type: "user" })}\n`;
};

const invokeNativeClaude = async (
  options: StructuredInvocation,
  container: NativeCliContainerConfig
) => {
  const remaining = options.deadlineAt - Date.now();
  if (remaining <= 0) {
    throw new Error("Claude author deadline exhausted");
  }
  const inputPath = path.join(options.out, ".claude-input.jsonl");
  const bridgePath = path.join(options.out, ".claude-stream-bridge.mjs");
  writeFileSync(inputPath, claudeStreamInput(options.prompt, options.images));
  copyFileSync(
    fileURLToPath(new URL("local-claude-stream-bridge.ts", import.meta.url)),
    bridgePath
  );
  let result;
  try {
    if (!container.nodeCommand) {
      throw new Error("Claude container config requires nodeCommand");
    }
    result = await runNativeContainerCommand(container, {
      args: [
        bridgePath,
        inputPath,
        container.nativeCommand,
        ...claudeStructuredArgs(options.schema, options.effort),
      ],
      command: container.nodeCommand,
      cwd: options.out,
      deadlineAt: options.deadlineAt,
      maxBuffer: 12 * 1024 * 1024,
    });
  } finally {
    unlinkSync(inputPath);
    unlinkSync(bridgePath);
  }
  writeFileSync(
    path.join(options.out, "process.json"),
    JSON.stringify(result, null, 2)
  );
  if (result.code !== 0 || result.killed) {
    throw new Error("Claude structured stage did not complete");
  }
  const events = result.stdout
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => responseSchema.parse(JSON.parse(line)));
  const actualModel = events.find(
    (event) => event.type === "system" && event.subtype === "init"
  )?.model;
  if (actualModel?.replace(/\[[^\]]+\]$/u, "") !== STRUCTURED_AUTHOR_MODEL) {
    throw new Error(
      "Claude structured stage model identity differed from the pin"
    );
  }
  const finals = events.filter(
    (event) =>
      event.type === "result" &&
      event.subtype === "success" &&
      event.is_error === false &&
      !event.permission_denials?.length
  );
  if (finals.length !== 1 || finals[0]?.structured_output === undefined) {
    throw new Error(
      "Claude structured stage returned no unique successful result"
    );
  }
  return finals[0].structured_output;
};

type SelfReview = typeof reviewImages;

export interface NativeClaudeAuthorAdapterOptions {
  container?: NativeCliContainerConfig;
  containerFactory?: NativeCallContainerFactory;
  concept: string;
  deadlineAt: number;
  env?: NodeJS.ProcessEnv;
  /** Native Claude reasoning effort. Defaults to the frozen-route value, high. */
  effort?: NativeClaudeAuthorEffort;
  invoke?: (request: StructuredInvocation) => Promise<unknown>;
  out: string;
  preflight?: (env: NodeJS.ProcessEnv, deadlineAt: number) => PreflightIdentity;
  referenceImages: Readonly<Record<string, Uint8Array>>;
  review?: SelfReview;
  /** Provider-writable call directories, kept outside out receipt paths. */
  runtimeRoot?: string;
}

export const nativeClaudeAuthorAdapters = (
  options: NativeClaudeAuthorAdapterOptions
) => {
  const env = subscriptionEnv(options.env ?? process.env);
  const effort = options.effort ?? "high";
  if (!options.concept.trim()) {
    throw new Error("Native structured author requires an intended concept");
  }
  if (
    (!options.invoke || !options.review) &&
    (!options.container || !options.containerFactory)
  ) {
    throw new Error(
      "Native Claude author requires a call-scoped container factory"
    );
  }
  if (options.containerFactory && !options.runtimeRoot) {
    throw new Error(
      "Native Claude author factory requires a separate runtime root"
    );
  }
  const identity = options.preflight
    ? options.preflight(env, options.deadlineAt)
    : containerIdentity(options.container as NativeCliContainerConfig);
  Object.assign(env, options.container?.environment);
  const referenceHashes = Object.fromEntries(
    Object.entries(options.referenceImages).map(([name, image]) => [
      name,
      createHash("sha256").update(image).digest("hex"),
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
  let identityWritten = false;
  const writeIdentity = () => {
    if (identityWritten) {
      return;
    }
    writeFileSync(
      path.join(options.out, "native-claude-author.json"),
      JSON.stringify(
        {
          actualCliVersion: identity.cliVersion,
          authMethod: identity.authMethod,
          billing: "subscription",
          concept: options.concept,
          craftApproved: false,
          executable: identity.executable,
          executableSha256: identity.executableSha256,
          instrumentQualified: false,
          mechanism: "experimental-native-structured-author",
          referenceHashes,
          repairRenderedCandidateInput: false,
          requestedEffort: effort,
          requestedModel: STRUCTURED_AUTHOR_MODEL,
          selfInspection: true,
        },
        null,
        2
      )
    );
    identityWritten = true;
  };
  const review = options.review ?? reviewImages;
  let stage = 0;
  const stageOut = (name: string, create = true) => {
    writeIdentity();
    const ordinal = stage;
    const out = path.join(
      options.out,
      `${String(ordinal).padStart(2, "0")}-${name}`
    );
    const runtimeCwd = path.join(
      options.runtimeRoot ?? options.out,
      `${String(ordinal).padStart(2, "0")}-${name}`
    );
    stage += 1;
    if (create) {
      mkdirSync(out);
    }
    return { name, ordinal, out, runtimeCwd };
  };
  const invoke = (
    request: StructuredInvocation,
    call: { name: string; ordinal: number; out: string; runtimeCwd: string }
  ) => {
    if (options.invoke) {
      return options.invoke(request);
    }
    if (!options.containerFactory) {
      throw new Error(
        "Native Claude author requires a call-scoped container factory"
      );
    }
    const { config } = options.containerFactory.create({
      cwd: call.runtimeCwd,
      deadlineAt: options.deadlineAt,
      ordinal: call.ordinal,
      stageKind: call.name,
    });
    return invokeNativeClaude({ ...request, out: call.runtimeCwd }, config);
  };
  return {
    construct: (
      request: Parameters<StructuredAuthorOptions["construct"]>[0]
    ) => {
      const call = stageOut(request.stage);
      const { out } = call;
      const constructionDeadlineAt = request.deadlineAt;
      if (Date.now() >= constructionDeadlineAt) {
        throw new Error(
          "Structured construction cannot consume final stage reserve"
        );
      }
      const prompt = `${request.prompt}\nIntended concept: ${options.concept}. Return only editable Iconsmith constrained DSL programs in the schema. Never emit SVG, raw path data, or prose. The host parser and checker are authoritative. Previous host-valid programs: ${JSON.stringify(request.previousPrograms)}. Host-observed defects permitted for this repair: ${JSON.stringify(request.defects)}.`;
      writeFileSync(
        path.join(out, "request.json"),
        JSON.stringify(
          {
            effort,
            model: STRUCTURED_AUTHOR_MODEL,
            prompt,
            schema: constructionJsonSchema,
            stageDeadlineAt: constructionDeadlineAt,
            visualReferences: referenceHashes,
          },
          null,
          2
        )
      );
      return invoke(
        {
          command: identity.executable,
          deadlineAt: constructionDeadlineAt,
          effort,
          env,
          images: options.referenceImages,
          out,
          prompt,
          schema: constructionJsonSchema,
        },
        call
      );
    },
    finalize: (request: Parameters<StructuredAuthorOptions["finalize"]>[0]) => {
      const call = stageOut("finalize");
      const { out } = call;
      const prompt = `Write the final author review only. You cannot change or return geometry. Report representation uncertainty separately from visible defects. Inspection: ${JSON.stringify(request.inspection)}. Program hashes: ${JSON.stringify(request.programHashes)}.`;
      writeFileSync(
        path.join(out, "request.json"),
        JSON.stringify(
          {
            effort,
            model: STRUCTURED_AUTHOR_MODEL,
            prompt,
            schema: finalReviewJsonSchema,
          },
          null,
          2
        )
      );
      return invoke(
        {
          command: identity.executable,
          deadlineAt: request.deadlineAt,
          effort,
          env,
          out,
          prompt,
          schema: finalReviewJsonSchema,
        },
        call
      );
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
      const call = stageOut("author-self-review", false);
      const result = await review({
        deadlineAt: request.deadlineAt,
        images,
        nativeCall: options.containerFactory
          ? {
              containerFactory: options.containerFactory,
              ordinal: call.ordinal,
              parentDeadlineAt: options.deadlineAt,
              runtimeCwd: call.runtimeCwd,
              stageKind: call.name,
            }
          : undefined,
        out: call.out,
        questions: Object.keys(request.proofs).map((finish) => ({
          choices: ["pass", "fail", "uncertain"],
          id: `author-self-review-${finish}`,
          prompt: `Assess intended ${options.concept} in ${finish}-proof.png against the supplied family anchors. Choose pass only when no observed or uncertain visible geometry, meaning, native legibility, or paint-consistency defect remains; choose fail for a named observed defect; choose uncertain for a specific unresolved visual doubt. This is author self-review and not independent qualification.`,
        })),
      });
      if (result.status !== "complete" || !result.answers) {
        throw new Error("Author self-review did not inspect every exact proof");
      }
      const defects = Object.entries(result.answers).flatMap(([id, answer]) => {
        const finish = id.replace("author-self-review-", "");
        return answer.choice === "fail"
          ? [
              {
                description: answer.evidence,
                finish,
                id,
                kind: "visual" as const,
                treatment:
                  answer.treatment || "Repair only the named visible region.",
              },
            ]
          : [];
      });
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

export const runNativeClaudeStructuredAuthor = (
  options: Omit<StructuredAuthorOptions, "construct" | "finalize" | "inspect"> &
    NativeClaudeAuthorAdapterOptions
) => {
  const adapters = nativeClaudeAuthorAdapters(options);
  return runStructuredAuthor({ ...options, ...adapters });
};

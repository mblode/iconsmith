/** Runnable native-Claude adapters for the opt-in structured-author contender. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { subscriptionEnv } from "../src/pipeline/harness.js";
import { runOwnedProcess } from "./local-process.js";
import { reviewImages } from "./local-review.js";
import {
  runStructuredAuthor,
  STRUCTURED_AUTHOR_MODEL,
} from "./local-structured-author.js";
import type { StructuredAuthorOptions } from "./local-structured-author.js";
import { executableIdentity, resolveExecutable } from "./runtime-identity.js";

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
  authMethod: "claude.ai";
  cliVersion: string;
  executable: string;
  executableSha256: string;
  loggedIn: true;
}

const nativePreflight = (
  env: NodeJS.ProcessEnv,
  deadlineAt: number
): PreflightIdentity => {
  const command = resolveExecutable("claude", env.PATH);
  const timeout = () => Math.max(1, Math.min(10_000, deadlineAt - Date.now()));
  const auth = spawnSync(command, ["auth", "status"], {
    encoding: "utf-8",
    env,
    timeout: timeout(),
  });
  let authJson: unknown = null;
  try {
    authJson = auth.status === 0 ? JSON.parse(auth.stdout) : null;
  } catch {
    authJson = null;
  }
  const parsed = z
    .object({ authMethod: z.literal("claude.ai"), loggedIn: z.literal(true) })
    .safeParse(authJson);
  const executable = executableIdentity(command, env);
  if (Date.now() >= deadlineAt || !parsed.success || !executable.version) {
    throw new Error(
      "Native Claude subscription login and CLI identity are required"
    );
  }
  return {
    ...parsed.data,
    cliVersion: executable.version,
    executable: executable.executable,
    executableSha256: executable.sha256,
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

const invokeNativeClaude = async (options: StructuredInvocation) => {
  const remaining = options.deadlineAt - Date.now();
  if (remaining <= 0) {
    throw new Error("Claude author deadline exhausted");
  }
  const inputPath = path.join(options.out, ".claude-input.jsonl");
  writeFileSync(inputPath, claudeStreamInput(options.prompt, options.images));
  let result;
  try {
    result = await runOwnedProcess({
      args: [
        fileURLToPath(
          new URL("local-claude-stream-bridge.ts", import.meta.url)
        ),
        inputPath,
        options.command,
        ...claudeStructuredArgs(options.schema, options.effort),
      ],
      command: process.execPath,
      cwd: options.out,
      env: options.env,
      maxBuffer: 12 * 1024 * 1024,
      timeoutMs: remaining,
    });
  } finally {
    unlinkSync(inputPath);
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
}

export const nativeClaudeAuthorAdapters = (
  options: NativeClaudeAuthorAdapterOptions
) => {
  const env = subscriptionEnv(options.env ?? process.env);
  const effort = options.effort ?? "high";
  if (!options.concept.trim()) {
    throw new Error("Native structured author requires an intended concept");
  }
  const identity = (options.preflight ?? nativePreflight)(
    env,
    options.deadlineAt
  );
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
  const invoke = options.invoke ?? invokeNativeClaude;
  const review = options.review ?? reviewImages;
  let stage = 0;
  const stageOut = (name: string, create = true) => {
    writeIdentity();
    const directory = path.join(
      options.out,
      `${String(stage).padStart(2, "0")}-${name}`
    );
    stage += 1;
    if (create) {
      mkdirSync(directory);
    }
    return directory;
  };
  return {
    construct: (
      request: Parameters<StructuredAuthorOptions["construct"]>[0]
    ) => {
      const out = stageOut(request.stage);
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
      return invoke({
        command: identity.executable,
        deadlineAt: constructionDeadlineAt,
        effort,
        env,
        images: options.referenceImages,
        out,
        prompt,
        schema: constructionJsonSchema,
      });
    },
    finalize: (request: Parameters<StructuredAuthorOptions["finalize"]>[0]) => {
      const out = stageOut("finalize");
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
      return invoke({
        command: identity.executable,
        deadlineAt: request.deadlineAt,
        effort,
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
        deadlineAt: request.deadlineAt,
        images,
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

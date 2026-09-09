/** Native Astra adapter for the shared host-orchestrated structured lifecycle. */
import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import { subscriptionEnv } from "../src/pipeline/harness.js";
import { prepareContainedCodexContext } from "./local-author-context.js";
import { readAuthorTrace } from "./local-author-evidence.js";
import {
  constructionJsonSchema,
  finalReviewJsonSchema,
} from "./local-claude-author.js";
import { reviewImagesWithCodex } from "./local-codex-review.js";
import {
  runNativeContainerCommand,
  validateCodexContainerAssets,
  validateHostVisibleContainerState,
} from "./local-container-runtime.js";
import type { NativeCliContainerConfig } from "./local-container-runtime.js";
import type {
  AdapterTraceBinding,
  NativeCallContainerFactory,
  NativeCallContainerAllocation,
  VerifiedInterruptedNativeCall,
} from "./local-native-call-factory.js";
import { validateNativeCodexTrace } from "./local-native-trace.js";
import { runStructuredAuthor } from "./local-structured-author.js";
import type {
  CollectorSealedStructuredAuthorCall,
  CollectorSealedStructuredInspectionCall,
  StructuredAuthorOptions,
  StructuredFinalizationEnvelope,
} from "./local-structured-author.js";

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
  loggedIn: boolean;
}
export interface Invocation {
  deadlineAt: number;
  env: NodeJS.ProcessEnv;
  images?: Readonly<Record<string, Uint8Array>>;
  out: string;
  prompt: string;
  schema: object;
}
export interface NativeAstraContainedInvocationControl {
  allowInterruptedFinalization: boolean;
  collector?: {
    persist: NativeCallContainerAllocation["persistValidatedAdapterTrace"];
    request: string;
    role: "construct" | "repair" | "finalizer";
  };
  verifyInterruptedSettlement?: () => VerifiedInterruptedNativeCall;
}
interface InterruptedInvocationCompletion {
  collectorTrace: AdapterTraceBinding;
  kind: "native-interrupted-invocation-completion";
  settlement: VerifiedInterruptedNativeCall;
  value: unknown;
}
export interface NativeAstraAuthorOptions {
  command?: string;
  container?: NativeCliContainerConfig;
  containerFactory?: NativeCallContainerFactory;
  concept: string;
  deadlineAt: number;
  /** In-memory diagnostic switch; the factory must also own the opaque capability. */
  enableDiagnosticFinalizationInterruption?: true;
  env?: NodeJS.ProcessEnv;
  out: string;
  referenceImages: Readonly<Record<string, Uint8Array>>;
  /** Provider-writable call directories, kept outside out receipt paths. */
  runtimeRoot?: string;
  invoke?: (request: Invocation) => Promise<unknown>;
  invokeContained?: (
    request: Invocation,
    container: NativeCliContainerConfig,
    contextArgs: readonly string[],
    control?: NativeAstraContainedInvocationControl
  ) => Promise<unknown>;
  preflight?: (
    env: NodeJS.ProcessEnv,
    deadlineAt: number,
    command: string
  ) => Identity;
  prepareContext?: typeof prepareContainedCodexContext;
  review?: typeof reviewImagesWithCodex;
}
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const writeDurableExclusive = (file: string, value: string) => {
  const descriptor = openSync(file, "wx", 0o600);
  try {
    writeSync(descriptor, value);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const directory = openSync(path.dirname(file), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
};
const containerIdentity = (container: NativeCliContainerConfig): Identity => {
  validateCodexContainerAssets(container);
  validateHostVisibleContainerState(container, "CODEX_HOME");
  return {
    cliVersion: container.nativeCliVersion,
    executable: container.nativeCommand,
    executableSha256: container.nativeExecutableSha256,
    loggedIn: false,
  };
};
export const parseAstraStructuredOutput = (
  stdout: string,
  interrupted = false
) => {
  const events = stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const messages = events.flatMap((event, eventIndex) =>
    event.type === "item.completed" && event.item?.type === "agent_message"
      ? [{ eventIndex, text: event.item.text }]
      : []
  );
  const parsed = messages.flatMap(({ eventIndex, text }, index) => {
    try {
      return [{ eventIndex, index, value: JSON.parse(text) }];
    } catch {
      return [];
    }
  });
  if (parsed.length !== 1 || parsed[0]?.index !== messages.length - 1) {
    throw new Error("Missing unambiguous Astra structured response");
  }
  if (
    interrupted &&
    events
      .slice((parsed[0]?.eventIndex ?? -1) + 1)
      .some(
        (event) =>
          event.type?.startsWith("item.") ||
          event.item?.type === "agent_message"
      )
  ) {
    throw new Error("Astra activity followed interrupted final output");
  }
  return parsed[0].value;
};
export const validateAstraStructuredTrace = (trace: string) => {
  const records = trace
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const sessionId = records.find((record) => record.type === "session_meta")
    ?.payload?.id;
  const validated = validateNativeCodexTrace(trace, {
    expectedModel: ASTRA_STRUCTURED_AUTHOR_MODEL,
    expectedSessionId: typeof sessionId === "string" ? sessionId : "",
  });
  return {
    model: ASTRA_STRUCTURED_AUTHOR_MODEL,
    sessionId: validated.sessionId as string,
  };
};
const astraStructuredResponse = (stdout: string, interrupted: boolean) => {
  const events = stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const messages = events.flatMap((event, eventIndex) =>
    event.type === "item.completed" && event.item?.type === "agent_message"
      ? [{ eventIndex, text: event.item.text }]
      : []
  );
  const parsed = messages.flatMap(({ eventIndex, text }, index) => {
    if (typeof text !== "string") {
      return [];
    }
    try {
      return [{ eventIndex, index, text, value: JSON.parse(text) }];
    } catch {
      return [];
    }
  });
  if (parsed.length !== 1 || parsed[0]?.index !== messages.length - 1) {
    throw new Error("Missing unambiguous Astra structured response");
  }
  if (
    interrupted &&
    events
      .slice((parsed[0]?.eventIndex ?? -1) + 1)
      .some(
        (event) =>
          event.type?.startsWith("item.") ||
          event.item?.type === "agent_message"
      )
  ) {
    throw new Error("Astra activity followed interrupted final output");
  }
  return parsed[0];
};
export const validateAstraCollectorRequest = (
  requestBytes: string,
  invocation: Invocation,
  emittedModel: string
) => {
  let intendedRequest: unknown;
  try {
    intendedRequest = JSON.parse(requestBytes);
  } catch {
    throw new Error("Astra collector request is not valid JSON");
  }
  const expectedReferences = Object.fromEntries(
    Object.entries(invocation.images ?? {}).map(([name, bytes]) => [
      name,
      digest(bytes),
    ])
  );
  if (
    typeof intendedRequest !== "object" ||
    intendedRequest === null ||
    !("model" in intendedRequest) ||
    intendedRequest.model !== emittedModel ||
    !("prompt" in intendedRequest) ||
    intendedRequest.prompt !== invocation.prompt ||
    !("schema" in intendedRequest) ||
    JSON.stringify(intendedRequest.schema) !==
      JSON.stringify(invocation.schema) ||
    !("stageDeadlineAt" in intendedRequest) ||
    intendedRequest.stageDeadlineAt !== invocation.deadlineAt ||
    (Object.keys(expectedReferences).length > 0 &&
      (!("visualReferences" in intendedRequest) ||
        JSON.stringify(intendedRequest.visualReferences) !==
          JSON.stringify(expectedReferences)))
  ) {
    throw new Error("Astra collector request did not bind the invocation");
  }
};
const invokeNative = async (
  request: Invocation,
  container: NativeCliContainerConfig,
  contextArgs: readonly string[],
  control?: NativeAstraContainedInvocationControl
) => {
  const invocationControl = control ?? { allowInterruptedFinalization: false };
  if (Date.now() >= request.deadlineAt) {
    throw new Error("Astra deadline exhausted before context preparation");
  }
  const cwd = request.out;
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
  const result = await runNativeContainerCommand(container, {
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
      ...contextArgs,
      "--output-schema",
      schemaFile,
      ...imageArgs,
      "--",
      noTools,
    ],
    command: container.nativeCommand,
    cwd,
    deadlineAt: request.deadlineAt,
    maxBuffer: 24 * 1024 * 1024,
  });
  writeFileSync(
    path.join(cwd, "process.json"),
    JSON.stringify(result, null, 2)
  );
  const interrupted = result.code !== 0 || result.killed;
  if (interrupted && !invocationControl.allowInterruptedFinalization) {
    throw new Error("Astra structured stage did not complete");
  }
  const settlement = interrupted
    ? invocationControl.verifyInterruptedSettlement?.()
    : undefined;
  if (interrupted && !settlement) {
    throw new Error("Astra interruption lacks verified contained settlement");
  }
  const trace = readAuthorTrace(result.stdout, cwd, {
    ...request.env,
    ...container.environment,
  });
  const emitted = validateAstraStructuredTrace(trace);
  const response = astraStructuredResponse(result.stdout, interrupted);
  const { collector } = invocationControl;
  if (!collector) {
    throw new Error("Astra native invocation lacks collector trace authority");
  }
  validateAstraCollectorRequest(collector.request, request, emitted.model);
  const collectorTrace = collector.persist({
    adapter: "codex-jsonl-v1",
    authorInvocation: {
      emittedSessionId: emitted.sessionId,
      interrupted,
      request: collector.request,
      role: collector.role,
      stdoutSha256: digest(result.stdout),
      structuredResponse: response.text,
    },
    evidenceMode: Object.keys(images).length ? "images" : "sealed-text",
    model: emitted.model,
    orderedAttachments: Object.entries(images).map(([name, bytes]) => ({
      name,
      sha256: digest(bytes),
    })),
    trace,
    traceSha256: digest(trace),
  });
  const { value } = response;
  return settlement
    ? ({
        collectorTrace,
        kind: "native-interrupted-invocation-completion",
        settlement,
        value,
      } satisfies InterruptedInvocationCompletion)
    : ({
        collectorTrace,
        kind: "collector-sealed-structured-author-call-v1",
      } satisfies CollectorSealedStructuredAuthorCall);
};
export const nativeAstraAuthorAdapters = (
  options: NativeAstraAuthorOptions
) => {
  const env = subscriptionEnv(options.env ?? process.env);
  if (!options.concept.trim()) {
    throw new Error("Native structured author requires an intended concept");
  }
  if (
    (!options.invoke || !options.review) &&
    (!options.container || !options.containerFactory)
  ) {
    throw new Error(
      "Native Astra author requires a call-scoped container factory"
    );
  }
  if (options.containerFactory && !options.runtimeRoot) {
    throw new Error(
      "Native Astra author factory requires a separate runtime root"
    );
  }
  const identity = options.preflight
    ? options.preflight(env, options.deadlineAt, options.command ?? "codex")
    : containerIdentity(options.container as NativeCliContainerConfig);
  env.CODEX_COMMAND = identity.executable;
  Object.assign(env, options.container?.environment);
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
  const invoke = async (
    request: Invocation,
    call: { name: string; ordinal: number; out: string; runtimeCwd: string },
    lifecycleRequest: unknown,
    diagnosticFinalization?: {
      finalizedReceiptHash: string;
      inspectionHash: string;
      programHashes: Readonly<Record<string, string>>;
      responseSchemaHash: string;
      stageDeadlineAt: number;
    }
  ) => {
    if (options.invoke) {
      return options.invoke(request);
    }
    if (!options.containerFactory) {
      throw new Error(
        "Native Astra author requires a call-scoped container factory"
      );
    }
    let role: "construct" | "repair" | "finalizer" = "construct";
    if (call.name === "finalize") {
      role = "finalizer";
    } else if (call.name === "repair") {
      role = "repair";
    }
    const requestBytes = readFileSync(
      path.join(
        call.out,
        call.name === "finalize" ? "finalization-request.json" : "request.json"
      ),
      "utf-8"
    );
    const allocation = options.containerFactory.create({
      authorRequestBinding: {
        adapterRequestSha256: digest(requestBytes),
        lifecycleRequest: JSON.stringify(lifecycleRequest),
        lifecycleRequestSha256: digest(JSON.stringify(lifecycleRequest)),
        role,
      },
      cwd: call.runtimeCwd,
      deadlineAt: options.deadlineAt,
      ...(diagnosticFinalization ? { diagnosticFinalization } : {}),
      ordinal: call.ordinal,
      stageKind: call.name,
    });
    const { config } = allocation;
    const prepared = await (
      options.prepareContext ?? prepareContainedCodexContext
    )({
      container: config,
      deadlineAt: request.deadlineAt,
      out: call.runtimeCwd,
    });
    return (options.invokeContained ?? invokeNative)(
      { ...request, out: call.runtimeCwd },
      config,
      prepared.args,
      {
        allowInterruptedFinalization: call.name === "finalize",
        collector: {
          persist: allocation.persistValidatedAdapterTrace,
          request: requestBytes,
          role,
        },
        verifyInterruptedSettlement: allocation.verifyInterruptedSettlement,
      }
    );
  };
  const review = options.review ?? reviewImagesWithCodex;
  return {
    construct: (
      request: Parameters<StructuredAuthorOptions["construct"]>[0]
    ) => {
      const call = stageOut(request.stage);
      const { out } = call;
      const { deadlineAt } = request;
      if (Date.now() >= deadlineAt) {
        throw new Error(
          "Structured construction cannot consume final stage reserve"
        );
      }
      const priorProgramsLabel =
        request.stage === "repair"
          ? "Prior submitted programs (host validity is not implied)"
          : "Prior submitted programs";
      const prompt = `${request.prompt}\nIntended concept: ${options.concept}. Return only editable Iconsmith constrained DSL programs in the schema. Never emit SVG, raw path data, or prose. The host parser and checker are authoritative. ${priorProgramsLabel}: ${JSON.stringify(request.previousPrograms)}. Host-observed defects permitted for this repair: ${JSON.stringify(request.defects)}.`;
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
      return invoke(
        {
          deadlineAt,
          env,
          images: options.referenceImages,
          out,
          prompt,
          schema: astraConstructionJsonSchema,
        },
        call,
        request
      ).then((value) =>
        typeof value === "object" &&
        value !== null &&
        "kind" in value &&
        value.kind === "collector-sealed-structured-author-call-v1"
          ? value
          : normalizeAstraConstruction(value)
      );
    },
    finalize: (request: Parameters<StructuredAuthorOptions["finalize"]>[0]) => {
      const call = stageOut("finalize");
      const { out } = call;
      const prompt = `Write the final author review only. You cannot change or return geometry. Use kind representation only for a demonstrated missing DSL or admitted-part capability already named by a representation defect in Inspection, and preserve that defect id. Uncertain visibility or recognition is evidence uncertainty, not a representation defect; do not add it to unresolved. Inspection: ${JSON.stringify(request.inspection)}. Program hashes: ${JSON.stringify(request.programHashes)}.`;
      const finalizationReceipt = {
        inspection: request.inspection,
        inspectionTraceReceiptSha256: request.inspectionTraceReceiptSha256,
        model: ASTRA_STRUCTURED_AUTHOR_MODEL,
        programHashes: request.programHashes,
        prompt,
        schema: finalReviewJsonSchema,
        stageDeadlineAt: request.deadlineAt,
      };
      const finalizationBytes = `${JSON.stringify(finalizationReceipt, null, 2)}\n`;
      writeDurableExclusive(
        path.join(out, "finalization-request.json"),
        finalizationBytes
      );
      return invoke(
        {
          deadlineAt: request.deadlineAt,
          env,
          out,
          prompt,
          schema: finalReviewJsonSchema,
        },
        call,
        request,
        options.enableDiagnosticFinalizationInterruption
          ? {
              finalizedReceiptHash: digest(finalizationBytes),
              inspectionHash: digest(JSON.stringify(request.inspection)),
              programHashes: request.programHashes,
              responseSchemaHash: digest(JSON.stringify(finalReviewJsonSchema)),
              stageDeadlineAt: request.deadlineAt,
            }
          : undefined
      ).then((value) => {
        if (
          typeof value !== "object" ||
          value === null ||
          !("kind" in value) ||
          value.kind !== "native-interrupted-invocation-completion"
        ) {
          return value;
        }
        const interrupted = value as InterruptedInvocationCompletion;
        if (!interrupted.collectorTrace) {
          return {
            interruption: {
              inspectionHash: digest(JSON.stringify(request.inspection)),
              kind: "structured-finalization-interruption",
              programHashes: request.programHashes,
              settlement: interrupted.settlement,
              stageDeadlineAt: request.deadlineAt,
            },
            kind: "structured-finalization-envelope",
            review: interrupted.value,
          } satisfies StructuredFinalizationEnvelope;
        }
        return {
          collectorTrace: interrupted.collectorTrace,
          interruption: {
            inspectionHash: digest(JSON.stringify(request.inspection)),
            kind: "structured-finalization-interruption",
            programHashes: request.programHashes,
            settlement: interrupted.settlement,
            stageDeadlineAt: request.deadlineAt,
          },
          kind: "collector-sealed-structured-author-call-v1",
        } satisfies CollectorSealedStructuredAuthorCall;
      });
    },
    inspect: async (
      request: Parameters<StructuredAuthorOptions["inspect"]>[0]
    ) => {
      if (!request.collectorRequestId || !request.lifecycleRequestSha256) {
        throw new Error(
          "Native Astra inspection requires a collector lifecycle identity"
        );
      }
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
        command: identity.executable,
        deadlineAt: request.deadlineAt,
        images,
        model: ASTRA_STRUCTURED_AUTHOR_MODEL,
        nativeCall: options.containerFactory
          ? {
              containerFactory: options.containerFactory,
              inspectionLifecycle: {
                collectorRequestId: request.collectorRequestId,
                lifecycleRequestSha256: request.lifecycleRequestSha256,
                programHashes: request.programHashes,
                proofHashes: request.proofHashes,
              },
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
      if (!result.collectorInspectionTrace) {
        if (options.containerFactory) {
          throw new Error(
            "Author self-review lacks a collector inspection seal"
          );
        }
        const defects: {
          description: string;
          finish: string;
          id: string;
          kind: "representation" | "visual";
          treatment: string;
        }[] = [];
        const uncertainties: {
          description: string;
          finish: string;
          id: string;
          kind: "evidence";
          treatment: string;
        }[] = [];
        for (const finish of Object.keys(request.proofs)) {
          const answer = result.answers[`author-self-review-${finish}`];
          if (!answer) {
            throw new Error(
              `Author self-review omitted the ${finish} proof answer`
            );
          }
          if (answer.choice === "fail") {
            defects.push({
              description: answer.evidence,
              finish,
              id: `author-self-review-${finish}`,
              kind: "visual",
              treatment: answer.treatment,
            });
          } else if (answer.choice === "uncertain") {
            uncertainties.push({
              description: answer.evidence,
              finish,
              id: `author-self-review-${finish}`,
              kind: "evidence",
              treatment: answer.treatment,
            });
          }
        }
        return {
          defects,
          inspectionEvidence: "Unsealed diagnostic Astra self-review.",
          uncertainties,
        };
      }
      return {
        collectorTrace: result.collectorInspectionTrace,
        kind: "collector-sealed-structured-inspection-v1",
      } satisfies CollectorSealedStructuredInspectionCall;
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

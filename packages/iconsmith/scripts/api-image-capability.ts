import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { createGateway } from "@ai-sdk/gateway";
import type { GatewayGenerationInfo } from "@ai-sdk/gateway";
import { generateObject } from "ai";
import sharp from "sharp";
import { z } from "zod";

import type { UsageLike } from "../src/pipeline/cost.js";
import {
  EMPTY_USAGE,
  exceedsCostBudget,
  rateFor,
  tokenUsageOf,
  usdOf,
} from "../src/pipeline/cost.js";
import { gatewayToken, resolveModel } from "../src/pipeline/gateway.js";
import { writeDurableJson } from "./durable-json.js";

export const API_CAPABILITY_MODEL = "google/gemini-3.7-flash";
export const API_CAPABILITY_ROUTE_IDENTITY =
  "gateway-routing-generation-info-and-stop-v3";
const API_CAPABILITY_METADATA_RESERVE_MS = 15_000;
export const API_CAPABILITY_METADATA_MAX_CALLS = 1;
export const API_CAPABILITY_METADATA_MAX_RESPONSE_BYTES = 65_536;
export const API_CAPABILITY_METADATA_POLICY_VERSION =
  "gateway-generation-info-diagnostics-v1";
export const API_CAPABILITY_RESPONSE_MODEL = "gemini-3.7-flash";
export const API_CAPABILITY_PROVIDER = "google";
export const API_CAPABILITY_PRICING_EVIDENCE_SHA256 =
  "761f3fcd8cd7d953c03cffa54ad65dd6244fecf366bff34bfc88b2e580073d36";
export const API_CAPABILITY_PRICING_VALID_FROM = Date.UTC(2026, 8, 8, 14);
export const API_CAPABILITY_PRICING_VALID_BEFORE = Date.UTC(2026, 8, 9, 14);
export const API_CAPABILITY_DEADLINE_MS = 120_000;
export const API_CAPABILITY_MAX_OUTPUT_TOKENS = 512;
export const API_CAPABILITY_MAX_INPUT_TOKENS = 1_048_576;
const API_CAPABILITY_MAX_PROMPT_BYTES = 2048;
const API_CAPABILITY_MAX_IMAGE_PX = 384;
const API_CAPABILITY_IMAGE_TOKENS = 258;
const API_CAPABILITY_RATE = { input: 0.75, output: 3.75 } as const;
export const API_CAPABILITY_MAX_USD = 0.788352;
const API_CAPABILITY_PROMPT =
  "Describe the single icon in one ordinary lower-case noun. Return unknown only when no ordinary object is recognizable.";
const API_CAPABILITY_SCHEMA_ID = "iconsmith-api-image-capability-response-v1";
export const API_CAPABILITY_TRANSPORT_USER_AGENT = "ai/7.0.68";

const API_COLLECTOR_STAGE_SCHEMA_ID =
  "iconsmith-api-collector-stage-response-v1";
export const API_COLLECTOR_STAGE_DESCRIPTOR_KIND =
  "iconsmith-api-collector-stage-descriptor-v1";
const API_COLLECTOR_METADATA_WAIT_MS = 25_000;
const API_COLLECTOR_METADATA_RESERVE_MS = 40_000;
const API_COLLECTOR_STAGE_MAX_ATTACHMENTS = 8;
const API_COLLECTOR_STAGE_MAX_IMAGE_PX = 2048;
export const API_COLLECTOR_STAGE_MAX_OUTPUT_TOKENS = 2048;
const API_COLLECTOR_STAGE_MAX_PROMPT_BYTES = 16_384;
export const API_COLLECTOR_STAGE_MAX_USD = 0.794112;
export const API_COLLECTOR_STAGE_ACTOR = Object.freeze({
  baseModelLineage: API_CAPABILITY_MODEL,
  model: API_CAPABILITY_RESPONSE_MODEL,
  provider: API_CAPABILITY_PROVIDER,
});
export const API_COLLECTOR_ROUTE_HASH = createHash("sha256")
  .update(
    JSON.stringify({
      metadataReserveMs: API_COLLECTOR_METADATA_RESERVE_MS,
      metadataWaitMs: API_COLLECTOR_METADATA_WAIT_MS,
      model: API_CAPABILITY_MODEL,
      provider: API_CAPABILITY_PROVIDER,
      responseModel: API_CAPABILITY_RESPONSE_MODEL,
      routeIdentityVersion: API_CAPABILITY_ROUTE_IDENTITY,
      schemaId: API_COLLECTOR_STAGE_SCHEMA_ID,
    })
  )
  .digest("hex");

const HEX = /^[a-f0-9]{64}$/u;
const responseSchema = z
  .object({
    description: z.string().min(1).max(64),
    unknown: z.boolean(),
  })
  .strict();

interface ApiImageCapabilityGeneratorInput {
  abortSignal: AbortSignal;
  image: Buffer;
  maxOutputTokens: number;
  maxRetries: number;
  messages: [
    {
      content: [
        { text: string; type: "text" },
        { data: Buffer; mediaType: "image/png"; type: "file" },
      ];
      role: "user";
    },
  ];
  model: ReturnType<typeof resolveModel>;
  providerOptions: { gateway: { only: ["google"]; order: ["google"] } };
  schema: typeof responseSchema;
  temperature: number;
}

export interface ApiImageCapabilityGeneratorResult {
  finishReason: string;
  object: z.infer<typeof responseSchema>;
  providerMetadata?: unknown;
  request: unknown;
  response: {
    body?: unknown;
    headers?: Record<string, string>;
    id: string;
    modelId: string;
  };
  usage: UsageLike;
  warnings?: readonly unknown[];
}

export type ApiImageCapabilityGenerator = (
  input: ApiImageCapabilityGeneratorInput
) => Promise<ApiImageCapabilityGeneratorResult>;

export interface ApiImageCapabilityOptions {
  deadlineAt: number;
  evidenceDirectory: string;
  expectedImageSha256: string;
  expectedLabel: string;
  generate?: ApiImageCapabilityGenerator;
  imageFile: string;
  getGenerationInfo?: (input: {
    id: string;
    abortSignal: AbortSignal;
  }) => Promise<GatewayGenerationInfo>;
  now?: () => number;
  resolve?: (model: string) => ReturnType<typeof resolveModel>;
  reservedMaxUsd: number;
  startedAt: number;
  stopFile: string;
}

interface ApiCollectorStageQuestion {
  choices: readonly string[];
  id: string;
  prompt: string;
}

interface ApiCollectorStageAttachment {
  file: string;
  name: string;
  sha256: string;
}

export interface ApiCollectorStageDescriptorV1 {
  actor: typeof API_COLLECTOR_STAGE_ACTOR;
  descriptorFile: string;
  instrumentHash: string;
  kind: typeof API_COLLECTOR_STAGE_DESCRIPTOR_KIND;
  orderedAttachments: readonly ApiCollectorStageAttachment[];
  originalDeadlineAt: number;
  questions: readonly ApiCollectorStageQuestion[];
  requestId: string;
  role: "panel" | "prediction";
  routeHash: typeof API_COLLECTOR_ROUTE_HASH;
  schemaVersion: 1;
  stageDeadlineAt: number;
}

interface ApiCollectorAnswer {
  choice: string;
  evidence: string;
  treatment: string;
}

type ApiCollectorAnswerMap = Record<string, ApiCollectorAnswer>;

export interface ApiCollectorStageGeneratorInput {
  abortSignal: AbortSignal;
  maxOutputTokens: number;
  maxRetries: number;
  messages: [
    {
      content: (
        | { data: Buffer; mediaType: "image/png"; type: "file" }
        | { text: string; type: "text" }
      )[];
      role: "user";
    },
  ];
  model: ReturnType<typeof resolveModel>;
  providerOptions: { gateway: { only: ["google"]; order: ["google"] } };
  schema: z.ZodType<ApiCollectorAnswerMap>;
  temperature: number;
}

interface ApiCollectorStageGeneratorResult extends Omit<
  ApiImageCapabilityGeneratorResult,
  "object"
> {
  object: ApiCollectorAnswerMap;
}

export type ApiCollectorStageGenerator = (
  input: ApiCollectorStageGeneratorInput
) => Promise<ApiCollectorStageGeneratorResult>;

export interface ApiCollectorStageOptions {
  deadlineAt?: never;
  descriptorFile: string;
  descriptorSha256: string;
  evidenceDirectory: string;
  generate?: ApiCollectorStageGenerator;
  getGenerationInfo?: ApiImageCapabilityOptions["getGenerationInfo"];
  now?: () => number;
  reservedMaxUsd: number;
  resolve?: ApiImageCapabilityOptions["resolve"];
  startedAt: number;
  stopFile: string;
}

export type ApiCollectorStageFileBinding = Readonly<{
  file: string;
  sha256: string;
}>;

export interface ApiCollectorStageEvidenceBindings {
  descriptor: ApiCollectorStageFileBinding;
  generationInfo: ApiCollectorStageFileBinding;
  intent: ApiCollectorStageFileBinding;
  request: ApiCollectorStageFileBinding;
  result: ApiCollectorStageFileBinding;
  terminal: ApiCollectorStageFileBinding;
}

type ApiCollectorStageTransportAuthority =
  | "installed-production-transport"
  | "offline-test-only";

export interface ApiCollectorStageSealedSummary {
  actor: typeof API_COLLECTOR_STAGE_ACTOR;
  answersHash: string;
  evidence: ApiCollectorStageEvidenceBindings;
  instrumentHash: string;
  orderedAttachments: readonly Readonly<{
    name: string;
    sha256: string;
  }>[];
  originalDeadlineAt: number;
  outputSha256: string;
  promptSha256: string;
  requestId: string;
  role: "panel" | "prediction";
  routeHash: typeof API_COLLECTOR_ROUTE_HASH;
  settledAt: number;
  stageDeadlineAt: number;
  startedAt: number;
  transportAuthority: ApiCollectorStageTransportAuthority;
  usage: ReturnType<typeof tokenUsageOf>;
}

declare const API_COLLECTOR_CAPABILITY: unique symbol;
export type ApiCollectorStageCapability = Readonly<{
  [API_COLLECTOR_CAPABILITY]: true;
}>;

export interface ApiCollectorStageVerificationExpectation {
  actor: typeof API_COLLECTOR_STAGE_ACTOR;
  instrumentHash: string;
  orderedAttachments: readonly Readonly<{
    name: string;
    sha256: string;
  }>[];
  originalDeadlineAt: number;
  outputSha256: string;
  promptSha256?: string;
  requestId: string;
  role: "panel" | "prediction";
  routeHash: typeof API_COLLECTOR_ROUTE_HASH;
  stageDeadlineAt: number;
}

export interface VerifiedApiCollectorStageEvidence extends ApiCollectorStageSealedSummary {
  answers: Readonly<ApiCollectorAnswerMap>;
}

type ApiCapabilityMetadataFailureClassification =
  | "aborted"
  | "deadline"
  | "http-error"
  | "response-too-large"
  | "sdk-invalid-response"
  | "transport-error"
  | "unknown";

export interface ApiCapabilityMetadataFailure {
  bodyBytes: number | null;
  bodySha256: string | null;
  classification: ApiCapabilityMetadataFailureClassification;
  httpStatus: number | null;
}

interface ApiCapabilityMetadataResponseObservation {
  bodyBytes: number;
  bodySha256: string | null;
  httpStatus: number;
}

class ApiCapabilityMetadataLookupError extends Error {
  readonly failure: ApiCapabilityMetadataFailure;

  constructor(failure: ApiCapabilityMetadataFailure) {
    super("API capability metadata lookup failed");
    this.name = "ApiCapabilityMetadataLookupError";
    this.failure = failure;
  }
}

const hashBytes = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new Error("API capability serialized request is not JSON");
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

// AI SDK defines request.body as the HTTP body sent to the provider API. The
// model route itself is carried separately and remains bound by assertExactRoute.
const expectedSerializedRequestBody = (image: Buffer) => ({
  headers: { "user-agent": API_CAPABILITY_TRANSPORT_USER_AGENT },
  maxOutputTokens: API_CAPABILITY_MAX_OUTPUT_TOKENS,
  prompt: [
    {
      content: [
        { text: API_CAPABILITY_PROMPT, type: "text" },
        {
          data: { data: image.toString("base64"), type: "data" },
          mediaType: "image/png",
          type: "file",
        },
      ],
      role: "user",
    },
  ],
  providerOptions: {
    gateway: {
      only: [API_CAPABILITY_PROVIDER],
      order: [API_CAPABILITY_PROVIDER],
    },
  },
  responseFormat: {
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      additionalProperties: false,
      properties: {
        description: { maxLength: 64, minLength: 1, type: "string" },
        unknown: { type: "boolean" },
      },
      required: ["description", "unknown"],
      type: "object",
    },
    type: "json",
  },
  temperature: 0,
});

// Compare JSON wire values: the installed SDK retains undefined optional fields
// and property insertion order in memory, neither of which changes the request.
const serializedRequestBodySha256 = (request: unknown) =>
  // JSON wire normalization is intentional; structuredClone retains undefined.
  // oxlint-disable-next-line unicorn/prefer-structured-clone
  hashBytes(canonicalJson(JSON.parse(JSON.stringify(request))));

const assertSerializedRequest = (
  request: unknown,
  expectedSha256: string
): string => {
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).length !== 1 ||
    !("body" in request)
  ) {
    throw new Error("API capability serialized request is invalid");
  }
  let actualSha256: string;
  try {
    actualSha256 = serializedRequestBodySha256(
      (request as { body: unknown }).body
    );
  } catch {
    throw new Error("API capability serialized request is invalid");
  }
  if (actualSha256 !== expectedSha256) {
    throw new Error("API capability serialized request identity drifted");
  }
  return actualSha256;
};

const ownedDirectory = (directory: string) => {
  if (!path.isAbsolute(directory)) {
    throw new Error("API capability evidence directory must be absolute");
  }
  if (!existsSync(directory)) {
    mkdirSync(directory, { mode: 0o700, recursive: false });
  }
  const metadata = lstatSync(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    realpathSync(directory) !== path.resolve(directory)
  ) {
    throw new Error("API capability evidence directory must be owned");
  }
};

const ownedFile = (file: string) => {
  if (!path.isAbsolute(file)) {
    throw new Error("API capability image path must be absolute");
  }
  const metadata = lstatSync(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    realpathSync(file) !== path.resolve(file)
  ) {
    throw new Error("API capability image must be an owned regular file");
  }
};

const assertStopBoundary = (stopFile: string, evidenceDirectory: string) => {
  if (!path.isAbsolute(stopFile)) {
    throw new Error("API capability STOP path must be absolute");
  }
  const parent = path.dirname(stopFile);
  const parentMetadata = lstatSync(parent);
  if (
    !parentMetadata.isDirectory() ||
    parentMetadata.isSymbolicLink() ||
    realpathSync(parent) !== path.resolve(parent)
  ) {
    throw new Error("API capability STOP parent must be owned");
  }
  const relative = path.relative(evidenceDirectory, stopFile);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  ) {
    throw new Error("API capability STOP must be outside evidence output");
  }
  if (existsSync(stopFile)) {
    const metadata = lstatSync(stopFile);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      realpathSync(stopFile) !== path.resolve(stopFile)
    ) {
      throw new Error("API capability STOP must be an owned regular file");
    }
  }
};

type ApiCapabilityStopOptions = Pick<
  ApiImageCapabilityOptions,
  "evidenceDirectory" | "now" | "stopFile"
>;

const observeStop = (
  options: ApiCapabilityStopOptions,
  intentSha256: string
) => {
  const latchFile = path.join(options.evidenceDirectory, "stopped.json");
  if (existsSync(latchFile)) {
    return true;
  }
  if (!existsSync(options.stopFile)) {
    return false;
  }
  assertStopBoundary(options.stopFile, options.evidenceDirectory);
  writeDurableJson(latchFile, {
    intentSha256,
    kind: "iconsmith-api-image-capability-stop-v1",
    observedAt: (options.now ?? Date.now)(),
    stopFile: options.stopFile,
  });
  return true;
};

const createStopMonitor = (
  options: ApiCapabilityStopOptions,
  intentSha256: string
) => {
  const controller = new AbortController();
  let failure: unknown;
  const inspect = () => {
    try {
      if (observeStop(options, intentSha256)) {
        controller.abort(new Error("API capability stopped by root sentinel"));
      }
    } catch (error) {
      failure = error;
      controller.abort(error);
    }
  };
  inspect();
  const timer = setInterval(inspect, 25);
  timer.unref();
  return {
    close: () => {
      clearInterval(timer);
      inspect();
      if (failure) {
        throw failure;
      }
    },
    signal: controller.signal,
    stopped: () => controller.signal.aborted,
  };
};

const assertFrozenLimits = (
  options: ApiImageCapabilityOptions,
  observedAt: number
) => {
  const rate = rateFor(API_CAPABILITY_MODEL);
  const maximum = usdOf(
    {
      ...EMPTY_USAGE,
      inputTokens: API_CAPABILITY_MAX_INPUT_TOKENS,
      outputTokens: API_CAPABILITY_MAX_OUTPUT_TOKENS,
    },
    {
      cacheRead: API_CAPABILITY_RATE.input * 0.1,
      cacheWrite: API_CAPABILITY_RATE.input * 1.25,
      ...API_CAPABILITY_RATE,
    }
  );
  if (
    !rate ||
    rate.input !== API_CAPABILITY_RATE.input ||
    rate.output !== API_CAPABILITY_RATE.output ||
    maximum !== API_CAPABILITY_MAX_USD ||
    options.reservedMaxUsd !== API_CAPABILITY_MAX_USD ||
    options.startedAt < API_CAPABILITY_PRICING_VALID_FROM ||
    options.startedAt >= API_CAPABILITY_PRICING_VALID_BEFORE
  ) {
    throw new Error("API capability price or reservation identity drifted");
  }
  if (
    !Number.isSafeInteger(options.startedAt) ||
    !Number.isSafeInteger(options.deadlineAt) ||
    options.deadlineAt - options.startedAt !== API_CAPABILITY_DEADLINE_MS ||
    observedAt < options.startedAt ||
    observedAt >= options.deadlineAt
  ) {
    throw new Error("API capability original deadline is invalid or expired");
  }
  if (!HEX.test(options.expectedImageSha256)) {
    throw new Error("API capability expected image hash is invalid");
  }
  const expected = options.expectedLabel.trim();
  if (!/^[a-z][a-z -]{0,62}[a-z]$|^[a-z]$/u.test(expected)) {
    throw new Error("API capability expected label is invalid");
  }
  return expected;
};

const knownChargeOf = (metadata: unknown): number | null => {
  if (!(metadata && typeof metadata === "object" && "gateway" in metadata)) {
    return null;
  }
  const { gateway } = metadata as { gateway?: unknown };
  if (!(gateway && typeof gateway === "object")) {
    return null;
  }
  const { cost } = gateway as { cost?: unknown };
  const parsed = typeof cost === "string" ? Number(cost) : cost;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : null;
};

const routingOf = (metadata: unknown) => {
  if (!(metadata && typeof metadata === "object" && "gateway" in metadata)) {
    throw new Error("API capability Gateway metadata is missing");
  }
  const { gateway } = metadata as { gateway?: unknown };
  if (!(gateway && typeof gateway === "object")) {
    throw new Error("API capability Gateway metadata is missing");
  }
  const { routing } = gateway as { routing?: unknown };
  if (!(routing && typeof routing === "object")) {
    throw new Error("API capability routing metadata is missing");
  }
  const parsedCost = knownChargeOf(metadata);
  if (parsedCost === null) {
    throw new Error("API capability exact Gateway charge is unknown");
  }
  return { cost: parsedCost, routing: routing as Record<string, unknown> };
};

const generationIdOf = (metadata: unknown): string | null => {
  if (!(metadata && typeof metadata === "object" && "gateway" in metadata)) {
    return null;
  }
  const { gateway } = metadata as { gateway?: unknown };
  if (!(gateway && typeof gateway === "object")) {
    return null;
  }
  const { generationId } = gateway as { generationId?: unknown };
  return typeof generationId === "string" && generationId.trim()
    ? generationId
    : null;
};

// This explicitly enumerates every route field that can introduce fallback.
// oxlint-disable-next-line eslint/complexity
const assertExactRoute = (
  result: Omit<ApiImageCapabilityGeneratorResult, "object"> & {
    object: unknown;
  },
  deadlineAt: number,
  settledAt: number,
  maxUsd = API_CAPABILITY_MAX_USD
) => {
  const { cost, routing } = routingOf(result.providerMetadata);
  const generationId = generationIdOf(result.providerMetadata);
  const attempts = routing.modelAttempts;
  if (
    settledAt >= deadlineAt ||
    !result.response.id.trim() ||
    generationId === null ||
    routing.originalModelId !== API_CAPABILITY_MODEL ||
    routing.canonicalSlug !== API_CAPABILITY_MODEL ||
    routing.resolvedProvider !== API_CAPABILITY_PROVIDER ||
    (routing.resolvedProviderApiModelId !== undefined &&
      routing.resolvedProviderApiModelId !== API_CAPABILITY_RESPONSE_MODEL) ||
    routing.finalProvider !== API_CAPABILITY_PROVIDER ||
    routing.modelAttemptCount !== 1 ||
    routing.totalProviderAttemptCount !== 1 ||
    !Array.isArray(attempts) ||
    attempts.length !== 1
  ) {
    throw new Error("API capability returned route identity is invalid");
  }
  const [attempt] = attempts;
  if (
    !attempt ||
    typeof attempt !== "object" ||
    (attempt as Record<string, unknown>).canonicalSlug !==
      API_CAPABILITY_MODEL ||
    (attempt as Record<string, unknown>).success !== true ||
    (attempt as Record<string, unknown>).providerAttemptCount !== 1
  ) {
    throw new Error("API capability returned route identity is invalid");
  }
  const { providerAttempts } = attempt as Record<string, unknown>;
  const [providerAttempt] = Array.isArray(providerAttempts)
    ? providerAttempts
    : [];
  if (
    !Array.isArray(providerAttempts) ||
    providerAttempts.length !== 1 ||
    !providerAttempt ||
    typeof providerAttempt !== "object" ||
    (providerAttempt as Record<string, unknown>).provider !==
      API_CAPABILITY_PROVIDER ||
    ((providerAttempt as Record<string, unknown>).providerApiModelId !==
      undefined &&
      (providerAttempt as Record<string, unknown>).providerApiModelId !==
        API_CAPABILITY_RESPONSE_MODEL) ||
    (providerAttempt as Record<string, unknown>).success !== true
  ) {
    throw new Error("API capability used a fallback or unverified provider");
  }
  if (exceedsCostBudget({ calls: 1, usd: cost }, { maxCalls: 1, maxUsd })) {
    throw new Error("API capability charge exceeded its frozen upper bound");
  }
  return { cost, generationId };
};

const emptyMetadataFailure = (
  classification: ApiCapabilityMetadataFailureClassification
): ApiCapabilityMetadataFailure => ({
  bodyBytes: null,
  bodySha256: null,
  classification,
  httpStatus: null,
});

const abortClassification = (
  abortSignal: AbortSignal
): "aborted" | "deadline" =>
  abortSignal.reason instanceof DOMException &&
  abortSignal.reason.name === "TimeoutError"
    ? "deadline"
    : "aborted";

const responseObservation = async (
  response: Response
): Promise<{
  observation: ApiCapabilityMetadataResponseObservation;
  replay: Response;
}> => {
  const reader = response.body?.getReader();
  if (!reader) {
    return {
      observation: {
        bodyBytes: 0,
        bodySha256: hashBytes(Buffer.alloc(0)),
        httpStatus: response.status,
      },
      replay: response,
    };
  }
  const chunks: Buffer[] = [];
  let bodyBytes = 0;
  const readNext = async (): Promise<void> => {
    const item = await reader.read();
    if (item.done) {
      return;
    }
    bodyBytes += item.value.byteLength;
    if (bodyBytes > API_CAPABILITY_METADATA_MAX_RESPONSE_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The diagnostic remains fail-closed if stream cancellation fails.
      }
      throw new ApiCapabilityMetadataLookupError({
        bodyBytes,
        bodySha256: null,
        classification: "response-too-large",
        httpStatus: response.status,
      });
    }
    chunks.push(Buffer.from(item.value));
    await readNext();
  };
  await readNext();
  const body = Buffer.concat(chunks);
  return {
    observation: {
      bodyBytes,
      bodySha256: hashBytes(body),
      httpStatus: response.status,
    },
    replay: new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    }),
  };
};

const observedResponseFailure = (
  observation: ApiCapabilityMetadataResponseObservation | null
): ApiCapabilityMetadataFailure =>
  observation
    ? {
        ...observation,
        classification:
          observation.httpStatus >= 400 ? "http-error" : "sdk-invalid-response",
      }
    : emptyMetadataFailure("transport-error");

export const readApiCapabilityGenerationInfo: NonNullable<
  ApiImageCapabilityOptions["getGenerationInfo"]
> = async ({ id, abortSignal }) => {
  let observedFailure: ApiCapabilityMetadataFailure | null = null;
  let observedResponse: ApiCapabilityMetadataResponseObservation | null = null;
  try {
    return await createGateway({
      apiKey: gatewayToken(),
      fetch: async (url, init) => {
        let response: Response;
        try {
          response = await fetch(url, { ...init, signal: abortSignal });
        } catch {
          throw new ApiCapabilityMetadataLookupError(
            emptyMetadataFailure(
              abortSignal.aborted
                ? abortClassification(abortSignal)
                : "transport-error"
            )
          );
        }
        try {
          const observed = await responseObservation(response);
          observedResponse = observed.observation;
          return observed.replay;
        } catch (error) {
          if (error instanceof ApiCapabilityMetadataLookupError) {
            observedFailure = error.failure;
          }
          throw error;
        }
      },
    }).getGenerationInfo({ id });
  } catch (error) {
    if (error instanceof ApiCapabilityMetadataLookupError) {
      throw error;
    }
    if (observedFailure) {
      throw new ApiCapabilityMetadataLookupError(observedFailure);
    }
    if (abortSignal.aborted) {
      throw new ApiCapabilityMetadataLookupError(
        emptyMetadataFailure(abortClassification(abortSignal))
      );
    }
    throw new ApiCapabilityMetadataLookupError(
      observedResponseFailure(observedResponse)
    );
  }
};

const metadataFailureOf = (
  error: unknown,
  abortSignal: AbortSignal
): ApiCapabilityMetadataFailure => {
  if (error instanceof ApiCapabilityMetadataLookupError) {
    return error.failure;
  }
  return emptyMetadataFailure(
    abortSignal.aborted ? abortClassification(abortSignal) : "unknown"
  );
};

const assertGenerationInfo = (
  info: GatewayGenerationInfo,
  result: Pick<ApiImageCapabilityGeneratorResult, "finishReason" | "usage">,
  generationId: string,
  cost: number
) => {
  const usage = tokenUsageOf(result.usage);
  const counts = [
    result.usage.inputTokens,
    info.promptTokens,
    info.completionTokens,
    info.reasoningTokens,
    info.cachedTokens,
    info.cacheCreationTokens,
  ];
  if (
    counts.some(
      (count) =>
        count === undefined || !Number.isSafeInteger(count) || count < 0
    ) ||
    info.id !== generationId ||
    info.model !== API_CAPABILITY_MODEL ||
    info.providerName !== API_CAPABILITY_PROVIDER ||
    info.totalCost !== cost ||
    info.usage !== cost ||
    info.finishReason !== "stop" ||
    info.streamed !== false ||
    info.isByok !== false ||
    info.billableWebSearchCalls !== 0 ||
    info.promptTokens !== result.usage.inputTokens ||
    info.reasoningTokens !== usage.reasoningTokens ||
    info.completionTokens !== usage.outputTokens - usage.reasoningTokens ||
    info.cachedTokens !== usage.cacheReadTokens ||
    info.cacheCreationTokens !== usage.cacheWriteTokens ||
    !Number.isFinite(Date.parse(info.createdAt))
  ) {
    throw new Error(
      "API capability server generation identity or usage mismatch"
    );
  }
};

const defaultGenerate: ApiImageCapabilityGenerator = async (input) => {
  const result = await generateObject(input);
  return {
    finishReason: result.finishReason,
    object: result.object,
    providerMetadata: result.providerMetadata,
    request: result.request,
    response: {
      body: result.response.body,
      headers: result.response.headers,
      id: result.response.id,
      modelId: result.response.modelId,
    },
    usage: result.usage,
    warnings: result.warnings,
  };
};

// Preflight, one dispatch, and terminal settlement are kept in one boundary.
// oxlint-disable-next-line eslint/complexity
export const runApiImageCapability = async (
  options: ApiImageCapabilityOptions
) => {
  const now = options.now ?? Date.now;
  const observedAt = now();
  ownedDirectory(options.evidenceDirectory);
  assertStopBoundary(options.stopFile, options.evidenceDirectory);
  if (existsSync(path.join(options.evidenceDirectory, "stopped.json"))) {
    throw new Error("API capability STOP is already latched");
  }
  ownedFile(options.imageFile);
  const expectedLabel = assertFrozenLimits(options, observedAt);
  const image = readFileSync(options.imageFile);
  const imageSha256 = hashBytes(image);
  if (imageSha256 !== options.expectedImageSha256) {
    throw new Error("API capability image bytes do not match the frozen hash");
  }
  const metadata = await sharp(image).metadata();
  if (
    metadata.format !== "png" ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > API_CAPABILITY_MAX_IMAGE_PX ||
    metadata.height > API_CAPABILITY_MAX_IMAGE_PX
  ) {
    throw new Error("API capability requires one PNG no larger than 384px");
  }
  if (
    Buffer.byteLength(API_CAPABILITY_PROMPT, "utf-8") >
    API_CAPABILITY_MAX_PROMPT_BYTES
  ) {
    throw new Error("API capability prompt exceeds its frozen byte bound");
  }
  const model = (options.resolve ?? resolveModel)(API_CAPABILITY_MODEL);
  const expectedRequestBodySha256 = serializedRequestBodySha256(
    expectedSerializedRequestBody(image)
  );
  const intent = {
    deadlineAt: options.deadlineAt,
    expectedLabelSha256: hashBytes(expectedLabel),
    image: {
      height: metadata.height,
      path: options.imageFile,
      sha256: imageSha256,
      width: metadata.width,
    },
    inputTokenUpperBound: API_CAPABILITY_MAX_INPUT_TOKENS,
    kind: "iconsmith-api-image-capability-intent-v4",
    maxCalls: 1,
    maxOutputTokens: API_CAPABILITY_MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    maxUsd: API_CAPABILITY_MAX_USD,
    metadataLookupMaxCalls: API_CAPABILITY_METADATA_MAX_CALLS,
    metadataPolicyVersion: API_CAPABILITY_METADATA_POLICY_VERSION,
    metadataReserveMs: API_CAPABILITY_METADATA_RESERVE_MS,
    metadataResponseMaxBytes: API_CAPABILITY_METADATA_MAX_RESPONSE_BYTES,
    model: API_CAPABILITY_MODEL,
    pricingEvidenceSha256: API_CAPABILITY_PRICING_EVIDENCE_SHA256,
    pricingValidBefore: API_CAPABILITY_PRICING_VALID_BEFORE,
    pricingValidFrom: API_CAPABILITY_PRICING_VALID_FROM,
    promptSha256: hashBytes(API_CAPABILITY_PROMPT),
    providerOnly: [API_CAPABILITY_PROVIDER],
    routeIdentityVersion: API_CAPABILITY_ROUTE_IDENTITY,
    schemaId: API_CAPABILITY_SCHEMA_ID,
    serializedRequestBodySha256: expectedRequestBodySha256,
    startedAt: options.startedAt,
    stopFile: options.stopFile,
    upstreamRevision: "undisclosed",
  } as const;
  const intentFile = path.join(options.evidenceDirectory, "intent.json");
  writeDurableJson(intentFile, intent);
  const intentSha256 = hashBytes(readFileSync(intentFile));
  if (observeStop(options, intentSha256)) {
    const terminal = {
      accepted: false,
      attemptedAt: null,
      chargeUsd: null,
      inferenceAttempts: 0,
      intentSha256,
      kind: "iconsmith-api-image-capability-terminal-v3",
      metadataFailureSha256: null,
      metadataLookupAttempts: 0,
      metadataSha256: null,
      metadataState: "unstarted-stopped",
      reason: "API capability stopped by root sentinel",
      resultSha256: null,
      routeIdentityVersion: API_CAPABILITY_ROUTE_IDENTITY,
      settledAt: now(),
      upstreamRevision: "undisclosed",
    };
    writeDurableJson(
      path.join(options.evidenceDirectory, "terminal.json"),
      terminal
    );
    return terminal;
  }
  const attemptedAt = now();
  if (attemptedAt >= options.deadlineAt - API_CAPABILITY_METADATA_RESERVE_MS) {
    const terminal = {
      accepted: false,
      attemptedAt,
      chargeUsd: null,
      inferenceAttempts: 0,
      intentSha256,
      kind: "iconsmith-api-image-capability-terminal-v3",
      metadataLookupAttempts: 0,
      metadataState: "unstarted-deadline",
      reason: "original deadline expired before dispatch",
      routeIdentityVersion: API_CAPABILITY_ROUTE_IDENTITY,
      settledAt: attemptedAt,
      upstreamRevision: "undisclosed",
    };
    writeDurableJson(
      path.join(options.evidenceDirectory, "terminal.json"),
      terminal
    );
    return terminal;
  }
  writeDurableJson(path.join(options.evidenceDirectory, "attempt.json"), {
    attemptedAt,
    intentSha256,
    kind: "iconsmith-api-image-capability-attempt-v1",
  });
  let observedChargeUsd: number | null = null;
  let observedResultSha256: string | null = null;
  let observedGenerationId: string | null = null;
  let observedMetadataFailureSha256: string | null = null;
  let observedMetadataSha256: string | null = null;
  let inferenceAttempts = 0;
  let metadataLookupAttempts = 0;
  let stopObserved = false;
  let metadataState:
    | "settled-complete"
    | "settled-failed"
    | "unstarted-inference-failed"
    | "unstarted-metadata-setup-failed"
    | "unstarted-stopped" = "unstarted-inference-failed";
  try {
    const stopMonitor = createStopMonitor(options, intentSha256);
    let result: ApiImageCapabilityGeneratorResult;
    try {
      if (stopMonitor.stopped()) {
        metadataState = "unstarted-stopped";
        throw new Error("API capability stopped by root sentinel");
      }
      inferenceAttempts = 1;
      result = await (options.generate ?? defaultGenerate)({
        abortSignal: AbortSignal.any([
          AbortSignal.timeout(
            options.deadlineAt -
              attemptedAt -
              API_CAPABILITY_METADATA_RESERVE_MS
          ),
          stopMonitor.signal,
        ]),
        image,
        maxOutputTokens: API_CAPABILITY_MAX_OUTPUT_TOKENS,
        maxRetries: 0,
        messages: [
          {
            content: [
              { text: API_CAPABILITY_PROMPT, type: "text" },
              { data: image, mediaType: "image/png", type: "file" },
            ],
            role: "user",
          },
        ],
        model,
        providerOptions: {
          gateway: {
            only: [API_CAPABILITY_PROVIDER],
            order: [API_CAPABILITY_PROVIDER],
          },
        },
        schema: responseSchema,
        temperature: 0,
      });
    } finally {
      try {
        stopMonitor.close();
      } finally {
        stopObserved = stopMonitor.stopped();
      }
    }
    observedChargeUsd = knownChargeOf(result.providerMetadata);
    observedGenerationId = generationIdOf(result.providerMetadata);
    const generatedAt = now();
    const resultEnvelope = {
      finishReason: result.finishReason,
      kind: "iconsmith-api-image-capability-result-v1",
      object: result.object,
      providerMetadata: result.providerMetadata ?? null,
      request: result.request,
      response: result.response,
      responseModelId: result.response.modelId,
      sdkResponseId: result.response.id,
      sdkUsage: result.usage,
      settledAt: generatedAt,
      usage: tokenUsageOf(result.usage),
      warnings: result.warnings ?? [],
    };
    const resultFile = path.join(options.evidenceDirectory, "result.json");
    writeDurableJson(resultFile, resultEnvelope);
    const resultSha256 = hashBytes(readFileSync(resultFile));
    observedResultSha256 = resultSha256;
    const requestBodySha256 = assertSerializedRequest(
      result.request,
      expectedRequestBodySha256
    );
    if (stopMonitor.stopped()) {
      metadataState = "unstarted-stopped";
      throw new Error("API capability stopped by root sentinel");
    }
    const { cost: chargeUsd, generationId } = assertExactRoute(
      result,
      options.deadlineAt,
      generatedAt
    );
    const metadataStartedAt = now();
    if (metadataStartedAt >= options.deadlineAt) {
      throw new Error(
        "API capability original deadline expired before metadata verification"
      );
    }
    const metadataStopMonitor = createStopMonitor(options, intentSha256);
    let info: GatewayGenerationInfo;
    try {
      if (metadataStopMonitor.stopped()) {
        metadataState = "unstarted-stopped";
        throw new Error("API capability stopped by root sentinel");
      }
      metadataState = "unstarted-metadata-setup-failed";
      writeDurableJson(
        path.join(options.evidenceDirectory, "metadata-attempt.json"),
        {
          generationId,
          inferenceResultSha256: resultSha256,
          intentSha256,
          kind: "api-capability-metadata-attempt-v3",
          maxCalls: API_CAPABILITY_METADATA_MAX_CALLS,
          metadataStartedAt,
          policyVersion: API_CAPABILITY_METADATA_POLICY_VERSION,
          responseMaxBytes: API_CAPABILITY_METADATA_MAX_RESPONSE_BYTES,
        }
      );
      metadataLookupAttempts = 1;
      metadataState = "settled-failed";
      const metadataAbortSignal = AbortSignal.any([
        AbortSignal.timeout(
          Math.min(
            API_CAPABILITY_METADATA_RESERVE_MS,
            options.deadlineAt - metadataStartedAt
          )
        ),
        metadataStopMonitor.signal,
      ]);
      try {
        info = await (
          options.getGenerationInfo ?? readApiCapabilityGenerationInfo
        )({
          abortSignal: metadataAbortSignal,
          id: generationId,
        });
      } catch (error) {
        const failure = {
          ...metadataFailureOf(error, metadataAbortSignal),
          generationId,
          inferenceResultSha256: resultSha256,
          intentSha256,
          kind: "api-capability-metadata-failure-v1",
          metadataStartedAt,
          policyVersion: API_CAPABILITY_METADATA_POLICY_VERSION,
          settledAt: now(),
        } as const;
        const failureFile = path.join(
          options.evidenceDirectory,
          "metadata-failure.json"
        );
        writeDurableJson(failureFile, failure);
        observedMetadataFailureSha256 = hashBytes(readFileSync(failureFile));
        throw new Error("API capability metadata lookup failed", {
          cause: error,
        });
      }
      if (metadataStopMonitor.stopped()) {
        throw new Error("API capability stopped by root sentinel");
      }
    } finally {
      try {
        metadataStopMonitor.close();
      } finally {
        stopObserved ||= metadataStopMonitor.stopped();
      }
    }
    if (metadataStopMonitor.stopped()) {
      throw new Error("API capability stopped by root sentinel");
    }
    const metadataFile = path.join(
      options.evidenceDirectory,
      "generation-info.json"
    );
    writeDurableJson(metadataFile, {
      kind: "api-capability-generation-info-v2",
      metadataStartedAt,
      value: info,
    });
    const metadataSha256 = hashBytes(readFileSync(metadataFile));
    observedMetadataSha256 = metadataSha256;
    metadataState = "settled-complete";
    const settledAt = now();
    if (settledAt >= options.deadlineAt) {
      throw new Error(
        "API capability server metadata arrived after original deadline"
      );
    }
    assertGenerationInfo(info, result, generationId, chargeUsd);
    const parsed = responseSchema.parse(result.object);
    if (
      result.finishReason !== "stop" ||
      (result.warnings?.length ?? 0) !== 0 ||
      parsed.unknown ||
      parsed.description.trim().toLowerCase() !== expectedLabel
    ) {
      throw new Error(
        "API capability structured image answer was not accepted"
      );
    }
    ownedFile(options.imageFile);
    if (hashBytes(readFileSync(options.imageFile)) !== imageSha256) {
      throw new Error("API capability image bytes changed after dispatch");
    }
    const terminal = {
      accepted: true,
      attemptedAt,
      chargeUsd,
      generationId,
      inferenceAttempts: 1,
      intentSha256,
      kind: "iconsmith-api-image-capability-terminal-v3",
      metadataFailureSha256: null,
      metadataLookupAttempts,
      metadataSha256,
      metadataState,
      resultSha256,
      routeIdentityVersion: API_CAPABILITY_ROUTE_IDENTITY,
      serializedRequestBodySha256: requestBodySha256,
      settledAt,
      upstreamRevision: "undisclosed",
    };
    writeDurableJson(
      path.join(options.evidenceDirectory, "terminal.json"),
      terminal
    );
    return terminal;
  } catch (error) {
    const settledAt = now();
    if (stopObserved && metadataLookupAttempts === 0) {
      metadataState = "unstarted-stopped";
    }
    const terminal = {
      accepted: false,
      attemptedAt,
      chargeUsd: observedChargeUsd,
      generationId: observedGenerationId,
      inferenceAttempts,
      intentSha256,
      kind: "iconsmith-api-image-capability-terminal-v3",
      metadataFailureSha256: observedMetadataFailureSha256,
      metadataLookupAttempts,
      metadataSha256: observedMetadataSha256,
      metadataState,
      reason: error instanceof Error ? error.message : "unknown failure",
      resultSha256: observedResultSha256,
      routeIdentityVersion: API_CAPABILITY_ROUTE_IDENTITY,
      settledAt,
      upstreamRevision: "undisclosed",
    };
    writeDurableJson(
      path.join(options.evidenceDirectory, "terminal.json"),
      terminal
    );
    return terminal;
  }
};

const COLLECTOR_QUESTION_SUFFIXES = [
  "critical",
  "craft",
  "family",
  "native",
  "ship",
] as const;
const COLLECTOR_DESCRIPTOR_KEYS = [
  "actor",
  "descriptorFile",
  "instrumentHash",
  "kind",
  "orderedAttachments",
  "originalDeadlineAt",
  "questions",
  "requestId",
  "role",
  "routeHash",
  "schemaVersion",
  "stageDeadlineAt",
] as const;
const collectorCapabilityState = new WeakMap<
  object,
  {
    answers: Readonly<ApiCollectorAnswerMap>;
    attachmentFiles: readonly string[];
    descriptor: ApiCollectorStageDescriptorV1;
    summary: Readonly<ApiCollectorStageSealedSummary>;
  }
>();
const consumedCollectorCapabilities = new WeakSet<object>();

const sameJson = (left: unknown, right: unknown) =>
  canonicalJson(left) === canonicalJson(right);

const frozenActor = () => Object.freeze({ ...API_COLLECTOR_STAGE_ACTOR });

const ownedRegularFile = (file: string, label: string) => {
  if (!path.isAbsolute(file)) {
    throw new Error(`${label} path must be absolute`);
  }
  const metadata = lstatSync(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    realpathSync(file) !== path.resolve(file)
  ) {
    throw new Error(`${label} must be an owned regular file`);
  }
};

// The descriptor is an authority boundary and every field is checked here.
// oxlint-disable-next-line eslint/complexity
const readCollectorDescriptor = (options: {
  descriptorFile: string;
  descriptorSha256: string;
}) => {
  if (!HEX.test(options.descriptorSha256)) {
    throw new Error("API collector descriptor hash is invalid");
  }
  ownedRegularFile(options.descriptorFile, "API collector descriptor");
  const bytes = readFileSync(options.descriptorFile);
  if (hashBytes(bytes) !== options.descriptorSha256) {
    throw new Error("API collector descriptor bytes changed");
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf-8"));
  } catch {
    throw new Error("API collector descriptor is not JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("API collector descriptor is invalid");
  }
  const descriptor = value as ApiCollectorStageDescriptorV1;
  const questionIds = Array.isArray(descriptor.questions)
    ? descriptor.questions.map((question) =>
        question && typeof question === "object" && "id" in question
          ? String(question.id)
          : ""
      )
    : [];
  const prefixes = questionIds.map((id, index) =>
    id.endsWith(`-${COLLECTOR_QUESTION_SUFFIXES[index]}`)
      ? id.slice(0, -COLLECTOR_QUESTION_SUFFIXES[index].length - 1)
      : ""
  );
  if (
    !sameJson(Object.keys(descriptor).toSorted(), [
      ...COLLECTOR_DESCRIPTOR_KEYS,
    ]) ||
    descriptor.schemaVersion !== 1 ||
    descriptor.kind !== API_COLLECTOR_STAGE_DESCRIPTOR_KIND ||
    descriptor.descriptorFile !== options.descriptorFile ||
    realpathSync(options.descriptorFile) !== descriptor.descriptorFile ||
    !sameJson(descriptor.actor, API_COLLECTOR_STAGE_ACTOR) ||
    descriptor.routeHash !== API_COLLECTOR_ROUTE_HASH ||
    !["prediction", "panel"].includes(descriptor.role) ||
    !descriptor.requestId.trim() ||
    !HEX.test(descriptor.instrumentHash) ||
    !Number.isSafeInteger(descriptor.originalDeadlineAt) ||
    !Number.isSafeInteger(descriptor.stageDeadlineAt) ||
    descriptor.stageDeadlineAt > descriptor.originalDeadlineAt ||
    !Array.isArray(descriptor.questions) ||
    descriptor.questions.length !== COLLECTOR_QUESTION_SUFFIXES.length ||
    new Set(questionIds).size !== descriptor.questions.length ||
    prefixes.some((prefix) => !prefix || prefix !== prefixes[0]) ||
    descriptor.questions.some(
      (question) =>
        !sameJson(Object.keys(question).toSorted(), [
          "choices",
          "id",
          "prompt",
        ]) ||
        !question.prompt.trim() ||
        question.prompt.length > 4096 ||
        !Array.isArray(question.choices) ||
        question.choices.length < 2 ||
        question.choices.length > 12 ||
        new Set(question.choices).size !== question.choices.length ||
        question.choices.some(
          (choice: unknown) => typeof choice !== "string" || !choice.trim()
        )
    ) ||
    !Array.isArray(descriptor.orderedAttachments) ||
    descriptor.orderedAttachments.length < 1 ||
    descriptor.orderedAttachments.length >
      API_COLLECTOR_STAGE_MAX_ATTACHMENTS ||
    new Set(descriptor.orderedAttachments.map(({ name }) => name)).size !==
      descriptor.orderedAttachments.length ||
    descriptor.orderedAttachments.some(
      (attachment) =>
        !sameJson(Object.keys(attachment).toSorted(), [
          "file",
          "name",
          "sha256",
        ]) ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/u.test(attachment.name) ||
        !path.isAbsolute(attachment.file) ||
        !HEX.test(attachment.sha256)
    )
  ) {
    throw new Error("API collector descriptor is invalid");
  }
  return { bytes, descriptor };
};

const collectorPrompt = (descriptor: ApiCollectorStageDescriptorV1) =>
  canonicalJson({
    attachments: descriptor.orderedAttachments.map(({ name }) => name),
    instruction:
      "Inspect only the supplied PNG attachments in their declared order. Answer every question exactly once. Do not use tools, URLs, outside context, prior predictions, synonyms, or panel outputs.",
    questions: descriptor.questions,
    requestId: descriptor.requestId,
    role: descriptor.role,
  });

const collectorSchema = (descriptor: ApiCollectorStageDescriptorV1) => {
  const shape = Object.fromEntries(
    descriptor.questions.map((question) => [
      question.id,
      z
        .object({
          choice: z.enum(question.choices as [string, string, ...string[]]),
          evidence: z.string().min(1).max(4096),
          treatment: z.string().max(4096),
        })
        .strict(),
    ])
  );
  return z.object(shape).strict() as z.ZodType<ApiCollectorAnswerMap>;
};

const collectorJsonSchema = (descriptor: ApiCollectorStageDescriptorV1) => ({
  $schema: "http://json-schema.org/draft-07/schema#",
  additionalProperties: false,
  properties: Object.fromEntries(
    descriptor.questions.map((question) => [
      question.id,
      {
        additionalProperties: false,
        properties: {
          choice: { enum: question.choices, type: "string" },
          evidence: { maxLength: 4096, minLength: 1, type: "string" },
          treatment: { maxLength: 4096, type: "string" },
        },
        required: ["choice", "evidence", "treatment"],
        type: "object",
      },
    ])
  ),
  required: descriptor.questions.map(({ id }) => id),
  type: "object",
});

const expectedCollectorRequestBody = (
  prompt: string,
  images: readonly Buffer[],
  descriptor: ApiCollectorStageDescriptorV1
) => ({
  headers: { "user-agent": API_CAPABILITY_TRANSPORT_USER_AGENT },
  maxOutputTokens: API_COLLECTOR_STAGE_MAX_OUTPUT_TOKENS,
  prompt: [
    {
      content: [
        { text: prompt, type: "text" },
        ...images.map((image) => ({
          data: { data: image.toString("base64"), type: "data" },
          mediaType: "image/png",
          type: "file",
        })),
      ],
      role: "user",
    },
  ],
  providerOptions: {
    gateway: {
      only: [API_CAPABILITY_PROVIDER],
      order: [API_CAPABILITY_PROVIDER],
    },
  },
  responseFormat: { schema: collectorJsonSchema(descriptor), type: "json" },
  temperature: 0,
});

const collectorBinding = (file: string): ApiCollectorStageFileBinding =>
  Object.freeze({ file, sha256: hashBytes(readFileSync(file)) });

const validateCollectorAttachments = async (
  descriptor: ApiCollectorStageDescriptorV1
) => {
  const images: Buffer[] = [];
  for (const attachment of descriptor.orderedAttachments) {
    ownedRegularFile(attachment.file, "API collector attachment");
    const image = readFileSync(attachment.file);
    if (hashBytes(image) !== attachment.sha256) {
      throw new Error("API collector attachment bytes changed");
    }
    // Ordered validation is deliberately sequential over one frozen list.
    // oxlint-disable-next-line no-await-in-loop
    const metadata = await sharp(image).metadata();
    if (
      metadata.format !== "png" ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > API_COLLECTOR_STAGE_MAX_IMAGE_PX ||
      metadata.height > API_COLLECTOR_STAGE_MAX_IMAGE_PX
    ) {
      throw new Error("API collector requires bounded PNG attachments");
    }
    images.push(image);
  }
  return images;
};

const collectorMaximumUsd = () =>
  usdOf(
    {
      ...EMPTY_USAGE,
      inputTokens: API_CAPABILITY_MAX_INPUT_TOKENS,
      outputTokens: API_COLLECTOR_STAGE_MAX_OUTPUT_TOKENS,
    },
    {
      cacheRead: API_CAPABILITY_RATE.input * 0.1,
      cacheWrite: API_CAPABILITY_RATE.input * 1.25,
      ...API_CAPABILITY_RATE,
    }
  );

const assertCollectorLimits = (
  options: ApiCollectorStageOptions,
  descriptor: ApiCollectorStageDescriptorV1,
  observedAt: number
) => {
  const rate = rateFor(API_CAPABILITY_MODEL);
  if (
    !rate ||
    rate.input !== API_CAPABILITY_RATE.input ||
    rate.output !== API_CAPABILITY_RATE.output ||
    collectorMaximumUsd() !== API_COLLECTOR_STAGE_MAX_USD ||
    options.reservedMaxUsd !== API_COLLECTOR_STAGE_MAX_USD ||
    options.startedAt < API_CAPABILITY_PRICING_VALID_FROM ||
    options.startedAt >= API_CAPABILITY_PRICING_VALID_BEFORE ||
    descriptor.stageDeadlineAt > descriptor.originalDeadlineAt ||
    descriptor.stageDeadlineAt - options.startedAt >
      API_CAPABILITY_DEADLINE_MS ||
    descriptor.stageDeadlineAt <= options.startedAt ||
    observedAt < options.startedAt ||
    observedAt >= descriptor.stageDeadlineAt ||
    descriptor.stageDeadlineAt - observedAt <=
      API_COLLECTOR_METADATA_RESERVE_MS ||
    descriptor.orderedAttachments.length * API_CAPABILITY_IMAGE_TOKENS >
      API_CAPABILITY_MAX_INPUT_TOKENS
  ) {
    throw new Error("API collector price, clock, or reservation drifted");
  }
};

const defaultCollectorGenerate: ApiCollectorStageGenerator = async (input) => {
  const result = await generateObject(input);
  return {
    finishReason: result.finishReason,
    object: result.object,
    providerMetadata: result.providerMetadata,
    request: result.request,
    response: {
      body: result.response.body,
      headers: result.response.headers,
      id: result.response.id,
      modelId: result.response.modelId,
    },
    usage: result.usage,
    warnings: result.warnings,
  };
};

const revalidateCollectorCapability = (
  state: NonNullable<ReturnType<typeof collectorCapabilityState.get>>
) => {
  const { descriptor, summary } = state;
  const descriptorRead = readCollectorDescriptor({
    descriptorFile: summary.evidence.descriptor.file,
    descriptorSha256: summary.evidence.descriptor.sha256,
  });
  if (!sameJson(descriptorRead.descriptor, descriptor)) {
    throw new Error("API collector descriptor identity changed");
  }
  for (const [index, attachment] of descriptor.orderedAttachments.entries()) {
    ownedRegularFile(
      state.attachmentFiles[index] ?? "",
      "API collector attachment"
    );
    if (
      state.attachmentFiles[index] !== attachment.file ||
      hashBytes(readFileSync(attachment.file)) !== attachment.sha256
    ) {
      throw new Error("API collector attachment identity changed");
    }
  }
  for (const binding of Object.values(summary.evidence)) {
    ownedRegularFile(binding.file, "API collector evidence");
    if (hashBytes(readFileSync(binding.file)) !== binding.sha256) {
      throw new Error("API collector evidence bytes changed");
    }
  }
  const intent = JSON.parse(
    readFileSync(summary.evidence.intent.file, "utf-8")
  );
  const result = JSON.parse(
    readFileSync(summary.evidence.result.file, "utf-8")
  );
  const terminal = JSON.parse(
    readFileSync(summary.evidence.terminal.file, "utf-8")
  );
  if (
    intent.descriptorSha256 !== summary.evidence.descriptor.sha256 ||
    intent.promptSha256 !== summary.promptSha256 ||
    intent.routeHash !== summary.routeHash ||
    result.answersHash !== summary.answersHash ||
    summary.outputSha256 !== summary.evidence.result.sha256 ||
    terminal.accepted !== true ||
    terminal.resultSha256 !== summary.outputSha256 ||
    terminal.requestSha256 !== summary.evidence.request.sha256 ||
    terminal.metadataSha256 !== summary.evidence.generationInfo.sha256 ||
    terminal.intentSha256 !== summary.evidence.intent.sha256
  ) {
    throw new Error("API collector evidence chain changed");
  }
};

// The callback is the only scope in which verified answers are exposed.
/* oxlint-disable promise/prefer-await-to-callbacks -- the capability must expose evidence only during this synchronous callback */
export const withVerifiedApiCollectorStage = <T>(
  capability: ApiCollectorStageCapability,
  expected: ApiCollectorStageVerificationExpectation,
  callback: (evidence: VerifiedApiCollectorStageEvidence) => T
): T => {
  const state = collectorCapabilityState.get(capability);
  if (!state || consumedCollectorCapabilities.has(capability)) {
    throw new Error("API collector live capability is unavailable or consumed");
  }
  revalidateCollectorCapability(state);
  const { summary } = state;
  if (
    !sameJson(expected.actor, summary.actor) ||
    expected.requestId !== summary.requestId ||
    expected.role !== summary.role ||
    expected.originalDeadlineAt !== summary.originalDeadlineAt ||
    expected.stageDeadlineAt !== summary.stageDeadlineAt ||
    expected.instrumentHash !== summary.instrumentHash ||
    expected.routeHash !== summary.routeHash ||
    expected.outputSha256 !== summary.outputSha256 ||
    (expected.promptSha256 !== undefined &&
      expected.promptSha256 !== summary.promptSha256) ||
    !sameJson(expected.orderedAttachments, summary.orderedAttachments)
  ) {
    throw new Error("API collector verification expectation changed");
  }
  consumedCollectorCapabilities.add(capability);
  return callback(
    Object.freeze({
      ...summary,
      answers: state.answers,
    })
  );
};
/* oxlint-enable promise/prefer-await-to-callbacks */

/**
 * Runs one frozen Google collector stage. Transport injection remains useful
 * for offline failure controls but can never claim installed transport authority.
 */
// One inference and its metadata settlement intentionally share a single boundary.
// oxlint-disable-next-line eslint/complexity
export const runApiCollectorStage = async <T>(
  options: ApiCollectorStageOptions,
  // oxlint-disable-next-line promise/prefer-await-to-callbacks
  consume: (
    capability: ApiCollectorStageCapability,
    sealedEvidence: Readonly<ApiCollectorStageSealedSummary>
  ) => Promise<T> | T
) => {
  const now = options.now ?? Date.now;
  const observedAt = now();
  const loaded = readCollectorDescriptor(options);
  const { descriptor } = loaded;
  assertCollectorLimits(options, descriptor, observedAt);
  const images = await validateCollectorAttachments(descriptor);
  const prompt = collectorPrompt(descriptor);
  if (
    Buffer.byteLength(prompt, "utf-8") > API_COLLECTOR_STAGE_MAX_PROMPT_BYTES
  ) {
    throw new Error("API collector prompt exceeds its frozen byte bound");
  }
  ownedDirectory(options.evidenceDirectory);
  assertStopBoundary(options.stopFile, options.evidenceDirectory);
  const stopOptions: ApiCapabilityStopOptions = options;
  const schema = collectorSchema(descriptor);
  const expectedBody = expectedCollectorRequestBody(prompt, images, descriptor);
  const expectedRequestBodySha256 = serializedRequestBodySha256(expectedBody);
  const intent = {
    actor: descriptor.actor,
    attachmentCount: descriptor.orderedAttachments.length,
    descriptorSha256: options.descriptorSha256,
    inputTokenUpperBound: API_CAPABILITY_MAX_INPUT_TOKENS,
    instrumentHash: descriptor.instrumentHash,
    kind: "iconsmith-api-collector-stage-intent-v1",
    maxCalls: 1,
    maxOutputTokens: API_COLLECTOR_STAGE_MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    maxUsd: API_COLLECTOR_STAGE_MAX_USD,
    metadataLookupMaxCalls: API_CAPABILITY_METADATA_MAX_CALLS,
    metadataReserveMs: API_COLLECTOR_METADATA_RESERVE_MS,
    metadataWaitMs: API_COLLECTOR_METADATA_WAIT_MS,
    orderedAttachments: descriptor.orderedAttachments.map(
      ({ name, sha256 }) => ({
        name,
        sha256,
      })
    ),
    originalDeadlineAt: descriptor.originalDeadlineAt,
    pricingEvidenceSha256: API_CAPABILITY_PRICING_EVIDENCE_SHA256,
    promptSha256: hashBytes(prompt),
    requestId: descriptor.requestId,
    role: descriptor.role,
    routeHash: descriptor.routeHash,
    schemaId: API_COLLECTOR_STAGE_SCHEMA_ID,
    serializedRequestBodySha256: expectedRequestBodySha256,
    stageDeadlineAt: descriptor.stageDeadlineAt,
    startedAt: options.startedAt,
    stopFile: options.stopFile,
  } as const;
  const intentFile = path.join(options.evidenceDirectory, "intent.json");
  writeDurableJson(intentFile, intent);
  const intentSha256 = hashBytes(readFileSync(intentFile));
  if (observeStop(stopOptions, intentSha256)) {
    const terminal = {
      accepted: false,
      attemptedAt: null,
      chargeUsd: null,
      inferenceAttempts: 0,
      intentSha256,
      kind: "iconsmith-api-collector-stage-terminal-v1",
      metadataLookupAttempts: 0,
      reason: "API capability stopped by root sentinel",
      settledAt: now(),
    } as const;
    writeDurableJson(
      path.join(options.evidenceDirectory, "terminal.json"),
      terminal
    );
    return terminal;
  }
  const attemptedAt = now();
  if (
    attemptedAt >=
    descriptor.stageDeadlineAt - API_COLLECTOR_METADATA_RESERVE_MS
  ) {
    const terminal = {
      accepted: false,
      attemptedAt,
      chargeUsd: null,
      inferenceAttempts: 0,
      intentSha256,
      kind: "iconsmith-api-collector-stage-terminal-v1",
      metadataLookupAttempts: 0,
      reason: "collector stage deadline expired before dispatch",
      settledAt: attemptedAt,
    } as const;
    writeDurableJson(
      path.join(options.evidenceDirectory, "terminal.json"),
      terminal
    );
    return terminal;
  }
  const issuanceFile = `${options.descriptorFile}.issued-${options.descriptorSha256}.json`;
  writeDurableJson(issuanceFile, {
    descriptorSha256: options.descriptorSha256,
    evidenceDirectory: options.evidenceDirectory,
    intentSha256,
    issuedAt: attemptedAt,
    kind: "iconsmith-api-collector-stage-issuance-v1",
    requestId: descriptor.requestId,
  });
  writeDurableJson(path.join(options.evidenceDirectory, "attempt.json"), {
    attemptedAt,
    intentSha256,
    kind: "iconsmith-api-collector-stage-attempt-v1",
  });
  let chargeUsd: number | null = null;
  let generationId: string | null = null;
  let resultSha256: string | null = null;
  let requestSha256: string | null = null;
  let metadataSha256: string | null = null;
  let metadataFailureSha256: string | null = null;
  let inferenceAttempts = 0;
  let metadataLookupAttempts = 0;
  let stopObserved = false;
  let deliveredCapability: ApiCollectorStageCapability | null = null;
  try {
    const stopMonitor = createStopMonitor(stopOptions, intentSha256);
    let result: ApiCollectorStageGeneratorResult;
    try {
      if (stopMonitor.stopped()) {
        throw new Error("API capability stopped by root sentinel");
      }
      inferenceAttempts = 1;
      result = await (options.generate ?? defaultCollectorGenerate)({
        abortSignal: AbortSignal.any([
          AbortSignal.timeout(
            descriptor.stageDeadlineAt -
              attemptedAt -
              API_COLLECTOR_METADATA_RESERVE_MS
          ),
          stopMonitor.signal,
        ]),
        maxOutputTokens: API_COLLECTOR_STAGE_MAX_OUTPUT_TOKENS,
        maxRetries: 0,
        messages: [
          {
            content: [
              { text: prompt, type: "text" },
              ...images.map((image) => ({
                data: image,
                mediaType: "image/png" as const,
                type: "file" as const,
              })),
            ],
            role: "user",
          },
        ],
        model: (options.resolve ?? resolveModel)(API_CAPABILITY_MODEL),
        providerOptions: {
          gateway: {
            only: [API_CAPABILITY_PROVIDER],
            order: [API_CAPABILITY_PROVIDER],
          },
        },
        schema,
        temperature: 0,
      });
    } finally {
      try {
        stopMonitor.close();
      } finally {
        stopObserved = stopMonitor.stopped();
      }
    }
    const generatedAt = now();
    chargeUsd = knownChargeOf(result.providerMetadata);
    generationId = generationIdOf(result.providerMetadata);
    const parsedAnswers = schema.parse(result.object);
    const answers = Object.freeze(
      Object.fromEntries(
        descriptor.questions.map(({ id }) => [
          id,
          Object.freeze({ ...parsedAnswers[id] }),
        ])
      )
    );
    const answersHash = hashBytes(canonicalJson(answers));
    const resultFile = path.join(options.evidenceDirectory, "result.json");
    writeDurableJson(resultFile, {
      answers,
      answersHash,
      finishReason: result.finishReason,
      kind: "iconsmith-api-collector-stage-result-v1",
      providerMetadata: result.providerMetadata ?? null,
      response: result.response,
      settledAt: generatedAt,
      usage: tokenUsageOf(result.usage),
      warnings: result.warnings ?? [],
    });
    resultSha256 = hashBytes(readFileSync(resultFile));
    const requestFile = path.join(
      options.evidenceDirectory,
      "serialized-request.json"
    );
    if (
      assertSerializedRequest(result.request, expectedRequestBodySha256) !==
      expectedRequestBodySha256
    ) {
      throw new Error("API collector serialized request identity drifted");
    }
    writeDurableJson(requestFile, (result.request as { body: unknown }).body);
    requestSha256 = hashBytes(readFileSync(requestFile));
    if (
      serializedRequestBodySha256(
        JSON.parse(readFileSync(requestFile, "utf-8"))
      ) !== expectedRequestBodySha256
    ) {
      throw new Error("API collector sealed request bytes drifted");
    }
    const { cost: exactCost, generationId: exactGenerationId } =
      assertExactRoute(
        result,
        descriptor.stageDeadlineAt,
        generatedAt,
        API_COLLECTOR_STAGE_MAX_USD
      );
    chargeUsd = exactCost;
    generationId = exactGenerationId;
    const { finishReason } = result;
    if (
      finishReason !== "stop" ||
      (result.warnings?.length ?? 0) !== 0 ||
      stopMonitor.stopped()
    ) {
      throw new Error("API collector structured answers were not accepted");
    }
    const metadataStartedAt = now();
    if (metadataStartedAt >= descriptor.stageDeadlineAt) {
      throw new Error(
        "API collector stage expired before metadata verification"
      );
    }
    const metadataMonitor = createStopMonitor(stopOptions, intentSha256);
    let info: GatewayGenerationInfo;
    try {
      if (metadataMonitor.stopped()) {
        throw new Error("API capability stopped by root sentinel");
      }
      const metadataAbortSignal = AbortSignal.any([
        AbortSignal.timeout(
          Math.min(
            API_COLLECTOR_METADATA_RESERVE_MS,
            descriptor.stageDeadlineAt - metadataStartedAt
          )
        ),
        metadataMonitor.signal,
      ]);
      try {
        // D535 observed readiness only at 20 seconds. One bounded lookup, no inference retry.
        if (!options.getGenerationInfo) {
          await delay(API_COLLECTOR_METADATA_WAIT_MS, undefined, {
            signal: metadataAbortSignal,
          });
        }
        metadataAbortSignal.throwIfAborted();
        metadataLookupAttempts = 1;
        info = await (
          options.getGenerationInfo ?? readApiCapabilityGenerationInfo
        )({
          abortSignal: metadataAbortSignal,
          id: generationId,
        });
      } catch (error) {
        const failureFile = path.join(
          options.evidenceDirectory,
          "metadata-failure.json"
        );
        writeDurableJson(failureFile, {
          ...metadataFailureOf(error, metadataAbortSignal),
          generationId,
          inferenceResultSha256: resultSha256,
          intentSha256,
          kind: "api-capability-metadata-failure-v1",
          metadataStartedAt,
          policyVersion: API_CAPABILITY_METADATA_POLICY_VERSION,
          settledAt: now(),
        });
        metadataFailureSha256 = hashBytes(readFileSync(failureFile));
        throw error;
      }
    } finally {
      try {
        metadataMonitor.close();
      } finally {
        stopObserved ||= metadataMonitor.stopped();
      }
    }
    assertGenerationInfo(info, result, generationId, chargeUsd);
    const generationInfoFile = path.join(
      options.evidenceDirectory,
      "generation-info.json"
    );
    writeDurableJson(generationInfoFile, {
      kind: "api-capability-generation-info-v2",
      metadataStartedAt,
      value: info,
    });
    metadataSha256 = hashBytes(readFileSync(generationInfoFile));
    const settledAt = now();
    if (settledAt >= descriptor.stageDeadlineAt) {
      throw new Error("API collector evidence settled after stage deadline");
    }
    const loadedAfter = readCollectorDescriptor(options);
    if (!sameJson(loadedAfter.descriptor, descriptor)) {
      throw new Error("API collector descriptor changed after dispatch");
    }
    await validateCollectorAttachments(descriptor);
    const terminalFile = path.join(options.evidenceDirectory, "terminal.json");
    const terminal = {
      accepted: true,
      attemptedAt,
      chargeUsd,
      generationId,
      inferenceAttempts,
      intentSha256,
      kind: "iconsmith-api-collector-stage-terminal-v1",
      metadataLookupAttempts,
      metadataSha256,
      requestSha256,
      resultSha256,
      routeHash: descriptor.routeHash,
      settledAt,
    } as const;
    writeDurableJson(terminalFile, terminal);
    const transportAuthority: ApiCollectorStageTransportAuthority =
      options.generate ||
      options.getGenerationInfo ||
      options.resolve ||
      options.now
        ? "offline-test-only"
        : "installed-production-transport";
    const evidence = Object.freeze({
      descriptor: Object.freeze({
        file: options.descriptorFile,
        sha256: options.descriptorSha256,
      }),
      generationInfo: collectorBinding(generationInfoFile),
      intent: collectorBinding(intentFile),
      request: collectorBinding(requestFile),
      result: collectorBinding(resultFile),
      terminal: collectorBinding(terminalFile),
    });
    const summary = Object.freeze({
      actor: frozenActor(),
      answersHash,
      evidence,
      instrumentHash: descriptor.instrumentHash,
      orderedAttachments: Object.freeze(
        descriptor.orderedAttachments.map(({ name, sha256 }) =>
          Object.freeze({ name, sha256 })
        )
      ),
      originalDeadlineAt: descriptor.originalDeadlineAt,
      outputSha256: resultSha256,
      promptSha256: hashBytes(prompt),
      requestId: descriptor.requestId,
      role: descriptor.role,
      routeHash: descriptor.routeHash,
      settledAt,
      stageDeadlineAt: descriptor.stageDeadlineAt,
      startedAt: options.startedAt,
      transportAuthority,
      usage: Object.freeze(tokenUsageOf(result.usage)),
    }) satisfies Readonly<ApiCollectorStageSealedSummary>;
    const capability = Object.freeze({}) as ApiCollectorStageCapability;
    collectorCapabilityState.set(capability, {
      answers,
      attachmentFiles: descriptor.orderedAttachments.map(({ file }) => file),
      descriptor,
      summary,
    });
    deliveredCapability = capability;
    try {
      return { terminal, value: await consume(capability, summary) } as const;
    } finally {
      collectorCapabilityState.delete(capability);
    }
  } catch (error) {
    if (deliveredCapability) {
      throw error;
    }
    let reason = "unknown failure";
    if (stopObserved) {
      reason = "API capability stopped by root sentinel";
    } else if (error instanceof Error) {
      reason = error.message;
    }
    const terminal = {
      accepted: false,
      attemptedAt,
      chargeUsd,
      generationId,
      inferenceAttempts,
      intentSha256,
      kind: "iconsmith-api-collector-stage-terminal-v1",
      metadataFailureSha256,
      metadataLookupAttempts,
      metadataSha256,
      reason,
      requestSha256,
      resultSha256,
      settledAt: now(),
    } as const;
    writeDurableJson(
      path.join(options.evidenceDirectory, "terminal.json"),
      terminal
    );
    return terminal;
  }
};

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { createGateway } from "@ai-sdk/gateway";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  API_CAPABILITY_DEADLINE_MS,
  API_CAPABILITY_MAX_INPUT_TOKENS,
  API_CAPABILITY_METADATA_MAX_CALLS,
  API_CAPABILITY_METADATA_MAX_RESPONSE_BYTES,
  API_CAPABILITY_METADATA_POLICY_VERSION,
  API_CAPABILITY_MAX_OUTPUT_TOKENS,
  API_CAPABILITY_MAX_USD,
  API_CAPABILITY_MODEL,
  API_CAPABILITY_PRICING_EVIDENCE_SHA256,
  API_CAPABILITY_PRICING_VALID_BEFORE,
  API_CAPABILITY_PRICING_VALID_FROM,
  API_CAPABILITY_PROVIDER,
  API_CAPABILITY_RESPONSE_MODEL,
  API_CAPABILITY_ROUTE_IDENTITY,
  API_CAPABILITY_TRANSPORT_USER_AGENT,
  API_COLLECTOR_ROUTE_HASH,
  API_COLLECTOR_STAGE_ACTOR,
  API_COLLECTOR_STAGE_DESCRIPTOR_KIND,
  API_COLLECTOR_STAGE_MAX_OUTPUT_TOKENS,
  API_COLLECTOR_STAGE_MAX_USD,
  readApiCapabilityGenerationInfo,
  runApiCollectorStage,
  runApiImageCapability,
  withVerifiedApiCollectorStage,
} from "./api-image-capability.js";
import type {
  ApiCollectorStageDescriptorV1,
  ApiCollectorStageGenerator,
  ApiCollectorStageGeneratorInput,
  ApiCollectorStageOptions,
  ApiImageCapabilityGenerator,
  ApiImageCapabilityOptions,
} from "./api-image-capability.js";

const directories: string[] = [];
const hash = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const FIXTURE_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVQ4jWNgYGD4TyFmGDWAYTQMGEbDgGHohwEAm8z/AWbhjCAAAAAASUVORK5CYII=";

const serializedRequest = () => ({
  body: {
    headers: { "user-agent": API_CAPABILITY_TRANSPORT_USER_AGENT },
    maxOutputTokens: API_CAPABILITY_MAX_OUTPUT_TOKENS,
    prompt: [
      {
        content: [
          {
            text: "Describe the single icon in one ordinary lower-case noun. Return unknown only when no ordinary object is recognizable.",
            type: "text",
          },
          {
            data: { data: FIXTURE_IMAGE_BASE64, type: "data" },
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
  },
});

const routing = ({
  cost = "0.001",
  finalProvider = API_CAPABILITY_PROVIDER,
  modelAttempts = 1,
  providerApiModelId = API_CAPABILITY_RESPONSE_MODEL,
} = {}) => ({
  gateway: {
    cost,
    generationId: "generation-test-1",
    routing: {
      canonicalSlug: API_CAPABILITY_MODEL,
      finalProvider,
      modelAttemptCount: modelAttempts,
      modelAttempts: Array.from({ length: modelAttempts }, (_, index) => ({
        canonicalSlug: API_CAPABILITY_MODEL,
        providerAttemptCount: 1,
        providerAttempts: [
          {
            provider: index === 0 ? finalProvider : API_CAPABILITY_PROVIDER,
            providerApiModelId,
            success: true,
          },
        ],
        success: true,
      })),
      originalModelId: API_CAPABILITY_MODEL,
      resolvedProvider: finalProvider,
      resolvedProviderApiModelId: providerApiModelId,
      totalProviderAttemptCount: modelAttempts,
    },
  },
});

const result = (overrides: Record<string, unknown> = {}) => ({
  finishReason: "stop",
  object: { description: "heart", unknown: false },
  providerMetadata: routing(),
  request: serializedRequest(),
  response: {
    body: { response: "canonical-transport-response" },
    headers: { "ai-gateway-version": "test" },
    id: "response-test-1",
    modelId: API_CAPABILITY_MODEL,
  },
  usage: { inputTokens: 300, outputTokens: 10 },
  warnings: [],
  ...overrides,
});

const generationInfo = () => ({
  billableWebSearchCalls: 0,
  cacheCreationTokens: 0,
  cachedTokens: 0,
  completionTokens: 10,
  createdAt: "2026-09-09T00:00:00.000Z",
  finishReason: "stop",
  generationTime: 100,
  id: "generation-test-1",
  isByok: false,
  latency: 100,
  model: API_CAPABILITY_MODEL,
  promptTokens: 300,
  providerName: API_CAPABILITY_PROVIDER,
  reasoningTokens: 0,
  streamed: false,
  totalCost: 0.001,
  upstreamInferenceCost: 0,
  usage: 0.001,
});

const fixture = async (width = 16, height = 16) => {
  const directory = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "iconsmith-api-cap-"))
  );
  directories.push(directory);
  const imageFile = path.join(directory, "heart.png");
  const image = await sharp({
    create: {
      background: { alpha: 1, b: 0, g: 0, r: 0 },
      channels: 4,
      height,
      width,
    },
  })
    .png()
    .toBuffer();
  writeFileSync(imageFile, image, { mode: 0o600 });
  const evidenceDirectory = path.join(directory, "evidence");
  mkdirSync(evidenceDirectory, { mode: 0o700 });
  const stopFile = path.join(directory, "STOP");
  const startedAt = Date.UTC(2026, 8, 9);
  return {
    image,
    options: {
      deadlineAt: startedAt + API_CAPABILITY_DEADLINE_MS,
      evidenceDirectory,
      expectedImageSha256: hash(image),
      expectedLabel: "heart",
      getGenerationInfo: () => Promise.resolve(generationInfo()),
      imageFile,
      now: () => startedAt + 1000,
      reservedMaxUsd: API_CAPABILITY_MAX_USD,
      resolve: () => API_CAPABILITY_MODEL,
      startedAt,
      stopFile,
    } satisfies ApiImageCapabilityOptions,
  };
};

const collectorFixture = async () => {
  const directory = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "iconsmith-api-collector-"))
  );
  directories.push(directory);
  const images = await Promise.all(
    ["candidate", "family", "native"].map(async (name, index) => {
      const file = path.join(directory, `${name}.png`);
      const bytes = await sharp({
        create: {
          background: { alpha: 1, b: index, g: 0, r: 0 },
          channels: 4,
          height: 24,
          width: 24,
        },
      })
        .png()
        .toBuffer();
      writeFileSync(file, bytes, { mode: 0o600 });
      return { bytes, file, name: `${name}.png`, sha256: hash(bytes) };
    })
  );
  const descriptorFile = path.join(directory, "collector-descriptor.json");
  const startedAt = Date.UTC(2026, 8, 9);
  const prefix = "fixture";
  const descriptor = {
    actor: API_COLLECTOR_STAGE_ACTOR,
    descriptorFile,
    instrumentHash: hash("collector-instrument"),
    kind: API_COLLECTOR_STAGE_DESCRIPTOR_KIND,
    orderedAttachments: images.map(({ file, name, sha256 }) => ({
      file,
      name,
      sha256,
    })),
    originalDeadlineAt: startedAt + API_CAPABILITY_DEADLINE_MS,
    questions: ["critical", "craft", "family", "native", "ship"].map(
      (suffix) => ({
        choices: ["yes", "no"],
        id: `${prefix}-${suffix}`,
        prompt: `Assess ${suffix}.`,
      })
    ),
    requestId: "collector-request-fixture",
    role: "prediction",
    routeHash: API_COLLECTOR_ROUTE_HASH,
    schemaVersion: 1,
    stageDeadlineAt: startedAt + 90_000,
  } satisfies ApiCollectorStageDescriptorV1;
  writeFileSync(descriptorFile, `${JSON.stringify(descriptor, null, 2)}\n`, {
    mode: 0o600,
  });
  const evidenceDirectory = path.join(directory, "evidence");
  mkdirSync(evidenceDirectory, { mode: 0o700 });
  const stopFile = path.join(directory, "STOP");
  const answers = Object.fromEntries(
    descriptor.questions.map(({ id }) => [
      id,
      { choice: "no", evidence: `${id} evidence`, treatment: "none" },
    ])
  );
  const collectorRequest = (input: ApiCollectorStageGeneratorInput) => ({
    body: {
      headers: { "user-agent": API_CAPABILITY_TRANSPORT_USER_AGENT },
      maxOutputTokens: API_COLLECTOR_STAGE_MAX_OUTPUT_TOKENS,
      prompt: input.messages.map((message) => ({
        content: message.content.map((item) =>
          item.type === "text"
            ? item
            : {
                data: { data: item.data.toString("base64"), type: "data" },
                mediaType: item.mediaType,
                type: item.type,
              }
        ),
        role: message.role,
      })),
      providerOptions: input.providerOptions,
      responseFormat: {
        schema: {
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
        },
        type: "json",
      },
      temperature: input.temperature,
    },
  });
  const generate = vi.fn<ApiCollectorStageGenerator>((input) =>
    Promise.resolve({
      finishReason: "stop",
      object: answers,
      providerMetadata: routing(),
      request: collectorRequest(input),
      response: {
        body: { response: "collector fixture" },
        headers: { "ai-gateway-version": "test" },
        id: "response-collector-1",
        modelId: API_CAPABILITY_MODEL,
      },
      usage: { inputTokens: 300, outputTokens: 10 },
      warnings: [],
    })
  );
  const options = {
    descriptorFile,
    descriptorSha256: hash(readFileSync(descriptorFile)),
    evidenceDirectory,
    generate,
    getGenerationInfo: () => Promise.resolve(generationInfo()),
    now: () => startedAt + 1000,
    reservedMaxUsd: API_COLLECTOR_STAGE_MAX_USD,
    resolve: () => API_CAPABILITY_MODEL,
    startedAt,
    stopFile,
  } satisfies ApiCollectorStageOptions;
  return { answers, descriptor, generate, images, options };
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("API image capability boundary", () => {
  it("latches a preexisting root STOP before any provider call", async () => {
    const { options } = await fixture();
    writeFileSync(options.stopFile, "stop\n", { mode: 0o600 });
    const generate = vi.fn<ApiImageCapabilityGenerator>();
    const lookup = vi.fn();
    const terminal = await runApiImageCapability({
      ...options,
      generate,
      getGenerationInfo: lookup,
    });
    expect(terminal).toMatchObject({
      accepted: false,
      inferenceAttempts: 0,
      metadataLookupAttempts: 0,
      metadataState: "unstarted-stopped",
      reason: "API capability stopped by root sentinel",
    });
    expect(generate).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        readFileSync(
          path.join(options.evidenceDirectory, "stopped.json"),
          "utf-8"
        )
      )
    ).toMatchObject({
      intentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      stopFile: options.stopFile,
    });
  });

  it("does not start metadata after STOP arrives during a settled inference", async () => {
    const { options } = await fixture();
    const lookup = vi.fn();
    const terminal = await runApiImageCapability({
      ...options,
      generate: () => {
        writeFileSync(options.stopFile, "stop\n", { mode: 0o600 });
        return Promise.resolve(result());
      },
      getGenerationInfo: lookup,
    });
    expect(terminal).toMatchObject({
      accepted: false,
      chargeUsd: 0.001,
      generationId: "generation-test-1",
      inferenceAttempts: 1,
      metadataLookupAttempts: 0,
      metadataState: "unstarted-stopped",
      resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        readFileSync(
          path.join(options.evidenceDirectory, "result.json"),
          "utf-8"
        )
      )
    ).toMatchObject({
      providerMetadata: {
        gateway: { generationId: "generation-test-1" },
      },
    });
    expect(
      existsSync(path.join(options.evidenceDirectory, "metadata-attempt.json"))
    ).toBe(false);
  });

  it("rechecks STOP after route validation immediately before metadata", async () => {
    const { options } = await fixture();
    const lookup = vi.fn();
    let clockCalls = 0;
    const terminal = await runApiImageCapability({
      ...options,
      generate: () => Promise.resolve(result()),
      getGenerationInfo: lookup,
      now: () => {
        clockCalls += 1;
        if (clockCalls === 4) {
          writeFileSync(options.stopFile, "stop\n", { mode: 0o600 });
        }
        return options.startedAt + 1000 + clockCalls;
      },
    });
    expect(terminal).toMatchObject({
      accepted: false,
      chargeUsd: 0.001,
      generationId: "generation-test-1",
      inferenceAttempts: 1,
      metadataLookupAttempts: 0,
      metadataState: "unstarted-stopped",
      resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(
      existsSync(path.join(options.evidenceDirectory, "metadata-attempt.json"))
    ).toBe(false);
  });

  it("retains an unknown inference charge when STOP leaves metadata unstarted", async () => {
    const { options } = await fixture();
    const lookup = vi.fn();
    const terminal = await runApiImageCapability({
      ...options,
      generate: () => {
        writeFileSync(options.stopFile, "stop\n", { mode: 0o600 });
        return Promise.resolve(
          result({
            providerMetadata: {
              gateway: { ...routing().gateway, cost: undefined },
            },
          })
        );
      },
      getGenerationInfo: lookup,
    });
    expect(terminal).toMatchObject({
      accepted: false,
      chargeUsd: null,
      generationId: "generation-test-1",
      inferenceAttempts: 1,
      metadataLookupAttempts: 0,
      metadataState: "unstarted-stopped",
      resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("actively aborts an in-flight inference and leaves metadata unstarted", async () => {
    const { options } = await fixture();
    const lookup = vi.fn();
    const generate = vi.fn<ApiImageCapabilityGenerator>(
      async ({ abortSignal }) => {
        setTimeout(
          () => writeFileSync(options.stopFile, "stop\n", { mode: 0o600 }),
          5
        );
        await vi.waitFor(() => expect(abortSignal.aborted).toBe(true));
        throw new Error("inference aborted by STOP");
      }
    );
    const terminal = await runApiImageCapability({
      ...options,
      generate,
      getGenerationInfo: lookup,
    });
    expect(terminal).toMatchObject({
      accepted: false,
      inferenceAttempts: 1,
      metadataLookupAttempts: 0,
      metadataState: "unstarted-stopped",
      reason: "inference aborted by STOP",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("actively aborts an in-flight metadata lookup after preserving inference", async () => {
    const { options } = await fixture();
    const lookup = vi.fn(async ({ abortSignal }) => {
      setTimeout(
        () => writeFileSync(options.stopFile, "stop\n", { mode: 0o600 }),
        5
      );
      await vi.waitFor(() => expect(abortSignal.aborted).toBe(true));
      throw new Error("metadata aborted by STOP");
    });
    const terminal = await runApiImageCapability({
      ...options,
      generate: () => Promise.resolve(result()),
      getGenerationInfo: lookup,
    });
    expect(terminal).toMatchObject({
      accepted: false,
      chargeUsd: 0.001,
      generationId: "generation-test-1",
      inferenceAttempts: 1,
      metadataFailureSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      metadataLookupAttempts: 1,
      metadataState: "settled-failed",
      resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(
      JSON.parse(
        readFileSync(
          path.join(options.evidenceDirectory, "metadata-failure.json"),
          "utf-8"
        )
      )
    ).toMatchObject({ classification: "aborted" });
  });

  it("closes the STOP monitor when metadata attempt persistence fails", async () => {
    const { options } = await fixture();
    writeFileSync(
      path.join(options.evidenceDirectory, "metadata-attempt.json"),
      "occupied\n",
      { mode: 0o600 }
    );
    const lookup = vi.fn();
    const terminal = await runApiImageCapability({
      ...options,
      generate: () => Promise.resolve(result()),
      getGenerationInfo: lookup,
    });
    expect(terminal).toMatchObject({
      accepted: false,
      chargeUsd: 0.001,
      generationId: "generation-test-1",
      inferenceAttempts: 1,
      metadataLookupAttempts: 0,
      metadataState: "unstarted-metadata-setup-failed",
      resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(lookup).not.toHaveBeenCalled();
    writeFileSync(options.stopFile, "stop\n", { mode: 0o600 });
    await delay(75);
    expect(
      existsSync(path.join(options.evidenceDirectory, "stopped.json"))
    ).toBe(false);
  });

  it("does not unlatch after the root STOP file is removed", async () => {
    const { options } = await fixture();
    writeFileSync(options.stopFile, "stop\n", { mode: 0o600 });
    const generate = vi.fn<ApiImageCapabilityGenerator>();
    await runApiImageCapability({ ...options, generate });
    rmSync(options.stopFile);
    await expect(
      runApiImageCapability({ ...options, generate })
    ).rejects.toThrow("already latched");
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects a STOP path inside provider evidence before dispatch", async () => {
    const { options } = await fixture();
    const generate = vi.fn<ApiImageCapabilityGenerator>();
    await expect(
      runApiImageCapability({
        ...options,
        generate,
        stopFile: path.join(options.evidenceDirectory, "STOP"),
      })
    ).rejects.toThrow("outside evidence");
    expect(generate).not.toHaveBeenCalled();
  });

  it("refuses when the pinned image changes after its sole request", async () => {
    const { image, options } = await fixture();
    const generate = vi.fn<ApiImageCapabilityGenerator>((input) => {
      expect(
        JSON.parse(
          readFileSync(
            path.join(options.evidenceDirectory, "intent.json"),
            "utf-8"
          )
        )
      ).toMatchObject({
        maxCalls: 1,
        maxOutputTokens: API_CAPABILITY_MAX_OUTPUT_TOKENS,
        maxRetries: 0,
        maxUsd: API_CAPABILITY_MAX_USD,
        model: API_CAPABILITY_MODEL,
        pricingEvidenceSha256: API_CAPABILITY_PRICING_EVIDENCE_SHA256,
        providerOnly: [API_CAPABILITY_PROVIDER],
        serializedRequestBodySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      expect(input.maxRetries).toBe(0);
      expect(input.maxOutputTokens).toBe(API_CAPABILITY_MAX_OUTPUT_TOKENS);
      expect(input.providerOptions).toEqual({
        gateway: { only: ["google"], order: ["google"] },
      });
      expect(input.messages[0].content[1].data).toEqual(image);
      expect("tools" in input).toBe(false);
      writeFileSync(options.imageFile, Buffer.from("post-read mutation"));
      expect(input.messages[0].content[1].data).toEqual(image);
      return Promise.resolve(result());
    });
    const terminal = await runApiImageCapability({ ...options, generate });
    expect(terminal).toMatchObject({
      accepted: false,
      chargeUsd: 0.001,
      generationId: "generation-test-1",
      reason: "API capability image bytes changed after dispatch",
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      readFileSync(path.join(options.evidenceDirectory, "result.json"), "utf-8")
    ).toContain('"responseModelId": "google/gemini-3.7-flash"');
    const resultEvidence = JSON.parse(
      readFileSync(path.join(options.evidenceDirectory, "result.json"), "utf-8")
    );
    expect(resultEvidence).toMatchObject({
      request: serializedRequest(),
      response: {
        body: { response: "canonical-transport-response" },
        id: "response-test-1",
        modelId: API_CAPABILITY_MODEL,
      },
      sdkResponseId: "response-test-1",
    });
  });

  it.each([
    ["tools", { tools: [] }],
    ["URL context", { url: "https://example.invalid/context" }],
    ["changed prompt", { prompt: [] }],
  ])("refuses serialized request drift from %s", async (_name, addition) => {
    const { options } = await fixture();
    const request = serializedRequest();
    Object.assign(request.body, addition);
    const terminal = await runApiImageCapability({
      ...options,
      generate: () => Promise.resolve(result({ request })),
    });
    expect(terminal).toMatchObject({
      accepted: false,
      reason: "API capability serialized request identity drifted",
    });
  });

  it("accepts the prospectively frozen observable identity with undisclosed upstream revision", async () => {
    const { options } = await fixture();
    const metadata = routing();
    Reflect.deleteProperty(
      metadata.gateway.routing,
      "resolvedProviderApiModelId"
    );
    const providerAttempt =
      metadata.gateway.routing.modelAttempts[0]?.providerAttempts[0];
    if (!providerAttempt) {
      throw new Error("Fixture provider missing");
    }
    Reflect.deleteProperty(providerAttempt, "providerApiModelId");
    const lookup = vi.fn(({ id, abortSignal }) => {
      expect(id).toBe("generation-test-1");
      expect(abortSignal.aborted).toBe(false);
      return Promise.resolve(generationInfo());
    });
    const terminal = await runApiImageCapability({
      ...options,
      generate: () => Promise.resolve(result({ providerMetadata: metadata })),
      getGenerationInfo: lookup,
    });
    expect(terminal).toMatchObject({
      accepted: true,
      metadataSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      routeIdentityVersion: API_CAPABILITY_ROUTE_IDENTITY,
      serializedRequestBodySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      upstreamRevision: "undisclosed",
    });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("accepts exact cached usage while binding the Gateway prompt total", async () => {
    const { options } = await fixture();
    const terminal = await runApiImageCapability({
      ...options,
      generate: () =>
        Promise.resolve(
          result({
            usage: {
              inputTokenDetails: {
                cacheReadTokens: 10,
                cacheWriteTokens: 0,
                noCacheTokens: 290,
              },
              inputTokens: 300,
              outputTokenDetails: { reasoningTokens: 0 },
              outputTokens: 10,
            },
          })
        ),
      getGenerationInfo: () =>
        Promise.resolve({
          ...generationInfo(),
          cachedTokens: 10,
          promptTokens: 300,
        }),
    });
    expect(terminal).toMatchObject({
      accepted: true,
      generationId: "generation-test-1",
      metadataLookupAttempts: 1,
    });
    expect(
      JSON.parse(
        readFileSync(
          path.join(options.evidenceDirectory, "result.json"),
          "utf-8"
        )
      )
    ).toMatchObject({
      sdkUsage: {
        inputTokenDetails: { cacheReadTokens: 10, noCacheTokens: 290 },
        inputTokens: 300,
      },
      usage: { cacheReadTokens: 10, inputTokens: 290 },
    });
  });

  it("refuses a non-integer raw SDK prompt total", async () => {
    const { options } = await fixture();
    const terminal = await runApiImageCapability({
      ...options,
      generate: () =>
        Promise.resolve(
          result({
            usage: { inputTokens: 300.5, outputTokens: 10 },
          })
        ),
    });
    expect(terminal).toMatchObject({
      accepted: false,
      generationId: "generation-test-1",
      reason: expect.stringContaining(
        "server generation identity or usage mismatch"
      ),
    });
  });

  it("uses the real Gateway metadata transport once with the exact abort signal", async () => {
    const abort = new AbortController();
    const requests: { init?: RequestInit; url: string }[] = [];
    const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ init, url: String(input) });
      return Promise.resolve(
        Response.json(
          {
            data: {
              billable_web_search_calls: 0,
              created_at: "2026-09-09T00:00:00.000Z",
              finish_reason: "stop",
              generation_time: 100,
              id: "gen_test/with space",
              is_byok: false,
              latency: 100,
              model: API_CAPABILITY_MODEL,
              native_tokens_cache_creation: 0,
              native_tokens_cached: 0,
              native_tokens_completion: 10,
              native_tokens_prompt: 300,
              native_tokens_reasoning: 0,
              provider_name: API_CAPABILITY_PROVIDER,
              streamed: false,
              total_cost: 0.001,
              upstream_inference_cost: 0,
              usage: 0.001,
            },
          },
          { status: 200 }
        )
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        readApiCapabilityGenerationInfo({
          abortSignal: abort.signal,
          id: "gen_test/with space",
        })
      ).resolves.toMatchObject({
        id: "gen_test/with space",
        model: API_CAPABILITY_MODEL,
        providerName: API_CAPABILITY_PROVIDER,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toContain(
        "/v1/generation?id=gen_test%2Fwith%20space"
      );
      expect(requests[0]?.init?.method).toBe("GET");
      expect(requests[0]?.init?.signal).toBe(abort.signal);
    } finally {
      vi.unstubAllGlobals();
      if (previousGatewayKey === undefined) {
        Reflect.deleteProperty(process.env, "AI_GATEWAY_API_KEY");
      } else {
        process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
      }
    }
  });

  it("does not retry the real Gateway metadata transport after failure", async () => {
    const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        Response.json(
          { error: "unavailable" },
          {
            status: 503,
          }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        readApiCapabilityGenerationInfo({
          abortSignal: new AbortController().signal,
          id: "gen_failure",
        })
      ).rejects.toThrow("API capability metadata lookup failed");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      if (previousGatewayKey === undefined) {
        Reflect.deleteProperty(process.env, "AI_GATEWAY_API_KEY");
      } else {
        process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
      }
    }
  });

  it.each([
    ["aborted", "AbortError"],
    ["deadline", "TimeoutError"],
  ])(
    "classifies a real SDK transport %s without retrying",
    async (classification, errorName) => {
      const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
      process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
      const abort = new AbortController();
      abort.abort(new DOMException("private abort detail", errorName));
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        Promise.reject(init?.signal?.reason)
      );
      vi.stubGlobal("fetch", fetchMock);
      try {
        const failure = await readApiCapabilityGenerationInfo({
          abortSignal: abort.signal,
          id: "gen_abort",
        }).catch((error: unknown) => error);
        expect(failure).toMatchObject({
          failure: {
            bodyBytes: null,
            bodySha256: null,
            classification,
            httpStatus: null,
          },
          message: "API capability metadata lookup failed",
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(failure)).not.toContain("private abort detail");
      } finally {
        vi.unstubAllGlobals();
        if (previousGatewayKey === undefined) {
          Reflect.deleteProperty(process.env, "AI_GATEWAY_API_KEY");
        } else {
          process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
        }
      }
    }
  );

  it("persists a sanitized HTTP failure without retrying metadata or inference", async () => {
    const { options } = await fixture();
    const generate = vi.fn(() => Promise.resolve(result()));
    const secretBody = '{"error":"private upstream diagnostic"}';
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(secretBody, { status: 503 }))
    );
    const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY = "private-test-token";
    vi.stubGlobal("fetch", fetchMock);
    try {
      const terminal = await runApiImageCapability({
        ...options,
        generate,
        getGenerationInfo: undefined,
      });
      expect(terminal).toMatchObject({
        accepted: false,
        inferenceAttempts: 1,
        metadataFailureSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        metadataLookupAttempts: API_CAPABILITY_METADATA_MAX_CALLS,
        metadataSha256: null,
        reason: "API capability metadata lookup failed",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(generate).toHaveBeenCalledTimes(1);
      const failureText = readFileSync(
        path.join(options.evidenceDirectory, "metadata-failure.json"),
        "utf-8"
      );
      expect(JSON.parse(failureText)).toMatchObject({
        bodyBytes: Buffer.byteLength(secretBody),
        bodySha256: hash(secretBody),
        classification: "http-error",
        httpStatus: 503,
        policyVersion: API_CAPABILITY_METADATA_POLICY_VERSION,
      });
      expect(failureText).not.toContain("private upstream diagnostic");
      expect(failureText).not.toContain("private-test-token");
    } finally {
      vi.unstubAllGlobals();
      if (previousGatewayKey === undefined) {
        Reflect.deleteProperty(process.env, "AI_GATEWAY_API_KEY");
      } else {
        process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
      }
    }
  });

  it("classifies an invalid successful SDK response without persisting its body", async () => {
    const { options } = await fixture();
    const invalidBody = '{"data":{"unexpected":"private value"}}';
    const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY = "private-test-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(invalidBody)))
    );
    try {
      const terminal = await runApiImageCapability({
        ...options,
        generate: () => Promise.resolve(result()),
        getGenerationInfo: undefined,
      });
      expect(terminal).toMatchObject({
        accepted: false,
        metadataLookupAttempts: 1,
        reason: "API capability metadata lookup failed",
      });
      const failureText = readFileSync(
        path.join(options.evidenceDirectory, "metadata-failure.json"),
        "utf-8"
      );
      expect(JSON.parse(failureText)).toMatchObject({
        bodyBytes: Buffer.byteLength(invalidBody),
        bodySha256: hash(invalidBody),
        classification: "sdk-invalid-response",
        httpStatus: 200,
      });
      expect(failureText).not.toContain("private value");
    } finally {
      vi.unstubAllGlobals();
      if (previousGatewayKey === undefined) {
        Reflect.deleteProperty(process.env, "AI_GATEWAY_API_KEY");
      } else {
        process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
      }
    }
  });

  it("fails closed when metadata exceeds the bounded diagnostic body size", async () => {
    const { options } = await fixture();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response("x".repeat(API_CAPABILITY_METADATA_MAX_RESPONSE_BYTES + 1))
      )
    );
    const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
    vi.stubGlobal("fetch", fetchMock);
    try {
      const terminal = await runApiImageCapability({
        ...options,
        generate: () => Promise.resolve(result()),
        getGenerationInfo: undefined,
      });
      expect(terminal).toMatchObject({
        accepted: false,
        metadataLookupAttempts: 1,
      });
      expect(
        JSON.parse(
          readFileSync(
            path.join(options.evidenceDirectory, "metadata-failure.json"),
            "utf-8"
          )
        )
      ).toMatchObject({
        bodySha256: null,
        classification: "response-too-large",
        httpStatus: 200,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      if (previousGatewayKey === undefined) {
        Reflect.deleteProperty(process.env, "AI_GATEWAY_API_KEY");
      } else {
        process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
      }
    }
  });

  it.each([
    ["generation", { id: "another-generation" }],
    ["model", { model: "google/another-model" }],
    ["provider", { providerName: "vertex" }],
    ["cost", { totalCost: 0.002 }],
    ["input usage", { promptTokens: 301 }],
    ["output usage", { reasoningTokens: 1 }],
    ["redistributed output usage", { completionTokens: 9, reasoningTokens: 1 }],
    ["cached input usage", { cachedTokens: 1 }],
    ["cache creation usage", { cacheCreationTokens: 1 }],
    ["search", { billableWebSearchCalls: 1 }],
  ])(
    "refuses server %s mismatch without another inference",
    async (_label, override) => {
      const { options } = await fixture();
      const generate = vi.fn(() => Promise.resolve(result()));
      const terminal = await runApiImageCapability({
        ...options,
        generate,
        getGenerationInfo: () =>
          Promise.resolve({ ...generationInfo(), ...override }),
      });
      expect(terminal).toMatchObject({
        accepted: false,
        chargeUsd: 0.001,
        generationId: "generation-test-1",
        inferenceAttempts: 1,
        metadataLookupAttempts: 1,
        metadataSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        reason: expect.stringContaining(
          "server generation identity or usage mismatch"
        ),
        routeIdentityVersion: API_CAPABILITY_ROUTE_IDENTITY,
        upstreamRevision: "undisclosed",
      });
      expect(generate).toHaveBeenCalledTimes(1);
    }
  );

  it("retains the known inference charge when metadata lookup fails", async () => {
    const { options } = await fixture();
    const generate = vi.fn(() => Promise.resolve(result()));
    const lookup = vi.fn(() => Promise.reject(new Error("metadata timeout")));
    const terminal = await runApiImageCapability({
      ...options,
      generate,
      getGenerationInfo: lookup,
    });
    expect(terminal).toMatchObject({
      accepted: false,
      chargeUsd: 0.001,
      generationId: "generation-test-1",
      inferenceAttempts: 1,
      metadataFailureSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      metadataLookupAttempts: 1,
      metadataSha256: null,
      reason: "API capability metadata lookup failed",
      routeIdentityVersion: API_CAPABILITY_ROUTE_IDENTITY,
      upstreamRevision: "undisclosed",
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(
        readFileSync(
          path.join(options.evidenceDirectory, "metadata-failure.json"),
          "utf-8"
        )
      )
    ).toMatchObject({
      bodyBytes: null,
      bodySha256: null,
      classification: "unknown",
      httpStatus: null,
    });
    expect(
      JSON.parse(
        readFileSync(
          path.join(options.evidenceDirectory, "metadata-attempt.json"),
          "utf-8"
        )
      )
    ).toMatchObject({
      generationId: "generation-test-1",
      maxCalls: 1,
    });
  });

  it("refuses metadata arriving after the original request deadline", async () => {
    const { options } = await fixture();
    let current = options.startedAt + 1000;
    const terminal = await runApiImageCapability({
      ...options,
      generate: () => Promise.resolve(result()),
      getGenerationInfo: () => {
        current = options.deadlineAt;
        return Promise.resolve(generationInfo());
      },
      now: () => current,
    });
    expect(terminal).toMatchObject({
      accepted: false,
      reason: expect.stringContaining("after original deadline"),
    });
  });

  it("rejects wrong image bytes before intent or dispatch", async () => {
    const { options } = await fixture();
    const generate = vi.fn<ApiImageCapabilityGenerator>();
    await expect(
      runApiImageCapability({
        ...options,
        expectedImageSha256: "0".repeat(64),
        generate,
      })
    ).rejects.toThrow("frozen hash");
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects oversized images before dispatch", async () => {
    const { options } = await fixture(385, 16);
    const generate = vi.fn<ApiImageCapabilityGenerator>();
    await expect(
      runApiImageCapability({ ...options, generate })
    ).rejects.toThrow("no larger than 384px");
    expect(generate).not.toHaveBeenCalled();
  });

  it("binds the full-context conservative price ceiling before dispatch", async () => {
    expect(API_CAPABILITY_MAX_INPUT_TOKENS).toBe(1_048_576);
    expect(API_CAPABILITY_MAX_USD).toBe(
      (1_048_576 * 0.75 + 512 * 3.75) / 1_000_000
    );
    const { options } = await fixture();
    const generate = vi.fn<ApiImageCapabilityGenerator>();
    await expect(
      runApiImageCapability({ ...options, generate, reservedMaxUsd: 0.02 })
    ).rejects.toThrow("price or reservation identity drifted");
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects a start before the verified price period", async () => {
    const { options } = await fixture();
    const generate = vi.fn<ApiImageCapabilityGenerator>();
    await expect(
      runApiImageCapability({
        ...options,
        deadlineAt:
          API_CAPABILITY_PRICING_VALID_FROM - 1 + API_CAPABILITY_DEADLINE_MS,
        generate,
        now: () => API_CAPABILITY_PRICING_VALID_FROM,
        startedAt: API_CAPABILITY_PRICING_VALID_FROM - 1,
      })
    ).rejects.toThrow("price or reservation identity drifted");
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects a start after the verified price period", async () => {
    const { options } = await fixture();
    const generate = vi.fn<ApiImageCapabilityGenerator>();
    await expect(
      runApiImageCapability({
        ...options,
        deadlineAt:
          API_CAPABILITY_PRICING_VALID_BEFORE + API_CAPABILITY_DEADLINE_MS,
        generate,
        now: () => API_CAPABILITY_PRICING_VALID_BEFORE + 1000,
        startedAt: API_CAPABILITY_PRICING_VALID_BEFORE,
      })
    ).rejects.toThrow("price or reservation identity drifted");
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects an expired or reset original deadline", async () => {
    const { options } = await fixture();
    const generate = vi.fn<ApiImageCapabilityGenerator>();
    await expect(
      runApiImageCapability({
        ...options,
        deadlineAt: options.deadlineAt + 1,
        generate,
      })
    ).rejects.toThrow("deadline");
    expect(generate).not.toHaveBeenCalled();
  });

  it("uses raw Gateway routing rather than the SDK fallback model id", async () => {
    const { options } = await fixture();
    const generate = vi.fn<ApiImageCapabilityGenerator>(() =>
      Promise.resolve(
        result({
          response: {
            id: "response-test-1",
            modelId: "google/gemini-3.7-flash-alias",
          },
        })
      )
    );
    await expect(
      runApiImageCapability({ ...options, generate })
    ).resolves.toMatchObject({
      accepted: true,
      chargeUsd: 0.001,
      resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    await expect(
      runApiImageCapability({ ...options, generate })
    ).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("rejects missing Gateway generation and response identities", async () => {
    const first = await fixture();
    await expect(
      runApiImageCapability({
        ...first.options,
        generate: () =>
          Promise.resolve(
            result({
              providerMetadata: {
                gateway: { ...routing().gateway, generationId: undefined },
              },
            })
          ),
      })
    ).resolves.toMatchObject({
      accepted: false,
      reason: expect.stringContaining("route identity"),
    });

    const second = await fixture();
    await expect(
      runApiImageCapability({
        ...second.options,
        generate: () =>
          Promise.resolve(
            result({
              response: { id: "", modelId: API_CAPABILITY_MODEL },
            })
          ),
      })
    ).resolves.toMatchObject({
      accepted: false,
      reason: expect.stringContaining("route identity"),
    });
  });

  it("rejects provider fallback and multiple attempts", async () => {
    const { options } = await fixture();
    const generate = vi.fn<ApiImageCapabilityGenerator>(() =>
      Promise.resolve(
        result({
          providerMetadata: routing({
            finalProvider: "vertex",
            modelAttempts: 2,
          }),
        })
      )
    );
    await expect(
      runApiImageCapability({ ...options, generate })
    ).resolves.toMatchObject({
      accepted: false,
      reason: expect.stringContaining("route identity"),
    });
  });

  it("rejects a mismatched raw provider API model identity", async () => {
    const { options } = await fixture();
    const generate = vi.fn<ApiImageCapabilityGenerator>(() =>
      Promise.resolve(
        result({
          providerMetadata: routing({
            providerApiModelId: "gemini-3.7-flash-alias",
          }),
        })
      )
    );
    await expect(
      runApiImageCapability({ ...options, generate })
    ).resolves.toMatchObject({
      accepted: false,
      reason: expect.stringContaining("route identity"),
    });
  });

  it("rejects an unknown exact charge", async () => {
    const { options } = await fixture();
    const generate = vi.fn<ApiImageCapabilityGenerator>(() =>
      Promise.resolve(
        result({ providerMetadata: routing({ cost: "unknown" }) })
      )
    );
    await expect(
      runApiImageCapability({ ...options, generate })
    ).resolves.toMatchObject({
      accepted: false,
      reason: expect.stringContaining("charge is unknown"),
    });
  });

  it("rejects a response that settles after the original deadline", async () => {
    const { options } = await fixture();
    let calls = 0;
    const now = () => {
      calls += 1;
      return calls < 3 ? options.startedAt + 1000 : options.deadlineAt + 1;
    };
    const terminal = await runApiImageCapability({
      ...options,
      generate: () => Promise.resolve(result()),
      now,
    });
    expect(terminal).toMatchObject({
      accepted: false,
      reason: expect.stringContaining("route identity"),
    });
  });

  it("preserves a thrown attempt as terminal and never retries", async () => {
    const { options } = await fixture();
    const generate = vi.fn<ApiImageCapabilityGenerator>(() =>
      Promise.reject(new Error("provider refused"))
    );
    const terminal = await runApiImageCapability({ ...options, generate });
    expect(terminal).toMatchObject({
      accepted: false,
      reason: "provider refused",
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      readFileSync(
        path.join(options.evidenceDirectory, "attempt.json"),
        "utf-8"
      )
    ).toContain("attemptedAt");
  });
});

describe("API collector stage boundary", () => {
  it("preserves a longer parent clock while bounding the nested stage", async () => {
    const { descriptor, options } = await collectorFixture();
    const nestedDescriptor = {
      ...descriptor,
      originalDeadlineAt: options.startedAt + 300_000,
    };
    writeFileSync(
      options.descriptorFile,
      `${JSON.stringify(nestedDescriptor, null, 2)}\n`,
      { mode: 0o600 }
    );
    const outcome = await runApiCollectorStage(
      {
        ...options,
        descriptorSha256: hash(readFileSync(options.descriptorFile)),
      },
      (capability, summary) =>
        withVerifiedApiCollectorStage(
          capability,
          {
            actor: nestedDescriptor.actor,
            instrumentHash: nestedDescriptor.instrumentHash,
            orderedAttachments: summary.orderedAttachments,
            originalDeadlineAt: nestedDescriptor.originalDeadlineAt,
            outputSha256: summary.outputSha256,
            requestId: nestedDescriptor.requestId,
            role: nestedDescriptor.role,
            routeHash: nestedDescriptor.routeHash,
            stageDeadlineAt: nestedDescriptor.stageDeadlineAt,
          },
          () => summary.originalDeadlineAt
        )
    );
    expect(outcome).toMatchObject({
      terminal: { accepted: true },
      value: nestedDescriptor.originalDeadlineAt,
    });
  });

  it("seals five ordered answers and exposes injected transport as test-only", async () => {
    const { answers, descriptor, generate, options } = await collectorFixture();
    let escapedCapability: unknown;
    const outcome = await runApiCollectorStage(
      options,
      (capability, summary) => {
        escapedCapability = capability;
        expect(summary.transportAuthority).toBe("offline-test-only");
        expect(summary.orderedAttachments).toEqual(
          descriptor.orderedAttachments.map(({ name, sha256 }) => ({
            name,
            sha256,
          }))
        );
        return withVerifiedApiCollectorStage(
          capability,
          {
            actor: descriptor.actor,
            instrumentHash: descriptor.instrumentHash,
            orderedAttachments: summary.orderedAttachments,
            originalDeadlineAt: descriptor.originalDeadlineAt,
            outputSha256: summary.outputSha256,
            promptSha256: summary.promptSha256,
            requestId: descriptor.requestId,
            role: descriptor.role,
            routeHash: descriptor.routeHash,
            stageDeadlineAt: descriptor.stageDeadlineAt,
          },
          (evidence) => {
            expect(evidence.answers).toEqual(answers);
            return evidence.transportAuthority;
          }
        );
      }
    );
    expect(outcome).toMatchObject({
      terminal: { accepted: true },
      value: "offline-test-only",
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(() =>
      withVerifiedApiCollectorStage(
        escapedCapability as never,
        {} as never,
        () => {}
      )
    ).toThrow("unavailable or consumed");
    expect(() =>
      withVerifiedApiCollectorStage({} as never, {} as never, () => {})
    ).toThrow("unavailable or consumed");
  });

  it("refuses a copied descriptor identity before dispatch", async () => {
    const { descriptor, generate, options } = await collectorFixture();
    const copiedFile = path.join(
      path.dirname(options.descriptorFile),
      "copy.json"
    );
    writeFileSync(copiedFile, `${JSON.stringify(descriptor, null, 2)}\n`, {
      mode: 0o600,
    });
    await expect(
      runApiCollectorStage(
        {
          ...options,
          descriptorFile: copiedFile,
          descriptorSha256: hash(readFileSync(copiedFile)),
        },
        () => {}
      )
    ).rejects.toThrow("descriptor is invalid");
    expect(generate).not.toHaveBeenCalled();
  });

  it("refuses reordered attachment bytes before dispatch", async () => {
    const { descriptor, generate, images, options } = await collectorFixture();
    const [firstImage, secondImage] = images;
    const [firstAttachment, secondAttachment] = descriptor.orderedAttachments;
    if (!(firstImage && secondImage && firstAttachment && secondAttachment)) {
      throw new Error("collector fixture attachments are missing");
    }
    writeFileSync(firstImage.file, secondImage.bytes, { mode: 0o600 });
    await expect(runApiCollectorStage(options, () => {})).rejects.toThrow(
      "attachment bytes changed"
    );
    expect(generate).not.toHaveBeenCalled();
    expect(firstAttachment.sha256).not.toBe(secondAttachment.sha256);
  });

  it("latches STOP before a collector dispatch", async () => {
    const { generate, options } = await collectorFixture();
    writeFileSync(options.stopFile, "stop\n", { mode: 0o600 });
    const outcome = await runApiCollectorStage(options, () => {});
    expect(outcome).toMatchObject({
      accepted: false,
      inferenceAttempts: 0,
      reason: "API capability stopped by root sentinel",
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("durably refuses a second issuance of the same descriptor", async () => {
    const { descriptor, generate, options } = await collectorFixture();
    await runApiCollectorStage(options, (capability, summary) =>
      withVerifiedApiCollectorStage(
        capability,
        {
          actor: descriptor.actor,
          instrumentHash: descriptor.instrumentHash,
          orderedAttachments: summary.orderedAttachments,
          originalDeadlineAt: descriptor.originalDeadlineAt,
          outputSha256: summary.outputSha256,
          requestId: descriptor.requestId,
          role: descriptor.role,
          routeHash: descriptor.routeHash,
          stageDeadlineAt: descriptor.stageDeadlineAt,
        },
        () => {}
      )
    );
    const secondEvidence = path.join(
      path.dirname(options.evidenceDirectory),
      "second"
    );
    mkdirSync(secondEvidence, { mode: 0o700 });
    await expect(
      runApiCollectorStage(
        { ...options, evidenceDirectory: secondEvidence },
        () => {}
      )
    ).rejects.toThrow("already exists");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed five-answer response", async () => {
    const { generate, options } = await collectorFixture();
    const validImplementation = generate.getMockImplementation();
    if (!validImplementation) {
      throw new Error("collector fixture generator is missing");
    }
    generate.mockImplementationOnce(async (input) => {
      const valid = await validImplementation(input);
      const criticalAnswer = valid.object["fixture-critical"];
      if (!criticalAnswer) {
        throw new Error("collector fixture answer is missing");
      }
      return {
        ...valid,
        object: {
          "fixture-critical": criticalAnswer,
        },
      };
    });
    const outcome = await runApiCollectorStage(options, () => {});
    expect(outcome).toMatchObject({
      accepted: false,
      reason: expect.stringContaining("Required"),
    });
  });

  it("refuses post-issuance attachment mutation during verification", async () => {
    const { descriptor, images, options } = await collectorFixture();
    await expect(
      runApiCollectorStage(options, (capability, summary) => {
        const [firstImage] = images;
        if (!firstImage) {
          throw new Error("collector fixture attachment is missing");
        }
        writeFileSync(firstImage.file, Buffer.from("changed"), { mode: 0o600 });
        return withVerifiedApiCollectorStage(
          capability,
          {
            actor: descriptor.actor,
            instrumentHash: descriptor.instrumentHash,
            orderedAttachments: summary.orderedAttachments,
            originalDeadlineAt: descriptor.originalDeadlineAt,
            outputSha256: summary.outputSha256,
            requestId: descriptor.requestId,
            role: descriptor.role,
            routeHash: descriptor.routeHash,
            stageDeadlineAt: descriptor.stageDeadlineAt,
          },
          () => {}
        );
      })
    ).rejects.toThrow("attachment identity changed");
  });

  it("refuses a mismatched verification expectation", async () => {
    const { descriptor, options } = await collectorFixture();
    await expect(
      runApiCollectorStage(options, (capability, summary) =>
        withVerifiedApiCollectorStage(
          capability,
          {
            actor: descriptor.actor,
            instrumentHash: descriptor.instrumentHash,
            orderedAttachments: summary.orderedAttachments,
            originalDeadlineAt: descriptor.originalDeadlineAt,
            outputSha256: hash("wrong output"),
            requestId: descriptor.requestId,
            role: descriptor.role,
            routeHash: descriptor.routeHash,
            stageDeadlineAt: descriptor.stageDeadlineAt,
          },
          () => {}
        )
      )
    ).rejects.toThrow("verification expectation changed");
  });

  it("revokes an unconsumed capability when the live callback exits", async () => {
    const { options } = await collectorFixture();
    let escapedCapability: unknown;
    await runApiCollectorStage(options, (capability) => {
      escapedCapability = capability;
    });
    expect(() =>
      withVerifiedApiCollectorStage(
        escapedCapability as never,
        {} as never,
        () => {}
      )
    ).toThrow("unavailable or consumed");
  });
});

it("validates the installed SDK serialized wire body despite omitted optional fields", async () => {
  const { options, answers } = await collectorFixture();
  let wireBody: unknown;
  const transport = vi.fn((_url: unknown, init?: RequestInit) => {
    wireBody = JSON.parse(String(init?.body));
    return Promise.resolve(
      Response.json({
        content: [{ text: JSON.stringify(answers), type: "text" }],
        finishReason: { raw: "STOP", unified: "stop" },
        providerMetadata: routing(),
        usage: {
          inputTokens: { cacheRead: 0, noCache: 300, total: 300 },
          outputTokens: { reasoning: 0, text: 10, total: 10 },
        },
        warnings: [],
      })
    );
  });
  const model = createGateway({
    apiKey: "offline-no-credential",
    fetch: transport,
  })(API_CAPABILITY_MODEL);
  const outcome = await runApiCollectorStage(
    { ...options, generate: undefined, resolve: () => model },
    () => null
  );
  expect(outcome).toMatchObject({
    terminal: {
      accepted: true,
      inferenceAttempts: 1,
      metadataLookupAttempts: 1,
    },
  });
  expect(transport).toHaveBeenCalledTimes(1);
  const requestEvidence = JSON.parse(
    readFileSync(
      path.join(options.evidenceDirectory, "serialized-request.json"),
      "utf-8"
    )
  );
  expect(wireBody).toBeDefined();
  expect(requestEvidence).toEqual(wireBody);
});

it("retains sanitized collector metadata HTTP failure and terminal hash without retry", async () => {
  const { options } = await collectorFixture();
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response("private-response-body", { status: 404 }))
  );
  const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
  vi.stubGlobal("fetch", fetchMock);
  try {
    const terminal = await runApiCollectorStage(
      { ...options, getGenerationInfo: undefined },
      () => null
    );
    const bytes = readFileSync(
      path.join(options.evidenceDirectory, "metadata-failure.json")
    );
    expect(terminal).toMatchObject({
      accepted: false,
      metadataFailureSha256: hash(bytes),
      metadataLookupAttempts: 1,
    });
    expect(JSON.parse(bytes.toString("utf-8"))).toMatchObject({
      bodySha256: hash("private-response-body"),
      httpStatus: 404,
    });
    expect(bytes.toString("utf-8")).not.toContain("private-response-body");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
    if (previousGatewayKey === undefined) {
      Reflect.deleteProperty(process.env, "AI_GATEWAY_API_KEY");
    } else {
      process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
    }
  }
}, 35_000);

it("aborts the canonical readiness wait on STOP without a metadata request", async () => {
  const { options } = await collectorFixture();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const stopTimer = setTimeout(() => {
    writeFileSync(options.stopFile, "stop\n", { mode: 0o600 });
  }, 100);
  try {
    const terminal = await runApiCollectorStage(
      { ...options, getGenerationInfo: undefined },
      () => null
    );
    expect(terminal).toMatchObject({
      accepted: false,
      inferenceAttempts: 1,
      metadataLookupAttempts: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    clearTimeout(stopTimer);
    vi.unstubAllGlobals();
  }
});

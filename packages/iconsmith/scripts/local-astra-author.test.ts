import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import {
  ASTRA_STRUCTURED_AUTHOR_MODEL,
  astraConstructionJsonSchema,
  nativeAstraAuthorAdapters,
  parseAstraStructuredOutput,
  runNativeAstraStructuredAuthor,
  validateAstraCollectorRequest,
  validateAstraStructuredTrace,
} from "./local-astra-author.js";
import { finalReviewJsonSchema } from "./local-claude-author.js";

const context = (model: string) =>
  JSON.stringify({ payload: { model }, type: "turn_context" });
const session = (id = "00000000-0000-0000-0000-000000000001") =>
  JSON.stringify({ payload: { id }, type: "session_meta" });
const trace = (model: string) => `${session()}\n${context(model)}`;

it("rejects tool use and a substituted model in native traces", () => {
  expect(() =>
    validateAstraStructuredTrace(
      `${trace(ASTRA_STRUCTURED_AUTHOR_MODEL)}\n${JSON.stringify({ payload: { type: "local_shell_call" }, type: "response_item" })}`
    )
  ).toThrow("prohibited tool");
  expect(() => validateAstraStructuredTrace(trace("gpt-5.6-sol"))).toThrow(
    "model identity"
  );
  expect(() =>
    validateAstraStructuredTrace(trace(ASTRA_STRUCTURED_AUTHOR_MODEL))
  ).not.toThrow();
  expect(() =>
    validateAstraStructuredTrace(
      `${trace(ASTRA_STRUCTURED_AUTHOR_MODEL)}\n${JSON.stringify({ payload: { content: [{ text: "<skills_instructions>" }], role: "developer", type: "message" }, type: "response_item" })}`
    )
  ).toThrow("catalog");
  expect(() =>
    validateAstraStructuredTrace(context(ASTRA_STRUCTURED_AUTHOR_MODEL))
  ).toThrow("session identity");
  expect(() =>
    validateAstraStructuredTrace(
      `${trace(ASTRA_STRUCTURED_AUTHOR_MODEL)}\n${session("00000000-0000-0000-0000-000000000002")}`
    )
  ).toThrow("session identity");
});

const expectStrictRequiredProperties = (schema: unknown) => {
  if (typeof schema !== "object" || schema === null) {
    return;
  }
  const record = schema as Record<string, unknown>;
  const properties = record.properties as Record<string, unknown> | undefined;
  if (properties) {
    expect(record.required).toEqual(Object.keys(properties));
    for (const child of Object.values(properties)) {
      expectStrictRequiredProperties(child);
    }
  }
  if (record.items) {
    expectStrictRequiredProperties(record.items);
  }
};

it("serializes every Astra object property as required", () => {
  expectStrictRequiredProperties(astraConstructionJsonSchema);
  expectStrictRequiredProperties(finalReviewJsonSchema);
  expect(astraConstructionJsonSchema.properties.programs).toMatchObject({
    required: ["filled", "outlined"],
  });
});

it("requires an interrupted Astra response to be the terminal item", () => {
  const review = JSON.stringify({
    reviewMarkdown: "Final proof retained.",
    unresolved: [],
  });
  const terminal = JSON.stringify({
    item: { text: review, type: "agent_message" },
    type: "item.completed",
  });
  expect(parseAstraStructuredOutput(terminal, true)).toMatchObject({
    unresolved: [],
  });
  expect(() =>
    parseAstraStructuredOutput(
      `${terminal}\n${JSON.stringify({ item: { type: "reasoning" }, type: "item.completed" })}`,
      true
    )
  ).toThrow("activity followed interrupted final output");
  expect(() =>
    parseAstraStructuredOutput(`${terminal}\n${terminal}`, true)
  ).toThrow("Missing unambiguous");
});

it("binds collector request bytes to the exact invocation and attachments", () => {
  const image = Buffer.from("anchor");
  const invocation = {
    deadlineAt: 123_456,
    env: {},
    images: { "anchor.png": image },
    out: "/runtime",
    prompt: "Draw the exact candidate.",
    schema: { type: "object" },
  };
  const request = {
    model: ASTRA_STRUCTURED_AUTHOR_MODEL,
    prompt: invocation.prompt,
    schema: invocation.schema,
    stageDeadlineAt: invocation.deadlineAt,
    visualReferences: {
      "anchor.png": createHash("sha256").update(image).digest("hex"),
    },
  };
  expect(() =>
    validateAstraCollectorRequest(
      JSON.stringify(request),
      invocation,
      ASTRA_STRUCTURED_AUTHOR_MODEL
    )
  ).not.toThrow();
  for (const changed of [
    { ...request, model: "gpt-5.6-sol" },
    { ...request, prompt: "different" },
    { ...request, stageDeadlineAt: invocation.deadlineAt + 1 },
    { ...request, visualReferences: { "anchor.png": "0".repeat(64) } },
  ]) {
    expect(() =>
      validateAstraCollectorRequest(
        JSON.stringify(changed),
        invocation,
        ASTRA_STRUCTURED_AUTHOR_MODEL
      )
    ).toThrow("did not bind");
  }
});

it("exposes verified interruption provenance only on finalization", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "astra-finalize-salvage-"));
  const runtimeRoot = path.join(root, "runtime");
  mkdirSync(runtimeRoot);
  const deadlineAt = Date.now() + 60_000;
  const settlement = {
    accounting: "settled" as const,
    callId: "call-finalize",
    containerAbsent: true as const,
    containerId: "d".repeat(64),
    containment: "container-absent" as const,
    containmentScope: "docker-private-pid-namespace" as const,
    deadlineAt,
    evidenceFile: path.join(root, "settlement.json"),
    evidenceHash: "e".repeat(64),
    intentHash: "f".repeat(64),
    killed: true,
    kind: "verified-contained-finalization-interruption" as const,
    outcome: "failed" as const,
    processCode: null,
    quiescenceScope: "process-group-and-observed-descendants" as const,
    quiescent: true as const,
    settledAt: Date.now(),
    stage: "01-finalize",
  };
  const verifyInterruptedSettlement = vi.fn(() => settlement);
  const containerFactory = {
    create: vi.fn(({ ordinal }) => ({
      config: {
        environment: { CODEX_HOME: path.join(root, `state-${ordinal}`) },
      },
      scope: {},
      verifyInterruptedSettlement,
    })),
  };
  const invokeContained = vi.fn((_request, _container, _args, control) => {
    if (!control?.allowInterruptedFinalization) {
      throw new Error("nonfinal interruption refused");
    }
    return Promise.resolve({
      kind: "native-interrupted-invocation-completion",
      settlement: control.verifyInterruptedSettlement?.(),
      value: { reviewMarkdown: "Final proof retained.", unresolved: [] },
    });
  });
  try {
    const adapters = nativeAstraAuthorAdapters({
      concept: "ring",
      container: {} as never,
      containerFactory: containerFactory as never,
      deadlineAt,
      enableDiagnosticFinalizationInterruption: true,
      invokeContained: invokeContained as never,
      out: root,
      preflight: () => ({
        cliVersion: "test",
        executable: "/test/codex",
        executableSha256: "sha",
        loggedIn: true,
      }),
      prepareContext: () => Promise.resolve({ args: [], receiptName: "x" }),
      referenceImages: { "reference.png": Buffer.from("reference") },
      review: vi.fn() as never,
      runtimeRoot,
    });
    await expect(
      adapters.construct({
        collectorRequestId: "00000000-0000-0000-0000-000000000001",
        deadlineAt: deadlineAt - 20_000,
        defects: [],
        model: ASTRA_STRUCTURED_AUTHOR_MODEL,
        previousPrograms: {},
        prompt: "Draw.",
        stage: "construct",
      })
    ).rejects.toThrow("nonfinal interruption refused");
    const inspection = {
      defects: [],
      inspectionEvidence: "Exact proof inspected.",
      uncertainties: [],
    };
    const stageDeadlineAt = deadlineAt - 10_000;
    await expect(
      adapters.finalize({
        collectorRequestId: "00000000-0000-0000-0000-000000000002",
        deadlineAt: stageDeadlineAt,
        inspection,
        model: ASTRA_STRUCTURED_AUTHOR_MODEL,
        programHashes: { outlined: "a".repeat(64) },
      })
    ).resolves.toMatchObject({
      interruption: {
        kind: "structured-finalization-interruption",
        programHashes: { outlined: "a".repeat(64) },
        settlement,
        stageDeadlineAt,
      },
      kind: "structured-finalization-envelope",
      review: { unresolved: [] },
    });
    expect(verifyInterruptedSettlement).toHaveBeenCalledTimes(1);
    expect(invokeContained.mock.calls[0]?.[3]).toMatchObject({
      allowInterruptedFinalization: false,
    });
    expect(invokeContained.mock.calls[1]?.[3]).toMatchObject({
      allowInterruptedFinalization: true,
    });
    expect(containerFactory.create.mock.calls[1]?.[0]).toMatchObject({
      authorRequestBinding: {
        adapterRequestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        lifecycleRequestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        role: "finalizer",
      },
      deadlineAt,
      diagnosticFinalization: {
        inspectionHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        programHashes: { outlined: "a".repeat(64) },
        responseSchemaHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        stageDeadlineAt,
      },
      stageKind: "finalize",
    });
    expect(containerFactory.create.mock.calls[0]?.[0]).toMatchObject({
      authorRequestBinding: {
        adapterRequestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        lifecycleRequestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        role: "construct",
      },
      deadlineAt,
      stageKind: "construct",
    });
    const finalizationBytes = readFileSync(
      path.join(root, "01-finalize", "finalization-request.json"),
      "utf-8"
    );
    const finalizationReceipt = JSON.parse(finalizationBytes);
    expect(finalizationReceipt).toMatchObject({
      inspection,
      programHashes: { outlined: "a".repeat(64) },
      stageDeadlineAt,
    });
    expect(finalizationReceipt.prompt).toContain(
      "already named by a representation defect in Inspection"
    );
    expect(finalizationReceipt.prompt).toContain(
      "Uncertain visibility or recognition is evidence uncertainty"
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("refuses a reusable static container without a call factory", () => {
  expect(() =>
    nativeAstraAuthorAdapters({
      concept: "ring",
      container: {} as never,
      deadlineAt: Date.now() + 10_000,
      out: "/unused",
      referenceImages: { "reference.png": Buffer.from("reference") },
    })
  ).toThrow("call-scoped container factory");
});

it("allocates self-review from its own parent-deadline call scope", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "astra-call-scope-"));
  const receiptRoot = path.join(root, "receipts");
  const runtimeRoot = path.join(root, "runtime");
  mkdirSync(receiptRoot);
  mkdirSync(runtimeRoot);
  const deadlineAt = Date.now() + 60_000;
  const config = { namePrefix: "call-specific" };
  const containerFactory = {
    create: vi.fn(() => ({ config, scope: {} })),
  };
  const review = vi.fn(() =>
    Promise.resolve({
      answers: {
        "author-self-review-outlined": {
          choice: "pass",
          evidence: "Open counter.",
          treatment: "",
        },
      },
      collectorInspectionTrace: {} as never,
      evidenceHashes: {},
      model: ASTRA_STRUCTURED_AUTHOR_MODEL,
      status: "complete" as const,
    })
  );
  try {
    const adapters = nativeAstraAuthorAdapters({
      concept: "ring",
      containerFactory: containerFactory as never,
      deadlineAt,
      invoke: vi.fn(),
      out: receiptRoot,
      preflight: () => ({
        cliVersion: "test",
        executable: "/test/codex",
        executableSha256: "sha",
        loggedIn: true,
      }),
      referenceImages: { "reference.png": Buffer.from("reference") },
      review: review as never,
      runtimeRoot,
    });
    await adapters.inspect({
      collectorRequestId: "00000000-0000-0000-0000-000000000005",
      deadlineAt: deadlineAt - 10_000,
      lifecycleRequestSha256: "d".repeat(64),
      model: ASTRA_STRUCTURED_AUTHOR_MODEL,
      programHashes: { outlined: "program-hash" },
      proofHashes: { outlined: "proof-hash" },
      proofs: { outlined: Buffer.from("proof") },
    });
    expect(containerFactory.create).not.toHaveBeenCalled();
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({
        deadlineAt: deadlineAt - 10_000,
        nativeCall: {
          containerFactory,
          inspectionLifecycle: {
            collectorRequestId: "00000000-0000-0000-0000-000000000005",
            lifecycleRequestSha256: "d".repeat(64),
            programHashes: { outlined: "program-hash" },
            proofHashes: { outlined: "proof-hash" },
          },
          ordinal: 0,
          parentDeadlineAt: deadlineAt,
          runtimeCwd: path.join(runtimeRoot, "00-author-self-review"),
          stageKind: "author-self-review",
        },
        out: path.join(receiptRoot, "00-author-self-review"),
      })
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("preflights every Astra call against its own container state", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "astra-context-scope-"));
  const runtimeRoot = path.join(root, "runtime");
  mkdirSync(runtimeRoot);
  const deadlineAt = Date.now() + 60_000;
  const containerFactory = {
    create: vi.fn(({ ordinal }) => ({
      config: {
        environment: { CODEX_HOME: path.join(root, `state-${ordinal}`) },
      },
      scope: {},
    })),
  };
  const prepareContext = vi.fn(({ container }) =>
    Promise.resolve({
      args: [container.environment.CODEX_HOME],
      receiptName: "context-preflight.json",
    })
  );
  const invokeContained = vi.fn((_request, _container, contextArgs) =>
    Promise.resolve({
      addressedDefectIds: [],
      contextArgs,
      programs: { outlined: "icon ring\nfinish outlined\ncircle 12,12 r8" },
    })
  );
  try {
    const adapters = nativeAstraAuthorAdapters({
      concept: "ring",
      container: {} as never,
      containerFactory: containerFactory as never,
      deadlineAt,
      invokeContained: invokeContained as never,
      out: root,
      preflight: () => ({
        cliVersion: "test",
        executable: "/test/codex",
        executableSha256: "sha",
        loggedIn: true,
      }),
      prepareContext: prepareContext as never,
      referenceImages: { "reference.png": Buffer.from("reference") },
      review: vi.fn() as never,
      runtimeRoot,
    });
    const construct = (stage: "construct" | "repair") =>
      adapters.construct({
        collectorRequestId: `00000000-0000-0000-0000-00000000000${
          stage === "construct" ? "3" : "4"
        }`,
        deadlineAt: deadlineAt - 10_000,
        defects: [],
        model: ASTRA_STRUCTURED_AUTHOR_MODEL,
        previousPrograms: {},
        prompt:
          "Draw a ring.\nLAYOUT CONTEXT\nNo cohort measurements are supplied to the host checker for this request. Do not emit `cohort`. A `keyline` declaration asserts both axes. Removing an incompatible declaration changes the claim, not the native footprint.",
        stage,
      });
    await construct("construct");
    await construct("repair");
    expect(prepareContext).toHaveBeenCalledTimes(2);
    expect(prepareContext.mock.calls.map((call) => call[0].deadlineAt)).toEqual(
      [deadlineAt - 10_000, deadlineAt - 10_000]
    );
    expect(
      prepareContext.mock.calls[0]?.[0].container.environment.CODEX_HOME
    ).toBe(path.join(root, "state-0"));
    expect(
      prepareContext.mock.calls[1]?.[0].container.environment.CODEX_HOME
    ).toBe(path.join(root, "state-1"));
    expect(invokeContained.mock.calls.map((call) => call[2])).toEqual([
      [path.join(root, "state-0")],
      [path.join(root, "state-1")],
    ]);
    const prompts = invokeContained.mock.calls.map(
      (call) => call[0].prompt as string
    );
    expect(prompts[0]).toContain("Prior submitted programs:");
    expect(prompts[1]).toContain(
      "Prior submitted programs (host validity is not implied):"
    );
    expect(prompts[1]).not.toContain("Previous host-valid programs");
    expect(prompts).toSatisfy((values: string[]) =>
      values.every(
        (value) =>
          value.includes("No cohort measurements are supplied") &&
          value.includes("Do not emit `cohort`") &&
          value.includes("A `keyline` declaration asserts both axes") &&
          value.includes(
            "Removing an incompatible declaration changes the claim, not the native footprint"
          )
      )
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("runs Astra through the shared structured lifecycle", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "astra-structured-"));
  const out = path.join(root, "run");
  const invoke = vi.fn(({ images, prompt, schema }) =>
    schema === astraConstructionJsonSchema
      ? (expect(images).toEqual({ "reference.png": Buffer.from("reference") }),
        Promise.resolve({
          addressedDefectIds: [],
          programs: {
            filled: null,
            outlined: "icon ring\nfinish outlined\ncircle 12,12 r8",
          },
        }))
      : (expect(prompt).toContain("cannot change or return geometry"),
        Promise.resolve({
          reviewMarkdown: "Exact proof inspected.",
          unresolved: [],
        }))
  );
  const review = vi.fn(({ images, model, out: reviewOut }) => {
    // The production reviewer owns this directory and creates it on entry.
    mkdirSync(reviewOut, { recursive: false });
    return Promise.resolve({
      answers: {
        "author-self-review-outlined": {
          choice: "pass",
          evidence: "Counter remains open.",
          treatment: "",
        },
      },
      evidenceHashes: Object.fromEntries(
        Object.keys(images).map((name) => [name, "hash"])
      ),
      model,
      status: "complete" as const,
    });
  });
  try {
    const result = await runNativeAstraStructuredAuthor({
      check: () =>
        Promise.resolve({
          proofs: { outlined: Buffer.from("png") },
          status: 0,
          stderr: "",
          stdout: "ok",
        }),
      concept: "ring",
      deadlineAt: Date.now() + 600_000,
      finishes: ["outlined"],
      invoke,
      out,
      preflight: () => ({
        cliVersion: "test",
        executable: "/test/codex",
        executableSha256: "sha",
        loggedIn: true,
      }),
      prompt: "Draw a ring.",
      referenceImages: { "reference.png": Buffer.from("reference") },
      review: review as never,
    });
    expect(result).toMatchObject({
      model: ASTRA_STRUCTURED_AUTHOR_MODEL,
      status: "delivered",
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({
        images: expect.objectContaining({
          "anchor-reference.png": Buffer.from("reference"),
          "outlined-proof.png": Uint8Array.from(Buffer.from("png")),
        }),
        model: ASTRA_STRUCTURED_AUTHOR_MODEL,
      })
    );
    expect(
      JSON.parse(
        readFileSync(path.join(out, "native-astra-author.json"), "utf-8")
      )
    ).toMatchObject({
      requestedModel: ASTRA_STRUCTURED_AUTHOR_MODEL,
      selfInspection: true,
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

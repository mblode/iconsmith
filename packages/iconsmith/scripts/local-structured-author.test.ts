import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { createFamilyReferencePacket } from "./family-reference-packet.js";
import { createNativeCallContainerFactory } from "./local-native-call-factory.js";
import {
  bindDiagnosticFinalizationPlan,
  materializeDiagnosticFinalizationPlan,
  readDiagnosticFinalizationPlan,
} from "./local-native-interruption-diagnostic.js";
import {
  replayStructuredAuthorEvidence,
  runStructuredAuthor,
  STRUCTURED_AUTHOR_MODEL,
  STRUCTURED_FINAL_STAGES_RESERVE_MS,
  STRUCTURED_INITIAL_CONSTRUCTION_CAP_MS,
  STRUCTURED_INSPECTION_RESERVE_MS,
} from "./local-structured-author.js";
import { createNativeCallBoundary } from "./native-call-boundary.js";

it("reserves 150 seconds for proof inspection", () => {
  expect(STRUCTURED_INSPECTION_RESERVE_MS).toBe(150_000);
});

const program = (radius: number) =>
  `icon ring\nfinish outlined\ncircle 12,12 r${radius}`;

const diagnosticCapabilityFixture = (options: {
  deadlineAt: number;
  descriptorReceipt: string;
  image: string;
  requestId: string;
  reservationHash: string;
  root: string;
  routeHash: string;
}) => {
  const packet = createFamilyReferencePacket({
    concept: "folder-lock",
    excludedFamilies: ["folder-lock"],
    excludedSourceHashes: [],
    librarySet: "blode-icons",
    librarySourceHash: "1".repeat(64),
    sources: [
      {
        admissionRequested: false,
        intent: {
          evidence: "folder body",
          polarity: "body",
          treatment: "preserve",
        },
        source: {
          finish: "outlined",
          name: "folder",
          provenance: {
            date: "2026-09-09",
            origin: "literal",
            set: "blode-icons",
          },
          svg: '<svg viewBox="0 0 24 24"><path d="M3 5H21V20H3Z"/></svg>',
        },
      },
    ],
  });
  const packetFile = path.join(options.root, "diagnostic-packet.json");
  const packetBytes = `${JSON.stringify(packet)}\n`;
  writeFileSync(packetFile, packetBytes);
  const revisionFile = path.join(options.root, "diagnostic-revision.json");
  const revisionBytes = '{"revision":"fixture"}\n';
  writeFileSync(revisionFile, revisionBytes);
  const planFile = path.join(options.root, "diagnostic-plan.json");
  const plan = {
    campaignHash: "2".repeat(64),
    expiresAt: options.deadlineAt - 1,
    familyPacket: {
      file: packetFile,
      packetHash: packet.packetHash,
      sha256: createHash("sha256").update(packetBytes).digest("hex"),
    },
    image: options.image,
    kind: "iconsmith-finalization-interruption-plan-v1",
    maxWallMs: 60_000,
    planFile,
    qualification: false,
    revisionHash: createHash("sha256").update(revisionBytes).digest("hex"),
    routeHash: options.routeHash,
    schemaVersion: 1,
    target: {
      concept: "folder-lock",
      family: "folder",
      master: "16",
      slotIds: [
        "folder/folder-lock/16/outlined",
        "folder/folder-lock/16/filled",
      ],
    },
  } as const;
  const planBytes = `${JSON.stringify(plan)}\n`;
  writeFileSync(planFile, planBytes);
  const loaded = readDiagnosticFinalizationPlan({
    file: planFile,
    sha256: createHash("sha256").update(planBytes).digest("hex"),
  });
  return materializeDiagnosticFinalizationPlan({
    binding: bindDiagnosticFinalizationPlan({
      actual: {
        campaignHash: plan.campaignHash,
        concept: plan.target.concept,
        deadlineAt: options.deadlineAt,
        family: plan.target.family,
        familyPacket: plan.familyPacket,
        image: plan.image,
        master: plan.target.master,
        maxWallMs: plan.maxWallMs,
        requestId: options.requestId,
        revisionFile,
        revisionHash: plan.revisionHash,
        routeHash: plan.routeHash,
        slotIds: plan.target.slotIds,
      },
      loaded,
    }),
    descriptorReceipt: options.descriptorReceipt,
    reservationHash: options.reservationHash,
  });
};

it("repairs only a named observed defect and finalizes after proof inspection", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  const construct = vi
    .fn()
    .mockResolvedValueOnce({
      addressedDefectIds: [],
      programs: { outlined: program(8) },
    })
    .mockResolvedValueOnce({
      addressedDefectIds: ["small-counter"],
      programs: { outlined: program(9) },
    });
  const inspect = vi
    .fn()
    .mockResolvedValueOnce({
      defects: [
        {
          description: "Counter is too small at native size.",
          finish: "outlined",
          id: "small-counter",
          kind: "visual",
          treatment: "Increase the circle radius.",
        },
      ],
      inspectionEvidence: "Observed on the exact host proof.",
    })
    .mockResolvedValueOnce({
      defects: [],
      inspectionEvidence: "Counter remains visible.",
    });
  try {
    const result = await runStructuredAuthor({
      check: (cwd) =>
        Promise.resolve({
          proofs: {
            outlined: Buffer.from(
              readFileSync(path.join(cwd, "outlined.icon"))
            ),
          },
          status: 0,
          stderr: "",
          stdout: "check0",
        }),
      construct,
      deadlineAt: Date.now() + 600_000,
      finalize: ({ inspection, model }) => {
        expect(model).toBe(STRUCTURED_AUTHOR_MODEL);
        expect(inspection.defects).toEqual([]);
        return Promise.resolve({
          reviewMarkdown: "Inspected exact proof.",
          unresolved: [],
        });
      },
      finishes: ["outlined"],
      inspect,
      out,
      prompt: "Draw a ring with constrained DSL.",
    });
    expect(result.status).toBe("delivered");
    expect(result.authorEvidence).toMatchObject({
      authority: "process-local-factory-issued",
      completion: null,
      kind: "collector-sealed-author-lineage-v1",
      status: "missing-collector-seals",
    });
    expect(readFileSync(path.join(out, "outlined.icon"), "utf-8")).toBe(
      program(9)
    );
    expect(construct.mock.calls[1]?.[0]).toMatchObject({
      defects: [{ id: "small-counter" }],
      previousPrograms: { outlined: program(8) },
      stage: "repair",
    });
  } finally {
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("rejects a self-consistent-looking author envelope without factory authority", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "structured-forged-seal-"));
  try {
    await expect(
      runStructuredAuthor({
        check: () =>
          Promise.resolve({
            proofs: { outlined: Buffer.from("proof") },
            status: 0,
            stderr: "",
            stdout: "check0",
          }),
        construct: () =>
          Promise.resolve({
            collectorTrace: {
              file: path.join(root, "trace.jsonl"),
              receiptFile: path.join(root, "receipt.json"),
              receiptSha256: "a".repeat(64),
              sha256: "b".repeat(64),
            },
            kind: "collector-sealed-structured-author-call-v1",
          }),
        deadlineAt: Date.now() + 600_000,
        finalize: vi.fn(),
        finishes: ["outlined"],
        inspect: vi.fn(),
        out: path.join(root, "run"),
        prompt: "Draw.",
      })
    ).rejects.toThrow("lacks collector factory authority");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

// oxlint-disable-next-line eslint/complexity -- exercises the full collector lineage and each byte-mutation refusal in one fixture.
it("retains factory-sealed construct authors while separating the finalizer", async () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "structured-sealed-lineage-"))
  );
  const calls = path.join(root, "calls");
  const evidence = path.join(root, "evidence");
  const runtime = path.join(root, "runtime");
  const out = path.join(root, "out");
  const executable = path.join(root, "codex");
  for (const directory of [evidence, runtime]) {
    mkdirSync(directory);
  }
  writeFileSync(executable, "fixture");
  const deadlineAt = Date.now() + 600_000;
  const requestId = "d".repeat(64);
  const routeHash = "a".repeat(64);
  const reservationHash = createNativeCallBoundary(calls, {
    billing: "subscription",
    deadlineAt,
    maxCalls: 10,
    minimumCallReserveMs: 5000,
    reservationId: requestId,
    routeHash,
  });
  const diagnosticFinalization = diagnosticCapabilityFixture({
    deadlineAt,
    descriptorReceipt: path.join(evidence, "diagnostic-descriptor.json"),
    image: `debian@sha256:${"b".repeat(64)}`,
    requestId,
    reservationHash,
    root,
    routeHash,
  });
  const factory = createNativeCallContainerFactory({
    boundaryDirectory: calls,
    buildContainer: ({ stateDirectory }) => ({
      dockerCommand: "/usr/bin/docker",
      environment: { CODEX_HOME: stateDirectory },
      image: `debian@sha256:${"b".repeat(64)}`,
      namePrefix: "sealed-lineage",
      nativeCliVersion: "1.2.3",
      nativeCommand: "/runtime/codex",
      nativeExecutableHostPath: executable,
      nativeExecutableSha256: "c".repeat(64),
      stateMounts: [
        {
          containerPath: stateDirectory,
          hostPath: stateDirectory,
          readOnly: false,
        },
        {
          containerPath: "/runtime/codex",
          hostPath: executable,
          readOnly: true,
        },
      ],
    }),
    diagnosticFinalization,
    evidenceDirectory: evidence,
    minimumRemainingMs: 5000,
    parentDeadlineAt: deadlineAt,
    requestId,
    reservationHash,
    rootDirectory: runtime,
    stateEnvironmentName: "CODEX_HOME",
  });
  let interruptedSettlement:
    | ReturnType<
        ReturnType<typeof factory.create>["verifyInterruptedSettlement"]
      >
    | undefined;
  const seal = async (
    ordinal: number,
    role: "construct" | "finalizer",
    value: object,
    lifecycleRequest: object,
    interrupted = false
  ) => {
    const lifecycle = lifecycleRequest as Record<string, unknown>;
    const adapterRequest = interrupted
      ? `${JSON.stringify({
          inspection: lifecycle.inspection,
          programHashes: lifecycle.programHashes,
          schema: {},
          stageDeadlineAt: lifecycle.deadlineAt,
        })}\n`
      : JSON.stringify({ role });
    const finalizationDiagnostic = interrupted
      ? {
          finalizedReceiptHash: createHash("sha256")
            .update(adapterRequest)
            .digest("hex"),
          inspectionHash: createHash("sha256")
            .update(JSON.stringify(lifecycle.inspection))
            .digest("hex"),
          programHashes: lifecycle.programHashes as Readonly<
            Record<string, string>
          >,
          responseSchemaHash: createHash("sha256")
            .update(JSON.stringify({}))
            .digest("hex"),
          stageDeadlineAt: lifecycle.deadlineAt as number,
        }
      : undefined;
    const allocation = factory.create({
      authorRequestBinding: {
        adapterRequestSha256: createHash("sha256")
          .update(adapterRequest)
          .digest("hex"),
        lifecycleRequest: JSON.stringify(lifecycleRequest),
        lifecycleRequestSha256: createHash("sha256")
          .update(JSON.stringify(lifecycleRequest))
          .digest("hex"),
        role,
      },
      cwd: path.join(runtime, `${String(ordinal).padStart(2, "0")}-${role}`),
      deadlineAt,
      ...(finalizationDiagnostic
        ? { diagnosticFinalization: finalizationDiagnostic }
        : {}),
      ordinal,
      stageKind: role === "finalizer" ? "finalize" : role,
    });
    const structuredResponse = JSON.stringify(value);
    const stdout = `${JSON.stringify({
      item: { text: structuredResponse, type: "agent_message" },
      type: "item.completed",
    })}\n`;
    const identity = {
      containerId: `${ordinal + 1}`.repeat(64),
      containerName: `iconsmith-sealed-${role}`,
      image: allocation.config.image,
      ownershipToken: "owner",
    };
    allocation.config.persistIdentity(identity);
    allocation.config.beforeStart?.(identity);
    if (interrupted) {
      await allocation.config.diagnosticFinalizationObserver?.observe(
        stdout.trimEnd(),
        new AbortController().signal,
        identity,
        () => Promise.resolve()
      );
    }
    allocation.config.persistSettlement({
      artifactEligible: !interrupted,
      containerAbsent: true,
      containerId: identity.containerId,
      containmentScope: "docker-private-pid-namespace",
      process: {
        code: interrupted ? null : 0,
        killed: interrupted,
        quiescenceScope: "process-group-and-observed-descendants",
        quiescent: true,
        stderr: "",
        stdout,
      },
      status: interrupted ? "workload-failed" : "complete",
    });
    if (interrupted) {
      interruptedSettlement = allocation.verifyInterruptedSettlement();
    }
    const emittedSessionId = `00000000-0000-0000-0000-${String(ordinal + 1).padStart(12, "0")}`;
    const trace = [
      { payload: { id: emittedSessionId }, type: "session_meta" },
      { payload: { model: "gpt-6-astra" }, type: "turn_context" },
      {
        payload: {
          content: [{ text: "fixture request", type: "input_text" }],
          role: "user",
          type: "message",
        },
        type: "response_item",
      },
      {
        payload: {
          content: [{ text: structuredResponse, type: "output_text" }],
          role: "assistant",
          type: "message",
        },
        type: "response_item",
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n");
    return allocation.persistValidatedAdapterTrace({
      adapter: "codex-jsonl-v1",
      authorInvocation: {
        emittedSessionId,
        interrupted,
        request: adapterRequest,
        role,
        stdoutSha256: createHash("sha256").update(stdout).digest("hex"),
        structuredResponse,
      },
      evidenceMode: "sealed-text",
      model: "gpt-6-astra",
      orderedAttachments: [],
      trace,
      traceSha256: createHash("sha256").update(trace).digest("hex"),
    });
  };
  const sealInspection = (
    request: Parameters<
      NonNullable<Parameters<typeof runStructuredAuthor>[0]["inspect"]>
    >[0]
  ) => {
    const anchor = Buffer.from("fixture-anchor");
    const proof = readFileSync(path.join(out, "outlined.icon"));
    const anchorSha256 = createHash("sha256").update(anchor).digest("hex");
    const proofSha256 = request.proofHashes.outlined;
    const { collectorRequestId, lifecycleRequestSha256 } = request;
    if (!proofSha256 || !collectorRequestId || !lifecycleRequestSha256) {
      throw new Error("fixture inspection identity is missing");
    }
    const adapterRequest = `${JSON.stringify(
      {
        deadlineAt: request.deadlineAt,
        evidenceHashes: {
          "anchor-family.png": anchorSha256,
          "outlined-proof.png": proofSha256,
        },
        evidenceMode: "images",
        inspectionLifecycle: {
          collectorRequestId,
          lifecycleRequestSha256,
          programHashes: request.programHashes,
          proofHashes: request.proofHashes,
        },
        model: request.model,
        prompt: "fixture prompt",
        questions: [
          {
            choices: ["pass", "fail", "uncertain"],
            id: "author-self-review-outlined",
            prompt: "fixture question",
          },
        ],
        schema: {},
      },
      null,
      2
    )}\n`;
    const allocation = factory.create({
      cwd: path.join(runtime, "01-author-self-review"),
      deadlineAt,
      inspectionRequestBinding: {
        adapterRequestSha256: createHash("sha256")
          .update(adapterRequest)
          .digest("hex"),
        collectorRequestId,
        lifecycleRequestSha256,
      },
      ordinal: 1,
      stageKind: "author-self-review",
    });
    const rawAnswers = JSON.stringify({
      answers: {
        "author-self-review-outlined": {
          choice: "pass",
          evidence: "Exact proof inspected.",
          treatment: "",
        },
      },
    });
    const stdout = `${JSON.stringify({
      item: { text: rawAnswers, type: "agent_message" },
      type: "item.completed",
    })}\n`;
    const identity = {
      containerId: "2".repeat(64),
      containerName: "sealed-inspection",
      image: allocation.config.image,
      ownershipToken: "owner",
    };
    allocation.config.persistIdentity(identity);
    allocation.config.beforeStart?.(identity);
    allocation.config.persistSettlement({
      artifactEligible: true,
      containerAbsent: true,
      containerId: identity.containerId,
      containmentScope: "docker-private-pid-namespace",
      process: {
        code: 0,
        killed: false,
        quiescenceScope: "process-group-and-observed-descendants",
        quiescent: true,
        stderr: "",
        stdout,
      },
      status: "complete",
    });
    const emittedSessionId = "00000000-0000-0000-0000-000000000002";
    const trace = [
      { payload: { id: emittedSessionId }, type: "session_meta" },
      { payload: { model: "gpt-6-astra" }, type: "turn_context" },
      {
        payload: {
          content: [
            {
              detail: "high",
              image_url: `data:image/png;base64,${anchor.toString("base64")}`,
              type: "input_image",
            },
            {
              detail: "high",
              image_url: `data:image/png;base64,${proof.toString("base64")}`,
              type: "input_image",
            },
          ],
          role: "user",
          type: "message",
        },
        type: "response_item",
      },
      {
        payload: {
          content: [{ text: rawAnswers, type: "output_text" }],
          role: "assistant",
          type: "message",
        },
        type: "response_item",
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n");
    return {
      collectorTrace: allocation.persistValidatedAdapterTrace({
        adapter: "codex-jsonl-v1",
        evidenceMode: "images",
        inspectionInvocation: {
          adapterRequest,
          collectorRequestId,
          emittedSessionId,
          lifecycleRequestSha256,
          rawAnswers,
          stdoutSha256: createHash("sha256").update(stdout).digest("hex"),
        },
        model: request.model,
        orderedAttachments: [
          { name: "anchor-family.png", sha256: anchorSha256 },
          { name: "outlined-proof.png", sha256: proofSha256 },
        ],
        trace,
        traceSha256: createHash("sha256").update(trace).digest("hex"),
      }),
      kind: "collector-sealed-structured-inspection-v1" as const,
    };
  };
  try {
    const construction = {
      addressedDefectIds: [],
      programs: { outlined: program(8) },
    };
    const finalReview = {
      reviewMarkdown: "Exact final proof inspected.",
      unresolved: [],
    };
    let constructTrace: Awaited<ReturnType<typeof seal>> | undefined;
    let finalizerTrace: Awaited<ReturnType<typeof seal>> | undefined;
    const result = await runStructuredAuthor({
      check: (cwd) =>
        Promise.resolve({
          proofs: { outlined: readFileSync(path.join(cwd, "outlined.icon")) },
          status: 0,
          stderr: "",
          stdout: "check0",
        }),
      construct: async (request) => {
        constructTrace = await seal(0, "construct", construction, request);
        return {
          collectorTrace: constructTrace,
          kind: "collector-sealed-structured-author-call-v1",
        };
      },
      deadlineAt,
      finalize: async (request) => {
        finalizerTrace = await seal(2, "finalizer", finalReview, request, true);
        if (!interruptedSettlement) {
          throw new Error("fixture interruption settlement is missing");
        }
        return {
          collectorTrace: finalizerTrace,
          interruption: {
            inspectionHash: createHash("sha256")
              .update(JSON.stringify(request.inspection))
              .digest("hex"),
            kind: "structured-finalization-interruption" as const,
            programHashes: request.programHashes,
            settlement: interruptedSettlement,
            stageDeadlineAt: request.deadlineAt,
          },
          kind: "collector-sealed-structured-author-call-v1",
        };
      },
      finishes: ["outlined"],
      inspect: (request) => Promise.resolve(sealInspection(request)),
      model: "gpt-6-astra",
      out,
      prompt: "Draw.",
    });
    expect(result.authorEvidence).toMatchObject({
      completion: { role: "finalizer" },
      contributors: { outlined: [{ role: "construct" }] },
      kind: "collector-sealed-author-lineage-v1",
      missingContributorStages: { outlined: [] },
      status: "collector-sealed-requires-downstream-replay",
      verifiedForProduction: false,
    });
    expect(
      replayStructuredAuthorEvidence(result, {
        expectedDeadlineAt: deadlineAt,
        expectedRequestId: requestId,
        rootDirectory: root,
      })
    ).toEqual({
      evidenceReceiptSha256s: expect.arrayContaining([
        result.authorEvidence?.completion?.traceReceiptSha256,
        result.authorEvidence?.inspection?.traceReceiptSha256,
        result.authorEvidence?.contributors.outlined[0]?.traceReceiptSha256,
      ]),
      kind: "replayed-collector-sealed-author-lineage-v1",
      structuralReplayVerified: true,
    });
    const finalizerInvocation = finalizerTrace?.authorInvocation;
    const diagnosticTrigger = finalizerInvocation?.diagnosticTrigger;
    if (!finalizerInvocation || !diagnosticTrigger) {
      throw new Error("fixture finalizer diagnostic trigger is missing");
    }
    const triggerBytes = readFileSync(diagnosticTrigger.file);
    writeFileSync(diagnosticTrigger.file, '{"tampered":true}\n');
    expect(() =>
      replayStructuredAuthorEvidence(result, {
        expectedDeadlineAt: deadlineAt,
        expectedRequestId: requestId,
        rootDirectory: root,
      })
    ).toThrow("trigger");
    writeFileSync(diagnosticTrigger.file, triggerBytes);
    const descriptorBytes = readFileSync(diagnosticTrigger.descriptorFile);
    writeFileSync(diagnosticTrigger.descriptorFile, '{"tampered":true}\n');
    expect(() =>
      replayStructuredAuthorEvidence(result, {
        expectedDeadlineAt: deadlineAt,
        expectedRequestId: requestId,
        rootDirectory: root,
      })
    ).toThrow(/diagnostic|descriptor/u);
    writeFileSync(diagnosticTrigger.descriptorFile, descriptorBytes);
    const finalizerSettlementBytes = readFileSync(
      finalizerInvocation.settlementFile
    );
    const changedFinalizerSettlement = JSON.parse(
      finalizerSettlementBytes.toString("utf-8")
    );
    changedFinalizerSettlement.container.process.stdout = `${JSON.stringify({
      item: {
        text: JSON.stringify({
          reviewMarkdown: "Buffered replacement.",
          unresolved: [],
        }),
        type: "agent_message",
      },
      type: "item.completed",
    })}\n`;
    writeFileSync(
      finalizerInvocation.settlementFile,
      `${JSON.stringify(changedFinalizerSettlement, null, 2)}\n`
    );
    expect(() =>
      replayStructuredAuthorEvidence(result, {
        expectedDeadlineAt: deadlineAt,
        expectedRequestId: requestId,
        rootDirectory: root,
      })
    ).toThrow("settlement");
    writeFileSync(finalizerInvocation.settlementFile, finalizerSettlementBytes);
    const lifecycleFile =
      result.authorEvidence?.contributors.outlined[0]?.lifecycleRequestFile;
    if (!lifecycleFile) {
      throw new Error("fixture contributor lifecycle request is missing");
    }
    const lifecycleBytes = readFileSync(lifecycleFile);
    writeFileSync(lifecycleFile, '{"tampered":true}');
    expect(() =>
      replayStructuredAuthorEvidence(result, {
        expectedDeadlineAt: deadlineAt,
        expectedRequestId: requestId,
        rootDirectory: root,
      })
    ).toThrow("author bytes changed");
    writeFileSync(lifecycleFile, lifecycleBytes);
    expect(() =>
      replayStructuredAuthorEvidence(result, {
        expectedDeadlineAt: deadlineAt,
        expectedRequestId: "forged-parent",
        rootDirectory: root,
      })
    ).toThrow("settlement did not bind exactly");
    expect(() =>
      replayStructuredAuthorEvidence(result, {
        expectedDeadlineAt: deadlineAt + 1,
        expectedRequestId: requestId,
        rootDirectory: root,
      })
    ).toThrow("not replayable");

    const contributor = result.authorEvidence?.contributors.outlined[0];
    if (!constructTrace || !contributor) {
      throw new Error("fixture contributor trace is missing");
    }
    const settlementFile = constructTrace.authorInvocation?.settlementFile;
    if (!settlementFile) {
      throw new Error("fixture contributor settlement is missing");
    }
    const settlementBytes = readFileSync(settlementFile);
    const forgedSettlement = JSON.parse(settlementBytes.toString("utf-8"));
    forgedSettlement.container.process.stdout = `${JSON.stringify({
      item: { text: JSON.stringify(construction), type: "agent_message" },
      type: "item.completed",
    })}\n${JSON.stringify({
      item: { text: JSON.stringify(construction), type: "agent_message" },
      type: "item.completed",
    })}\n`;
    writeFileSync(
      settlementFile,
      `${JSON.stringify(forgedSettlement, null, 2)}\n`
    );
    expect(() =>
      replayStructuredAuthorEvidence(result, {
        expectedDeadlineAt: deadlineAt,
        expectedRequestId: requestId,
        rootDirectory: root,
      })
    ).toThrow("settlement did not bind exactly");
    writeFileSync(settlementFile, settlementBytes);

    const inspection = result.authorEvidence?.inspection;
    if (!inspection) {
      throw new Error("fixture inspection evidence is missing");
    }
    const inspectionReceiptBytes = readFileSync(inspection.traceReceiptFile);
    const inspectionReceipt = JSON.parse(
      inspectionReceiptBytes.toString("utf-8")
    );
    inspectionReceipt.orderedAttachments.reverse();
    const reorderedReceiptBytes = Buffer.from(
      `${JSON.stringify(inspectionReceipt, null, 2)}\n`
    );
    writeFileSync(inspection.traceReceiptFile, reorderedReceiptBytes);
    const originalInspectionReceiptSha = inspection.traceReceiptSha256;
    inspection.traceReceiptSha256 = createHash("sha256")
      .update(reorderedReceiptBytes)
      .digest("hex");
    expect(() =>
      replayStructuredAuthorEvidence(result, {
        expectedDeadlineAt: deadlineAt,
        expectedRequestId: requestId,
        rootDirectory: root,
      })
    ).toThrow("attachment order");
    writeFileSync(inspection.traceReceiptFile, inspectionReceiptBytes);
    inspection.traceReceiptSha256 = originalInspectionReceiptSha;

    const traceFile = path.join(
      path.dirname(inspection.traceReceiptFile),
      inspectionReceipt.traceFile
    );
    const traceBytes = readFileSync(traceFile);
    const forgedTrace = traceBytes
      .toString("utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const record = JSON.parse(line);
        if (
          record.type === "response_item" &&
          record.payload?.type === "message" &&
          record.payload.role === "assistant"
        ) {
          record.payload.content[0].text = JSON.stringify({
            answers: {
              "author-self-review-outlined": {
                choice: "fail",
                evidence: "Forged trace answer.",
                treatment: "Reject.",
              },
            },
          });
        }
        return JSON.stringify(record);
      })
      .join("\n");
    const forgedTraceSha256 = createHash("sha256")
      .update(forgedTrace)
      .digest("hex");
    const forgedTraceReceipt = {
      ...JSON.parse(inspectionReceiptBytes.toString("utf-8")),
      traceSha256: forgedTraceSha256,
    };
    const forgedTraceReceiptBytes = Buffer.from(
      `${JSON.stringify(forgedTraceReceipt, null, 2)}\n`
    );
    writeFileSync(traceFile, forgedTrace);
    writeFileSync(inspection.traceReceiptFile, forgedTraceReceiptBytes);
    inspection.traceSha256 = forgedTraceSha256;
    inspection.traceReceiptSha256 = createHash("sha256")
      .update(forgedTraceReceiptBytes)
      .digest("hex");
    expect(() =>
      replayStructuredAuthorEvidence(result, {
        expectedDeadlineAt: deadlineAt,
        expectedRequestId: requestId,
        rootDirectory: root,
      })
    ).toThrow("final answer does not match settled stdout");
    writeFileSync(traceFile, traceBytes);
    writeFileSync(inspection.traceReceiptFile, inspectionReceiptBytes);
    inspection.traceSha256 = inspectionReceipt.traceSha256;
    inspection.traceReceiptSha256 = originalInspectionReceiptSha;
    await expect(
      runStructuredAuthor({
        check: vi.fn(),
        construct: async (request) => {
          const tamperedTrace = await seal(
            2,
            "construct",
            construction,
            request
          );
          const responseFile =
            tamperedTrace.authorInvocation?.structuredResponseFile;
          if (!responseFile) {
            throw new Error("fixture author response was not sealed");
          }
          writeFileSync(
            responseFile,
            JSON.stringify({
              addressedDefectIds: [],
              programs: { outlined: program(10) },
            })
          );
          return {
            collectorTrace: tamperedTrace,
            kind: "collector-sealed-structured-author-call-v1",
          };
        },
        deadlineAt,
        finalize: vi.fn(),
        finishes: ["outlined"],
        inspect: vi.fn(),
        out: path.join(root, "tampered-out"),
        prompt: "Draw.",
      })
    ).rejects.toThrow("bytes did not bind exactly");

    await expect(
      runStructuredAuthor({
        check: vi.fn(),
        construct: async (request) => ({
          collectorTrace: await seal(3, "construct", construction, {
            ...request,
            collectorRequestId: "00000000-0000-0000-0000-000000000099",
          }),
          kind: "collector-sealed-structured-author-call-v1",
        }),
        deadlineAt,
        finalize: vi.fn(),
        finishes: ["outlined"],
        inspect: vi.fn(),
        out: path.join(root, "cross-request-construct"),
        prompt: "Draw.",
      })
    ).rejects.toThrow("role did not match the lifecycle");

    await expect(
      runStructuredAuthor({
        check: (cwd) =>
          Promise.resolve({
            proofs: { outlined: readFileSync(path.join(cwd, "outlined.icon")) },
            status: 0,
            stderr: "",
            stdout: "check0",
          }),
        construct: () => Promise.resolve(construction),
        deadlineAt,
        finalize: async (request) => ({
          collectorTrace: await seal(4, "finalizer", finalReview, {
            ...request,
            collectorRequestId: "00000000-0000-0000-0000-000000000098",
          }),
          kind: "collector-sealed-structured-author-call-v1",
        }),
        finishes: ["outlined"],
        inspect: () =>
          Promise.resolve({
            defects: [],
            inspectionEvidence: "Exact proof inspected.",
            uncertainties: [],
          }),
        out: path.join(root, "cross-request-finalizer"),
        prompt: "Draw.",
      })
    ).rejects.toThrow("role did not match the lifecycle");

    await expect(
      runStructuredAuthor({
        check: vi.fn(),
        construct: (request) => {
          expect(Object.isFrozen(request)).toBe(true);
          expect(Object.isFrozen(request.previousPrograms)).toBe(true);
          expect(Reflect.set(request, "prompt", "mutated")).toBe(false);
          return Promise.reject(
            new Error("fixture stops after mutation check")
          );
        },
        deadlineAt,
        finalize: vi.fn(),
        finishes: ["outlined"],
        inspect: vi.fn(),
        out: path.join(root, "mutation-check"),
        prompt: "Draw.",
      })
    ).rejects.toThrow("fixture stops after mutation check");

    await expect(
      runStructuredAuthor({
        check: vi.fn(),
        construct: () =>
          Promise.resolve({
            collectorTrace: constructTrace,
            kind: "collector-sealed-structured-author-call-v1",
          }),
        deadlineAt,
        finalize: vi.fn(),
        finishes: ["outlined"],
        inspect: vi.fn(),
        out: path.join(root, "consumed-replay"),
        prompt: "Draw.",
      })
    ).rejects.toThrow("lacks collector factory authority");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("binds a verified contained finalization interruption to the exact candidate", async () => {
  const root = mkdtempSync(
    path.join(tmpdir(), "structured-interrupted-final-")
  );
  const out = path.join(root, "run");
  const deadlineAt = Date.now() + 600_000;
  const inspection = {
    defects: [],
    inspectionEvidence: "Exact host proof inspected before finalization.",
    uncertainties: [],
  };
  try {
    const result = await runStructuredAuthor({
      check: () =>
        Promise.resolve({
          proofs: { outlined: Buffer.from("exact-proof") },
          status: 0,
          stderr: "",
          stdout: "check0",
        }),
      construct: () =>
        Promise.resolve({
          addressedDefectIds: [],
          programs: { outlined: program(9) },
        }),
      deadlineAt,
      finalize: (request) =>
        Promise.resolve({
          interruption: {
            inspectionHash: createHash("sha256")
              .update(JSON.stringify(inspection))
              .digest("hex"),
            kind: "structured-finalization-interruption",
            programHashes: request.programHashes,
            settlement: {
              accounting: "settled",
              callId: "final-call",
              containerAbsent: true,
              containerId: "c".repeat(64),
              containment: "container-absent",
              containmentScope: "docker-private-pid-namespace",
              deadlineAt,
              evidenceFile: path.join(root, "settlement.json"),
              evidenceHash: "d".repeat(64),
              intentHash: "e".repeat(64),
              killed: true,
              kind: "verified-contained-finalization-interruption",
              outcome: "failed",
              processCode: null,
              quiescenceScope: "process-group-and-observed-descendants",
              quiescent: true,
              settledAt: Date.now(),
              stage: "02-finalize",
            },
            stageDeadlineAt: request.deadlineAt,
          },
          kind: "structured-finalization-envelope",
          review: {
            reviewMarkdown: "Recovered exact terminal final review.",
            unresolved: [],
          },
        }),
      finishes: ["outlined"],
      inspect: () => Promise.resolve(inspection),
      out,
      prompt: "Draw a ring.",
    });
    expect(result).toMatchObject({
      completionProvenance:
        "host-validated-after-contained-finalization-interruption",
      finalizationInterruption: {
        inspectionHash: createHash("sha256")
          .update(JSON.stringify(inspection))
          .digest("hex"),
        settlement: {
          accounting: "settled",
          containerAbsent: true,
          outcome: "failed",
          quiescent: true,
        },
      },
      status: "delivered",
    });
    expect(
      JSON.parse(
        readFileSync(path.join(out, "structured-author.json"), "utf-8")
      )
    ).toMatchObject({
      completionProvenance:
        "host-validated-after-contained-finalization-interruption",
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it.each(["program-tamper", "inspection-tamper", "expired", "unknown"])(
  "rejects interrupted finalization provenance after %s",
  async (scenario) => {
    const root = mkdtempSync(
      path.join(tmpdir(), "structured-interrupted-invalid-")
    );
    const deadlineAt = Date.now() + 600_000;
    const inspection = {
      defects: [],
      inspectionEvidence: "Exact proof inspected.",
      uncertainties: [],
    };
    try {
      await expect(
        runStructuredAuthor({
          check: () =>
            Promise.resolve({
              proofs: { outlined: Buffer.from("proof") },
              status: 0,
              stderr: "",
              stdout: "check0",
            }),
          construct: () =>
            Promise.resolve({
              addressedDefectIds: [],
              programs: { outlined: program(9) },
            }),
          deadlineAt,
          finalize: (request) =>
            Promise.resolve({
              interruption: {
                inspectionHash:
                  scenario === "inspection-tamper"
                    ? "0".repeat(64)
                    : createHash("sha256")
                        .update(JSON.stringify(inspection))
                        .digest("hex"),
                kind: "structured-finalization-interruption",
                programHashes:
                  scenario === "program-tamper"
                    ? { outlined: "0".repeat(64) }
                    : request.programHashes,
                settlement: {
                  accounting: scenario === "unknown" ? "unknown" : "settled",
                  callId: "final-call",
                  containerAbsent: true,
                  containerId: "c".repeat(64),
                  containment: "container-absent",
                  containmentScope: "docker-private-pid-namespace",
                  deadlineAt,
                  evidenceFile: path.join(root, "settlement.json"),
                  evidenceHash: "d".repeat(64),
                  intentHash: "e".repeat(64),
                  killed: true,
                  kind: "verified-contained-finalization-interruption",
                  outcome: "failed",
                  processCode: null,
                  quiescenceScope: "process-group-and-observed-descendants",
                  quiescent: true,
                  settledAt:
                    scenario === "expired" ? request.deadlineAt : Date.now(),
                  stage: "02-finalize",
                },
                stageDeadlineAt: request.deadlineAt,
              },
              kind: "structured-finalization-envelope",
              review: { reviewMarkdown: "Recovered.", unresolved: [] },
            }),
          finishes: ["outlined"],
          inspect: () => Promise.resolve(inspection),
          out: path.join(root, "run"),
          prompt: "Draw a ring.",
        })
      ).rejects.toThrow("provenance did not bind exactly");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

it("never reaches interrupted finalization salvage without exact inspection", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "structured-no-inspection-"));
  const finalize = vi.fn();
  try {
    await expect(
      runStructuredAuthor({
        check: () =>
          Promise.resolve({
            proofs: { outlined: Buffer.from("proof") },
            status: 0,
            stderr: "",
            stdout: "check0",
          }),
        construct: () =>
          Promise.resolve({
            addressedDefectIds: [],
            programs: { outlined: program(9) },
          }),
        deadlineAt: Date.now() + 600_000,
        finalize,
        finishes: ["outlined"],
        inspect: () => Promise.resolve({ defects: [], uncertainties: [] }),
        out: path.join(root, "run"),
        prompt: "Draw a ring.",
      })
    ).rejects.toThrow();
    expect(finalize).not.toHaveBeenCalled();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("restores the prior host-valid DSL when a localized repair fails checking", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  let checks = 0;
  try {
    const result = await runStructuredAuthor({
      check: () => {
        const status = checks === 1 ? 1 : 0;
        checks += 1;
        return Promise.resolve({
          proofs: { outlined: Buffer.from("proof") },
          status,
          stderr: "bad repair",
          stdout: "",
        });
      },
      construct: ({ stage }) =>
        Promise.resolve({
          addressedDefectIds: stage === "repair" ? ["gap"] : [],
          programs: { outlined: stage === "repair" ? "invalid" : program(8) },
        }),
      deadlineAt: Date.now() + 600_000,
      finalize: ({ inspection }) =>
        Promise.resolve({
          reviewMarkdown: "Retained prior candidate.",
          unresolved: inspection.defects.map(({ description, id }) => ({
            description,
            id,
            kind: "visual",
          })),
        }),
      finishes: ["outlined"],
      inspect: () =>
        Promise.resolve({
          defects: [
            {
              description: "Gap uncertain.",
              finish: "outlined",
              id: "gap",
              kind: "visual",
              treatment: "Widen gap.",
            },
          ],
          inspectionEvidence: "Exact proof inspected.",
        }),
      out,
      prompt: "Draw.",
    });
    expect(result.status).toBe("rejected-visible-defects");
    expect(readFileSync(path.join(out, "outlined.icon"), "utf-8")).toBe(
      program(8)
    );
    expect(checks).toBe(4);
  } finally {
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("restores an exact inspected candidate when repair invocation times out", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-07T13:00:00Z"));
  const startedAt = Date.now();
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  const deadlines: { deadlineAt: number; stage: string }[] = [];
  let checks = 0;
  try {
    const result = await runStructuredAuthor({
      check: () => {
        checks += 1;
        return Promise.resolve({
          proofs: { outlined: Buffer.from("proof") },
          status: 0,
          stderr: "",
          stdout: "check0",
        });
      },
      construct: ({ deadlineAt, stage }) => {
        deadlines.push({ deadlineAt, stage });
        if (stage === "repair") {
          writeFileSync(path.join(out, "outlined.icon"), "partial repair");
          return Promise.reject(new Error("owned process timed out"));
        }
        return Promise.resolve({
          addressedDefectIds: [],
          programs: { outlined: program(8) },
        });
      },
      deadlineAt: startedAt + 600_000,
      finalize: ({ deadlineAt, inspection }) => {
        expect(deadlineAt).toBe(
          Date.now() + STRUCTURED_FINAL_STAGES_RESERVE_MS
        );
        return Promise.resolve({
          reviewMarkdown: "Repair timed out; retained inspected proof.",
          unresolved: inspection.defects.map(({ description, id, kind }) => ({
            description,
            id,
            kind,
          })),
        });
      },
      finishes: ["outlined"],
      inspect: ({ deadlineAt }) => {
        expect(deadlineAt).toBe(startedAt + STRUCTURED_INSPECTION_RESERVE_MS);
        return Promise.resolve({
          defects: [
            {
              description: "Pause reads as a face.",
              finish: "outlined",
              id: "author-self-review-outlined",
              kind: "visual",
              treatment: "Relocate the pause badge.",
            },
          ],
          inspectionEvidence: "Observed on the exact proof.",
          uncertainties: [],
        });
      },
      out,
      prompt: "Draw.",
    });
    expect(deadlines).toEqual([
      {
        deadlineAt: startedAt + STRUCTURED_INITIAL_CONSTRUCTION_CAP_MS,
        stage: "construct",
      },
      {
        deadlineAt: startedAt + STRUCTURED_INITIAL_CONSTRUCTION_CAP_MS,
        stage: "repair",
      },
    ]);
    expect(result.status).toBe("rejected-visible-defects");
    expect(result.stages).toContainEqual(
      expect.objectContaining({
        error: "owned process timed out",
        status: "repair-invocation-failed-restored",
      })
    );
    expect(readFileSync(path.join(out, "outlined.icon"), "utf-8")).toBe(
      program(8)
    );
    expect(checks).toBe(3);
  } finally {
    vi.useRealTimers();
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("leaves a second inspection and finalization after A141-like stage timing", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-07T13:00:00Z"));
  const startedAt = Date.now();
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  const constructionDeadlines: number[] = [];
  const inspectionDeadlines: number[] = [];
  let inspection = 0;
  try {
    const result = await runStructuredAuthor({
      check: (cwd) =>
        Promise.resolve({
          proofs: {
            outlined: Buffer.from(
              readFileSync(path.join(cwd, "outlined.icon"))
            ),
          },
          status: 0,
          stderr: "",
          stdout: "check0",
        }),
      construct: ({ deadlineAt, stage }) => {
        constructionDeadlines.push(deadlineAt);
        if (stage === "construct") {
          vi.setSystemTime(startedAt + 211_000);
          return Promise.resolve({
            addressedDefectIds: [],
            programs: { outlined: program(8) },
          });
        }
        vi.setSystemTime(startedAt + 350_000);
        return Promise.resolve({
          addressedDefectIds: ["small-counter"],
          programs: { outlined: program(9) },
        });
      },
      deadlineAt: startedAt + 600_000,
      finalize: ({ deadlineAt }) => {
        expect(deadlineAt).toBe(
          Date.now() + STRUCTURED_FINAL_STAGES_RESERVE_MS
        );
        return Promise.resolve({ reviewMarkdown: "Clean.", unresolved: [] });
      },
      finishes: ["outlined"],
      inspect: ({ deadlineAt }) => {
        inspectionDeadlines.push(deadlineAt);
        inspection += 1;
        if (inspection === 1) {
          vi.setSystemTime(startedAt + 280_000);
          return Promise.resolve({
            defects: [
              {
                description: "Counter is too small.",
                finish: "outlined",
                id: "small-counter",
                kind: "visual",
                treatment: "Increase its radius.",
              },
            ],
            inspectionEvidence: "Exact proof inspected.",
            uncertainties: [],
          });
        }
        vi.setSystemTime(startedAt + 450_000);
        return Promise.resolve({
          defects: [],
          inspectionEvidence: "Repaired proof inspected.",
          uncertainties: [],
        });
      },
      out,
      prompt: "Draw.",
    });
    expect(constructionDeadlines).toEqual([
      startedAt + STRUCTURED_INITIAL_CONSTRUCTION_CAP_MS,
      startedAt +
        600_000 -
        STRUCTURED_INSPECTION_RESERVE_MS -
        STRUCTURED_FINAL_STAGES_RESERVE_MS,
    ]);
    expect(inspectionDeadlines).toEqual([
      startedAt + 211_000 + STRUCTURED_INSPECTION_RESERVE_MS,
      startedAt + 350_000 + STRUCTURED_INSPECTION_RESERVE_MS,
    ]);
    expect(result.status).toBe("delivered");
  } finally {
    vi.useRealTimers();
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("does not accept a host-valid repair whose inspection times out", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  let inspections = 0;
  let checks = 0;
  try {
    const result = await runStructuredAuthor({
      check: (cwd) => {
        checks += 1;
        return Promise.resolve({
          proofs: {
            outlined: Buffer.from(
              readFileSync(path.join(cwd, "outlined.icon"))
            ),
          },
          status: 0,
          stderr: "",
          stdout: "check0",
        });
      },
      construct: ({ stage }) =>
        Promise.resolve({
          addressedDefectIds: stage === "repair" ? ["small-counter"] : [],
          programs: { outlined: stage === "repair" ? program(9) : program(8) },
        }),
      deadlineAt: Date.now() + 600_000,
      finalize: ({ inspection }) =>
        Promise.resolve({
          reviewMarkdown: "Uninspected repair rejected; prior proof retained.",
          unresolved: inspection.defects.map(({ description, id, kind }) => ({
            description,
            id,
            kind,
          })),
        }),
      finishes: ["outlined"],
      inspect: () => {
        inspections += 1;
        if (inspections === 2) {
          return Promise.reject(new Error("inspection timed out"));
        }
        return Promise.resolve({
          defects: [
            {
              description: "Counter is too small.",
              finish: "outlined",
              id: "small-counter",
              kind: "visual",
              treatment: "Increase its radius.",
            },
          ],
          inspectionEvidence: "Original exact proof inspected.",
          uncertainties: [],
        });
      },
      out,
      prompt: "Draw.",
    });
    expect(result.status).toBe("rejected-visible-defects");
    expect(result.stages).toContainEqual(
      expect.objectContaining({
        error: "inspection timed out",
        status: "repair-inspection-failed-restored",
      })
    );
    expect(readFileSync(path.join(out, "outlined.icon"), "utf-8")).toBe(
      program(8)
    );
    expect(checks).toBe(4);
  } finally {
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("rejects final review that silently omits a surviving defect", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  try {
    await expect(
      runStructuredAuthor({
        check: () =>
          Promise.resolve({
            proofs: { outlined: Buffer.from("proof") },
            status: 0,
            stderr: "",
            stdout: "check0",
          }),
        construct: () =>
          Promise.resolve({
            addressedDefectIds: [],
            programs: { outlined: program(8) },
          }),
        deadlineAt: Date.now() + 600_000,
        finalize: () =>
          Promise.resolve({ reviewMarkdown: "Looks good.", unresolved: [] }),
        finishes: ["outlined"],
        inspect: () =>
          Promise.resolve({
            defects: [
              {
                description: "Gap remains uncertain.",
                finish: "outlined",
                id: "gap",
                kind: "visual",
                treatment: "Inspect the gap.",
              },
            ],
            inspectionEvidence: "Exact proof inspected.",
          }),
        out,
        prompt: "Draw.",
      })
    ).rejects.toThrow("omitted a surviving inspected defect");
  } finally {
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("repairs an initial host compiler defect before any visual inspection", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  const rejected = `icon folder-lock\nfinish outlined\nrect 2 7 20 14 r1\narc 8 9 16 9 180 0\nunion\nfit 2 2 20 20`;
  const corrected = `icon folder-lock\nfinish outlined\nrect 2 7 20 14 r1\narc 8 9 16 9 180 0\nfit 2 2 20 20\nunion`;
  const construct = vi
    .fn()
    .mockResolvedValueOnce({
      addressedDefectIds: [],
      programs: { outlined: rejected },
    })
    .mockImplementationOnce(({ defects }) => {
      expect(defects).toEqual([
        expect.objectContaining({
          description: JSON.stringify({
            status: 1,
            stderr: "line 6: Transform operands before Boolean composition",
            stdout: "",
          }),
          id: "host-compiler-attempt-0",
          kind: "representation",
        }),
      ]);
      return Promise.resolve({
        addressedDefectIds: ["host-compiler-attempt-0"],
        programs: { outlined: corrected },
      });
    });
  const inspect = vi.fn().mockResolvedValue({
    defects: [],
    inspectionEvidence: "Inspected corrected host proof only.",
  });
  try {
    const result = await runStructuredAuthor({
      check: (cwd) => {
        const source = readFileSync(path.join(cwd, "outlined.icon"), "utf-8");
        const invalid = source.indexOf("union") < source.indexOf("fit");
        return Promise.resolve({
          proofs: invalid ? {} : { outlined: Buffer.from(source) },
          status: invalid ? 1 : 0,
          stderr: invalid
            ? "line 6: Transform operands before Boolean composition"
            : "",
          stdout: invalid ? "" : "check0",
        });
      },
      construct,
      deadlineAt: Date.now() + 600_000,
      finalize: () =>
        Promise.resolve({
          reviewMarkdown: "Valid and inspected.",
          unresolved: [],
        }),
      finishes: ["outlined"],
      inspect,
      maxRepairs: 1,
      out,
      prompt: "Draw folder-lock.",
    });
    expect(result.status).toBe("delivered");
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(construct.mock.calls[1]?.[0]).toMatchObject({
      previousPrograms: { outlined: rejected },
      stage: "repair",
    });
    expect(
      readFileSync(path.join(out, "rejected-attempt-0-outlined.icon"), "utf-8")
    ).toBe(rejected);
    expect(readFileSync(path.join(out, "outlined.icon"), "utf-8")).toBe(
      corrected
    );
  } finally {
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("attributes a compiler repair to the finish named by the checker error", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-filled-error-")),
    "run"
  );
  const invalidFilled = "invalid-filled";
  const validFilled = "valid-filled";
  const validOutlined = "valid-outlined";
  const checkerStdout = JSON.stringify({
    craftApproved: false,
    findings: [
      {
        finish: "filled",
        message: "Content centre is outside tolerance.",
        rule: "centred",
        severity: "warn",
      },
      {
        finish: "filled",
        message: "Visual extent misses the landscape keyline.",
        rule: "keyline",
        severity: "error",
      },
    ],
  });
  const construct = vi
    .fn()
    .mockResolvedValueOnce({
      addressedDefectIds: [],
      programs: { filled: invalidFilled, outlined: validOutlined },
    })
    .mockImplementationOnce(({ defects }) => {
      expect(defects).toEqual([
        expect.objectContaining({
          finish: "filled",
          id: "host-compiler-attempt-0",
          kind: "representation",
        }),
      ]);
      return Promise.resolve({
        addressedDefectIds: ["host-compiler-attempt-0"],
        programs: { filled: validFilled, outlined: validOutlined },
      });
    });
  try {
    const result = await runStructuredAuthor({
      check: (cwd) => {
        const filled = readFileSync(path.join(cwd, "filled.icon"), "utf-8");
        return Promise.resolve({
          proofs:
            filled === invalidFilled
              ? {}
              : {
                  filled: Buffer.from(filled),
                  outlined: Buffer.from(
                    readFileSync(path.join(cwd, "outlined.icon"))
                  ),
                },
          status: filled === invalidFilled ? 1 : 0,
          stderr: "",
          stdout: filled === invalidFilled ? checkerStdout : "check0",
        });
      },
      construct,
      deadlineAt: Date.now() + 600_000,
      finalize: () =>
        Promise.resolve({
          reviewMarkdown: "Both exact proofs inspected.",
          unresolved: [],
        }),
      finishes: ["outlined", "filled"],
      inspect: () =>
        Promise.resolve({
          defects: [],
          inspectionEvidence: "Both exact host proofs inspected.",
        }),
      maxCompilerRepairs: 1,
      out,
      prompt: "Draw folder-lock.",
    });
    expect(result.status).toBe("delivered");
    expect(construct).toHaveBeenCalledTimes(2);
  } finally {
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("keeps a visual repair after correcting an initial compiler defect", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  const invalid = "invalid";
  const hostValid = program(8);
  const visuallyRepaired = program(9);
  const construct = vi
    .fn()
    .mockResolvedValueOnce({
      addressedDefectIds: [],
      programs: { outlined: invalid },
    })
    .mockResolvedValueOnce({
      addressedDefectIds: ["host-compiler-attempt-0"],
      programs: { outlined: hostValid },
    })
    .mockResolvedValueOnce({
      addressedDefectIds: ["undersize"],
      programs: { outlined: visuallyRepaired },
    });
  const inspect = vi
    .fn()
    .mockResolvedValueOnce({
      defects: [
        {
          description: "The native mark is undersized.",
          finish: "outlined",
          id: "undersize",
          kind: "visual",
          treatment: "Increase its optical size.",
        },
      ],
      inspectionEvidence: "Inspected the host-valid native proof.",
    })
    .mockResolvedValueOnce({
      defects: [],
      inspectionEvidence: "The repaired native proof fills the keyline.",
    });
  try {
    const result = await runStructuredAuthor({
      check: (cwd) => {
        const source = readFileSync(path.join(cwd, "outlined.icon"), "utf-8");
        return Promise.resolve({
          proofs: source === invalid ? {} : { outlined: Buffer.from(source) },
          status: source === invalid ? 1 : 0,
          stderr: source === invalid ? "invalid DSL" : "",
          stdout: "",
        });
      },
      construct,
      deadlineAt: Date.now() + 600_000,
      finalize: () =>
        Promise.resolve({ reviewMarkdown: "Ready.", unresolved: [] }),
      finishes: ["outlined"],
      inspect,
      maxCompilerRepairs: 1,
      maxRepairs: 1,
      out,
      prompt: "Draw.",
    });
    expect(result.status).toBe("delivered");
    expect(result.repairBudget).toMatchObject({
      compiler: { requested: 1, used: 1 },
      totalRetrySlotsUsed: 2,
      visual: { requested: 1, used: 1 },
    });
    expect(result.repairBudget.totalRetrySlots).toBeGreaterThanOrEqual(2);
    expect(result.repairBudget.totalRetrySlots).toBeLessThanOrEqual(4);
    expect(construct).toHaveBeenCalledTimes(3);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(construct.mock.calls[2]?.[0]).toMatchObject({
      defects: [expect.objectContaining({ id: "undersize", kind: "visual" })],
      previousPrograms: { outlined: hostValid },
      stage: "repair",
    });
    expect(readFileSync(path.join(out, "outlined.icon"), "utf-8")).toBe(
      visuallyRepaired
    );
  } finally {
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("uses the separate compiler budget when a visual repair fails the host check", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-visual-compiler-")),
    "run"
  );
  const initial = program(8);
  const invalidVisualRepair = "invalid-visual-repair";
  const corrected = program(9);
  const construct = vi
    .fn()
    .mockResolvedValueOnce({
      addressedDefectIds: [],
      programs: { outlined: initial },
    })
    .mockResolvedValueOnce({
      addressedDefectIds: ["undersize"],
      programs: { outlined: invalidVisualRepair },
    })
    .mockImplementationOnce(({ defects, previousPrograms }) => {
      expect(defects).toEqual([
        expect.objectContaining({
          id: "host-compiler-attempt-1",
          kind: "representation",
        }),
      ]);
      expect(previousPrograms).toEqual({ outlined: invalidVisualRepair });
      return Promise.resolve({
        addressedDefectIds: ["host-compiler-attempt-1"],
        programs: { outlined: corrected },
      });
    });
  const inspect = vi
    .fn()
    .mockResolvedValueOnce({
      defects: [
        {
          description: "The mark is undersized.",
          finish: "outlined",
          id: "undersize",
          kind: "visual",
          treatment: "Increase its optical size.",
        },
      ],
      inspectionEvidence: "Inspected the initial host-valid proof.",
    })
    .mockResolvedValueOnce({
      defects: [],
      inspectionEvidence: "Inspected the corrected host-valid proof.",
    });
  try {
    const result = await runStructuredAuthor({
      check: (cwd) => {
        const source = readFileSync(path.join(cwd, "outlined.icon"), "utf-8");
        return Promise.resolve({
          proofs:
            source === invalidVisualRepair
              ? {}
              : { outlined: Buffer.from(source) },
          status: source === invalidVisualRepair ? 1 : 0,
          stderr: "",
          stdout:
            source === invalidVisualRepair
              ? JSON.stringify({
                  findings: [
                    {
                      finish: "outlined",
                      message: "The repaired extent misses the keyline.",
                      rule: "keyline",
                      severity: "error",
                    },
                  ],
                })
              : "",
        });
      },
      construct,
      deadlineAt: Date.now() + 600_000,
      finalize: () =>
        Promise.resolve({ reviewMarkdown: "Ready.", unresolved: [] }),
      finishes: ["outlined"],
      inspect,
      maxCompilerRepairs: 1,
      maxRepairs: 1,
      out,
      prompt: "Draw.",
    });
    expect(result.status).toBe("delivered");
    expect(result.repairBudget).toMatchObject({
      compiler: { requested: 1, used: 1 },
      totalRetrySlotsUsed: 2,
      visual: { requested: 1, used: 1 },
    });
    expect(result.stages).toEqual([
      expect.objectContaining({ attempt: 0, status: "inspected" }),
      expect.objectContaining({ attempt: 1, status: "check-failed" }),
      expect.objectContaining({ attempt: 2, status: "inspected" }),
    ]);
    expect(construct).toHaveBeenCalledTimes(3);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(readFileSync(path.join(out, "outlined.icon"), "utf-8")).toBe(
      corrected
    );
  } finally {
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it.each(["invocation", "check", "inspection"] as const)(
  "restores the accepted proof's inspection when a compiler correction fails during %s",
  async (failure) => {
    const root = mkdtempSync(
      path.join(tmpdir(), "structured-author-accepted-inspection-")
    );
    const out = path.join(root, "run");
    const initial = program(8);
    const invalidVisualRepair = "invalid-visual-repair";
    const compilerCorrection =
      failure === "check" ? "invalid-compiler-correction" : program(9);
    const visualInspection = {
      defects: [
        {
          description: "The native mark is visibly undersized.",
          finish: "outlined" as const,
          id: "undersize",
          kind: "visual" as const,
          treatment: "Increase its optical size.",
        },
      ],
      inspectionEvidence: "Inspected the accepted host proof.",
      uncertainties: [],
    };
    const construct = vi
      .fn()
      .mockResolvedValueOnce({
        addressedDefectIds: [],
        programs: { outlined: initial },
      })
      .mockResolvedValueOnce({
        addressedDefectIds: ["undersize"],
        programs: { outlined: invalidVisualRepair },
      })
      .mockImplementationOnce(({ defects }) => {
        expect(defects).toEqual([
          expect.objectContaining({
            id: "host-compiler-attempt-1",
            kind: "representation",
          }),
        ]);
        if (failure === "invocation") {
          return Promise.reject(new Error("compiler correction failed"));
        }
        return Promise.resolve({
          addressedDefectIds: ["host-compiler-attempt-1"],
          programs: { outlined: compilerCorrection },
        });
      });
    const inspect = vi.fn().mockResolvedValueOnce(visualInspection);
    if (failure === "inspection") {
      inspect.mockRejectedValueOnce(new Error("correction inspection failed"));
    }
    const finalize = vi.fn(({ inspection }) => {
      expect(inspection).toEqual(visualInspection);
      return Promise.resolve({
        reviewMarkdown: "The accepted proof retains its visible defect.",
        unresolved: [
          {
            description: visualInspection.defects[0].description,
            id: visualInspection.defects[0].id,
            kind: visualInspection.defects[0].kind,
          },
        ],
      });
    });
    try {
      const result = await runStructuredAuthor({
        check: (cwd) => {
          const source = readFileSync(path.join(cwd, "outlined.icon"), "utf-8");
          const valid = source === initial || source === program(9);
          return Promise.resolve({
            proofs: valid ? { outlined: Buffer.from(source) } : {},
            status: valid ? 0 : 1,
            stderr: "",
            stdout: valid ? "" : "host compiler rejected the repair",
          });
        },
        construct,
        deadlineAt: Date.now() + 600_000,
        finalize,
        finishes: ["outlined"],
        inspect,
        maxCompilerRepairs: 1,
        maxRepairs: 1,
        out,
        prompt: "Draw.",
      });
      expect(result.status).toBe("rejected-visible-defects");
      expect(result.repairBudget).toMatchObject({
        compiler: { requested: 1, used: 1 },
        totalRetrySlotsUsed: 2,
        visual: { requested: 1, used: 1 },
      });
      expect(finalize).toHaveBeenCalledOnce();
      expect(readFileSync(path.join(out, "outlined.icon"), "utf-8")).toBe(
        initial
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

it("bounds compiler and visual repairs by their limits and shared deadline slots", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "structured-author-bounds-"));
  const noCompilerOut = path.join(root, "no-compiler");
  await expect(
    runStructuredAuthor({
      check: () =>
        Promise.resolve({
          proofs: {},
          status: 1,
          stderr: "invalid",
          stdout: "",
        }),
      construct: () =>
        Promise.resolve({
          addressedDefectIds: [],
          programs: { outlined: "invalid" },
        }),
      deadlineAt: Date.now() + 600_000,
      finalize: () =>
        Promise.resolve({ reviewMarkdown: "Unreachable.", unresolved: [] }),
      finishes: ["outlined"],
      inspect: () => Promise.reject(new Error("Unreachable")),
      maxCompilerRepairs: 0,
      maxRepairs: 1,
      out: noCompilerOut,
      prompt: "Draw.",
    })
  ).rejects.toThrow("No host-valid program survived compiler repair");

  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T00:00:00Z"));
  const oneSlotOut = path.join(root, "one-slot");
  const construct = vi
    .fn()
    .mockResolvedValueOnce({
      addressedDefectIds: [],
      programs: { outlined: "invalid" },
    })
    .mockResolvedValueOnce({
      addressedDefectIds: ["host-compiler-attempt-0"],
      programs: { outlined: program(8) },
    });
  try {
    const result = await runStructuredAuthor({
      check: (cwd) => {
        const source = readFileSync(path.join(cwd, "outlined.icon"), "utf-8");
        return Promise.resolve({
          proofs: source === "invalid" ? {} : { outlined: Buffer.from(source) },
          status: source === "invalid" ? 1 : 0,
          stderr: source === "invalid" ? "invalid" : "",
          stdout: "",
        });
      },
      construct,
      deadlineAt:
        Date.now() +
        STRUCTURED_INSPECTION_RESERVE_MS +
        STRUCTURED_FINAL_STAGES_RESERVE_MS +
        90_000,
      finalize: ({ inspection }) =>
        Promise.resolve({
          reviewMarkdown: "Visual repair could not use another retry slot.",
          unresolved: inspection.defects.map(({ description, id, kind }) => ({
            description,
            id,
            kind,
          })),
        }),
      finishes: ["outlined"],
      inspect: () =>
        Promise.resolve({
          defects: [
            {
              description: "Still undersized.",
              finish: "outlined",
              id: "undersize",
              kind: "visual",
              treatment: "Increase optical size.",
            },
          ],
          inspectionEvidence: "Inspected.",
        }),
      maxCompilerRepairs: 1,
      maxRepairs: 1,
      out: oneSlotOut,
      prompt: "Draw.",
    });
    expect(result.status).toBe("rejected-visible-defects");
    expect(result.repairBudget).toEqual({
      compiler: { requested: 1, used: 1 },
      totalRetrySlots: 1,
      totalRetrySlotsUsed: 1,
      visual: { requested: 1, used: 0 },
    });
    expect(construct).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
    rmSync(root, { force: true, recursive: true });
  }
});

it("validates repair limits before creating the output directory", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "structured-author-limits-"));
  const out = path.join(root, "run");
  try {
    await expect(
      runStructuredAuthor({
        check: () => Promise.reject(new Error("Unreachable")),
        construct: () => Promise.reject(new Error("Unreachable")),
        deadlineAt: Date.now() + 600_000,
        finalize: () => Promise.reject(new Error("Unreachable")),
        finishes: ["outlined"],
        inspect: () => Promise.reject(new Error("Unreachable")),
        maxCompilerRepairs: -1,
        out,
        prompt: "Draw.",
      })
    ).rejects.toThrow("repair limits must be nonnegative integers");
    expect(() => readFileSync(out)).toThrow();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("preserves explicit uncertainty without authorizing a geometry repair", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "structured-uncertain-"));
  const construct = vi.fn(() =>
    Promise.resolve({
      addressedDefectIds: [],
      programs: { outlined: program(8) },
    })
  );
  try {
    const result = await runStructuredAuthor({
      check: () =>
        Promise.resolve({
          proofs: { outlined: Buffer.from("proof") },
          status: 0,
          stderr: "",
          stdout: "",
        }),
      construct,
      deadlineAt: Date.now() + 600_000,
      finalize: () =>
        Promise.resolve({
          reviewMarkdown: "Uncertainty remains pending.",
          unresolved: [],
        }),
      finishes: ["outlined"],
      inspect: () =>
        Promise.resolve({
          defects: [],
          inspectionEvidence: "Native edge is ambiguous.",
          uncertainties: [
            {
              description: "Cannot determine edge survival.",
              finish: "outlined",
            },
          ],
        }),
      out: path.join(root, "run"),
      prompt: "Draw a ring.",
    });
    expect(construct).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("delivered-with-uncertainty");
    expect(result.stages[0]).toMatchObject({
      inspection: { uncertainties: [{ finish: "outlined" }] },
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("recovers frozen host-valid programs without construction or repair", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "structured-recovery-"));
  const out = path.join(root, "run");
  const source = program(8);
  const sourceHash = createHash("sha256").update(source).digest("hex");
  const sourceReceipt = path.join(root, "source-receipt.json");
  writeFileSync(sourceReceipt, '{"status":"host-valid"}\n');
  const sourceReceiptHash = createHash("sha256")
    .update(readFileSync(sourceReceipt))
    .digest("hex");
  const construct = vi.fn();
  const check = vi.fn((cwd: string) =>
    Promise.resolve({
      proofs: {
        outlined: Buffer.from(
          readFileSync(path.join(cwd, "outlined.icon"), "utf-8")
        ),
      },
      status: 0,
      stderr: "",
      stdout: "check0",
    })
  );
  try {
    const result = await runStructuredAuthor({
      check,
      construct,
      deadlineAt: Date.now() + 600_000,
      finalize: () =>
        Promise.resolve({ reviewMarkdown: "Recovered.", unresolved: [] }),
      finishes: ["outlined"],
      initialProgramProvenance: {
        programHashes: { outlined: sourceHash },
        source: sourceReceipt,
        sourceSha256: sourceReceiptHash,
      },
      initialPrograms: { outlined: source },
      inspect: () =>
        Promise.resolve({
          defects: [],
          inspectionEvidence: "Proof inspected.",
        }),
      maxRepairs: 0,
      out,
      prompt: "Recover retained output only.",
    });
    expect(construct).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      stages: [
        {
          initialProgramProvenance: {
            programHashes: { outlined: sourceHash },
            source: sourceReceipt,
            sourceSha256: sourceReceiptHash,
          },
          status: "inspected",
        },
      ],
      status: "delivered",
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("rejects recovery when frozen source hashes or zero-repair policy differ", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "structured-recovery-bad-"));
  try {
    await expect(
      runStructuredAuthor({
        check: vi.fn(),
        construct: vi.fn(),
        deadlineAt: Date.now() + 600_000,
        finalize: vi.fn(),
        finishes: ["outlined"],
        initialProgramProvenance: {
          programHashes: { outlined: "wrong" },
          source: path.join(root, "missing-receipt.json"),
          sourceSha256: "wrong",
        },
        initialPrograms: { outlined: program(8) },
        inspect: vi.fn(),
        maxRepairs: 0,
        out: path.join(root, "run"),
        prompt: "Recover.",
      })
    ).rejects.toThrow("exact frozen provenance and zero repairs");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it.each([
  {
    defects: [
      {
        description: "The admitted parts cannot express the required shackle.",
        finish: "outlined" as const,
        id: "missing-shackle-capability",
        kind: "representation" as const,
        treatment: "Add an admitted shackle representation.",
      },
    ],
    expected: "rejected-visible-defects",
    finalUnresolved: [
      {
        description: "The admitted parts cannot express the required shackle.",
        id: "missing-shackle-capability",
        kind: "representation" as const,
      },
    ],
    uncertainties: [],
  },
  {
    defects: [
      {
        description: "The shackle is visibly detached.",
        finish: "outlined" as const,
        id: "detached-shackle",
        kind: "visual" as const,
        treatment: "Reconnect the centered shackle.",
      },
    ],
    expected: "rejected-visible-defects",
    finalUnresolved: [
      {
        description: "The shackle is visibly detached.",
        id: "detached-shackle",
        kind: "visual" as const,
      },
    ],
    uncertainties: [],
  },
  {
    defects: [],
    expected: "rejected-visible-defects",
    finalUnresolved: [
      {
        description: "Final review found a detached shackle.",
        id: "final-detached-shackle",
        kind: "visual" as const,
      },
    ],
    uncertainties: [],
  },
  {
    defects: [],
    expected: "review-pending-uncertainty",
    finalUnresolved: [],
    uncertainties: [
      {
        description: "Native attachment remains ambiguous.",
        finish: "outlined",
      },
    ],
  },
  {
    defects: [],
    expected: "review-pending-uncertainty",
    finalUnresolved: [
      {
        description: "Representation parity remains unresolved.",
        id: "representation-parity",
        kind: "representation" as const,
      },
    ],
    uncertainties: [],
  },
])("does not accept recovered output with $expected", async (assessment) => {
  const root = mkdtempSync(path.join(tmpdir(), "structured-recovery-review-"));
  const out = path.join(root, "run");
  const source = program(8);
  const sourceReceipt = path.join(root, "source-receipt.json");
  writeFileSync(sourceReceipt, '{"status":"host-valid"}\n');
  try {
    const result = await runStructuredAuthor({
      check: () =>
        Promise.resolve({
          proofs: { outlined: Buffer.from("proof") },
          status: 0,
          stderr: "",
          stdout: "check0",
        }),
      construct: vi.fn(),
      deadlineAt: Date.now() + 600_000,
      finalize: () =>
        Promise.resolve({
          reviewMarkdown: "Recovery remains unaccepted.",
          unresolved: assessment.finalUnresolved,
        }),
      finishes: ["outlined"],
      initialProgramProvenance: {
        programHashes: {
          outlined: createHash("sha256").update(source).digest("hex"),
        },
        source: sourceReceipt,
        sourceSha256: createHash("sha256")
          .update(readFileSync(sourceReceipt))
          .digest("hex"),
      },
      initialPrograms: { outlined: source },
      inspect: () =>
        Promise.resolve({
          defects: assessment.defects,
          inspectionEvidence: "Exact proof inspected.",
          uncertainties: assessment.uncertainties,
        }),
      maxRepairs: 0,
      out,
      prompt: "Recover.",
    });
    expect(result.status).toBe(assessment.expected);
    expect(
      JSON.parse(
        readFileSync(path.join(out, "structured-author.json"), "utf-8")
      )
    ).toMatchObject({ status: assessment.expected });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("refuses construction before a provider call when downstream stages consume the deadline", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "structured-reserve-"));
  const construct = vi.fn();
  const inspect = vi.fn();
  const finalize = vi.fn();
  try {
    await expect(
      runStructuredAuthor({
        check: vi.fn(),
        construct,
        deadlineAt: Date.now() + 180_000,
        finalize,
        finishes: ["outlined"],
        inspect,
        out: path.join(root, "run"),
        prompt: "Draw.",
      })
    ).rejects.toThrow("Insufficient deadline reserve for construct");
    expect(construct).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it.each(["construct", "check", "inspect", "finalize"])(
  "rejects a late %s response even when the request deadline remains",
  async (lateStage) => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const root = mkdtempSync(path.join(tmpdir(), "structured-late-stage-"));
    const advance = (stage: string, deadlineAt: number) => {
      if (stage === lateStage) {
        vi.setSystemTime(deadlineAt + 1);
      }
    };
    try {
      await expect(
        runStructuredAuthor({
          check: () => {
            advance("check", 1_600_000);
            return Promise.resolve({
              proofs: { outlined: Buffer.from("proof") },
              status: 0,
              stderr: "",
              stdout: "",
            });
          },
          construct: ({ deadlineAt }) => {
            advance("construct", deadlineAt);
            return Promise.resolve({
              addressedDefectIds: [],
              programs: { outlined: program(8) },
            });
          },
          deadlineAt: 1_600_000,
          finalize: ({ deadlineAt }) => {
            advance("finalize", deadlineAt);
            return Promise.resolve({ reviewMarkdown: "Clean", unresolved: [] });
          },
          finishes: ["outlined"],
          inspect: ({ deadlineAt }) => {
            advance("inspect", deadlineAt);
            return Promise.resolve({
              defects: [],
              inspectionEvidence: "Exact image",
            });
          },
          out: path.join(root, "run"),
          prompt: "Draw.",
        })
      ).rejects.toThrow("Structured author deadline exhausted");
      if (lateStage !== "check") {
        expect(Date.now()).toBeLessThan(1_600_000);
      }
    } finally {
      vi.useRealTimers();
      rmSync(root, { force: true, recursive: true });
    }
  }
);

it("keeps required review time outside the author inspection cap", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "author-completion-cap-"));
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  const finalize = vi.fn(() =>
    Promise.resolve({
      reviewMarkdown: "Done",
      unresolved: [],
    })
  );
  const inspect = vi.fn((request: { deadlineAt: number }) => {
    expect(request.deadlineAt).toBe(1_510_000);
    clock.mockReturnValue(1_520_000);
    return Promise.resolve({
      defects: [],
      inspectionEvidence: "Exact proof",
      uncertainties: [],
    });
  });
  try {
    await expect(
      runStructuredAuthor({
        check: () => {
          clock.mockReturnValue(1_500_000);
          return Promise.resolve({
            proofs: { outlined: Buffer.from("proof") },
            status: 0,
            stderr: "",
            stdout: "",
          });
        },
        completionDeadlineAt: 1_600_000,
        construct: () =>
          Promise.resolve({
            addressedDefectIds: [],
            programs: { outlined: program(8) },
          }),
        deadlineAt: 2_200_000,
        finalize,
        finishes: ["outlined"],
        inspect,
        maxCompilerRepairs: 0,
        maxRepairs: 0,
        out: path.join(root, "run"),
        prompt: "Ring",
      })
    ).rejects.toThrow("deadline exhausted");
    expect(inspect).toHaveBeenCalledOnce();
    expect(finalize).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
    rmSync(root, { force: true, recursive: true });
  }
});

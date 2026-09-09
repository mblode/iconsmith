import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
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

import * as apiCollector from "./api-image-capability.js";
import {
  createNativeCallBoundary,
  readNativeCallBoundary,
} from "./native-call-boundary.js";
import type { NativeCallIntent } from "./native-call-boundary.js";
import {
  runContainedAiReview,
  runContainedApiCollectorStage,
  runContainedProspectiveAiReview,
  runQualityCampaign,
} from "./quality-campaign.js";
import type { ContainedApiCollectorStageOptions } from "./quality-campaign.js";

const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const fixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), "quality-campaign-"));
  const executable = path.join(root, "native-cli");
  const image = path.join(root, "candidate.png");
  const anchor = path.join(root, "anchor.png");
  const packetFile = path.join(root, "packet.json");
  const nativeRouteFile = path.join(root, "route.json");
  const certificate = path.join(root, "ca-certificates.crt");
  writeFileSync(executable, "fixture executable");
  chmodSync(executable, 0o700);
  writeFileSync(certificate, "-----BEGIN CERTIFICATE-----\nfixture\n");
  writeFileSync(image, "candidate");
  writeFileSync(anchor, "anchor");
  writeFileSync(nativeRouteFile, "{}\n");
  const executableSha256 = sha(readFileSync(executable));
  const resolvedExecutable = realpathSync(executable);
  const resolvedCertificate = realpathSync(certificate);
  writeFileSync(
    packetFile,
    `${JSON.stringify({
      packetId: "packet-1",
      recognitionOrderSeed: "frozen-order",
      stimuli: [
        {
          concept: "heart",
          familyReferences: ["anchor.png"],
          id: "s001",
          image: "candidate.png",
          meanings: ["heart", "shield", "circle"],
        },
      ],
    })}\n`
  );
  const actor = (provider: "codex" | "claude", model: string) => ({
    cliVersion: provider === "codex" ? "0.154.0-alpha.3" : "2.1.263",
    ...(provider === "codex"
      ? {
          codexAssets: {
            certificateBundle: {
              path: resolvedCertificate,
              sha256: sha(readFileSync(certificate)),
            },
            codeModeHost: {
              path: resolvedExecutable,
              sha256: executableSha256,
            },
          },
        }
      : {}),
    effort: "high" as const,
    executable: { path: resolvedExecutable, sha256: executableSha256 },
    model,
    provider,
    stateFiles: [
      {
        relativePath:
          provider === "codex" ? "auth.json" : ".claude/.credentials.json",
        source: { path: resolvedExecutable, sha256: executableSha256 },
      },
    ],
  });
  const manifest = {
    author: actor("codex", "gpt-6-astra"),
    billing: "subscription" as const,
    docker: {
      path: executable,
      resolvedPath: resolvedExecutable,
      sha256: executableSha256,
    },
    image: `fixture@sha256:${"b".repeat(64)}`,
    reviewers: [actor("claude", "claude-opus-5"), actor("codex", "gpt-5.5")],
    schemaVersion: 1 as const,
  };
  const nativeRouteSha256 = "c".repeat(64);
  const complete = (model: string) =>
    vi.fn(
      ({
        images,
        questions,
      }: {
        images: Record<string, Uint8Array>;
        questions: readonly { choices: readonly string[]; id: string }[];
      }) =>
        Promise.resolve({
          answers: Object.fromEntries(
            questions.map((question) => [
              question.id,
              {
                choice: question.choices[0] ?? "uncertain",
                evidence: "fixture evidence",
                treatment: "none",
              },
            ])
          ),
          evidenceHashes: Object.fromEntries(
            Object.entries(images).map(([name, bytes]) => [name, sha(bytes)])
          ),
          model,
          status: "complete" as const,
        })
    );
  const invokeCodex = complete("gpt-6-astra");
  const invokeClaude = complete("claude-opus-5");
  const createBoundary = vi.fn((directory: string) => {
    mkdirSync(directory);
    return "d".repeat(64);
  });
  const createFactory = vi.fn(() => ({ create: vi.fn() }));
  const readBoundary = vi.fn(() => ({
    calls: Array.from({ length: 4 }, () => ({})),
    reservation: {
      billing: "subscription" as const,
      deadlineAt: 0,
      maxCalls: 4,
      minimumCallReserveMs: 5000,
      reservationId: "request-1",
      routeHash: nativeRouteSha256,
    },
    reservationHash: "d".repeat(64),
    stopped: false,
  }));
  const dependencies = {
    createBoundary,
    createFactory,
    invokeClaude,
    invokeCodex,
    now: Date.now,
    readBoundary,
    readRoute: vi.fn(() => ({ hash: nativeRouteSha256, manifest })),
    runCampaign: undefined,
  };
  const options = {
    deadlineAt: Date.now() + 60_000,
    nativeRouteFile,
    nativeRouteSha256,
    out: path.join(root, "campaign"),
    packetFile,
    perReviewerMaxMs: 20_000,
    requestId: "request-1",
    reviewerSlots: ["author", "reviewer-0"],
  };
  return { dependencies, manifest, options, root };
};

const prospectiveFixture = async (_collector = false) => {
  const data = fixture();
  data.manifest.reviewers[0] = {
    ...data.manifest.reviewers[1],
    model: "gpt-5.5",
  };
  const packet = JSON.parse(readFileSync(data.options.packetFile, "utf-8"));
  packet.stimuli[0].meanings = [];
  writeFileSync(data.options.packetFile, `${JSON.stringify(packet)}\n`);
  const synonymKeyFile = path.join(data.root, "synonym-key.json");
  writeFileSync(
    synonymKeyFile,
    `${JSON.stringify([
      {
        id: "s001",
        meaningProvenanceHash: "e".repeat(64),
        synonyms: ["heart", "love"],
        target: "heart",
      },
    ])}\n`
  );
  const journal: {
    callId?: string;
    deadlineAt: number;
    dispatchedAt: number;
    requestId: string;
    routeHash?: string;
    stage: string;
  }[] = [];
  const response = async (
    model: string,
    baseModelLineage: string,
    request: {
      evidenceMode: "images" | "sealed-text";
      images: Record<string, Uint8Array>;
      model?: string;
      out: string;
      nativeCall: {
        accessProbe: {
          observe: (...args: unknown[]) => Promise<{
            receiptFile: string;
            receiptSha256: string;
            securityInspectFile: string;
            securityInspectSha256: string;
          }>;
          plan: {
            ackSha256: string;
            allowed: { sha256: string };
            forbidden: readonly { pathClass: string }[];
            nonceSha256: string;
            planSha256: string;
            stageId: string;
          };
        };
        containerFactory: {
          create: (request: unknown) => {
            accessProbeBinding: () => unknown;
            settleAccess: (binding: unknown) => void;
          };
        };
        ordinal: number;
        parentDeadlineAt: number;
        runtimeCwd: string;
        stageKind: string;
      };
      questions: readonly { choices: readonly string[]; id: string }[];
    }
  ) => {
    const callId = `00000000-0000-4000-8000-${String(journal.length).padStart(12, "0")}`;
    const nativeStage = `${String(request.nativeCall.ordinal).padStart(2, "0")}-${request.nativeCall.stageKind}`;
    const actorDirectory = path.join(
      data.root,
      "prospective.native-control",
      request.nativeCall.stageKind.startsWith("recognizer-")
        ? "recognizer"
        : "adjudicator",
      nativeStage
    );
    mkdirSync(actorDirectory, { recursive: true });
    const factoryRequest = {
      accessProbe: request.nativeCall.accessProbe,
      cwd: request.nativeCall.runtimeCwd,
      deadlineAt: request.nativeCall.parentDeadlineAt,
      ordinal: request.nativeCall.ordinal,
      stageKind: request.nativeCall.stageKind,
    };
    const allocation =
      request.nativeCall.containerFactory.create(factoryRequest);
    const containerId = sha(nativeStage);
    const securityRaw = JSON.stringify([{ Id: containerId, Mounts: [] }]);
    const securityInspectFile = path.join(
      actorDirectory,
      "same-container-security-inspect.json"
    );
    writeFileSync(securityInspectFile, securityRaw);
    const { plan } = request.nativeCall.accessProbe;
    const observation = {
      kind: "same-container-access-observation-v1" as const,
      nonceSha256: plan.nonceSha256,
      observations: [
        {
          pathClass: "allowed-native-executable",
          sha256: plan.allowed.sha256,
          status: "readable" as const,
        },
        ...plan.forbidden.map(({ pathClass }) => ({
          pathClass,
          status: "missing" as const,
        })),
      ],
      planSha256: plan.planSha256,
      stageId: plan.stageId,
    };
    const security = {
      containerId,
      kind: "same-container-security-evidence-v1" as const,
      mountCensusSha256: sha(JSON.stringify([])),
      network: "bridge" as const,
      rawInspect: securityRaw,
      sha256: sha(securityRaw),
    };
    const receipt = await request.nativeCall.accessProbe.observe(
      observation,
      {
        containerId,
        containerName: `iconsmith-${nativeStage}`,
        image: data.manifest.image,
        ownershipToken: "fixture",
      },
      security
    );
    allocation.settleAccess({
      ackSha256: request.nativeCall.accessProbe.plan.ackSha256,
      containerId,
      kind: "same-container-access-binding-v1",
      nonceSha256: plan.nonceSha256,
      observationSha256: sha(JSON.stringify(observation)),
      planSha256: plan.planSha256,
      receiptFile: receipt.receiptFile,
      receiptSha256: receipt.receiptSha256,
      securityInspectFile,
      securityInspectSha256: sha(securityRaw),
      stageId: plan.stageId,
    });
    journal.push({
      callId,
      deadlineAt: request.nativeCall.parentDeadlineAt,
      dispatchedAt: 1000 + journal.length,
      requestId: "prospective-1",
      routeHash: data.options.nativeRouteSha256,
      stage: nativeStage,
    });
    const value = {
      answers: Object.fromEntries(
        request.questions.map((question) => [
          question.id,
          {
            choice: question.id.endsWith("-free-recognition")
              ? "described"
              : (question.choices[0] ?? "uncertain"),
            evidence: question.id.endsWith("-free-recognition")
              ? "A heart shape"
              : "fixture evidence",
            treatment: "none",
          },
        ])
      ),
      baseModelLineage,
      evidenceHashes: Object.fromEntries(
        Object.entries(request.images).map(([name, bytes]) => [
          name,
          sha(bytes),
        ])
      ),
      evidenceMode: request.evidenceMode,
      model,
      status: "complete" as const,
    };
    mkdirSync(request.out);
    const expectedHashes = value.evidenceHashes;
    writeFileSync(
      path.join(request.out, "request.json"),
      JSON.stringify({
        evidenceHashes: expectedHashes,
        evidenceMode: request.evidenceMode,
        status: "running",
      })
    );
    writeFileSync(path.join(request.out, "review.json"), JSON.stringify(value));
    const control = path.join(data.root, "prospective.native-control");
    for (const name of [
      "adapter-trace.jsonl",
      "container-create-request.json",
      "container-descriptor.json",
      "container-identity.json",
      "container-inspect-result.json",
      "container-settlement.json",
    ]) {
      writeFileSync(path.join(actorDirectory, name), "{}\n");
    }
    const calls = path.join(control, "calls");
    for (const suffix of ["intent", "started", "terminal"]) {
      writeFileSync(path.join(calls, `${callId}.${suffix}.json`), "{}\n");
    }
    return value;
  };
  const invokeCodex = vi.fn((request) => {
    const model = request.model ?? "gpt-6-astra";
    return response(model, model, request);
  });
  const invokeClaude = vi.fn((request) =>
    response("claude-opus-5", "claude-opus-5", request)
  );
  const createBoundary = vi.fn((directory: string) => {
    mkdirSync(directory);
    return "d".repeat(64);
  });
  const createFactory = vi.fn(() => ({
    create: vi.fn(() => {
      let accessBinding: unknown;
      return {
        accessProbeBinding: () => {
          if (!accessBinding) {
            throw new Error("fixture access binding is unsettled");
          }
          return accessBinding;
        },
        settleAccess: (binding: unknown) => {
          accessBinding = binding;
        },
      };
    }),
  }));
  const options = {
    adjudicatorSlot: "reviewer-0",
    deadlineAt: Date.now() + 60_000,
    execute: true,
    expectedAdjudicatorModel: "gpt-5.5",
    expectedRecognizerModel: "gpt-6-astra",
    nativeRouteFile: data.options.nativeRouteFile,
    nativeRouteSha256: data.options.nativeRouteSha256,
    out: path.join(data.root, "prospective"),
    packetFile: data.options.packetFile,
    perRouteMaxMs: 55_000,
    recognizerSlot: "author",
    requestId: "prospective-1",
    synonymKeyFile,
    synonymKeySha256: sha(readFileSync(synonymKeyFile)),
  };
  const { runProspectiveAiReviewCampaign } =
    await import("./ai-review-campaign.js");
  const dependencies = {
    createBoundary,
    createFactory,
    invokeClaude,
    invokeCodex,
    now: Date.now,
    readBoundary: vi.fn(() => ({
      calls: [...journal],
      reservation: {
        billing: "subscription" as const,
        deadlineAt: options.deadlineAt,
        maxCalls: 3,
        minimumCallReserveMs: 5000,
        reservationId: options.requestId,
        routeHash: options.nativeRouteSha256,
      },
      reservationHash: "d".repeat(64),
      stopped: false,
    })),
    readRoute: vi.fn(() => ({
      hash: options.nativeRouteSha256,
      manifest: data.manifest,
    })),
    runCampaign: runProspectiveAiReviewCampaign,
  };
  return { ...data, dependencies, journal, options };
};

it("freezes a native route and exact attachment closure without dispatch", async () => {
  const data = fixture();
  try {
    const { runAiReviewCampaign } = await import("./ai-review-campaign.js");
    const result = await runContainedAiReview(data.options, {
      ...data.dependencies,
      runCampaign: runAiReviewCampaign,
    } as never);
    expect(result).toMatchObject({ qualified: false, status: "dry-run" });
    expect(data.dependencies.createBoundary).not.toHaveBeenCalled();
    expect(data.dependencies.invokeCodex).not.toHaveBeenCalled();
    expect(data.dependencies.invokeClaude).not.toHaveBeenCalled();
    const intent = JSON.parse(
      readFileSync(path.join(data.options.out, "intent.json"), "utf-8")
    );
    expect(intent).toMatchObject({
      originalDeadlineAt: data.options.deadlineAt,
      qualified: false,
      runtimeIdentity: {
        billing: "subscription",
        manifestSha256: data.options.nativeRouteSha256,
        reviewers: [
          { lineage: "gpt-6-astra", slot: "author" },
          { lineage: "claude-opus-5", slot: "reviewer-0" },
        ],
      },
    });
    expect(Object.values(intent.toolingIdentity)).toContain(
      sha(readFileSync(data.options.packetFile))
    );
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("runs recognition then craft in four parent-bounded native stages", async () => {
  const data = fixture();
  try {
    const { runAiReviewCampaign } = await import("./ai-review-campaign.js");
    const result = await runContainedAiReview(
      { ...data.options, execute: true },
      { ...data.dependencies, runCampaign: runAiReviewCampaign } as never
    );
    expect(result).toMatchObject({ qualified: false, status: "diagnostic" });
    expect(data.dependencies.createBoundary).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        deadlineAt: data.options.deadlineAt,
        maxCalls: 4,
        routeHash: data.options.nativeRouteSha256,
      })
    );
    const calls = [
      ...data.dependencies.invokeCodex.mock.calls,
      ...data.dependencies.invokeClaude.mock.calls,
    ].map(
      ([request]) => (request as unknown as { nativeCall: unknown }).nativeCall
    );
    expect(calls).toEqual([
      expect.objectContaining({
        ordinal: 0,
        parentDeadlineAt: data.options.deadlineAt,
        stageKind: "author-recognition",
      }),
      expect.objectContaining({
        ordinal: 1,
        parentDeadlineAt: data.options.deadlineAt,
        stageKind: "author-craft",
      }),
      expect.objectContaining({
        ordinal: 2,
        parentDeadlineAt: data.options.deadlineAt,
        stageKind: "reviewer-0-recognition",
      }),
      expect.objectContaining({
        ordinal: 3,
        parentDeadlineAt: data.options.deadlineAt,
        stageKind: "reviewer-0-craft",
      }),
    ]);
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("refuses duplicate lineages and legacy host command flags before dispatch", async () => {
  const data = fixture();
  try {
    await expect(
      runContainedAiReview(
        { ...data.options, reviewerSlots: ["author", "author"] },
        data.dependencies as never
      )
    ).rejects.toThrow("independent slots");
    await expect(
      runQualityCampaign([
        "ai-review",
        "--codex-command",
        "/tmp/codex",
        "--claude-command",
        "/tmp/claude",
      ])
    ).rejects.toThrow();
    await expect(
      runQualityCampaign([
        "assess-ai",
        "--campaign",
        data.root,
        "--out",
        path.join(data.root, "assessment.json"),
        "--condition-key",
        data.options.packetFile,
      ])
    ).rejects.toThrow("requires both condition key path and SHA-256");
    expect(data.dependencies.createBoundary).not.toHaveBeenCalled();
    expect(data.dependencies.invokeCodex).not.toHaveBeenCalled();
    expect(data.dependencies.invokeClaude).not.toHaveBeenCalled();
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("refuses a changed launch receipt before reopening a native boundary", async () => {
  const data = fixture();
  try {
    const { runAiReviewCampaign } = await import("./ai-review-campaign.js");
    const dependencies = {
      ...data.dependencies,
      runCampaign: runAiReviewCampaign,
    } as never;
    await runContainedAiReview(
      { ...data.options, execute: true },
      dependencies
    );
    const launchFile = path.join(
      data.options.out,
      "native-control/launch.json"
    );
    const launch = JSON.parse(readFileSync(launchFile, "utf-8"));
    writeFileSync(
      launchFile,
      `${JSON.stringify({ ...launch, reviewerSlots: ["reviewer-0", "author"] })}\n`
    );
    await expect(
      runContainedAiReview({ ...data.options, execute: true }, dependencies)
    ).rejects.toThrow("launch identity is missing or changed");
    expect(data.dependencies.readBoundary).not.toHaveBeenCalled();
    expect(data.dependencies.invokeCodex).toHaveBeenCalledTimes(2);
    expect(data.dependencies.invokeClaude).toHaveBeenCalledTimes(2);
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("refuses execute on offline development input preparation", async () => {
  await expect(
    runQualityCampaign([
      "prepare-development",
      "--base-revision",
      "unused",
      "--corpus-manifest",
      "unused",
      "--meanings",
      "unused",
      "--out",
      "unused",
      "--execute",
    ])
  ).rejects.toThrow("cannot execute provider calls");
});

it("settles three role-bound prospective native stages under one deadline", async () => {
  const data = await prospectiveFixture();
  try {
    const result = await runContainedProspectiveAiReview(
      data.options,
      data.dependencies as never
    );
    expect(result).toMatchObject({
      nativeAccounting: {
        calls: 3,
        settled: true,
        stopped: false,
      },
      productionSealEligible: false,
      runtimeAccessRestrictionVerified: false,
      status: "diagnostic",
    });
    expect(data.journal.map(({ stage }) => stage)).toEqual([
      "00-recognizer-recognition",
      "01-adjudicator-adjudication",
      "02-recognizer-craft",
    ]);
    expect(
      data.journal.every(
        ({ deadlineAt }) => deadlineAt === data.options.deadlineAt
      )
    ).toBe(true);
    expect(data.dependencies.createBoundary).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        deadlineAt: data.options.deadlineAt,
        maxCalls: 3,
      })
    );
    expect(data.dependencies.invokeCodex).toHaveBeenCalledTimes(3);
    expect(data.dependencies.invokeClaude).not.toHaveBeenCalled();
    const adjudication = data.dependencies.invokeCodex.mock.calls[1]?.[0];
    expect(adjudication).toMatchObject({
      evidenceMode: "sealed-text",
      images: {},
      nativeCall: { stageKind: "adjudicator-adjudication" },
    });
    const runtimeCwds = [
      ...data.dependencies.invokeCodex.mock.calls,
      ...data.dependencies.invokeClaude.mock.calls,
    ].map(([request]) => request.nativeCall.runtimeCwd);
    expect(new Set(runtimeCwds).size).toBe(3);
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("reports unsupported dry-run actors and refuses them before native reservation", async () => {
  const data = await prospectiveFixture();
  data.options.expectedAdjudicatorModel = "claude-opus-5";
  data.manifest.reviewers[0] = {
    ...data.manifest.reviewers[0],
    cliVersion: "2.1.263",
    model: "claude-opus-5",
    provider: "claude",
  };
  try {
    const dryRun = await runContainedProspectiveAiReview(
      { ...data.options, execute: false },
      data.dependencies as never
    );
    expect(dryRun).toMatchObject({
      executionSupport: {
        executable: false,
        reason: expect.stringContaining("only for the contained Codex route"),
      },
      productionSealEligible: false,
      runtimeAccessRestrictionVerified: false,
    });
    rmSync(data.options.out, { force: true, recursive: true });
    await expect(
      runContainedProspectiveAiReview(data.options, data.dependencies as never)
    ).rejects.toThrow("only for the contained Codex route");
    expect(data.dependencies.createBoundary).not.toHaveBeenCalled();
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("assembles one sealed collector journal from the actual Codex route stages", async () => {
  const data = await prospectiveFixture(true);
  try {
    const result = await runContainedProspectiveAiReview(
      data.options,
      data.dependencies as never
    );
    expect("collectorAccessJournal" in result).toBe(true);
    if (!("collectorAccessJournal" in result)) {
      throw new Error("Expected executed collector result");
    }
    expect(result.collectorAccessJournal).toMatchObject({
      accessPolicySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      productionEligible: false,
      sessionId: expect.stringMatching(/^[a-f0-9-]{36}$/u),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    const journal = JSON.parse(
      readFileSync(result.collectorAccessJournal?.file ?? "", "utf-8")
    );
    expect(journal).toMatchObject({
      accessPolicy: {
        sha256: result.collectorAccessJournal?.accessPolicySha256,
      },
      kind: "collector-bound-stage-access-journal-v4",
      originalDeadlineAt: data.options.deadlineAt,
      qualificationId: data.options.requestId,
      sessionId: result.collectorAccessJournal?.sessionId,
      stages: [
        {
          expectation: {
            actor: { model: "gpt-6-astra", provider: "openai-codex" },
            nativeStage: "00-recognizer-recognition",
            role: "recognition",
          },
          id: "00-recognizer-recognition",
        },
        {
          expectation: {
            actor: { model: "gpt-5.5", provider: "openai-codex" },
            nativeStage: "01-adjudicator-adjudication",
            role: "adjudication",
          },
          id: "01-adjudicator-adjudication",
        },
        {
          expectation: {
            actor: { model: "gpt-6-astra", provider: "openai-codex" },
            nativeStage: "02-recognizer-craft",
            role: "craft",
          },
          id: "02-recognizer-craft",
        },
      ],
    });
    const accessPolicy = JSON.parse(
      readFileSync(
        path.resolve(
          path.dirname(result.collectorAccessJournal?.file ?? ""),
          journal.accessPolicy.file
        ),
        "utf-8"
      )
    );
    expect(accessPolicy).toMatchObject({
      forbiddenHostRoots: expect.arrayContaining([
        realpathSync(data.options.synonymKeyFile),
        realpathSync(
          path.join(
            `${data.options.out}.native-control`,
            "forbidden-control-sentinel"
          )
        ),
      ]),
      kind: "collector-pre-dispatch-access-policy-v1",
      sessionId: result.collectorAccessJournal?.sessionId,
      stages: [
        { id: "00-recognizer-recognition" },
        { id: "01-adjudicator-adjudication" },
        { id: "02-recognizer-craft" },
      ],
    });
    expect(
      accessPolicy.stages.every(
        (stage: {
          allowedMounts: unknown[];
          writableDirectory: { initialInventorySha256: string };
        }) =>
          stage.allowedMounts.length > 0 &&
          stage.writableDirectory.initialInventorySha256 ===
            sha(Buffer.from("[]"))
      )
    ).toBe(true);
    expect(
      journal.stages.every(
        (stage: {
          adapterRequest: { file: string };
          adapterResult: { file: string };
        }) =>
          stage.adapterRequest.file.startsWith("collector/") &&
          stage.adapterResult.file.startsWith("collector/")
      )
    ).toBe(true);
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("refuses a changed access policy before the next native stage", async () => {
  const data = await prospectiveFixture();
  const original = data.dependencies.invokeCodex.getMockImplementation();
  if (!original) {
    throw new Error("Expected Codex fixture implementation");
  }
  data.dependencies.invokeCodex.mockImplementationOnce(async (request) => {
    const response = await original(request);
    writeFileSync(
      path.join(
        `${data.options.out}.native-control`,
        "pre-dispatch-access-policy.json"
      ),
      "{}\n"
    );
    return response;
  });
  try {
    const result = await runContainedProspectiveAiReview(
      data.options,
      data.dependencies as never
    );
    expect(result).toMatchObject({
      collectorAccessJournal: null,
      nativeAccounting: { calls: 1 },
      outcomes: [{ status: "adjudication-incomplete" }],
    });
    expect(data.dependencies.invokeCodex).toHaveBeenCalledTimes(1);
    expect(data.dependencies.invokeClaude).not.toHaveBeenCalled();
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("refuses a stale next-stage writable directory before dispatch", async () => {
  const data = await prospectiveFixture();
  const original = data.dependencies.invokeCodex.getMockImplementation();
  if (!original) {
    throw new Error("Expected Codex fixture implementation");
  }
  data.dependencies.invokeCodex.mockImplementationOnce(async (request) => {
    const response = await original(request);
    writeFileSync(
      path.join(
        `${data.options.out}.native-runtime`,
        "adjudicator-adjudication",
        "stale"
      ),
      "stale\n"
    );
    return response;
  });
  try {
    const result = await runContainedProspectiveAiReview(
      data.options,
      data.dependencies as never
    );
    expect(result).toMatchObject({
      collectorAccessJournal: null,
      nativeAccounting: { calls: 1 },
      outcomes: [{ status: "adjudication-incomplete" }],
    });
    expect(data.dependencies.invokeCodex).toHaveBeenCalledTimes(1);
    expect(data.dependencies.invokeClaude).not.toHaveBeenCalled();
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("refuses a missing collector trace on an otherwise complete route", async () => {
  const data = await prospectiveFixture(true);
  const original = data.dependencies.invokeCodex.getMockImplementation();
  if (!original) {
    throw new Error("Expected Codex fixture implementation");
  }
  data.dependencies.invokeCodex.mockImplementation(async (request) => {
    const value = await original(request);
    if (request.nativeCall.stageKind === "recognizer-craft") {
      const nativeStage = `02-${request.nativeCall.stageKind}`;
      rmSync(
        path.join(
          `${data.options.out}.native-control`,
          "recognizer",
          nativeStage,
          "adapter-trace.jsonl"
        )
      );
    }
    return value;
  });
  try {
    await expect(
      runContainedProspectiveAiReview(data.options, data.dependencies as never)
    ).rejects.toThrow();
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("refuses adapter-result tampering after a stage settles", async () => {
  const data = await prospectiveFixture(true);
  const original = data.dependencies.invokeCodex.getMockImplementation();
  if (!original) {
    throw new Error("Expected Codex fixture implementation");
  }
  data.dependencies.invokeCodex.mockImplementation(async (request) => {
    const value = await original(request);
    if (request.nativeCall.stageKind === "recognizer-craft") {
      const resultFile = path.join(request.out, "review.json");
      const result = JSON.parse(readFileSync(resultFile, "utf-8"));
      result.model = "substituted-model";
      writeFileSync(resultFile, JSON.stringify(result));
    }
    return value;
  });
  try {
    await expect(
      runContainedProspectiveAiReview(data.options, data.dependencies as never)
    ).rejects.toThrow("Collector adapter evidence identity mismatch");
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it.each(["recognizer-recognition", "recognizer-craft"])(
  "refuses answer-only tampering after the %s response returns",
  async (stageKind) => {
    const data = await prospectiveFixture(true);
    const original = data.dependencies.invokeCodex.getMockImplementation();
    if (!original) {
      throw new Error("Expected Codex fixture implementation");
    }
    data.dependencies.invokeCodex.mockImplementation(async (request) => {
      const value = await original(request);
      if (request.nativeCall.stageKind === stageKind) {
        const resultFile = path.join(request.out, "review.json");
        const result = JSON.parse(readFileSync(resultFile, "utf-8"));
        const [answerId] = Object.keys(result.answers);
        result.answers[answerId].evidence = "post-settlement substitution";
        writeFileSync(resultFile, JSON.stringify(result));
      }
      return value;
    });
    try {
      await expect(
        runContainedProspectiveAiReview(
          data.options,
          data.dependencies as never
        )
      ).rejects.toThrow("Collector adapter evidence identity mismatch");
    } finally {
      rmSync(data.root, { force: true, recursive: true });
    }
  }
);

it("fails closed on wrong emitted lineage without dispatching later stages", async () => {
  const data = await prospectiveFixture();
  try {
    // The real adapter settles before returning, so reflect that journal entry.
    data.dependencies.invokeCodex.mockImplementationOnce((request) => {
      data.journal.push({
        deadlineAt: request.nativeCall.parentDeadlineAt,
        dispatchedAt: Date.now() + data.journal.length,
        requestId: data.options.requestId,
        stage: `00-${request.nativeCall.stageKind}`,
      });
      return Promise.resolve({
        answers: Object.fromEntries(
          request.questions.map(
            (question: { choices: readonly string[]; id: string }) => [
              question.id,
              {
                choice: "described",
                evidence: "A heart shape",
                treatment: "none",
              },
            ]
          )
        ),
        baseModelLineage: "wrong-lineage",
        evidenceHashes: Object.fromEntries(
          Object.entries(request.images).map(([name, bytes]) => [
            name,
            sha(bytes as Uint8Array),
          ])
        ),
        evidenceMode: request.evidenceMode,
        model: "gpt-6-astra",
        status: "complete" as const,
      });
    });
    const result = await runContainedProspectiveAiReview(
      data.options,
      data.dependencies as never
    );
    expect(result).toMatchObject({
      nativeAccounting: { calls: 1, settled: true },
      status: "diagnostic",
    });
    expect(data.dependencies.invokeCodex).toHaveBeenCalledTimes(1);
    expect(data.dependencies.invokeClaude).not.toHaveBeenCalled();
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("retains an emitted model suffix and fails closed on the exact model mismatch", async () => {
  const data = await prospectiveFixture();
  try {
    const original = data.dependencies.invokeCodex.getMockImplementation();
    if (!original) {
      throw new Error("Expected Codex fixture implementation");
    }
    data.dependencies.invokeCodex.mockImplementation(async (request) => {
      if (!request.nativeCall.stageKind.startsWith("adjudicator-")) {
        return original(request);
      }
      const answer = await original(request);
      return {
        ...answer,
        answers: Object.fromEntries(
          request.questions.map(
            (question: { choices: readonly string[]; id: string }) => [
              question.id,
              {
                choice: question.choices[0] ?? "uncertain",
                evidence: "fixture evidence",
                treatment: "none",
              },
            ]
          )
        ),
        evidenceHashes: {},
        model: "gpt-5.5[1m]",
      };
    });
    const result = await runContainedProspectiveAiReview(
      data.options,
      data.dependencies as never
    );
    expect(result).toMatchObject({
      nativeAccounting: { calls: 2, settled: true },
      status: "diagnostic",
    });
    const adjudication = JSON.parse(
      readFileSync(
        path.join(data.options.out, "author-recognizer", "adjudication.json"),
        "utf-8"
      )
    );
    expect(adjudication.model).toBe("gpt-5.5[1m]");
    expect(data.dependencies.invokeCodex).toHaveBeenCalledTimes(2);
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("validates real settled calls by dispatch stage when UUID filenames reverse their order", async () => {
  const data = await prospectiveFixture();
  const writeSettledCall = (directory: string, intent: NativeCallIntent) => {
    const intentHash = sha(Buffer.from(JSON.stringify(intent)));
    const started = {
      intentHash,
      startedAt: intent.dispatchedAt,
    };
    const evidenceFile = path.join(directory, `${intent.callId}.evidence.json`);
    const bytes = JSON.stringify({
      container: {
        artifactEligible: true,
        containerAbsent: true,
        containerId: "e".repeat(64),
        containmentScope: "docker-private-pid-namespace",
        process: { code: 0, killed: false },
        status: "complete",
      },
      deadlineAt: intent.deadlineAt,
      intentHash,
    });
    writeFileSync(
      path.join(directory, `${intent.callId}.intent.json`),
      `${JSON.stringify(intent, null, 2)}\n`
    );
    writeFileSync(
      path.join(directory, `${intent.callId}.started.json`),
      `${JSON.stringify(started, null, 2)}\n`
    );
    writeFileSync(evidenceFile, bytes);
    writeFileSync(
      path.join(directory, `${intent.callId}.terminal.json`),
      `${JSON.stringify(
        {
          accounting: "settled",
          containment: "container-absent",
          deadlineExceeded: false,
          evidenceFile,
          evidenceHash: sha(Buffer.from(bytes)),
          intentHash,
          outcome: "complete",
          settledAt: intent.dispatchedAt + 1,
        },
        null,
        2
      )}\n`
    );
    return {
      callId: intent.callId,
      intentHash,
      startedHash: sha(Buffer.from(JSON.stringify(started))),
    };
  };
  try {
    const directory = path.join(realpathSync(data.root), "real-boundary");
    const reservationHash = createNativeCallBoundary(directory, {
      billing: "subscription",
      deadlineAt: data.options.deadlineAt,
      maxCalls: 3,
      minimumCallReserveMs: 5000,
      reservationId: data.options.requestId,
      routeHash: data.options.nativeRouteSha256,
    });
    const dispatchedAt = Date.now();
    const first: NativeCallIntent = {
      callId: "f0000000-0000-4000-8000-000000000001",
      deadlineAt: data.options.deadlineAt,
      dispatchedAt,
      minimumRemainingMs: 5000,
      requestId: data.options.requestId,
      reservationHash,
      routeHash: data.options.nativeRouteSha256,
      stage: "00-recognizer-recognition",
    };
    const second: NativeCallIntent = {
      ...first,
      callId: "00000000-0000-4000-8000-000000000002",
      dispatchedAt: dispatchedAt + 1,
      stage: "01-adjudicator-adjudication",
    };
    const dispatches = [
      writeSettledCall(directory, first),
      writeSettledCall(directory, second),
    ];
    writeFileSync(
      path.join(directory, "dispatches.json"),
      `${JSON.stringify({ calls: dispatches, reservationHash }, null, 2)}\n`
    );
    const reopened = readNativeCallBoundary(directory, reservationHash);
    expect(reopened.calls.map(({ stage }) => stage)).toEqual([
      "01-adjudicator-adjudication",
      "00-recognizer-recognition",
    ]);
    const stageZero = reopened.calls.find(
      ({ stage }) => stage === "00-recognizer-recognition"
    );
    expect(stageZero).toBeDefined();
    let reads = 0;
    data.dependencies.readBoundary.mockImplementation(() => {
      reads += 1;
      if (reads === 1) {
        return {
          ...reopened,
          calls: [stageZero],
        } as typeof reopened;
      }
      return reopened;
    });
    const original = data.dependencies.invokeCodex.getMockImplementation();
    if (!original) {
      throw new Error("Expected Codex fixture implementation");
    }
    data.dependencies.invokeCodex.mockImplementation(async (request) => {
      if (!request.nativeCall.stageKind.startsWith("adjudicator-")) {
        return original(request);
      }
      const answer = await original(request);
      return {
        ...answer,
        answers: Object.fromEntries(
          request.questions.map(
            (question: { choices: readonly string[]; id: string }) => [
              question.id,
              {
                choice: question.choices[0] ?? "uncertain",
                evidence: "fixture evidence",
                treatment: "none",
              },
            ]
          )
        ),
        evidenceHashes: {},
        model: "gpt-5.5[1m]",
      };
    });
    const result = await runContainedProspectiveAiReview(
      data.options,
      data.dependencies as never
    );
    expect(result).toMatchObject({
      nativeAccounting: { calls: 2, settled: true },
      status: "diagnostic",
    });
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it.each([
  [
    "duplicate stage evidence",
    (
      calls: {
        deadlineAt: number;
        dispatchedAt: number;
        requestId: string;
        stage: string;
      }[]
    ) =>
      calls.length < 2
        ? calls
        : calls.map((call, index) =>
            index === 1
              ? { ...call, stage: calls[0]?.stage ?? call.stage }
              : call
          ),
  ],
  [
    "reversed dispatch timestamps",
    (
      calls: {
        deadlineAt: number;
        dispatchedAt: number;
        requestId: string;
        stage: string;
      }[]
    ) =>
      calls.length < 2
        ? calls
        : calls.map((call, index) =>
            index === 1
              ? {
                  ...call,
                  dispatchedAt: (calls[0]?.dispatchedAt ?? 1) - 1,
                }
              : call
          ),
  ],
])("rejects %s in the settled native journal", async (_name, mutate) => {
  const data = await prospectiveFixture();
  const readBoundary = data.dependencies.readBoundary.getMockImplementation();
  if (!readBoundary) {
    throw new Error("Fixture native boundary reader is missing");
  }
  data.dependencies.readBoundary.mockImplementation(() => {
    const boundary = readBoundary();
    return { ...boundary, calls: mutate([...boundary.calls]) };
  });
  try {
    await expect(
      runContainedProspectiveAiReview(data.options, data.dependencies as never)
    ).rejects.toThrow("journal changed or is unsettled");
    expect(data.dependencies.invokeCodex).toHaveBeenCalledTimes(2);
    expect(data.dependencies.invokeClaude).not.toHaveBeenCalled();
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("rejects image evidence at the sealed adjudicator boundary", async () => {
  const data = await prospectiveFixture();
  try {
    const runCampaign = vi.fn(async ({ routes }) => {
      await routes[0].adjudicator.invoke({
        deadlineAt: Date.now() + 10_000,
        images: { "forbidden.png": new Uint8Array([1]) },
        out: path.join(data.options.out, "route", "adjudication"),
        questions: [],
      });
      throw new Error("unreachable");
    });
    await expect(
      runContainedProspectiveAiReview(data.options, {
        ...data.dependencies,
        runCampaign,
      } as never)
    ).rejects.toThrow("stage role, evidence or STOP changed");
    expect(data.dependencies.invokeClaude).not.toHaveBeenCalled();
    expect(data.dependencies.invokeCodex).not.toHaveBeenCalled();
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("refuses a returned native response without its settled journal entry", async () => {
  const data = await prospectiveFixture();
  try {
    data.dependencies.invokeCodex.mockImplementationOnce((request) =>
      Promise.resolve({
        answers: Object.fromEntries(
          request.questions.map(
            (question: { choices: readonly string[]; id: string }) => [
              question.id,
              {
                choice: "described",
                evidence: "A heart shape",
                treatment: "none",
              },
            ]
          )
        ),
        baseModelLineage: "gpt-6-astra",
        evidenceHashes: Object.fromEntries(
          Object.entries(request.images).map(([name, bytes]) => [
            name,
            sha(bytes as Uint8Array),
          ])
        ),
        evidenceMode: request.evidenceMode,
        model: "gpt-6-astra",
        status: "complete" as const,
      })
    );
    await expect(
      runContainedProspectiveAiReview(data.options, data.dependencies as never)
    ).rejects.toThrow("journal changed or is unsettled");
    expect(data.dependencies.invokeClaude).not.toHaveBeenCalled();
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("observes STOP before dispatch and records zero settled calls", async () => {
  const data = await prospectiveFixture();
  const stopFile = path.join(data.root, "STOP");
  writeFileSync(stopFile, "stop\n");
  data.dependencies.readBoundary.mockImplementation(() => ({
    calls: [...data.journal],
    reservation: {
      billing: "subscription" as const,
      campaignStopFile: stopFile,
      deadlineAt: data.options.deadlineAt,
      maxCalls: 3,
      minimumCallReserveMs: 5000,
      reservationId: data.options.requestId,
      routeHash: data.options.nativeRouteSha256,
    },
    reservationHash: "d".repeat(64),
    stopped: true,
  }));
  try {
    const result = await runContainedProspectiveAiReview(
      { ...data.options, stopFile },
      data.dependencies as never
    );
    expect(result).toMatchObject({
      nativeAccounting: { calls: 0, settled: true, stopped: true },
    });
    expect(data.dependencies.invokeCodex).not.toHaveBeenCalled();
    expect(data.dependencies.invokeClaude).not.toHaveBeenCalled();
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("detects frozen packet drift after a settled native call", async () => {
  const data = await prospectiveFixture();
  try {
    const invokeCodex = vi.fn(async (request) => {
      const response = await data.dependencies.invokeCodex(request);
      writeFileSync(data.options.packetFile, "{}\n");
      return response;
    });
    const result = await runContainedProspectiveAiReview(data.options, {
      ...data.dependencies,
      invokeCodex,
    } as never);
    expect(result).toMatchObject({
      nativeAccounting: { calls: 1, settled: true },
    });
    expect(data.dependencies.invokeClaude).not.toHaveBeenCalled();
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it("refuses every repeated prospective output before opening a boundary", async () => {
  const data = await prospectiveFixture();
  try {
    const dryRun = await runContainedProspectiveAiReview(
      { ...data.options, execute: false },
      data.dependencies as never
    );
    expect(dryRun).toMatchObject({ status: "dry-run" });
    await expect(
      runContainedProspectiveAiReview(data.options, data.dependencies as never)
    ).rejects.toThrow("refuses every existing output");
    expect(data.dependencies.createBoundary).not.toHaveBeenCalled();
    expect(data.dependencies.invokeCodex).not.toHaveBeenCalled();
    expect(data.dependencies.invokeClaude).not.toHaveBeenCalled();
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

it.each(["expectedAdjudicatorModel", "expectedRecognizerModel"] as const)(
  "refuses a mismatched %s before creating a provider boundary",
  async (field) => {
    const data = await prospectiveFixture();
    try {
      await expect(
        runContainedProspectiveAiReview(
          { ...data.options, [field]: "wrong-intended-model" },
          data.dependencies as never
        )
      ).rejects.toThrow(
        "selected-slot model differs from explicit experiment intent"
      );
      expect(data.dependencies.createBoundary).not.toHaveBeenCalled();
      expect(data.dependencies.createFactory).not.toHaveBeenCalled();
      expect(data.dependencies.invokeCodex).not.toHaveBeenCalled();
      expect(existsSync(data.options.out)).toBe(false);
    } finally {
      rmSync(data.root, { force: true, recursive: true });
    }
  }
);

const apiCollectorAssemblyFixture = () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "api-collector-assembly-"))
  );
  const descriptorFile = path.join(root, "descriptor.json");
  const actor = {
    baseModelLineage: "google/gemini-3.7-flash",
    model: "gemini-3.7-flash",
    provider: "google",
  };
  const descriptor = {
    actor,
    instrumentHash: "a".repeat(64),
    orderedAttachments: [
      {
        file: path.join(root, "candidate.png"),
        name: "candidate.png",
        sha256: "c".repeat(64),
      },
    ],
    originalDeadlineAt: 300_000,
    requestId: "request-1",
    role: "panel",
    routeHash: "b".repeat(64),
    stageDeadlineAt: 200_000,
  };
  writeFileSync(descriptorFile, JSON.stringify(descriptor));
  const options: ContainedApiCollectorStageOptions = {
    descriptorFile,
    descriptorSha256: sha(readFileSync(descriptorFile)),
    evidenceDirectory: path.join(root, "api-evidence"),
    expectation: {
      actor,
      evidenceMode: "images",
      id: "panel-1",
      instrumentHash: descriptor.instrumentHash,
      nativeStage: "panel-1",
      orderedAttachments: descriptor.orderedAttachments.map(
        ({ name, sha256 }) => ({ name, sha256 })
      ),
      requestId: "request-1",
      role: "panel",
      routeHash: descriptor.routeHash,
    },
    journalFile: path.join(root, "journal.json"),
    originalDeadlineAt: 300_000,
    qualificationId: "qualification-1",
    reservedMaxUsd: 1,
    runId: "api-run-1",
    sessionId: "session-1",
    stageDeadlineAt: 200_000,
    startedAt: 100_000,
    stopFile: path.join(root, "STOP"),
  };
  return { options, root };
};

it.each([
  "role",
  "image-order",
  "instrument",
  "clock",
  "injection",
  "copied-journal",
])(
  "refuses API collector assembly %s drift before provider dispatch",
  async (fault) => {
    const { root, options } = apiCollectorAssemblyFixture();
    const dispatch = vi
      .spyOn(apiCollector, "runApiCollectorStage")
      .mockRejectedValue(new Error("unexpected dispatch"));
    try {
      if (fault === "role") {
        options.expectation.role = "craft";
      }
      if (fault === "image-order") {
        options.expectation.orderedAttachments = [
          { name: "other.png", sha256: "c".repeat(64) },
        ];
      }
      if (fault === "instrument") {
        options.expectation.instrumentHash = "d".repeat(64);
      }
      if (fault === "clock") {
        options.stageDeadlineAt -= 1;
      }
      if (fault === "injection") {
        Object.assign(options, { generate: vi.fn() });
      }
      if (fault === "copied-journal") {
        writeFileSync(options.journalFile, "{}");
      }
      await expect(
        runContainedApiCollectorStage(options, () => null)
      ).rejects.toThrow(/API collector/u);
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      dispatch.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  }
);

it.each(["installed-production-transport", "offline-test-only"] as const)(
  "assembles an API journal only for %s evidence",
  async (transportAuthority) => {
    const { root, options } = apiCollectorAssemblyFixture();
    // Orchestration stub only: this does not mint runtime authority or qualify a critic.
    const evidence = Object.fromEntries(
      [
        "descriptor",
        "intent",
        "request",
        "result",
        "generationInfo",
        "terminal",
      ].map((name) => {
        const file =
          name === "descriptor"
            ? options.descriptorFile
            : path.join(root, `${name}.json`);
        if (name !== "descriptor") {
          writeFileSync(file, "{}");
        }
        return [name, { file, sha256: sha(readFileSync(file)) }];
      })
    );
    const summary = {
      ...options.expectation,
      answersHash: "e".repeat(64),
      evidence,
      originalDeadlineAt: options.originalDeadlineAt,
      outputSha256: evidence.result.sha256,
      promptSha256: "f".repeat(64),
      settledAt: options.startedAt + 1,
      stageDeadlineAt: options.stageDeadlineAt,
      startedAt: options.startedAt,
      transportAuthority,
      usage: {},
    } as unknown as apiCollector.ApiCollectorStageSealedSummary;
    const capability = Object.freeze(
      {}
    ) as apiCollector.ApiCollectorStageCapability;
    const dispatch = vi
      .spyOn(apiCollector, "runApiCollectorStage")
      .mockImplementation(async (_input, consume) => {
        // Caller mutation after dispatch must not change the frozen journal expectation.
        options.expectation.actor = {
          ...options.expectation.actor,
          model: "changed-model",
        };
        return (await consume(capability, summary)) as never;
      });
    const verify = vi
      .spyOn(apiCollector, "withVerifiedApiCollectorStage")
      .mockImplementation(() => {
        throw new Error(
          "Assembly must preserve the capability for qualification"
        );
      });
    const consumer = vi.fn(() => "consumed");
    try {
      if (transportAuthority === "offline-test-only") {
        await expect(
          runContainedApiCollectorStage(options, consumer)
        ).rejects.toThrow("Offline API transport");
        expect(existsSync(options.journalFile)).toBe(false);
        expect(consumer).not.toHaveBeenCalled();
      } else {
        await runContainedApiCollectorStage(options, consumer);
        const journal = JSON.parse(readFileSync(options.journalFile, "utf-8"));
        expect(journal.kind).toBe("collector-bound-api-stage-journal-v1");
        expect(journal.stages[0].expectation.actor.model).toBe(
          "gemini-3.7-flash"
        );
        expect(journal.stages[0].expectation.outputSha256).toBe(
          summary.outputSha256
        );
        expect(journal.stages[0].evidence.result).toEqual({
          file: "result.json",
          sha256: summary.outputSha256,
        });
        expect(consumer).toHaveBeenCalledOnce();
        expect(consumer.mock.calls[0]).toEqual([
          expect.objectContaining({
            evidence: {
              kind: "collector-api-transport-expectation-v1",
              originalDeadlineAt: options.originalDeadlineAt,
              qualificationId: options.qualificationId,
              sessionId: options.sessionId,
              stages: [
                {
                  expectation: journal.stages[0].expectation,
                  id: journal.stages[0].id,
                  stageDeadlineAt: options.stageDeadlineAt,
                },
              ],
            },
          }),
        ]);
      }
      expect(verify).not.toHaveBeenCalled();
    } finally {
      dispatch.mockRestore();
      verify.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  }
);

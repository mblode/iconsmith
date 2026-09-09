import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { createFamilyReferencePacket } from "./family-reference-packet.js";
import {
  assertFactoryIssuedAdapterTrace,
  CODEX_MINI_INLINE_ONLY_DISABLED_FEATURES,
  CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE,
  consumeFactoryIssuedAdapterTrace,
  createNativeCallContainerFactory,
} from "./local-native-call-factory.js";
import {
  bindDiagnosticFinalizationPlan,
  materializeDiagnosticFinalizationPlan,
  readDiagnosticFinalizationPlan,
} from "./local-native-interruption-diagnostic.js";
import { createNativeCallBoundary } from "./native-call-boundary.js";

const roots: string[] = [];
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

const canonicalDiagnosticCapability = (options: {
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
          treatment: "preserve the body",
        },
        source: {
          finish: "outlined",
          name: "folder",
          provenance: {
            date: "2026-09-09",
            origin: "literal",
            set: "blode-icons",
          },
          svg: '<svg viewBox="0 0 24 24"><path d="M3 5H10L12 7H21V20H3Z"/></svg>',
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
      sha256: digest(packetBytes),
    },
    image: options.image,
    kind: "iconsmith-finalization-interruption-plan-v1",
    maxWallMs: 60_000,
    planFile,
    qualification: false,
    revisionHash: digest(revisionBytes),
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
    sha256: digest(planBytes),
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
it("freezes Mini v3 without the goal tools observed in D353", () => {
  expect(CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE).toBe(
    "mini-inline-images-no-tools-v3"
  );
  expect(CODEX_MINI_INLINE_ONLY_DISABLED_FEATURES).toEqual([
    "shell_tool",
    "unified_exec",
    "view_image",
    "sleep_tool",
    "goals",
  ]);
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const fixture = (diagnostic = false) => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "iconsmith-call-factory-"))
  );
  roots.push(root);
  const calls = path.join(root, "calls");
  const evidence = path.join(root, "evidence");
  const output = path.join(root, "output");
  const runtimeFixture = path.join(root, "runtime-fixture");
  mkdirSync(evidence);
  mkdirSync(output);
  mkdirSync(runtimeFixture);
  const nativeExecutable = path.join(runtimeFixture, "codex");
  writeFileSync(nativeExecutable, "fixture");
  const deadlineAt = Date.now() + 60_000;
  const requestId = diagnostic ? "d".repeat(64) : "astra-author";
  const routeHash = "a".repeat(64);
  const reservationHash = createNativeCallBoundary(calls, {
    billing: "subscription",
    deadlineAt,
    maxCalls: 3,
    minimumCallReserveMs: 5000,
    reservationId: requestId,
    routeHash,
  });
  const diagnosticFinalization = diagnostic
    ? canonicalDiagnosticCapability({
        deadlineAt,
        descriptorReceipt: path.join(evidence, "diagnostic-descriptor.json"),
        image: `debian@sha256:${"b".repeat(64)}`,
        requestId: "d".repeat(64),
        reservationHash,
        root,
        routeHash,
      })
    : undefined;
  const factory = createNativeCallContainerFactory({
    boundaryDirectory: calls,
    buildContainer: ({ stateDirectory }) => ({
      dockerCommand: "/usr/bin/docker",
      environment: { CODEX_HOME: stateDirectory },
      image: `debian@sha256:${"b".repeat(64)}`,
      namePrefix: "iconsmith-author",
      nativeCliVersion: "1.2.3",
      nativeCommand: "/runtime/codex",
      nativeExecutableHostPath: nativeExecutable,
      nativeExecutableSha256: "c".repeat(64),
      stateMounts: [
        {
          containerPath: stateDirectory,
          hostPath: stateDirectory,
          readOnly: false,
        },
        {
          containerPath: "/runtime/codex",
          hostPath: nativeExecutable,
          readOnly: true,
        },
      ],
    }),
    evidenceDirectory: evidence,
    ...(diagnosticFinalization ? { diagnosticFinalization } : {}),
    minimumRemainingMs: 5000,
    parentDeadlineAt: deadlineAt,
    requestId,
    reservationHash,
    rootDirectory: output,
    stateEnvironmentName: "CODEX_HOME",
  });
  return { calls, deadlineAt, evidence, factory, output };
};

it("allocates one exact finalization observer only", () => {
  const { deadlineAt, factory, output } = fixture(true);
  const hashes = {
    finalizedReceiptHash: "1".repeat(64),
    inspectionHash: "2".repeat(64),
    programHashes: { filled: "3".repeat(64) },
    responseSchemaHash: "4".repeat(64),
    stageDeadlineAt: deadlineAt - 1000,
  };
  const allocation = factory.create({
    cwd: path.join(output, "00-finalize"),
    deadlineAt,
    diagnosticFinalization: hashes,
    ordinal: 0,
    stageKind: "finalize",
  });
  expect(allocation.config.diagnosticFinalizationObserver).toBeDefined();
  expect(() =>
    factory.create({
      cwd: path.join(output, "01-finalize"),
      deadlineAt,
      diagnosticFinalization: hashes,
      ordinal: 1,
      stageKind: "finalize",
    })
  ).toThrow("single-use");
});

it("creates a unique state and externally persisted settlement per call", () => {
  const { calls, deadlineAt, evidence, factory, output } = fixture();
  const cwd = path.join(output, "00-construct");
  const { config, scope } = factory.create({
    cwd,
    deadlineAt,
    ordinal: 0,
    stageKind: "construct",
  });
  expect(scope.stateDirectory).toBe(path.join(cwd, "native-state"));
  expect(config.environment?.CODEX_HOME).toBe(scope.stateDirectory);
  expect(path.relative(cwd, evidence).startsWith("..")).toBe(true);
  config.persistIdentity({
    containerId: "d".repeat(64),
    containerName: "iconsmith-author-one",
    image: config.image,
    ownershipToken: "owner",
  });
  config.beforeStart?.({
    containerId: "d".repeat(64),
    containerName: "iconsmith-author-one",
    image: config.image,
    ownershipToken: "owner",
  });
  config.persistSettlement({
    artifactEligible: true,
    containerAbsent: true,
    containerId: "d".repeat(64),
    containmentScope: "docker-private-pid-namespace",
    process: {
      code: 0,
      killed: false,
      quiescenceScope: "process-group-and-observed-descendants",
      quiescent: true,
      stderr: "",
      stdout: "done",
    },
    status: "complete",
  });
  const terminal = JSON.parse(
    readFileSync(
      path.join(calls, `${scope.intent.callId}.terminal.json`),
      "utf-8"
    )
  );
  expect(terminal).toMatchObject({
    accounting: "settled",
    containment: "container-absent",
    outcome: "complete",
  });
  expect(
    JSON.parse(
      readFileSync(
        path.join(evidence, "00-construct", "container-settlement.json"),
        "utf-8"
      )
    )
  ).toMatchObject({
    container: { containerAbsent: true },
    deadlineAt,
  });

  const second = factory.create({
    cwd: path.join(output, "01-author-self-review"),
    deadlineAt,
    ordinal: 1,
    stageKind: "author-self-review",
  });
  expect(second.scope.stateDirectory).not.toBe(scope.stateDirectory);
  second.config.persistIdentity({
    containerId: "e".repeat(64),
    containerName: "iconsmith-author-two",
    image: second.config.image,
    ownershipToken: "owner-two",
  });
  second.config.beforeStart?.({
    containerId: "e".repeat(64),
    containerName: "iconsmith-author-two",
    image: second.config.image,
    ownershipToken: "owner-two",
  });
  second.config.persistSettlement({
    artifactEligible: true,
    containerAbsent: true,
    containerId: "e".repeat(64),
    containmentScope: "docker-private-pid-namespace",
    process: {
      code: 0,
      killed: false,
      quiescenceScope: "process-group-and-observed-descendants",
      quiescent: true,
      stderr: "",
      stdout: "reviewed",
    },
    status: "complete",
  });
  expect(
    readFileSync(
      path.join(evidence, "01-author-self-review", "container-settlement.json"),
      "utf-8"
    )
  ).toContain("reviewed");
});

it("settles an actively stopped call as cancelled and blocks later calls", () => {
  const { calls, deadlineAt, factory, output } = fixture();
  const allocation = factory.create({
    cwd: path.join(output, "00-construct"),
    deadlineAt,
    ordinal: 0,
    stageKind: "construct",
  });
  const identity = {
    containerId: "d".repeat(64),
    containerName: "iconsmith-author-stopped",
    image: allocation.config.image,
    ownershipToken: "owner",
  };
  allocation.config.persistIdentity(identity);
  allocation.config.beforeStart?.(identity);
  expect(allocation.config.observeStop?.()).toBe(false);
  writeFileSync(path.join(calls, "STOP"), "stop");
  expect(allocation.config.observeStop?.()).toBe(true);
  rmSync(path.join(calls, "STOP"));
  expect(allocation.config.observeStop?.()).toBe(true);
  allocation.config.persistSettlement({
    artifactEligible: false,
    cancelledByStop: true,
    containerAbsent: true,
    containerId: identity.containerId,
    containmentScope: "docker-private-pid-namespace",
    process: {
      code: 137,
      killed: true,
      quiescenceScope: "process-group-and-observed-descendants",
      quiescent: true,
      stderr: "",
      stdout: "",
    },
    reason: "Native call cancelled by latched STOP",
    status: "workload-failed",
  });
  expect(
    JSON.parse(
      readFileSync(
        path.join(calls, `${allocation.scope.intent.callId}.terminal.json`),
        "utf-8"
      )
    )
  ).toMatchObject({
    accounting: "settled",
    containment: "container-absent",
    outcome: "cancelled",
  });
  expect(() =>
    factory.create({
      cwd: path.join(output, "01-next"),
      deadlineAt,
      ordinal: 1,
      stageKind: "next",
    })
  ).toThrow("stopped");
});

it("records preparation failure without claiming start, absence, or settled accounting", () => {
  const { calls, deadlineAt, evidence, factory, output } = fixture();
  const allocation = factory.create({
    cwd: path.join(output, "00-reviewer-codex"),
    deadlineAt,
    ordinal: 0,
    stageKind: "reviewer-codex",
  });
  allocation.config.persistSettlement({
    artifactEligible: false,
    containerAbsent: false,
    containerId: null,
    containmentScope: "docker-private-pid-namespace",
    controlEvidence: null,
    process: null,
    reason: "context preparation failed before invocation",
    status: "containment-unproven",
  });

  expect(
    JSON.parse(
      readFileSync(
        path.join(calls, `${allocation.scope.intent.callId}.terminal.json`),
        "utf-8"
      )
    )
  ).toMatchObject({
    accounting: "unknown",
    containment: "unproven",
    outcome: "failed",
  });
  expect(
    JSON.parse(
      readFileSync(
        path.join(evidence, "00-reviewer-codex", "container-settlement.json"),
        "utf-8"
      )
    )
  ).toMatchObject({
    container: {
      artifactEligible: false,
      containerAbsent: false,
      containerId: null,
      process: null,
      status: "containment-unproven",
    },
  });
  expect(
    existsSync(
      path.join(evidence, "00-reviewer-codex", "container-identity.json")
    )
  ).toBe(false);
});

it("binds one same-container observation to the exact settled call", async () => {
  const { deadlineAt, evidence, factory, output } = fixture();
  const cwd = path.join(output, "00-reviewer-0");
  const receiptFile = path.join(evidence, "collector-observation.json");
  const plan = {
    ackContainerPath: path.join(cwd, ".access-ack"),
    ackHostPath: path.join(cwd, ".access-ack"),
    ackSha256: "1".repeat(64),
    allowed: { containerPath: "/runtime/codex", sha256: "c".repeat(64) },
    forbidden: [
      { containerPath: "/private/host", pathClass: "forbidden-0-direct" },
    ],
    kind: "same-container-access-probe-plan-v1" as const,
    nonce: "fresh-nonce",
    nonceSha256: "2".repeat(64),
    planSha256: "3".repeat(64),
    stageId: "00-reviewer-0",
  };
  const allocation = factory.create({
    accessProbe: {
      observe: (observation) => {
        const bytes = JSON.stringify(observation);
        writeFileSync(receiptFile, bytes);
        return Promise.resolve({
          receiptFile,
          receiptSha256: createHash("sha256").update(bytes).digest("hex"),
          securityInspectFile: "unused-by-wrapper",
          securityInspectSha256: "4".repeat(64),
        });
      },
      plan,
    },
    cwd,
    deadlineAt,
    ordinal: 0,
    stageKind: "reviewer-0",
  });
  expect(() => allocation.accessProbeBinding()).toThrow("durable settlement");
  const observation = {
    kind: "same-container-access-observation-v1" as const,
    nonceSha256: plan.nonceSha256,
    observations: [
      {
        pathClass: "allowed-native-executable",
        sha256: plan.allowed.sha256,
        status: "readable" as const,
      },
    ],
    planSha256: plan.planSha256,
    stageId: plan.stageId,
  };
  const rawInspect = '{"HostConfig":{"PidMode":""}}';
  const receipt = await allocation.config.sameContainerAccessProbe?.observe(
    observation,
    {
      containerId: "d".repeat(64),
      containerName: "iconsmith-reviewer",
      image: allocation.config.image,
      ownershipToken: "owner",
    },
    {
      containerId: "d".repeat(64),
      kind: "same-container-security-evidence-v1",
      mountCensusSha256: "5".repeat(64),
      network: "bridge",
      rawInspect,
      sha256: createHash("sha256").update(rawInspect).digest("hex"),
    }
  );
  expect(receipt?.securityInspectFile).toBe(
    path.join(evidence, "00-reviewer-0", "same-container-security-inspect.json")
  );
  const binding = {
    ackSha256: plan.ackSha256,
    containerId: "d".repeat(64),
    kind: "same-container-access-binding-v1" as const,
    nonceSha256: plan.nonceSha256,
    observationSha256: createHash("sha256")
      .update(JSON.stringify(observation))
      .digest("hex"),
    planSha256: plan.planSha256,
    receiptFile,
    receiptSha256: receipt?.receiptSha256 ?? "",
    securityInspectFile: receipt?.securityInspectFile ?? "",
    securityInspectSha256: receipt?.securityInspectSha256 ?? "",
    stageId: plan.stageId,
  };
  allocation.config.persistAccessBinding?.(binding);
  allocation.config.beforeStart?.({
    containerId: "d".repeat(64),
    containerName: "iconsmith-reviewer",
    image: allocation.config.image,
    ownershipToken: "owner",
  });
  allocation.config.persistSettlement({
    artifactEligible: true,
    containerAbsent: true,
    containerId: "d".repeat(64),
    containmentScope: "docker-private-pid-namespace",
    process: {
      code: 0,
      killed: false,
      quiescenceScope: "process-group-and-observed-descendants",
      quiescent: true,
      stderr: "",
      stdout: "raw-preamble\nresult",
    },
    status: "complete",
  });
  expect(allocation.accessProbeBinding()).toEqual(binding);
  writeFileSync(binding.securityInspectFile, "tampered");
  expect(() => allocation.accessProbeBinding()).toThrow("did not match");
});

it("refuses a same-container probe whose stage is not the reserved stage", () => {
  const { deadlineAt, factory, output } = fixture();
  expect(() =>
    factory.create({
      accessProbe: {
        observe: () => Promise.reject(new Error("must not run")),
        plan: {
          ackContainerPath: path.join(output, "ack"),
          ackHostPath: path.join(output, "ack"),
          ackSha256: "1".repeat(64),
          allowed: { containerPath: "/runtime/codex", sha256: "2".repeat(64) },
          forbidden: [
            { containerPath: "/host", pathClass: "forbidden-0-direct" },
          ],
          kind: "same-container-access-probe-plan-v1",
          nonce: "nonce",
          nonceSha256: "3".repeat(64),
          planSha256: "4".repeat(64),
          stageId: "01-reviewer-0",
        },
      },
      cwd: path.join(output, "00-reviewer-0"),
      deadlineAt,
      ordinal: 0,
      stageKind: "reviewer-0",
    })
  ).toThrow("parent-bounded");
});

it("persists sanitized Docker control evidence and an explicit missing-trace descriptor", () => {
  const { deadlineAt, evidence, factory, output } = fixture();
  const cwd = path.join(output, "00-review");
  const allocation = factory.create({
    cwd,
    deadlineAt,
    ordinal: 0,
    stageKind: "review",
  });
  const identity = {
    containerId: "d".repeat(64),
    containerName: "iconsmith-review-one",
    image: allocation.config.image,
    ownershipToken: "owner",
  };
  allocation.config.persistIdentity(identity);
  allocation.config.beforeStart?.(identity);
  const mounts = [
    { Destination: cwd, RW: true, Source: cwd },
    ...allocation.config.stateMounts.map(
      ({ containerPath, hostPath, readOnly }) => ({
        Destination: containerPath,
        RW: !readOnly,
        Source: realpathSync(hostPath),
      })
    ),
  ];
  allocation.config.persistSettlement({
    artifactEligible: true,
    containerAbsent: true,
    containerId: identity.containerId,
    containmentScope: "docker-private-pid-namespace",
    controlEvidence: {
      createRequest: {
        args: [
          "container",
          "create",
          "--env",
          `CODEX_HOME=sha256:${"a".repeat(64)}`,
          allocation.config.image,
          `sha256:${"b".repeat(64)}`,
        ],
        deadlineAt: deadlineAt - 5000,
        phase: "create",
      },
      inspectResult: {
        code: 0,
        inspected: {
          Config: { Image: allocation.config.image },
          HostConfig: { PidMode: "" },
          Id: identity.containerId,
          Mounts: mounts,
        },
        phase: "resolve-identity",
      },
    },
    process: {
      code: 0,
      killed: false,
      stderr: "",
      stdout: "done",
    },
    status: "complete",
  });
  const collected = path.join(evidence, "00-review");
  expect(
    JSON.parse(
      readFileSync(
        path.join(collected, "container-create-request.json"),
        "utf-8"
      )
    )
  ).toMatchObject({ phase: "create" });
  expect(
    JSON.parse(
      readFileSync(
        path.join(collected, "container-inspect-result.json"),
        "utf-8"
      )
    )
  ).toMatchObject({ inspected: { Id: identity.containerId, Mounts: mounts } });
  const descriptorBytes = readFileSync(
    path.join(collected, "container-descriptor.json"),
    "utf-8"
  );
  expect(JSON.parse(descriptorBytes)).toMatchObject({
    adapter: "codex-jsonl-v1",
    adapterTrace: "not-collected",
    environment: {
      CODEX_HOME: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    },
    evidenceRoot: collected,
    originalDeadlineAt: deadlineAt,
    reservationHash: allocation.scope.intent.reservationHash,
    runtimeRoot: cwd,
    stage: "00-review",
  });
  expect(JSON.parse(descriptorBytes)).not.toHaveProperty(
    "diagnosticDisabledFeatures"
  );
});

it("binds only the diagnostic view-image removal into the container descriptor", () => {
  const { deadlineAt, evidence, factory, output } = fixture();
  const cwd = path.join(output, "00-diagnostic");
  const allocation = factory.create({
    cwd,
    deadlineAt,
    diagnosticDisabledFeatures: ["view_image"],
    ordinal: 0,
    stageKind: "diagnostic-mini-image-capability",
  });
  const identity = {
    containerId: "e".repeat(64),
    containerName: "iconsmith-review-diagnostic",
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
    controlEvidence: {
      createRequest: {
        args: [
          "container",
          "create",
          allocation.config.image,
          `sha256:${"b".repeat(64)}`,
        ],
        deadlineAt: deadlineAt - 5000,
        phase: "create",
      },
      inspectResult: {
        code: 0,
        inspected: {
          Config: { Image: allocation.config.image },
          HostConfig: { PidMode: "" },
          Id: identity.containerId,
          Mounts: [],
        },
        phase: "resolve-identity",
      },
    },
    process: { code: 0, killed: false, stderr: "", stdout: "done" },
    status: "complete",
  });
  expect(
    JSON.parse(
      readFileSync(
        path.join(
          evidence,
          "00-diagnostic-mini-image-capability",
          "container-descriptor.json"
        ),
        "utf-8"
      )
    )
  ).toMatchObject({ diagnosticDisabledFeatures: ["view_image"] });
  const invalid = fixture();
  expect(() =>
    invalid.factory.create({
      cwd: path.join(invalid.output, "bad"),
      deadlineAt: invalid.deadlineAt,
      diagnosticDisabledFeatures: ["shell_tool"] as never,
      ordinal: 1,
      stageKind: "diagnostic-mini-image-capability",
    })
  ).toThrow("unique and parent-bounded");
  const productionShaped = fixture();
  expect(() =>
    productionShaped.factory.create({
      cwd: path.join(productionShaped.output, "review"),
      deadlineAt: productionShaped.deadlineAt,
      diagnosticDisabledFeatures: ["view_image"],
      ordinal: 0,
      stageKind: "reviewer-codex",
    })
  ).toThrow("unique and parent-bounded");
});

it("binds the frozen inline-only review profile into container and trace evidence", () => {
  const { deadlineAt, evidence, factory, output } = fixture();
  const allocation = factory.create({
    codexRuntimeProfile: CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE,
    cwd: path.join(output, "00-mini-review"),
    deadlineAt,
    ordinal: 0,
    stageKind: "reviewer-mini",
  });
  const identity = {
    containerId: "e".repeat(64),
    containerName: "iconsmith-mini-review",
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
    controlEvidence: {
      createRequest: {
        args: ["container", "create", allocation.config.image],
        deadlineAt: deadlineAt - 5000,
        phase: "create",
      },
      inspectResult: {
        code: 0,
        inspected: {
          Config: { Image: allocation.config.image },
          HostConfig: { PidMode: "" },
          Id: identity.containerId,
          Mounts: [],
        },
        phase: "resolve-identity",
      },
    },
    process: { code: 0, killed: false, stderr: "", stdout: "done" },
    status: "complete",
  });
  const trace = `${JSON.stringify({ payload: { model: "gpt-5.4-mini" }, type: "turn_context" })}\n`;
  const traceSha256 = createHash("sha256").update(trace).digest("hex");
  const binding = allocation.persistValidatedAdapterTrace({
    adapter: "codex-jsonl-v1",
    codexRuntimeProfile: CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE,
    evidenceMode: "images",
    model: "gpt-5.4-mini",
    orderedAttachments: [{ name: "candidate.png", sha256: "1".repeat(64) }],
    trace,
    traceSha256,
  });
  const collected = path.join(evidence, "00-reviewer-mini");
  expect(
    JSON.parse(
      readFileSync(path.join(collected, "container-descriptor.json"), "utf-8")
    )
  ).toMatchObject({
    codexRuntimeProfile: CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE,
    disabledFeatures: CODEX_MINI_INLINE_ONLY_DISABLED_FEATURES,
  });
  expect(JSON.parse(readFileSync(binding.receiptFile, "utf-8"))).toMatchObject({
    codexRuntimeProfile: CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE,
    disabledFeatures: CODEX_MINI_INLINE_ONLY_DISABLED_FEATURES,
    model: "gpt-5.4-mini",
  });
  const invalid = fixture();
  expect(() =>
    invalid.factory.create({
      codexRuntimeProfile: "future-profile" as never,
      cwd: path.join(invalid.output, "bad"),
      deadlineAt: invalid.deadlineAt,
      ordinal: 0,
      stageKind: "reviewer-mini",
    })
  ).toThrow("unique and parent-bounded");
});

it("fsync-seals exact validated Codex trace bytes and their collector receipt", () => {
  const { deadlineAt, evidence, factory, output } = fixture();
  const allocation = factory.create({
    cwd: path.join(output, "00-review"),
    deadlineAt,
    ordinal: 0,
    stageKind: "review",
  });
  const trace = `${JSON.stringify({ payload: { model: "gpt-6-astra" }, type: "turn_context" })}\n`;
  const traceSha256 = createHash("sha256").update(trace).digest("hex");
  const binding = allocation.persistValidatedAdapterTrace({
    adapter: "codex-jsonl-v1",
    evidenceMode: "images",
    model: "gpt-6-astra",
    orderedAttachments: [
      { name: "candidate.png", sha256: "1".repeat(64) },
      { name: "reference.png", sha256: "1".repeat(64) },
    ],
    trace,
    traceSha256,
  });
  expect(readFileSync(binding.file, "utf-8")).toBe(trace);
  expect(binding.sha256).toBe(traceSha256);
  expect(
    createHash("sha256").update(readFileSync(binding.receiptFile)).digest("hex")
  ).toBe(binding.receiptSha256);
  expect(JSON.parse(readFileSync(binding.receiptFile, "utf-8"))).toMatchObject({
    adapter: "codex-jsonl-v1",
    evidenceMode: "images",
    kind: "collector-owned-adapter-trace-v1",
    nativeStage: "00-review",
    orderedAttachments: [
      { name: "candidate.png", sha256: "1".repeat(64) },
      { name: "reference.png", sha256: "1".repeat(64) },
    ],
    traceFile: "adapter-trace.jsonl",
    traceSha256,
  });
  expect(path.dirname(binding.file)).toBe(path.join(evidence, "00-review"));
});

const settleCompleteAuthorCall = (
  allocation: ReturnType<ReturnType<typeof fixture>["factory"]["create"]>,
  stdout: string
) => {
  const identity = {
    containerId: "e".repeat(64),
    containerName: "iconsmith-author-call",
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
};

it("seals author output only after exact terminal settlement and issues authority", () => {
  const { deadlineAt, factory, output } = fixture();
  const allocation = factory.create({
    authorRequestBinding: {
      adapterRequestSha256: createHash("sha256")
        .update('{"prompt":"draw"}\n')
        .digest("hex"),
      lifecycleRequest: '{"stage":"construct"}',
      lifecycleRequestSha256: createHash("sha256")
        .update('{"stage":"construct"}')
        .digest("hex"),
      role: "construct",
    },
    cwd: path.join(output, "00-construct"),
    deadlineAt,
    ordinal: 0,
    stageKind: "construct",
  });
  const stdout = '{"type":"item.completed"}\n';
  settleCompleteAuthorCall(allocation, stdout);
  const trace = '{"type":"turn_context"}\n';
  const binding = allocation.persistValidatedAdapterTrace({
    adapter: "codex-jsonl-v1",
    authorInvocation: {
      emittedSessionId: "00000000-0000-0000-0000-000000000001",
      interrupted: false,
      request: '{"prompt":"draw"}\n',
      role: "construct",
      stdoutSha256: createHash("sha256").update(stdout).digest("hex"),
      structuredResponse: '{"programs":{"outlined":"icon ring"}}',
    },
    evidenceMode: "sealed-text",
    model: "gpt-6-astra",
    orderedAttachments: [],
    trace,
    traceSha256: createHash("sha256").update(trace).digest("hex"),
  });
  expect(() => assertFactoryIssuedAdapterTrace(binding)).not.toThrow();
  consumeFactoryIssuedAdapterTrace(binding);
  expect(() => assertFactoryIssuedAdapterTrace(binding)).toThrow(
    "lacks collector factory authority"
  );
  expect(() => assertFactoryIssuedAdapterTrace({ ...binding })).toThrow(
    "lacks collector factory authority"
  );
  expect(binding.authorInvocation).toMatchObject({
    role: "construct",
    stdoutSha256: createHash("sha256").update(stdout).digest("hex"),
  });
});

it("seals inspection answers only for the allocated lifecycle and settled stdout", () => {
  const { deadlineAt, factory, output } = fixture();
  const adapterRequest = '{"model":"gpt-6-astra"}\n';
  const collectorRequestId = "00000000-0000-0000-0000-000000000010";
  const lifecycleRequestSha256 = "a".repeat(64);
  const allocation = factory.create({
    cwd: path.join(output, "00-author-self-review"),
    deadlineAt,
    inspectionRequestBinding: {
      adapterRequestSha256: createHash("sha256")
        .update(adapterRequest)
        .digest("hex"),
      collectorRequestId,
      lifecycleRequestSha256,
    },
    ordinal: 0,
    stageKind: "author-self-review",
  });
  const rawAnswers = JSON.stringify({ answers: { outlined: "pass" } });
  settleCompleteAuthorCall(allocation, rawAnswers);
  const trace = '{"type":"turn_context"}\n';
  const binding = allocation.persistValidatedAdapterTrace({
    adapter: "codex-jsonl-v1",
    evidenceMode: "images",
    inspectionInvocation: {
      adapterRequest,
      collectorRequestId,
      emittedSessionId: "00000000-0000-0000-0000-000000000011",
      lifecycleRequestSha256,
      rawAnswers,
      stdoutSha256: createHash("sha256").update(rawAnswers).digest("hex"),
    },
    model: "gpt-6-astra",
    orderedAttachments: [
      { name: "outlined-proof.png", sha256: "b".repeat(64) },
    ],
    trace,
    traceSha256: createHash("sha256").update(trace).digest("hex"),
  });
  expect(binding.inspectionInvocation).toMatchObject({
    collectorRequestId,
    lifecycleRequestSha256,
    rawAnswersSha256: createHash("sha256").update(rawAnswers).digest("hex"),
  });
  expect(() => assertFactoryIssuedAdapterTrace({ ...binding })).toThrow(
    "lacks collector factory authority"
  );
});

it.each(["request", "stdout"] as const)(
  "refuses inspection trace sealing after %s disagreement",
  (scenario) => {
    const { deadlineAt, factory, output } = fixture();
    const adapterRequest = '{"model":"gpt-6-astra"}\n';
    const rawAnswers = '{"answers":{}}';
    const allocation = factory.create({
      cwd: path.join(output, "00-author-self-review"),
      deadlineAt,
      inspectionRequestBinding: {
        adapterRequestSha256: createHash("sha256")
          .update(adapterRequest)
          .digest("hex"),
        collectorRequestId: "00000000-0000-0000-0000-000000000010",
        lifecycleRequestSha256: "a".repeat(64),
      },
      ordinal: 0,
      stageKind: "author-self-review",
    });
    settleCompleteAuthorCall(allocation, rawAnswers);
    const trace = '{"type":"turn_context"}\n';
    expect(() =>
      allocation.persistValidatedAdapterTrace({
        adapter: "codex-jsonl-v1",
        evidenceMode: "images",
        inspectionInvocation: {
          adapterRequest:
            scenario === "request" ? '{"model":"other"}\n' : adapterRequest,
          collectorRequestId: "00000000-0000-0000-0000-000000000010",
          emittedSessionId: "00000000-0000-0000-0000-000000000011",
          lifecycleRequestSha256: "a".repeat(64),
          rawAnswers,
          stdoutSha256: createHash("sha256")
            .update(scenario === "stdout" ? "forged" : rawAnswers)
            .digest("hex"),
        },
        model: "gpt-6-astra",
        orderedAttachments: [
          { name: "outlined-proof.png", sha256: "b".repeat(64) },
        ],
        trace,
        traceSha256: createHash("sha256").update(trace).digest("hex"),
      })
    ).toThrow(
      scenario === "request"
        ? "did not match its allocated request"
        : "settled, absent container"
    );
  }
);

it.each(["stdout", "settlement", "terminal"])(
  "refuses author trace sealing after %s disagreement",
  (scenario) => {
    const { calls, deadlineAt, evidence, factory, output } = fixture();
    const allocation = factory.create({
      authorRequestBinding: {
        adapterRequestSha256: createHash("sha256")
          .update('{"prompt":"draw"}\n')
          .digest("hex"),
        lifecycleRequest: '{"stage":"construct"}',
        lifecycleRequestSha256: createHash("sha256")
          .update('{"stage":"construct"}')
          .digest("hex"),
        role: "construct",
      },
      cwd: path.join(output, "00-construct"),
      deadlineAt,
      ordinal: 0,
      stageKind: "construct",
    });
    const stdout = "actual stdout";
    settleCompleteAuthorCall(allocation, stdout);
    if (scenario === "settlement") {
      writeFileSync(
        path.join(evidence, "00-construct", "container-settlement.json"),
        '{"tampered":true}\n'
      );
    }
    if (scenario === "terminal") {
      writeFileSync(
        path.join(calls, `${allocation.scope.intent.callId}.terminal.json`),
        '{"tampered":true}\n'
      );
    }
    const trace = '{"type":"turn_context"}\n';
    expect(() =>
      allocation.persistValidatedAdapterTrace({
        adapter: "codex-jsonl-v1",
        authorInvocation: {
          emittedSessionId: "00000000-0000-0000-0000-000000000001",
          interrupted: false,
          request: '{"prompt":"draw"}\n',
          role: "construct",
          stdoutSha256: createHash("sha256")
            .update(scenario === "stdout" ? "forged" : stdout)
            .digest("hex"),
          structuredResponse: '{"programs":{"outlined":"icon ring"}}',
        },
        evidenceMode: "sealed-text",
        model: "gpt-6-astra",
        orderedAttachments: [],
        trace,
        traceSha256: createHash("sha256").update(trace).digest("hex"),
      })
    ).toThrow("settled, absent container");
  }
);

it("refuses invalid or rewritten adapter trace evidence", () => {
  const { deadlineAt, factory, output } = fixture();
  const allocation = factory.create({
    cwd: path.join(output, "00-review"),
    deadlineAt,
    ordinal: 0,
    stageKind: "review",
  });
  const valid = {
    adapter: "codex-jsonl-v1" as const,
    evidenceMode: "sealed-text" as const,
    model: "gpt-5.6-sol",
    orderedAttachments: [],
    trace: '{"type":"turn_context"}\n',
    traceSha256: createHash("sha256")
      .update('{"type":"turn_context"}\n')
      .digest("hex"),
  };
  expect(() =>
    allocation.persistValidatedAdapterTrace({
      ...valid,
      traceSha256: "0".repeat(64),
    })
  ).toThrow("trace evidence is invalid");
  allocation.persistValidatedAdapterTrace(valid);
  expect(() => allocation.persistValidatedAdapterTrace(valid)).toThrow();
});

it("returns only a trigger-bound failed, quiescent, container-absent settlement", async () => {
  const { deadlineAt, factory, output } = fixture(true);
  const request = '{"schema":{},"stageDeadlineAt":1}\n';
  const lifecycleRequest = JSON.stringify({ deadlineAt: 1 });
  const diagnosticFinalization = {
    finalizedReceiptHash: digest(request),
    inspectionHash: digest(JSON.stringify({})),
    programHashes: { outlined: "3".repeat(64) },
    responseSchemaHash: digest(JSON.stringify({})),
    stageDeadlineAt: deadlineAt - 1000,
  };
  const allocation = factory.create({
    authorRequestBinding: {
      adapterRequestSha256: digest(request),
      lifecycleRequest,
      lifecycleRequestSha256: digest(lifecycleRequest),
      role: "finalizer",
    },
    cwd: path.join(output, "00-finalize"),
    deadlineAt,
    diagnosticFinalization,
    ordinal: 0,
    stageKind: "finalize",
  });
  const identity = {
    containerId: "d".repeat(64),
    containerName: "iconsmith-author-finalize",
    image: allocation.config.image,
    ownershipToken: "owner",
  };
  allocation.config.persistIdentity(identity);
  allocation.config.beforeStart?.(identity);
  const finalReview = { reviewMarkdown: "Exact final review.", unresolved: [] };
  const terminalLine = JSON.stringify({
    item: { text: JSON.stringify(finalReview), type: "agent_message" },
    type: "item.completed",
  });
  await allocation.config.diagnosticFinalizationObserver?.observe(
    terminalLine,
    new AbortController().signal,
    identity,
    () => Promise.resolve()
  );
  const stdout = `${terminalLine}\n`;
  allocation.config.persistSettlement({
    artifactEligible: false,
    containerAbsent: true,
    containerId: identity.containerId,
    containmentScope: "docker-private-pid-namespace",
    process: {
      code: null,
      killed: true,
      quiescenceScope: "process-group-and-observed-descendants",
      quiescent: true,
      stderr: "interrupted",
      stdout,
    },
    status: "workload-failed",
  });
  const settlement = allocation.verifyInterruptedSettlement();
  expect(settlement).toMatchObject({
    accounting: "settled",
    callId: allocation.scope.intent.callId,
    containerAbsent: true,
    containment: "container-absent",
    deadlineAt,
    killed: true,
    kind: "verified-contained-finalization-interruption",
    outcome: "failed",
    processCode: null,
    quiescent: true,
    stage: "00-finalize",
  });
  expect(settlement.diagnosticTrigger).toMatchObject({
    terminalLineSha256: digest(terminalLine),
  });
  expect(settlement).not.toHaveProperty("stdout");
  expect(settlement).not.toHaveProperty("ownershipToken");
  const trace = '{"type":"turn_context"}\n';
  const binding = allocation.persistValidatedAdapterTrace({
    adapter: "codex-jsonl-v1",
    authorInvocation: {
      emittedSessionId: "00000000-0000-0000-0000-000000000099",
      interrupted: true,
      request,
      role: "finalizer",
      stdoutSha256: digest(stdout),
      structuredResponse: JSON.stringify(finalReview),
    },
    evidenceMode: "sealed-text",
    model: "gpt-6-astra",
    orderedAttachments: [],
    trace,
    traceSha256: digest(trace),
  });
  expect(binding.authorInvocation?.diagnosticTrigger).toMatchObject(
    settlement.diagnosticTrigger
  );
  expect(binding.authorInvocation?.diagnosticTrigger).toMatchObject({
    identityFile: expect.any(String),
    identitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
  });
});

it.each(["unknown-settlement", "evidence-tamper"])(
  "refuses interrupted recovery after %s",
  (scenario) => {
    const { deadlineAt, evidence, factory, output } = fixture();
    const allocation = factory.create({
      cwd: path.join(output, "00-finalize"),
      deadlineAt,
      ordinal: 0,
      stageKind: "finalize",
    });
    const identity = {
      containerId: "d".repeat(64),
      containerName: "iconsmith-author-finalize",
      image: allocation.config.image,
      ownershipToken: "owner",
    };
    allocation.config.persistIdentity(identity);
    allocation.config.beforeStart?.(identity);
    allocation.config.persistSettlement({
      artifactEligible: false,
      containerAbsent: scenario !== "unknown-settlement",
      containerId: identity.containerId,
      containmentScope: "docker-private-pid-namespace",
      process: {
        code: 137,
        killed: true,
        quiescenceScope: "process-group-and-observed-descendants",
        quiescent: true,
        stderr: "interrupted",
        stdout: "terminal-json",
      },
      status:
        scenario === "unknown-settlement"
          ? "containment-unproven"
          : "workload-failed",
    });
    if (scenario === "evidence-tamper") {
      writeFileSync(
        path.join(evidence, "00-finalize", "container-settlement.json"),
        '{"tampered":true}\n'
      );
    }
    expect(() => allocation.verifyInterruptedSettlement()).toThrow(
      /not safely recoverable|drift/u
    );
  }
);

it.each(["deleted", "mutated"])(
  "refuses interrupted recovery after its capability-owned trigger is %s",
  async (scenario) => {
    const { deadlineAt, evidence, factory, output } = fixture(true);
    const allocation = factory.create({
      cwd: path.join(output, "00-finalize"),
      deadlineAt,
      diagnosticFinalization: {
        finalizedReceiptHash: "1".repeat(64),
        inspectionHash: "2".repeat(64),
        programHashes: { outlined: "3".repeat(64) },
        responseSchemaHash: "4".repeat(64),
        stageDeadlineAt: deadlineAt - 1000,
      },
      ordinal: 0,
      stageKind: "finalize",
    });
    const identity = {
      containerId: "d".repeat(64),
      containerName: "iconsmith-author-finalize",
      image: allocation.config.image,
      ownershipToken: "owner",
    };
    allocation.config.persistIdentity(identity);
    allocation.config.beforeStart?.(identity);
    const line = JSON.stringify({
      item: {
        text: JSON.stringify({ reviewMarkdown: "Reviewed.", unresolved: [] }),
        type: "agent_message",
      },
      type: "item.completed",
    });
    await allocation.config.diagnosticFinalizationObserver?.observe(
      line,
      new AbortController().signal,
      identity,
      () => Promise.resolve()
    );
    allocation.config.persistSettlement({
      artifactEligible: false,
      containerAbsent: true,
      containerId: identity.containerId,
      containmentScope: "docker-private-pid-namespace",
      process: {
        code: null,
        killed: true,
        quiescenceScope: "process-group-and-observed-descendants",
        quiescent: true,
        stderr: "interrupted",
        stdout: `${line}\n`,
      },
      status: "workload-failed",
    });
    const trigger = path.join(
      evidence,
      "00-finalize",
      "diagnostic-trigger.json"
    );
    if (scenario === "deleted") {
      rmSync(trigger);
    } else {
      writeFileSync(trigger, '{"tampered":true}\n');
    }
    expect(() => allocation.verifyInterruptedSettlement()).toThrow(
      /trigger|regular/u
    );
  }
);

it("refuses interrupted recovery without the diagnostic observer hook", () => {
  const { deadlineAt, factory, output } = fixture();
  const allocation = factory.create({
    cwd: path.join(output, "00-finalize"),
    deadlineAt,
    ordinal: 0,
    stageKind: "finalize",
  });
  const identity = {
    containerId: "d".repeat(64),
    containerName: "iconsmith-author-finalize",
    image: allocation.config.image,
    ownershipToken: "owner",
  };
  allocation.config.persistIdentity(identity);
  allocation.config.beforeStart?.(identity);
  allocation.config.persistSettlement({
    artifactEligible: false,
    containerAbsent: true,
    containerId: identity.containerId,
    containmentScope: "docker-private-pid-namespace",
    process: {
      code: null,
      killed: true,
      quiescenceScope: "process-group-and-observed-descendants",
      quiescent: true,
      stderr: "interrupted",
      stdout: "terminal-json",
    },
    status: "workload-failed",
  });
  expect(() => allocation.verifyInterruptedSettlement()).toThrow(
    "not safely recoverable"
  );
});

it("refuses deadline resets and repeated call directories", () => {
  const { deadlineAt, factory, output } = fixture();
  const request = {
    cwd: path.join(output, "00-construct"),
    deadlineAt,
    ordinal: 0,
    stageKind: "construct",
  };
  factory.create(request);
  expect(() => factory.create(request)).toThrow("unique and parent-bounded");
  expect(() =>
    factory.create({
      ...request,
      cwd: path.join(output, "01-finalize"),
      deadlineAt: deadlineAt - 1,
      ordinal: 1,
      stageKind: "finalize",
    })
  ).toThrow("unique and parent-bounded");
  expect(() =>
    factory.create({
      ...request,
      cwd: path.join(output, ".."),
      ordinal: 2,
      stageKind: "repair",
    })
  ).toThrow("unique and parent-bounded");
});

it("refuses a nested symlink escape before reserving a call", () => {
  const { calls, deadlineAt, factory, output } = fixture();
  const external = mkdtempSync(path.join(tmpdir(), "iconsmith-call-external-"));
  roots.push(external);
  const nested = path.join(output, "nested");
  mkdirSync(nested);
  symlinkSync(external, path.join(nested, "linked"), "dir");
  expect(() =>
    factory.create({
      cwd: path.join(nested, "linked", "00-construct"),
      deadlineAt,
      ordinal: 0,
      stageKind: "construct",
    })
  ).toThrow("cannot traverse a link");
  expect(
    readdirSync(calls).filter((name) => name.endsWith(".intent.json"))
  ).toEqual([]);
});

it.each(["nested-evidence", "same-boundary"])(
  "refuses overlapping control and runtime roots: %s",
  (scenario) => {
    const values = fixture();
    const nestedEvidence = path.join(values.output, "evidence");
    mkdirSync(nestedEvidence);
    expect(() =>
      createNativeCallContainerFactory({
        boundaryDirectory: values.calls,
        buildContainer: () => {
          throw new Error("must not build");
        },
        evidenceDirectory:
          scenario === "nested-evidence" ? nestedEvidence : values.evidence,
        minimumRemainingMs: 5000,
        parentDeadlineAt: values.deadlineAt,
        requestId: "nested-evidence",
        reservationHash: "f".repeat(64),
        rootDirectory:
          scenario === "same-boundary" ? values.calls : values.output,
        stateEnvironmentName: "CODEX_HOME",
      })
    ).toThrow("absolute, bounded inputs");
  }
);

it("requires the declared provider home to be the fresh writable state", () => {
  const values = fixture();
  const invalidCalls = path.join(path.dirname(values.calls), "bad-calls");
  const invalid = createNativeCallContainerFactory({
    boundaryDirectory: invalidCalls,
    buildContainer: () => ({
      dockerCommand: "/usr/bin/docker",
      environment: { CODEX_HOME: "/shared/state" },
      image: `debian@sha256:${"b".repeat(64)}`,
      namePrefix: "iconsmith-author",
      nativeCliVersion: "1.2.3",
      nativeCommand: "/runtime/codex",
      nativeExecutableHostPath: "/runtime-fixture/codex",
      nativeExecutableSha256: "c".repeat(64),
      stateMounts: [
        {
          containerPath: "/shared/state",
          hostPath: "/shared/state",
          readOnly: false,
        },
      ],
    }),
    evidenceDirectory: values.evidence,
    minimumRemainingMs: 5000,
    parentDeadlineAt: values.deadlineAt,
    requestId: "bad-author",
    reservationHash: createNativeCallBoundary(invalidCalls, {
      billing: "subscription",
      deadlineAt: values.deadlineAt,
      maxCalls: 1,
      minimumCallReserveMs: 5000,
      reservationId: "bad-author",
      routeHash: "e".repeat(64),
    }),
    rootDirectory: values.output,
    stateEnvironmentName: "CODEX_HOME",
  });
  expect(() =>
    invalid.create({
      cwd: path.join(values.output, "bad"),
      deadlineAt: values.deadlineAt,
      ordinal: 0,
      stageKind: "construct",
    })
  ).toThrow("fresh call state directory");
});

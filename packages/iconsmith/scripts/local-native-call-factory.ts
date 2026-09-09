/** Call-scoped native container configuration bound to the durable call journal. */
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { ContainerProcessResult } from "./local-container-process.js";
import type {
  NativeCliContainerConfig,
  SameContainerAccessBinding,
  SameContainerAccessProbe,
} from "./local-container-runtime.js";
import {
  bindDiagnosticFinalizationObserver,
  verifyDiagnosticFinalizationTrigger,
} from "./local-native-interruption-diagnostic.js";
import type {
  DiagnosticFinalizationCapability,
  VerifiedDiagnosticFinalizationTrigger,
} from "./local-native-interruption-diagnostic.js";
import {
  assertNativeCallMayStart,
  observeNativeCallStop,
  reserveNativeCall,
  settleNativeCall,
} from "./native-call-boundary.js";
import type { NativeCallIntent } from "./native-call-boundary.js";

export const CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE =
  "mini-inline-images-no-tools-v3" as const;
export const CODEX_MINI_INLINE_ONLY_DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "view_image",
  "sleep_tool",
  "goals",
] as const;
export type CodexRuntimeProfile = typeof CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE;

export interface NativeCallScope {
  cwd: string;
  deadlineAt: number;
  intent: NativeCallIntent;
  stateDirectory: string;
}

export interface VerifiedInterruptedNativeCall {
  accounting: "settled";
  callId: string;
  containerAbsent: true;
  containerId: string;
  containment: "container-absent";
  containmentScope: "docker-private-pid-namespace";
  deadlineAt: number;
  deadlineExceeded: false;
  diagnosticTrigger: VerifiedDiagnosticFinalizationTrigger;
  evidenceFile: string;
  evidenceHash: string;
  intentHash: string;
  killed: boolean;
  kind: "verified-contained-finalization-interruption";
  outcome: "failed";
  processCode: number | null;
  quiescenceScope: "process-group-and-observed-descendants";
  quiescent: true;
  settledAt: number;
  stage: string;
}

export interface NativeCallContainerAllocation {
  /** Available only after access-probed execution has durably settled. */
  accessProbeBinding: () => SameContainerAccessBinding;
  config: NativeCliContainerConfig;
  persistValidatedAdapterTrace: (
    evidence: ValidatedCodexAdapterTraceEvidence
  ) => AdapterTraceBinding;
  scope: NativeCallScope;
  /** Available only after the failed process has durably settled. */
  verifyInterruptedSettlement: () => VerifiedInterruptedNativeCall;
}

interface ValidatedCodexAdapterTraceEvidence {
  adapter: "codex-jsonl-v1";
  authorInvocation?: {
    emittedSessionId: string;
    interrupted: boolean;
    request: string;
    role: "construct" | "repair" | "finalizer";
    stdoutSha256: string;
    structuredResponse: string;
  };
  inspectionInvocation?: {
    adapterRequest: string;
    collectorRequestId: string;
    emittedSessionId: string;
    lifecycleRequestSha256: string;
    rawAnswers: string;
    stdoutSha256: string;
  };
  codexRuntimeProfile?: CodexRuntimeProfile;
  evidenceMode: "images" | "sealed-text";
  model: string;
  orderedAttachments: readonly { name: string; sha256: string }[];
  trace: string;
  traceSha256: string;
}

export interface AdapterTraceBinding {
  authorInvocation?: {
    diagnosticTrigger?: VerifiedDiagnosticFinalizationTrigger & {
      identityFile: string;
      identitySha256: string;
    };
    emittedSessionId: string;
    intentFile: string;
    intentHash: string;
    interrupted: boolean;
    lifecycleRequestFile: string;
    lifecycleRequestSha256: string;
    requestFile: string;
    requestSha256: string;
    role: "construct" | "repair" | "finalizer";
    settlementFile: string;
    settlementSha256: string;
    stdoutSha256: string;
    structuredResponseFile: string;
    structuredResponseSha256: string;
    terminalFile: string;
    terminalSha256: string;
  };
  inspectionInvocation?: {
    adapterRequestFile: string;
    adapterRequestSha256: string;
    collectorRequestId: string;
    emittedSessionId: string;
    intentFile: string;
    intentHash: string;
    lifecycleRequestSha256: string;
    rawAnswersFile: string;
    rawAnswersSha256: string;
    settlementFile: string;
    settlementSha256: string;
    stdoutSha256: string;
    terminalFile: string;
    terminalSha256: string;
  };
  file: string;
  receiptFile: string;
  receiptSha256: string;
  sha256: string;
}

const issuedAdapterTraceBindings = new WeakSet<object>();

/** Proves that this exact in-memory binding was issued by this factory module. */
export const assertFactoryIssuedAdapterTrace = (
  binding: AdapterTraceBinding
) => {
  if (!issuedAdapterTraceBindings.has(binding)) {
    throw new Error("Adapter trace binding lacks collector factory authority");
  }
};

/** Consumes the exact process-local authority so a genuine seal cannot be replayed. */
export const consumeFactoryIssuedAdapterTrace = (
  binding: AdapterTraceBinding
) => {
  assertFactoryIssuedAdapterTrace(binding);
  issuedAdapterTraceBindings.delete(binding);
};

type NativeCallContainerBase = Omit<
  NativeCliContainerConfig,
  "beforeStart" | "persistIdentity" | "persistSettlement"
>;

export interface NativeCallContainerFactory {
  create: (request: {
    authorRequestBinding?: {
      adapterRequestSha256: string;
      lifecycleRequest: string;
      lifecycleRequestSha256: string;
      role: "construct" | "repair" | "finalizer";
    };
    inspectionRequestBinding?: {
      adapterRequestSha256: string;
      collectorRequestId: string;
      lifecycleRequestSha256: string;
    };
    codexRuntimeProfile?: CodexRuntimeProfile;
    cwd: string;
    deadlineAt: number;
    /** Diagnostic-only CLI feature removal, bound into collector evidence. */
    diagnosticDisabledFeatures?: readonly ["view_image"];
    diagnosticFinalization?: {
      finalizedReceiptHash: string;
      inspectionHash: string;
      programHashes: Readonly<Record<string, string>>;
      responseSchemaHash: string;
      stageDeadlineAt: number;
    };
    ordinal: number;
    accessProbe?: SameContainerAccessProbe;
    stageKind: string;
  }) => NativeCallContainerAllocation;
}

export interface NativeCallContainerFactoryOptions {
  boundaryDirectory: string;
  buildContainer: (scope: NativeCallScope) => NativeCallContainerBase;
  /** In-memory only and unavailable to serialized production configuration. */
  diagnosticFinalization?: DiagnosticFinalizationCapability;
  /** Durable control-plane evidence root, outside provider-writable runtimeRoot. */
  evidenceDirectory: string;
  minimumRemainingMs: number;
  parentDeadlineAt: number;
  requestId: string;
  reservationHash: string;
  /** Runtime-only author root. Never place this inside selected candidate evidence. */
  rootDirectory: string;
  stateEnvironmentName: "CODEX_HOME" | "HOME";
}

const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

const authorRoleForStage = (stageKind: string) => {
  if (stageKind === "finalize") {
    return "finalizer";
  }
  if (stageKind === "construct" || stageKind === "repair") {
    return stageKind;
  }
};

const writeExclusiveSealed = (file: string, bytes: string | Uint8Array) => {
  const descriptor = openSync(file, "wx", 0o600);
  try {
    writeFileSync(descriptor, bytes);
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

const writeExclusiveJson = (file: string, value: unknown) => {
  writeExclusiveSealed(file, `${JSON.stringify(value, null, 2)}\n`);
};

const within = (root: string, child: string) => {
  const relative = path.relative(root, child);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const isOwnedDirectory = (directory: string) => {
  const metadata = lstatSync(directory);
  return metadata.isDirectory() && !metadata.isSymbolicLink();
};

const createOwnedDescendant = (root: string, directory: string) => {
  const relative = path.relative(root, directory);
  if (!within(root, directory)) {
    throw new Error("Native call directory must stay inside its owned root");
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (existsSync(current)) {
      if (!isOwnedDirectory(current)) {
        throw new Error("Native call directory cannot traverse a link");
      }
    } else {
      mkdirSync(current, { mode: 0o700 });
    }
  }
};

// oxlint-disable-next-line eslint/complexity -- validates all factory authority and filesystem bounds at one seam.
export const createNativeCallContainerFactory = (
  options: NativeCallContainerFactoryOptions
): NativeCallContainerFactory => {
  const rootDirectory = path.resolve(options.rootDirectory);
  const evidenceDirectory = path.resolve(options.evidenceDirectory);
  const boundaryDirectory = path.resolve(options.boundaryDirectory);
  const usedDirectories = new Set<string>();
  let diagnosticAllocated = false;
  if (
    !path.isAbsolute(options.boundaryDirectory) ||
    !path.isAbsolute(options.evidenceDirectory) ||
    !path.isAbsolute(options.rootDirectory) ||
    !Number.isSafeInteger(options.parentDeadlineAt) ||
    !Number.isSafeInteger(options.minimumRemainingMs) ||
    !isOwnedDirectory(rootDirectory) ||
    !isOwnedDirectory(evidenceDirectory) ||
    !isOwnedDirectory(boundaryDirectory) ||
    realpathSync(rootDirectory) !== rootDirectory ||
    realpathSync(evidenceDirectory) !== evidenceDirectory ||
    realpathSync(boundaryDirectory) !== boundaryDirectory ||
    evidenceDirectory === rootDirectory ||
    boundaryDirectory === rootDirectory ||
    within(rootDirectory, evidenceDirectory) ||
    within(evidenceDirectory, rootDirectory) ||
    within(rootDirectory, boundaryDirectory) ||
    within(boundaryDirectory, rootDirectory) ||
    (options.diagnosticFinalization !== undefined &&
      (options.diagnosticFinalization.descriptor.requestId !==
        options.requestId ||
        options.diagnosticFinalization.descriptor.reservationHash !==
          options.reservationHash))
  ) {
    throw new Error("Native call factory needs absolute, bounded inputs");
  }
  return {
    // Identity, directory, call-journal and diagnostic guards meet here.
    // oxlint-disable-next-line eslint/complexity
    create: ({
      authorRequestBinding,
      codexRuntimeProfile,
      cwd,
      deadlineAt,
      diagnosticDisabledFeatures,
      diagnosticFinalization,
      accessProbe,
      inspectionRequestBinding,
      ordinal,
      stageKind,
    }) => {
      const callDirectory = path.resolve(cwd);
      const nativeStage = `${String(ordinal).padStart(2, "0")}-${stageKind}`;
      if (
        !path.isAbsolute(cwd) ||
        !within(rootDirectory, callDirectory) ||
        usedDirectories.has(callDirectory) ||
        deadlineAt !== options.parentDeadlineAt ||
        (diagnosticDisabledFeatures !== undefined &&
          (diagnosticDisabledFeatures.length !== 1 ||
            diagnosticDisabledFeatures[0] !== "view_image" ||
            stageKind !== "diagnostic-mini-image-capability")) ||
        (codexRuntimeProfile !== undefined &&
          codexRuntimeProfile !== CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE) ||
        (codexRuntimeProfile !== undefined &&
          diagnosticDisabledFeatures !== undefined) ||
        !Number.isSafeInteger(ordinal) ||
        ordinal < 0 ||
        !/^[a-z0-9][a-z0-9-]{0,60}$/u.test(stageKind) ||
        (accessProbe !== undefined && accessProbe.plan.stageId !== nativeStage)
      ) {
        throw new Error("Native call scope must be unique and parent-bounded");
      }
      const expectedAuthorRole = authorRoleForStage(stageKind);
      if (
        authorRequestBinding !== undefined &&
        (authorRequestBinding.role !== expectedAuthorRole ||
          !/^[a-f0-9]{64}$/u.test(authorRequestBinding.adapterRequestSha256) ||
          digest(authorRequestBinding.lifecycleRequest) !==
            authorRequestBinding.lifecycleRequestSha256 ||
          !/^[a-f0-9]{64}$/u.test(authorRequestBinding.lifecycleRequestSha256))
      ) {
        throw new Error(
          "Author request binding did not match the native stage"
        );
      }
      if (
        inspectionRequestBinding !== undefined &&
        (authorRequestBinding !== undefined ||
          stageKind !== "author-self-review" ||
          !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/u.test(
            inspectionRequestBinding.collectorRequestId
          ) ||
          !/^[a-f0-9]{64}$/u.test(
            inspectionRequestBinding.adapterRequestSha256
          ) ||
          !/^[a-f0-9]{64}$/u.test(
            inspectionRequestBinding.lifecycleRequestSha256
          ))
      ) {
        throw new Error(
          "Inspection request binding did not match the native stage"
        );
      }
      if (
        diagnosticFinalization &&
        (!options.diagnosticFinalization ||
          diagnosticAllocated ||
          stageKind !== "finalize" ||
          diagnosticFinalization.stageDeadlineAt > deadlineAt ||
          !Object.values(diagnosticFinalization.programHashes).every((hash) =>
            /^[a-f0-9]{64}$/u.test(hash)
          ) ||
          ![
            diagnosticFinalization.finalizedReceiptHash,
            diagnosticFinalization.inspectionHash,
            diagnosticFinalization.responseSchemaHash,
          ].every((hash) => /^[a-f0-9]{64}$/u.test(hash)))
      ) {
        throw new Error(
          "Diagnostic interruption is single-use and finalization-only"
        );
      }
      createOwnedDescendant(rootDirectory, callDirectory);
      const stateDirectory = path.join(callDirectory, "native-state");
      mkdirSync(stateDirectory, { mode: 0o700 });
      const intent = reserveNativeCall({
        deadlineAt,
        directory: boundaryDirectory,
        minimumRemainingMs: options.minimumRemainingMs,
        requestId: options.requestId,
        reservationHash: options.reservationHash,
        stage: nativeStage,
      });
      const base = options.buildContainer({
        cwd: callDirectory,
        deadlineAt,
        intent,
        stateDirectory,
      });
      if (
        accessProbe &&
        (accessProbe.plan.allowed.containerPath !== base.nativeCommand ||
          accessProbe.plan.allowed.sha256 !== base.nativeExecutableSha256)
      ) {
        throw new Error(
          "Same-container access probe must bind the allocated native executable"
        );
      }
      if (
        diagnosticFinalization &&
        options.diagnosticFinalization &&
        (options.diagnosticFinalization.descriptor.expectedImage !==
          base.image ||
          options.diagnosticFinalization.descriptor.originalDeadlineAt !==
            options.parentDeadlineAt ||
          options.diagnosticFinalization.descriptor.reservationHash !==
            options.reservationHash)
      ) {
        throw new Error(
          "Diagnostic capability must match the exact image and reservation"
        );
      }
      const statePath = base.environment?.[options.stateEnvironmentName];
      const writableMounts = base.stateMounts.filter(
        (mount) => !mount.readOnly
      );
      if (
        statePath !== stateDirectory ||
        writableMounts.length !== 1 ||
        writableMounts[0]?.containerPath !== stateDirectory ||
        path.resolve(writableMounts[0].hostPath) !== stateDirectory ||
        base.stateMounts.some(
          (mount) =>
            !mount.readOnly && path.resolve(mount.hostPath) !== stateDirectory
        )
      ) {
        throw new Error(
          `${options.stateEnvironmentName} must map to the fresh call state directory`
        );
      }
      const callEvidenceDirectory = path.join(
        evidenceDirectory,
        `${String(ordinal).padStart(2, "0")}-${stageKind}`
      );
      createOwnedDescendant(evidenceDirectory, callEvidenceDirectory);
      const identityFile = path.join(
        callEvidenceDirectory,
        "container-identity.json"
      );
      const settlementFile = path.join(
        callEvidenceDirectory,
        "container-settlement.json"
      );
      const createRequestFile = path.join(
        callEvidenceDirectory,
        "container-create-request.json"
      );
      const inspectResultFile = path.join(
        callEvidenceDirectory,
        "container-inspect-result.json"
      );
      const descriptorFile = path.join(
        callEvidenceDirectory,
        "container-descriptor.json"
      );
      const adapterTraceFile = path.join(
        callEvidenceDirectory,
        "adapter-trace.jsonl"
      );
      const adapterTraceReceiptFile = path.join(
        callEvidenceDirectory,
        "adapter-trace-receipt.json"
      );
      const adapterRequestFile = path.join(
        callEvidenceDirectory,
        "adapter-request.json"
      );
      const adapterResponseFile = path.join(
        callEvidenceDirectory,
        "adapter-structured-response.json"
      );
      const lifecycleRequestFile = path.join(
        callEvidenceDirectory,
        "lifecycle-request.json"
      );
      const triggerReceipt = path.join(
        callEvidenceDirectory,
        "diagnostic-trigger.json"
      );
      const securityInspectFile = path.join(
        callEvidenceDirectory,
        "same-container-security-inspect.json"
      );
      const terminalFile = path.join(
        boundaryDirectory,
        `${intent.callId}.terminal.json`
      );
      const intentFile = path.join(
        boundaryDirectory,
        `${intent.callId}.intent.json`
      );
      usedDirectories.add(callDirectory);
      let settled:
        | {
            container: ContainerProcessResult;
            evidenceHash: string;
            terminal: ReturnType<typeof settleNativeCall>;
          }
        | undefined;
      let accessBinding: SameContainerAccessBinding | undefined;
      let verifiedDiagnosticTrigger:
        | VerifiedDiagnosticFinalizationTrigger
        | undefined;
      let persistedIdentity:
        | {
            containerId: string;
            containerName: string;
            image: string;
            ownershipToken: string;
          }
        | undefined;
      const config: NativeCliContainerConfig = {
        ...base,
        ...(accessProbe
          ? {
              sameContainerAccessProbe: {
                observe: async (observation, identity, security) => {
                  const receipt = await accessProbe.observe(
                    observation,
                    identity,
                    security
                  );
                  writeExclusiveSealed(
                    securityInspectFile,
                    security.rawInspect
                  );
                  return {
                    ...receipt,
                    securityInspectFile,
                    securityInspectSha256: digest(security.rawInspect),
                  };
                },
                plan: accessProbe.plan,
              },
            }
          : {}),
        ...(diagnosticFinalization && options.diagnosticFinalization
          ? {
              diagnosticFinalizationObserver:
                bindDiagnosticFinalizationObserver({
                  binding: {
                    ...diagnosticFinalization,
                    callId: intent.callId,
                    intentHash: digest(JSON.stringify(intent)),
                    stage: intent.stage,
                    triggerReceipt,
                  },
                  capability: options.diagnosticFinalization,
                }),
            }
          : {}),
        beforeStart: () => assertNativeCallMayStart(boundaryDirectory, intent),
        observeStop: () => observeNativeCallStop(boundaryDirectory, intent),
        persistAccessBinding: (binding) => {
          if (!accessProbe || accessBinding) {
            throw new Error("Same-container access binding was unexpected");
          }
          accessBinding = binding;
        },
        persistIdentity: (identity) => {
          writeExclusiveJson(identityFile, identity);
          persistedIdentity = Object.freeze({ ...identity });
        },
        persistSettlement: (container: ContainerProcessResult) => {
          if (container.controlEvidence) {
            writeExclusiveJson(
              createRequestFile,
              container.controlEvidence.createRequest
            );
            writeExclusiveJson(
              inspectResultFile,
              container.controlEvidence.inspectResult
            );
            writeExclusiveJson(descriptorFile, {
              adapter:
                options.stateEnvironmentName === "CODEX_HOME"
                  ? "codex-jsonl-v1"
                  : "claude-stream-json-v1",
              adapterTrace: "not-collected",
              ...(diagnosticDisabledFeatures
                ? { diagnosticDisabledFeatures }
                : {}),
              ...(codexRuntimeProfile ? { codexRuntimeProfile } : {}),
              ...(codexRuntimeProfile
                ? {
                    disabledFeatures: CODEX_MINI_INLINE_ONLY_DISABLED_FEATURES,
                  }
                : {}),
              environment: Object.fromEntries(
                Object.entries(base.environment ?? {}).map(([name, value]) => [
                  name,
                  `sha256:${digest(value)}`,
                ])
              ),
              evidenceRoot: callEvidenceDirectory,
              image: base.image,
              kind: "native-container-collector-descriptor-v1",
              mounts: [
                {
                  containerPath: callDirectory,
                  hostPath: callDirectory,
                  readOnly: false,
                },
                ...base.stateMounts.map((mount) => ({
                  ...mount,
                  hostPath: realpathSync(mount.hostPath),
                })),
              ],
              nativeCliVersion: base.nativeCliVersion,
              nativeCommand: base.nativeCommand,
              nativeExecutableSha256: base.nativeExecutableSha256,
              network: base.network ?? "bridge",
              originalDeadlineAt: options.parentDeadlineAt,
              reservationHash: options.reservationHash,
              runtimeRoot: callDirectory,
              stage: intent.stage,
            });
          }
          const evidence = {
            container,
            deadlineAt: intent.deadlineAt,
            intentHash: digest(JSON.stringify(intent)),
          };
          const bytes = `${JSON.stringify(evidence, null, 2)}\n`;
          writeFileSync(settlementFile, bytes, { flag: "wx", mode: 0o600 });
          let outcome: "cancelled" | "complete" | "failed" = "failed";
          if (container.status === "complete") {
            outcome = "complete";
          } else if (container.cancelledByStop) {
            outcome = "cancelled";
          }
          const terminal = settleNativeCall({
            accounting: container.containerAbsent ? "settled" : "unknown",
            containment: container.containerAbsent
              ? "container-absent"
              : "unproven",
            directory: boundaryDirectory,
            evidenceFile: settlementFile,
            evidenceHash: digest(bytes),
            intent,
            outcome,
          });
          settled = { container, evidenceHash: digest(bytes), terminal };
        },
      };
      diagnosticAllocated ||= diagnosticFinalization !== undefined;
      return {
        accessProbeBinding: () => {
          if (!settled || !accessProbe || !accessBinding) {
            throw new Error(
              "Same-container access binding needs a durable settlement"
            );
          }
          if (
            accessBinding.stageId !== intent.stage ||
            accessBinding.planSha256 !== accessProbe.plan.planSha256 ||
            accessBinding.containerId !== settled.container.containerId ||
            accessBinding.securityInspectFile !== securityInspectFile ||
            !within(
              evidenceDirectory,
              realpathSync(accessBinding.receiptFile)
            ) ||
            within(callDirectory, realpathSync(accessBinding.receiptFile)) ||
            lstatSync(accessBinding.receiptFile).isSymbolicLink() ||
            !lstatSync(accessBinding.receiptFile).isFile() ||
            lstatSync(accessBinding.receiptFile).nlink !== 1 ||
            digest(readFileSync(accessBinding.receiptFile)) !==
              accessBinding.receiptSha256 ||
            lstatSync(securityInspectFile).nlink !== 1 ||
            digest(readFileSync(securityInspectFile)) !==
              accessBinding.securityInspectSha256
          ) {
            throw new Error("Same-container access binding did not match call");
          }
          return accessBinding;
        },
        config,
        // oxlint-disable-next-line eslint/complexity -- validates the complete durable trace/settlement boundary in one atomic branch.
        persistValidatedAdapterTrace: (evidence) => {
          const author = evidence.authorInvocation;
          const inspection = evidence.inspectionInvocation;
          if (
            options.stateEnvironmentName !== "CODEX_HOME" ||
            evidence.adapter !== "codex-jsonl-v1" ||
            evidence.codexRuntimeProfile !== codexRuntimeProfile ||
            !evidence.model.trim() ||
            !evidence.trace.trim() ||
            !/^[a-f0-9]{64}$/u.test(evidence.traceSha256) ||
            digest(evidence.trace) !== evidence.traceSha256 ||
            new Set(evidence.orderedAttachments.map(({ name }) => name))
              .size !== evidence.orderedAttachments.length ||
            evidence.orderedAttachments.some(
              ({ name, sha256 }) =>
                !/^[a-z0-9-]+\.png$/u.test(name) ||
                !/^[a-f0-9]{64}$/u.test(sha256)
            ) ||
            (evidence.evidenceMode === "sealed-text" &&
              evidence.orderedAttachments.length !== 0) ||
            (evidence.evidenceMode === "images" &&
              evidence.orderedAttachments.length === 0) ||
            (author !== undefined && inspection !== undefined) ||
            (author !== undefined &&
              (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/u.test(
                author.emittedSessionId
              ) ||
                !["construct", "repair", "finalizer"].includes(author.role) ||
                !author.request.trim() ||
                !author.structuredResponse.trim() ||
                !/^[a-f0-9]{64}$/u.test(author.stdoutSha256) ||
                (author.interrupted && author.role !== "finalizer"))) ||
            (inspection !== undefined &&
              (!inspection.adapterRequest.trim() ||
                !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/u.test(
                  inspection.collectorRequestId
                ) ||
                !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/u.test(
                  inspection.emittedSessionId
                ) ||
                !/^[a-f0-9]{64}$/u.test(inspection.lifecycleRequestSha256) ||
                !inspection.rawAnswers.trim() ||
                !/^[a-f0-9]{64}$/u.test(inspection.stdoutSha256)))
          ) {
            throw new Error(
              "Validated Codex adapter trace evidence is invalid"
            );
          }
          const lifecycleRequestSha256 =
            authorRequestBinding?.lifecycleRequestSha256;
          if (author) {
            if (
              !authorRequestBinding ||
              !lifecycleRequestSha256 ||
              author.role !== authorRequestBinding.role ||
              digest(author.request) !==
                authorRequestBinding.adapterRequestSha256
            ) {
              throw new Error(
                "Validated author trace did not match its allocated request"
              );
            }
            if (!settled) {
              throw new Error(
                "Validated author trace needs a durable settlement"
              );
            }
            const { container } = settled;
            const { process } = container;
            const settlementBytes = readFileSync(settlementFile);
            const terminalBytes = readFileSync(terminalFile);
            const intentBytes = readFileSync(intentFile);
            const expectedSettlementBytes = `${JSON.stringify(
              {
                container,
                deadlineAt: intent.deadlineAt,
                intentHash: digest(JSON.stringify(intent)),
              },
              null,
              2
            )}\n`;
            const expectedTerminalBytes = `${JSON.stringify(
              settled.terminal,
              null,
              2
            )}\n`;
            if (
              lstatSync(settlementFile).isSymbolicLink() ||
              !lstatSync(settlementFile).isFile() ||
              lstatSync(settlementFile).nlink !== 1 ||
              lstatSync(terminalFile).isSymbolicLink() ||
              !lstatSync(terminalFile).isFile() ||
              lstatSync(terminalFile).nlink !== 1 ||
              lstatSync(intentFile).isSymbolicLink() ||
              !lstatSync(intentFile).isFile() ||
              lstatSync(intentFile).nlink !== 1 ||
              intentBytes.toString("utf-8") !==
                `${JSON.stringify(intent, null, 2)}\n` ||
              settlementBytes.toString("utf-8") !== expectedSettlementBytes ||
              terminalBytes.toString("utf-8") !== expectedTerminalBytes ||
              digest(settlementBytes) !== settled.evidenceHash ||
              settled.terminal.intentHash !== digest(JSON.stringify(intent)) ||
              settled.terminal.evidenceFile !== settlementFile ||
              settled.terminal.evidenceHash !== settled.evidenceHash ||
              settled.terminal.accounting !== "settled" ||
              settled.terminal.containment !== "container-absent" ||
              settled.terminal.deadlineExceeded !== false ||
              settled.terminal.settledAt >= intent.deadlineAt ||
              container.containerAbsent !== true ||
              !process ||
              process.quiescent !== true ||
              author.stdoutSha256 !== digest(process.stdout) ||
              (author.interrupted
                ? container.status !== "workload-failed" ||
                  settled.terminal.outcome !== "failed"
                : container.status !== "complete" ||
                  settled.terminal.outcome !== "complete" ||
                  process.code !== 0 ||
                  process.killed)
            ) {
              throw new Error(
                "Validated author trace needs a settled, absent container"
              );
            }
            if (
              (author.interrupted && !verifiedDiagnosticTrigger) ||
              (!author.interrupted && verifiedDiagnosticTrigger)
            ) {
              throw new Error(
                "Validated author interruption lacked its verified diagnostic trigger"
              );
            }
          }
          if (inspection) {
            if (
              !inspectionRequestBinding ||
              inspection.collectorRequestId !==
                inspectionRequestBinding.collectorRequestId ||
              inspection.lifecycleRequestSha256 !==
                inspectionRequestBinding.lifecycleRequestSha256 ||
              digest(inspection.adapterRequest) !==
                inspectionRequestBinding.adapterRequestSha256
            ) {
              throw new Error(
                "Validated inspection trace did not match its allocated request"
              );
            }
            if (!settled) {
              throw new Error(
                "Validated inspection trace needs a durable settlement"
              );
            }
            const { container } = settled;
            const { process } = container;
            const settlementBytes = readFileSync(settlementFile);
            const terminalBytes = readFileSync(terminalFile);
            const intentBytes = readFileSync(intentFile);
            if (
              lstatSync(settlementFile).isSymbolicLink() ||
              !lstatSync(settlementFile).isFile() ||
              lstatSync(settlementFile).nlink !== 1 ||
              lstatSync(terminalFile).isSymbolicLink() ||
              !lstatSync(terminalFile).isFile() ||
              lstatSync(terminalFile).nlink !== 1 ||
              lstatSync(intentFile).isSymbolicLink() ||
              !lstatSync(intentFile).isFile() ||
              lstatSync(intentFile).nlink !== 1 ||
              intentBytes.toString("utf-8") !==
                `${JSON.stringify(intent, null, 2)}\n` ||
              digest(settlementBytes) !== settled.evidenceHash ||
              digest(terminalBytes) !==
                digest(`${JSON.stringify(settled.terminal, null, 2)}\n`) ||
              settled.terminal.intentHash !== digest(JSON.stringify(intent)) ||
              settled.terminal.evidenceFile !== settlementFile ||
              settled.terminal.evidenceHash !== settled.evidenceHash ||
              settled.terminal.accounting !== "settled" ||
              settled.terminal.containment !== "container-absent" ||
              settled.terminal.deadlineExceeded !== false ||
              settled.terminal.settledAt >= intent.deadlineAt ||
              container.containerAbsent !== true ||
              container.status !== "complete" ||
              !process ||
              process.quiescent !== true ||
              process.code !== 0 ||
              process.killed ||
              inspection.stdoutSha256 !== digest(process.stdout)
            ) {
              throw new Error(
                "Validated inspection trace needs a settled, absent container"
              );
            }
          }
          writeExclusiveSealed(adapterTraceFile, evidence.trace);
          const authorBinding = author
            ? (() => {
                if (!settled) {
                  throw new Error(
                    "Validated author trace needs a durable settlement"
                  );
                }
                if (!lifecycleRequestSha256) {
                  throw new Error(
                    "Validated author trace lacks lifecycle request identity"
                  );
                }
                writeExclusiveSealed(adapterRequestFile, author.request);
                writeExclusiveSealed(
                  adapterResponseFile,
                  author.structuredResponse
                );
                writeExclusiveSealed(
                  lifecycleRequestFile,
                  authorRequestBinding.lifecycleRequest
                );
                return {
                  ...(verifiedDiagnosticTrigger
                    ? {
                        diagnosticTrigger: {
                          ...verifiedDiagnosticTrigger,
                          identityFile,
                          identitySha256: digest(readFileSync(identityFile)),
                        },
                      }
                    : {}),
                  emittedSessionId: author.emittedSessionId,
                  intentFile,
                  intentHash: digest(JSON.stringify(intent)),
                  interrupted: author.interrupted,
                  lifecycleRequestFile,
                  lifecycleRequestSha256,
                  requestFile: adapterRequestFile,
                  requestSha256: digest(author.request),
                  role: author.role,
                  settlementFile,
                  settlementSha256: settled.evidenceHash,
                  stdoutSha256: author.stdoutSha256,
                  structuredResponseFile: adapterResponseFile,
                  structuredResponseSha256: digest(author.structuredResponse),
                  terminalFile,
                  terminalSha256: digest(readFileSync(terminalFile)),
                };
              })()
            : undefined;
          const inspectionBinding = inspection
            ? (() => {
                if (!settled) {
                  throw new Error(
                    "Validated inspection trace needs a durable settlement"
                  );
                }
                writeExclusiveSealed(
                  adapterRequestFile,
                  inspection.adapterRequest
                );
                writeExclusiveSealed(
                  adapterResponseFile,
                  inspection.rawAnswers
                );
                return {
                  adapterRequestFile,
                  adapterRequestSha256: digest(inspection.adapterRequest),
                  collectorRequestId: inspection.collectorRequestId,
                  emittedSessionId: inspection.emittedSessionId,
                  intentFile,
                  intentHash: digest(JSON.stringify(intent)),
                  lifecycleRequestSha256: inspection.lifecycleRequestSha256,
                  rawAnswersFile: adapterResponseFile,
                  rawAnswersSha256: digest(inspection.rawAnswers),
                  settlementFile,
                  settlementSha256: settled.evidenceHash,
                  stdoutSha256: inspection.stdoutSha256,
                  terminalFile,
                  terminalSha256: digest(readFileSync(terminalFile)),
                };
              })()
            : undefined;
          const receipt = {
            adapter: evidence.adapter,
            ...(codexRuntimeProfile ? { codexRuntimeProfile } : {}),
            ...(codexRuntimeProfile
              ? {
                  disabledFeatures: CODEX_MINI_INLINE_ONLY_DISABLED_FEATURES,
                }
              : {}),
            evidenceMode: evidence.evidenceMode,
            ...(author || inspection ? { emittedModel: evidence.model } : {}),
            kind: "collector-owned-adapter-trace-v1",
            ...(authorBinding ? { authorInvocation: authorBinding } : {}),
            ...(inspectionBinding
              ? { inspectionInvocation: inspectionBinding }
              : {}),
            model: evidence.model,
            nativeStage: intent.stage,
            orderedAttachments: evidence.orderedAttachments,
            requestId: intent.requestId,
            traceFile: path.basename(adapterTraceFile),
            traceSha256: evidence.traceSha256,
          };
          const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
          writeExclusiveSealed(adapterTraceReceiptFile, receiptBytes);
          const binding = Object.freeze({
            ...(authorBinding ? { authorInvocation: authorBinding } : {}),
            ...(inspectionBinding
              ? { inspectionInvocation: inspectionBinding }
              : {}),
            file: adapterTraceFile,
            receiptFile: adapterTraceReceiptFile,
            receiptSha256: digest(receiptBytes),
            sha256: evidence.traceSha256,
          });
          issuedAdapterTraceBindings.add(binding);
          return binding;
        },
        scope: { cwd: callDirectory, deadlineAt, intent, stateDirectory },
        // Every branch is an independent fail-closed settlement invariant.
        // oxlint-disable-next-line eslint/complexity
        verifyInterruptedSettlement: () => {
          if (!settled) {
            throw new Error("Native call has no durable settlement");
          }
          if (
            lstatSync(settlementFile).isSymbolicLink() ||
            !lstatSync(settlementFile).isFile() ||
            lstatSync(terminalFile).isSymbolicLink() ||
            !lstatSync(terminalFile).isFile()
          ) {
            throw new Error("Native interrupted settlement must be regular");
          }
          const evidenceBytes = readFileSync(settlementFile);
          const terminalBytes = readFileSync(terminalFile);
          const evidence = JSON.parse(evidenceBytes.toString("utf-8"));
          const terminal = JSON.parse(terminalBytes.toString("utf-8"));
          const { container } = settled;
          const { process } = container;
          if (
            !diagnosticFinalization ||
            !options.diagnosticFinalization ||
            !persistedIdentity ||
            digest(evidenceBytes) !== settled.evidenceHash ||
            digest(terminalBytes) !==
              digest(`${JSON.stringify(settled.terminal, null, 2)}\n`) ||
            evidence.intentHash !== digest(JSON.stringify(intent)) ||
            evidence.deadlineAt !== intent.deadlineAt ||
            evidence.container?.containerId !== container.containerId ||
            persistedIdentity.containerId !== container.containerId ||
            terminal.intentHash !== digest(JSON.stringify(intent)) ||
            terminal.evidenceFile !== settlementFile ||
            terminal.evidenceHash !== settled.evidenceHash ||
            terminal.outcome !== "failed" ||
            terminal.accounting !== "settled" ||
            terminal.containment !== "container-absent" ||
            terminal.deadlineExceeded !== false ||
            terminal.settledAt >= intent.deadlineAt ||
            container.status !== "workload-failed" ||
            container.artifactEligible !== false ||
            container.containerAbsent !== true ||
            typeof container.containerId !== "string" ||
            !/^[a-f0-9]{64}$/u.test(container.containerId) ||
            container.containmentScope !== "docker-private-pid-namespace" ||
            !process ||
            (process.code !== null && typeof process.code !== "number") ||
            process.quiescent !== true ||
            process.quiescenceScope !==
              "process-group-and-observed-descendants" ||
            (process.code === 0 && !process.killed)
          ) {
            throw new Error(
              "Native interrupted settlement is not safely recoverable"
            );
          }
          const diagnosticTrigger = verifyDiagnosticFinalizationTrigger({
            capability: options.diagnosticFinalization,
            expected: {
              callId: intent.callId,
              containerId: persistedIdentity.containerId,
              containerName: persistedIdentity.containerName,
              finalizedReceiptHash: diagnosticFinalization.finalizedReceiptHash,
              image: persistedIdentity.image,
              inspectionHash: diagnosticFinalization.inspectionHash,
              intentHash: digest(JSON.stringify(intent)),
              programHashes: diagnosticFinalization.programHashes,
              responseSchemaHash: diagnosticFinalization.responseSchemaHash,
              stage: intent.stage,
              stageDeadlineAt: diagnosticFinalization.stageDeadlineAt,
            },
            triggerReceipt,
          });
          verifiedDiagnosticTrigger = diagnosticTrigger;
          return Object.freeze({
            accounting: "settled" as const,
            callId: intent.callId,
            containerAbsent: true as const,
            containerId: container.containerId,
            containment: "container-absent" as const,
            containmentScope: "docker-private-pid-namespace" as const,
            deadlineAt: intent.deadlineAt,
            deadlineExceeded: false as const,
            diagnosticTrigger,
            evidenceFile: settlementFile,
            evidenceHash: settled.evidenceHash,
            intentHash: digest(JSON.stringify(intent)),
            killed: process.killed,
            kind: "verified-contained-finalization-interruption" as const,
            outcome: "failed" as const,
            processCode: process.code,
            quiescenceScope: "process-group-and-observed-descendants" as const,
            quiescent: true as const,
            settledAt: terminal.settledAt,
            stage: intent.stage,
          });
        },
      };
    },
  };
};

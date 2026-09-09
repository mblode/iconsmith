import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { ACCEPTANCE_CONTRACT_VERSION } from "../src/eval/acceptance-contract.js";
import { qualifyCriticAgainstIndependentAiPanel } from "./ai-qualification.js";
import type {
  AiCriticPrediction,
  AiPanelQualificationStimulus,
  IndependentAiPanelReview,
} from "./ai-qualification.js";
import {
  API_COLLECTOR_ROUTE_HASH,
  API_COLLECTOR_STAGE_ACTOR,
  withVerifiedApiCollectorStage,
} from "./api-image-capability.js";
import type {
  ApiCollectorStageCapability,
  ApiCollectorStageEvidenceBindings,
  ApiCollectorStageVerificationExpectation,
  VerifiedApiCollectorStageEvidence,
} from "./api-image-capability.js";
import type {
  SameContainerAccessObservation,
  SameContainerAccessProbePlan,
} from "./local-container-runtime.js";

const HASH = /^[a-f0-9]{64}$/u;
const validIdentity = (value: unknown) =>
  typeof value === "string" && value.trim() === value && value.length > 0;
const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export interface FileBinding {
  file: string;
  sha256: string;
}
export interface StimulusEvidenceBinding {
  artifact: FileBinding;
  attachments: readonly FileBinding[];
  craft: FileBinding;
  producerReceipt?: FileBinding;
  protocol: FileBinding;
  recognition: FileBinding;
  sources?: readonly FileBinding[];
  stimulusId: string;
}
interface RequestedNaturalSlot {
  conceptId: string;
  familyId: string;
  id: string;
  nativeSize: 16 | 24;
  paint: "filled" | "outlined";
  sourceArtifactHashes: readonly string[];
  sourceLineageHash: string;
}
interface QualificationEvidenceManifest {
  artifacts: readonly StimulusEvidenceBinding[];
  contractVersion: string;
  criticReceipt: FileBinding;
  exposureSidecar: FileBinding;
  labelsExposedBeforePrediction: boolean;
  panelReceipts: readonly FileBinding[];
  population: FileBinding;
  qualificationId: string;
  requestedSlots: FileBinding;
  scope: string;
}

const readBound = (base: string, binding: FileBinding) => {
  if (!binding?.file || !HASH.test(binding.sha256)) {
    throw new Error("Qualification evidence has an invalid file binding");
  }
  if (path.isAbsolute(binding.file)) {
    throw new Error(
      "Qualification evidence must stay inside its evidence root"
    );
  }
  const unresolved = path.resolve(base, binding.file);
  const unresolvedRelative = path.relative(base, unresolved);
  if (
    unresolvedRelative === ".." ||
    unresolvedRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(unresolvedRelative)
  ) {
    throw new Error(
      "Qualification evidence must stay inside its evidence root"
    );
  }
  if (lstatSync(unresolved).isSymbolicLink()) {
    throw new Error(
      `Qualification evidence cannot be a symlink: ${binding.file}`
    );
  }
  const file = realpathSync(unresolved);
  const relative = path.relative(base, file);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      "Qualification evidence must stay inside its evidence root"
    );
  }
  const bytes = readFileSync(file);
  if (sha(bytes) !== binding.sha256) {
    throw new Error(`Qualification evidence hash mismatch: ${binding.file}`);
  }
  return bytes;
};
const readBoundJson = (base: string, binding: FileBinding) =>
  JSON.parse(readBound(base, binding).toString("utf-8"));

const readAbsoluteBound = (binding: FileBinding) => {
  if (!path.isAbsolute(binding.file) || !HASH.test(binding.sha256)) {
    throw new Error("Collector absolute evidence binding is invalid");
  }
  const metadata = lstatSync(binding.file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    realpathSync(binding.file) !== binding.file
  ) {
    throw new Error("Collector absolute evidence path is not canonical");
  }
  const bytes = readFileSync(binding.file);
  if (sha(bytes) !== binding.sha256) {
    throw new Error(
      `Collector absolute evidence hash mismatch: ${binding.file}`
    );
  }
  return bytes;
};

interface CollectorProductionCriticSubject {
  artifactHash: string;
  conceptId: string;
  familyId: string;
  master: string;
  nativePresentationHashes: readonly [string, string];
  nativeSize: 16 | 24;
  paint: "filled" | "outlined";
  requestIntentHash: string;
  slotId: string;
}

export interface CollectorStageExpectation {
  actor: { baseModelLineage: string; model: string; provider: string };
  evidenceMode: "images" | "sealed-text";
  id: string;
  /** Stable prompt/instrument schema identity, excluding per-stimulus content. */
  instrumentHash?: string;
  nativeStage: string;
  orderedAttachments: readonly { name: string; sha256: string }[];
  outputSha256: string;
  requestId: string;
  role:
    | "adjudication"
    | "craft"
    | "panel"
    | "prediction"
    | "production-critic"
    | "recognition";
  routeHash: string;
  /** Host-frozen candidate identity for a production critic stage. */
  subject?: CollectorProductionCriticSubject;
}

export interface VerifiedCollectorStageSummary {
  readonly actor: CollectorStageExpectation["actor"];
  readonly answers: Readonly<
    Record<string, { choice: string; evidence: string; treatment: string }>
  >;
  readonly answersHash: string;
  readonly evidenceMode: CollectorStageExpectation["evidenceMode"];
  readonly id: string;
  readonly instrumentHash?: string;
  readonly nativeStage: string;
  readonly orderedAttachments: CollectorStageExpectation["orderedAttachments"];
  readonly outputSha256: string;
  readonly promptSha256: string;
  readonly requestId: string;
  readonly role: CollectorStageExpectation["role"];
  readonly routeHash: string;
  readonly settledAt: number;
  readonly startedAt: number;
  readonly subject?: CollectorProductionCriticSubject;
}

export interface CollectorAccessExpectation {
  accessPolicySha256: string;
  forbiddenHostRoots: readonly string[];
  originalDeadlineAt: number;
  qualificationId: string;
  reservationHash: string;
  sessionId: string;
  stages: readonly CollectorStageExpectation[];
}

export interface CollectorApiTransportStageExpectation {
  expectation: CollectorStageExpectation;
  id: string;
  stageDeadlineAt: number;
}

export interface CollectorApiTransportExpectation {
  kind: "collector-api-transport-expectation-v1";
  originalDeadlineAt: number;
  qualificationId: string;
  sessionId: string;
  stages: readonly CollectorApiTransportStageExpectation[];
}

export interface CollectorApiQualificationAssemblyExpectation {
  exposureSidecarSha256: string;
  populationSha256: string;
  qualificationId: string;
  requestedSlotsSha256: string;
}

declare const COLLECTOR_API_QUALIFICATION_ASSEMBLY: unique symbol;
export type CollectorApiQualificationAssemblyCapability = Readonly<{
  [COLLECTOR_API_QUALIFICATION_ASSEMBLY]: true;
}>;

interface CollectorApiQualificationAssemblyEntry {
  evidence: CollectorApiTransportExpectation;
  expectedJournalSha256: string;
  journalFile: string;
  runId: string;
  stages: readonly VerifiedCollectorStageSummary[];
}

interface CollectorApiQualificationAssemblyState {
  entries: Map<string, CollectorApiQualificationAssemblyEntry>;
  expectation: CollectorApiQualificationAssemblyExpectation;
}

const collectorApiQualificationAssemblies = new WeakMap<
  object,
  CollectorApiQualificationAssemblyState
>();
const consumedCollectorApiQualificationAssemblies = new WeakSet<object>();

type CollectorRunEvidence =
  | CollectorAccessExpectation
  | CollectorApiTransportExpectation;

export interface CollectorQualificationStageLink {
  promptSha256: string;
  runId: string;
  stageId: string;
}

interface CollectorCriticQualificationRow {
  adjudication: CollectorQualificationStageLink;
  panels: readonly [
    CollectorQualificationStageLink,
    CollectorQualificationStageLink,
  ];
  prediction: CollectorQualificationStageLink;
  recognition: CollectorQualificationStageLink;
  stimulusId: string;
}

interface CollectorCriticQualificationManifest {
  artifacts: readonly StimulusEvidenceBinding[];
  contractVersion: string;
  exposureSidecar: FileBinding;
  kind: "collector-critic-qualification-manifest-v1";
  lineageRegistry: FileBinding;
  population: FileBinding;
  qualificationId: string;
  requestedSlots: FileBinding;
  rows: readonly CollectorCriticQualificationRow[];
  runs: readonly {
    evidence: CollectorRunEvidence;
    id: string;
    journal: FileBinding;
  }[];
}

export interface CollectorStageAccessPolicy {
  actor: CollectorStageExpectation["actor"];
  allowedMounts: readonly {
    containerPath: string;
    hostPath: string;
    readOnly: boolean;
    sha256?: string;
  }[];
  id: string;
  network: "bridge" | "none";
  sameContainerAccessProbe: SameContainerAccessProbePlan;
  writableDirectory: {
    device: string;
    initialInventorySha256: string;
    inode: string;
    path: string;
  };
}

interface SameContainerAccessBinding {
  ackSha256: string;
  containerId: string;
  kind: "same-container-access-binding-v1";
  nonceSha256: string;
  observationSha256: string;
  planSha256: string;
  receipt: FileBinding;
  securityInspect: FileBinding;
  stageId: string;
}

export interface CollectorPreDispatchAccessPolicy {
  forbiddenHostRoots: readonly string[];
  kind: "collector-pre-dispatch-access-policy-v1";
  originalDeadlineAt: number;
  qualificationId: string;
  reservationHash: string;
  routeHash: string;
  sessionId: string;
  stages: readonly CollectorStageAccessPolicy[];
}

interface CollectorStageBinding {
  adapterRequest: FileBinding;
  adapterResult: FileBinding;
  adapterTrace: FileBinding;
  containerCreateRequest: FileBinding;
  containerDescriptor: FileBinding;
  containerIdentity: FileBinding;
  containerInspectResult: FileBinding;
  containerSettlement: FileBinding;
  expectation: CollectorStageExpectation;
  id: string;
  nativeIntent: FileBinding;
  nativeStarted: FileBinding;
  nativeTerminal: FileBinding;
  sameContainerAccess: SameContainerAccessBinding;
}

interface CollectorAccessJournal {
  accessPolicy: FileBinding;
  kind: string;
  originalDeadlineAt: number;
  qualificationId: string;
  reservationHash: string;
  sessionId: string;
  stages: CollectorStageBinding[];
}

interface CollectorApiTransportStageBinding {
  evidence: ApiCollectorStageEvidenceBindings;
  expectation: CollectorStageExpectation;
  id: string;
  kind: "collector-api-transport-stage-v1";
  stageDeadlineAt: number;
}

interface CollectorApiTransportJournal {
  kind: "collector-bound-api-stage-journal-v1";
  originalDeadlineAt: number;
  qualificationId: string;
  sessionId: string;
  stages: CollectorApiTransportStageBinding[];
}

const insideOrEqual = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};

const overlaps = (left: string, right: string) =>
  insideOrEqual(left, right) || insideOrEqual(right, left);

const sameContainerPlanHash = (plan: SameContainerAccessProbePlan) => {
  const { planSha256: _planSha256, ...identity } = plan;
  return sha(JSON.stringify(identity));
};

const expectedProbePaths = (roots: readonly string[]) =>
  roots.flatMap((root, index) => {
    const pathClass = `forbidden-${index}`;
    return [
      { containerPath: root, pathClass: `${pathClass}-direct` },
      {
        containerPath: `/proc/1/root${root}`,
        pathClass: `${pathClass}-proc-root`,
      },
      {
        containerPath: `/host_mnt${root}`,
        pathClass: `${pathClass}-host-mnt`,
      },
      {
        containerPath: `/run/host${root}`,
        pathClass: `${pathClass}-run-host`,
      },
    ];
  });

const isApiCollectorExpectation = (
  evidence: CollectorRunEvidence
): evidence is CollectorApiTransportExpectation =>
  "kind" in evidence &&
  evidence.kind === "collector-api-transport-expectation-v1";

const isUuid = (value: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
    value
  );

// Every field is part of one capability-to-journal authority boundary.
// eslint-disable-next-line complexity
const verifyApiCollectorStage = (
  capability: ApiCollectorStageCapability,
  expected: CollectorApiTransportStageExpectation,
  journalStage: CollectorApiTransportStageBinding,
  originalDeadlineAt: number,
  journalRoot: string
) => {
  const stage = expected.expectation;
  if (
    !validIdentity(expected.id) ||
    expected.id !== stage.id ||
    !Number.isSafeInteger(expected.stageDeadlineAt) ||
    expected.stageDeadlineAt > originalDeadlineAt ||
    stage.evidenceMode !== "images" ||
    !["panel", "prediction"].includes(stage.role) ||
    stage.subject !== undefined ||
    !HASH.test(stage.instrumentHash ?? "") ||
    !HASH.test(stage.outputSha256) ||
    !HASH.test(stage.routeHash) ||
    !validIdentity(stage.nativeStage) ||
    !validIdentity(stage.requestId) ||
    canonical(stage.actor) !== canonical(API_COLLECTOR_STAGE_ACTOR) ||
    stage.routeHash !== API_COLLECTOR_ROUTE_HASH ||
    !Array.isArray(stage.orderedAttachments) ||
    !stage.orderedAttachments.length ||
    new Set(stage.orderedAttachments.map(({ name }) => name)).size !==
      stage.orderedAttachments.length ||
    stage.orderedAttachments.some(
      ({ name, sha256 }) => !validIdentity(name) || !HASH.test(sha256)
    ) ||
    journalStage.kind !== "collector-api-transport-stage-v1" ||
    journalStage.id !== expected.id ||
    journalStage.stageDeadlineAt !== expected.stageDeadlineAt ||
    canonical(journalStage.expectation) !== canonical(stage)
  ) {
    throw new Error(`Collector API stage expectation mismatch: ${expected.id}`);
  }
  const verification: ApiCollectorStageVerificationExpectation = {
    actor: API_COLLECTOR_STAGE_ACTOR,
    instrumentHash: stage.instrumentHash as string,
    orderedAttachments: stage.orderedAttachments,
    originalDeadlineAt,
    outputSha256: stage.outputSha256,
    requestId: stage.requestId,
    role: stage.role as "panel" | "prediction",
    routeHash: API_COLLECTOR_ROUTE_HASH,
    stageDeadlineAt: expected.stageDeadlineAt,
  };
  return withVerifiedApiCollectorStage(
    capability,
    verification,
    (verified: VerifiedApiCollectorStageEvidence) => {
      const retainedEvidence = Object.fromEntries(
        Object.entries(journalStage.evidence).map(([name, binding]) => [
          name,
          {
            file: realpathSync(path.resolve(journalRoot, binding.file)),
            sha256: binding.sha256,
          },
        ])
      );
      if (
        verified.transportAuthority !== "installed-production-transport" ||
        canonical(verified.evidence) !== canonical(retainedEvidence) ||
        !HASH.test(verified.promptSha256) ||
        !HASH.test(verified.answersHash) ||
        verified.answersHash !== sha(canonical(verified.answers)) ||
        !Number.isSafeInteger(verified.startedAt) ||
        !Number.isSafeInteger(verified.settledAt) ||
        verified.startedAt > verified.settledAt ||
        verified.settledAt >= expected.stageDeadlineAt ||
        Object.values(verified.answers).some(
          ({ choice, evidence, treatment }) =>
            !validIdentity(choice) ||
            !validIdentity(evidence) ||
            typeof treatment !== "string"
        )
      ) {
        throw new Error(
          `Collector API transport evidence mismatch: ${expected.id}`
        );
      }
      return Object.freeze({
        actor: Object.freeze({ ...stage.actor }),
        answers: Object.freeze(
          Object.fromEntries(
            Object.entries(verified.answers).map(([id, answer]) => [
              id,
              Object.freeze({ ...answer }),
            ])
          )
        ),
        answersHash: verified.answersHash,
        evidenceMode: stage.evidenceMode,
        id: stage.id,
        instrumentHash: stage.instrumentHash,
        nativeStage: stage.nativeStage,
        orderedAttachments: Object.freeze(
          stage.orderedAttachments.map((attachment) =>
            Object.freeze({ ...attachment })
          )
        ),
        outputSha256: stage.outputSha256,
        promptSha256: verified.promptSha256,
        requestId: stage.requestId,
        role: stage.role,
        routeHash: stage.routeHash,
        settledAt: verified.settledAt,
        startedAt: verified.startedAt,
      } satisfies VerifiedCollectorStageSummary);
    }
  );
};

export const validateCollectorApiTransportStageEvidence = (options: {
  capability: ApiCollectorStageCapability;
  evidence: CollectorApiTransportExpectation;
  expectedJournalSha256: string;
  journalFile: string;
}) => {
  if (
    !HASH.test(options.expectedJournalSha256) ||
    !validIdentity(options.evidence.qualificationId) ||
    !isUuid(options.evidence.sessionId) ||
    !Number.isSafeInteger(options.evidence.originalDeadlineAt) ||
    options.evidence.stages.length !== 1 ||
    new Set(options.evidence.stages.map(({ id }) => id)).size !==
      options.evidence.stages.length
  ) {
    throw new Error("Collector API transport expectation is invalid");
  }
  const journalPath = realpathSync(options.journalFile);
  const journalBytes = readFileSync(journalPath);
  if (sha(journalBytes) !== options.expectedJournalSha256) {
    throw new Error("Collector API transport journal hash mismatch");
  }
  const base = path.dirname(journalPath);
  const journal = JSON.parse(
    journalBytes.toString("utf-8")
  ) as CollectorApiTransportJournal;
  if (
    journal.kind !== "collector-bound-api-stage-journal-v1" ||
    journal.qualificationId !== options.evidence.qualificationId ||
    journal.originalDeadlineAt !== options.evidence.originalDeadlineAt ||
    journal.sessionId !== options.evidence.sessionId ||
    !Array.isArray(journal.stages) ||
    journal.stages.length !== options.evidence.stages.length ||
    new Set(journal.stages.map(({ id }) => id)).size !== journal.stages.length
  ) {
    throw new Error("Collector API transport journal identity mismatch");
  }
  const stages = options.evidence.stages.map((expected) => {
    const journalStage = journal.stages.find(({ id }) => id === expected.id);
    if (!journalStage) {
      throw new Error(`Collector API stage is missing: ${expected.id}`);
    }
    for (const file of Object.values(journalStage.evidence)) {
      readBound(base, file);
    }
    return verifyApiCollectorStage(
      options.capability,
      expected,
      journalStage,
      options.evidence.originalDeadlineAt,
      base
    );
  });
  return {
    accessTraceVerified: false as const,
    apiTransportVerified: true as const,
    mountReachabilityVerified: false as const,
    productionEligible: false as const,
    sameContainerAccessVerified: false as const,
    stageCount: stages.length,
    stages: Object.freeze(stages),
  };
};

export const createCollectorApiQualificationAssembly = (
  expectation: CollectorApiQualificationAssemblyExpectation
) => {
  if (
    !validIdentity(expectation.qualificationId) ||
    !HASH.test(expectation.populationSha256) ||
    !HASH.test(expectation.requestedSlotsSha256) ||
    !HASH.test(expectation.exposureSidecarSha256)
  ) {
    throw new Error("Collector API qualification assembly is invalid");
  }
  const capability = Object.freeze(
    {}
  ) as CollectorApiQualificationAssemblyCapability;
  collectorApiQualificationAssemblies.set(capability, {
    entries: new Map(),
    expectation: Object.freeze({ ...expectation }),
  });
  return capability;
};

export const appendCollectorApiQualificationStage = (
  assembly: CollectorApiQualificationAssemblyCapability,
  options: {
    capability: ApiCollectorStageCapability;
    evidence: CollectorApiTransportExpectation;
    expectedJournalSha256: string;
    journalFile: string;
    runId: string;
  }
) => {
  const state = collectorApiQualificationAssemblies.get(assembly);
  if (
    !state ||
    consumedCollectorApiQualificationAssemblies.has(assembly) ||
    !validIdentity(options.runId) ||
    state.entries.has(options.runId) ||
    options.evidence.qualificationId !== state.expectation.qualificationId ||
    options.evidence.stages.length !== 1
  ) {
    throw new Error("Collector API qualification assembly is unavailable");
  }
  const [stage] = options.evidence.stages;
  if (!stage) {
    throw new Error("Collector API qualification stage is missing");
  }
  const journalFile = realpathSync(options.journalFile);
  const validated = validateCollectorApiTransportStageEvidence({
    capability: options.capability,
    evidence: options.evidence,
    expectedJournalSha256: options.expectedJournalSha256,
    journalFile,
  });
  state.entries.set(options.runId, {
    evidence: structuredClone(options.evidence),
    expectedJournalSha256: options.expectedJournalSha256,
    journalFile,
    runId: options.runId,
    stages: validated.stages,
  });
  return Object.freeze({
    runId: options.runId,
    stageCount: validated.stageCount,
  });
};

// Every retained byte is part of the expired-capability replacement boundary.
// eslint-disable-next-line complexity
const revalidateAssembledApiRun = (
  entry: CollectorApiQualificationAssemblyEntry,
  evidence: CollectorApiTransportExpectation,
  expectedJournalSha256: string,
  journalFile: string
) => {
  const journalPath = realpathSync(journalFile);
  const journalBytes = readFileSync(journalPath);
  const journal = JSON.parse(
    journalBytes.toString("utf-8")
  ) as CollectorApiTransportJournal;
  if (
    journalPath !== entry.journalFile ||
    expectedJournalSha256 !== entry.expectedJournalSha256 ||
    sha(journalBytes) !== expectedJournalSha256 ||
    canonical(evidence) !== canonical(entry.evidence) ||
    journal.kind !== "collector-bound-api-stage-journal-v1" ||
    journal.qualificationId !== evidence.qualificationId ||
    journal.originalDeadlineAt !== evidence.originalDeadlineAt ||
    journal.sessionId !== evidence.sessionId ||
    !Array.isArray(journal.stages) ||
    journal.stages.length !== evidence.stages.length ||
    entry.stages.length !== evidence.stages.length
  ) {
    throw new Error(
      `Collector API assembly changed after verification: ${entry.runId}`
    );
  }
  for (const expected of evidence.stages) {
    const journalStage = journal.stages.find(({ id }) => id === expected.id);
    const summary = entry.stages.find(({ id }) => id === expected.id);
    if (
      !journalStage ||
      !summary ||
      canonical(journalStage.expectation) !== canonical(expected.expectation) ||
      journalStage.stageDeadlineAt !== expected.stageDeadlineAt
    ) {
      throw new Error(
        `Collector API assembly stage changed: ${entry.runId}/${expected.id}`
      );
    }
    for (const binding of Object.values(journalStage.evidence)) {
      readBound(path.dirname(journalPath), binding);
    }
    const descriptor = readBoundJson(
      path.dirname(journalPath),
      journalStage.evidence.descriptor
    ) as {
      orderedAttachments?: { file: string; name: string; sha256: string }[];
    };
    if (
      !Array.isArray(descriptor.orderedAttachments) ||
      canonical(
        descriptor.orderedAttachments.map(({ name, sha256 }) => ({
          name,
          sha256,
        }))
      ) !== canonical(expected.expectation.orderedAttachments)
    ) {
      throw new Error(
        `Collector API assembly attachments changed: ${entry.runId}/${expected.id}`
      );
    }
    for (const attachment of descriptor.orderedAttachments) {
      readAbsoluteBound(attachment);
    }
  }
  return Object.freeze(entry.stages);
};

const parseMount = (value: string) => {
  const fields = Object.fromEntries(
    value.split(",").map((field) => {
      const [name, ...rest] = field.split("=");
      return [name, rest.length ? rest.join("=") : true];
    })
  );
  if (
    fields.type !== "bind" ||
    typeof fields.src !== "string" ||
    typeof fields.dst !== "string"
  ) {
    throw new Error("Collector create request contains an unsupported mount");
  }
  return {
    containerPath: fields.dst,
    hostPath: fields.src,
    readOnly: fields.readonly === true,
  };
};

const createMounts = (args: readonly unknown[]) => {
  const mounts: ReturnType<typeof parseMount>[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      (typeof argument === "string" && argument.startsWith("--volume")) ||
      (typeof argument === "string" && argument.startsWith("-v"))
    ) {
      throw new Error(
        "Collector create request contains an unsupported mount syntax"
      );
    }
    if (argument === "--mount") {
      const mount = args[index + 1];
      if (typeof mount !== "string") {
        throw new TypeError("Collector create request has a malformed mount");
      }
      mounts.push(parseMount(mount));
      index += 1;
    } else if (
      typeof argument === "string" &&
      argument.startsWith("--mount=")
    ) {
      throw new Error(
        "Collector create request contains an unsupported mount syntax"
      );
    }
  }
  return mounts;
};

interface MountIdentity {
  containerPath: string;
  hostPath: string;
  readOnly: boolean;
}

interface DeclaredMount extends MountIdentity {
  sha256?: string;
}

const mountIdentity = ({
  containerPath,
  hostPath,
  readOnly,
}: MountIdentity): MountIdentity => ({ containerPath, hostPath, readOnly });

const orderedMounts = (mounts: readonly MountIdentity[]) =>
  mounts
    .map(mountIdentity)
    .toSorted((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    );

const validDeclaredMount = (value: unknown): value is DeclaredMount => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const mount = value as Record<string, unknown>;
  const expectedKeys = ["containerPath", "hostPath", "readOnly"];
  if (Object.hasOwn(mount, "sha256")) {
    expectedKeys.push("sha256");
  }
  return (
    canonical(Object.keys(mount).toSorted()) ===
      canonical(expectedKeys.toSorted()) &&
    typeof mount.containerPath === "string" &&
    typeof mount.hostPath === "string" &&
    typeof mount.readOnly === "boolean" &&
    (!Object.hasOwn(mount, "sha256") ||
      (typeof mount.sha256 === "string" && HASH.test(mount.sha256)))
  );
};

const orderedDeclaredMounts = (mounts: readonly DeclaredMount[]) =>
  mounts.toSorted((left, right) =>
    canonical(left).localeCompare(canonical(right))
  );

const validateCodexTrace = (
  trace: string,
  evidenceMode: CollectorStageExpectation["evidenceMode"],
  attachments: CollectorStageExpectation["orderedAttachments"]
) => {
  const records = trace
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const model = records.find((record) => record.type === "turn_context")
    ?.payload?.model;
  const payloads = records
    .filter((record) => record.type === "response_item")
    .map((record) => record.payload);
  if (
    payloads.some(
      (payload) =>
        typeof payload?.type === "string" &&
        (payload.type.endsWith("_call") ||
          payload.type.endsWith("_call_output"))
    )
  ) {
    throw new Error("Collector trace contains tool access");
  }
  const supplied = payloads
    .filter((payload) => payload?.type === "message" && payload.role === "user")
    .flatMap((payload) => payload.content ?? [])
    .filter((block) => block?.type === "input_image")
    .map((block) => {
      if (
        typeof block.image_url !== "string" ||
        !block.image_url.startsWith("data:image/png;base64,") ||
        !["high", "original"].includes(String(block.detail))
      ) {
        throw new Error("Collector trace has an invalid image attachment");
      }
      return sha(Buffer.from(block.image_url.split(",")[1], "base64"));
    });
  if (
    evidenceMode === "sealed-text"
      ? supplied.length !== 0 || attachments.length !== 0
      : JSON.stringify(supplied) !==
        JSON.stringify(attachments.map(({ sha256 }) => sha256))
  ) {
    throw new Error("Collector trace attachment evidence mismatch");
  }
  return { model, traceSha256: sha(trace) };
};

/**
 * Prototype for the collector evidence which a future production wrapper must
 * consume. Mount reachability is recomputed from the captured Docker create
 * request and inspect response. Observed access is independently recomputed
 * from the raw adapter trace. Neither fact is accepted from caller booleans.
 *
 * Only the current Codex JSONL adapter is supported here. Existing Claude and
 * development receipts deliberately fail until their raw validated trace and
 * complete Docker control-plane evidence are collected.
 */
// Every file participates in one control-plane chain, hence the deliberate complexity.
// eslint-disable-next-line complexity
export const validateCollectorBoundStageAccessEvidence = (options: {
  evidence: CollectorAccessExpectation;
  expectedJournalSha256: string;
  journalFile: string;
}) => {
  if (
    !HASH.test(options.expectedJournalSha256) ||
    !HASH.test(options.evidence.accessPolicySha256) ||
    !HASH.test(options.evidence.reservationHash) ||
    !Number.isSafeInteger(options.evidence.originalDeadlineAt) ||
    !options.evidence.qualificationId.trim() ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
      options.evidence.sessionId
    ) ||
    !options.evidence.stages.length ||
    !options.evidence.forbiddenHostRoots.length ||
    new Set(options.evidence.stages.map(({ id }) => id)).size !==
      options.evidence.stages.length ||
    options.evidence.stages.some(
      ({ actor, id, nativeStage, orderedAttachments, requestId, routeHash }) =>
        !id.trim() ||
        !nativeStage.trim() ||
        !requestId.trim() ||
        !actor.baseModelLineage.trim() ||
        !actor.model.trim() ||
        !actor.provider.trim() ||
        !HASH.test(routeHash) ||
        new Set(orderedAttachments.map(({ name }) => name)).size !==
          orderedAttachments.length ||
        orderedAttachments.some(
          ({ name, sha256 }) => !name.trim() || !HASH.test(sha256)
        )
    ) ||
    options.evidence.forbiddenHostRoots.some((root) => !path.isAbsolute(root))
  ) {
    throw new Error("Collector access expectation is invalid");
  }
  const journalPath = realpathSync(options.journalFile);
  const journalBytes = readFileSync(journalPath);
  if (sha(journalBytes) !== options.expectedJournalSha256) {
    throw new Error("Collector access journal hash mismatch");
  }
  const base = path.dirname(journalPath);
  const journal = JSON.parse(
    journalBytes.toString("utf-8")
  ) as CollectorAccessJournal;
  if (
    journal.kind !== "collector-bound-stage-access-journal-v4" ||
    journal.qualificationId !== options.evidence.qualificationId ||
    journal.originalDeadlineAt !== options.evidence.originalDeadlineAt ||
    journal.reservationHash !== options.evidence.reservationHash ||
    journal.sessionId !== options.evidence.sessionId ||
    !Array.isArray(journal.stages) ||
    journal.stages.length !== options.evidence.stages.length ||
    new Set(journal.stages.map(({ id }) => id)).size !== journal.stages.length
  ) {
    throw new Error("Collector access journal identity mismatch");
  }
  if (journal.accessPolicy.sha256 !== options.evidence.accessPolicySha256) {
    throw new Error("Collector access policy binding mismatch");
  }
  const accessPolicy = readBoundJson(
    base,
    journal.accessPolicy
  ) as CollectorPreDispatchAccessPolicy;
  const expectedForbiddenRoots = options.evidence.forbiddenHostRoots.map(
    (root) => {
      const metadata = lstatSync(root);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error(
          "Collector forbidden evidence path is not a regular file"
        );
      }
      return realpathSync(root);
    }
  );
  if (
    accessPolicy.kind !== "collector-pre-dispatch-access-policy-v1" ||
    accessPolicy.qualificationId !== options.evidence.qualificationId ||
    accessPolicy.reservationHash !== options.evidence.reservationHash ||
    accessPolicy.originalDeadlineAt !== options.evidence.originalDeadlineAt ||
    accessPolicy.sessionId !== options.evidence.sessionId ||
    accessPolicy.routeHash !== options.evidence.stages[0]?.routeHash ||
    options.evidence.stages.some(
      ({ routeHash }) => routeHash !== accessPolicy.routeHash
    ) ||
    canonical(accessPolicy.forbiddenHostRoots) !==
      canonical(expectedForbiddenRoots) ||
    !Array.isArray(accessPolicy.stages) ||
    accessPolicy.stages.length !== options.evidence.stages.length ||
    new Set(accessPolicy.stages.map(({ id }) => id)).size !==
      accessPolicy.stages.length
  ) {
    throw new Error("Collector pre-dispatch access policy mismatch");
  }
  const verifiedStages: VerifiedCollectorStageSummary[] = [];
  for (const expected of options.evidence.stages) {
    const stage = journal.stages.find(({ id }) => id === expected.id);
    if (
      !stage ||
      !HASH.test(expected.outputSha256) ||
      canonical(stage.expectation) !== canonical(expected)
    ) {
      throw new Error(`Collector stage is missing: ${expected.id}`);
    }
    const stagePolicy = accessPolicy.stages.find(
      ({ id }) => id === expected.nativeStage
    );
    if (
      !stagePolicy ||
      canonical(stagePolicy.actor) !== canonical(expected.actor) ||
      !["bridge", "none"].includes(stagePolicy.network) ||
      !path.isAbsolute(stagePolicy.writableDirectory.path) ||
      !HASH.test(stagePolicy.writableDirectory.initialInventorySha256) ||
      stagePolicy.writableDirectory.initialInventorySha256 !== sha("[]")
    ) {
      throw new Error(`Collector stage access policy mismatch: ${expected.id}`);
    }
    const probe = stagePolicy.sameContainerAccessProbe;
    const expectedForbidden = expectedProbePaths(expectedForbiddenRoots);
    if (
      !probe ||
      probe.kind !== "same-container-access-probe-plan-v1" ||
      probe.stageId !== expected.nativeStage ||
      !HASH.test(probe.planSha256) ||
      probe.planSha256 !== sameContainerPlanHash(probe) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
        probe.nonce
      ) ||
      probe.nonceSha256 !== sha(probe.nonce) ||
      !HASH.test(probe.ackSha256) ||
      !HASH.test(probe.allowed?.sha256 ?? "") ||
      probe.allowed?.containerPath !== "/runtime/codex" ||
      !path.isAbsolute(probe.ackHostPath) ||
      probe.ackHostPath !==
        path.join(stagePolicy.writableDirectory.path, ".access-probe-ack") ||
      probe.ackContainerPath !== probe.ackHostPath ||
      canonical(probe.forbidden) !== canonical(expectedForbidden) ||
      new Set(
        probe.forbidden.map(({ pathClass }: { pathClass: string }) => pathClass)
      ).size !== probe.forbidden.length ||
      new Set(
        probe.forbidden.map(
          ({ containerPath }: { containerPath: string }) => containerPath
        )
      ).size !== probe.forbidden.length
    ) {
      throw new Error(
        `Collector same-container probe plan mismatch: ${expected.id}`
      );
    }
    const descriptor = readBoundJson(base, stage.containerDescriptor) as {
      adapter?: string;
      evidenceRoot?: string;
      image?: string;
      mounts?: DeclaredMount[];
      network?: string;
      originalDeadlineAt?: number;
      runtimeRoot?: string;
    };
    const intent = readBoundJson(base, stage.nativeIntent) as {
      callId?: string;
      deadlineAt?: number;
      dispatchedAt?: number;
      requestId?: string;
      reservationHash?: string;
      routeHash?: string;
      stage?: string;
    };
    const intentHash = sha(JSON.stringify(intent));
    const started = readBoundJson(base, stage.nativeStarted) as {
      intentHash?: string;
      startedAt?: number;
    };
    const terminal = readBoundJson(base, stage.nativeTerminal) as {
      accounting?: string;
      containment?: string;
      deadlineExceeded?: boolean;
      evidenceFile?: string;
      evidenceHash?: string;
      intentHash?: string;
      outcome?: string;
      settledAt?: number;
    };
    const settlement = readBoundJson(base, stage.containerSettlement) as {
      container?: {
        artifactEligible?: boolean;
        containerAbsent?: boolean;
        containerId?: string;
        process?: { code?: number; killed?: boolean };
        status?: string;
      };
      deadlineAt?: number;
      intentHash?: string;
    };
    const identity = readBoundJson(base, stage.containerIdentity) as {
      containerId?: string;
      image?: string;
    };
    const create = readBoundJson(base, stage.containerCreateRequest) as {
      args?: unknown[];
      phase?: string;
    };
    const inspect = readBoundJson(base, stage.containerInspectResult) as {
      code?: number;
      inspected?: {
        Config?: { Image?: string };
        HostConfig?: { PidMode?: string };
        Id?: string;
        Mounts?: { Destination?: string; RW?: boolean; Source?: string }[];
      };
      phase?: string;
    };
    const { inspected } = inspect;
    const { evidenceRoot, runtimeRoot } = descriptor;
    if (
      descriptor.adapter !== "codex-jsonl-v1" ||
      descriptor.originalDeadlineAt !== options.evidence.originalDeadlineAt ||
      !runtimeRoot ||
      !evidenceRoot ||
      !inspected ||
      !path.isAbsolute(runtimeRoot) ||
      !path.isAbsolute(evidenceRoot) ||
      overlaps(runtimeRoot, evidenceRoot) ||
      !Array.isArray(descriptor.mounts) ||
      !descriptor.image?.includes("@sha256:") ||
      !["bridge", "none"].includes(descriptor.network ?? "") ||
      descriptor.network !== stagePolicy.network ||
      typeof intent.callId !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
        intent.callId
      ) ||
      intent.deadlineAt !== options.evidence.originalDeadlineAt ||
      intent.requestId !== expected.requestId ||
      intent.reservationHash !== options.evidence.reservationHash ||
      intent.stage !== expected.nativeStage ||
      intent.routeHash !== expected.routeHash ||
      typeof intent.dispatchedAt !== "number" ||
      !Number.isSafeInteger(intent.dispatchedAt) ||
      typeof started.startedAt !== "number" ||
      !Number.isSafeInteger(started.startedAt) ||
      typeof terminal.settledAt !== "number" ||
      !Number.isSafeInteger(terminal.settledAt) ||
      intent.dispatchedAt > started.startedAt ||
      started.startedAt > terminal.settledAt ||
      terminal.settledAt >= options.evidence.originalDeadlineAt ||
      started.intentHash !== intentHash ||
      terminal.intentHash !== intentHash ||
      terminal.accounting !== "settled" ||
      terminal.containment !== "container-absent" ||
      terminal.outcome !== "complete" ||
      terminal.deadlineExceeded !== false ||
      terminal.evidenceFile !==
        path.resolve(base, stage.containerSettlement.file) ||
      terminal.evidenceHash !== stage.containerSettlement.sha256 ||
      settlement.intentHash !== intentHash ||
      settlement.deadlineAt !== options.evidence.originalDeadlineAt ||
      settlement.container?.containerId !== identity.containerId ||
      settlement.container?.artifactEligible !== true ||
      settlement.container?.containerAbsent !== true ||
      settlement.container?.status !== "complete" ||
      settlement.container?.process?.code !== 0 ||
      settlement.container?.process?.killed !== false ||
      identity.image !== descriptor.image ||
      create.phase !== "create" ||
      !Array.isArray(create.args) ||
      inspect.phase !== "resolve-identity" ||
      inspect.code !== 0 ||
      inspected.Id !== identity.containerId ||
      inspected.Config?.Image !== descriptor.image
    ) {
      throw new Error(`Collector native evidence mismatch: ${expected.id}`);
    }
    const actualCreateMounts = createMounts(create.args).map((mount) => ({
      ...mount,
      hostPath: realpathSync(mount.hostPath),
    }));
    if (
      (inspected.Mounts ?? []).some(
        (mount: { Destination?: unknown; RW?: unknown; Source?: unknown }) =>
          typeof mount.Destination !== "string" ||
          typeof mount.Source !== "string" ||
          typeof mount.RW !== "boolean"
      )
    ) {
      throw new Error(`Collector mount reachability mismatch: ${expected.id}`);
    }
    const actualInspectMounts = (inspected.Mounts ?? []).map(
      (mount: { Destination?: unknown; RW?: unknown; Source?: unknown }) => ({
        containerPath: mount.Destination as string,
        hostPath: realpathSync(mount.Source as string),
        readOnly: mount.RW === false,
      })
    );
    const descriptorMounts = descriptor.mounts.map((mount) => ({
      ...mount,
      hostPath: realpathSync(mount.hostPath),
    }));
    const resolvedRuntimeRoot = realpathSync(runtimeRoot);
    const resolvedEvidenceRoot = realpathSync(evidenceRoot);
    const writableMetadata = lstatSync(stagePolicy.writableDirectory.path);
    const policyMounts = stagePolicy.allowedMounts.map(
      (mount: DeclaredMount) => ({
        ...mount,
        hostPath: realpathSync(mount.hostPath),
      })
    );
    if (
      !HASH.test(identity.containerId ?? "") ||
      inspected.HostConfig?.PidMode !== "" ||
      !descriptor.mounts?.every(validDeclaredMount) ||
      !stagePolicy.allowedMounts.every(validDeclaredMount) ||
      JSON.stringify(orderedMounts(actualCreateMounts)) !==
        JSON.stringify(orderedMounts(descriptorMounts)) ||
      JSON.stringify(orderedMounts(actualInspectMounts)) !==
        JSON.stringify(orderedMounts(descriptorMounts)) ||
      JSON.stringify(orderedMounts(policyMounts)) !==
        JSON.stringify(orderedMounts(descriptorMounts)) ||
      canonical(orderedDeclaredMounts(policyMounts)) !==
        canonical(orderedDeclaredMounts(descriptorMounts)) ||
      realpathSync(stagePolicy.writableDirectory.path) !==
        resolvedRuntimeRoot ||
      !writableMetadata.isDirectory() ||
      writableMetadata.isSymbolicLink() ||
      String(writableMetadata.dev) !== stagePolicy.writableDirectory.device ||
      String(writableMetadata.ino) !== stagePolicy.writableDirectory.inode ||
      !descriptorMounts.some(
        ({ containerPath, hostPath, readOnly }) =>
          containerPath === runtimeRoot &&
          hostPath === resolvedRuntimeRoot &&
          readOnly === false
      ) ||
      descriptorMounts.some(({ hostPath }) =>
        expectedForbiddenRoots.some((root) => overlaps(hostPath, root))
      ) ||
      descriptorMounts.some(({ hostPath }) =>
        overlaps(hostPath, resolvedEvidenceRoot)
      )
    ) {
      throw new Error(`Collector mount reachability mismatch: ${expected.id}`);
    }
    const allowedMount = descriptorMounts.find(
      ({ containerPath }) => containerPath === probe.allowed.containerPath
    );
    const access = stage.sameContainerAccess;
    const observation = readBoundJson(
      base,
      access?.receipt ?? { file: "", sha256: "" }
    ) as {
      containerId?: string;
      kind?: string;
      observation?: SameContainerAccessObservation;
      security?: {
        kind?: string;
        mountCensusSha256?: string;
        network?: string;
        sha256?: string;
      };
    };
    const securityInspectRaw = readBoundJson(
      base,
      access?.securityInspect ?? { file: "", sha256: "" }
    ) as unknown;
    const observed = observation.observation;
    const securityInspect = Array.isArray(securityInspectRaw)
      ? securityInspectRaw[0]
      : undefined;
    const securityHost = securityInspect?.HostConfig;
    const securityMounts = (securityInspect?.Mounts ?? [])
      .map(
        (mount: {
          Destination?: string;
          RW?: boolean;
          Source?: string;
          Type?: string;
        }) => ({
          Destination: mount.Destination,
          RW: mount.RW,
          Source: mount.Source,
          Type: mount.Type,
        })
      )
      .toSorted(
        (left: { Destination?: string }, right: { Destination?: string }) =>
          String(left.Destination).localeCompare(String(right.Destination))
      );
    const expectedSecurityMounts = descriptorMounts
      .map(({ containerPath, hostPath, readOnly }) => ({
        Destination: containerPath,
        RW: !readOnly,
        Source: hostPath,
        Type: "bind",
      }))
      .toSorted((left, right) =>
        left.Destination.localeCompare(right.Destination)
      );
    const [allowedObservation, ...forbiddenObservations] =
      observed?.observations ?? [];
    const observationsValid =
      allowedObservation?.pathClass === "allowed-native-executable" &&
      allowedObservation.status === "readable" &&
      allowedObservation.sha256 === probe.allowed.sha256 &&
      forbiddenObservations.length === probe.forbidden.length &&
      forbiddenObservations.every(
        (
          entry: { pathClass?: string; sha256?: string; status?: string },
          index
        ) =>
          entry.pathClass === probe.forbidden[index]?.pathClass &&
          entry.status === "missing" &&
          !("sha256" in entry)
      );
    if (
      !access ||
      access.kind !== "same-container-access-binding-v1" ||
      access.planSha256 !== probe.planSha256 ||
      access.nonceSha256 !== probe.nonceSha256 ||
      access.stageId !== expected.nativeStage ||
      access.containerId !== identity.containerId ||
      access.ackSha256 !== probe.ackSha256 ||
      !HASH.test(access.observationSha256) ||
      !allowedMount ||
      allowedMount.readOnly !== true ||
      sha(readFileSync(allowedMount.hostPath)) !== probe.allowed.sha256 ||
      existsSync(probe.ackHostPath) ||
      observation.kind !== "collector-same-container-access-receipt-v1" ||
      observation.containerId !== identity.containerId ||
      observation.security?.kind !== "same-container-security-evidence-v1" ||
      observation.security.sha256 !== access.securityInspect.sha256 ||
      observation.security.network !== stagePolicy.network ||
      observation.security.mountCensusSha256 !==
        sha(JSON.stringify(securityMounts)) ||
      !observed ||
      observed.kind !== "same-container-access-observation-v1" ||
      observed.planSha256 !== probe.planSha256 ||
      observed.nonceSha256 !== probe.nonceSha256 ||
      observed.stageId !== expected.nativeStage ||
      access.observationSha256 !== sha(JSON.stringify(observed)) ||
      !observationsValid ||
      !Array.isArray(securityInspectRaw) ||
      securityInspectRaw.length !== 1 ||
      securityInspect?.Id !== identity.containerId ||
      securityHost?.PidMode !== "" ||
      securityHost?.Privileged !== false ||
      securityHost?.ReadonlyRootfs !== true ||
      securityHost?.NetworkMode !== stagePolicy.network ||
      canonical(securityHost?.CapDrop) !== canonical(["ALL"]) ||
      !securityHost?.SecurityOpt?.includes("no-new-privileges") ||
      (securityHost?.Devices?.length ?? 0) !== 0 ||
      canonical(securityMounts) !== canonical(expectedSecurityMounts)
    ) {
      throw new Error(
        `Collector same-container access evidence mismatch: ${expected.id}`
      );
    }
    const request = readBoundJson(base, stage.adapterRequest) as {
      evidenceHashes?: Record<string, string>;
      evidenceMode?: string;
      promptSha256?: string;
      status?: string;
    };
    const result = readBoundJson(base, stage.adapterResult) as {
      answers?: Record<
        string,
        { choice?: unknown; evidence?: unknown; treatment?: unknown }
      > | null;
      baseModelLineage?: string;
      evidenceHashes?: Record<string, string>;
      evidenceMode?: string;
      imageInspection?: { traceSha256?: string } | null;
      model?: string;
      provider?: string;
      status?: string;
    };
    const trace = readBound(base, stage.adapterTrace).toString("utf-8");
    const traceEvidence = validateCodexTrace(
      trace,
      expected.evidenceMode,
      expected.orderedAttachments
    );
    const expectedHashes = Object.fromEntries(
      expected.orderedAttachments.map(({ name, sha256 }) => [name, sha256])
    );
    const answers = result.answers ?? {};
    const normalizedAnswers = Object.fromEntries(
      Object.entries(answers).map(([id, answer]) => [
        id,
        {
          choice: answer.choice,
          evidence: answer.evidence,
          treatment: answer.treatment,
        },
      ])
    );
    if (
      stage.adapterResult.sha256 !== expected.outputSha256 ||
      !HASH.test(request.promptSha256 ?? "") ||
      Object.values(normalizedAnswers).some(
        ({ choice, evidence, treatment }) =>
          typeof choice !== "string" ||
          typeof evidence !== "string" ||
          !evidence.trim() ||
          typeof treatment !== "string"
      ) ||
      request.status !== "running" ||
      request.evidenceMode !== expected.evidenceMode ||
      JSON.stringify(request.evidenceHashes) !==
        JSON.stringify(expectedHashes) ||
      result.status !== "complete" ||
      result.evidenceMode !== expected.evidenceMode ||
      JSON.stringify(result.evidenceHashes) !==
        JSON.stringify(expectedHashes) ||
      result.model !== expected.actor.model ||
      result.baseModelLineage !== expected.actor.baseModelLineage ||
      result.provider !== expected.actor.provider ||
      traceEvidence.model !== expected.actor.model ||
      result.imageInspection?.traceSha256 !== traceEvidence.traceSha256
    ) {
      throw new Error(`Collector adapter evidence mismatch: ${expected.id}`);
    }
    const { subject } = expected;
    const subjectIsValid =
      subject !== undefined &&
      HASH.test(subject.artifactHash) &&
      validIdentity(subject.conceptId) &&
      validIdentity(subject.familyId) &&
      validIdentity(subject.master) &&
      Array.isArray(subject.nativePresentationHashes) &&
      subject.nativePresentationHashes.length === 2 &&
      subject.nativePresentationHashes.every((value) => HASH.test(value)) &&
      [16, 24].includes(subject.nativeSize) &&
      ["filled", "outlined"].includes(subject.paint) &&
      HASH.test(subject.requestIntentHash) &&
      validIdentity(subject.slotId);
    if (
      (expected.role === "production-critic" && !subjectIsValid) ||
      (expected.role === "recognition" &&
        subject !== undefined &&
        !subjectIsValid) ||
      (!["production-critic", "recognition"].includes(expected.role) &&
        subject !== undefined)
    ) {
      throw new Error(
        `Collector production subject identity mismatch: ${expected.id}`
      );
    }
    const verifiedAnswers = normalizedAnswers as Record<
      string,
      { choice: string; evidence: string; treatment: string }
    >;
    verifiedStages.push(
      Object.freeze({
        actor: Object.freeze({ ...expected.actor }),
        answers: Object.freeze(verifiedAnswers),
        answersHash: sha(canonical(verifiedAnswers)),
        evidenceMode: expected.evidenceMode,
        id: expected.id,
        instrumentHash: expected.instrumentHash,
        nativeStage: expected.nativeStage,
        orderedAttachments: Object.freeze(
          expected.orderedAttachments.map((attachment) =>
            Object.freeze({ ...attachment })
          )
        ),
        outputSha256: expected.outputSha256,
        promptSha256: request.promptSha256 as string,
        requestId: expected.requestId,
        role: expected.role,
        routeHash: expected.routeHash,
        settledAt: terminal.settledAt,
        startedAt: started.startedAt,
        subject: subject ? Object.freeze({ ...subject }) : undefined,
      })
    );
  }
  return {
    accessTraceVerified: true as const,
    mountReachabilityVerified: true as const,
    productionEligible: false as const,
    sameContainerAccessVerified: true as const,
    stageCount: options.evidence.stages.length,
    stages: Object.freeze(verifiedStages),
  };
};

interface CanonicalProtocolReview {
  answers?: Record<
    string,
    { choice?: unknown; evidence?: unknown; treatment?: unknown }
  > | null;
  evidenceHashes?: Record<string, string>;
  model?: string | null;
  status?: string;
}

const validAnswer = (
  review: CanonicalProtocolReview,
  id: string,
  choices: readonly string[]
) => {
  const answer = review.answers?.[id];
  return Boolean(
    answer &&
    typeof answer.choice === "string" &&
    choices.includes(answer.choice) &&
    typeof answer.evidence === "string" &&
    answer.evidence.trim() &&
    typeof answer.treatment === "string"
  );
};

// The census binds generation identity, not visual acceptance. Failed
// candidates remain eligible when their generated bytes and producer receipt
// are complete.
// eslint-disable-next-line complexity
const validateNaturalPopulationIdentity = (
  base: string,
  qualificationId: string,
  slotBinding: FileBinding,
  exposureBinding: FileBinding,
  stimuli: readonly AiPanelQualificationStimulus[],
  evidenceById: ReadonlyMap<string, StimulusEvidenceBinding>
) => {
  const census = readBoundJson(base, slotBinding) as {
    frozen?: boolean;
    qualificationId?: string;
    slots?: RequestedNaturalSlot[];
  };
  const exposure = readBoundJson(base, exposureBinding) as {
    completeAccessibleCensus?: boolean;
    knownExposedArtifactHashes?: string[];
    knownExposedStimulusIds?: string[];
    qualificationId?: string;
    scope?: string;
  };
  if (
    census.frozen !== true ||
    census.qualificationId !== qualificationId ||
    !Array.isArray(census.slots) ||
    exposure.qualificationId !== qualificationId ||
    exposure.scope !== "artifact-and-stimulus-development-exposure" ||
    exposure.completeAccessibleCensus !== false ||
    !Array.isArray(exposure.knownExposedArtifactHashes) ||
    !Array.isArray(exposure.knownExposedStimulusIds) ||
    exposure.knownExposedArtifactHashes.some((value) => !HASH.test(value)) ||
    exposure.knownExposedStimulusIds.some((value) => !validIdentity(value))
  ) {
    throw new Error(
      "Frozen requested-slot census or exposure sidecar is invalid"
    );
  }
  const { slots } = census;
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const natural = stimuli.filter(
    (stimulus) =>
      stimulus.canonical && stimulus.generationKind === "natural-generated"
  );
  if (
    slotById.size !== slots.length ||
    natural.length !== slots.length ||
    natural.length < 80 ||
    new Set(natural.map(({ familyId }) => familyId)).size < 80 ||
    new Set(natural.map(({ requestedSlotId }) => requestedSlotId)).size !==
      natural.length ||
    [16, 24].some((nativeSize) =>
      (["filled", "outlined"] as const).some(
        (paint) =>
          natural.filter(
            (row) => row.nativeSize === nativeSize && row.paint === paint
          ).length < 20
      )
    ) ||
    slots.some(
      (slot) =>
        !validIdentity(slot.id) ||
        !validIdentity(slot.familyId) ||
        !validIdentity(slot.conceptId) ||
        ![16, 24].includes(slot.nativeSize) ||
        !["filled", "outlined"].includes(slot.paint) ||
        !HASH.test(slot.sourceLineageHash) ||
        !Array.isArray(slot.sourceArtifactHashes) ||
        slot.sourceArtifactHashes.length === 0 ||
        slot.sourceArtifactHashes.some((value) => !HASH.test(value)) ||
        slot.sourceLineageHash !== sha(canonical(slot.sourceArtifactHashes))
    )
  ) {
    throw new Error(
      "Natural qualification population does not match its frozen slots"
    );
  }
  const exposedArtifacts = new Set(exposure.knownExposedArtifactHashes);
  const exposedStimuli = new Set(exposure.knownExposedStimulusIds);
  for (const stimulus of natural) {
    const slot = slotById.get(stimulus.requestedSlotId ?? "");
    const binding = evidenceById.get(stimulus.id);
    if (
      !slot ||
      !binding ||
      stimulus.familyId !== slot.familyId ||
      stimulus.conceptId !== slot.conceptId ||
      stimulus.nativeSize !== slot.nativeSize ||
      stimulus.paint !== slot.paint ||
      stimulus.sourceLineageHash !== slot.sourceLineageHash ||
      !HASH.test(stimulus.producerEvidenceHash ?? "") ||
      exposedArtifacts.has(stimulus.artifactHash) ||
      exposedStimuli.has(stimulus.id) ||
      !Array.isArray(binding.sources) ||
      binding.sources.length !== slot.sourceArtifactHashes.length ||
      JSON.stringify(binding.sources.map(({ sha256 }) => sha256)) !==
        JSON.stringify(slot.sourceArtifactHashes) ||
      !binding.producerReceipt
    ) {
      throw new Error(`Natural stimulus identity mismatch: ${stimulus.id}`);
    }
    for (const source of binding.sources) {
      readBound(base, source);
    }
    const producer = readBoundJson(base, binding.producerReceipt) as {
      artifactHash?: string;
      authorId?: string;
      authorLineage?: string;
      conceptId?: string;
      familyId?: string;
      kind?: string;
      nativeSize?: number;
      outcome?: string;
      paint?: string;
      producerLineages?: string[];
      requestedSlotId?: string;
      sourceLineageHash?: string;
    };
    if (
      binding.producerReceipt.sha256 !== stimulus.producerEvidenceHash ||
      producer.kind !== "generated-candidate-evidence" ||
      !["delivered", "failed-with-artifact"].includes(producer.outcome ?? "") ||
      producer.artifactHash !== stimulus.artifactHash ||
      producer.requestedSlotId !== slot.id ||
      producer.familyId !== slot.familyId ||
      producer.conceptId !== slot.conceptId ||
      producer.nativeSize !== slot.nativeSize ||
      producer.paint !== slot.paint ||
      producer.sourceLineageHash !== slot.sourceLineageHash ||
      JSON.stringify(producer.producerLineages) !==
        JSON.stringify(stimulus.producerLineages) ||
      !stimulus.producerLineages.length ||
      stimulus.producerLineages.some((lineage) => !validIdentity(lineage))
    ) {
      throw new Error(`Producer evidence identity mismatch: ${stimulus.id}`);
    }
  }
};

const validCollectorAnswer = (
  value: unknown
): value is {
  choice: string;
  evidence: string;
  treatment: string;
} => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const answer = value as Record<string, unknown>;
  return (
    typeof answer.choice === "string" &&
    typeof answer.evidence === "string" &&
    answer.evidence.trim().length > 0 &&
    typeof answer.treatment === "string"
  );
};

interface CollectorQualificationStage {
  expectation: CollectorStageExpectation;
  request: { promptSha256?: string };
  result: {
    answers?: Record<
      string,
      { choice?: string; evidence?: string; treatment?: string }
    >;
  };
  sessionId: string;
  settledAt: number;
  startedAt: number;
}

interface QualifiedCriticExecutionIdentity {
  readonly actor: CollectorStageExpectation["actor"];
  readonly instrumentHash: string;
  readonly qualificationSessionIds: readonly string[];
  readonly routeHash: string;
  readonly sessionPolicy: "distinct-production-session-required";
}

// eslint-disable-next-line complexity -- all five answer dimensions fail closed together.
const stageDecision = (
  stage: CollectorQualificationStage,
  stimulusId: string
): {
  critical: boolean | null;
  decision: "approve" | "reject" | "uncertain";
} => {
  const { answers } = stage.result;
  const expectedIds = ["critical", "craft", "family", "native", "ship"].map(
    (suffix) => `${stimulusId}-${suffix}`
  );
  if (
    !answers ||
    expectedIds.some((id) => !validCollectorAnswer(answers[id])) ||
    !["yes", "no", "uncertain"].includes(
      answers[`${stimulusId}-critical`]?.choice ?? ""
    ) ||
    !["yes", "no", "uncertain"].includes(
      answers[`${stimulusId}-ship`]?.choice ?? ""
    ) ||
    !["yes", "no", "uncertain"].includes(
      answers[`${stimulusId}-family`]?.choice ?? ""
    ) ||
    !["yes", "no", "uncertain"].includes(
      answers[`${stimulusId}-native`]?.choice ?? ""
    ) ||
    !/^(?:10|[1-9])$/u.test(answers[`${stimulusId}-craft`]?.choice ?? "")
  ) {
    throw new Error(`Collector craft answers are incomplete: ${stimulusId}`);
  }
  const criticalChoice = answers[`${stimulusId}-critical`]?.choice;
  const shipChoice = answers[`${stimulusId}-ship`]?.choice;
  const familyChoice = answers[`${stimulusId}-family`]?.choice;
  const nativeChoice = answers[`${stimulusId}-native`]?.choice;
  if (criticalChoice === "yes") {
    if (shipChoice !== "no") {
      throw new Error(`Collector craft answers conflict: ${stimulusId}`);
    }
    return { critical: true, decision: "reject" };
  }
  if (
    shipChoice === "yes" &&
    (familyChoice === "no" || nativeChoice === "no")
  ) {
    throw new Error(`Collector craft answers conflict: ${stimulusId}`);
  }
  if (criticalChoice === "uncertain") {
    return { critical: null, decision: "uncertain" };
  }
  if (shipChoice === "no" || familyChoice === "no" || nativeChoice === "no") {
    return { critical: false, decision: "reject" };
  }
  if (
    shipChoice === "uncertain" ||
    familyChoice === "uncertain" ||
    nativeChoice === "uncertain"
  ) {
    return { critical: null, decision: "uncertain" };
  }
  return { critical: false, decision: "approve" };
};

const sameHashes = (
  actual: readonly { sha256: string }[],
  expected: readonly string[]
) => canonical(actual.map(({ sha256 }) => sha256)) === canonical(expected);

// This is the production-shaped join between collector evidence and the pure
// agreement metric. Unlike the legacy byte envelope, every decision and time is
// derived from a validated native stage result rather than caller booleans.
// eslint-disable-next-line complexity -- one provenance boundary intentionally validates every link.
export const qualifyCriticFromCollectorEvidence = (options: {
  apiQualificationAssembly?: CollectorApiQualificationAssemblyCapability;
  expectedManifestSha256: string;
  manifestFile: string;
}) => {
  if (!HASH.test(options.expectedManifestSha256)) {
    throw new Error(
      "Expected collector qualification manifest hash is required"
    );
  }
  const manifestPath = realpathSync(options.manifestFile);
  const manifestBytes = readFileSync(manifestPath);
  if (sha(manifestBytes) !== options.expectedManifestSha256) {
    throw new Error("Collector qualification manifest hash mismatch");
  }
  const manifest = JSON.parse(
    manifestBytes.toString("utf-8")
  ) as CollectorCriticQualificationManifest;
  if (
    manifest.kind !== "collector-critic-qualification-manifest-v1" ||
    manifest.contractVersion !== ACCEPTANCE_CONTRACT_VERSION ||
    !manifest.qualificationId?.trim() ||
    !Array.isArray(manifest.runs) ||
    !manifest.runs.length ||
    new Set(manifest.runs.map(({ id }) => id)).size !== manifest.runs.length ||
    !Array.isArray(manifest.rows)
  ) {
    throw new Error("Collector qualification manifest is invalid");
  }
  const assembly = options.apiQualificationAssembly;
  const assemblyState = assembly
    ? collectorApiQualificationAssemblies.get(assembly)
    : undefined;
  if (
    assembly &&
    (!assemblyState ||
      consumedCollectorApiQualificationAssemblies.has(assembly))
  ) {
    throw new Error("Collector API qualification assembly is unavailable");
  }
  if (assembly && assemblyState) {
    consumedCollectorApiQualificationAssemblies.add(assembly);
    collectorApiQualificationAssemblies.delete(assembly);
  }
  const base = path.dirname(manifestPath);
  if (
    assemblyState &&
    (assemblyState.expectation.qualificationId !== manifest.qualificationId ||
      assemblyState.expectation.populationSha256 !==
        manifest.population.sha256 ||
      assemblyState.expectation.requestedSlotsSha256 !==
        manifest.requestedSlots.sha256 ||
      assemblyState.expectation.exposureSidecarSha256 !==
        manifest.exposureSidecar.sha256)
  ) {
    throw new Error("Collector API qualification assembly identity mismatch");
  }
  const lineageRegistry = readBoundJson(base, manifest.lineageRegistry) as {
    entries?: {
      baseModelLineage?: string;
      model?: string;
      provider?: string;
      source?: FileBinding;
    }[];
    frozen?: boolean;
    qualificationId?: string;
  };
  if (
    lineageRegistry.frozen !== true ||
    lineageRegistry.qualificationId !== manifest.qualificationId ||
    !Array.isArray(lineageRegistry.entries) ||
    new Set(
      lineageRegistry.entries.map(
        ({ model, provider }) => `${provider?.trim()}/${model?.trim()}`
      )
    ).size !== lineageRegistry.entries.length ||
    lineageRegistry.entries.some(
      ({ baseModelLineage, model, provider, source }) =>
        !validIdentity(baseModelLineage) ||
        !validIdentity(model) ||
        !validIdentity(provider) ||
        !source
    )
  ) {
    throw new Error("Frozen evaluator lineage registry is invalid");
  }
  for (const entry of lineageRegistry.entries) {
    if (!entry.source) {
      throw new Error("Frozen evaluator lineage source is missing");
    }
    readBound(base, entry.source);
  }
  const registered = new Set(
    lineageRegistry.entries.map(({ baseModelLineage, model, provider }) =>
      canonical({ baseModelLineage, model, provider })
    )
  );
  const usedApiRuns = new Set<string>();
  let sawApiRun = false;
  const stages = new Map<string, CollectorQualificationStage>();
  for (const run of manifest.runs) {
    if (
      !run.id.trim() ||
      run.evidence.qualificationId !== manifest.qualificationId
    ) {
      throw new Error("Collector run identity mismatch");
    }
    readBound(base, run.journal);
    const journalPath = realpathSync(path.resolve(base, run.journal.file));
    const apiRun = isApiCollectorExpectation(run.evidence);
    sawApiRun ||= apiRun;
    const assembledEntry = assemblyState?.entries.get(run.id);
    let validatedStages: readonly VerifiedCollectorStageSummary[];
    if (apiRun) {
      if (!assembledEntry) {
        throw new Error(`Collector API run lacks live assembly: ${run.id}`);
      }
      validatedStages = revalidateAssembledApiRun(
        assembledEntry,
        run.evidence,
        run.journal.sha256,
        journalPath
      );
    } else {
      validatedStages = validateCollectorBoundStageAccessEvidence({
        evidence: run.evidence,
        expectedJournalSha256: run.journal.sha256,
        journalFile: journalPath,
      }).stages;
    }
    const runExpectations: readonly CollectorStageExpectation[] =
      isApiCollectorExpectation(run.evidence)
        ? run.evidence.stages.map(
            (entry: CollectorApiTransportStageExpectation) => entry.expectation
          )
        : run.evidence.stages;
    for (const summary of validatedStages) {
      const key = `${run.id}/${summary.id}`;
      const expectation = runExpectations.find(({ id }) => id === summary.id);
      if (
        stages.has(key) ||
        !expectation ||
        !Number.isFinite(summary.startedAt) ||
        !Number.isFinite(summary.settledAt) ||
        summary.startedAt > summary.settledAt ||
        !registered.has(canonical(summary.actor))
      ) {
        throw new Error(
          `Collector qualification stage identity mismatch: ${key}`
        );
      }
      if (apiRun) {
        usedApiRuns.add(run.id);
      }
      stages.set(key, {
        expectation,
        request: { promptSha256: summary.promptSha256 },
        result: { answers: summary.answers },
        sessionId: run.evidence.sessionId,
        settledAt: summary.settledAt,
        startedAt: summary.startedAt,
      });
    }
  }
  if (
    usedApiRuns.size !== (assemblyState?.entries.size ?? 0) ||
    [...(assemblyState?.entries.keys() ?? [])].some(
      (runId) => !usedApiRuns.has(runId)
    )
  ) {
    throw new Error(
      "Collector API qualification assembly contains unlinked runs"
    );
  }
  const population = readBoundJson(base, manifest.population) as {
    qualificationId?: string;
    sealed?: boolean;
    stimuli?: AiPanelQualificationStimulus[];
  };
  if (
    population.qualificationId !== manifest.qualificationId ||
    population.sealed !== true ||
    !Array.isArray(population.stimuli) ||
    manifest.rows.length !== population.stimuli.length ||
    new Set(manifest.rows.map(({ stimulusId }) => stimulusId)).size !==
      population.stimuli.length ||
    canonical(manifest.rows.map(({ stimulusId }) => stimulusId)) !==
      canonical(population.stimuli.map(({ id }) => id))
  ) {
    throw new Error("Collector qualification population is invalid");
  }
  const evidenceById = new Map(
    manifest.artifacts.map((entry) => [entry.stimulusId, entry])
  );
  if (
    evidenceById.size !== manifest.artifacts.length ||
    evidenceById.size !== population.stimuli.length
  ) {
    throw new Error("Collector artifact bindings are incomplete or duplicate");
  }
  validateNaturalPopulationIdentity(
    base,
    manifest.qualificationId,
    manifest.requestedSlots,
    manifest.exposureSidecar,
    population.stimuli,
    evidenceById
  );
  const usedStages = new Set<string>();
  const stageFor = (
    link: CollectorQualificationStageLink,
    role: CollectorStageExpectation["role"]
  ) => {
    const stage = stages.get(`${link.runId}/${link.stageId}`);
    if (
      !stage ||
      stage.expectation.role !== role ||
      !HASH.test(link.promptSha256) ||
      stage.request.promptSha256 !== link.promptSha256
    ) {
      throw new Error(
        `Collector stage linkage mismatch: ${link.runId}/${link.stageId}`
      );
    }
    usedStages.add(`${link.runId}/${link.stageId}`);
    return stage;
  };
  const stimulusById = new Map(
    population.stimuli.map((stimulus) => [stimulus.id, stimulus])
  );
  const expectedStageAttachments = (
    link: CollectorQualificationStageLink,
    role: "recognition" | "prediction" | "panel"
  ) =>
    manifest.rows
      .filter((row) => {
        let links: readonly CollectorQualificationStageLink[] = row.panels;
        if (role === "recognition") {
          links = [row.recognition];
        } else if (role === "prediction") {
          links = [row.prediction];
        }
        return links.some(
          (candidate) =>
            candidate.runId === link.runId && candidate.stageId === link.stageId
        );
      })
      .flatMap((row) => {
        const hashes = stimulusById.get(
          row.stimulusId
        )?.orderedAttachmentHashes;
        return role === "recognition"
          ? [hashes?.[0] ?? ""]
          : [...(hashes ?? [])];
      });
  const predictions: AiCriticPrediction[] = [];
  const panelReviews: IndependentAiPanelReview[] = [];
  for (const stimulus of population.stimuli) {
    const row = manifest.rows.find(
      ({ stimulusId }) => stimulusId === stimulus.id
    );
    const binding = evidenceById.get(stimulus.id);
    if (
      !row ||
      !binding ||
      sha(readBound(base, binding.artifact)) !== stimulus.artifactHash
    ) {
      throw new Error(`Collector stimulus identity mismatch: ${stimulus.id}`);
    }
    if (
      !Array.isArray(binding.attachments) ||
      binding.attachments.length !== stimulus.orderedAttachmentHashes.length ||
      canonical(binding.attachments.map(({ sha256 }) => sha256)) !==
        canonical(stimulus.orderedAttachmentHashes)
    ) {
      throw new Error(`Collector attachment binding mismatch: ${stimulus.id}`);
    }
    for (const attachment of binding.attachments) {
      readBound(base, attachment);
    }
    const recognition = stageFor(row.recognition, "recognition");
    const adjudication = stageFor(row.adjudication, "adjudication");
    const prediction = stageFor(row.prediction, "prediction");
    const panels = row.panels.map((link: CollectorQualificationStageLink) =>
      stageFor(link, "panel")
    );
    const recognitionAnswer =
      recognition.result.answers?.[`${stimulus.id}-free-recognition`];
    const adjudicationAnswer =
      adjudication.result.answers?.[`${stimulus.id}-synonym-adjudication`];
    if (
      !validCollectorAnswer(recognitionAnswer) ||
      !["described", "unknown"].includes(recognitionAnswer.choice ?? "") ||
      !validCollectorAnswer(adjudicationAnswer) ||
      !["match", "mismatch", "uncertain"].includes(
        adjudicationAnswer.choice ?? ""
      ) ||
      recognition.expectation.evidenceMode !== "images" ||
      adjudication.expectation.evidenceMode !== "sealed-text" ||
      adjudication.expectation.orderedAttachments.length !== 0 ||
      !sameHashes(
        recognition.expectation.orderedAttachments,
        expectedStageAttachments(row.recognition, "recognition")
      ) ||
      !sameHashes(
        prediction.expectation.orderedAttachments,
        expectedStageAttachments(row.prediction, "prediction")
      ) ||
      panels.some(
        (stage: CollectorQualificationStage, index: number) =>
          !sameHashes(
            stage.expectation.orderedAttachments,
            expectedStageAttachments(
              row.panels[index] as CollectorQualificationStageLink,
              "panel"
            )
          )
      ) ||
      recognition.expectation.actor.baseModelLineage ===
        adjudication.expectation.actor.baseModelLineage ||
      recognition.settledAt > adjudication.startedAt ||
      adjudication.settledAt > prediction.startedAt ||
      prediction.settledAt >=
        Math.min(
          ...panels.map(
            ({ startedAt }: CollectorQualificationStage) => startedAt
          )
        )
    ) {
      throw new Error(
        `Collector prospective stage order or evidence mismatch: ${stimulus.id}`
      );
    }
    const recognitionEvidenceHash = sha(
      canonical({
        adjudication: adjudication.expectation.outputSha256,
        recognition: recognition.expectation.outputSha256,
      })
    );
    const craftEvidenceHash = sha(
      canonical({
        orderedAttachmentHashes: stimulus.orderedAttachmentHashes,
        questionIds: ["critical", "craft", "family", "native", "ship"].map(
          (suffix) => `${stimulus.id}-${suffix}`
        ),
      })
    );
    if (
      stimulus.recognitionEvidenceHash !== recognitionEvidenceHash ||
      stimulus.craftEvidenceHash !== craftEvidenceHash
    ) {
      throw new Error(
        `Collector derived evidence hash mismatch: ${stimulus.id}`
      );
    }
    const predictionDecision = stageDecision(prediction, stimulus.id);
    predictions.push({
      artifactHash: stimulus.artifactHash,
      critic: prediction.expectation.actor,
      decision: predictionDecision.decision,
      sealed: true,
      sealedAt: prediction.settledAt,
      stimulusId: stimulus.id,
    });
    const recognitionResolved =
      recognitionAnswer.choice === "described" &&
      adjudicationAnswer.choice === "match";
    for (const panel of panels) {
      const observed = stageDecision(panel, stimulus.id);
      const decision = recognitionResolved
        ? observed
        : { critical: null, decision: "uncertain" as const };
      panelReviews.push({
        artifactHash: stimulus.artifactHash,
        craftEvidenceHash,
        critical: decision.critical,
        decision: decision.decision,
        panelEvidenceAvailableAt: panel.startedAt,
        recognitionEvidenceHash,
        reviewer: panel.expectation.actor,
        stimulusId: stimulus.id,
      });
    }
  }
  if (
    usedStages.size !== stages.size ||
    [...stages.keys()].some((key) => !usedStages.has(key))
  ) {
    throw new Error("Collector qualification contains unlinked stages");
  }
  const criticStages = manifest.rows.map((row) =>
    stageFor(row.prediction, "prediction")
  );
  const criticIdentityCores = new Set(
    criticStages.map((stage) =>
      canonical({
        actor: stage.expectation.actor,
        instrumentHash: stage.expectation.instrumentHash,
        routeHash: stage.expectation.routeHash,
      })
    )
  );
  const [firstCriticStage] = criticStages;
  const criticInstrumentHash = firstCriticStage?.expectation.instrumentHash;
  if (
    criticIdentityCores.size !== 1 ||
    !firstCriticStage ||
    !criticInstrumentHash ||
    !HASH.test(criticInstrumentHash)
  ) {
    throw new Error(
      "Collector qualification does not freeze one critic route and instrument"
    );
  }
  const criticIdentity: QualifiedCriticExecutionIdentity = Object.freeze({
    actor: Object.freeze({ ...firstCriticStage.expectation.actor }),
    instrumentHash: criticInstrumentHash,
    qualificationSessionIds: Object.freeze(
      [...new Set(criticStages.map(({ sessionId }) => sessionId))].toSorted()
    ),
    routeHash: firstCriticStage.expectation.routeHash,
    sessionPolicy: "distinct-production-session-required",
  });
  const metrics = qualifyCriticAgainstIndependentAiPanel(
    population.stimuli,
    predictions,
    panelReviews
  );
  const metricsHash = sha(canonical(metrics));
  const receiptCore = {
    agreementMetricsQualified: metrics.qualified,
    criticIdentity,
    evidenceManifestHash: options.expectedManifestSha256,
    generalGeneratedCriticQualified: metrics.qualified,
    metricsHash,
    populationIdentityValidated: true,
    provenanceKind: sawApiRun
      ? ("collector-bound-live-transport-evidence-v2" as const)
      : ("collector-bound-native-evidence-v1" as const),
    provenanceValidated: true,
    qualificationScope: "agreement-with-independent-ai-panel" as const,
    qualified: metrics.qualified,
  };
  return {
    ...receiptCore,
    metrics,
    qualificationVersionHash: sha(canonical(receiptCore)),
  };
};

// This validates one complete canonical protocol row as one fail-closed unit.
// eslint-disable-next-line complexity
const validateCanonicalRowEvidence = (
  base: string,
  binding: StimulusEvidenceBinding,
  stimulus: AiPanelQualificationStimulus
) => {
  if (
    !Array.isArray(binding.attachments) ||
    binding.attachments.length !== stimulus.orderedAttachmentHashes.length
  ) {
    throw new Error(`Ordered attachment binding mismatch: ${stimulus.id}`);
  }
  const attachmentHashes = binding.attachments.map((attachment) => {
    readBound(base, attachment);
    return attachment.sha256;
  });
  if (
    JSON.stringify(attachmentHashes) !==
    JSON.stringify(stimulus.orderedAttachmentHashes)
  ) {
    throw new Error(`Ordered attachment binding mismatch: ${stimulus.id}`);
  }
  const protocol = readBoundJson(base, binding.protocol) as {
    blindPacket?: readonly {
      familyReferenceHashes?: readonly string[];
      id?: string;
      imageHash?: string;
    }[];
    model?: string;
    qualified?: boolean;
    recognitionOrder?: readonly { choices?: readonly string[]; id?: string }[];
  };
  const rows = protocol.blindPacket?.filter(({ id }) => id === stimulus.id);
  const recognitionOrder = protocol.recognitionOrder?.filter(
    ({ id }) => id === `${stimulus.id}-recognition`
  );
  const protocolRow = rows?.[0];
  const recognitionChoices = recognitionOrder?.[0]?.choices;
  if (
    !protocol.model?.trim() ||
    protocol.qualified !== false ||
    !protocol.blindPacket?.length ||
    protocol.blindPacket.length > 20 ||
    rows?.length !== 1 ||
    protocolRow?.imageHash !== stimulus.artifactHash ||
    !protocolRow.familyReferenceHashes?.length ||
    protocolRow.familyReferenceHashes.some((hash) => !HASH.test(hash)) ||
    recognitionOrder?.length !== 1 ||
    !recognitionChoices?.length
  ) {
    throw new Error(`Canonical protocol row mismatch: ${stimulus.id}`);
  }
  const recognition = readBoundJson(
    base,
    binding.recognition
  ) as CanonicalProtocolReview;
  if (
    recognition.status !== "complete" ||
    recognition.model !== protocol.model ||
    recognition.evidenceHashes?.[`${stimulus.id}.png`] !==
      stimulus.artifactHash ||
    !validAnswer(
      recognition,
      `${stimulus.id}-recognition`,
      recognitionChoices
    ) ||
    sha(JSON.stringify(recognition)) !== stimulus.recognitionEvidenceHash
  ) {
    throw new Error(`Canonical recognition row mismatch: ${stimulus.id}`);
  }
  const craft = readBoundJson(base, binding.craft) as CanonicalProtocolReview;
  const expectedCraftImages = [
    [`${stimulus.id}.png`, stimulus.artifactHash],
    ...protocolRow.familyReferenceHashes.map(
      (hash) => [`family-${hash}.png`, hash] as const
    ),
  ] as const;
  const craftAnswers = [
    ["critical", ["yes", "no", "uncertain"]],
    ["craft", Array.from({ length: 10 }, (_, index) => String(index + 1))],
    ["family", ["yes", "no", "uncertain"]],
    ["native", ["yes", "no", "uncertain"]],
    ["ship", ["yes", "no", "uncertain"]],
  ] as const;
  if (
    craft.status !== "complete" ||
    craft.model !== protocol.model ||
    expectedCraftImages.some(
      ([name, hash]) => craft.evidenceHashes?.[name] !== hash
    ) ||
    craftAnswers.some(
      ([suffix, choices]) =>
        !validAnswer(craft, `${stimulus.id}-${suffix}`, choices)
    ) ||
    sha(JSON.stringify(craft)) !== stimulus.craftEvidenceHash
  ) {
    throw new Error(`Canonical craft row mismatch: ${stimulus.id}`);
  }
};

/** Verify the frozen population and every byte used by the existing agreement
 * metric before issuing a production-consumable qualification receipt. */
// The checks form one provenance boundary and intentionally fail together.
// eslint-disable-next-line complexity
export const qualifyCriticFromFrozenEvidence = (options: {
  expectedManifestSha256: string;
  manifestFile: string;
}) => {
  if (!HASH.test(options.expectedManifestSha256)) {
    throw new Error("Expected qualification manifest hash is required");
  }
  const manifestBytes = readFileSync(realpathSync(options.manifestFile));
  if (sha(manifestBytes) !== options.expectedManifestSha256) {
    throw new Error("Qualification manifest hash mismatch");
  }
  const manifest = JSON.parse(
    manifestBytes.toString("utf-8")
  ) as QualificationEvidenceManifest;
  if (
    manifest.contractVersion !== ACCEPTANCE_CONTRACT_VERSION ||
    manifest.scope !== "agreement-with-independent-ai-panel" ||
    !manifest.qualificationId?.trim() ||
    manifest.labelsExposedBeforePrediction !== false ||
    manifest.panelReceipts?.length !== 2
  ) {
    throw new Error("Qualification manifest is invalid or labels were exposed");
  }
  const base = path.dirname(realpathSync(options.manifestFile));
  const population = readBoundJson(base, manifest.population) as {
    qualificationId?: string;
    sealed?: boolean;
    stimuli?: AiPanelQualificationStimulus[];
  };
  if (
    population.qualificationId !== manifest.qualificationId ||
    population.sealed !== true ||
    !Array.isArray(population.stimuli)
  ) {
    throw new Error("Frozen qualification population is invalid");
  }
  const evidenceById = new Map(
    manifest.artifacts.map((entry) => [entry.stimulusId, entry])
  );
  if (
    evidenceById.size !== manifest.artifacts.length ||
    evidenceById.size !== population.stimuli.length
  ) {
    throw new Error(
      "Qualification artifact bindings are incomplete or duplicate"
    );
  }
  validateNaturalPopulationIdentity(
    base,
    manifest.qualificationId,
    manifest.requestedSlots,
    manifest.exposureSidecar,
    population.stimuli,
    evidenceById
  );
  for (const stimulus of population.stimuli) {
    const binding = evidenceById.get(stimulus.id);
    if (!binding) {
      throw new Error(`Missing exact artifact binding: ${stimulus.id}`);
    }
    const artifact = readBound(base, binding.artifact);
    if (sha(artifact) !== stimulus.artifactHash) {
      throw new Error(`Stimulus evidence identity mismatch: ${stimulus.id}`);
    }
    validateCanonicalRowEvidence(base, binding, stimulus);
  }
  const critic = readBoundJson(base, manifest.criticReceipt) as {
    kind?: string;
    populationSha256?: string;
    qualificationId?: string;
    sealed?: boolean;
    predictions?: AiCriticPrediction[];
  };
  if (
    critic.kind !== "sealed-critic-predictions" ||
    critic.qualificationId !== manifest.qualificationId ||
    critic.populationSha256 !== manifest.population.sha256 ||
    critic.sealed !== true ||
    !Array.isArray(critic.predictions)
  ) {
    throw new Error("Sealed critic receipt is invalid");
  }
  if (
    critic.predictions.length !== population.stimuli.length ||
    new Set(critic.predictions.map(({ stimulusId }) => stimulusId)).size !==
      population.stimuli.length
  ) {
    throw new Error(
      "Sealed critic receipt does not cover the frozen population"
    );
  }
  const panelReviews: IndependentAiPanelReview[] = [];
  const panelReceiptHashes = new Set<string>();
  const panelReceiptIdentities = new Set<string>();
  for (const binding of manifest.panelReceipts) {
    if (panelReceiptHashes.has(binding.sha256)) {
      throw new Error("Panel receipt identities must be distinct");
    }
    panelReceiptHashes.add(binding.sha256);
    const panel = readBoundJson(base, binding) as {
      criticReceiptSha256?: string;
      kind?: string;
      populationSha256?: string;
      qualificationId?: string;
      reviews?: IndependentAiPanelReview[];
      sealed?: boolean;
    };
    if (
      panel.kind !== "sealed-panel-reviews" ||
      panel.qualificationId !== manifest.qualificationId ||
      panel.populationSha256 !== manifest.population.sha256 ||
      panel.criticReceiptSha256 !== manifest.criticReceipt.sha256 ||
      panel.sealed !== true ||
      !Array.isArray(panel.reviews) ||
      panel.reviews.length !== population.stimuli.length ||
      new Set(panel.reviews.map(({ stimulusId }) => stimulusId)).size !==
        population.stimuli.length
    ) {
      throw new Error("Sealed panel receipt is invalid");
    }
    const identities = new Set(
      panel.reviews.map(
        ({ reviewer }) => `${reviewer.provider.trim()}/${reviewer.model.trim()}`
      )
    );
    const [identity] = identities;
    if (
      identities.size !== 1 ||
      !identity ||
      panelReceiptIdentities.has(identity)
    ) {
      throw new Error(
        "Each panel receipt needs one distinct stable reviewer identity"
      );
    }
    panelReceiptIdentities.add(identity);
    panelReviews.push(...panel.reviews);
  }
  const metrics = qualifyCriticAgainstIndependentAiPanel(
    population.stimuli,
    critic.predictions,
    panelReviews
  );
  const metricsHash = sha(canonical(metrics));
  const receiptCore = {
    agreementMetricsQualified: metrics.qualified,
    evidenceManifestHash: options.expectedManifestSha256,
    generalGeneratedCriticQualified: false,
    metricsHash,
    populationIdentityValidated: true,
    provenanceKind: "self-declared-byte-envelope-v1" as const,
    provenanceValidated: false,
    qualificationScope: "byte-bound-ai-panel-diagnostic" as const,
    qualified: false,
  };
  return {
    ...receiptCore,
    metrics,
    qualificationVersionHash: sha(canonical(receiptCore)),
  };
};

interface CollectorProductionCriticReviewRow {
  adjudication: CollectorQualificationStageLink;
  artifact: FileBinding;
  authorReceipt: FileBinding;
  conceptId: string;
  familyId: string;
  master: string;
  nativePresentations: readonly [
    FileBinding & { surface: "light" },
    FileBinding & { surface: "dark" },
  ];
  nativeSize: 16 | 24;
  paint: "filled" | "outlined";
  recognition: CollectorQualificationStageLink;
  recognitionInstrumentHash: string;
  recognitionPresentation: FileBinding;
  recognitionSurface: "light" | "dark";
  adjudicationInput: FileBinding;
  synonymKey: FileBinding;
  requestIntentHash: string;
  slotId: string;
  stage: CollectorQualificationStageLink;
}

interface CollectorProductionCriticReviewManifest {
  contractVersion: string;
  kind: "collector-production-critic-review-manifest-v3";
  qualificationManifestSha256: string;
  reviewId: string;
  rows: readonly CollectorProductionCriticReviewRow[];
  runs: CollectorCriticQualificationManifest["runs"];
}

interface VerifiedProductionCriticReview {
  readonly actor: CollectorStageExpectation["actor"];
  readonly answersHash: string;
  readonly artifactHash: string;
  readonly conceptId: string;
  readonly criticalDefect: boolean;
  readonly craftRating: number;
  readonly familyFit: boolean;
  readonly familyId: string;
  readonly instrumentHash: string;
  readonly labels: {
    readonly craftRating: number;
    readonly criticalDefect: boolean;
    readonly familyFit: boolean;
    readonly nativeLegibility: boolean;
    readonly recognitionAdjudication: "match" | "mismatch" | "uncertain";
    readonly recognitionChoice: "described" | "unknown";
    readonly recognitionCorrect: boolean | null;
    readonly shipUnchanged: boolean;
  };
  readonly master: string;
  readonly nativeLegibility: boolean;
  readonly nativePresentationHashes: readonly [string, string];
  readonly nativeSize: 16 | 24;
  readonly outputSha256: string;
  readonly paint: "filled" | "outlined";
  readonly requestIntentHash: string;
  readonly promptSha256: string;
  readonly routeHash: string;
  readonly recognitionAdjudication: "match" | "mismatch" | "uncertain";
  readonly recognitionChoice: "described" | "unknown";
  readonly recognitionCorrect: boolean | null;
  readonly recognitionEvidenceHash: string;
  readonly reviewEvidenceHash: string;
  readonly reviewerId: string;
  readonly sessionId: string;
  readonly shipUnchanged: boolean;
  readonly slotId: string;
}

// Each categorical answer participates independently in the consistency rule.
// eslint-disable-next-line complexity
const completeProductionCriticLabels = (
  stage: VerifiedCollectorStageSummary,
  slotId: string
) => {
  const answer = (suffix: string) => stage.answers[`${slotId}-${suffix}`];
  const craft = answer("craft")?.choice;
  const critical = answer("critical")?.choice;
  const family = answer("family")?.choice;
  const native = answer("native")?.choice;
  const ship = answer("ship")?.choice;
  if (
    !craft ||
    !critical ||
    !family ||
    !native ||
    !ship ||
    !/^(?<rating>[1-9]|10)$/u.test(craft) ||
    !["yes", "no"].includes(critical) ||
    !["yes", "no"].includes(family) ||
    !["yes", "no"].includes(native) ||
    !["yes", "no"].includes(ship) ||
    (critical === "yes" && ship !== "no") ||
    (ship === "yes" && (family !== "yes" || native !== "yes"))
  ) {
    throw new Error(
      `Production critic answers are incomplete or contradictory: ${slotId}`
    );
  }
  return {
    craftRating: Number(craft),
    criticalDefect: critical === "yes",
    familyFit: family === "yes",
    nativeLegibility: native === "yes",
    shipUnchanged: ship === "yes",
  };
};

/** Verifies post-settlement production critic reviews against the already
 * qualified route. The dispatch population must be frozen separately before
 * calls; this manifest necessarily binds result and journal hashes afterward. */
// This is a byte-bound post-settlement verifier with explicit identity checks.
// eslint-disable-next-line complexity
export const verifyProductionCriticReviewsFromCollectorEvidence = (options: {
  expectedManifestSha256: string;
  manifestFile: string;
  qualification: {
    criticIdentity?: unknown;
    evidenceManifestHash?: string;
    qualified?: boolean;
  };
}) => {
  if (!HASH.test(options.expectedManifestSha256)) {
    throw new Error("Production critic review manifest hash is invalid");
  }
  const manifestPath = realpathSync(options.manifestFile);
  const manifestBytes = readFileSync(manifestPath);
  if (sha(manifestBytes) !== options.expectedManifestSha256) {
    throw new Error("Production critic review manifest hash mismatch");
  }
  const manifest = JSON.parse(
    manifestBytes.toString("utf-8")
  ) as CollectorProductionCriticReviewManifest;
  const qualified = options.qualification;
  const criticValue = qualified.criticIdentity;
  if (
    manifest.kind !== "collector-production-critic-review-manifest-v3" ||
    manifest.contractVersion !== ACCEPTANCE_CONTRACT_VERSION ||
    !manifest.reviewId?.trim() ||
    manifest.qualificationManifestSha256 !== qualified.evidenceManifestHash ||
    qualified.qualified !== true ||
    !criticValue ||
    typeof criticValue !== "object" ||
    !Object.hasOwn(criticValue, "actor") ||
    !Object.hasOwn(criticValue, "instrumentHash") ||
    !Object.hasOwn(criticValue, "routeHash") ||
    !Object.hasOwn(criticValue, "qualificationSessionIds") ||
    !Object.hasOwn(criticValue, "sessionPolicy") ||
    !Array.isArray(manifest.rows) ||
    !manifest.rows.length ||
    !Array.isArray(manifest.runs) ||
    !manifest.runs.length
  ) {
    throw new Error("Production critic review manifest identity is invalid");
  }
  const critic = criticValue as QualifiedCriticExecutionIdentity;
  if (
    !HASH.test(critic.instrumentHash) ||
    !HASH.test(critic.routeHash) ||
    critic.sessionPolicy !== "distinct-production-session-required" ||
    !Array.isArray(critic.qualificationSessionIds) ||
    !critic.qualificationSessionIds.length
  ) {
    throw new Error("Qualified critic execution identity is invalid");
  }
  const base = path.dirname(manifestPath);
  const runIds = new Set<string>();
  const stages = new Map<
    string,
    VerifiedCollectorStageSummary & { sessionId: string }
  >();
  for (const run of manifest.runs) {
    if (
      !validIdentity(run.id) ||
      runIds.has(run.id) ||
      run.evidence.qualificationId !== manifest.reviewId
    ) {
      throw new Error(`Production critic run identity mismatch: ${run.id}`);
    }
    runIds.add(run.id);
    const journalPath = realpathSync(path.resolve(base, run.journal.file));
    readBound(base, run.journal);
    const validated = validateCollectorBoundStageAccessEvidence({
      evidence: run.evidence,
      expectedJournalSha256: run.journal.sha256,
      journalFile: journalPath,
    });
    for (const stage of validated.stages) {
      const key = `${run.id}/${stage.id}`;
      if (stages.has(key)) {
        throw new Error(`Duplicate production critic stage: ${key}`);
      }
      stages.set(key, { ...stage, sessionId: run.evidence.sessionId });
    }
  }
  const usedStages = new Set<string>();
  const seenSlots = new Set<string>();
  const reviews: VerifiedProductionCriticReview[] = [];
  for (const row of manifest.rows) {
    const key = `${row.stage.runId}/${row.stage.stageId}`;
    const stage = stages.get(key);
    const recognitionKey = `${row.recognition.runId}/${row.recognition.stageId}`;
    const recognition = stages.get(recognitionKey);
    const adjudicationKey = `${row.adjudication.runId}/${row.adjudication.stageId}`;
    const adjudication = stages.get(adjudicationKey);
    const artifactBytes = readBound(base, row.artifact);
    const recognitionPresentationBytes = readBound(
      base,
      row.recognitionPresentation
    );
    const adjudicationInput = readBoundJson(base, row.adjudicationInput) as {
      kind?: string;
      recognitionAnswer?: unknown;
      recognitionOutputSha256?: string;
      slotId?: string;
      synonymKey?: unknown;
      synonymKeySha256?: string;
    };
    const synonymKey = readBoundJson(base, row.synonymKey) as {
      kind?: string;
      meanings?: unknown;
      slotId?: string;
      synonyms?: unknown;
    };
    readBound(base, row.authorReceipt);
    const [lightPresentation, darkPresentation] = row.nativePresentations;
    if (!lightPresentation || !darkPresentation) {
      throw new Error(
        `Production critic native evidence is incomplete: ${row.slotId}`
      );
    }
    readBound(base, lightPresentation);
    readBound(base, darkPresentation);
    const nativeHashes: [string, string] = [
      lightPresentation.sha256,
      darkPresentation.sha256,
    ];
    if (
      seenSlots.has(row.slotId) ||
      !stage ||
      !recognition ||
      !adjudication ||
      stage.role !== "production-critic" ||
      recognition.role !== "recognition" ||
      adjudication.role !== "adjudication" ||
      recognition.requestId !== manifest.reviewId ||
      adjudication.requestId !== manifest.reviewId ||
      recognition.promptSha256 !== row.recognition.promptSha256 ||
      adjudication.promptSha256 !== row.adjudication.promptSha256 ||
      recognition.evidenceMode !== "images" ||
      adjudication.evidenceMode !== "sealed-text" ||
      recognition.orderedAttachments.length !== 1 ||
      recognition.orderedAttachments[0]?.sha256 !==
        row.recognitionPresentation.sha256 ||
      !["light", "dark"].includes(row.recognitionSurface) ||
      row.recognitionPresentation.sha256 !==
        (row.recognitionSurface === "light"
          ? lightPresentation.sha256
          : darkPresentation.sha256) ||
      recognition.instrumentHash !== row.recognitionInstrumentHash ||
      !HASH.test(row.recognitionInstrumentHash) ||
      canonical(recognition.subject) !==
        canonical({
          artifactHash: row.artifact.sha256,
          conceptId: row.conceptId,
          familyId: row.familyId,
          master: row.master,
          nativePresentationHashes: nativeHashes,
          nativeSize: row.nativeSize,
          paint: row.paint,
          requestIntentHash: row.requestIntentHash,
          slotId: row.slotId,
        }) ||
      adjudication.orderedAttachments.length !== 0 ||
      adjudication.promptSha256 !== row.adjudicationInput.sha256 ||
      adjudicationInput.kind !==
        "sealed-production-recognition-adjudication-input-v1" ||
      adjudicationInput.recognitionOutputSha256 !== recognition.outputSha256 ||
      canonical(adjudicationInput.recognitionAnswer) !==
        canonical(recognition.answers[`${row.slotId}-free-recognition`]) ||
      adjudicationInput.slotId !== row.slotId ||
      adjudicationInput.synonymKeySha256 !== row.synonymKey.sha256 ||
      canonical(adjudicationInput.synonymKey) !== canonical(synonymKey) ||
      synonymKey.kind !== "sealed-production-synonym-key-v1" ||
      synonymKey.slotId !== row.slotId ||
      !Array.isArray(synonymKey.meanings) ||
      synonymKey.meanings.length === 0 ||
      !Array.isArray(synonymKey.synonyms) ||
      synonymKey.synonyms.length === 0 ||
      sha(recognitionPresentationBytes) !==
        row.recognitionPresentation.sha256 ||
      canonical(recognition.actor) !== canonical(critic.actor) ||
      recognition.routeHash !== critic.routeHash ||
      critic.qualificationSessionIds.includes(recognition.sessionId) ||
      adjudication.actor.baseModelLineage ===
        recognition.actor.baseModelLineage ||
      recognition.settledAt > adjudication.startedAt ||
      adjudication.settledAt > stage.startedAt ||
      stage.requestId !== manifest.reviewId ||
      canonical(stage.subject) !==
        canonical({
          artifactHash: row.artifact.sha256,
          conceptId: row.conceptId,
          familyId: row.familyId,
          master: row.master,
          nativePresentationHashes: nativeHashes,
          nativeSize: row.nativeSize,
          paint: row.paint,
          requestIntentHash: row.requestIntentHash,
          slotId: row.slotId,
        }) ||
      stage.promptSha256 !== row.stage.promptSha256 ||
      stage.instrumentHash !== critic.instrumentHash ||
      stage.routeHash !== critic.routeHash ||
      canonical(stage.actor) !== canonical(critic.actor) ||
      critic.qualificationSessionIds.includes(stage.sessionId) ||
      sha(artifactBytes) !== row.artifact.sha256 ||
      row.nativePresentations[0]?.surface !== "light" ||
      row.nativePresentations[1]?.surface !== "dark" ||
      canonical(stage.orderedAttachments.map(({ sha256 }) => sha256)) !==
        canonical(nativeHashes)
    ) {
      throw new Error(
        `Production critic stage linkage mismatch: ${row.slotId}`
      );
    }
    const labels = completeProductionCriticLabels(stage, row.slotId);
    const recognitionChoice =
      recognition.answers[`${row.slotId}-free-recognition`]?.choice;
    const recognitionAdjudication =
      adjudication.answers[`${row.slotId}-synonym-adjudication`]?.choice;
    if (
      !["described", "unknown"].includes(recognitionChoice ?? "") ||
      !["match", "mismatch", "uncertain"].includes(
        recognitionAdjudication ?? ""
      )
    ) {
      throw new Error(
        `Production recognition evidence is incomplete: ${row.slotId}`
      );
    }
    let recognitionCorrect: boolean | null = false;
    if (
      recognitionChoice === "described" &&
      recognitionAdjudication === "match"
    ) {
      recognitionCorrect = true;
    } else if (recognitionAdjudication === "uncertain") {
      recognitionCorrect = null;
    }
    const reviewerId = sha(
      canonical({
        actor: stage.actor,
        instrumentHash: stage.instrumentHash,
        routeHash: stage.routeHash,
      })
    );
    seenSlots.add(row.slotId);
    usedStages.add(key);
    usedStages.add(recognitionKey);
    usedStages.add(adjudicationKey);
    reviews.push(
      Object.freeze({
        actor: Object.freeze({ ...stage.actor }),
        answersHash: stage.answersHash,
        artifactHash: row.artifact.sha256,
        conceptId: row.conceptId,
        craftRating: labels.craftRating,
        criticalDefect: labels.criticalDefect,
        familyFit: labels.familyFit,
        familyId: row.familyId,
        instrumentHash: critic.instrumentHash,
        labels: Object.freeze({
          ...labels,
          recognitionAdjudication: recognitionAdjudication as
            | "match"
            | "mismatch"
            | "uncertain",
          recognitionChoice: recognitionChoice as "described" | "unknown",
          recognitionCorrect,
        }),
        master: row.master,
        nativeLegibility: labels.nativeLegibility,
        nativePresentationHashes: Object.freeze(nativeHashes),
        nativeSize: row.nativeSize,
        outputSha256: stage.outputSha256,
        paint: row.paint,
        promptSha256: stage.promptSha256,
        recognitionAdjudication: recognitionAdjudication as
          | "match"
          | "mismatch"
          | "uncertain",
        recognitionChoice: recognitionChoice as "described" | "unknown",
        recognitionCorrect,
        recognitionEvidenceHash: sha(
          canonical({
            adjudicationOutputSha256: adjudication.outputSha256,
            recognitionOutputSha256: recognition.outputSha256,
          })
        ),
        requestIntentHash: row.requestIntentHash,
        reviewEvidenceHash: stage.outputSha256,
        reviewerId,
        routeHash: stage.routeHash,
        sessionId: stage.sessionId,
        shipUnchanged: labels.shipUnchanged,
        slotId: row.slotId,
      })
    );
  }
  if (usedStages.size !== stages.size) {
    throw new Error(
      "Production critic review manifest contains unlinked stages"
    );
  }
  const reviewSetHash = sha(canonical(reviews));
  return Object.freeze({
    authorEvidenceVerified: false as const,
    kind: "verified-production-critic-review-set-v1" as const,
    qualificationManifestSha256: manifest.qualificationManifestSha256,
    reviewManifestSha256: options.expectedManifestSha256,
    reviewSetHash,
    reviews: Object.freeze(reviews),
  });
};

/** Diagnostic-only, identity-bound interruption of one native finalization. */
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import { parseFamilyReferencePacket } from "./family-reference-packet.js";

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const CONTAINER_ID = /^[a-f0-9]{64}$/u;
const capabilities = new WeakSet<object>();
const capabilityTriggers = new WeakMap<object, Map<string, string>>();
const loadedPlans = new WeakSet<object>();
const boundPlans = new WeakMap<object, DiagnosticFinalizationPlanBindingData>();
const issuanceFileFor = (loaded: LoadedDiagnosticFinalizationPlan) =>
  `${loaded.file}.issued-${loaded.sha256}.json`;

interface DiagnosticFinalizationPlan {
  campaignHash: string;
  expiresAt: number;
  familyPacket: {
    file: string;
    packetHash: string;
    sha256: string;
  };
  image: string;
  kind: "iconsmith-finalization-interruption-plan-v1";
  maxWallMs: number;
  planFile: string;
  qualification: false;
  revisionHash: string;
  routeHash: string;
  schemaVersion: 1;
  target: {
    concept: string;
    family: string;
    master: "16" | "24";
    slotIds: readonly [string, string];
  };
}

export interface LoadedDiagnosticFinalizationPlan {
  readonly file: string;
  readonly plan: Readonly<DiagnosticFinalizationPlan>;
  readonly sha256: string;
}

export interface BoundDiagnosticFinalizationPlan {
  readonly kind: "bound-diagnostic-finalization-plan";
}

interface DiagnosticFinalizationPlanBindingData {
  actual: {
    deadlineAt: number;
    familyPacket: { file: string; packetHash: string; sha256: string };
    image: string;
    requestId: string;
    revisionFile: string;
    revisionHash: string;
    routeHash: string;
  };
  loaded: LoadedDiagnosticFinalizationPlan;
}

interface DiagnosticFinalizationDescriptor {
  createdAt: number;
  diagnosticId: string;
  descriptorReceipt: string;
  expectedImage: string;
  expiresAt: number;
  kind: "native-finalization-interruption-diagnostic";
  originalDeadlineAt: number;
  requestId: string;
  reservationHash: string;
  routeHash: string;
  schemaVersion: 1;
}

export interface DiagnosticFinalizationBinding {
  callId: string;
  finalizedReceiptHash: string;
  inspectionHash: string;
  intentHash: string;
  programHashes: Readonly<Record<string, string>>;
  responseSchemaHash: string;
  stage: string;
  stageDeadlineAt: number;
  triggerReceipt: string;
}

interface DiagnosticContainerIdentity {
  containerId: string;
  containerName: string;
  image: string;
  ownershipToken: string;
}

export interface DiagnosticFinalizationObserver {
  observe: (
    line: string,
    signal: AbortSignal,
    identity: DiagnosticContainerIdentity,
    killExactContainer: () => Promise<void>
  ) => Promise<void>;
}

export interface DiagnosticFinalizationCapability {
  readonly descriptor: Readonly<DiagnosticFinalizationDescriptor>;
  readonly descriptorHash: string;
}

export interface VerifiedDiagnosticFinalizationTrigger {
  readonly descriptorFile: string;
  readonly descriptorSha256: string;
  readonly file: string;
  readonly sha256: string;
  readonly terminalLineSha256: string;
}

const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

const descriptorBytes = (descriptor: DiagnosticFinalizationDescriptor) =>
  `${JSON.stringify(descriptor, null, 2)}\n`;

const exactObjectKeys = (value: object, expected: readonly string[]) => {
  const actual = Object.keys(value).toSorted();
  return JSON.stringify(actual) === JSON.stringify(expected.toSorted());
};

const readOwnedRegularFile = (file: string, label: string) => {
  if (!path.isAbsolute(file)) {
    throw new Error(`${label} must be an absolute path`);
  }
  const before = lstatSync(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    realpathSync(file) !== file
  ) {
    throw new Error(`${label} must be an owned regular file`);
  }
  const bytes = readFileSync(file);
  const after = lstatSync(file);
  if (
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs
  ) {
    throw new Error(`${label} changed while it was read`);
  }
  return bytes;
};

const verifyCapabilityDescriptor = (
  capability: DiagnosticFinalizationCapability
) => {
  if (!capabilities.has(capability)) {
    throw new Error("Diagnostic finalization capability was not canonical");
  }
  const expected = descriptorBytes(capability.descriptor);
  const bytes = readOwnedRegularFile(
    capability.descriptor.descriptorReceipt,
    "Diagnostic finalization descriptor"
  );
  if (
    digest(expected) !== capability.descriptorHash ||
    !bytes.equals(Buffer.from(expected))
  ) {
    throw new Error("Diagnostic finalization descriptor identity changed");
  }
  return digest(bytes);
};

// Closed-schema identity validation intentionally checks every field.
// oxlint-disable-next-line eslint/complexity
const assertPlanShape = (value: unknown): DiagnosticFinalizationPlan => {
  if (
    typeof value !== "object" ||
    value === null ||
    !exactObjectKeys(value, [
      "campaignHash",
      "expiresAt",
      "familyPacket",
      "image",
      "kind",
      "maxWallMs",
      "planFile",
      "qualification",
      "revisionHash",
      "routeHash",
      "schemaVersion",
      "target",
    ])
  ) {
    throw new Error("Diagnostic finalization plan has an invalid schema");
  }
  const plan = value as DiagnosticFinalizationPlan;
  const packet = plan.familyPacket;
  const { target } = plan;
  if (
    plan.kind !== "iconsmith-finalization-interruption-plan-v1" ||
    plan.schemaVersion !== 1 ||
    plan.qualification !== false ||
    !HASH.test(plan.campaignHash) ||
    !HASH.test(plan.revisionHash) ||
    !HASH.test(plan.routeHash) ||
    !/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/u.test(plan.image) ||
    !Number.isSafeInteger(plan.maxWallMs) ||
    plan.maxWallMs <= 0 ||
    !path.isAbsolute(plan.planFile) ||
    !Number.isSafeInteger(plan.expiresAt) ||
    typeof packet !== "object" ||
    packet === null ||
    !exactObjectKeys(packet, ["file", "packetHash", "sha256"]) ||
    !path.isAbsolute(packet.file) ||
    !HASH.test(packet.sha256) ||
    !HASH.test(packet.packetHash) ||
    typeof target !== "object" ||
    target === null ||
    !exactObjectKeys(target, ["concept", "family", "master", "slotIds"]) ||
    !ID.test(target.concept) ||
    !ID.test(target.family) ||
    !["16", "24"].includes(target.master) ||
    !Array.isArray(target.slotIds) ||
    target.slotIds.length !== 2 ||
    target.slotIds[0] !==
      `${target.family}/${target.concept}/${target.master}/outlined` ||
    target.slotIds[1] !==
      `${target.family}/${target.concept}/${target.master}/filled`
  ) {
    throw new Error("Diagnostic finalization plan has invalid identities");
  }
  return plan;
};

const freezePlan = (
  plan: DiagnosticFinalizationPlan
): Readonly<DiagnosticFinalizationPlan> =>
  Object.freeze({
    ...plan,
    familyPacket: Object.freeze({ ...plan.familyPacket }),
    target: Object.freeze({
      ...plan.target,
      slotIds: Object.freeze([...plan.target.slotIds]) as readonly [
        string,
        string,
      ],
    }),
  });

/** Read a predeclared, non-qualifying interruption plan and its exact packet. */
export const readDiagnosticFinalizationPlan = (options: {
  file: string;
  sha256: string;
}): LoadedDiagnosticFinalizationPlan => {
  if (!HASH.test(options.sha256)) {
    throw new Error("Diagnostic finalization plan requires a SHA-256");
  }
  const bytes = readOwnedRegularFile(
    options.file,
    "Diagnostic finalization plan"
  );
  if (digest(bytes) !== options.sha256) {
    throw new Error("Diagnostic finalization plan identity changed");
  }
  const plan = assertPlanShape(JSON.parse(bytes.toString("utf-8")));
  if (plan.planFile !== options.file) {
    throw new Error("Diagnostic finalization plan canonical path changed");
  }
  const packetBytes = readOwnedRegularFile(
    plan.familyPacket.file,
    "Diagnostic family packet"
  );
  if (digest(packetBytes) !== plan.familyPacket.sha256) {
    throw new Error("Diagnostic family packet identity changed");
  }
  const packet = parseFamilyReferencePacket(
    JSON.parse(packetBytes.toString("utf-8"))
  );
  if (packet.packetHash !== plan.familyPacket.packetHash) {
    throw new Error("Diagnostic family packet semantic identity changed");
  }
  const loaded = Object.freeze({
    file: options.file,
    plan: freezePlan(plan),
    sha256: options.sha256,
  });
  loadedPlans.add(loaded);
  return loaded;
};

/** Bind the frozen plan to the actual child inputs before any call allocation. */
// oxlint-disable-next-line eslint/complexity
export const bindDiagnosticFinalizationPlan = (options: {
  actual: {
    campaignHash: string;
    concept: string;
    deadlineAt: number;
    family: string;
    familyPacket: { file: string; packetHash: string; sha256: string };
    image: string;
    master: string;
    maxWallMs: number;
    requestId: string;
    revisionFile: string;
    revisionHash: string;
    routeHash: string;
    slotIds: readonly string[];
  };
  loaded: LoadedDiagnosticFinalizationPlan;
}): BoundDiagnosticFinalizationPlan => {
  const { actual, loaded } = options;
  const { plan } = loaded;
  if (
    !loadedPlans.has(loaded) ||
    digest(
      readOwnedRegularFile(loaded.file, "Diagnostic finalization plan")
    ) !== loaded.sha256 ||
    plan.expiresAt <= Date.now() ||
    plan.expiresAt > actual.deadlineAt ||
    !Number.isSafeInteger(actual.deadlineAt) ||
    !HASH.test(actual.requestId) ||
    actual.campaignHash !== plan.campaignHash ||
    actual.concept !== plan.target.concept ||
    actual.family !== plan.target.family ||
    actual.master !== plan.target.master ||
    JSON.stringify(actual.slotIds) !== JSON.stringify(plan.target.slotIds) ||
    actual.revisionHash !== plan.revisionHash ||
    actual.routeHash !== plan.routeHash ||
    actual.image !== plan.image ||
    actual.maxWallMs !== plan.maxWallMs ||
    actual.familyPacket.file !== plan.familyPacket.file ||
    actual.familyPacket.sha256 !== plan.familyPacket.sha256 ||
    actual.familyPacket.packetHash !== plan.familyPacket.packetHash ||
    digest(
      readOwnedRegularFile(actual.revisionFile, "Diagnostic style revision")
    ) !== actual.revisionHash ||
    digest(
      readOwnedRegularFile(actual.familyPacket.file, "Diagnostic family packet")
    ) !== actual.familyPacket.sha256
  ) {
    throw new Error("Diagnostic finalization plan did not match child inputs");
  }
  const binding = Object.freeze({
    kind: "bound-diagnostic-finalization-plan" as const,
  });
  boundPlans.set(binding, {
    actual: {
      deadlineAt: actual.deadlineAt,
      familyPacket: { ...actual.familyPacket },
      image: actual.image,
      requestId: actual.requestId,
      revisionFile: actual.revisionFile,
      revisionHash: actual.revisionHash,
      routeHash: actual.routeHash,
    },
    loaded,
  });
  return binding;
};

/** Refuse transplanting a child-bound plan into another route before reservation. */
export const assertDiagnosticFinalizationPlanBinding = (options: {
  binding: BoundDiagnosticFinalizationPlan;
  deadlineAt: number;
  image: string;
  requestId: string;
  retrievalCalls: 0 | 2;
  routeHash: string;
}) => {
  const data = boundPlans.get(options.binding);
  if (
    !data ||
    options.retrievalCalls !== 0 ||
    data.actual.deadlineAt !== options.deadlineAt ||
    data.actual.image !== options.image ||
    data.actual.requestId !== options.requestId ||
    data.actual.routeHash !== options.routeHash ||
    data.loaded.plan.expiresAt <= Date.now() ||
    existsSync(issuanceFileFor(data.loaded)) ||
    digest(
      readOwnedRegularFile(data.loaded.file, "Diagnostic finalization plan")
    ) !== data.loaded.sha256
  ) {
    throw new Error("Diagnostic finalization binding was transplanted");
  }
};

/** Materialize the single-use capability only after the canonical reservation exists. */
export const materializeDiagnosticFinalizationPlan = (options: {
  binding: BoundDiagnosticFinalizationPlan;
  descriptorReceipt: string;
  reservationHash: string;
}): DiagnosticFinalizationCapability => {
  const data = boundPlans.get(options.binding);
  if (!data || !HASH.test(options.reservationHash)) {
    throw new Error("Diagnostic finalization plan binding was not canonical");
  }
  if (
    digest(
      readOwnedRegularFile(data.loaded.file, "Diagnostic finalization plan")
    ) !== data.loaded.sha256 ||
    digest(
      readOwnedRegularFile(
        data.actual.revisionFile,
        "Diagnostic style revision"
      )
    ) !== data.actual.revisionHash ||
    digest(
      readOwnedRegularFile(
        data.actual.familyPacket.file,
        "Diagnostic family packet"
      )
    ) !== data.actual.familyPacket.sha256 ||
    data.loaded.plan.expiresAt <= Date.now()
  ) {
    throw new Error("Diagnostic finalization inputs changed before allocation");
  }
  const issuedAt = Date.now();
  const issuanceFile = issuanceFileFor(data.loaded);
  // Defined below beside the other durable receipt primitive.
  // oxlint-disable-next-line eslint/no-use-before-define
  durableExclusiveWrite(
    issuanceFile,
    `${JSON.stringify(
      {
        deadlineAt: data.actual.deadlineAt,
        descriptorReceipt: options.descriptorReceipt,
        image: data.actual.image,
        issuedAt,
        kind: "iconsmith-finalization-interruption-issuance-v1",
        planFile: data.loaded.file,
        planSha256: data.loaded.sha256,
        requestId: data.actual.requestId,
        reservationHash: options.reservationHash,
        routeHash: data.actual.routeHash,
        schemaVersion: 1,
      },
      null,
      2
    )}\n`
  );
  boundPlans.delete(options.binding);
  // Mint remains private; this exported path has already bound and issued the plan.
  // oxlint-disable-next-line eslint/no-use-before-define
  return createDiagnosticFinalizationCapability({
    createdAt: issuedAt,
    descriptorReceipt: options.descriptorReceipt,
    diagnosticId: data.loaded.sha256,
    expectedImage: data.actual.image,
    expiresAt: data.loaded.plan.expiresAt,
    kind: "native-finalization-interruption-diagnostic",
    originalDeadlineAt: data.actual.deadlineAt,
    requestId: data.actual.requestId,
    reservationHash: options.reservationHash,
    routeHash: data.loaded.plan.routeHash,
    schemaVersion: 1,
  });
};

const isFinalReview = (value: unknown) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !exactObjectKeys(value, ["reviewMarkdown", "unresolved"])
  ) {
    return false;
  }
  const review = value as {
    reviewMarkdown?: unknown;
    unresolved?: unknown;
  };
  return (
    typeof review.reviewMarkdown === "string" &&
    Array.isArray(review.unresolved) &&
    review.unresolved.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        exactObjectKeys(item, ["description", "id", "kind"]) &&
        typeof (item as { description?: unknown }).description === "string" &&
        typeof (item as { id?: unknown }).id === "string" &&
        ["representation", "visual"].includes(
          String((item as { kind?: unknown }).kind)
        )
    )
  );
};

const orderedProgramHashes = (value: Readonly<Record<string, string>>) =>
  Object.entries(value).toSorted(([left], [right]) =>
    left.localeCompare(right)
  );

const durableExclusiveWrite = (file: string, bytes: string) => {
  const descriptor = openSync(file, "wx", 0o600);
  try {
    writeSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const metadata = lstatSync(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    realpathSync(file) !== path.resolve(file) ||
    !readFileSync(file).equals(Buffer.from(bytes))
  ) {
    throw new Error("Diagnostic trigger receipt was not persisted exactly");
  }
  const directory = openSync(path.dirname(file), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
};

const createDiagnosticFinalizationCapability = (
  descriptor: DiagnosticFinalizationDescriptor
): DiagnosticFinalizationCapability => {
  if (
    !exactObjectKeys(descriptor, [
      "createdAt",
      "diagnosticId",
      "descriptorReceipt",
      "expectedImage",
      "expiresAt",
      "kind",
      "originalDeadlineAt",
      "requestId",
      "reservationHash",
      "routeHash",
      "schemaVersion",
    ]) ||
    descriptor.kind !== "native-finalization-interruption-diagnostic" ||
    descriptor.schemaVersion !== 1 ||
    !ID.test(descriptor.diagnosticId) ||
    !path.isAbsolute(descriptor.descriptorReceipt) ||
    !/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/u.test(descriptor.expectedImage) ||
    !HASH.test(descriptor.requestId) ||
    !HASH.test(descriptor.reservationHash) ||
    !HASH.test(descriptor.routeHash) ||
    !Number.isSafeInteger(descriptor.createdAt) ||
    !Number.isSafeInteger(descriptor.expiresAt) ||
    !Number.isSafeInteger(descriptor.originalDeadlineAt) ||
    descriptor.createdAt >= descriptor.expiresAt ||
    descriptor.expiresAt > descriptor.originalDeadlineAt
  ) {
    throw new Error("Invalid finalization interruption descriptor");
  }
  const frozen = Object.freeze({ ...descriptor });
  const capability = Object.freeze({
    descriptor: frozen,
    descriptorHash: digest(descriptorBytes(frozen)),
  });
  durableExclusiveWrite(descriptor.descriptorReceipt, descriptorBytes(frozen));
  capabilities.add(capability);
  capabilityTriggers.set(capability, new Map());
  return capability;
};

/** Authenticate the exact trigger emitted by this process-local capability. */
// Closed-schema identity validation intentionally checks every field.
// oxlint-disable-next-line eslint/complexity
export const verifyDiagnosticFinalizationTrigger = (options: {
  capability: DiagnosticFinalizationCapability;
  expected: {
    callId: string;
    containerId: string;
    containerName: string;
    finalizedReceiptHash: string;
    image: string;
    inspectionHash: string;
    intentHash: string;
    programHashes: Readonly<Record<string, string>>;
    responseSchemaHash: string;
    stage: string;
    stageDeadlineAt: number;
  };
  triggerReceipt: string;
}): VerifiedDiagnosticFinalizationTrigger => {
  const descriptorSha256 = verifyCapabilityDescriptor(options.capability);
  const bytes = readOwnedRegularFile(
    options.triggerReceipt,
    "Diagnostic finalization trigger"
  );
  const sha256 = digest(bytes);
  if (
    capabilityTriggers.get(options.capability)?.get(options.triggerReceipt) !==
    sha256
  ) {
    throw new Error("Diagnostic finalization trigger was not capability-owned");
  }
  const value: unknown = JSON.parse(bytes.toString("utf-8"));
  if (
    typeof value !== "object" ||
    value === null ||
    !exactObjectKeys(value, [
      "action",
      "callId",
      "containerId",
      "containerName",
      "descriptorHash",
      "finalizedReceiptHash",
      "image",
      "inspectionHash",
      "intentHash",
      "observedAt",
      "originalDeadlineAt",
      "ownershipTokenHash",
      "parsedFinalReviewSha256",
      "programHashes",
      "requestId",
      "reservationHash",
      "responseSchemaHash",
      "routeHash",
      "stage",
      "stageDeadlineAt",
      "terminalLineSha256",
    ])
  ) {
    throw new Error("Diagnostic finalization trigger schema changed");
  }
  const trigger = value as Record<string, unknown>;
  const expectedPrograms = orderedProgramHashes(options.expected.programHashes);
  if (
    trigger.action !== "diagnostic-kill" ||
    trigger.callId !== options.expected.callId ||
    trigger.containerId !== options.expected.containerId ||
    trigger.containerName !== options.expected.containerName ||
    trigger.descriptorHash !== options.capability.descriptorHash ||
    trigger.finalizedReceiptHash !== options.expected.finalizedReceiptHash ||
    trigger.image !== options.expected.image ||
    trigger.inspectionHash !== options.expected.inspectionHash ||
    trigger.intentHash !== options.expected.intentHash ||
    trigger.originalDeadlineAt !==
      options.capability.descriptor.originalDeadlineAt ||
    trigger.requestId !== options.capability.descriptor.requestId ||
    trigger.reservationHash !== options.capability.descriptor.reservationHash ||
    trigger.responseSchemaHash !== options.expected.responseSchemaHash ||
    trigger.routeHash !== options.capability.descriptor.routeHash ||
    trigger.stage !== options.expected.stage ||
    trigger.stageDeadlineAt !== options.expected.stageDeadlineAt ||
    JSON.stringify(trigger.programHashes) !==
      JSON.stringify(expectedPrograms) ||
    !Number.isSafeInteger(trigger.observedAt) ||
    !HASH.test(String(trigger.ownershipTokenHash)) ||
    !HASH.test(String(trigger.parsedFinalReviewSha256)) ||
    !HASH.test(String(trigger.terminalLineSha256))
  ) {
    throw new Error("Diagnostic finalization trigger identity changed");
  }
  return Object.freeze({
    descriptorFile: options.capability.descriptor.descriptorReceipt,
    descriptorSha256,
    file: options.triggerReceipt,
    sha256,
    terminalLineSha256: String(trigger.terminalLineSha256),
  });
};

export const bindDiagnosticFinalizationObserver = (options: {
  binding: DiagnosticFinalizationBinding;
  capability: DiagnosticFinalizationCapability;
  now?: () => number;
}): DiagnosticFinalizationObserver => {
  const { binding, capability } = options;
  const now = options.now ?? Date.now;
  const { descriptor } = capability;
  const programHashes = orderedProgramHashes(binding.programHashes);
  if (
    !capabilities.has(capability) ||
    digest(descriptorBytes(descriptor)) !== capability.descriptorHash ||
    !/^[a-f0-9-]{36}$/u.test(binding.callId) ||
    !HASH.test(binding.intentHash) ||
    !HASH.test(binding.inspectionHash) ||
    !HASH.test(binding.finalizedReceiptHash) ||
    !HASH.test(binding.responseSchemaHash) ||
    !/^\d{2}-finalize$/u.test(binding.stage) ||
    !Number.isSafeInteger(binding.stageDeadlineAt) ||
    binding.stageDeadlineAt > descriptor.originalDeadlineAt ||
    !path.isAbsolute(binding.triggerReceipt) ||
    programHashes.length === 0 ||
    programHashes.some(([finish, hash]) => !ID.test(finish) || !HASH.test(hash))
  ) {
    throw new Error("Diagnostic finalization binding did not match exactly");
  }
  let triggered = false;
  return Object.freeze({
    // The validation intentionally checks every identity-bound field.
    // oxlint-disable-next-line eslint/complexity
    observe: async (
      line: string,
      signal: AbortSignal,
      identity: DiagnosticContainerIdentity,
      killExactContainer: () => Promise<void>
    ) => {
      if (triggered || signal.aborted) {
        return;
      }
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (
        typeof event !== "object" ||
        event === null ||
        (event as { type?: unknown }).type !== "item.completed"
      ) {
        return;
      }
      const { item } = event as { item?: unknown };
      if (
        typeof item !== "object" ||
        item === null ||
        (item as { type?: unknown }).type !== "agent_message" ||
        typeof (item as { text?: unknown }).text !== "string"
      ) {
        return;
      }
      let review: unknown;
      try {
        review = JSON.parse((item as { text: string }).text);
      } catch {
        return;
      }
      const observedAt = now();
      if (
        signal.aborted ||
        !isFinalReview(review) ||
        observedAt >= binding.stageDeadlineAt ||
        observedAt >= descriptor.expiresAt ||
        !CONTAINER_ID.test(identity.containerId) ||
        !identity.containerName.startsWith("iconsmith-") ||
        identity.image !== descriptor.expectedImage ||
        !identity.ownershipToken
      ) {
        return;
      }
      triggered = true;
      if (signal.aborted) {
        throw new Error("Diagnostic finalization observer was cancelled");
      }
      const trigger = {
        action: "diagnostic-kill",
        callId: binding.callId,
        containerId: identity.containerId,
        containerName: identity.containerName,
        descriptorHash: capability.descriptorHash,
        finalizedReceiptHash: binding.finalizedReceiptHash,
        image: identity.image,
        inspectionHash: binding.inspectionHash,
        intentHash: binding.intentHash,
        observedAt,
        originalDeadlineAt: descriptor.originalDeadlineAt,
        ownershipTokenHash: digest(identity.ownershipToken),
        parsedFinalReviewSha256: digest(JSON.stringify(review)),
        programHashes,
        requestId: descriptor.requestId,
        reservationHash: descriptor.reservationHash,
        responseSchemaHash: binding.responseSchemaHash,
        routeHash: descriptor.routeHash,
        stage: binding.stage,
        stageDeadlineAt: binding.stageDeadlineAt,
        terminalLineSha256: digest(line),
      };
      verifyCapabilityDescriptor(capability);
      durableExclusiveWrite(
        binding.triggerReceipt,
        `${JSON.stringify(trigger, null, 2)}\n`
      );
      capabilityTriggers
        .get(capability)
        ?.set(
          binding.triggerReceipt,
          digest(readFileSync(binding.triggerReceipt))
        );
      if (signal.aborted) {
        throw new Error("Diagnostic finalization observer was cancelled");
      }
      await killExactContainer();
    },
  });
};

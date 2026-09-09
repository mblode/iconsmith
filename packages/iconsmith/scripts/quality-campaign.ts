/** Campaign freeze/report, contained AI review and historical label ingestion. */
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import type {
  CollectorPreDispatchAccessPolicy,
  CollectorApiTransportExpectation,
  CollectorStageAccessPolicy,
  CollectorStageExpectation,
} from "./ai-qualification-provenance.js";
import { writeAiReviewAssessment } from "./ai-review-assessment.js";
import {
  runAiReviewCampaign,
  runProspectiveAiReviewCampaign,
} from "./ai-review-campaign.js";
import type {
  AiReviewCampaignInput,
  AiReviewRoute,
  ProspectiveAiReviewRoute,
} from "./ai-review-campaign.js";
import type {
  ProspectiveProtocolReview,
  ProspectiveProtocolReviewer,
} from "./ai-review-protocol.js";
import { runApiCollectorStage } from "./api-image-capability.js";
import type { ApiCollectorStageCapability } from "./api-image-capability.js";
import {
  prepareDevelopmentCampaignInputs,
  reportCampaign,
  writeCampaignManifest,
} from "./campaign-manifest.js";
import { reviewImagesWithCodex } from "./local-codex-review.js";
import type {
  NativeContainerIdentity,
  SameContainerAccessBinding,
  SameContainerAccessObservation,
  SameContainerAccessProbe,
  SameContainerAccessProbePlan,
  SameContainerSecurityEvidence,
} from "./local-container-runtime.js";
import type {
  NativeCallContainerAllocation,
  NativeCallContainerFactory,
} from "./local-native-call-factory.js";
import {
  createConfiguredNativeFactory,
  nativeActorLineage,
  nativeActorContainer,
  readNativeRouteManifest,
} from "./local-native-config.js";
import type {
  NativeRouteActor,
  NativeRouteManifest,
} from "./local-native-config.js";
import { reviewImages } from "./local-review.js";
import {
  createNativeCallBoundary,
  readNativeCallBoundary,
} from "./native-call-boundary.js";
import {
  freezeQualificationReceipt,
  ingestHumanLabelFiles,
} from "./quality-labels.js";
import type { SynonymKeyRow } from "./quality-labels.js";

const corpus = path.resolve(import.meta.dirname, "../.corpus");
const NATIVE_REVIEW_CALLS = 4;
const NATIVE_PROSPECTIVE_CALLS = 3;
const NATIVE_FINAL_RESERVE_MS = 5000;
const HASH = /^[a-f0-9]{64}$/u;
const NATIVE_REVIEWER_SLOTS = ["author", "reviewer-0", "reviewer-1"] as const;
type NativeReviewerSlot = (typeof NATIVE_REVIEWER_SLOTS)[number];

const productionTypeScript = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return productionTypeScript(file);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [file]
      : [];
  });

const assertRegularFile = (file: string) => {
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(
      `Contained review closure requires a regular file: ${file}`
    );
  }
  return realpathSync(file);
};

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const writeCollectorFile = (file: string, bytes: Uint8Array | string) => {
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

const collectorBinding = (base: string, file: string) => {
  const resolvedBase = realpathSync(base);
  if (lstatSync(file).nlink !== 1) {
    throw new Error("Collector evidence cannot be multiply linked");
  }
  const resolved = assertRegularFile(file);
  const relative = path.relative(resolvedBase, resolved);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Collector evidence must stay inside its control root");
  }
  return { file: relative, sha256: digest(readFileSync(resolved)) };
};

const withinOrEqual = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};

const sameContainerProbePlanHash = (plan: SameContainerAccessProbePlan) => {
  const { planSha256: _planSha256, ...identity } = plan;
  return digest(Buffer.from(JSON.stringify(identity)));
};

const sameContainerForbiddenPaths = (roots: readonly string[]) =>
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

const accessObservationMatches = (
  plan: SameContainerAccessProbePlan,
  observation: SameContainerAccessObservation
) => {
  const [allowed, ...forbidden] = observation.observations;
  return (
    allowed?.pathClass === "allowed-native-executable" &&
    allowed.status === "readable" &&
    allowed.sha256 === plan.allowed.sha256 &&
    forbidden.length === plan.forbidden.length &&
    forbidden.every((entry, index) => {
      const expected = plan.forbidden[index];
      return (
        entry.pathClass === expected?.pathClass &&
        entry.status === "missing" &&
        !("sha256" in entry)
      );
    })
  );
};

const sealCollectorSameContainerAccessReceipt = (options: {
  controlDirectory: string;
  expectedImage: string;
  identity: NativeContainerIdentity;
  observation: SameContainerAccessObservation;
  plan: SameContainerAccessProbePlan;
  security: SameContainerSecurityEvidence;
}) => {
  const controlDirectory = realpathSync(options.controlDirectory);
  const { identity, observation, plan, security } = options;
  const securityRaw = JSON.parse(security.rawInspect) as unknown;
  const inspected = Array.isArray(securityRaw) ? securityRaw[0] : undefined;
  const mounts = (inspected?.Mounts ?? [])
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
  if (
    identity.containerId !== security.containerId ||
    identity.image !== options.expectedImage ||
    !HASH.test(identity.containerId) ||
    observation.kind !== "same-container-access-observation-v1" ||
    observation.planSha256 !== plan.planSha256 ||
    observation.stageId !== plan.stageId ||
    observation.nonceSha256 !== plan.nonceSha256 ||
    !accessObservationMatches(plan, observation) ||
    security.kind !== "same-container-security-evidence-v1" ||
    security.network !== "bridge" ||
    security.sha256 !== digest(Buffer.from(security.rawInspect)) ||
    security.mountCensusSha256 !==
      digest(Buffer.from(JSON.stringify(mounts))) ||
    inspected?.Id !== identity.containerId
  ) {
    throw new Error("Same-container access observation could not be sealed");
  }
  const receiptDirectory = path.join(controlDirectory, "access-observations");
  if (!existsSync(receiptDirectory)) {
    mkdirSync(receiptDirectory, { mode: 0o700 });
  }
  const receiptFile = path.join(receiptDirectory, `${plan.stageId}.json`);
  const receipt = {
    containerId: identity.containerId,
    kind: "collector-same-container-access-receipt-v1",
    observation,
    security: {
      kind: security.kind,
      mountCensusSha256: security.mountCensusSha256,
      network: security.network,
      sha256: security.sha256,
    },
  };
  const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
  writeCollectorFile(receiptFile, bytes);
  return Object.freeze({
    receiptFile,
    receiptSha256: digest(Buffer.from(bytes)),
    securityInspectFile: "",
    securityInspectSha256: security.sha256,
  });
};

const mountPolicyFor = (
  manifest: NativeRouteManifest,
  actor: NativeRouteActor,
  stageDirectory: string
) => {
  const stateDirectory = path.join(stageDirectory, "native-state");
  return [
    {
      containerPath: stageDirectory,
      hostPath: stageDirectory,
      readOnly: false,
    },
    ...nativeActorContainer(manifest, actor, { stateDirectory }).stateMounts,
  ];
};

export const freezeCollectorPreDispatchAccessPolicy = (options: {
  actors: readonly [NativeRouteActor, NativeRouteActor];
  controlDirectory: string;
  forbiddenHostRoots: readonly string[];
  originalDeadlineAt: number;
  qualificationId: string;
  reservationHash: string;
  routeHash: string;
  routeManifest: NativeRouteManifest;
  runtimeRoot: string;
}) => {
  const runtimeRoot = realpathSync(options.runtimeRoot);
  const controlDirectory = realpathSync(options.controlDirectory);
  if (
    !HASH.test(options.reservationHash) ||
    !HASH.test(options.routeHash) ||
    !Number.isSafeInteger(options.originalDeadlineAt) ||
    !options.qualificationId.trim() ||
    readdirSync(runtimeRoot).length !== 0
  ) {
    throw new Error("Collector access policy requires a fresh bounded session");
  }
  const forbiddenHostRoots = options.forbiddenHostRoots.map((root) => {
    const metadata = lstatSync(root);
    if (
      !path.isAbsolute(root) ||
      metadata.isSymbolicLink() ||
      !metadata.isFile()
    ) {
      throw new Error("Collector forbidden roots must be canonical host paths");
    }
    return realpathSync(root);
  });
  if (
    forbiddenHostRoots.length === 0 ||
    new Set(forbiddenHostRoots).size !== forbiddenHostRoots.length
  ) {
    throw new Error("Collector access policy requires unique forbidden roots");
  }
  const stageInputs = [
    { actorIndex: 0 as const, id: "00-recognizer-recognition" },
    { actorIndex: 1 as const, id: "01-adjudicator-adjudication" },
    { actorIndex: 0 as const, id: "02-recognizer-craft" },
  ];
  const stages: CollectorStageAccessPolicy[] = stageInputs.map(
    ({ actorIndex, id }) => {
      const actor = options.actors[actorIndex];
      const stageDirectory = path.join(runtimeRoot, id.replace(/^\d{2}-/u, ""));
      if (existsSync(stageDirectory)) {
        throw new Error("Collector writable stage directory is stale");
      }
      mkdirSync(stageDirectory, { mode: 0o700 });
      const resolvedStageDirectory = realpathSync(stageDirectory);
      const metadata = lstatSync(resolvedStageDirectory);
      const allowedMounts = mountPolicyFor(
        options.routeManifest,
        actor,
        resolvedStageDirectory
      );
      if (
        readdirSync(resolvedStageDirectory).length !== 0 ||
        allowedMounts.some(({ hostPath }) =>
          forbiddenHostRoots.some(
            (root) =>
              withinOrEqual(root, path.resolve(hostPath)) ||
              withinOrEqual(path.resolve(hostPath), root)
          )
        )
      ) {
        throw new Error(
          "Collector access policy mount reaches a forbidden root"
        );
      }
      const nonce = randomUUID();
      const nonceSha256 = digest(Buffer.from(nonce));
      const ackHostPath = path.join(
        resolvedStageDirectory,
        ".access-probe-ack"
      );
      const partialPlan = {
        ackContainerPath: ackHostPath,
        ackHostPath,
        ackSha256: digest(
          Buffer.from(`iconsmith-access-ack-v1:${id}:${nonceSha256}\n`)
        ),
        allowed: {
          containerPath: "/runtime/codex",
          sha256: actor.executable.sha256,
        },
        forbidden: sameContainerForbiddenPaths(forbiddenHostRoots),
        kind: "same-container-access-probe-plan-v1" as const,
        nonce,
        nonceSha256,
        stageId: id,
      };
      const sameContainerAccessProbe: SameContainerAccessProbePlan = {
        ...partialPlan,
        planSha256: sameContainerProbePlanHash({
          ...partialPlan,
          planSha256: "",
        }),
      };
      return {
        actor: {
          baseModelLineage: nativeActorLineage(actor),
          model: actor.model,
          provider:
            actor.provider === "codex" ? "openai-codex" : "anthropic-claude",
        },
        allowedMounts,
        id,
        network: "bridge" as const,
        sameContainerAccessProbe,
        writableDirectory: {
          device: String(metadata.dev),
          initialInventorySha256: digest(Buffer.from("[]")),
          inode: String(metadata.ino),
          path: resolvedStageDirectory,
        },
      };
    }
  );
  const policy: CollectorPreDispatchAccessPolicy = {
    forbiddenHostRoots,
    kind: "collector-pre-dispatch-access-policy-v1",
    originalDeadlineAt: options.originalDeadlineAt,
    qualificationId: options.qualificationId,
    reservationHash: options.reservationHash,
    routeHash: options.routeHash,
    sessionId: randomUUID(),
    stages,
  };
  const file = path.join(controlDirectory, "pre-dispatch-access-policy.json");
  const bytes = `${JSON.stringify(policy, null, 2)}\n`;
  writeCollectorFile(file, bytes);
  return Object.freeze({
    file,
    policy,
    sha256: digest(Buffer.from(bytes)),
  });
};

const assertFreshCollectorStage = (
  accessPolicy: ReturnType<typeof freezeCollectorPreDispatchAccessPolicy>,
  nativeStage: string
) => {
  if (digest(readFileSync(accessPolicy.file)) !== accessPolicy.sha256) {
    throw new Error("Collector pre-dispatch access policy changed");
  }
  const stage = accessPolicy.policy.stages.find(({ id }) => id === nativeStage);
  if (!stage) {
    throw new Error("Collector pre-dispatch stage is not frozen");
  }
  const metadata = lstatSync(stage.writableDirectory.path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    realpathSync(stage.writableDirectory.path) !==
      stage.writableDirectory.path ||
    String(metadata.dev) !== stage.writableDirectory.device ||
    String(metadata.ino) !== stage.writableDirectory.inode ||
    readdirSync(stage.writableDirectory.path).length !== 0
  ) {
    throw new Error("Collector writable stage directory is no longer fresh");
  }
};

const actorForSlot = (
  manifest: NativeRouteManifest,
  slot: NativeReviewerSlot
) =>
  slot === "author"
    ? manifest.author
    : manifest.reviewers[slot === "reviewer-0" ? 0 : 1];

const publicRuntimeIdentity = (
  manifestSha256: string,
  slots: readonly NativeReviewerSlot[],
  actors: readonly NativeRouteActor[]
) => ({
  billing: "subscription" as const,
  manifestSha256,
  reviewers: actors.map((actor, index) => ({
    cliVersion: actor.cliVersion,
    executableSha256: actor.executable.sha256,
    lineage: nativeActorLineage(actor),
    model: actor.model,
    provider: actor.provider,
    slot: slots[index],
  })),
  schemaVersion: 1 as const,
});

interface ContainedAiReviewDependencies {
  createBoundary: typeof createNativeCallBoundary;
  createFactory: typeof createConfiguredNativeFactory;
  invokeClaude: typeof reviewImages;
  invokeCodex: typeof reviewImagesWithCodex;
  now: () => number;
  readBoundary: typeof readNativeCallBoundary;
  readRoute: typeof readNativeRouteManifest;
  runCampaign: typeof runAiReviewCampaign;
}

const productionDependencies: ContainedAiReviewDependencies = {
  createBoundary: createNativeCallBoundary,
  createFactory: createConfiguredNativeFactory,
  invokeClaude: reviewImages,
  invokeCodex: reviewImagesWithCodex,
  now: Date.now,
  readBoundary: readNativeCallBoundary,
  readRoute: readNativeRouteManifest,
  runCampaign: runAiReviewCampaign,
};

export interface ContainedApiCollectorStageOptions {
  descriptorFile: string;
  descriptorSha256: string;
  evidenceDirectory: string;
  expectation: Omit<CollectorStageExpectation, "outputSha256">;
  journalFile: string;
  originalDeadlineAt: number;
  qualificationId: string;
  reservedMaxUsd: number;
  runId: string;
  sessionId: string;
  stageDeadlineAt: number;
  startedAt: number;
  stopFile: string;
}

const assertApiCollectorDescriptor = (
  options: ContainedApiCollectorStageOptions
) => {
  const descriptorBytes = readFileSync(options.descriptorFile);
  const descriptor = JSON.parse(descriptorBytes.toString("utf-8"));
  const frozen = options.expectation;
  if (
    digest(descriptorBytes) !== options.descriptorSha256 ||
    descriptor.requestId !== frozen.requestId ||
    descriptor.role !== frozen.role ||
    descriptor.instrumentHash !== frozen.instrumentHash ||
    descriptor.routeHash !== frozen.routeHash ||
    descriptor.originalDeadlineAt !== options.originalDeadlineAt ||
    descriptor.stageDeadlineAt !== options.stageDeadlineAt ||
    canonicalJson(descriptor.actor) !== canonicalJson(frozen.actor) ||
    canonicalJson(
      descriptor.orderedAttachments?.map(
        ({ name, sha256 }: { name: string; sha256: string }) => ({
          name,
          sha256,
        })
      )
    ) !== canonicalJson(frozen.orderedAttachments)
  ) {
    throw new Error("API collector descriptor differs from frozen stage");
  }
};

/**
 * One explicit prediction/panel stage; never relabel prospective craft.
 * Append the callback result to the provenance-owned qualification assembly
 * before returning: the runtime capability expires at callback exit. Pass
 * journalSha256 as expectedJournalSha256; the journal itself is not authority.
 */
export const runContainedApiCollectorStage = async <T>(
  input: ContainedApiCollectorStageOptions,
  consume: (result: {
    capability: ApiCollectorStageCapability;
    evidence: CollectorApiTransportExpectation;
    journalFile: string;
    journalSha256: string;
    promptSha256: string;
    runId: string;
    stageId: string;
  }) => T | Promise<T>
) => {
  const options = { ...input, expectation: structuredClone(input.expectation) };
  const allowed = new Set([
    "descriptorFile",
    "descriptorSha256",
    "evidenceDirectory",
    "expectation",
    "journalFile",
    "originalDeadlineAt",
    "qualificationId",
    "reservedMaxUsd",
    "runId",
    "sessionId",
    "stageDeadlineAt",
    "startedAt",
    "stopFile",
  ]);
  if (
    Object.keys(options).some((key) => !allowed.has(key)) ||
    !["prediction", "panel"].includes(options.expectation.role) ||
    options.expectation.evidenceMode !== "images" ||
    options.expectation.subject !== undefined ||
    !options.expectation.instrumentHash ||
    [
      options.qualificationId,
      options.sessionId,
      options.runId,
      options.expectation.id,
      options.expectation.nativeStage,
    ].some((value) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/u.test(value)) ||
    !path.isAbsolute(options.journalFile) ||
    existsSync(options.journalFile)
  ) {
    throw new Error("Invalid or reused API collector stage assembly");
  }
  const journalRoot = realpathSync(path.dirname(options.journalFile));
  if (
    !lstatSync(journalRoot).isDirectory() ||
    journalRoot !== path.dirname(options.journalFile)
  ) {
    throw new Error("API collector journal root must be a canonical directory");
  }
  const inside = (file: string) => {
    const relative = path.relative(journalRoot, file);
    return (
      relative !== "" &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative)
    );
  };
  if (
    !inside(assertRegularFile(options.descriptorFile)) ||
    !inside(path.resolve(options.evidenceDirectory))
  ) {
    throw new Error(
      "API collector evidence must remain within its journal root"
    );
  }
  assertApiCollectorDescriptor(options);
  return await runApiCollectorStage(
    {
      descriptorFile: options.descriptorFile,
      descriptorSha256: options.descriptorSha256,
      evidenceDirectory: options.evidenceDirectory,
      reservedMaxUsd: options.reservedMaxUsd,
      startedAt: options.startedAt,
      stopFile: options.stopFile,
    },
    async (capability, sealed) => {
      const expectation = {
        ...options.expectation,
        outputSha256: sealed.outputSha256,
      };
      if (canonicalJson(sealed.actor) !== canonicalJson(expectation.actor)) {
        throw new Error("API collector actor changed after dispatch");
      }
      // Journaling conveys no authority; the qualifier consumes the live proof once.
      if (sealed.transportAuthority !== "installed-production-transport") {
        throw new Error(
          "Offline API transport cannot enter the live collector"
        );
      }
      const evidence = Object.fromEntries(
        Object.entries(sealed.evidence).map(([name, binding]) => {
          const retained = collectorBinding(journalRoot, binding.file);
          if (retained.sha256 !== binding.sha256) {
            throw new Error("API collector evidence changed during assembly");
          }
          return [name, retained];
        })
      );
      writeCollectorFile(
        options.journalFile,
        Buffer.from(
          `${JSON.stringify(
            {
              kind: "collector-bound-api-stage-journal-v1",
              originalDeadlineAt: options.originalDeadlineAt,
              qualificationId: options.qualificationId,
              sessionId: options.sessionId,
              stages: [
                {
                  evidence,
                  expectation,
                  id: expectation.id,
                  kind: "collector-api-transport-stage-v1",
                  stageDeadlineAt: options.stageDeadlineAt,
                },
              ],
            },
            null,
            2
          )}\n`
        )
      );
      return await consume({
        capability,
        evidence: {
          kind: "collector-api-transport-expectation-v1",
          originalDeadlineAt: options.originalDeadlineAt,
          qualificationId: options.qualificationId,
          sessionId: options.sessionId,
          stages: [
            {
              expectation,
              id: expectation.id,
              stageDeadlineAt: options.stageDeadlineAt,
            },
          ],
        },
        journalFile: options.journalFile,
        journalSha256: digest(readFileSync(options.journalFile)),
        promptSha256: sealed.promptSha256,
        runId: options.runId,
        stageId: expectation.id,
      });
    }
  );
};

export interface ContainedAiReviewOptions {
  deadlineAt: number;
  execute?: boolean;
  nativeRouteFile: string;
  nativeRouteSha256: string;
  out: string;
  packetFile: string;
  perReviewerMaxMs: number;
  requestId: string;
  reviewerSlots: readonly string[];
  stopFile?: string;
}

/** Dispatch one frozen packet to two independent contained native reviewers. */
// oxlint-disable-next-line eslint/complexity -- validation, freeze, resume and dispatch share one fail-closed boundary.
export const runContainedAiReview = async (
  options: ContainedAiReviewOptions,
  dependencies: ContainedAiReviewDependencies = productionDependencies
) => {
  const packetFile = assertRegularFile(path.resolve(options.packetFile));
  const nativeRouteFile = assertRegularFile(
    path.resolve(options.nativeRouteFile)
  );
  const out = path.resolve(options.out);
  const campaignResume = existsSync(path.join(out, "intent.json"));
  const { stopFile } = options;
  if (
    options.reviewerSlots.length !== 2 ||
    (stopFile !== undefined && !path.isAbsolute(stopFile)) ||
    new Set(options.reviewerSlots).size !== 2 ||
    options.reviewerSlots.some(
      (slot) => !NATIVE_REVIEWER_SLOTS.includes(slot as NativeReviewerSlot)
    ) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/u.test(options.requestId) ||
    !Number.isSafeInteger(options.deadlineAt) ||
    !Number.isSafeInteger(options.perReviewerMaxMs) ||
    options.perReviewerMaxMs <= 0 ||
    options.perReviewerMaxMs > 480_000 ||
    (!campaignResume &&
      options.deadlineAt - dependencies.now() < NATIVE_FINAL_RESERVE_MS)
  ) {
    throw new Error(
      "Contained AI review requires two bounded independent slots"
    );
  }
  const reviewerSlots = options.reviewerSlots as readonly [
    NativeReviewerSlot,
    NativeReviewerSlot,
  ];
  const verifiedRoute = dependencies.readRoute(
    nativeRouteFile,
    options.nativeRouteSha256
  );
  const actors = reviewerSlots.map((slot) =>
    actorForSlot(verifiedRoute.manifest, slot)
  );
  if (new Set(actors.map(nativeActorLineage)).size !== actors.length) {
    throw new Error("Contained AI review requires independent model lineages");
  }
  const packetDirectory = path.dirname(packetFile);
  const packet = JSON.parse(
    readFileSync(packetFile, "utf-8")
  ) as AiReviewCampaignInput;
  if (!Array.isArray(packet.stimuli)) {
    throw new TypeError("Contained AI review packet has no stimuli");
  }
  const attachmentFiles = packet.stimuli
    .flatMap((row) => [
      path.resolve(packetDirectory, row.image),
      ...row.familyReferences.map((file: string) =>
        path.resolve(packetDirectory, file)
      ),
    ])
    .map(assertRegularFile);
  const input: AiReviewCampaignInput = {
    ...packet,
    stimuli: packet.stimuli.map((row) => ({
      ...row,
      familyReferences: row.familyReferences.map((file: string) =>
        path.resolve(packetDirectory, file)
      ),
      image: path.resolve(packetDirectory, row.image),
    })),
  };
  const toolingFiles = [
    ...new Set(
      [
        ...productionTypeScript(import.meta.dirname),
        ...productionTypeScript(path.resolve(import.meta.dirname, "../src")),
        path.resolve(import.meta.dirname, "../../../package-lock.json"),
        path.resolve(import.meta.dirname, "../package.json"),
        packetFile,
        nativeRouteFile,
        ...attachmentFiles,
      ].map(assertRegularFile)
    ),
  ];
  const runtimeIdentity = publicRuntimeIdentity(
    options.nativeRouteSha256,
    reviewerSlots,
    actors
  );
  const verifyRuntime = () => {
    const current = dependencies.readRoute(
      nativeRouteFile,
      options.nativeRouteSha256
    );
    const currentActors = reviewerSlots.map((slot) =>
      actorForSlot(current.manifest, slot)
    );
    if (
      JSON.stringify(
        publicRuntimeIdentity(current.hash, reviewerSlots, currentActors)
      ) !== JSON.stringify(runtimeIdentity)
    ) {
      throw new Error("Contained AI review runtime identity changed");
    }
    return runtimeIdentity;
  };
  const factories: { current?: readonly NativeCallContainerFactory[] } = {};
  let nextOrdinal = 0;
  const routeCalls = [0, 0];
  const routes: AiReviewRoute[] = actors.map((actor, routeIndex) => ({
    command: actor.executable.path,
    id: reviewerSlots[routeIndex] ?? "invalid-slot",
    invoke: async (request) => {
      const callIndex = routeCalls[routeIndex] ?? 0;
      const stage = path.basename(request.out);
      const expectedStage = callIndex === 0 ? "recognition" : "craft";
      const factory = factories.current?.[routeIndex];
      if (!factory || callIndex > 1 || stage !== expectedStage) {
        throw new Error("Contained AI review stage order changed");
      }
      routeCalls[routeIndex] = callIndex + 1;
      const nativeCall = {
        containerFactory: factory,
        ordinal: nextOrdinal,
        parentDeadlineAt: options.deadlineAt,
        runtimeCwd: path.join(
          `${out}.native-runtime`,
          `${reviewerSlots[routeIndex]}-${stage}`
        ),
        stageKind: `${reviewerSlots[routeIndex]}-${stage}`,
      };
      nextOrdinal += 1;
      return actor.provider === "codex"
        ? await dependencies.invokeCodex({
            ...request,
            command: actor.executable.path,
            maxStageMs: options.perReviewerMaxMs,
            model: actor.model,
            nativeCall,
          })
        : await dependencies.invokeClaude({
            ...request,
            command: actor.executable.path,
            effort: actor.effort,
            maxStageMs: options.perReviewerMaxMs,
            nativeCall,
          });
    },
    model: actor.model,
  }));
  const campaignOptions = {
    execute: false,
    input,
    maxPackets: 1,
    originalDeadlineAt: options.deadlineAt,
    out,
    perReviewerMaxMs: options.perReviewerMaxMs,
    routes,
    runtimeIdentity,
    stopFile,
    toolingFiles,
    verifyRuntime,
  };
  const frozen = await dependencies.runCampaign(campaignOptions);
  if (options.execute !== true) {
    return frozen;
  }
  const runtimeRoot = `${out}.native-runtime`;
  const control = path.join(out, "native-control");
  const boundaryDirectory = path.join(control, "calls");
  let reservationHash: string;
  if (existsSync(runtimeRoot) || existsSync(control)) {
    if (!existsSync(runtimeRoot) || !existsSync(boundaryDirectory)) {
      throw new Error("Contained AI review resume state is incomplete");
    }
    const launch = JSON.parse(
      readFileSync(
        assertRegularFile(path.join(control, "launch.json")),
        "utf-8"
      )
    ) as {
      deadlineAt?: number;
      intentHash?: string;
      maxCalls?: number;
      nativeRouteSha256?: string;
      requestId?: string;
      reservationHash?: string;
      reviewerSlots?: unknown;
    };
    if (
      !launch.reservationHash ||
      launch.deadlineAt !== options.deadlineAt ||
      launch.intentHash !== frozen.intentHash ||
      launch.maxCalls !== NATIVE_REVIEW_CALLS ||
      launch.nativeRouteSha256 !== options.nativeRouteSha256 ||
      launch.requestId !== options.requestId ||
      JSON.stringify(launch.reviewerSlots) !== JSON.stringify(reviewerSlots)
    ) {
      throw new Error(
        "Contained AI review launch identity is missing or changed"
      );
    }
    const reopened = dependencies.readBoundary(
      boundaryDirectory,
      launch.reservationHash
    );
    if (
      reopened.reservation.deadlineAt !== options.deadlineAt ||
      reopened.reservation.maxCalls !== NATIVE_REVIEW_CALLS ||
      reopened.reservation.minimumCallReserveMs !== NATIVE_FINAL_RESERVE_MS ||
      reopened.reservation.reservationId !== options.requestId ||
      reopened.reservation.routeHash !== options.nativeRouteSha256 ||
      reopened.reservation.campaignStopFile !== stopFile ||
      reopened.stopped
    ) {
      throw new Error("Contained AI review reservation cannot resume");
    }
    ({ reservationHash } = reopened);
    nextOrdinal = reopened.calls.length;
  } else {
    mkdirSync(runtimeRoot, { mode: 0o700 });
    mkdirSync(control, { mode: 0o700 });
    reservationHash = dependencies.createBoundary(boundaryDirectory, {
      billing: "subscription",
      ...(stopFile ? { campaignStopFile: stopFile } : {}),
      deadlineAt: options.deadlineAt,
      maxCalls: NATIVE_REVIEW_CALLS,
      minimumCallReserveMs: NATIVE_FINAL_RESERVE_MS,
      reservationId: options.requestId,
      routeHash: options.nativeRouteSha256,
    });
    writeFileSync(
      path.join(control, "launch.json"),
      `${JSON.stringify(
        {
          deadlineAt: options.deadlineAt,
          intentHash: frozen.intentHash,
          maxCalls: NATIVE_REVIEW_CALLS,
          nativeRouteSha256: options.nativeRouteSha256,
          requestId: options.requestId,
          reservationHash,
          reviewerSlots,
        },
        null,
        2
      )}\n`,
      { flag: "wx", mode: 0o600 }
    );
  }
  factories.current = actors.map((actor, index) => {
    const evidenceDirectory = path.join(
      control,
      reviewerSlots[index] ?? "invalid-slot"
    );
    if (!existsSync(evidenceDirectory)) {
      mkdirSync(evidenceDirectory, { mode: 0o700 });
    }
    return dependencies.createFactory({
      actor,
      boundaryDirectory,
      deadlineAt: options.deadlineAt,
      evidenceDirectory,
      manifest: verifiedRoute.manifest,
      requestId: options.requestId,
      reservationHash,
      runtimeRoot,
    });
  });
  return await dependencies.runCampaign({ ...campaignOptions, execute: true });
};

interface ContainedProspectiveDependencies {
  createBoundary: typeof createNativeCallBoundary;
  createFactory: typeof createConfiguredNativeFactory;
  invokeClaude: typeof reviewImages;
  invokeCodex: typeof reviewImagesWithCodex;
  now: () => number;
  readBoundary: typeof readNativeCallBoundary;
  readRoute: typeof readNativeRouteManifest;
  runCampaign: typeof runProspectiveAiReviewCampaign;
}

const prospectiveDependencies: ContainedProspectiveDependencies = {
  createBoundary: createNativeCallBoundary,
  createFactory: createConfiguredNativeFactory,
  invokeClaude: reviewImages,
  invokeCodex: reviewImagesWithCodex,
  now: Date.now,
  readBoundary: readNativeCallBoundary,
  readRoute: readNativeRouteManifest,
  runCampaign: runProspectiveAiReviewCampaign,
};

export interface ContainedProspectiveAiReviewOptions {
  expectedAdjudicatorModel: string;
  expectedRecognizerModel: string;
  adjudicatorSlot: string;
  deadlineAt: number;
  execute?: boolean;
  forbiddenHostRoots?: readonly string[];
  nativeRouteFile: string;
  nativeRouteSha256: string;
  out: string;
  packetFile: string;
  perRouteMaxMs: number;
  recognizerSlot: string;
  requestId: string;
  stopFile?: string;
  synonymKeyFile: string;
  synonymKeySha256: string;
}

type ProspectiveRequest = Parameters<ProspectiveProtocolReviewer>[0];

/**
 * Execute one fresh, diagnostic-only free-recognition route. Any existing
 * output or control state is an ambiguous prior attempt and is never resumed.
 */
// Exact freeze, native accounting and three role-specific calls share one boundary.
// oxlint-disable-next-line eslint/complexity
export const runContainedProspectiveAiReview = async (
  options: ContainedProspectiveAiReviewOptions,
  dependencies: ContainedProspectiveDependencies = prospectiveDependencies
) => {
  const out = path.resolve(options.out);
  const runtimeRoot = `${out}.native-runtime`;
  const control = `${out}.native-control`;
  if (existsSync(out) || existsSync(runtimeRoot) || existsSync(control)) {
    throw new Error(
      "Prospective contained review refuses every existing output; stage resume is not implemented"
    );
  }
  const packetFile = assertRegularFile(path.resolve(options.packetFile));
  const synonymKeyFile = assertRegularFile(
    path.resolve(options.synonymKeyFile)
  );
  const nativeRouteFile = assertRegularFile(
    path.resolve(options.nativeRouteFile)
  );
  const { stopFile } = options;
  const slots = [options.recognizerSlot, options.adjudicatorSlot];
  if (
    slots.some(
      (slot) => !NATIVE_REVIEWER_SLOTS.includes(slot as NativeReviewerSlot)
    ) ||
    new Set(slots).size !== 2 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/u.test(options.requestId) ||
    !Number.isSafeInteger(options.deadlineAt) ||
    options.deadlineAt - dependencies.now() <= NATIVE_FINAL_RESERVE_MS ||
    !Number.isSafeInteger(options.perRouteMaxMs) ||
    options.perRouteMaxMs <= 0 ||
    options.perRouteMaxMs > 480_000 ||
    !/^[a-f0-9]{64}$/u.test(options.synonymKeySha256) ||
    digest(readFileSync(synonymKeyFile)) !== options.synonymKeySha256 ||
    (stopFile !== undefined && !path.isAbsolute(stopFile))
  ) {
    throw new Error(
      "Prospective contained review requires one bounded independent recognizer and adjudicator"
    );
  }
  const reviewerSlots = [
    slots[0] as NativeReviewerSlot,
    slots[1] as NativeReviewerSlot,
  ] as const;
  const verifiedRoute = dependencies.readRoute(
    nativeRouteFile,
    options.nativeRouteSha256
  );
  const actors = [
    actorForSlot(verifiedRoute.manifest, reviewerSlots[0]),
    actorForSlot(verifiedRoute.manifest, reviewerSlots[1]),
  ] as const;
  if (
    actors[0].model !== options.expectedRecognizerModel ||
    actors[1].model !== options.expectedAdjudicatorModel
  ) {
    throw new Error(
      "Prospective selected-slot model differs from explicit experiment intent"
    );
  }
  const lineages = actors.map(nativeActorLineage);
  if (lineages[0] === lineages[1]) {
    throw new Error(
      "Prospective contained review requires independent emitted lineages"
    );
  }
  const executionSupport = actors.every(({ provider }) => provider === "codex")
    ? ({ executable: true } as const)
    : ({
        executable: false,
        reason:
          "Same-container access evidence is implemented only for the contained Codex route",
      } as const);
  const packetDirectory = path.dirname(packetFile);
  const packet = JSON.parse(
    readFileSync(packetFile, "utf-8")
  ) as AiReviewCampaignInput;
  if (
    !Array.isArray(packet.stimuli) ||
    packet.stimuli.some((row) => row.meanings.length !== 0)
  ) {
    throw new Error(
      "Prospective contained packet must omit recognition alternatives"
    );
  }
  const attachmentFiles = packet.stimuli
    .flatMap((row) => [
      path.resolve(packetDirectory, row.image),
      ...row.familyReferences.map((file: string) =>
        path.resolve(packetDirectory, file)
      ),
    ])
    .map(assertRegularFile);
  const input: AiReviewCampaignInput = {
    ...packet,
    stimuli: packet.stimuli.map((row) => ({
      ...row,
      familyReferences: row.familyReferences.map((file: string) =>
        path.resolve(packetDirectory, file)
      ),
      image: path.resolve(packetDirectory, row.image),
      meanings: [],
    })),
  };
  const synonymKey = JSON.parse(
    readFileSync(synonymKeyFile, "utf-8")
  ) as SynonymKeyRow[];
  if (!Array.isArray(synonymKey)) {
    throw new TypeError("Prospective synonym key must be an array");
  }
  const toolingFiles = [
    ...new Set(
      [
        ...productionTypeScript(import.meta.dirname),
        ...productionTypeScript(path.resolve(import.meta.dirname, "../src")),
        path.resolve(import.meta.dirname, "../../../package-lock.json"),
        path.resolve(import.meta.dirname, "../package.json"),
        packetFile,
        synonymKeyFile,
        nativeRouteFile,
        ...attachmentFiles,
      ].map(assertRegularFile)
    ),
  ];
  const toolingIdentity = () =>
    Object.fromEntries(
      toolingFiles.toSorted().map((file) => [file, digest(readFileSync(file))])
    );
  const frozenTooling = toolingIdentity();
  const runtimeIdentity = {
    ...publicRuntimeIdentity(options.nativeRouteSha256, reviewerSlots, actors),
    roles: {
      adjudicator: reviewerSlots[1],
      recognizer: reviewerSlots[0],
    },
  };
  const verifyRuntime = () => {
    const current = dependencies.readRoute(
      nativeRouteFile,
      options.nativeRouteSha256
    );
    const currentActors = reviewerSlots.map((slot) =>
      actorForSlot(current.manifest, slot)
    );
    const currentIdentity = {
      ...publicRuntimeIdentity(current.hash, reviewerSlots, currentActors),
      roles: runtimeIdentity.roles,
    };
    if (
      JSON.stringify(currentIdentity) !== JSON.stringify(runtimeIdentity) ||
      JSON.stringify(toolingIdentity()) !== JSON.stringify(frozenTooling) ||
      digest(readFileSync(synonymKeyFile)) !== options.synonymKeySha256
    ) {
      throw new Error("Prospective contained runtime or frozen inputs changed");
    }
    return runtimeIdentity;
  };
  verifyRuntime();
  const campaignOptions = {
    execute: options.execute,
    input,
    originalDeadlineAt: options.deadlineAt,
    out,
    perReviewerMaxMs: options.perRouteMaxMs,
    synonymKey,
    toolingFiles,
  };
  if (options.execute !== true) {
    const frozen = await dependencies.runCampaign({
      ...campaignOptions,
      execute: false,
      routes: [
        {
          adjudicator: {
            baseModelLineage: lineages[1],
            command: actors[1].executable.path,
            id: `${reviewerSlots[1]}-adjudicator`,
            invoke: () => {
              throw new Error("Dry-run prospective route cannot invoke");
            },
            model: actors[1].model,
          },
          baseModelLineage: lineages[0],
          command: actors[0].executable.path,
          id: `${reviewerSlots[0]}-recognizer`,
          invoke: () => {
            throw new Error("Dry-run prospective route cannot invoke");
          },
          model: actors[0].model,
        },
      ],
    });
    return {
      ...frozen,
      executionSupport,
      productionSealEligible: false as const,
      runtimeAccessRestrictionVerified: false as const,
    };
  }
  if (!executionSupport.executable) {
    throw new Error(executionSupport.reason);
  }

  mkdirSync(runtimeRoot, { mode: 0o700 });
  mkdirSync(control, { mode: 0o700 });
  const boundaryDirectory = path.join(control, "calls");
  const reservationHash = dependencies.createBoundary(boundaryDirectory, {
    billing: "subscription",
    ...(stopFile ? { campaignStopFile: stopFile } : {}),
    deadlineAt: options.deadlineAt,
    maxCalls: NATIVE_PROSPECTIVE_CALLS,
    minimumCallReserveMs: NATIVE_FINAL_RESERVE_MS,
    reservationId: options.requestId,
    routeHash: options.nativeRouteSha256,
  });
  const controlSentinel = path.join(control, "forbidden-control-sentinel");
  writeCollectorFile(
    controlSentinel,
    `iconsmith-forbidden-control-sentinel-v1:${options.requestId}\n`
  );
  const accessPolicy = freezeCollectorPreDispatchAccessPolicy({
    actors,
    controlDirectory: control,
    forbiddenHostRoots: [
      packetFile,
      synonymKeyFile,
      nativeRouteFile,
      controlSentinel,
      ...(options.forbiddenHostRoots ?? []),
    ],
    originalDeadlineAt: options.deadlineAt,
    qualificationId: options.requestId,
    reservationHash,
    routeHash: options.nativeRouteSha256,
    routeManifest: verifiedRoute.manifest,
    runtimeRoot,
  });
  const launch = {
    accessPolicySha256: accessPolicy.sha256,
    accessSessionId: accessPolicy.policy.sessionId,
    authority: "AI diagnostic only",
    deadlineAt: options.deadlineAt,
    maxCalls: NATIVE_PROSPECTIVE_CALLS,
    nativeRouteSha256: options.nativeRouteSha256,
    packetSha256: digest(readFileSync(packetFile)),
    productionSealEligible: false,
    requestId: options.requestId,
    reservationHash,
    roles: runtimeIdentity.roles,
    runtimeAccessRestrictionVerified: false,
    synonymKeySha256: options.synonymKeySha256,
    toolingIdentity: frozenTooling,
  };
  writeFileSync(
    path.join(control, "launch.json"),
    `${JSON.stringify(launch, null, 2)}\n`,
    { flag: "wx", flush: true, mode: 0o600 }
  );
  const evidenceDirectories = actors.map((_, index) =>
    path.join(control, index === 0 ? "recognizer" : "adjudicator")
  );
  const factories = actors.map((actor, index) => {
    const evidenceDirectory = evidenceDirectories[index];
    mkdirSync(evidenceDirectory, { mode: 0o700 });
    return dependencies.createFactory({
      actor,
      boundaryDirectory,
      deadlineAt: options.deadlineAt,
      evidenceDirectory,
      manifest: verifiedRoute.manifest,
      requestId: options.requestId,
      reservationHash,
      runtimeRoot,
    });
  });
  const collectorStages: {
    accessBinding: SameContainerAccessBinding;
    actorIndex: 0 | 1;
    evidenceMode: "images" | "sealed-text";
    nativeStage: string;
    orderedAttachments: { name: string; sha256: string }[];
    out: string;
    response: ProspectiveProtocolReview;
  }[] = [];
  const completedStages: string[] = [];
  const stopped = () => stopFile !== undefined && existsSync(stopFile);
  const verifyJournal = () => {
    const boundary = dependencies.readBoundary(
      boundaryDirectory,
      reservationHash
    );
    const callsByStage = new Map(
      boundary.calls.map((call) => [call.stage, call] as const)
    );
    const orderedCalls = completedStages.map((stage) =>
      callsByStage.get(stage)
    );
    if (
      boundary.reservation.deadlineAt !== options.deadlineAt ||
      boundary.reservation.maxCalls !== NATIVE_PROSPECTIVE_CALLS ||
      boundary.reservation.reservationId !== options.requestId ||
      boundary.reservation.routeHash !== options.nativeRouteSha256 ||
      boundary.reservation.campaignStopFile !== stopFile ||
      boundary.calls.length !== completedStages.length ||
      callsByStage.size !== boundary.calls.length ||
      orderedCalls.some(
        (call, index) =>
          !call ||
          call.requestId !== options.requestId ||
          call.stage !== completedStages[index] ||
          call.deadlineAt !== options.deadlineAt ||
          !Number.isSafeInteger(call.dispatchedAt) ||
          (index > 0 &&
            call.dispatchedAt <=
              (orderedCalls[index - 1]?.dispatchedAt ??
                Number.MAX_SAFE_INTEGER))
      )
    ) {
      throw new Error(
        "Prospective native call journal changed or is unsettled"
      );
    }
    return boundary;
  };
  const invokeActor = async (
    actorIndex: 0 | 1,
    ordinal: number,
    stage: "recognition" | "adjudication" | "craft",
    request: ProspectiveRequest
  ) => {
    const evidenceMode = stage === "adjudication" ? "sealed-text" : "images";
    if (
      path.basename(request.out) !== stage ||
      (evidenceMode === "sealed-text") !==
        (Object.keys(request.images).length === 0) ||
      stopped()
    ) {
      throw new Error(
        "Prospective native stage role, evidence or STOP changed"
      );
    }
    verifyRuntime();
    const actor = actors[actorIndex];
    const stageKind = `${actorIndex === 0 ? "recognizer" : "adjudicator"}-${stage}`;
    const nativeStage = `${String(ordinal).padStart(2, "0")}-${stageKind}`;
    assertFreshCollectorStage(accessPolicy, nativeStage);
    const stageAccess = accessPolicy.policy.stages.find(
      ({ id }) => id === nativeStage
    );
    if (!stageAccess) {
      throw new Error("Prospective native stage lacks an access policy");
    }
    const accessProbe: SameContainerAccessProbe = {
      observe: (observation, identity, security) =>
        Promise.resolve(
          sealCollectorSameContainerAccessReceipt({
            controlDirectory: evidenceDirectories[actorIndex],
            expectedImage: verifiedRoute.manifest.image,
            identity,
            observation,
            plan: stageAccess.sameContainerAccessProbe,
            security,
          })
        ),
      plan: stageAccess.sameContainerAccessProbe,
    };
    let allocation: NativeCallContainerAllocation | undefined;
    const containerFactory: NativeCallContainerFactory = {
      create: (factoryRequest) => {
        if (allocation) {
          throw new Error("Prospective native stage allocated more than once");
        }
        allocation = factories[actorIndex].create(factoryRequest);
        return allocation;
      },
    };
    const nativeCall = {
      accessProbe,
      containerFactory,
      ordinal,
      parentDeadlineAt: options.deadlineAt,
      runtimeCwd: path.join(runtimeRoot, stageKind),
      stageKind,
    };
    const maximumMs = request.deadlineAt - dependencies.now();
    if (maximumMs <= 0 || maximumMs > options.perRouteMaxMs) {
      throw new Error("Prospective native stage deadline changed");
    }
    const response =
      actor.provider === "codex"
        ? await dependencies.invokeCodex({
            ...request,
            command: actor.executable.path,
            evidenceMode,
            maxStageMs: maximumMs,
            model: actor.model,
            nativeCall,
            reviewProfile: actor.reviewProfile,
          })
        : await dependencies.invokeClaude({
            ...request,
            command: actor.executable.path,
            effort: actor.effort,
            evidenceMode,
            maxStageMs: maximumMs,
            nativeCall,
          });
    completedStages.push(nativeStage);
    const boundary = verifyJournal();
    verifyRuntime();
    if (
      boundary.stopped ||
      stopped() ||
      response.evidenceMode !== evidenceMode ||
      (response.status === "complete" &&
        response.baseModelLineage !== lineages[actorIndex])
    ) {
      throw new Error(
        "Prospective native stage stopped or emitted the wrong lineage"
      );
    }
    const prospectiveResponse: ProspectiveProtocolReview = {
      ...response,
      baseModelLineage: response.baseModelLineage ?? null,
    };
    if (!allocation) {
      throw new Error(
        "Prospective native stage did not allocate its container"
      );
    }
    const accessBinding = allocation.accessProbeBinding();
    collectorStages.push({
      accessBinding,
      actorIndex,
      evidenceMode,
      nativeStage: completedStages.at(-1) as string,
      orderedAttachments: Object.entries(request.images).map(
        ([name, bytes]) => ({ name, sha256: digest(bytes) })
      ),
      out: request.out,
      response: prospectiveResponse,
    });
    return prospectiveResponse;
  };
  const recognizer: ProspectiveAiReviewRoute = {
    adjudicator: {
      baseModelLineage: lineages[1],
      command: actors[1].executable.path,
      id: `${reviewerSlots[1]}-adjudicator`,
      invoke: (request) => invokeActor(1, 1, "adjudication", request),
      model: actors[1].model,
    },
    baseModelLineage: lineages[0],
    command: actors[0].executable.path,
    id: `${reviewerSlots[0]}-recognizer`,
    invoke: (request) =>
      invokeActor(
        0,
        completedStages.length === 0 ? 0 : 2,
        completedStages.length === 0 ? "recognition" : "craft",
        request
      ),
    model: actors[0].model,
  };
  const result = await dependencies.runCampaign({
    ...campaignOptions,
    execute: true,
    routes: [recognizer],
  });
  const finalBoundary = verifyJournal();
  if (!result.outcomes) {
    throw new Error("Executed prospective campaign returned no outcomes");
  }
  const complete = result.outcomes.every(
    (outcome) => outcome.status === "complete"
  );
  if (
    complete &&
    (completedStages.length !== NATIVE_PROSPECTIVE_CALLS ||
      finalBoundary.stopped)
  ) {
    throw new Error("Prospective complete result lacks three settled calls");
  }
  let collectorAccessJournal: {
    accessPolicySha256: string;
    file: string;
    productionEligible: false;
    sessionId: string;
    sha256: string;
  } | null = null;
  if (complete && actors.every(({ provider }) => provider === "codex")) {
    if (
      collectorStages.length !== NATIVE_PROSPECTIVE_CALLS ||
      new Set(collectorStages.map(({ nativeStage }) => nativeStage)).size !==
        NATIVE_PROSPECTIVE_CALLS
    ) {
      throw new Error("Collector stage evidence is missing or duplicated");
    }
    const collectorDirectory = path.join(control, "collector");
    mkdirSync(collectorDirectory, { mode: 0o700 });
    const calls = new Map(
      finalBoundary.calls.map((call) => [call.stage, call] as const)
    );
    const stages = collectorStages.map((stage) => {
      const call = calls.get(stage.nativeStage);
      const actor = actors[stage.actorIndex];
      if (
        !call ||
        call.deadlineAt !== options.deadlineAt ||
        call.requestId !== options.requestId ||
        call.routeHash !== options.nativeRouteSha256 ||
        stage.response.status !== "complete" ||
        stage.response.model !== actor.model ||
        stage.response.baseModelLineage !== lineages[stage.actorIndex]
      ) {
        throw new Error("Collector call, stage or model identity mismatch");
      }
      const adapterRequestSource = assertRegularFile(
        path.join(stage.out, "request.json")
      );
      const adapterResultSource = assertRegularFile(
        path.join(stage.out, "review.json")
      );
      const adapterRequestBytes = readFileSync(adapterRequestSource);
      const request = JSON.parse(adapterRequestBytes.toString("utf-8"));
      const adapterResultBytes = readFileSync(adapterResultSource);
      const adapterResult = JSON.parse(adapterResultBytes.toString("utf-8"));
      const expectedHashes = Object.fromEntries(
        stage.orderedAttachments.map(({ name, sha256 }) => [name, sha256])
      );
      if (
        request.status !== "running" ||
        request.evidenceMode !== stage.evidenceMode ||
        JSON.stringify(request.evidenceHashes) !==
          JSON.stringify(expectedHashes) ||
        adapterResult.status !== "complete" ||
        adapterResult.model !== actor.model ||
        adapterResult.baseModelLineage !== lineages[stage.actorIndex] ||
        adapterResult.evidenceMode !== stage.evidenceMode ||
        JSON.stringify(adapterResult.evidenceHashes) !==
          JSON.stringify(expectedHashes) ||
        canonicalJson(adapterResult) !== canonicalJson(stage.response)
      ) {
        throw new Error("Collector adapter evidence identity mismatch");
      }
      const stageDirectory = path.join(collectorDirectory, stage.nativeStage);
      mkdirSync(stageDirectory, { mode: 0o700 });
      const requestCopy = path.join(stageDirectory, "adapter-request.json");
      const resultCopy = path.join(stageDirectory, "adapter-result.json");
      writeCollectorFile(requestCopy, adapterRequestBytes);
      writeCollectorFile(resultCopy, adapterResultBytes);
      const actorEvidence = path.join(
        control,
        stage.actorIndex === 0 ? "recognizer" : "adjudicator",
        stage.nativeStage
      );
      const binding = (file: string) => collectorBinding(control, file);
      const resultBinding = binding(resultCopy);
      let role: "adjudication" | "craft" | "recognition" = "craft";
      if (stage.nativeStage.endsWith("-recognition")) {
        role = "recognition";
      } else if (stage.nativeStage.endsWith("-adjudication")) {
        role = "adjudication";
      }
      return {
        adapterRequest: binding(requestCopy),
        adapterResult: resultBinding,
        adapterTrace: binding(path.join(actorEvidence, "adapter-trace.jsonl")),
        containerCreateRequest: binding(
          path.join(actorEvidence, "container-create-request.json")
        ),
        containerDescriptor: binding(
          path.join(actorEvidence, "container-descriptor.json")
        ),
        containerIdentity: binding(
          path.join(actorEvidence, "container-identity.json")
        ),
        containerInspectResult: binding(
          path.join(actorEvidence, "container-inspect-result.json")
        ),
        containerSettlement: binding(
          path.join(actorEvidence, "container-settlement.json")
        ),
        expectation: {
          actor: {
            baseModelLineage: lineages[stage.actorIndex],
            model: actor.model,
            provider: "openai-codex",
          },
          evidenceMode: stage.evidenceMode,
          id: stage.nativeStage,
          nativeStage: stage.nativeStage,
          orderedAttachments: stage.orderedAttachments,
          outputSha256: resultBinding.sha256,
          requestId: options.requestId,
          role,
          routeHash: options.nativeRouteSha256,
        },
        id: stage.nativeStage,
        nativeIntent: binding(
          path.join(boundaryDirectory, `${call.callId}.intent.json`)
        ),
        nativeStarted: binding(
          path.join(boundaryDirectory, `${call.callId}.started.json`)
        ),
        nativeTerminal: binding(
          path.join(boundaryDirectory, `${call.callId}.terminal.json`)
        ),
        sameContainerAccess: {
          ackSha256: stage.accessBinding.ackSha256,
          containerId: stage.accessBinding.containerId,
          kind: stage.accessBinding.kind,
          nonceSha256: stage.accessBinding.nonceSha256,
          observationSha256: stage.accessBinding.observationSha256,
          planSha256: stage.accessBinding.planSha256,
          receipt: binding(stage.accessBinding.receiptFile),
          securityInspect: binding(stage.accessBinding.securityInspectFile),
          stageId: stage.accessBinding.stageId,
        },
      };
    });
    const journalFile = path.join(control, "collector-access-journal.json");
    const journalBytes = `${JSON.stringify(
      {
        accessPolicy: collectorBinding(control, accessPolicy.file),
        kind: "collector-bound-stage-access-journal-v4",
        originalDeadlineAt: options.deadlineAt,
        qualificationId: options.requestId,
        reservationHash,
        sessionId: accessPolicy.policy.sessionId,
        stages,
      },
      null,
      2
    )}\n`;
    writeCollectorFile(journalFile, journalBytes);
    collectorAccessJournal = {
      accessPolicySha256: accessPolicy.sha256,
      file: journalFile,
      productionEligible: false,
      sessionId: accessPolicy.policy.sessionId,
      sha256: digest(Buffer.from(journalBytes)),
    };
  }
  return {
    ...result,
    collectorAccessJournal,
    nativeAccounting: {
      calls: completedStages.length,
      reservationHash,
      settled: true,
      stopped: finalBoundary.stopped,
    },
    productionSealEligible: false as const,
    runtimeAccessRestrictionVerified: false as const,
  };
};

const usage =
  "Usage: quality-campaign.ts prepare-development --base-revision FILE --corpus-manifest FILE --meanings FILE --out DIR [--concept-order CONCEPT...] | freeze catalog|development --out FILE | report --manifest FILE --results FILE | freeze-qualification --instrument FILE --roster FILE --out FILE | ingest-labels --provenance FILE --labels FILE... --predictions FILE [--out FILE] | ai-review --packet FILE --out DIR --native-route FILE --native-route-sha256 SHA256 --reviewer-slot SLOT --reviewer-slot SLOT --request-id ID --deadline-at EPOCH_MS [--per-reviewer-ms N] [--stop-file FILE] [--execute] | prospective-ai-review --packet FILE --synonym-key FILE --synonym-key-sha256 SHA256 --out FRESH_DIR --native-route FILE --native-route-sha256 SHA256 --recognizer-slot SLOT --adjudicator-slot SLOT --expected-recognizer-model MODEL --expected-adjudicator-model MODEL --request-id ID --deadline-at EPOCH_MS [--per-reviewer-ms N] [--stop-file FILE] [--execute] | assess-ai --campaign DIR --out FILE [--condition-key FILE --condition-key-sha256 SHA256]";

// oxlint-disable-next-line eslint/complexity -- one import-safe dispatcher retains the existing CLI actions.
export const runQualityCampaign = async (args: readonly string[]) => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args,
    options: {
      "adjudicator-slot": { type: "string" },
      "base-revision": { type: "string" },
      campaign: { type: "string" },
      "concept-order": { multiple: true, type: "string" },
      "condition-key": { type: "string" },
      "condition-key-sha256": { type: "string" },
      "corpus-manifest": { type: "string" },
      "deadline-at": { type: "string" },
      execute: { type: "boolean" },
      "expected-adjudicator-model": { type: "string" },
      "expected-recognizer-model": { type: "string" },
      instrument: { type: "string" },
      labels: { multiple: true, type: "string" },
      manifest: { type: "string" },
      meanings: { type: "string" },
      "native-route": { type: "string" },
      "native-route-sha256": { type: "string" },
      out: { type: "string" },
      packet: { type: "string" },
      "per-reviewer-ms": { type: "string" },
      predictions: { type: "string" },
      provenance: { type: "string" },
      "recognizer-slot": { type: "string" },
      "request-id": { type: "string" },
      results: { type: "string" },
      "reviewer-slot": { multiple: true, type: "string" },
      roster: { type: "string" },
      "stop-file": { type: "string" },
      "synonym-key": { type: "string" },
      "synonym-key-sha256": { type: "string" },
    },
  });
  const [action, kind] = positionals;
  if (
    action === "prepare-development" &&
    values["base-revision"] &&
    values["corpus-manifest"] &&
    values.meanings &&
    values.out
  ) {
    if (values.execute) {
      throw new Error("Input preparation cannot execute provider calls");
    }
    return prepareDevelopmentCampaignInputs({
      baseRevisionFile: values["base-revision"],
      conceptOrder: values["concept-order"],
      corpusManifestFile: values["corpus-manifest"],
      meaningsFile: values.meanings,
      out: values.out,
    });
  }
  if (action === "assess-ai" && values.campaign && values.out) {
    if (
      Boolean(values["condition-key"]) !==
      Boolean(values["condition-key-sha256"])
    ) {
      throw new Error(
        "AI calibration assessment requires both condition key path and SHA-256"
      );
    }
    return writeAiReviewAssessment(
      path.resolve(values.campaign),
      path.resolve(values.out),
      values["condition-key"] && values["condition-key-sha256"]
        ? {
            conditionKeyFile: path.resolve(values["condition-key"]),
            expectedConditionKeySha256: values["condition-key-sha256"],
          }
        : undefined
    );
  }
  if (
    action === "freeze" &&
    (kind === "catalog" || kind === "development") &&
    values.out
  ) {
    return writeCampaignManifest(
      values.out,
      kind,
      path.join(corpus, "manifest.json"),
      path.join(corpus, "icons.jsonl")
    );
  }
  if (action === "report" && values.manifest && values.results) {
    return reportCampaign(
      JSON.parse(readFileSync(values.manifest, "utf-8")),
      JSON.parse(readFileSync(values.results, "utf-8"))
    );
  }
  if (
    action === "freeze-qualification" &&
    values.out &&
    values.instrument &&
    values.roster
  ) {
    return freezeQualificationReceipt(
      values.out,
      values.instrument,
      values.roster
    );
  }
  if (
    action === "ingest-labels" &&
    values.provenance &&
    values.predictions &&
    values.labels?.length
  ) {
    const result = ingestHumanLabelFiles(
      values.provenance,
      values.labels,
      values.predictions
    );
    if (values.out) {
      writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`, {
        flag: "wx",
      });
    }
    return result;
  }
  if (
    action === "prospective-ai-review" &&
    values.packet &&
    values["synonym-key"] &&
    values["synonym-key-sha256"] &&
    values.out &&
    values["native-route"] &&
    values["native-route-sha256"] &&
    values["recognizer-slot"] &&
    values["adjudicator-slot"] &&
    values["expected-adjudicator-model"] &&
    values["expected-recognizer-model"] &&
    values["request-id"] &&
    values["deadline-at"]
  ) {
    return await runContainedProspectiveAiReview({
      adjudicatorSlot: values["adjudicator-slot"],
      deadlineAt: Number(values["deadline-at"]),
      execute: values.execute,
      expectedAdjudicatorModel: values["expected-adjudicator-model"],
      expectedRecognizerModel: values["expected-recognizer-model"],
      nativeRouteFile: values["native-route"],
      nativeRouteSha256: values["native-route-sha256"],
      out: values.execute ? values.out : `${values.out}.dry-run`,
      packetFile: values.packet,
      perRouteMaxMs: Number(values["per-reviewer-ms"] ?? "480000"),
      recognizerSlot: values["recognizer-slot"],
      requestId: values["request-id"],
      stopFile: values["stop-file"],
      synonymKeyFile: values["synonym-key"],
      synonymKeySha256: values["synonym-key-sha256"],
    });
  }
  if (
    action === "ai-review" &&
    values.packet &&
    values.out &&
    values["native-route"] &&
    values["native-route-sha256"] &&
    values["request-id"] &&
    values["deadline-at"] &&
    values["reviewer-slot"]
  ) {
    return await runContainedAiReview({
      deadlineAt: Number(values["deadline-at"]),
      execute: values.execute,
      nativeRouteFile: values["native-route"],
      nativeRouteSha256: values["native-route-sha256"],
      out: values.out,
      packetFile: values.packet,
      perReviewerMaxMs: Number(values["per-reviewer-ms"] ?? "480000"),
      requestId: values["request-id"],
      reviewerSlots: values["reviewer-slot"],
      stopFile: values["stop-file"],
    });
  }
  throw new Error(usage);
};

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  console.log(JSON.stringify(await runQualityCampaign(process.argv.slice(2))));
}

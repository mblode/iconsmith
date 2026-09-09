import { createHash } from "node:crypto";
import {
  mkdirSync,
  linkSync,
  mkdtempSync,
  lstatSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { ACCEPTANCE_CONTRACT_VERSION } from "../src/eval/acceptance-contract.js";
import { criticQualificationReadyForProduction } from "../src/eval/foundry-gate.js";
import {
  appendCollectorApiQualificationStage,
  createCollectorApiQualificationAssembly,
  qualifyCriticFromCollectorEvidence,
  qualifyCriticFromFrozenEvidence,
  validateCollectorBoundStageAccessEvidence,
  validateCollectorApiTransportStageEvidence,
  verifyProductionCriticReviewsFromCollectorEvidence,
} from "./ai-qualification-provenance.js";
import type {
  CollectorAccessExpectation,
  CollectorApiQualificationAssemblyCapability,
  CollectorApiTransportExpectation,
  FileBinding,
} from "./ai-qualification-provenance.js";
import type {
  AiCriticPrediction,
  AiPanelQualificationStimulus,
  IndependentAiPanelReview,
} from "./ai-qualification.js";
import {
  API_COLLECTOR_ROUTE_HASH,
  API_COLLECTOR_STAGE_ACTOR,
} from "./api-image-capability.js";
import type { VerifiedApiCollectorStageEvidence } from "./api-image-capability.js";

const apiStageAuthority = vi.hoisted(() => ({
  capability: undefined as unknown,
  expected: undefined as unknown,
  verified: undefined as unknown,
}));

vi.mock("./api-image-capability.js", async (importOriginal) => ({
  ...(await importOriginal()),
  withVerifiedApiCollectorStage: (
    capability: unknown,
    _expected: unknown,
    consume: (verified: unknown) => unknown
  ) => {
    if (
      capability !== apiStageAuthority.capability ||
      apiStageAuthority.verified === undefined
    ) {
      throw new Error("API collector capability is not live");
    }
    apiStageAuthority.capability = undefined;
    apiStageAuthority.expected = _expected;
    return consume(apiStageAuthority.verified);
  },
}));

const roots: string[] = [];
afterEach(() => {
  apiStageAuthority.capability = undefined;
  apiStageAuthority.expected = undefined;
  apiStageAuthority.verified = undefined;
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
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
const save = (root: string, file: string, value: unknown) => {
  const bytes = typeof value === "string" ? value : JSON.stringify(value);
  writeFileSync(path.join(root, file), bytes);
  return { file, sha256: sha(bytes) };
};
const prefixBinding = (
  root: string,
  binding: { file: string; sha256: string }
) => ({
  file: `${path.basename(root)}/${binding.file}`,
  sha256: binding.sha256,
});
const collectorCraftIds = (id: string) =>
  ["critical", "craft", "family", "native", "ship"].map(
    (suffix) => `${id}-${suffix}`
  );
const craftAnswer = (choice: string) => ({
  choice,
  evidence: "visible evidence",
  treatment: "",
});

const fixture = (familyCount = 100) => {
  const root = mkdtempSync(path.join(tmpdir(), "critic-provenance-"));
  roots.push(root);
  const attachmentA = save(root, "attachment-a.png", "attachment-a");
  const attachmentB = save(root, "attachment-b.png", "attachment-b");
  const canonical: AiPanelQualificationStimulus[] = Array.from(
    { length: 100 },
    (_, index) => {
      const artifact = save(
        root,
        `artifact-${index}.svg`,
        `<svg>${index}</svg>`
      );
      const source = save(root, `source-${index}.icon`, `source-${index}`);
      return {
        artifactHash: artifact.sha256,
        canonical: true,
        conceptId: `concept-${index}`,
        craftEvidenceHash: sha(`pending-craft-${index}`),
        defectClasses: index < 20 ? ["blocked-counter"] : [],
        familyId: `family-${index % familyCount}`,
        generationKind: "natural-generated",
        id: `canonical-${index}`,
        nativeSize: index % 2 === 0 ? 16 : 24,
        orderedAttachmentHashes: [attachmentA.sha256, attachmentB.sha256],
        paint: index % 4 < 2 ? "outlined" : "filled",
        producerEvidenceHash: sha(`pending-producer-${index}`),
        producerLineages: ["author-lineage"],
        recognitionEvidenceHash: sha(`pending-recognition-${index}`),
        requestedSlotId: `slot-${index}`,
        sealed: true,
        sourceLineageHash: sha(JSON.stringify([source.sha256])),
      };
    }
  );
  const controls: AiPanelQualificationStimulus[] = [
    {
      ...canonical[20],
      canonical: false,
      id: "identical-control",
      presentationOf: canonical[20].id,
      presentationOfArtifactHash: canonical[20].artifactHash,
      presentationOrder: "identical",
    },
    {
      ...canonical[21],
      canonical: false,
      id: "reversed-control",
      orderedAttachmentHashes: [attachmentB.sha256, attachmentA.sha256],
      presentationOf: canonical[21].id,
      presentationOfArtifactHash: canonical[21].artifactHash,
      presentationOrder: "reversed",
    },
  ];
  const stimuli = [...canonical, ...controls];
  const artifactBindings = stimuli.map((stimulus) => {
    const canonicalIndex = Number(
      (stimulus.presentationOf ?? stimulus.id).replace("canonical-", "")
    );
    const protocol = save(root, `protocol-${stimulus.id}.json`, {
      blindPacket: [
        {
          familyReferenceHashes: [attachmentB.sha256],
          id: stimulus.id,
          imageHash: stimulus.artifactHash,
          meanings: ["target", "other-a", "other-b"],
        },
      ],
      model: "evidence-reviewer",
      qualified: false,
      recognitionOrder: [
        {
          choices: ["target", "other-a", "other-b", "uncertain"],
          id: `${stimulus.id}-recognition`,
        },
      ],
    });
    const recognitionBody = {
      answers: {
        [`${stimulus.id}-recognition`]: {
          choice: "target",
          evidence: "visible target",
          treatment: "",
        },
      },
      evidenceHashes: { [`${stimulus.id}.png`]: stimulus.artifactHash },
      model: "evidence-reviewer",
      status: "complete",
    };
    const recognition = save(
      root,
      `recognition-${stimulus.id}.json`,
      recognitionBody
    );
    stimulus.recognitionEvidenceHash = sha(JSON.stringify(recognitionBody));
    const craftBody = {
      answers: {
        [`${stimulus.id}-craft`]: craftAnswer("9"),
        [`${stimulus.id}-critical`]: craftAnswer("no"),
        [`${stimulus.id}-family`]: craftAnswer("yes"),
        [`${stimulus.id}-native`]: craftAnswer("yes"),
        [`${stimulus.id}-ship`]: craftAnswer("yes"),
      },
      evidenceHashes: {
        [`${stimulus.id}.png`]: stimulus.artifactHash,
        [`family-${attachmentB.sha256}.png`]: attachmentB.sha256,
      },
      model: "evidence-reviewer",
      status: "complete",
    };
    const craft = save(root, `craft-${stimulus.id}.json`, craftBody);
    stimulus.craftEvidenceHash = sha(JSON.stringify(craftBody));
    const producerReceipt = stimulus.canonical
      ? save(root, `producer-${stimulus.id}.json`, {
          artifactHash: stimulus.artifactHash,
          conceptId: stimulus.conceptId,
          familyId: stimulus.familyId,
          kind: "generated-candidate-evidence",
          nativeSize: stimulus.nativeSize,
          outcome: canonicalIndex === 0 ? "failed-with-artifact" : "delivered",
          paint: stimulus.paint,
          producerLineages: stimulus.producerLineages,
          requestedSlotId: stimulus.requestedSlotId,
          sourceLineageHash: stimulus.sourceLineageHash,
        })
      : undefined;
    if (producerReceipt) {
      stimulus.producerEvidenceHash = producerReceipt.sha256;
    }
    return {
      artifact: {
        file: `artifact-${canonicalIndex}.svg`,
        sha256: stimulus.artifactHash,
      },
      attachments:
        stimulus.presentationOrder === "reversed"
          ? [attachmentB, attachmentA]
          : [attachmentA, attachmentB],
      craft,
      producerReceipt,
      protocol,
      recognition,
      sources: stimulus.canonical
        ? [
            {
              file: `source-${canonicalIndex}.icon`,
              sha256: sha(`source-${canonicalIndex}`),
            },
          ]
        : undefined,
      stimulusId: stimulus.id,
    };
  });
  const criticIdentity = {
    baseModelLineage: "critic-lineage",
    model: "critic-v1",
    provider: "critic-provider",
  };
  const predictions: AiCriticPrediction[] = stimuli.map((stimulus, index) => ({
    artifactHash: stimulus.artifactHash,
    critic: criticIdentity,
    decision: index < 20 ? "reject" : "approve",
    sealed: true,
    sealedAt: 1,
    stimulusId: stimulus.id,
  }));
  const reviewers = [
    {
      baseModelLineage: "panel-lineage-a",
      model: "panel-a",
      provider: "provider-a",
    },
    {
      baseModelLineage: "panel-lineage-b",
      model: "panel-b",
      provider: "provider-b",
    },
  ];
  const population = save(root, "population.json", {
    qualificationId: "sealed-qualification-v1",
    sealed: true,
    stimuli,
  });
  const requestedSlots = save(root, "requested-slots.json", {
    frozen: true,
    qualificationId: "sealed-qualification-v1",
    slots: canonical.map((stimulus, index) => ({
      conceptId: stimulus.conceptId,
      familyId: stimulus.familyId,
      id: stimulus.requestedSlotId,
      nativeSize: stimulus.nativeSize,
      paint: stimulus.paint,
      sourceArtifactHashes: [sha(`source-${index}`)],
      sourceLineageHash: stimulus.sourceLineageHash,
    })),
  });
  const exposureSidecar = save(root, "exposure.json", {
    completeAccessibleCensus: false,
    knownExposedArtifactHashes: [],
    knownExposedFamilyIds: ["family-0"],
    knownExposedStimulusIds: [],
    qualificationId: "sealed-qualification-v1",
    scope: "artifact-and-stimulus-development-exposure",
  });
  const critic = save(root, "critic.json", {
    kind: "sealed-critic-predictions",
    populationSha256: population.sha256,
    predictions,
    qualificationId: "sealed-qualification-v1",
    sealed: true,
  });
  const panelReceipts = reviewers.map((reviewer, reviewerIndex) =>
    save(root, `panel-${reviewerIndex}.json`, {
      criticReceiptSha256: critic.sha256,
      kind: "sealed-panel-reviews",
      populationSha256: population.sha256,
      qualificationId: "sealed-qualification-v1",
      reviews: stimuli.map((stimulus, index): IndependentAiPanelReview => ({
        artifactHash: stimulus.artifactHash,
        craftEvidenceHash: stimulus.craftEvidenceHash,
        critical: index < 20,
        decision: index < 20 ? "reject" : "approve",
        panelEvidenceAvailableAt: 2,
        recognitionEvidenceHash: stimulus.recognitionEvidenceHash,
        reviewer,
        stimulusId: stimulus.id,
      })),
      sealed: true,
    })
  );
  const manifestBody = {
    artifacts: artifactBindings,
    contractVersion: ACCEPTANCE_CONTRACT_VERSION,
    criticReceipt: critic,
    exposureSidecar,
    labelsExposedBeforePrediction: false,
    panelReceipts,
    population,
    qualificationId: "sealed-qualification-v1",
    requestedSlots,
    scope: "agreement-with-independent-ai-panel",
  };
  const manifest = save(root, "manifest.json", manifestBody);
  return { manifest, manifestBody, root };
};

test("computes hash-bound diagnostic agreement without production qualification", () => {
  const { manifest, root } = fixture();
  const receipt = qualifyCriticFromFrozenEvidence({
    expectedManifestSha256: manifest.sha256,
    manifestFile: path.join(root, manifest.file),
  });
  expect(receipt).toMatchObject({
    agreementMetricsQualified: true,
    generalGeneratedCriticQualified: false,
    populationIdentityValidated: true,
    provenanceValidated: false,
    qualificationScope: "byte-bound-ai-panel-diagnostic",
    qualified: false,
  });
  expect(receipt.metrics).toMatchObject({
    naturalApprovalPrecision: 1,
    naturalCriticalRecall: 1,
    perDefectClass: { "blocked-counter": { criticalRecall: 1 } },
    perStratum: { "filled-16": { count: 25 } },
  });
  expect(criticQualificationReadyForProduction(receipt)).toBe(false);
});

test("accepts a failed generated candidate with exact artifact evidence without censoring it", () => {
  const { manifest, root } = fixture();
  const receipt = qualifyCriticFromFrozenEvidence({
    expectedManifestSha256: manifest.sha256,
    manifestFile: path.join(root, manifest.file),
  });
  expect(receipt.populationIdentityValidated).toBe(true);
  expect(receipt.metrics.naturalGeneratedCount).toBe(100);
  expect(receipt.qualified).toBe(false);
});

test("rejects copied family identities, requested-slot substitution and missing producer lineage", () => {
  let value = fixture();
  let population = JSON.parse(
    readFileSync(path.join(value.root, "population.json"), "utf-8")
  ) as { stimuli: AiPanelQualificationStimulus[] };
  population.stimuli[1].familyId = population.stimuli[0].familyId;
  value.manifestBody.population = save(
    value.root,
    "population-copied-family.json",
    population
  );
  let manifest = save(
    value.root,
    "manifest-copied-family.json",
    value.manifestBody
  );
  expect(() =>
    qualifyCriticFromFrozenEvidence({
      expectedManifestSha256: manifest.sha256,
      manifestFile: path.join(value.root, manifest.file),
    })
  ).toThrow("Natural stimulus identity mismatch");

  value = fixture();
  population = JSON.parse(
    readFileSync(path.join(value.root, "population.json"), "utf-8")
  ) as { stimuli: AiPanelQualificationStimulus[] };
  population.stimuli[0].requestedSlotId = "slot-1";
  value.manifestBody.population = save(
    value.root,
    "population-wrong-slot.json",
    population
  );
  manifest = save(value.root, "manifest-wrong-slot.json", value.manifestBody);
  expect(() =>
    qualifyCriticFromFrozenEvidence({
      expectedManifestSha256: manifest.sha256,
      manifestFile: path.join(value.root, manifest.file),
    })
  ).toThrow("frozen slots");

  value = fixture();
  population = JSON.parse(
    readFileSync(path.join(value.root, "population.json"), "utf-8")
  ) as { stimuli: AiPanelQualificationStimulus[] };
  population.stimuli[0].producerLineages = [];
  const producer = JSON.parse(
    readFileSync(path.join(value.root, "producer-canonical-0.json"), "utf-8")
  ) as { producerLineages: string[] };
  producer.producerLineages = [];
  const producerBinding = save(
    value.root,
    "producer-missing-lineage.json",
    producer
  );
  value.manifestBody.artifacts[0].producerReceipt = producerBinding;
  population.stimuli[0].producerEvidenceHash = producerBinding.sha256;
  value.manifestBody.population = save(
    value.root,
    "population-missing-lineage.json",
    population
  );
  manifest = save(
    value.root,
    "manifest-missing-lineage.json",
    value.manifestBody
  );
  expect(() =>
    qualifyCriticFromFrozenEvidence({
      expectedManifestSha256: manifest.sha256,
      manifestFile: path.join(value.root, manifest.file),
    })
  ).toThrow("Producer evidence identity mismatch");
});

test("rejects a self-consistent census with fewer than eighty distinct natural families", () => {
  const value = fixture(79);
  expect(() =>
    qualifyCriticFromFrozenEvidence({
      expectedManifestSha256: value.manifest.sha256,
      manifestFile: path.join(value.root, value.manifest.file),
    })
  ).toThrow("frozen slots");
});

test("rejects an exposed artifact but does not treat family metadata as a P3 exclusion", () => {
  const value = fixture();
  const receipt = qualifyCriticFromFrozenEvidence({
    expectedManifestSha256: value.manifest.sha256,
    manifestFile: path.join(value.root, value.manifest.file),
  });
  expect(receipt.populationIdentityValidated).toBe(true);

  const exposure = JSON.parse(
    readFileSync(path.join(value.root, "exposure.json"), "utf-8")
  ) as { knownExposedArtifactHashes: string[] };
  const population = JSON.parse(
    readFileSync(path.join(value.root, "population.json"), "utf-8")
  ) as { stimuli: AiPanelQualificationStimulus[] };
  exposure.knownExposedArtifactHashes.push(population.stimuli[0].artifactHash);
  value.manifestBody.exposureSidecar = save(
    value.root,
    "exposure-artifact.json",
    exposure
  );
  const manifest = save(
    value.root,
    "manifest-exposed-artifact.json",
    value.manifestBody
  );
  expect(() =>
    qualifyCriticFromFrozenEvidence({
      expectedManifestSha256: manifest.sha256,
      manifestFile: path.join(value.root, manifest.file),
    })
  ).toThrow("Natural stimulus identity mismatch");
});

test("rejects artifact tampering and a missing exact evidence binding", () => {
  let value = fixture();
  writeFileSync(path.join(value.root, "artifact-0.svg"), "tampered");
  expect(() =>
    qualifyCriticFromFrozenEvidence({
      expectedManifestSha256: value.manifest.sha256,
      manifestFile: path.join(value.root, value.manifest.file),
    })
  ).toThrow("hash mismatch");

  value = fixture();
  value.manifestBody.artifacts.pop();
  const manifest = save(
    value.root,
    "manifest-missing.json",
    value.manifestBody
  );
  expect(() =>
    qualifyCriticFromFrozenEvidence({
      expectedManifestSha256: manifest.sha256,
      manifestFile: path.join(value.root, manifest.file),
    })
  ).toThrow("incomplete");
});

test("rejects an unsealed panel receipt and copied evaluator lineage", () => {
  let value = fixture();
  const panel = JSON.parse(
    readFileSync(path.join(value.root, "panel-0.json"), "utf-8")
  ) as Record<string, unknown>;
  panel.sealed = false;
  const panelBinding = save(value.root, "panel-unsealed.json", panel);
  value.manifestBody.panelReceipts[0] = panelBinding;
  const manifest = save(
    value.root,
    "manifest-unsealed.json",
    value.manifestBody
  );
  expect(() =>
    qualifyCriticFromFrozenEvidence({
      expectedManifestSha256: manifest.sha256,
      manifestFile: path.join(value.root, manifest.file),
    })
  ).toThrow("panel receipt");

  value = fixture();
  const copied = JSON.parse(
    readFileSync(path.join(value.root, "panel-0.json"), "utf-8")
  ) as { reviews: IndependentAiPanelReview[] };
  for (const review of copied.reviews) {
    review.reviewer.baseModelLineage = "critic-lineage";
  }
  const copiedBinding = save(value.root, "panel-copied.json", copied);
  value.manifestBody.panelReceipts[0] = copiedBinding;
  const copiedManifest = save(
    value.root,
    "manifest-copied.json",
    value.manifestBody
  );
  expect(() =>
    qualifyCriticFromFrozenEvidence({
      expectedManifestSha256: copiedManifest.sha256,
      manifestFile: path.join(value.root, copiedManifest.file),
    })
  ).toThrow("base-model lineages");
});

test("rejects arbitrary stage blobs and attachment-order substitution", () => {
  let value = fixture();
  const arbitrary = save(value.root, "arbitrary-recognition.json", {});
  value.manifestBody.artifacts[0].recognition = arbitrary;
  let manifest = save(
    value.root,
    "manifest-arbitrary.json",
    value.manifestBody
  );
  expect(() =>
    qualifyCriticFromFrozenEvidence({
      expectedManifestSha256: manifest.sha256,
      manifestFile: path.join(value.root, manifest.file),
    })
  ).toThrow("Canonical recognition row mismatch");

  value = fixture();
  const reversed = value.manifestBody.artifacts.find(
    ({ stimulusId }) => stimulusId === "reversed-control"
  );
  if (!reversed) {
    throw new Error("Missing reversed control binding");
  }
  reversed.attachments.reverse();
  manifest = save(
    value.root,
    "manifest-attachment-order.json",
    value.manifestBody
  );
  expect(() =>
    qualifyCriticFromFrozenEvidence({
      expectedManifestSha256: manifest.sha256,
      manifestFile: path.join(value.root, manifest.file),
    })
  ).toThrow("Ordered attachment binding mismatch");
});

test("confines evidence files and requires one complete identity per panel receipt", () => {
  let value = fixture();
  value.manifestBody.artifacts[0].artifact.file = "../outside.svg";
  let manifest = save(value.root, "manifest-escape.json", value.manifestBody);
  expect(() =>
    qualifyCriticFromFrozenEvidence({
      expectedManifestSha256: manifest.sha256,
      manifestFile: path.join(value.root, manifest.file),
    })
  ).toThrow("inside its evidence root");

  value = fixture();
  const panel = JSON.parse(
    readFileSync(path.join(value.root, "panel-0.json"), "utf-8")
  ) as { reviews: IndependentAiPanelReview[] };
  panel.reviews[0].reviewer = {
    baseModelLineage: "panel-lineage-b",
    model: "panel-b",
    provider: "provider-b",
  };
  const mixed = save(value.root, "panel-mixed.json", panel);
  value.manifestBody.panelReceipts[0] = mixed;
  manifest = save(value.root, "manifest-mixed.json", value.manifestBody);
  expect(() =>
    qualifyCriticFromFrozenEvidence({
      expectedManifestSha256: manifest.sha256,
      manifestFile: path.join(value.root, manifest.file),
    })
  ).toThrow("one distinct stable reviewer identity");

  value = fixture();
  const incomplete = JSON.parse(
    readFileSync(path.join(value.root, "panel-0.json"), "utf-8")
  ) as { reviews: IndependentAiPanelReview[] };
  incomplete.reviews.pop();
  const incompleteBinding = save(
    value.root,
    "panel-incomplete.json",
    incomplete
  );
  value.manifestBody.panelReceipts[0] = incompleteBinding;
  manifest = save(value.root, "manifest-incomplete.json", value.manifestBody);
  expect(() =>
    qualifyCriticFromFrozenEvidence({
      expectedManifestSha256: manifest.sha256,
      manifestFile: path.join(value.root, manifest.file),
    })
  ).toThrow("panel receipt is invalid");
});

const collectorFixture = (
  options: {
    answers?: Record<
      string,
      { choice: string; evidence: string; treatment: string }
    >;
    attachments?: readonly { name: string; bytes: Buffer }[];
    id?: string;
    instrumentHash?: string;
    model?: string;
    nativeStage?: string;
    promptSha256?: string;
    provider?: string;
    qualificationId?: string;
    role?: CollectorAccessExpectation["stages"][number]["role"];
    sessionId?: string;
    startedAt?: number;
    settledAt?: number;
    subject?: CollectorAccessExpectation["stages"][number]["subject"];
  } = {}
) => {
  const root = mkdtempSync(path.join(tmpdir(), "collector-access-"));
  const runtimeRoot = mkdtempSync(path.join(tmpdir(), "collector-runtime-"));
  const forbiddenDirectory = mkdtempSync(path.join(tmpdir(), "collector-key-"));
  const forbiddenRoot = path.join(forbiddenDirectory, "sealed-key.json");
  writeFileSync(forbiddenRoot, "sealed semantic key");
  const executableRoot = mkdtempSync(path.join(tmpdir(), "collector-cli-"));
  roots.push(root, runtimeRoot, forbiddenDirectory, executableRoot);
  const stateRoot = path.join(runtimeRoot, "native-state");
  mkdirSync(stateRoot);
  const executable = path.join(executableRoot, "codex");
  writeFileSync(executable, "exact native executable");
  const executableSha256 = sha(readFileSync(executable));
  const attachments = options.attachments ?? [
    { bytes: Buffer.from("exact-png"), name: "opaque.png" },
  ];
  const model = options.model ?? "gpt-5.6-sol";
  const provider = options.provider ?? "openai-codex";
  const qualificationId = options.qualificationId ?? "qualification-1";
  const nativeStage = options.nativeStage ?? "00-recognition";
  const stageId = options.id ?? "recognition-sol";
  const image =
    "iconsmith/native@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const callId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const reservationHash = sha("reservation");
  const routeHash = sha("route");
  const originalDeadlineAt = 2_000_000_000_000;
  const intent = {
    callId,
    deadlineAt: originalDeadlineAt,
    dispatchedAt: 1_900_000_000_000,
    minimumRemainingMs: 5000,
    requestId: qualificationId,
    reservationHash,
    routeHash,
    stage: nativeStage,
  };
  const intentHash = sha(JSON.stringify(intent));
  const containerId = "b".repeat(64);
  const mounts = [
    {
      containerPath: "/runtime/codex",
      hostPath: executable,
      readOnly: true,
      sha256: executableSha256,
    },
    {
      containerPath: runtimeRoot,
      hostPath: runtimeRoot,
      readOnly: false,
    },
    {
      containerPath: stateRoot,
      hostPath: stateRoot,
      readOnly: false,
    },
  ];
  const descriptor = save(root, "descriptor.json", {
    adapter: "codex-jsonl-v1",
    evidenceRoot: root,
    image,
    mounts,
    network: "bridge",
    originalDeadlineAt,
    runtimeRoot,
  });
  const intentBinding = save(root, "intent.json", intent);
  const started = save(root, "started.json", {
    intentHash,
    startedAt: options.startedAt ?? 1_900_000_000_001,
  });
  const identity = save(root, "identity.json", { containerId, image });
  const create = save(root, "create.json", {
    args: [
      "container",
      "create",
      ...mounts.flatMap((mount) => [
        "--mount",
        `type=bind,src=${mount.hostPath},dst=${mount.containerPath}${mount.readOnly ? ",readonly" : ""}`,
      ]),
      image,
    ],
    phase: "create",
  });
  const inspect = save(root, "inspect.json", {
    code: 0,
    inspected: {
      Config: { Image: image },
      HostConfig: { PidMode: "" },
      Id: containerId,
      Mounts: mounts.map((mount) => ({
        Destination: mount.containerPath,
        RW: !mount.readOnly,
        Source: mount.hostPath,
      })),
    },
    phase: "resolve-identity",
  });
  const settlement = save(root, "settlement.json", {
    container: {
      artifactEligible: true,
      containerAbsent: true,
      containerId,
      process: { code: 0, killed: false },
      status: "complete",
    },
    deadlineAt: originalDeadlineAt,
    intentHash,
  });
  const terminal = save(root, "terminal.json", {
    accounting: "settled",
    containment: "container-absent",
    deadlineExceeded: false,
    evidenceFile: realpathSync(path.join(root, settlement.file)),
    evidenceHash: settlement.sha256,
    intentHash,
    outcome: "complete",
    settledAt: options.settledAt ?? 1_900_000_000_100,
  });
  const request = save(root, "request.json", {
    evidenceHashes: Object.fromEntries(
      attachments.map(({ name, bytes }) => [name, sha(bytes)])
    ),
    evidenceMode: options.role === "adjudication" ? "sealed-text" : "images",
    promptSha256: options.promptSha256 ?? sha(`prompt-${stageId}`),
    status: "running",
  });
  const traceBody = `${JSON.stringify({ payload: { model }, type: "turn_context" })}\n${JSON.stringify(
    {
      payload: {
        content: attachments.map(({ bytes }) => ({
          detail: "original",
          image_url: `data:image/png;base64,${bytes.toString("base64")}`,
          type: "input_image",
        })),
        role: "user",
        type: "message",
      },
      type: "response_item",
    }
  )}\n`;
  const trace = save(root, "trace.jsonl", traceBody);
  const result = save(root, "review.json", {
    answers: options.answers,
    baseModelLineage: model,
    evidenceHashes: Object.fromEntries(
      attachments.map(({ name, bytes }) => [name, sha(bytes)])
    ),
    evidenceMode: options.role === "adjudication" ? "sealed-text" : "images",
    imageInspection: { traceSha256: trace.sha256 },
    model,
    provider,
    status: "complete",
  });
  const expectation: CollectorAccessExpectation["stages"][number] = {
    actor: {
      baseModelLineage: model,
      model,
      provider,
    },
    evidenceMode: options.role === "adjudication" ? "sealed-text" : "images",
    id: stageId,
    ...(options.instrumentHash
      ? { instrumentHash: options.instrumentHash }
      : {}),
    nativeStage,
    orderedAttachments: attachments.map(({ name, bytes }) => ({
      name,
      sha256: sha(bytes),
    })),
    outputSha256: result.sha256,
    requestId: qualificationId,
    role: options.role ?? "recognition",
    routeHash,
    ...(options.subject ? { subject: options.subject } : {}),
  };
  const sessionId = options.sessionId ?? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const nonce = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const nonceSha256 = sha(nonce);
  const forbidden = [
    {
      containerPath: realpathSync(forbiddenRoot),
      pathClass: "forbidden-0-direct",
    },
    {
      containerPath: `/proc/1/root${realpathSync(forbiddenRoot)}`,
      pathClass: "forbidden-0-proc-root",
    },
    {
      containerPath: `/host_mnt${realpathSync(forbiddenRoot)}`,
      pathClass: "forbidden-0-host-mnt",
    },
    {
      containerPath: `/run/host${realpathSync(forbiddenRoot)}`,
      pathClass: "forbidden-0-run-host",
    },
  ];
  const ackHostPath = path.join(realpathSync(runtimeRoot), ".access-probe-ack");
  const partialPlan = {
    ackContainerPath: ackHostPath,
    ackHostPath,
    ackSha256: sha(
      `iconsmith-access-ack-v1:${expectation.nativeStage}:${nonceSha256}\n`
    ),
    allowed: { containerPath: "/runtime/codex", sha256: executableSha256 },
    forbidden,
    kind: "same-container-access-probe-plan-v1",
    nonce,
    nonceSha256,
    stageId: expectation.nativeStage,
  };
  const sameContainerAccessProbe = {
    ...partialPlan,
    planSha256: sha(JSON.stringify(partialPlan)),
  };
  const observation = {
    kind: "same-container-access-observation-v1",
    nonceSha256,
    observations: [
      {
        pathClass: "allowed-native-executable",
        sha256: executableSha256,
        status: "readable",
      },
      ...forbidden.map(({ pathClass }) => ({
        pathClass,
        status: "missing",
      })),
    ],
    planSha256: sameContainerAccessProbe.planSha256,
    stageId: expectation.nativeStage,
  };
  const securityMounts = mounts
    .map((mount) => ({
      Destination: mount.containerPath,
      RW: !mount.readOnly,
      Source: realpathSync(mount.hostPath),
      Type: "bind",
    }))
    .toSorted((left, right) =>
      left.Destination.localeCompare(right.Destination)
    );
  const securityBytes = JSON.stringify([
    {
      HostConfig: {
        CapDrop: ["ALL"],
        Devices: [],
        NetworkMode: "bridge",
        PidMode: "",
        Privileged: false,
        ReadonlyRootfs: true,
        SecurityOpt: ["no-new-privileges"],
      },
      Id: containerId,
      Mounts: securityMounts,
    },
  ]);
  const securityInspect = save(root, "security-inspect.json", securityBytes);
  const accessReceipt = save(root, "access-receipt.json", {
    containerId,
    kind: "collector-same-container-access-receipt-v1",
    observation,
    security: {
      kind: "same-container-security-evidence-v1",
      mountCensusSha256: sha(JSON.stringify(securityMounts)),
      network: "bridge",
      sha256: securityInspect.sha256,
    },
  });
  const sameContainerAccess = {
    ackSha256: sameContainerAccessProbe.ackSha256,
    containerId,
    kind: "same-container-access-binding-v1",
    nonceSha256,
    observationSha256: sha(JSON.stringify(observation)),
    planSha256: sameContainerAccessProbe.planSha256,
    receipt: accessReceipt,
    securityInspect,
    stageId: expectation.nativeStage,
  };
  const stage = {
    adapterRequest: request,
    adapterResult: result,
    adapterTrace: trace,
    containerCreateRequest: create,
    containerDescriptor: descriptor,
    containerIdentity: identity,
    containerInspectResult: inspect,
    containerSettlement: settlement,
    expectation,
    id: stageId,
    nativeIntent: intentBinding,
    nativeStarted: started,
    nativeTerminal: terminal,
    sameContainerAccess,
  };
  const runtimeMetadata = lstatSync(runtimeRoot);
  const accessPolicy = save(root, "access-policy.json", {
    forbiddenHostRoots: [realpathSync(forbiddenRoot)],
    kind: "collector-pre-dispatch-access-policy-v1",
    originalDeadlineAt,
    qualificationId,
    reservationHash,
    routeHash,
    sessionId,
    stages: [
      {
        actor: expectation.actor,
        allowedMounts: mounts,
        id: expectation.nativeStage,
        network: "bridge",
        sameContainerAccessProbe,
        writableDirectory: {
          device: String(runtimeMetadata.dev),
          initialInventorySha256: sha("[]"),
          inode: String(runtimeMetadata.ino),
          path: realpathSync(runtimeRoot),
        },
      },
    ],
  });
  const journalBody = {
    accessPolicy,
    kind: "collector-bound-stage-access-journal-v4",
    originalDeadlineAt,
    qualificationId,
    reservationHash,
    sessionId,
    stages: [stage],
  };
  let journal = save(root, "journal.json", journalBody);
  const evidence: CollectorAccessExpectation = {
    accessPolicySha256: accessPolicy.sha256,
    forbiddenHostRoots: [forbiddenRoot],
    originalDeadlineAt,
    qualificationId,
    reservationHash,
    sessionId,
    stages: [expectation],
  };
  const run = () =>
    validateCollectorBoundStageAccessEvidence({
      evidence,
      expectedJournalSha256: journal.sha256,
      journalFile: path.join(root, journal.file),
    });
  return {
    accessPolicy,
    evidence,
    forbiddenRoot,
    journalBody,
    root,
    run,
    saveJournal: () => {
      journal = save(root, `journal-${Date.now()}.json`, journalBody);
    },
    stage,
    traceBody,
  };
};

interface CollectorAnswerOverride {
  critical?: string;
  family?: string;
  native?: string;
  ship?: string;
  stimulusId: string;
}

const collectorQualificationFixture = (
  adjudicationChoice = "match",
  panelOverride?: CollectorAnswerOverride
) => {
  const legacy = fixture();
  const qualificationId = "sealed-qualification-v1";
  const populationBody = JSON.parse(
    readFileSync(
      path.join(legacy.root, legacy.manifestBody.population.file),
      "utf-8"
    )
  ) as {
    qualificationId: string;
    sealed: true;
    stimuli: AiPanelQualificationStimulus[];
  };
  const attachmentA = {
    bytes: readFileSync(path.join(legacy.root, "attachment-a.png")),
    name: "candidate.png",
  };
  const attachmentB = {
    bytes: readFileSync(path.join(legacy.root, "attachment-b.png")),
    name: "family.png",
  };
  for (const stimulus of populationBody.stimuli) {
    stimulus.recognitionEvidenceHash = sha(
      JSON.stringify({
        adjudication: "pending",
        recognition: "pending",
      })
    );
    stimulus.craftEvidenceHash = sha(
      JSON.stringify({
        orderedAttachmentHashes: stimulus.orderedAttachmentHashes,
        questionIds: collectorCraftIds(stimulus.id),
      })
    );
  }
  const recognitionAnswers = Object.fromEntries(
    populationBody.stimuli.map(({ id }) => [
      `${id}-free-recognition`,
      craftAnswer("described"),
    ])
  );
  const adjudicationAnswers = Object.fromEntries(
    populationBody.stimuli.map(({ id }) => [
      `${id}-synonym-adjudication`,
      craftAnswer(adjudicationChoice),
    ])
  );
  const craftAnswers = (override?: CollectorAnswerOverride) =>
    Object.fromEntries(
      populationBody.stimuli.flatMap(({ id }, index) => {
        const reject = index < 20;
        const selected = override?.stimulusId === id ? override : undefined;
        return [
          [
            `${id}-critical`,
            craftAnswer(selected?.critical ?? (reject ? "yes" : "no")),
          ],
          [`${id}-craft`, craftAnswer("9")],
          [`${id}-family`, craftAnswer(selected?.family ?? "yes")],
          [`${id}-native`, craftAnswer(selected?.native ?? "yes")],
          [
            `${id}-ship`,
            craftAnswer(selected?.ship ?? (reject ? "no" : "yes")),
          ],
        ];
      })
    );
  const recognitionAttachments = populationBody.stimuli.map(
    ({ id, orderedAttachmentHashes }) => ({
      bytes:
        orderedAttachmentHashes[0] === sha(attachmentA.bytes)
          ? attachmentA.bytes
          : attachmentB.bytes,
      name: `${id}.png`,
    })
  );
  const craftAttachments = populationBody.stimuli.flatMap(({ id }, index) => {
    const hashes = populationBody.stimuli[index]?.orderedAttachmentHashes ?? [];
    return hashes.map((hash, attachmentIndex) => ({
      bytes:
        hash === sha(attachmentA.bytes) ? attachmentA.bytes : attachmentB.bytes,
      name: `${id}-${attachmentIndex}.png`,
    }));
  });
  const definitions = [
    {
      answers: recognitionAnswers,
      attachments: recognitionAttachments,
      id: "recognition",
      model: "recognizer",
      role: "recognition" as const,
    },
    {
      answers: adjudicationAnswers,
      attachments: [],
      id: "adjudication",
      model: "adjudicator",
      role: "adjudication" as const,
    },
    {
      answers: craftAnswers(),
      attachments: craftAttachments,
      id: "prediction",
      model: "critic",
      role: "prediction" as const,
    },
    {
      answers: craftAnswers(panelOverride),
      attachments: craftAttachments,
      id: "panel-a",
      model: "panel-a",
      role: "panel" as const,
    },
    {
      answers: craftAnswers(panelOverride),
      attachments: craftAttachments,
      id: "panel-b",
      model: "panel-b",
      role: "panel" as const,
    },
  ];
  const runs = definitions.map((definition, index) => {
    const value = collectorFixture({
      ...definition,
      instrumentHash:
        definition.role === "prediction"
          ? sha("critic-instrument-v1")
          : undefined,
      nativeStage: `${index.toString().padStart(2, "0")}-${definition.id}`,
      promptSha256: sha(`prompt-${definition.id}`),
      qualificationId,
      settledAt: 1_900_000_000_019 + index * 20,
      startedAt: 1_900_000_000_010 + index * 20,
    });
    return { definition, value };
  });
  const recognitionOutput =
    runs[0]?.value.evidence.stages[0]?.outputSha256 ?? "";
  const adjudicationOutput =
    runs[1]?.value.evidence.stages[0]?.outputSha256 ?? "";
  for (const stimulus of populationBody.stimuli) {
    stimulus.recognitionEvidenceHash = sha(
      JSON.stringify({
        adjudication: adjudicationOutput,
        recognition: recognitionOutput,
      })
    );
  }
  const population = save(
    legacy.root,
    "collector-population.json",
    populationBody
  );
  const lineageEntries = definitions.map(({ model }) => {
    const source = save(
      legacy.root,
      `lineage-${model}.txt`,
      `official-${model}`
    );
    return {
      baseModelLineage: model,
      model,
      provider: "openai-codex",
      source: {
        file: `${path.basename(legacy.root)}/${source.file}`,
        sha256: source.sha256,
      },
    };
  });
  const lineageRegistry = save(legacy.root, "lineage-registry.json", {
    entries: lineageEntries,
    frozen: true,
    qualificationId,
  });
  const prefix = (binding: { file: string; sha256: string }) => ({
    file: `${path.basename(legacy.root)}/${binding.file}`,
    sha256: binding.sha256,
  });
  const manifestRoot = tmpdir();
  const rows = populationBody.stimuli.map(({ id }) => ({
    adjudication: {
      promptSha256: sha("prompt-adjudication"),
      runId: "adjudication",
      stageId: "adjudication",
    },
    panels: [
      {
        promptSha256: sha("prompt-panel-a"),
        runId: "panel-a",
        stageId: "panel-a",
      },
      {
        promptSha256: sha("prompt-panel-b"),
        runId: "panel-b",
        stageId: "panel-b",
      },
    ],
    prediction: {
      promptSha256: sha("prompt-prediction"),
      runId: "prediction",
      stageId: "prediction",
    },
    recognition: {
      promptSha256: sha("prompt-recognition"),
      runId: "recognition",
      stageId: "recognition",
    },
    stimulusId: id,
  }));
  const manifestBody = {
    artifacts: legacy.manifestBody.artifacts.map(
      (binding: Record<string, unknown>) => ({
        ...binding,
        artifact: prefix(binding.artifact as { file: string; sha256: string }),
        attachments: (
          binding.attachments as { file: string; sha256: string }[]
        ).map(prefix),
        craft: prefix(binding.craft as { file: string; sha256: string }),
        producerReceipt: binding.producerReceipt
          ? prefix(binding.producerReceipt as { file: string; sha256: string })
          : undefined,
        protocol: prefix(binding.protocol as { file: string; sha256: string }),
        recognition: prefix(
          binding.recognition as { file: string; sha256: string }
        ),
        sources: binding.sources
          ? (binding.sources as { file: string; sha256: string }[]).map(prefix)
          : undefined,
      })
    ),
    contractVersion: ACCEPTANCE_CONTRACT_VERSION,
    exposureSidecar: prefix(legacy.manifestBody.exposureSidecar),
    kind: "collector-critic-qualification-manifest-v1",
    lineageRegistry: prefix(lineageRegistry),
    population: prefix(population),
    qualificationId,
    requestedSlots: prefix(legacy.manifestBody.requestedSlots),
    rows,
    runs: runs.map(({ definition, value }) => ({
      evidence: value.evidence,
      id: definition.id,
      journal: {
        file: `${path.basename(value.root)}/journal.json`,
        sha256: sha(readFileSync(path.join(value.root, "journal.json"))),
      },
    })),
  };
  const manifestName = `collector-qualification-${Date.now()}-${Math.random()}.json`;
  const manifest = save(manifestRoot, manifestName, manifestBody);
  roots.push(path.join(manifestRoot, manifestName));
  return {
    manifest,
    manifestBody,
    manifestFile: path.join(manifestRoot, manifestName),
    run: () =>
      qualifyCriticFromCollectorEvidence({
        expectedManifestSha256: manifest.sha256,
        manifestFile: path.join(manifestRoot, manifestName),
      }),
  };
};

test("derives critic and panel agreement from validated collector stage answers", () => {
  const value = collectorQualificationFixture();
  expect(value.run()).toMatchObject({
    agreementMetricsQualified: true,
    provenanceKind: "collector-bound-native-evidence-v1",
    provenanceValidated: true,
    qualified: true,
  });
});

const apiCollectorBridgeFixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-api-collector-"));
  roots.push(root);
  const attachment = save(root, "candidate.png", "candidate-png");
  const evidence = {
    descriptor: save(root, "descriptor.json", {
      orderedAttachments: [
        {
          file: path.join(root, attachment.file),
          name: "candidate.png",
          sha256: attachment.sha256,
        },
      ],
    }),
    generationInfo: save(root, "generationInfo.json", {
      name: "generationInfo",
    }),
    intent: save(root, "intent.json", { name: "intent" }),
    request: save(root, "request.json", { name: "request" }),
    result: save(root, "result.json", { name: "result" }),
    terminal: save(root, "terminal.json", { name: "terminal" }),
  };
  const absoluteEvidence = Object.fromEntries(
    Object.entries(evidence).map(([name, binding]) => [
      name,
      {
        file: realpathSync(path.join(root, binding.file)),
        sha256: binding.sha256,
      },
    ])
  ) as unknown as VerifiedApiCollectorStageEvidence["evidence"];
  const answers = {
    "candidate-craft": craftAnswer("8"),
    "candidate-critical": craftAnswer("no"),
    "candidate-family": craftAnswer("yes"),
    "candidate-native": craftAnswer("yes"),
    "candidate-ship": craftAnswer("yes"),
  };
  const originalDeadlineAt = 2_000_000;
  const stageDeadlineAt = 1_900_000;
  const expectation = {
    actor: { ...API_COLLECTOR_STAGE_ACTOR },
    evidenceMode: "images" as const,
    id: "prediction-google",
    instrumentHash: sha("collector-instrument"),
    nativeStage: "prediction-google",
    orderedAttachments: [{ name: "candidate.png", sha256: attachment.sha256 }],
    outputSha256: evidence.result.sha256,
    requestId: "api-request-google",
    role: "prediction" as const,
    routeHash: API_COLLECTOR_ROUTE_HASH,
  };
  const qualificationId = "qualification-api-google";
  const sessionId = "12345678-1234-4123-8123-123456789abc";
  const journal = save(root, "journal.json", {
    kind: "collector-bound-api-stage-journal-v1",
    originalDeadlineAt,
    qualificationId,
    sessionId,
    stages: [
      {
        evidence,
        expectation,
        id: expectation.id,
        kind: "collector-api-transport-stage-v1",
        stageDeadlineAt,
      },
    ],
  });
  const capability = Object.freeze({});
  const verified = {
    actor: API_COLLECTOR_STAGE_ACTOR,
    answers,
    answersHash: sha(canonicalJson(answers)),
    evidence: absoluteEvidence,
    instrumentHash: expectation.instrumentHash,
    orderedAttachments: expectation.orderedAttachments,
    originalDeadlineAt,
    outputSha256: expectation.outputSha256,
    promptSha256: sha("api-prompt"),
    requestId: expectation.requestId,
    role: expectation.role,
    routeHash: expectation.routeHash,
    settledAt: 1_800_000,
    stageDeadlineAt,
    startedAt: 1_700_000,
    transportAuthority: "installed-production-transport",
    usage: {},
  } as unknown as VerifiedApiCollectorStageEvidence;
  apiStageAuthority.capability = capability;
  apiStageAuthority.verified = verified;
  const run = (candidate = capability) =>
    validateCollectorApiTransportStageEvidence({
      capability: candidate as never,
      evidence: {
        kind: "collector-api-transport-expectation-v1",
        originalDeadlineAt,
        qualificationId,
        sessionId,
        stages: [{ expectation, id: expectation.id, stageDeadlineAt }],
      },
      expectedJournalSha256: journal.sha256,
      journalFile: path.join(root, journal.file),
    });
  return { capability, evidence, run, verified };
};

test("admits exact installed API transport evidence through its live capability", () => {
  const value = apiCollectorBridgeFixture();
  expect(value.run()).toMatchObject({
    apiTransportVerified: true,
    stageCount: 1,
    stages: [
      {
        id: "prediction-google",
        promptSha256: sha("api-prompt"),
        role: "prediction",
      },
    ],
  });
  expect(apiStageAuthority.expected).toEqual({
    actor: API_COLLECTOR_STAGE_ACTOR,
    instrumentHash: value.verified.instrumentHash,
    orderedAttachments: value.verified.orderedAttachments,
    originalDeadlineAt: value.verified.originalDeadlineAt,
    outputSha256: value.verified.outputSha256,
    requestId: value.verified.requestId,
    role: value.verified.role,
    routeHash: value.verified.routeHash,
    stageDeadlineAt: value.verified.stageDeadlineAt,
  });
  expect(() => value.run()).toThrow(/not live/iu);
});

test("rejects offline API transport and a serialized capability copy", () => {
  let value = apiCollectorBridgeFixture();
  apiStageAuthority.verified = {
    ...value.verified,
    transportAuthority: "offline-test-only",
  };
  expect(() => value.run()).toThrow(/offline|transport evidence/iu);

  value = apiCollectorBridgeFixture();
  expect(() => value.run({ ...value.capability })).toThrow(/not live/iu);
});

test("rejects an API journal that differs from the revalidated live evidence", () => {
  const value = apiCollectorBridgeFixture();
  apiStageAuthority.verified = {
    ...value.verified,
    evidence: {
      ...value.evidence,
      result: { ...value.evidence.result, sha256: sha("substituted-result") },
    },
  };
  expect(() => value.run()).toThrow(/transport evidence/iu);
});

interface MutableCollectorQualificationManifest {
  exposureSidecar: { file: string; sha256: string };
  lineageRegistry: { file: string; sha256: string };
  population: { file: string; sha256: string };
  qualificationId: string;
  requestedSlots: { file: string; sha256: string };
  rows: {
    panels: [
      { promptSha256: string; runId: string; stageId: string },
      { promptSha256: string; runId: string; stageId: string },
    ];
  }[];
  runs: {
    evidence: CollectorAccessExpectation | CollectorApiTransportExpectation;
    id: string;
    journal: { file: string; sha256: string };
  }[];
}

// This mocks only the orchestration lifetime. Runtime tests own transport authority.
const hybridCollectorQualificationFixture = () => {
  const value = collectorQualificationFixture();
  const manifest =
    value.manifestBody as unknown as MutableCollectorQualificationManifest;
  const oldPanel = manifest.runs.find(({ id }) => id === "panel-b");
  if (!oldPanel || "kind" in oldPanel.evidence) {
    throw new Error("Missing native panel fixture");
  }
  const oldJournalFile = path.resolve(tmpdir(), oldPanel.journal.file);
  const oldJournal = JSON.parse(readFileSync(oldJournalFile, "utf-8")) as {
    stages: { adapterResult: { file: string }; expectation: { id: string } }[];
  };
  const [oldStage] = oldJournal.stages;
  if (!oldStage) {
    throw new Error("Missing native panel stage fixture");
  }
  const oldResult = JSON.parse(
    readFileSync(
      path.resolve(path.dirname(oldJournalFile), oldStage.adapterResult.file),
      "utf-8"
    )
  ) as {
    answers: Record<
      string,
      { choice: string; evidence: string; treatment: string }
    >;
  };
  const population = JSON.parse(
    readFileSync(path.resolve(tmpdir(), manifest.population.file), "utf-8")
  ) as { stimuli: AiPanelQualificationStimulus[] };
  const artifactById = new Map(
    population.stimuli.map((stimulus, index) => [
      stimulus.id,
      value.manifestBody.artifacts[index] as { attachments: FileBinding[] },
    ])
  );
  manifest.runs = manifest.runs.filter(({ id }) => id !== "panel-b");

  const lineageFile = path.resolve(tmpdir(), manifest.lineageRegistry.file);
  const lineage = JSON.parse(readFileSync(lineageFile, "utf-8")) as {
    entries: {
      baseModelLineage: string;
      model: string;
      provider: string;
      source: FileBinding;
    }[];
  };
  const lineageSource = save(
    path.dirname(lineageFile),
    "lineage-google-api.txt",
    "mocked-offline-official-google-api-lineage"
  );
  lineage.entries.push({
    ...API_COLLECTOR_STAGE_ACTOR,
    source: prefixBinding(path.dirname(lineageFile), lineageSource),
  });
  const savedLineage = save(
    path.dirname(lineageFile),
    path.basename(lineageFile),
    lineage
  );
  manifest.lineageRegistry.sha256 = savedLineage.sha256;

  const assembly = createCollectorApiQualificationAssembly({
    exposureSidecarSha256: manifest.exposureSidecar.sha256,
    populationSha256: manifest.population.sha256,
    qualificationId: manifest.qualificationId,
    requestedSlotsSha256: manifest.requestedSlots.sha256,
  });
  const appended: {
    attachmentFiles: string[];
    capability: object;
    evidence: CollectorApiTransportExpectation;
    evidenceFiles: string[];
    journalFile: string;
    journalSha256: string;
    runId: string;
    verified: VerifiedApiCollectorStageEvidence;
  }[] = [];
  const groups = population.stimuli.map((stimulus) => [stimulus]);
  for (const [groupIndex, stimuli] of groups.entries()) {
    const runId = `panel-google-${groupIndex}`;
    const root = mkdtempSync(path.join(tmpdir(), `${runId}-`));
    roots.push(root);
    const answers = Object.fromEntries(
      Object.entries(oldResult.answers).filter(([id]) =>
        stimuli.some((stimulus) => collectorCraftIds(stimulus.id).includes(id))
      )
    );
    const orderedAttachments = stimuli.flatMap((stimulus) => {
      const artifact = artifactById.get(stimulus.id);
      if (!artifact) {
        throw new Error(`Missing hybrid artifact: ${stimulus.id}`);
      }
      return artifact.attachments.map((binding, attachmentIndex) => ({
        file: realpathSync(path.resolve(tmpdir(), binding.file)),
        name: `${stimulus.id}-${attachmentIndex}.png`,
        sha256: binding.sha256,
      }));
    });
    const descriptor = save(root, "descriptor.json", { orderedAttachments });
    const retainedEvidence = {
      descriptor,
      generationInfo: save(root, "generation-info.json", { runId }),
      intent: save(root, "intent.json", { runId }),
      request: save(root, "request.json", { runId }),
      result: save(root, "result.json", { answers, runId }),
      terminal: save(root, "terminal.json", { runId }),
    };
    const liveEvidence = Object.fromEntries(
      Object.entries(retainedEvidence).map(([name, binding]) => [
        name,
        {
          file: realpathSync(path.join(root, binding.file)),
          sha256: binding.sha256,
        },
      ])
    ) as unknown as VerifiedApiCollectorStageEvidence["evidence"];
    const promptSha256 = sha(`prompt-${runId}`);
    const stageDeadlineAt = 1_900_000_000_200;
    const expectation = {
      actor: { ...API_COLLECTOR_STAGE_ACTOR },
      evidenceMode: "images" as const,
      id: runId,
      instrumentHash: sha("panel-google-instrument-v1"),
      nativeStage: runId,
      orderedAttachments: orderedAttachments.map(({ name, sha256 }) => ({
        name,
        sha256,
      })),
      outputSha256: retainedEvidence.result.sha256,
      requestId: `request-${runId}`,
      role: "panel" as const,
      routeHash: API_COLLECTOR_ROUTE_HASH,
    };
    const evidence: CollectorApiTransportExpectation = {
      kind: "collector-api-transport-expectation-v1",
      originalDeadlineAt: oldPanel.evidence.originalDeadlineAt,
      qualificationId: manifest.qualificationId,
      sessionId: `10000000-0000-4000-8000-${groupIndex.toString(16).padStart(12, "0")}`,
      stages: [{ expectation, id: runId, stageDeadlineAt }],
    };
    const journal = save(root, "journal.json", {
      kind: "collector-bound-api-stage-journal-v1",
      originalDeadlineAt: evidence.originalDeadlineAt,
      qualificationId: evidence.qualificationId,
      sessionId: evidence.sessionId,
      stages: [
        {
          evidence: retainedEvidence,
          expectation,
          id: runId,
          kind: "collector-api-transport-stage-v1",
          stageDeadlineAt,
        },
      ],
    });
    const capability = Object.freeze({});
    const verified = {
      actor: API_COLLECTOR_STAGE_ACTOR,
      answers,
      answersHash: sha(canonicalJson(answers)),
      evidence: liveEvidence,
      instrumentHash: expectation.instrumentHash,
      orderedAttachments: expectation.orderedAttachments,
      originalDeadlineAt: evidence.originalDeadlineAt,
      outputSha256: expectation.outputSha256,
      promptSha256,
      requestId: expectation.requestId,
      role: expectation.role,
      routeHash: expectation.routeHash,
      settledAt: 1_900_000_000_090,
      stageDeadlineAt,
      startedAt: 1_900_000_000_080,
      transportAuthority: "installed-production-transport",
      usage: {},
    } as unknown as VerifiedApiCollectorStageEvidence;
    apiStageAuthority.capability = capability;
    apiStageAuthority.verified = verified;
    appendCollectorApiQualificationStage(assembly, {
      capability: capability as never,
      evidence,
      expectedJournalSha256: journal.sha256,
      journalFile: path.join(root, journal.file),
      runId,
    });
    for (const stimulus of stimuli) {
      const row = manifest.rows[population.stimuli.indexOf(stimulus)];
      if (!row) {
        throw new Error(`Missing hybrid row: ${stimulus.id}`);
      }
      row.panels[1] = { promptSha256, runId, stageId: runId };
    }
    manifest.runs.push({
      evidence,
      id: runId,
      journal: {
        file: `${path.basename(root)}/${journal.file}`,
        sha256: journal.sha256,
      },
    });
    appended.push({
      attachmentFiles: orderedAttachments.map(({ file }) => file),
      capability,
      evidence,
      evidenceFiles: Object.values(retainedEvidence).map(({ file }) =>
        path.join(root, file)
      ),
      journalFile: path.join(root, journal.file),
      journalSha256: journal.sha256,
      runId,
      verified,
    });
  }
  const saveManifest = () =>
    save(tmpdir(), path.basename(value.manifestFile), manifest);
  let savedManifest = saveManifest();
  const finalize = (
    candidateAssembly: CollectorApiQualificationAssemblyCapability = assembly
  ) =>
    qualifyCriticFromCollectorEvidence({
      apiQualificationAssembly: candidateAssembly,
      expectedManifestSha256: savedManifest.sha256,
      manifestFile: value.manifestFile,
    });
  return {
    appended,
    assembly,
    finalize,
    manifest,
    resaveManifest: () => {
      savedManifest = saveManifest();
    },
  };
};

test("finalizes a full hybrid row set after sequential API callbacks revoke", () => {
  const value = hybridCollectorQualificationFixture();
  expect(value.appended).toHaveLength(value.manifest.rows.length);
  expect(value.appended.length).toBeGreaterThanOrEqual(100);
  expect(apiStageAuthority.capability).toBeUndefined();
  expect(value.finalize()).toMatchObject({
    provenanceKind: "collector-bound-live-transport-evidence-v2",
    provenanceValidated: true,
    qualified: true,
  });
  expect(() => value.finalize()).toThrow(/assembly is unavailable/iu);
});

test("rejects duplicate, unlinked and cross-qualification API assembly stages", () => {
  let value = hybridCollectorQualificationFixture();
  const [first] = value.appended;
  if (!first) {
    throw new Error("Missing appended API stage");
  }
  apiStageAuthority.capability = Object.freeze({});
  apiStageAuthority.verified = first.verified;
  expect(() =>
    appendCollectorApiQualificationStage(value.assembly, {
      capability: apiStageAuthority.capability as never,
      evidence: first.evidence,
      expectedJournalSha256: first.journalSha256,
      journalFile: first.journalFile,
      runId: first.runId,
    })
  ).toThrow(/unavailable/iu);

  value = hybridCollectorQualificationFixture();
  const crossAssembly = createCollectorApiQualificationAssembly({
    exposureSidecarSha256: value.manifest.exposureSidecar.sha256,
    populationSha256: value.manifest.population.sha256,
    qualificationId: "different-qualification",
    requestedSlotsSha256: value.manifest.requestedSlots.sha256,
  });
  expect(() =>
    appendCollectorApiQualificationStage(crossAssembly, {
      capability: Object.freeze({}) as never,
      evidence: value.appended[0]?.evidence as CollectorApiTransportExpectation,
      expectedJournalSha256: value.appended[0]?.journalSha256 ?? "",
      journalFile: value.appended[0]?.journalFile ?? "",
      runId: "cross-run",
    })
  ).toThrow(/unavailable/iu);

  const extra = value.appended[0] as (typeof value.appended)[number];
  apiStageAuthority.capability = Object.freeze({});
  apiStageAuthority.verified = extra.verified;
  appendCollectorApiQualificationStage(value.assembly, {
    capability: apiStageAuthority.capability as never,
    evidence: extra.evidence,
    expectedJournalSha256: extra.journalSha256,
    journalFile: extra.journalFile,
    runId: "unlinked-api-run",
  });
  expect(() => value.finalize()).toThrow(/unlinked runs/iu);
});

test("rejects post-append API evidence, attachment and lineage changes", () => {
  let value = hybridCollectorQualificationFixture();
  const [first] = value.appended;
  if (!first) {
    throw new Error("Missing appended API stage");
  }
  writeFileSync(first.journalFile, "changed journal");
  expect(() => value.finalize()).toThrow(/hash mismatch|changed/iu);

  value = hybridCollectorQualificationFixture();
  const retainedEvidenceFile = value.appended[0]?.evidenceFiles[1];
  if (!retainedEvidenceFile) {
    throw new Error("Missing retained API evidence file");
  }
  writeFileSync(retainedEvidenceFile, "changed retained evidence");
  expect(() => value.finalize()).toThrow(
    /qualification evidence hash mismatch/iu
  );

  value = hybridCollectorQualificationFixture();
  const attachment = value.appended[0]?.attachmentFiles[0];
  if (!attachment) {
    throw new Error("Missing appended API attachment");
  }
  writeFileSync(attachment, "changed attachment");
  expect(() => value.finalize()).toThrow(/absolute evidence hash mismatch/iu);

  value = hybridCollectorQualificationFixture();
  const hardlinkedAttachment = value.appended[0]?.attachmentFiles[0];
  if (!hardlinkedAttachment) {
    throw new Error("Missing appended API attachment");
  }
  linkSync(hardlinkedAttachment, `${hardlinkedAttachment}.hardlink`);
  expect(() => value.finalize()).toThrow(/path is not canonical/iu);

  value = hybridCollectorQualificationFixture();
  const lineageFile = path.resolve(
    tmpdir(),
    value.manifest.lineageRegistry.file
  );
  const lineage = JSON.parse(readFileSync(lineageFile, "utf-8")) as {
    entries: { provider: string }[];
  };
  lineage.entries = lineage.entries.filter(
    ({ provider }) => provider !== "google"
  );
  const changed = save(
    path.dirname(lineageFile),
    path.basename(lineageFile),
    lineage
  );
  value.manifest.lineageRegistry.sha256 = changed.sha256;
  value.resaveManifest();
  expect(() => value.finalize()).toThrow(/stage identity mismatch/iu);
});

test("keeps unknown or mismatched prospective recognition out of successes", () => {
  expect(collectorQualificationFixture("mismatch").run()).toMatchObject({
    agreementMetricsQualified: false,
    provenanceValidated: true,
    qualified: false,
  });
});

test("quarantines a critical allegation even when another answer is uncertain", () => {
  const receipt = collectorQualificationFixture("match", {
    critical: "yes",
    family: "uncertain",
    ship: "no",
    stimulusId: "canonical-20",
  }).run();
  expect(
    receipt.metrics.outcomes.find(({ id }) => id === "canonical-20")
  ).toMatchObject({
    panelCritical: true,
    panelDecision: "reject",
    panelResolved: true,
  });
});

test("rejects conflicting critical and ship answers before metric derivation", () => {
  const value = collectorQualificationFixture("match", {
    critical: "yes",
    family: "uncertain",
    ship: "yes",
    stimulusId: "canonical-20",
  });
  expect(() => value.run()).toThrow(/craft answers conflict/iu);
});

test.each([
  { family: "no", native: "yes" },
  { family: "yes", native: "no" },
])(
  "rejects contradictory ship approval when family=$family and native=$native",
  ({ family, native }) => {
    const value = collectorQualificationFixture("match", {
      family,
      native,
      ship: "yes",
      stimulusId: "canonical-20",
    });
    expect(() => value.run()).toThrow(/craft answers conflict/iu);
  }
);

test("binds derived metrics into the qualification version hash", () => {
  const receipt = collectorQualificationFixture().run();
  expect(receipt.metricsHash).toMatch(/^[a-f0-9]{64}$/u);
  expect(receipt.qualificationVersionHash).not.toBe(
    sha(
      JSON.stringify({
        agreementMetricsQualified: receipt.agreementMetricsQualified,
        evidenceManifestHash: receipt.evidenceManifestHash,
        generalGeneratedCriticQualified:
          receipt.generalGeneratedCriticQualified,
        populationIdentityValidated: receipt.populationIdentityValidated,
        provenanceKind: receipt.provenanceKind,
        provenanceValidated: receipt.provenanceValidated,
        qualificationScope: receipt.qualificationScope,
        qualified: receipt.qualified,
      })
    )
  );
});

test("rejects answer-only mutation and prompt or attachment substitutions", () => {
  let value = collectorQualificationFixture();
  const predictionRun = value.manifestBody.runs.at(2);
  if (!predictionRun) {
    throw new Error("Missing fixture prediction run");
  }
  const journalFile = path.resolve(tmpdir(), predictionRun.journal.file);
  const journal = JSON.parse(readFileSync(journalFile, "utf-8")) as {
    stages: { adapterResult: { file: string } }[];
  };
  const [journalStage] = journal.stages;
  const resultFile = path.resolve(
    path.dirname(journalFile),
    journalStage.adapterResult.file
  );
  const result = JSON.parse(readFileSync(resultFile, "utf-8")) as {
    answers: Record<string, { choice: string }>;
  };
  result.answers["canonical-0-ship"].choice = "yes";
  writeFileSync(resultFile, JSON.stringify(result));
  expect(() => value.run()).toThrow(/hash mismatch/iu);

  value = collectorQualificationFixture();
  value.manifestBody.rows[0].prediction.promptSha256 =
    sha("substituted-prompt");
  let changed = save(
    tmpdir(),
    path.basename(value.manifestFile),
    value.manifestBody
  );
  expect(() =>
    qualifyCriticFromCollectorEvidence({
      expectedManifestSha256: changed.sha256,
      manifestFile: value.manifestFile,
    })
  ).toThrow(/stage linkage/iu);

  value = collectorQualificationFixture();
  value.manifestBody.runs[2].evidence.stages[0].orderedAttachments =
    value.manifestBody.runs[2].evidence.stages[0].orderedAttachments.toReversed();
  changed = save(
    tmpdir(),
    path.basename(value.manifestFile),
    value.manifestBody
  );
  expect(() =>
    qualifyCriticFromCollectorEvidence({
      expectedManifestSha256: changed.sha256,
      manifestFile: value.manifestFile,
    })
  ).toThrow(/stage|attachment/iu);
});

test("rejects post-settlement artifact attachment and row-order substitutions", () => {
  let value = collectorQualificationFixture();
  const [artifact] = value.manifestBody.artifacts;
  if (!artifact) {
    throw new Error("Missing fixture artifact binding");
  }
  artifact.attachments.reverse();
  let changed = save(
    tmpdir(),
    path.basename(value.manifestFile),
    value.manifestBody
  );
  expect(() =>
    qualifyCriticFromCollectorEvidence({
      expectedManifestSha256: changed.sha256,
      manifestFile: value.manifestFile,
    })
  ).toThrow(/attachment binding/iu);

  value = collectorQualificationFixture();
  value.manifestBody.rows.reverse();
  changed = save(
    tmpdir(),
    path.basename(value.manifestFile),
    value.manifestBody
  );
  expect(() =>
    qualifyCriticFromCollectorEvidence({
      expectedManifestSha256: changed.sha256,
      manifestFile: value.manifestFile,
    })
  ).toThrow(/population/iu);
});

test("rejects answer-only tampering, missing stages and lineage substitutions", () => {
  let value = collectorQualificationFixture();
  const resultRun = value.manifestBody.runs.at(2);
  if (!resultRun) {
    throw new Error("Missing fixture result run");
  }
  const [result] = resultRun.evidence.stages;
  result.actor.baseModelLineage = "substituted-lineage";
  const changed = save(
    tmpdir(),
    path.basename(value.manifestFile),
    value.manifestBody
  );
  expect(() =>
    qualifyCriticFromCollectorEvidence({
      expectedManifestSha256: changed.sha256,
      manifestFile: value.manifestFile,
    })
  ).toThrow(/lineage|stage/iu);

  value = collectorQualificationFixture();
  value.manifestBody.rows[0].panels = value.manifestBody.rows[0].panels.slice(
    0,
    1
  );
  const missing = save(
    tmpdir(),
    path.basename(value.manifestFile),
    value.manifestBody
  );
  expect(() =>
    qualifyCriticFromCollectorEvidence({
      expectedManifestSha256: missing.sha256,
      manifestFile: value.manifestFile,
    })
  ).toThrow();
});

test("projects hash-bearing declared mounts onto observed mount identity", () => {
  const value = collectorFixture();
  expect(value.run()).toMatchObject({
    accessTraceVerified: true,
    mountReachabilityVerified: true,
    productionEligible: false,
    sameContainerAccessVerified: true,
    stageCount: 1,
    stages: [
      {
        id: "recognition-sol",
        promptSha256: sha("prompt-recognition-sol"),
        role: "recognition",
      },
    ],
  });
});

test("rejects changed or unknown declared mount metadata", () => {
  let value = collectorFixture();
  const policy = JSON.parse(
    readFileSync(path.join(value.root, value.accessPolicy.file), "utf-8")
  );
  policy.stages[0].allowedMounts[0].sha256 = "d".repeat(64);
  const policyBinding = save(
    value.root,
    "changed-mount-hash-policy.json",
    policy
  );
  value.journalBody.accessPolicy = policyBinding;
  value.evidence.accessPolicySha256 = policyBinding.sha256;
  value.saveJournal();
  expect(value.run).toThrow("mount reachability mismatch");

  value = collectorFixture();
  const descriptor = JSON.parse(
    readFileSync(
      path.join(value.root, value.stage.containerDescriptor.file),
      "utf-8"
    )
  );
  descriptor.mounts[0].unrecognized = true;
  value.stage.containerDescriptor = save(
    value.root,
    "unknown-mount-metadata-descriptor.json",
    descriptor
  );
  value.saveJournal();
  expect(value.run).toThrow("mount reachability mismatch");
});

test("rejects readable forbidden paths and a substituted probe identity", () => {
  let value = collectorFixture();
  const receipt = JSON.parse(
    readFileSync(
      path.join(value.root, value.stage.sameContainerAccess.receipt.file),
      "utf-8"
    )
  );
  receipt.observation.observations[1] = {
    pathClass: "forbidden-0-direct",
    status: "readable",
  };
  value.stage.sameContainerAccess.receipt = save(
    value.root,
    "readable-forbidden-receipt.json",
    receipt
  );
  value.stage.sameContainerAccess.observationSha256 = sha(
    JSON.stringify(receipt.observation)
  );
  value.saveJournal();
  expect(value.run).toThrow("same-container access evidence mismatch");

  value = collectorFixture();
  value.stage.sameContainerAccess.containerId = "d".repeat(64);
  value.saveJournal();
  expect(value.run).toThrow("same-container access evidence mismatch");
});

test.each(["read-failed", "unsupported-type"])(
  "rejects a forbidden-path %s observation",
  (status) => {
    const value = collectorFixture();
    const receipt = JSON.parse(
      readFileSync(
        path.join(value.root, value.stage.sameContainerAccess.receipt.file),
        "utf-8"
      )
    );
    receipt.observation.observations[1].status = status;
    value.stage.sameContainerAccess.receipt = save(
      value.root,
      `${status}-forbidden-receipt.json`,
      receipt
    );
    value.stage.sameContainerAccess.observationSha256 = sha(
      JSON.stringify(receipt.observation)
    );
    value.saveJournal();
    expect(value.run).toThrow("same-container access evidence mismatch");
  }
);

test("rejects probe-plan drift, stale acknowledgement and security substitution", () => {
  let value = collectorFixture();
  const policy = JSON.parse(
    readFileSync(path.join(value.root, value.accessPolicy.file), "utf-8")
  );
  policy.stages[0].sameContainerAccessProbe.forbidden.pop();
  const changedPolicy = save(value.root, "changed-probe-policy.json", policy);
  value.journalBody.accessPolicy = changedPolicy;
  value.evidence.accessPolicySha256 = changedPolicy.sha256;
  value.saveJournal();
  expect(value.run).toThrow("same-container probe plan mismatch");

  value = collectorFixture();
  const currentPolicy = JSON.parse(
    readFileSync(path.join(value.root, value.accessPolicy.file), "utf-8")
  );
  writeFileSync(
    currentPolicy.stages[0].sameContainerAccessProbe.ackHostPath,
    "stale acknowledgement"
  );
  expect(value.run).toThrow("same-container access evidence mismatch");

  value = collectorFixture();
  const security = JSON.parse(
    readFileSync(
      path.join(
        value.root,
        value.stage.sameContainerAccess.securityInspect.file
      ),
      "utf-8"
    )
  );
  security[0].HostConfig.Privileged = true;
  value.stage.sameContainerAccess.securityInspect = save(
    value.root,
    "insecure-inspect.json",
    security
  );
  value.saveJournal();
  expect(value.run).toThrow("same-container access evidence mismatch");
});

test("accepts harmless Docker inspect mount reordering", () => {
  const value = collectorFixture();
  const inspect = JSON.parse(
    readFileSync(
      path.join(value.root, value.stage.containerInspectResult.file),
      "utf-8"
    )
  );
  inspect.inspected.Mounts.reverse();
  value.stage.containerInspectResult = save(
    value.root,
    "inspect-reordered.json",
    inspect
  );
  value.saveJournal();
  expect(value.run()).toMatchObject({
    mountReachabilityVerified: true,
    productionEligible: false,
  });
});

test("rejects host PID namespace and mount multiplicity drift", () => {
  let value = collectorFixture();
  let inspect = JSON.parse(
    readFileSync(
      path.join(value.root, value.stage.containerInspectResult.file),
      "utf-8"
    )
  );
  inspect.inspected.HostConfig.PidMode = "host";
  value.stage.containerInspectResult = save(
    value.root,
    "inspect-host-pid.json",
    inspect
  );
  value.saveJournal();
  expect(value.run).toThrow("mount reachability mismatch");

  value = collectorFixture();
  inspect = JSON.parse(
    readFileSync(
      path.join(value.root, value.stage.containerInspectResult.file),
      "utf-8"
    )
  );
  inspect.inspected.Mounts.push(inspect.inspected.Mounts[0]);
  value.stage.containerInspectResult = save(
    value.root,
    "inspect-duplicate-mount.json",
    inspect
  );
  value.saveJournal();
  expect(value.run).toThrow("mount reachability mismatch");
});

test("rejects a mounted hidden-key root even when a descriptor claims confinement", () => {
  const value = collectorFixture();
  const descriptor = JSON.parse(
    readFileSync(path.join(value.root, "descriptor.json"), "utf-8")
  ) as {
    mounts: { containerPath: string; hostPath: string; readOnly: boolean }[];
  };
  descriptor.mounts.push({
    containerPath: "/hidden-key",
    hostPath: value.forbiddenRoot,
    readOnly: true,
  });
  const binding = save(value.root, "descriptor-with-key.json", descriptor);
  value.stage.containerDescriptor = binding;
  const create = JSON.parse(
    readFileSync(path.join(value.root, "create.json"), "utf-8")
  ) as {
    args: string[];
  };
  create.args.splice(
    -1,
    0,
    "--mount",
    `type=bind,src=${value.forbiddenRoot},dst=/hidden-key,readonly`
  );
  value.stage.containerCreateRequest = save(
    value.root,
    "create-with-key.json",
    create
  );
  const inspect = JSON.parse(
    readFileSync(path.join(value.root, "inspect.json"), "utf-8")
  ) as {
    inspected: { Mounts: unknown[] };
  };
  inspect.inspected.Mounts.push({
    Destination: "/hidden-key",
    RW: false,
    Source: value.forbiddenRoot,
  });
  value.stage.containerInspectResult = save(
    value.root,
    "inspect-with-key.json",
    inspect
  );
  value.saveJournal();
  expect(value.run).toThrow("mount reachability mismatch");
});

test("rejects undeclared tool access and attachment substitution in raw traces", () => {
  let value = collectorFixture();
  const toolTrace = `${value.traceBody}${JSON.stringify({ payload: { type: "shell_call" }, type: "response_item" })}\n`;
  value.stage.adapterTrace = save(value.root, "tool-trace.jsonl", toolTrace);
  const result = JSON.parse(
    readFileSync(path.join(value.root, "review.json"), "utf-8")
  ) as {
    imageInspection: { traceSha256: string };
  };
  result.imageInspection.traceSha256 = value.stage.adapterTrace.sha256;
  value.stage.adapterResult = save(value.root, "tool-review.json", result);
  value.evidence.stages[0].outputSha256 = value.stage.adapterResult.sha256;
  value.saveJournal();
  expect(value.run).toThrow("trace contains tool access");

  value = collectorFixture();
  value.evidence.stages[0].orderedAttachments[0].sha256 = sha("other");
  value.saveJournal();
  expect(value.run).toThrow("trace attachment evidence mismatch");
});

test("rejects identity, terminal and output substitutions", () => {
  let value = collectorFixture();
  const identity = JSON.parse(
    readFileSync(path.join(value.root, "identity.json"), "utf-8")
  ) as {
    containerId: string;
  };
  identity.containerId = "c".repeat(64);
  value.stage.containerIdentity = save(
    value.root,
    "wrong-identity.json",
    identity
  );
  value.saveJournal();
  expect(value.run).toThrow("native evidence mismatch");

  value = collectorFixture();
  const terminal = JSON.parse(
    readFileSync(path.join(value.root, "terminal.json"), "utf-8")
  ) as {
    outcome: string;
  };
  terminal.outcome = "failed";
  value.stage.nativeTerminal = save(
    value.root,
    "failed-terminal.json",
    terminal
  );
  value.saveJournal();
  expect(value.run).toThrow("native evidence mismatch");

  value = collectorFixture();
  value.evidence.stages[0].outputSha256 = sha("substituted-output");
  expect(value.run).toThrow("stage is missing");
});

test("rejects duplicate expected stages and route substitution", () => {
  let value = collectorFixture();
  value.evidence.stages = [value.evidence.stages[0], value.evidence.stages[0]];
  expect(value.run).toThrow("expectation is invalid");

  value = collectorFixture();
  value.evidence.stages[0].routeHash = sha("another-route");
  expect(value.run).toThrow("pre-dispatch access policy mismatch");
});

test("rejects access-policy tampering and a replaced writable directory", () => {
  let value = collectorFixture();
  writeFileSync(path.join(value.root, value.accessPolicy.file), "{}\n");
  expect(value.run).toThrow("hash mismatch");

  value = collectorFixture();
  const policy = JSON.parse(
    readFileSync(path.join(value.root, value.accessPolicy.file), "utf-8")
  );
  policy.stages[0].writableDirectory.inode = "0";
  const replacement = save(value.root, "replacement-policy.json", policy);
  value.journalBody.accessPolicy = replacement;
  value.evidence.accessPolicySha256 = replacement.sha256;
  value.saveJournal();
  expect(value.run).toThrow("mount reachability mismatch");
});

test("rejects an extra mount even when Docker records agree", () => {
  const value = collectorFixture();
  const extraRoot = mkdtempSync(path.join(tmpdir(), "collector-extra-"));
  roots.push(extraRoot);
  const descriptor = JSON.parse(
    readFileSync(path.join(value.root, "descriptor.json"), "utf-8")
  );
  descriptor.mounts.push({
    containerPath: "/extra",
    hostPath: extraRoot,
    readOnly: true,
  });
  value.stage.containerDescriptor = save(
    value.root,
    "descriptor-extra.json",
    descriptor
  );
  const create = JSON.parse(
    readFileSync(path.join(value.root, "create.json"), "utf-8")
  );
  create.args.splice(
    -1,
    0,
    "--mount",
    `type=bind,src=${extraRoot},dst=/extra,readonly`
  );
  value.stage.containerCreateRequest = save(
    value.root,
    "create-extra.json",
    create
  );
  const inspect = JSON.parse(
    readFileSync(path.join(value.root, "inspect.json"), "utf-8")
  );
  inspect.inspected.Mounts.push({
    Destination: "/extra",
    RW: false,
    Source: extraRoot,
  });
  value.stage.containerInspectResult = save(
    value.root,
    "inspect-extra.json",
    inspect
  );
  value.saveJournal();
  expect(value.run).toThrow("mount reachability mismatch");
});

test("rejects absent container identity and invalid terminal timing", () => {
  let value = collectorFixture();
  value.stage.containerIdentity = save(
    value.root,
    "missing-container-id.json",
    {
      image:
        "iconsmith/native@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }
  );
  value.saveJournal();
  expect(value.run).toThrow("native evidence mismatch");

  value = collectorFixture();
  const terminal = JSON.parse(
    readFileSync(path.join(value.root, "terminal.json"), "utf-8")
  ) as {
    deadlineExceeded: boolean;
    settledAt: number;
  };
  terminal.deadlineExceeded = true;
  terminal.settledAt = value.evidence.originalDeadlineAt;
  value.stage.nativeTerminal = save(value.root, "late-terminal.json", terminal);
  value.saveJournal();
  expect(value.run).toThrow("native evidence mismatch");

  value = collectorFixture();
  const started = JSON.parse(
    readFileSync(path.join(value.root, "started.json"), "utf-8")
  ) as {
    intentHash: string;
    startedAt?: number;
  };
  delete started.startedAt;
  value.stage.nativeStarted = save(
    value.root,
    "missing-start-time.json",
    started
  );
  value.saveJournal();
  expect(value.run).toThrow("native evidence mismatch");
});

test("rejects alternate volume syntax instead of ignoring an accessible mount", () => {
  const value = collectorFixture();
  const create = JSON.parse(
    readFileSync(path.join(value.root, "create.json"), "utf-8")
  ) as {
    args: string[];
  };
  create.args.splice(-1, 0, "-v", `${value.forbiddenRoot}:/hidden-key:ro`);
  value.stage.containerCreateRequest = save(
    value.root,
    "create-volume.json",
    create
  );
  value.saveJournal();
  expect(value.run).toThrow("unsupported mount syntax");
});

test("resolves mount paths before checking forbidden-root overlap", () => {
  const value = collectorFixture();
  const alias = path.join(value.root, "key-alias");
  symlinkSync(value.forbiddenRoot, alias);
  const descriptor = JSON.parse(
    readFileSync(path.join(value.root, "descriptor.json"), "utf-8")
  ) as {
    mounts: { containerPath: string; hostPath: string; readOnly: boolean }[];
  };
  descriptor.mounts.push({
    containerPath: "/hidden-key",
    hostPath: alias,
    readOnly: true,
  });
  value.stage.containerDescriptor = save(
    value.root,
    "descriptor-key-alias.json",
    descriptor
  );
  const create = JSON.parse(
    readFileSync(path.join(value.root, "create.json"), "utf-8")
  ) as {
    args: string[];
  };
  create.args.splice(
    -1,
    0,
    "--mount",
    `type=bind,src=${alias},dst=/hidden-key,readonly`
  );
  value.stage.containerCreateRequest = save(
    value.root,
    "create-key-alias.json",
    create
  );
  const inspect = JSON.parse(
    readFileSync(path.join(value.root, "inspect.json"), "utf-8")
  ) as {
    inspected: { Mounts: unknown[] };
  };
  inspect.inspected.Mounts.push({
    Destination: "/hidden-key",
    RW: false,
    Source: alias,
  });
  value.stage.containerInspectResult = save(
    value.root,
    "inspect-key-alias.json",
    inspect
  );
  value.saveJournal();
  expect(value.run).toThrow("mount reachability mismatch");
});

const productionCriticReviewFixture = (recognitionBytesOverride?: Buffer) => {
  const qualification = collectorQualificationFixture();
  const qualificationReceipt = qualification.run();
  const reviewId = "production-review-v1";
  const slotId = "catalog/heart/16/outlined";
  const requestIntentHash = sha("heart-16-request");
  const artifactBytes = Buffer.from("exact-heart-svg");
  const lightBytes = Buffer.from("exact-heart-light-native-png");
  const darkBytes = Buffer.from("exact-heart-dark-native-png");
  const recognitionBytes = recognitionBytesOverride ?? lightBytes;
  const nativePresentationHashes = [sha(lightBytes), sha(darkBytes)] as const;
  const subject = {
    artifactHash: sha(artifactBytes),
    conceptId: "heart",
    familyId: "heart",
    master: "outlined.svg",
    nativePresentationHashes,
    nativeSize: 16 as const,
    paint: "outlined" as const,
    requestIntentHash,
    slotId,
  };
  const answers = Object.fromEntries(
    [
      ["craft", "9"],
      ["critical", "no"],
      ["family", "yes"],
      ["native", "yes"],
      ["ship", "yes"],
    ].map(([suffix, choice]) => [
      `${slotId}-${suffix}`,
      craftAnswer(choice ?? ""),
    ])
  );
  const stageValue = collectorFixture({
    answers,
    attachments: [
      { bytes: lightBytes, name: "candidate-light.png" },
      { bytes: darkBytes, name: "candidate-dark.png" },
    ],
    id: "production-critic-heart",
    instrumentHash: sha("critic-instrument-v1"),
    model: "critic",
    nativeStage: "00-production-critic",
    promptSha256: sha("prompt-production-critic"),
    qualificationId: reviewId,
    role: "production-critic",
    sessionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    settledAt: 1_900_000_000_060,
    startedAt: 1_900_000_000_050,
    subject,
  });
  const recognitionAnswer = craftAnswer("described");
  const recognitionValue = collectorFixture({
    answers: {
      [`${slotId}-free-recognition`]: recognitionAnswer,
    },
    attachments: [{ bytes: recognitionBytes, name: "recognition.png" }],
    id: "production-recognition-heart",
    instrumentHash: sha("blind-recognition-instrument-v1"),
    model: "critic",
    nativeStage: "00-production-recognition",
    promptSha256: sha("prompt-production-recognition"),
    qualificationId: reviewId,
    role: "recognition",
    sessionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    settledAt: 1_900_000_000_020,
    startedAt: 1_900_000_000_010,
    subject,
  });
  const synonymKeyBody = {
    kind: "sealed-production-synonym-key-v1",
    meanings: ["heart"],
    slotId,
    synonyms: ["love"],
  };
  const synonymKey = save(
    recognitionValue.root,
    "synonym-key.json",
    synonymKeyBody
  );
  const adjudicationInput = save(
    recognitionValue.root,
    "adjudication-input.json",
    {
      kind: "sealed-production-recognition-adjudication-input-v1",
      recognitionAnswer,
      recognitionOutputSha256: recognitionValue.stage.expectation.outputSha256,
      slotId,
      synonymKey: synonymKeyBody,
      synonymKeySha256: synonymKey.sha256,
    }
  );
  const adjudicationValue = collectorFixture({
    answers: {
      [`${slotId}-synonym-adjudication`]: craftAnswer("match"),
    },
    attachments: [],
    id: "production-adjudication-heart",
    model: "adjudicator",
    nativeStage: "01-production-adjudication",
    promptSha256: adjudicationInput.sha256,
    qualificationId: reviewId,
    role: "adjudication",
    sessionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    settledAt: 1_900_000_000_040,
    startedAt: 1_900_000_000_030,
  });
  const saveBytes = (file: string, bytes: Buffer) => {
    writeFileSync(path.join(stageValue.root, file), bytes);
    return { file, sha256: sha(bytes) };
  };
  const artifact = saveBytes("candidate.svg", artifactBytes);
  const light = saveBytes("candidate-light.png", lightBytes);
  const dark = saveBytes("candidate-dark.png", darkBytes);
  const recognitionPresentation = saveBytes(
    "recognition.png",
    recognitionBytes
  );
  const authorReceipt = save(stageValue.root, "author-receipt.json", {
    authorId: "caller-asserted-author",
    authorLineage: "caller-asserted-lineage",
    kind: "unverified-author-claim",
  });
  const body = {
    contractVersion: ACCEPTANCE_CONTRACT_VERSION,
    kind: "collector-production-critic-review-manifest-v3" as const,
    qualificationManifestSha256: qualification.manifest.sha256,
    reviewId,
    rows: [
      {
        adjudication: {
          promptSha256: adjudicationInput.sha256,
          runId: "adjudication",
          stageId: "production-adjudication-heart",
        },
        adjudicationInput: prefixBinding(
          recognitionValue.root,
          adjudicationInput
        ),
        artifact: prefixBinding(stageValue.root, artifact),
        authorReceipt: prefixBinding(stageValue.root, authorReceipt),
        conceptId: subject.conceptId,
        familyId: subject.familyId,
        master: subject.master,
        nativePresentations: [
          {
            ...prefixBinding(stageValue.root, light),
            surface: "light" as const,
          },
          { ...prefixBinding(stageValue.root, dark), surface: "dark" as const },
        ],
        nativeSize: subject.nativeSize,
        paint: subject.paint,
        recognition: {
          promptSha256: sha("prompt-production-recognition"),
          runId: "recognition",
          stageId: "production-recognition-heart",
        },
        recognitionInstrumentHash: sha("blind-recognition-instrument-v1"),
        recognitionPresentation: prefixBinding(
          stageValue.root,
          recognitionPresentation
        ),
        recognitionSurface: "light" as const,
        requestIntentHash,
        slotId,
        stage: {
          promptSha256: sha("prompt-production-critic"),
          runId: "production",
          stageId: "production-critic-heart",
        },
        synonymKey: prefixBinding(recognitionValue.root, synonymKey),
      },
    ],
    runs: [
      {
        evidence: recognitionValue.evidence,
        id: "recognition",
        journal: {
          file: `${path.basename(recognitionValue.root)}/journal.json`,
          sha256: sha(
            readFileSync(path.join(recognitionValue.root, "journal.json"))
          ),
        },
      },
      {
        evidence: adjudicationValue.evidence,
        id: "adjudication",
        journal: {
          file: `${path.basename(adjudicationValue.root)}/journal.json`,
          sha256: sha(
            readFileSync(path.join(adjudicationValue.root, "journal.json"))
          ),
        },
      },
      {
        evidence: stageValue.evidence,
        id: "production",
        journal: {
          file: `${path.basename(stageValue.root)}/journal.json`,
          sha256: sha(readFileSync(path.join(stageValue.root, "journal.json"))),
        },
      },
    ],
  };
  const run = () => {
    const manifestFile = path.join(
      tmpdir(),
      `production-review-${Date.now()}-${Math.random()}.json`
    );
    const bytes = JSON.stringify(body);
    writeFileSync(manifestFile, bytes);
    roots.push(manifestFile);
    return verifyProductionCriticReviewsFromCollectorEvidence({
      expectedManifestSha256: sha(bytes),
      manifestFile,
      qualification: qualificationReceipt,
    });
  };
  return { body, run, stageValue };
};

test("derives production critic stage identity but withholds author authority", () => {
  const value = productionCriticReviewFixture();
  expect(value.run()).toMatchObject({
    authorEvidenceVerified: false,
    kind: "verified-production-critic-review-set-v1",
    reviews: [
      {
        artifactHash: sha("exact-heart-svg"),
        craftRating: 9,
        criticalDefect: false,
        familyFit: true,
        labels: {
          craftRating: 9,
          criticalDefect: false,
          familyFit: true,
          nativeLegibility: true,
          recognitionAdjudication: "match",
          recognitionChoice: "described",
          recognitionCorrect: true,
          shipUnchanged: true,
        },
        nativeLegibility: true,
        paint: "outlined",
        recognitionAdjudication: "match",
        recognitionChoice: "described",
        recognitionCorrect: true,
        recognitionEvidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        reviewEvidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        reviewerId: expect.stringMatching(/^[a-f0-9]{64}$/u),
        shipUnchanged: true,
        slotId: "catalog/heart/16/outlined",
      },
    ],
  });
});

test.each([
  [
    "slot",
    (row: Record<string, unknown>) =>
      (row.slotId = "catalog/other/16/outlined"),
  ],
  ["paint", (row: Record<string, unknown>) => (row.paint = "filled")],
  ["master", (row: Record<string, unknown>) => (row.master = "filled.svg")],
  [
    "light-dark order",
    (row: Record<string, unknown>) =>
      (row.nativePresentations = [
        ...(row.nativePresentations as unknown[]),
      ].toReversed()),
  ],
])("rejects a production critic %s substitution", (_label, mutate) => {
  const value = productionCriticReviewFixture();
  mutate(value.body.rows[0] as unknown as Record<string, unknown>);
  expect(value.run).toThrow("Production critic stage linkage mismatch");
});

test("rejects a self-consistent unrelated recognition presentation", () => {
  const value = productionCriticReviewFixture(
    Buffer.from("unrelated exact png")
  );
  expect(value.run).toThrow("Production critic stage linkage mismatch");
});

test("rejects adjudication detached from recognition output and synonym key", () => {
  const value = productionCriticReviewFixture();
  const detached = save(value.stageValue.root, "detached-adjudication.json", {
    kind: "sealed-production-recognition-adjudication-input-v1",
    recognitionAnswer: craftAnswer("described"),
    recognitionOutputSha256: sha("unrelated recognition output"),
    slotId: value.body.rows[0].slotId,
    synonymKey: {
      kind: "sealed-production-synonym-key-v1",
      meanings: ["heart"],
      slotId: value.body.rows[0].slotId,
      synonyms: ["love"],
    },
    synonymKeySha256: value.body.rows[0].synonymKey.sha256,
  });
  value.body.rows[0].adjudicationInput = {
    file: `${path.basename(value.stageValue.root)}/${detached.file}`,
    sha256: detached.sha256,
  };
  value.body.rows[0].adjudication.promptSha256 = detached.sha256;
  expect(value.run).toThrow("Production critic stage linkage mismatch");
});

test("does not promote a self-consistent forged author lineage claim", () => {
  const value = productionCriticReviewFixture();
  const forged = save(value.stageValue.root, "forged-author.json", {
    authorId: "critic",
    authorLineage: "critic",
    kind: "generated-candidate-evidence",
  });
  const [row] = value.body.rows;
  if (!row) {
    throw new Error("Missing production critic row fixture");
  }
  row.authorReceipt = {
    file: `${path.basename(value.stageValue.root)}/${forged.file}`,
    sha256: forged.sha256,
  };
  expect(value.run()).toMatchObject({ authorEvidenceVerified: false });
});

test("rejects missing or substituted production recognition linkage", () => {
  let value = productionCriticReviewFixture();
  value.body.rows[0].recognition.promptSha256 = sha("unrelated-recognition");
  expect(value.run).toThrow("Production critic stage linkage mismatch");

  value = productionCriticReviewFixture();
  value.body.runs = value.body.runs.filter(({ id }) => id !== "adjudication");
  expect(value.run).toThrow("Production critic stage linkage mismatch");
});

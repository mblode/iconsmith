import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createStyleRevision } from "../src/pipeline/style.js";
import { DEVELOPMENT_FAMILIES } from "./quality-population.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

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

type CampaignTerminalStatus =
  | "accepted"
  | "construction-failed"
  | "deadline-exhausted"
  | "delivery-incomplete"
  | "ai-rejected"
  | "pending-independent-review"
  | "refused";

export interface CampaignResult {
  requestId: string;
  slotId: string;
  status: CampaignTerminalStatus;
  artifactHash: string | null;
  elapsedMs: number | null;
  actualUsd: number | null;
}

interface CorpusRecord {
  set: string;
  slug: string;
}

interface CorpusManifest {
  sources: { id: string; records: number; treeHash: string }[];
}

const slotsFor = (concepts: readonly { concept: string; family: string }[]) =>
  concepts.flatMap(({ concept, family }) =>
    ([16, 24] as const).flatMap((nativeSize) =>
      (["outlined", "filled"] as const).map((finish) => ({
        concept,
        family,
        finish,
        nativeSize,
        slotId: `${family}/${concept}/${nativeSize}/${finish}`,
      }))
    )
  );

export const createCampaignManifest = (
  kind: "catalog" | "development",
  corpusManifest: CorpusManifest,
  records: readonly CorpusRecord[],
  conceptOrder?: readonly string[]
) => {
  const source = corpusManifest.sources.find(({ id }) => id === "blode-icons");
  if (
    !source ||
    corpusManifest.sources.filter(({ id }) => id === "blode-icons").length !==
      1 ||
    !Number.isInteger(source.records) ||
    source.records <= 0 ||
    !/^[a-f0-9]{64}$/u.test(source.treeHash)
  ) {
    throw new Error("Missing pinned blode-icons source identity");
  }
  const baseConcepts =
    kind === "development"
      ? DEVELOPMENT_FAMILIES.map(({ concept, family }) => ({ concept, family }))
      : records
          .filter(({ set }) => set === "blode-icons")
          .map(({ slug }) => ({ concept: slug, family: slug }))
          .toSorted((left, right) => left.concept.localeCompare(right.concept));
  if (
    conceptOrder !== undefined &&
    (kind !== "development" ||
      conceptOrder.length !== baseConcepts.length ||
      new Set(conceptOrder).size !== baseConcepts.length ||
      conceptOrder.some(
        (concept) => !baseConcepts.some((row) => row.concept === concept)
      ))
  ) {
    throw new Error(
      "Development order must contain every frozen concept exactly once"
    );
  }
  const concepts =
    conceptOrder === undefined
      ? baseConcepts
      : conceptOrder.flatMap((concept) =>
          baseConcepts.filter((row) => row.concept === concept)
        );
  if (
    concepts.length !== (kind === "development" ? 20 : source.records) ||
    new Set(concepts.map(({ concept }) => concept)).size !== concepts.length
  ) {
    throw new Error("Campaign concepts do not match the pinned inventory");
  }
  const slots = slotsFor(concepts);
  const body = {
    assumptions: {
      deadlineMsPerConceptSizePair: 1_200_000,
      outputsPerConceptSizePair: 2,
      providerCost: "unknown-until-receipted",
    },
    campaign: `blode-quality-${kind}-v1`,
    concepts,
    kind,
    slots,
    source: {
      concepts: source.records,
      id: "blode-icons",
      treeHash: source.treeHash,
    },
  };
  const pairRequests = concepts.length * 2;
  return {
    hash: digest(canonical(body)),
    manifest: body,
    resources: {
      maximumDeadlineHours: (pairRequests * 1_200_000) / 3_600_000,
      outputSlots: slots.length,
      pairRequests,
      providerCostUsd: null,
    },
  };
};

// P1.10 is a fixed reliability population, independent of route selection and catalog qualification.
export const createReliabilityReplayManifest = (corpus: CorpusManifest) => {
  const base = createCampaignManifest("development", corpus, []);
  const requests = [
    { concept: "folder-lock", family: "folder", master: 16, role: "failure" },
    { concept: "hammer-check", family: "hammer", master: 16, role: "failure" },
    { concept: "bell-pause", family: "bell", master: 24, role: "failure" },
    { concept: "folder-lock", family: "folder", master: 24, role: "failure" },
    { concept: "cloud-upload", family: "cloud", master: 24, role: "control" },
    { concept: "bicycle", family: "bicycle", master: 16, role: "control" },
  ] as const;
  const concepts = requests.flatMap(({ concept, family }, index) =>
    requests.findIndex((row) => row.concept === concept) === index
      ? [{ concept, family }]
      : []
  );
  const slots = requests.flatMap(({ concept, family, master }) =>
    (["outlined", "filled"] as const).map((finish) => ({
      concept,
      family,
      finish,
      nativeSize: master,
      slotId: `${family}/${concept}/${master}/${finish}`,
    }))
  );
  const manifest = {
    ...base.manifest,
    campaign: "blode-quality-reliability-replay-v1",
    concepts,
    kind: "reliability-replay" as const,
    population: {
      historicalIntent: "A126",
      historicalIntentSha256:
        "432075265e1c5baa6ec7c8ffc56ae487b9cb93b70f8bf8ce26d8431658c82080",
      scope: "six exposed development requests; no historical outcome reuse",
    },
    requests,
    slots,
  };
  return {
    hash: digest(canonical(manifest)),
    manifest,
    resources: {
      maximumDeadlineHours: 2,
      outputSlots: 12,
      pairRequests: 6,
      providerCostUsd: null,
    },
  };
};

export const loadCorpusRecords = (file: string): CorpusRecord[] =>
  readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

// Terminal/accounting validation is intentionally centralized at this boundary.
// eslint-disable-next-line complexity
export const reportCampaign = (
  frozen:
    | ReturnType<typeof createCampaignManifest>
    | ReturnType<typeof createReliabilityReplayManifest>,
  results: readonly CampaignResult[]
) => {
  if (digest(canonical(frozen.manifest)) !== frozen.hash) {
    throw new Error("Frozen campaign manifest changed");
  }
  const expected = new Set(frozen.manifest.slots.map(({ slotId }) => slotId));
  const observed = new Set<string>();
  const requests = new Map<
    string,
    { actualUsd: number | null; elapsedMs: number | null; pairId: string }
  >();
  const pairRequests = new Map<string, string>();
  const failures: Record<string, number> = {};
  let actualUsd = 0;
  let unknownCost = 0;
  let elapsedMs = 0;
  for (const result of results) {
    if (!expected.has(result.slotId) || observed.has(result.slotId)) {
      throw new Error(
        `Unexpected or duplicate campaign result: ${result.slotId}`
      );
    }
    observed.add(result.slotId);
    if (typeof result.requestId !== "string" || !result.requestId.trim()) {
      throw new Error(`Missing request identity: ${result.slotId}`);
    }
    const prior = requests.get(result.requestId);
    const slot = frozen.manifest.slots.find(
      ({ slotId }) => slotId === result.slotId
    );
    const pairId = `${slot?.family}/${slot?.concept}/${slot?.nativeSize}`;
    if (
      prior &&
      (prior.actualUsd !== result.actualUsd ||
        prior.elapsedMs !== result.elapsedMs ||
        prior.pairId !== pairId)
    ) {
      throw new Error(`Inconsistent request accounting: ${result.requestId}`);
    }
    const priorRequestId = pairRequests.get(pairId);
    if (priorRequestId && priorRequestId !== result.requestId) {
      throw new Error(`Pair split across request identities: ${pairId}`);
    }
    pairRequests.set(pairId, result.requestId);
    requests.set(result.requestId, {
      actualUsd: result.actualUsd,
      elapsedMs: result.elapsedMs,
      pairId,
    });
    if (result.status !== "accepted") {
      failures[result.status] = (failures[result.status] ?? 0) + 1;
    }
    if (
      result.elapsedMs !== null &&
      result.elapsedMs >
        frozen.manifest.assumptions.deadlineMsPerConceptSizePair &&
      result.status !== "deadline-exhausted"
    ) {
      throw new Error(
        `Over-deadline result has inconsistent status: ${result.slotId}`
      );
    }
    if (
      result.status === "accepted" &&
      !(result.artifactHash && /^[a-f0-9]{64}$/u.test(result.artifactHash))
    ) {
      throw new Error(
        `Accepted result lacks an artifact hash: ${result.slotId}`
      );
    }
  }
  for (const [requestId, request] of requests) {
    if (request.actualUsd === null) {
      unknownCost += 1;
    } else if (Number.isFinite(request.actualUsd) && request.actualUsd >= 0) {
      actualUsd += request.actualUsd;
    } else {
      throw new Error(`Invalid cost for request ${requestId}`);
    }
    if (request.elapsedMs !== null) {
      if (!Number.isFinite(request.elapsedMs) || request.elapsedMs < 0) {
        throw new Error(`Invalid elapsed time for request ${requestId}`);
      }
      elapsedMs += request.elapsedMs;
    }
  }
  const missingRequests = frozen.resources.pairRequests - pairRequests.size;
  unknownCost += missingRequests;
  return {
    accepted: results.filter(({ status }) => status === "accepted").length,
    actualUsd: unknownCost ? null : actualUsd,
    allRowsAccepted:
      observed.size === expected.size && Object.keys(failures).length === 0,
    coverageComplete: observed.size === expected.size,
    elapsedMs,
    expected: expected.size,
    failures,
    manifestHash: frozen.hash,
    missing: expected.size - observed.size,
    missingRequests,
    observed: observed.size,
    qualified: false,
    receiptedUsd: actualUsd,
    requests: requests.size,
    unknownCost,
  };
};

export const writeCampaignManifest = (
  out: string,
  kind: "catalog" | "development",
  corpusManifestFile: string,
  recordsFile: string
) => {
  const frozen = createCampaignManifest(
    kind,
    JSON.parse(readFileSync(corpusManifestFile, "utf-8")),
    loadCorpusRecords(recordsFile)
  );
  writeFileSync(out, `${JSON.stringify(frozen, null, 2)}\n`, { flag: "wx" });
  return frozen;
};

/** Prepare a development input bundle without dispatching a provider. Supplied
 * source and revision identities are preserved; no model or compiler fallback. */
export const prepareDevelopmentCampaignInputs = (options: {
  baseRevisionFile: string;
  conceptOrder?: readonly string[];
  corpusManifestFile: string;
  meaningsFile: string;
  out: string;
}) => {
  const inputs = [
    options.baseRevisionFile,
    options.corpusManifestFile,
    options.meaningsFile,
  ].map((file) => {
    const metadata = lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("Preparation requires regular input files");
    }
    const bytes = readFileSync(file, "utf-8");
    return {
      file: path.resolve(file),
      sha256: digest(bytes),
      value: JSON.parse(bytes),
    };
  });
  const [revisionInput, corpusInput, meaningsInput] = inputs;
  if (!revisionInput || !corpusInput || !meaningsInput) {
    throw new Error("Incomplete preparation inputs");
  }
  const revision = createStyleRevision(revisionInput.value);
  if (
    revision.definition.parts.length ||
    [16, 24].some(
      (size) =>
        revision.definition.masters[String(size)]?.size !== size ||
        !revision.definition.references.some(
          (reference) => reference.master === String(size)
        )
    )
  ) {
    throw new Error(
      "Automatic development inputs require empty parts and reference-bearing native16/native24 masters"
    );
  }
  const frozen = createCampaignManifest(
    "development",
    corpusInput.value,
    [],
    options.conceptOrder
  );
  const meanings: unknown = meaningsInput.value;
  if (
    !meanings ||
    typeof meanings !== "object" ||
    Array.isArray(meanings) ||
    Object.keys(meanings).length !== frozen.manifest.concepts.length
  ) {
    throw new Error(
      "Development meanings must cover the exact frozen concepts"
    );
  }
  const meaningRows = frozen.manifest.concepts.map(({ concept }) => {
    const values: unknown = (meanings as Record<string, unknown>)[concept];
    if (
      !Array.isArray(values) ||
      values.length < 3 ||
      !values.includes(concept) ||
      new Set(values).size !== values.length ||
      values.some(
        (value) =>
          typeof value !== "string" || !value.trim() || value === "uncertain"
      )
    ) {
      throw new Error(`Invalid development choices: ${concept}`);
    }
    return { concept, values };
  });
  const out = path.resolve(options.out);
  mkdirSync(out, { mode: 0o700 });
  mkdirSync(path.join(out, "meanings"), { mode: 0o700 });
  const artifacts: { file: string; sha256: string }[] = [];
  const save = (file: string, value: unknown) => {
    const bytes = `${JSON.stringify(value, null, 2)}\n`;
    writeFileSync(path.join(out, file), bytes, { flag: "wx", mode: 0o600 });
    artifacts.push({ file, sha256: digest(bytes) });
  };
  save("manifest.json", frozen);
  save("base-revision.json", revisionInput.value);
  for (const { concept, values } of meaningRows) {
    save(`meanings/${concept}.json`, values);
  }
  const receipt = {
    artifacts,
    campaignHash: frozen.hash,
    inputs: inputs.map(({ file, sha256 }) => ({ file, sha256 })),
    kind: "development-input-preparation-v1",
    meaningsScope:
      "offered-label development choices; not independently validated free recognition",
    outputSlots: frozen.resources.outputSlots,
    pairRequests: frozen.resources.pairRequests,
    providerCalls: 0,
    qualified: false,
    revisionHash: revision.hash,
    status: "prepared-no-dispatch",
  };
  writeFileSync(
    path.join(out, "prep.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: "wx", mode: 0o600 }
  );
  return receipt;
};

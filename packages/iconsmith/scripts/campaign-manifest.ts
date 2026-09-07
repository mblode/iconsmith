import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

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

export type CampaignTerminalStatus =
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
  records: readonly CorpusRecord[]
) => {
  const source = corpusManifest.sources.find(({ id }) => id === "blode-icons");
  if (!source || !/^[a-f0-9]{64}$/u.test(source.treeHash)) {
    throw new Error("Missing pinned blode-icons source identity");
  }
  const concepts =
    kind === "development"
      ? DEVELOPMENT_FAMILIES.map(({ concept, family }) => ({ concept, family }))
      : records
          .filter(({ set }) => set === "blode-icons")
          .map(({ slug }) => ({ concept: slug, family: slug }))
          .toSorted((left, right) => left.concept.localeCompare(right.concept));
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

export const loadCorpusRecords = (file: string): CorpusRecord[] =>
  readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

// Terminal/accounting validation is intentionally centralized at this boundary.
// eslint-disable-next-line complexity
export const reportCampaign = (
  frozen: ReturnType<typeof createCampaignManifest>,
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

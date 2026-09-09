/** Metadata-only exposure receipts and fail-closed novel split validation. */
import { createHash } from "node:crypto";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const HASH = /^[a-f0-9]{64}$/u;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const normalize = (value: string) =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");

export interface ExposureIdentity {
  catalogHash: string;
  clusterHash: string;
  libraryHash: string;
}
type ExposureInputKind = "anchor" | "cache" | "candidate" | "packet" | "part";
interface ExposureLineage {
  artifactHash: string;
  clusterId: string | null;
  semanticFamily: string | null;
}
export interface ExposureEntry {
  aliases: readonly string[];
  artifactHash: string;
  clusterId: string | null;
  id: string;
  kind: ExposureInputKind;
  lineage: readonly ExposureLineage[];
  semanticFamily: string | null;
}
export interface ExposureLedger {
  entries: readonly ExposureEntry[];
  identity: ExposureIdentity;
  previousHash: string | null;
  qualification: false;
  receiptHash: string;
  version: 1;
}
interface NovelFamily {
  aliases: readonly string[];
  clusterIds: readonly string[];
  family: string;
}
export interface NovelBatch {
  families: readonly NovelFamily[];
  id: string;
}

const bodyOf = ({ receiptHash: _, ...body }: ExposureLedger) => body;
const assertIdentity = (identity: ExposureIdentity) => {
  const names = ["catalogHash", "clusterHash", "libraryHash"] as const;
  if (
    typeof identity !== "object" ||
    identity === null ||
    Object.keys(identity).toSorted().join(",") !== names.toSorted().join(",")
  ) {
    throw new Error(
      "Exposure identity must contain exact catalog, cluster, and library hashes"
    );
  }
  for (const name of names) {
    const value = identity[name];
    if (!HASH.test(value)) {
      throw new Error(`Missing or invalid ${name}`);
    }
  }
};
// Receipt validation deliberately checks every nested identity field.
// eslint-disable-next-line complexity
export const assertExposureLedger = (ledger: ExposureLedger) => {
  assertIdentity(ledger.identity);
  if (ledger.version !== 1 || ledger.qualification !== false) {
    throw new Error("Invalid exposure ledger authority");
  }
  if (ledger.previousHash !== null && !HASH.test(ledger.previousHash)) {
    throw new Error("Invalid previous exposure receipt hash");
  }
  if (sha(canonical(bodyOf(ledger))) !== ledger.receiptHash) {
    throw new Error("Exposure ledger hash mismatch");
  }
  const ids = new Set<string>();
  for (const entry of ledger.entries) {
    if (!entry.id.trim() || ids.has(entry.id)) {
      throw new Error(`Duplicate exposure id: ${entry.id}`);
    }
    ids.add(entry.id);
    if (!HASH.test(entry.artifactHash)) {
      throw new Error(`Invalid artifact hash: ${entry.id}`);
    }
    if (!entry.semanticFamily?.trim() || !entry.clusterId?.trim()) {
      throw new Error(`Unclassified exposure: ${entry.id}`);
    }
    if (!entry.lineage.length) {
      throw new Error(`Missing lineage: ${entry.id}`);
    }
    for (const row of entry.lineage) {
      if (!HASH.test(row.artifactHash)) {
        throw new Error(`Invalid lineage hash: ${entry.id}`);
      }
      if (!row.semanticFamily?.trim() || !row.clusterId?.trim()) {
        throw new Error(`Unclassified derivative lineage: ${entry.id}`);
      }
    }
  }
  return ledger;
};
export const createExposureLedger = (
  identity: ExposureIdentity,
  entries: readonly ExposureEntry[],
  previousHash: string | null = null
): ExposureLedger => {
  assertIdentity(identity);
  const body = {
    entries: [...entries],
    identity,
    previousHash,
    qualification: false as const,
    version: 1 as const,
  };
  return assertExposureLedger({ ...body, receiptHash: sha(canonical(body)) });
};
export const appendExposureLedger = (
  previous: ExposureLedger,
  entries: readonly ExposureEntry[],
  identity = previous.identity
) => {
  assertExposureLedger(previous);
  if (canonical(identity) !== canonical(previous.identity)) {
    throw new Error("Exposure identity changed during append");
  }
  return createExposureLedger(
    identity,
    [...previous.entries, ...entries],
    previous.receiptHash
  );
};

// Split validation accumulates all independent leakage reasons in one pass.
// eslint-disable-next-line complexity
export const validateNovelSplits = (input: {
  batches: readonly [NovelBatch, NovelBatch];
  identity: ExposureIdentity;
  ledger: ExposureLedger;
}) => {
  const reasons: string[] = [];
  try {
    assertExposureLedger(input.ledger);
  } catch (error) {
    return {
      declaredInputsClear: false,
      qualification: false as const,
      reasons: [String(error)],
      scope: "declared-metadata-only" as const,
    };
  }
  if (canonical(input.identity) !== canonical(input.ledger.identity)) {
    reasons.push("Novel split identity does not match exposure ledger");
  }
  const exposedFamilies = new Set<string>();
  const exposedAliases = new Set<string>();
  const exposedClusters = new Set<string>();
  for (const entry of input.ledger.entries) {
    exposedFamilies.add(normalize(entry.semanticFamily ?? ""));
    for (const alias of entry.aliases) {
      exposedAliases.add(normalize(alias));
    }
    exposedClusters.add(entry.clusterId ?? "");
    for (const row of entry.lineage) {
      exposedFamilies.add(normalize(row.semanticFamily ?? ""));
      exposedClusters.add(row.clusterId ?? "");
    }
  }
  const terms = [new Set<string>(), new Set<string>()];
  const clusters = [new Set<string>(), new Set<string>()];
  for (const [index, batch] of input.batches.entries()) {
    if (!batch.id.trim() || !batch.families.length) {
      reasons.push(`Empty novel batch: ${batch.id || index}`);
    }
    for (const family of batch.families) {
      const names = [family.family, ...family.aliases].map(normalize);
      if (
        !normalize(family.family) ||
        !family.clusterIds.length ||
        family.clusterIds.some((x) => !x.trim())
      ) {
        reasons.push(
          `Unclassified novel family: ${family.family || "<missing>"}`
        );
        continue;
      }
      for (const name of names) {
        if (terms[index]?.has(name)) {
          reasons.push(`Duplicate family or alias within ${batch.id}: ${name}`);
        }
        terms[index]?.add(name);
        if (exposedFamilies.has(name) || exposedAliases.has(name)) {
          reasons.push(`Previously exposed family or alias: ${name}`);
        }
      }
      for (const cluster of family.clusterIds) {
        if (clusters[index]?.has(cluster)) {
          reasons.push(
            `Duplicate derivative cluster within ${batch.id}: ${cluster}`
          );
        }
        clusters[index]?.add(cluster);
        if (exposedClusters.has(cluster)) {
          reasons.push(`Previously exposed derivative cluster: ${cluster}`);
        }
      }
    }
  }
  for (const name of terms[0]) {
    if (terms[1].has(name)) {
      reasons.push(`Novel batches overlap by family or alias: ${name}`);
    }
  }
  for (const cluster of clusters[0]) {
    if (clusters[1].has(cluster)) {
      reasons.push(`Novel batches overlap by derivative cluster: ${cluster}`);
    }
  }
  return {
    declaredInputsClear: reasons.length === 0,
    qualification: false as const,
    reasons: [...new Set(reasons)].toSorted(),
    scope: "declared-metadata-only" as const,
  };
};

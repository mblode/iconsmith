import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import type { CraftJudgeObservation } from "../src/eval/foundry-gate.js";

const validHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const fileHash = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

export const AI_REVIEW_FREE_RECOGNITION_VERSION =
  "free-description-v1" as const;

export interface SynonymKeyRow {
  id: string;
  meaningProvenanceHash: string;
  synonyms: readonly string[];
  target: string;
}

export interface FreeRecognitionEvidence {
  description: string | null;
  evidenceHash: string;
  id: string;
}

export interface SynonymAdjudicationEvidence {
  adjudicatorBaseModelLineage: string;
  adjudicatorModel: string;
  decision: "match" | "mismatch" | "uncertain";
  evidence: string;
  id: string;
  keyHash: string;
  recognitionEvidenceHash: string;
  recognizerBaseModelLineage: string;
}

/** Freeze a prospective synonym instrument. This is an identity seal, not
 * evidence that the instrument was inaccessible to a reviewer at runtime. */
export const freezeSynonymKey = (rows: readonly SynonymKeyRow[]) => {
  if (
    !rows.length ||
    new Set(rows.map(({ id }) => id)).size !== rows.length ||
    rows.some(
      ({ id, meaningProvenanceHash, synonyms, target }) =>
        !/^[a-z0-9-]+$/u.test(id) ||
        !validHash(meaningProvenanceHash) ||
        !target.trim() ||
        synonyms.length === 0 ||
        synonyms.some((value) => !value.trim()) ||
        new Set(synonyms.map((value) => value.trim().toLowerCase())).size !==
          synonyms.length
    )
  ) {
    throw new Error("Invalid prospective synonym key");
  }
  const frozen = rows.map((row) => ({
    id: row.id,
    meaningProvenanceHash: row.meaningProvenanceHash,
    synonyms: [...row.synonyms],
    target: row.target,
  }));
  return {
    hash: createHash("sha256").update(JSON.stringify(frozen)).digest("hex"),
    rows: frozen,
  };
};

/** Validate the collector-bound linkage and actual emitted identities for a
 * prospective adjudication. Runtime target/key confinement is deliberately
 * outside this diagnostic validator, so it never produces a production seal. */
export const validateSynonymAdjudication = (input: {
  adjudications: readonly SynonymAdjudicationEvidence[];
  keyHash: string;
  recognitions: readonly FreeRecognitionEvidence[];
}) => {
  if (!validHash(input.keyHash)) {
    throw new Error("Invalid synonym key hash");
  }
  const recognitions = new Map(input.recognitions.map((row) => [row.id, row]));
  const adjudications = new Map(
    input.adjudications.map((row) => [row.id, row])
  );
  if (
    recognitions.size !== input.recognitions.length ||
    adjudications.size !== input.adjudications.length ||
    recognitions.size !== adjudications.size
  ) {
    throw new Error("Recognition and adjudication rows must pair exactly");
  }
  const rows = input.recognitions.map((recognition) => {
    const adjudication = adjudications.get(recognition.id);
    if (
      !/^[a-z0-9-]+$/u.test(recognition.id) ||
      !validHash(recognition.evidenceHash) ||
      (recognition.description !== null && !recognition.description.trim()) ||
      !adjudication ||
      adjudication.keyHash !== input.keyHash ||
      adjudication.recognitionEvidenceHash !== recognition.evidenceHash ||
      !adjudication.adjudicatorModel.trim() ||
      !adjudication.adjudicatorBaseModelLineage.trim() ||
      !adjudication.recognizerBaseModelLineage.trim() ||
      adjudication.adjudicatorBaseModelLineage ===
        adjudication.recognizerBaseModelLineage ||
      !adjudication.evidence.trim() ||
      !["match", "mismatch", "uncertain"].includes(adjudication.decision)
    ) {
      throw new Error(
        `Invalid synonym adjudication linkage: ${recognition.id}`
      );
    }
    return {
      decision:
        recognition.description === null ? "unknown" : adjudication.decision,
      id: recognition.id,
      recognitionSuccess:
        recognition.description !== null && adjudication.decision === "match",
    };
  });
  return {
    productionSealEligible: false as const,
    rows,
    runtimeAccessRestrictionVerified: false as const,
  };
};

export interface PopulationStimulus {
  evidenceHash: string;
  family?: string;
  id: string;
}

/** Freeze the identity boundary between exposed development evidence and an
 * unopened qualification population. */
export const validatePopulationSeparation = (input: {
  development: readonly PopulationStimulus[];
  sealed: readonly PopulationStimulus[];
  sealedLabelsExposedBeforePrediction: boolean;
}) => {
  if (input.sealedLabelsExposedBeforePrediction !== false) {
    throw new Error("Sealed qualification labels were exposed");
  }
  const validate = (name: string, rows: readonly PopulationStimulus[]) => {
    if (
      rows.some((row) => !row.id.trim() || !validHash(row.evidenceHash)) ||
      new Set(rows.map(({ id }) => id)).size !== rows.length ||
      new Set(rows.map(({ evidenceHash }) => evidenceHash)).size !== rows.length
    ) {
      throw new Error(`Invalid or duplicate ${name} population identity`);
    }
  };
  validate("development", input.development);
  validate("sealed", input.sealed);
  const developmentIds = new Set(input.development.map(({ id }) => id));
  const developmentHashes = new Set(
    input.development.map(({ evidenceHash }) => evidenceHash)
  );
  const developmentFamilies = new Set(
    input.development.flatMap(({ family }) => (family ? [family] : []))
  );
  if (
    input.sealed.some(
      ({ evidenceHash, family, id }) =>
        developmentIds.has(id) ||
        developmentHashes.has(evidenceHash) ||
        (family !== undefined && developmentFamilies.has(family))
    )
  ) {
    throw new Error("Development and sealed qualification populations overlap");
  }
  const body = {
    development: input.development,
    sealed: input.sealed,
    sealedLabelsExposedBeforePrediction: false as const,
  };
  return {
    hash: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
    manifest: body,
  };
};

export const freezeQualificationReceipt = (
  out: string,
  instrumentFile: string,
  rosterFile: string
) => {
  const receipt = {
    instrument: { file: instrumentFile, sha256: fileHash(instrumentFile) },
    labelsExposedBeforePrediction: false,
    roster: { file: rosterFile, sha256: fileHash(rosterFile) },
  };
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  return receipt;
};

export const validateQualificationReceipt = (
  receiptFile: string,
  instrumentFile: string,
  rosterFile: string
) => {
  const receipt = JSON.parse(readFileSync(receiptFile, "utf-8"));
  if (
    receipt.labelsExposedBeforePrediction !== false ||
    receipt.instrument?.file !== instrumentFile ||
    receipt.roster?.file !== rosterFile ||
    receipt.instrument.sha256 !== fileHash(instrumentFile) ||
    receipt.roster.sha256 !== fileHash(rosterFile)
  ) {
    throw new Error("Qualification freeze receipt or pinned inputs changed");
  }
  return receipt;
};

export interface HumanLabel {
  id: string;
  nativeImageSha256: string;
  svgSha256: string;
  humanIdentity: string | null;
  recognition: string | null;
  craftRating: number | null;
  familyFit: boolean | null;
  nativeLegibility: boolean | null;
  criticalDefect: boolean | null;
  defects: string[];
  shipUnchanged: boolean | null;
}

export interface CriticPrediction {
  evidenceHash: string;
  predicted: CraftJudgeObservation["predicted"];
}

interface ProvenanceRow {
  id: string;
  nativeImageSha256: string;
  svgSha256: string;
  status: string;
}

const isCompleteLabel = (label: HumanLabel): boolean =>
  typeof label.humanIdentity === "string" &&
  label.humanIdentity.trim().length > 0 &&
  typeof label.recognition === "string" &&
  label.recognition.trim().length > 0 &&
  Number.isInteger(label.craftRating) &&
  (label.craftRating ?? 0) >= 1 &&
  (label.craftRating ?? 0) <= 10 &&
  typeof label.familyFit === "boolean" &&
  typeof label.nativeLegibility === "boolean" &&
  typeof label.criticalDefect === "boolean" &&
  Array.isArray(label.defects) &&
  label.defects.every((defect) => typeof defect === "string") &&
  typeof label.shipUnchanged === "boolean";

/** Parse actual human responses only after collection. Blank templates remain
 * pending and can never be converted into critic qualification observations. */
// Completeness and identity checks stay together so partial labels cannot leak through.
// eslint-disable-next-line complexity
export const ingestHumanLabels = (
  provenanceRows: readonly ProvenanceRow[],
  batches: readonly (readonly HumanLabel[])[],
  predictions: readonly CriticPrediction[]
) => {
  const provenance = new Map(provenanceRows.map((row) => [row.id, row]));
  if (provenance.size !== provenanceRows.length) {
    throw new Error("Duplicate provenance identity");
  }
  const prediction = new Map(predictions.map((row) => [row.evidenceHash, row]));
  if (
    prediction.size !== predictions.length ||
    predictions.some(
      (row) =>
        !validHash(row.evidenceHash) ||
        !["approve", "reject", "uncertain"].includes(row.predicted)
    )
  ) {
    throw new Error("Invalid or duplicate critic prediction identity");
  }
  const seen = new Set<string>();
  const reviewerByStimulus = new Map<string, string>();
  const observations: CraftJudgeObservation[] = [];
  const pending: string[] = [];
  for (const label of batches.flat()) {
    if (seen.has(label.id)) {
      throw new Error(`Duplicate human label row: ${label.id}`);
    }
    seen.add(label.id);
    const source = provenance.get(label.id);
    if (
      !source ||
      label.svgSha256 !== source.svgSha256 ||
      label.nativeImageSha256 !== source.nativeImageSha256 ||
      !validHash(label.svgSha256) ||
      !validHash(label.nativeImageSha256)
    ) {
      throw new Error(`Human label evidence identity mismatch: ${label.id}`);
    }
    if (!isCompleteLabel(label)) {
      pending.push(label.id);
      continue;
    }
    if (label.criticalDefect && label.shipUnchanged) {
      throw new Error(`Critical defect cannot ship unchanged: ${label.id}`);
    }
    const { humanIdentity } = label;
    if (!humanIdentity) {
      throw new Error(`Missing human identity: ${label.id}`);
    }
    const existingReviewer = reviewerByStimulus.get(label.nativeImageSha256);
    if (existingReviewer && existingReviewer !== humanIdentity) {
      throw new Error(`Stimulus relabeled by another identity: ${label.id}`);
    }
    reviewerByStimulus.set(label.nativeImageSha256, humanIdentity);
    const critic = prediction.get(label.nativeImageSha256);
    if (!critic) {
      throw new Error(`Missing critic prediction: ${label.id}`);
    }
    observations.push({
      criticalDefect: label.criticalDefect,
      evidenceHash: label.nativeImageSha256,
      human: label.shipUnchanged ? "approve" : "reject",
      predicted: critic.predicted,
    });
  }
  for (const row of provenanceRows) {
    if (!seen.has(row.id)) {
      pending.push(row.id);
    }
  }
  return {
    observations,
    pending,
    submitted: seen.size,
    total: provenanceRows.length,
  };
};

export const ingestHumanLabelFiles = (
  provenanceFile: string,
  labelFiles: readonly string[],
  predictionsFile: string
) => {
  const provenance = JSON.parse(readFileSync(provenanceFile, "utf-8"));
  return ingestHumanLabels(
    provenance.artifacts,
    labelFiles.map((file) => JSON.parse(readFileSync(file, "utf-8"))),
    JSON.parse(readFileSync(predictionsFile, "utf-8"))
  );
};

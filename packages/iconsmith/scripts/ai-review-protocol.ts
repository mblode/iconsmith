/** Blind recognition settles before concept-aware craft review begins. */
import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { DRAFT_ACCEPTANCE_CONTRACT } from "../src/eval/acceptance-contract.js";
import {
  AI_REVIEW_FREE_RECOGNITION_VERSION,
  freezeSynonymKey,
  validateSynonymAdjudication,
} from "./quality-labels.js";
import type {
  FreeRecognitionEvidence,
  SynonymAdjudicationEvidence,
  SynonymKeyRow,
} from "./quality-labels.js";

export interface AiProtocolStimulus {
  id: string;
  concept: string;
  image: Uint8Array;
  meanings: readonly string[];
  familyReferences: readonly Uint8Array[];
}
export interface ProtocolQuestion {
  id: string;
  prompt: string;
  choices: readonly string[];
}
export const AI_REVIEW_RECOGNITION_ORDER_VERSION =
  "seeded-balanced-v1" as const;
export interface ProtocolReview {
  status: "complete" | "incomplete";
  model: string | null;
  answers: Record<
    string,
    { choice: string; evidence: string; treatment: string }
  > | null;
  reason?: string;
  evidenceHashes?: Record<string, string>;
}
export interface ProspectiveProtocolReview extends ProtocolReview {
  baseModelLineage: string | null;
}
export type ProtocolReviewer = (input: {
  deadlineAt: number;
  images: Record<string, Uint8Array>;
  out: string;
  questions: readonly ProtocolQuestion[];
}) => Promise<ProtocolReview>;
export type ProspectiveProtocolReviewer = (input: {
  deadlineAt: number;
  images: Record<string, Uint8Array>;
  out: string;
  questions: readonly ProtocolQuestion[];
}) => Promise<ProspectiveProtocolReview>;
export const AI_REVIEW_RECOGNITION_MAX_MS = 120_000;
export const AI_REVIEW_RECOGNITION_BUDGET_DIVISOR = 4;
export const AI_REVIEW_FINAL_VALIDATION_RESERVE_MS = 5000;

export const aiReviewStageDeadlines = (startAt: number, deadlineAt: number) => {
  if (
    !Number.isFinite(startAt) ||
    !Number.isFinite(deadlineAt) ||
    deadlineAt - startAt <= AI_REVIEW_FINAL_VALIDATION_RESERVE_MS
  ) {
    throw new Error("AI review deadline must leave final validation time");
  }
  const recognitionBudgetMs = Math.min(
    AI_REVIEW_RECOGNITION_MAX_MS,
    Math.floor((deadlineAt - startAt) / AI_REVIEW_RECOGNITION_BUDGET_DIVISOR)
  );
  const craftDeadlineAt = deadlineAt - AI_REVIEW_FINAL_VALIDATION_RESERVE_MS;
  return {
    craftDeadlineAt,
    finalValidationReserveMs: AI_REVIEW_FINAL_VALIDATION_RESERVE_MS,
    recognitionBudgetMs,
    recognitionDeadlineAt: Math.min(
      startAt + recognitionBudgetMs,
      craftDeadlineAt
    ),
  };
};
const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const durableExclusiveJson = (
  directory: string,
  name: string,
  value: unknown
) => {
  const file = path.join(directory, name);
  const descriptor = openSync(file, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const directoryDescriptor = openSync(directory, "r");
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
};
const normalizedIdentity = (value: string) =>
  value.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
const compareText = (left: string, right: string) => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};
const seededRank = (seed: string, domain: string, value: string) =>
  sha(`${AI_REVIEW_RECOGNITION_ORDER_VERSION}\0${seed}\0${domain}\0${value}`);
const invalidStimulusIdentity = (
  row: Pick<AiProtocolStimulus, "concept" | "id" | "meanings">
) =>
  Boolean(
    !/^[a-z0-9-]+$/u.test(row.id) ||
    !row.concept.trim() ||
    row.meanings.length < 3 ||
    new Set(row.meanings).size !== row.meanings.length ||
    !row.meanings.includes(row.concept) ||
    row.meanings.some((meaning) => !meaning.trim() || meaning === "uncertain")
  );

/**
 * Balance the correct answer across every displayed position while deriving
 * distractor order from identity rather than caller-supplied meanings order.
 */
export const buildRecognitionQuestions = (
  stimuli: readonly Pick<AiProtocolStimulus, "concept" | "id" | "meanings">[],
  seed: string
): readonly ProtocolQuestion[] => {
  if (
    !seed.trim() ||
    seed.length > 256 ||
    stimuli.some((row) => invalidStimulusIdentity(row))
  ) {
    throw new Error("AI review needs a valid recognition order seed");
  }
  const targetPositions = new Map<string, number>();
  const groups = new Map<
    number,
    Pick<AiProtocolStimulus, "concept" | "id" | "meanings">[]
  >();
  for (const row of stimuli) {
    const positionCount = row.meanings.length + 1;
    groups.set(positionCount, [...(groups.get(positionCount) ?? []), row]);
  }
  for (const [positionCount, rows] of groups) {
    const orderedRows = rows.toSorted((left, right) => {
      const comparison = compareText(
        seededRank(seed, "row", left.id),
        seededRank(seed, "row", right.id)
      );
      return comparison || compareText(left.id, right.id);
    });
    const offset =
      Number.parseInt(
        seededRank(seed, "offset", String(positionCount)).slice(0, 8),
        16
      ) % positionCount;
    for (const [index, row] of orderedRows.entries()) {
      targetPositions.set(row.id, (offset + index) % positionCount);
    }
  }
  return stimuli.map((row) => {
    const distractors = [
      ...row.meanings.filter((meaning) => meaning !== row.concept),
      "uncertain",
    ].toSorted((left, right) => {
      const comparison = compareText(
        seededRank(seed, `choice:${row.id}`, left),
        seededRank(seed, `choice:${row.id}`, right)
      );
      return comparison || compareText(left, right);
    });
    const choices = [...distractors];
    choices.splice(targetPositions.get(row.id) ?? 0, 0, row.concept);
    return {
      choices,
      id: `${row.id}-recognition`,
      prompt: `Inspect ${row.id}.png without assuming a target. Select the best matching meaning from the alternatives. Describe the visible object and modifier before choosing. Use uncertain when no meaning fits.`,
    };
  });
};

export const recognitionQuestionsHash = (
  questions: readonly ProtocolQuestion[]
) => sha(JSON.stringify(questions));

export const buildFreeRecognitionQuestions = (
  stimuli: readonly Pick<AiProtocolStimulus, "id">[]
): readonly ProtocolQuestion[] => {
  if (
    !stimuli.length ||
    new Set(stimuli.map(({ id }) => id)).size !== stimuli.length ||
    stimuli.some(({ id }) => !/^[a-z0-9-]+$/u.test(id))
  ) {
    throw new Error("Free recognition needs unique opaque stimulus identities");
  }
  return stimuli.map(({ id }) => ({
    choices: ["described", "unknown"],
    id: `${id}-free-recognition`,
    prompt: `Inspect ${id}.png. Describe the visible object and any modifier in your own words. Choose described when you can describe it, or unknown when you cannot. Do not infer a supplied name or target.`,
  }));
};
const completed = (
  review: ProtocolReview,
  model: string,
  questions: readonly ProtocolQuestion[],
  images: Readonly<Record<string, Uint8Array>>
) =>
  review.status === "complete" &&
  review.model === model &&
  review.answers !== null &&
  review.evidenceHashes !== undefined &&
  Object.keys(review.evidenceHashes).length === Object.keys(images).length &&
  Object.entries(images).every(
    ([name, bytes]) => review.evidenceHashes?.[name] === sha(bytes)
  ) &&
  Object.keys(review.answers).length === questions.length &&
  questions.every((question) => {
    const answer = review.answers?.[question.id];
    return (
      answer &&
      typeof answer.choice === "string" &&
      question.choices.includes(answer.choice) &&
      typeof answer.evidence === "string" &&
      Boolean(answer.evidence.trim()) &&
      typeof answer.treatment === "string"
    );
  });

const validStimulus = (row: AiProtocolStimulus) =>
  !(
    invalidStimulusIdentity(row) ||
    !row.familyReferences.length ||
    !row.image.length ||
    row.familyReferences.some((image) => !image.length)
  );

/** invoke must supply its own exact-image inspection and runtime receipts. */
export const runAiReviewProtocol = async (options: {
  out: string;
  model: string;
  deadlineAt: number;
  stimuli: readonly AiProtocolStimulus[];
  recognitionOrderSeed: string;
  expectedRecognitionQuestionsHash?: string;
  invoke: ProtocolReviewer;
}) => {
  const { out, model, deadlineAt } = options;
  const startAt = Date.now();
  const stimuli = options.stimuli.map((row) => ({
    ...row,
    familyReferences: row.familyReferences.map((image) => Buffer.from(image)),
    image: Buffer.from(row.image),
    meanings: [...row.meanings],
  }));
  if (
    !model.trim() ||
    !Number.isFinite(deadlineAt) ||
    deadlineAt <= startAt ||
    !stimuli.length ||
    stimuli.length > 20 ||
    new Set(stimuli.map(({ id }) => id)).size !== stimuli.length
  ) {
    throw new Error("AI review needs a bounded packet and pinned reviewer");
  }
  if (stimuli.some((row) => !validStimulus(row))) {
    throw new Error(
      "AI review needs safe identities, blind alternatives and family anchors"
    );
  }
  const recognitionQuestions = buildRecognitionQuestions(
    stimuli,
    options.recognitionOrderSeed
  );
  const frozenRecognitionQuestionsHash =
    recognitionQuestionsHash(recognitionQuestions);
  if (
    options.expectedRecognitionQuestionsHash !== undefined &&
    options.expectedRecognitionQuestionsHash !== frozenRecognitionQuestionsHash
  ) {
    throw new Error("Recognition questions do not match the campaign freeze");
  }
  const stageDeadlines = aiReviewStageDeadlines(startAt, deadlineAt);
  mkdirSync(out, { recursive: false });
  const save = (name: string, value: unknown) =>
    writeFileSync(path.join(out, name), `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
    });
  const sealed = stimuli.map((row) => ({
    familyReferenceHashes: row.familyReferences.map(sha),
    id: row.id,
    imageHash: sha(row.image),
    meanings: row.meanings,
  }));
  save("protocol.json", {
    authority: "AI-only",
    blindPacket: sealed,
    deadlineAt,
    model,
    qualified: false,
    recognitionOrder: recognitionQuestions.map(({ choices, id }) => ({
      choices,
      id,
    })),
    recognitionOrderSeed: options.recognitionOrderSeed,
    recognitionOrderVersion: AI_REVIEW_RECOGNITION_ORDER_VERSION,
    recognitionQuestionsHash: frozenRecognitionQuestionsHash,
    stageDeadlines,
  });
  save("recognition-questions.json", recognitionQuestions);
  const recognition = await options.invoke({
    deadlineAt: stageDeadlines.recognitionDeadlineAt,
    images: Object.fromEntries(
      stimuli.map((row) => [`${row.id}.png`, row.image])
    ),
    out: path.join(out, "recognition"),
    questions: recognitionQuestions,
  });
  save("recognition.json", recognition);
  const recognitionHash = sha(JSON.stringify(recognition));
  if (
    stimuli.some((row) => {
      const original = sealed.find(({ id }) => id === row.id);
      return (
        sha(row.image) !== original?.imageHash ||
        row.familyReferences.some(
          (image, index) => sha(image) !== original.familyReferenceHashes[index]
        )
      );
    })
  ) {
    throw new Error("AI reviewer mutated immutable protocol images");
  }
  if (
    !completed(
      recognition,
      model,
      recognitionQuestions,
      Object.fromEntries(stimuli.map((row) => [`${row.id}.png`, row.image]))
    ) ||
    Date.now() >= stageDeadlines.recognitionDeadlineAt
  ) {
    const result = {
      craft: null,
      qualified: false,
      recognitionHash,
      status: "recognition-incomplete",
    };
    save("result.json", result);
    return result;
  }
  save(
    "sealed-context.json",
    stimuli.map((row) => ({
      concept: row.concept,
      familyReferenceHashes: row.familyReferences.map(sha),
      id: row.id,
    }))
  );
  const craftImages: Record<string, Uint8Array> = {};
  const craftHashes = new Map<string, string>();
  const anchorNames = new Map<string, string>();
  const { craftScale } = DRAFT_ACCEPTANCE_CONTRACT.calibration;
  const craftQuestions = stimuli.flatMap((row) => {
    craftImages[`${row.id}.png`] = row.image;
    craftHashes.set(`${row.id}.png`, sha(row.image));
    const anchors = row.familyReferences.map((bytes) => {
      const hash = sha(bytes);
      const name = anchorNames.get(hash) ?? `family-${hash}.png`;
      anchorNames.set(hash, name);
      craftImages[name] = bytes;
      craftHashes.set(name, hash);
      return name;
    });
    const context = `The intended concept for ${row.id}.png is ${row.concept}. Its family anchors are ${anchors.join(", ")}. Recognition is already sealed; do not revise it. `;
    return [
      {
        choices: ["yes", "no", "uncertain"],
        id: `${row.id}-critical`,
        prompt: `${context}Does a critical defect break intended meaning, a required connection, counter or modifier, or clip a required contour? Name the visible location and consequence. A subjective alternative or ordinary antialiasing alone is not critical.`,
      },
      {
        choices: Array.from(
          { length: craftScale.maximum - craftScale.minimum + 1 },
          (_, index) => String(index + craftScale.minimum)
        ),
        id: `${row.id}-craft`,
        prompt: `${context}Rate construction craft from ${craftScale.minimum} to ${craftScale.maximum} against the anchors: contour continuity, junctions, optical balance, spacing and deliberate detail. A 9 means ${craftScale.nine}. A 10 means ${craftScale.ten}. Identify any concrete defect.`,
      },
      {
        choices: ["yes", "no", "uncertain"],
        id: `${row.id}-family`,
        prompt: `${context}Does the candidate fit this house family while allowing legitimate paint and optical-size differences?`,
      },
      {
        choices: ["yes", "no", "uncertain"],
        id: `${row.id}-native`,
        prompt: `${context}Are meaning, counters and modifiers legible in the native light and dark cells, without relying on the enlarged vector?`,
      },
      {
        choices: ["yes", "no", "uncertain"],
        id: `${row.id}-ship`,
        prompt: `${context}Would you ship the candidate unchanged at the anchor family's craft standard? Keep every observed unresolved defect in the evidence.`,
      },
    ];
  });
  const craft = await options.invoke({
    deadlineAt: stageDeadlines.craftDeadlineAt,
    images: craftImages,
    out: path.join(out, "craft"),
    questions: craftQuestions,
  });
  save("craft.json", craft);
  if (
    Object.entries(craftImages).some(
      ([name, image]) => sha(image) !== craftHashes.get(name)
    )
  ) {
    throw new Error("AI reviewer mutated immutable craft images");
  }
  const result = {
    craft,
    qualified: false,
    recognition: stimuli.map((row) => ({
      correct:
        recognition.answers?.[`${row.id}-recognition`]?.choice === "uncertain"
          ? null
          : recognition.answers?.[`${row.id}-recognition`]?.choice ===
            row.concept,
      id: row.id,
    })),
    recognitionHash,
    status:
      completed(craft, model, craftQuestions, craftImages) &&
      Date.now() < stageDeadlines.craftDeadlineAt
        ? "complete"
        : "craft-incomplete",
  };
  save("result.json", result);
  return result;
};

/** Prospective P3.2 instrument. The recognition request contains only opaque
 * image identities and free-description/unknown choices. This function proves
 * request construction and stage order, but cannot prove that a provider
 * runtime could not read caller workspaces or attachments; production sealing
 * therefore remains false until a canonical confined-runtime receipt exists. */
// The validation branches intentionally share one evidence-sealing state machine.
// oxlint-disable-next-line eslint/complexity
export const runProspectiveAiReviewProtocol = async (options: {
  adjudicator: {
    baseModelLineage: string;
    invoke: ProspectiveProtocolReviewer;
    model: string;
  };
  deadlineAt: number;
  expectedSynonymKeyHash: string;
  out: string;
  recognizer: {
    baseModelLineage: string;
    invoke: ProspectiveProtocolReviewer;
    model: string;
  };
  stimuli: readonly AiProtocolStimulus[];
  synonymKey: readonly SynonymKeyRow[];
}) => {
  const startAt = Date.now();
  const { adjudicator, deadlineAt, out, recognizer } = options;
  const stimuli = options.stimuli.map((row) => ({
    ...row,
    familyReferences: row.familyReferences.map((image) => Buffer.from(image)),
    image: Buffer.from(row.image),
    meanings: [...row.meanings],
  }));
  if (
    !recognizer.model.trim() ||
    !recognizer.baseModelLineage.trim() ||
    !adjudicator.model.trim() ||
    !adjudicator.baseModelLineage.trim() ||
    recognizer.baseModelLineage === adjudicator.baseModelLineage ||
    !Number.isFinite(deadlineAt) ||
    deadlineAt - startAt <= AI_REVIEW_FINAL_VALIDATION_RESERVE_MS ||
    !stimuli.length ||
    stimuli.length > 20 ||
    stimuli.some(
      (row) =>
        !/^[a-z0-9-]+$/u.test(row.id) ||
        !row.concept.trim() ||
        !row.image.length ||
        !row.familyReferences.length ||
        row.familyReferences.some((image) => !image.length)
    )
  ) {
    throw new Error("Prospective review needs bounded independent reviewers");
  }
  const key = freezeSynonymKey(options.synonymKey);
  if (
    key.hash !== options.expectedSynonymKeyHash ||
    key.rows.length !== stimuli.length ||
    key.rows.some((row, index) => row.id !== stimuli[index]?.id) ||
    key.rows.some((row) =>
      [row.target, ...row.synonyms].some((label) => {
        const normalizedLabel = normalizedIdentity(label);
        const normalizedId = normalizedIdentity(row.id);
        return (
          normalizedLabel.length > 2 &&
          (normalizedId.includes(normalizedLabel) ||
            normalizedLabel.includes(normalizedId))
        );
      })
    )
  ) {
    throw new Error(
      "Prospective synonym key does not match the campaign freeze or opaque IDs"
    );
  }
  const usableMs = deadlineAt - startAt - AI_REVIEW_FINAL_VALIDATION_RESERVE_MS;
  const recognitionDeadlineAt = startAt + Math.floor(usableMs / 3);
  const adjudicationDeadlineAt = startAt + Math.floor((usableMs * 2) / 3);
  const craftDeadlineAt = deadlineAt - AI_REVIEW_FINAL_VALIDATION_RESERVE_MS;
  mkdirSync(out, { recursive: false });
  const save = (name: string, value: unknown) =>
    durableExclusiveJson(out, name, value);
  const imageHashes = Object.fromEntries(
    stimuli.map((row) => [`${row.id}.png`, sha(row.image)])
  );
  const recognitionImages = Object.fromEntries(
    stimuli.map((row) => [`${row.id}.png`, row.image])
  );
  const recognitionQuestions = buildFreeRecognitionQuestions(stimuli);
  save("protocol.json", {
    adjudicator: {
      baseModelLineage: adjudicator.baseModelLineage,
      model: adjudicator.model,
    },
    imageHashes,
    productionSealEligible: false,
    protocolVersion: AI_REVIEW_FREE_RECOGNITION_VERSION,
    recognitionContextScope:
      "callback-request-only; provider-runtime-access-unverified",
    recognizer: {
      baseModelLineage: recognizer.baseModelLineage,
      model: recognizer.model,
    },
    runtimeAccessRestrictionVerified: false,
    stageDeadlines: {
      adjudicationDeadlineAt,
      craftDeadlineAt,
      recognitionDeadlineAt,
    },
    synonymKeyHash: key.hash,
  });
  save("recognition-questions.json", recognitionQuestions);
  let recognition: ProspectiveProtocolReview;
  try {
    recognition = await recognizer.invoke({
      deadlineAt: recognitionDeadlineAt,
      images: recognitionImages,
      out: path.join(out, "recognition"),
      questions: recognitionQuestions,
    });
  } catch (error) {
    const failure = {
      deadlineAt: recognitionDeadlineAt,
      reason: String(error),
      stage: "recognition",
      status: "invoke-rejected" as const,
    };
    save("recognition-error.json", failure);
    const recognitionHash = sha(JSON.stringify(failure));
    save("recognition-terminal.json", {
      complete: false,
      deadlineAt: recognitionDeadlineAt,
      errorHash: recognitionHash,
      recognitionHash,
      runtimeAccessRestrictionVerified: false,
      status: "invoke-rejected",
    });
    const result = {
      productionSealEligible: false,
      qualified: false,
      recognitionHash,
      status: "recognition-incomplete" as const,
    };
    save("result.json", result);
    return result;
  }
  save("recognition.json", recognition);
  const recognitionHash = sha(JSON.stringify(recognition));
  const recognitionValid =
    completed(
      recognition,
      recognizer.model,
      recognitionQuestions,
      recognitionImages
    ) &&
    recognition.baseModelLineage === recognizer.baseModelLineage &&
    Date.now() < recognitionDeadlineAt;
  save("recognition-terminal.json", {
    complete: recognitionValid,
    deadlineAt: recognitionDeadlineAt,
    recognitionHash,
    runtimeAccessRestrictionVerified: false,
    status: recognitionValid ? "complete" : "incomplete",
  });
  if (!recognitionValid) {
    const result = {
      productionSealEligible: false,
      qualified: false,
      recognitionHash,
      status: "recognition-incomplete" as const,
    };
    save("result.json", result);
    return result;
  }

  const recognitionRows: FreeRecognitionEvidence[] = stimuli.map((row) => {
    const answer = recognition.answers?.[`${row.id}-free-recognition`];
    const description = answer?.choice === "described" ? answer.evidence : null;
    return {
      description,
      evidenceHash: sha(
        JSON.stringify({
          answer,
          baseModelLineage: recognition.baseModelLineage,
          id: row.id,
          imageHash: imageHashes[`${row.id}.png`],
          model: recognition.model,
        })
      ),
      id: row.id,
    };
  });
  // The target and synonyms are materialized only after recognition.json and
  // its terminal have been fsynced with their containing directory.
  save("synonym-key.json", key);
  const adjudicationQuestions: ProtocolQuestion[] = key.rows.map((row) => {
    const recognitionRow = recognitionRows.find(({ id }) => id === row.id);
    return {
      choices: ["match", "mismatch", "uncertain"],
      id: `${row.id}-synonym-adjudication`,
      prompt: `Adjudicate the sealed free description for opaque stimulus ${row.id}: ${JSON.stringify(recognitionRow?.description)}. Target: ${row.target}. Accepted synonyms: ${row.synonyms.join(", ")}. Choose match, mismatch, or uncertain. The recognition evidence hash is ${recognitionRow?.evidenceHash}. Do not revise the sealed description.`,
    };
  });
  save("adjudication-questions.json", adjudicationQuestions);
  let adjudication: ProspectiveProtocolReview;
  try {
    adjudication = await adjudicator.invoke({
      deadlineAt: adjudicationDeadlineAt,
      images: {},
      out: path.join(out, "adjudication"),
      questions: adjudicationQuestions,
    });
  } catch (error) {
    const failure = {
      deadlineAt: adjudicationDeadlineAt,
      reason: String(error),
      stage: "adjudication",
      status: "invoke-rejected" as const,
    };
    save("adjudication-error.json", failure);
    save("adjudication-terminal.json", {
      complete: false,
      deadlineAt: adjudicationDeadlineAt,
      errorHash: sha(JSON.stringify(failure)),
      keyHash: key.hash,
      recognitionHash,
      status: "invoke-rejected",
    });
    const result = {
      productionSealEligible: false,
      qualified: false,
      recognitionHash,
      status: "adjudication-incomplete" as const,
    };
    save("result.json", result);
    return result;
  }
  save("adjudication.json", adjudication);
  const adjudicationValid =
    completed(adjudication, adjudicator.model, adjudicationQuestions, {}) &&
    adjudication.baseModelLineage === adjudicator.baseModelLineage &&
    Date.now() < adjudicationDeadlineAt;
  save("adjudication-terminal.json", {
    adjudicationHash: sha(JSON.stringify(adjudication)),
    complete: adjudicationValid,
    deadlineAt: adjudicationDeadlineAt,
    keyHash: key.hash,
    recognitionHash,
    status: adjudicationValid ? "complete" : "incomplete",
  });
  if (!adjudicationValid) {
    const result = {
      productionSealEligible: false,
      qualified: false,
      recognitionHash,
      status: "adjudication-incomplete" as const,
    };
    save("result.json", result);
    return result;
  }
  const adjudicationRows: SynonymAdjudicationEvidence[] = recognitionRows.map(
    (row) => ({
      adjudicatorBaseModelLineage: adjudication.baseModelLineage ?? "",
      adjudicatorModel: adjudication.model ?? "",
      decision: (adjudication.answers?.[`${row.id}-synonym-adjudication`]
        ?.choice ?? "uncertain") as SynonymAdjudicationEvidence["decision"],
      evidence:
        adjudication.answers?.[`${row.id}-synonym-adjudication`]?.evidence ??
        "",
      id: row.id,
      keyHash: key.hash,
      recognitionEvidenceHash: row.evidenceHash,
      recognizerBaseModelLineage: recognition.baseModelLineage ?? "",
    })
  );
  const recognitionAssessment = validateSynonymAdjudication({
    adjudications: adjudicationRows,
    keyHash: key.hash,
    recognitions: recognitionRows,
  });
  const craftImages: Record<string, Uint8Array> = {};
  const { craftScale } = DRAFT_ACCEPTANCE_CONTRACT.calibration;
  const craftQuestions = stimuli.flatMap((row) => {
    craftImages[`${row.id}.png`] = row.image;
    const anchors = row.familyReferences.map((bytes) => {
      const name = `family-${sha(bytes)}.png`;
      craftImages[name] = bytes;
      return name;
    });
    const context = `Recognition and synonym adjudication are sealed; do not revise them. The intended concept for ${row.id}.png is ${row.concept}. Its family anchors are ${anchors.join(", ")}. `;
    return [
      {
        choices: ["yes", "no", "uncertain"],
        id: `${row.id}-critical`,
        prompt: `${context}Does a critical defect break intended meaning, a required connection, counter or modifier, or clip a required contour? Name the visible location and consequence. A subjective alternative or ordinary antialiasing alone is not critical.`,
      },
      {
        choices: Array.from(
          { length: craftScale.maximum - craftScale.minimum + 1 },
          (_, index) => String(index + craftScale.minimum)
        ),
        id: `${row.id}-craft`,
        prompt: `${context}Rate construction craft from ${craftScale.minimum} to ${craftScale.maximum} against the anchors: contour continuity, junctions, optical balance, spacing and deliberate detail. A 9 means ${craftScale.nine}. A 10 means ${craftScale.ten}. Identify any concrete defect.`,
      },
      {
        choices: ["yes", "no", "uncertain"],
        id: `${row.id}-family`,
        prompt: `${context}Does the candidate fit this house family while allowing legitimate paint and optical-size differences?`,
      },
      {
        choices: ["yes", "no", "uncertain"],
        id: `${row.id}-native`,
        prompt: `${context}Are meaning, counters and modifiers legible in the native light and dark cells, without relying on the enlarged vector?`,
      },
      {
        choices: ["yes", "no", "uncertain"],
        id: `${row.id}-ship`,
        prompt: `${context}Would you ship the candidate unchanged at the anchor family's craft standard? Keep every observed unresolved defect in the evidence.`,
      },
    ];
  });
  save("craft-questions.json", craftQuestions);
  let craft: ProspectiveProtocolReview;
  try {
    craft = await recognizer.invoke({
      deadlineAt: craftDeadlineAt,
      images: craftImages,
      out: path.join(out, "craft"),
      questions: craftQuestions,
    });
  } catch (error) {
    const failure = {
      deadlineAt: craftDeadlineAt,
      reason: String(error),
      stage: "craft",
      status: "invoke-rejected" as const,
    };
    save("craft-error.json", failure);
    save("craft-terminal.json", {
      complete: false,
      deadlineAt: craftDeadlineAt,
      errorHash: sha(JSON.stringify(failure)),
      recognitionHash,
      status: "invoke-rejected",
    });
    const result = {
      productionSealEligible: false,
      qualified: false,
      recognition: recognitionAssessment.rows,
      recognitionHash,
      status: "craft-incomplete" as const,
    };
    save("result.json", result);
    return result;
  }
  save("craft.json", craft);
  const craftValid =
    completed(craft, recognizer.model, craftQuestions, craftImages) &&
    craft.baseModelLineage === recognizer.baseModelLineage &&
    Date.now() < craftDeadlineAt;
  const result = {
    craft,
    productionSealEligible: false,
    qualified: false,
    recognition: recognitionAssessment.rows,
    recognitionHash,
    runtimeAccessRestrictionVerified: false,
    status: craftValid ? ("complete" as const) : ("craft-incomplete" as const),
  };
  save("craft-terminal.json", {
    complete: craftValid,
    craftHash: sha(JSON.stringify(craft)),
    deadlineAt: craftDeadlineAt,
    recognitionHash,
    status: craftValid ? "complete" : "incomplete",
  });
  save("result.json", result);
  return result;
};

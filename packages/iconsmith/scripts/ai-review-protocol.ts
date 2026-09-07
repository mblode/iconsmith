/** Blind recognition settles before concept-aware craft review begins. */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface AiProtocolStimulus {
  id: string;
  concept: string;
  image: Uint8Array;
  meanings: readonly string[];
  familyReferences: readonly Uint8Array[];
}
interface ProtocolQuestion {
  id: string;
  prompt: string;
  choices: readonly string[];
}
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
export type ProtocolReviewer = (input: {
  deadlineAt: number;
  images: Record<string, Uint8Array>;
  out: string;
  questions: readonly ProtocolQuestion[];
}) => Promise<ProtocolReview>;
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
    !/^[a-z0-9-]+$/u.test(row.id) ||
    !row.concept.trim() ||
    row.meanings.length < 3 ||
    new Set(row.meanings).size !== row.meanings.length ||
    !row.meanings.includes(row.concept) ||
    row.meanings.some(
      (meaning) => !meaning.trim() || meaning === "uncertain"
    ) ||
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
    stageDeadlines,
  });
  const recognitionQuestions = stimuli.map((row) => ({
    choices: [...row.meanings, "uncertain"],
    id: `${row.id}-recognition`,
    prompt: `Inspect ${row.id}.png without assuming a target. Select the best matching meaning from the alternatives. Describe the visible object and modifier before choosing. Use uncertain when no meaning fits.`,
  }));
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
        choices: Array.from({ length: 10 }, (_, index) => String(index + 1)),
        id: `${row.id}-craft`,
        prompt: `${context}Rate construction craft from 1 to 10 against the anchors: contour continuity, junctions, optical balance, spacing and deliberate detail. Identify any concrete defect.`,
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

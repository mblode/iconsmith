import { createHash } from "node:crypto";

import {
  AI_REVIEW_RECOGNITION_ORDER_VERSION,
  buildRecognitionQuestions,
} from "./ai-review-protocol.js";

const LOCAL_RECOGNITION_CHOICES_VERSION =
  "request-presentation-bound-v1" as const;

export interface LocalRecognitionChoiceRequest {
  /** Stable request identity; it is also the blind question identity. */
  requestId: string;
  /** SHA-256 of the exact image presentation shown with these choices. */
  presentationHash: string;
  /** Alternatives before `uncertain` is added. Must include targetMeaning. */
  meanings: readonly string[];
  /** Withheld answer used only to balance its displayed position. */
  targetMeaning: string;
}

interface LocalRecognitionChoiceReceipt {
  choiceCount: number;
  cohortId: string;
  originalChoicesHash: string;
  orderedChoicesHash: string;
  orderVersion: typeof AI_REVIEW_RECOGNITION_ORDER_VERSION;
  presentationHash: string;
  requestId: string;
  shuffleIdentity: string;
  version: typeof LOCAL_RECOGNITION_CHOICES_VERSION;
}

export interface LocalRecognitionChoices {
  choices: readonly string[];
  receipt: LocalRecognitionChoiceReceipt;
  requestId: string;
}

const HASH = /^[a-f0-9]{64}$/u;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** Hashes the exact caller order, including JSON array boundaries. */
export const originalRecognitionChoicesHash = (choices: readonly string[]) =>
  sha(JSON.stringify(choices));

/** Hashes the exact order presented to the reviewer. */
export const orderedRecognitionChoicesHash = (choices: readonly string[]) =>
  sha(JSON.stringify(choices));

const invalidRequest = (request: LocalRecognitionChoiceRequest) =>
  !/^[a-z0-9-]+$/u.test(request.requestId) ||
  !HASH.test(request.presentationHash) ||
  !request.targetMeaning.trim() ||
  request.meanings.length < 3 ||
  new Set(request.meanings).size !== request.meanings.length ||
  !request.meanings.includes(request.targetMeaning) ||
  request.meanings.some(
    (meaning) => !meaning.trim() || meaning === "uncertain"
  );

/**
 * Builds blind recognition choices for a declared cohort. Input rows and each
 * row's meanings are canonicalized before deriving the shuffle, so caller
 * ordering cannot signal the target. The shared protocol helper then balances
 * target position independently within each choice-count group.
 */
export const buildLocalRecognitionChoices = (
  cohortId: string,
  requests: readonly LocalRecognitionChoiceRequest[]
): readonly LocalRecognitionChoices[] => {
  if (
    !cohortId.trim() ||
    cohortId.length > 256 ||
    requests.length === 0 ||
    new Set(requests.map(({ requestId }) => requestId)).size !==
      requests.length ||
    requests.some(invalidRequest)
  ) {
    throw new Error("Recognition choices need a valid declared cohort");
  }
  const canonical = requests
    .map((request) => ({
      ...request,
      meanings: [...request.meanings].toSorted(),
    }))
    .toSorted((left, right) => left.requestId.localeCompare(right.requestId));
  const shuffleIdentity = sha(
    JSON.stringify({
      cohortId,
      orderVersion: AI_REVIEW_RECOGNITION_ORDER_VERSION,
      requests: canonical.map(
        ({ meanings, presentationHash, requestId, targetMeaning }) => ({
          meanings,
          presentationHash,
          requestId,
          targetMeaning,
        })
      ),
      version: LOCAL_RECOGNITION_CHOICES_VERSION,
    })
  );
  const questions = buildRecognitionQuestions(
    canonical.map(({ meanings, requestId, targetMeaning }) => ({
      concept: targetMeaning,
      id: requestId,
      meanings,
    })),
    shuffleIdentity
  );
  const originalById = new Map(
    requests.map((request) => [request.requestId, request])
  );
  return questions.map((question, index) => {
    const canonicalRequest = canonical[index];
    const requestId = canonicalRequest?.requestId ?? "";
    const original = originalById.get(requestId);
    if (!(original && canonicalRequest)) {
      throw new Error(`Recognition choice identity was lost: ${requestId}`);
    }
    return {
      choices: question.choices,
      receipt: {
        choiceCount: question.choices.length,
        cohortId,
        orderVersion: AI_REVIEW_RECOGNITION_ORDER_VERSION,
        orderedChoicesHash: orderedRecognitionChoicesHash(question.choices),
        originalChoicesHash: originalRecognitionChoicesHash(original.meanings),
        presentationHash: canonicalRequest.presentationHash,
        requestId,
        shuffleIdentity,
        version: LOCAL_RECOGNITION_CHOICES_VERSION,
      },
      requestId,
    };
  });
};

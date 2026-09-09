import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  buildLocalRecognitionChoices,
  orderedRecognitionChoicesHash,
  originalRecognitionChoicesHash,
} from "./local-recognition-choices.js";
import type { LocalRecognitionChoiceRequest } from "./local-recognition-choices.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const request = (
  index: number,
  meanings: readonly string[] = ["cloud-upload", "cloud-download", "umbrella"]
): LocalRecognitionChoiceRequest => ({
  meanings,
  presentationHash: hash(`presentation-${index}`),
  requestId: `request-${index}`,
  targetMeaning: "cloud-upload",
});

describe("local recognition choices", () => {
  test("ignores caller row and meaning order while retaining the original-order receipt", () => {
    const original = [request(1), request(2)];
    const reordered = [
      request(2, ["umbrella", "cloud-upload", "cloud-download"]),
      request(1, ["cloud-download", "umbrella", "cloud-upload"]),
    ];
    const first = buildLocalRecognitionChoices("cohort-a", original);
    const second = buildLocalRecognitionChoices("cohort-a", reordered);

    expect(second.map(({ requestId }) => requestId)).toEqual([
      "request-1",
      "request-2",
    ]);
    expect(second.map(({ choices }) => choices)).toEqual(
      first.map(({ choices }) => choices)
    );
    expect(second.map(({ receipt }) => receipt.shuffleIdentity)).toEqual(
      first.map(({ receipt }) => receipt.shuffleIdentity)
    );
    expect(second[0]?.receipt.originalChoicesHash).not.toBe(
      first[0]?.receipt.originalChoicesHash
    );
  });

  test("binds the shuffle to request and presentation identity", () => {
    const baseline = buildLocalRecognitionChoices("cohort-a", [request(1)]);
    const changedPresentation = buildLocalRecognitionChoices("cohort-a", [
      { ...request(1), presentationHash: hash("changed-presentation") },
    ]);
    const changedRequest = buildLocalRecognitionChoices("cohort-a", [
      { ...request(1), requestId: "different-request" },
    ]);

    expect(changedPresentation[0]?.receipt.shuffleIdentity).not.toBe(
      baseline[0]?.receipt.shuffleIdentity
    );
    expect(changedRequest[0]?.receipt.shuffleIdentity).not.toBe(
      baseline[0]?.receipt.shuffleIdentity
    );
    expect(changedPresentation[0]?.receipt.presentationHash).toBe(
      hash("changed-presentation")
    );
  });

  test("balances target position across a declared equal-choice cohort", () => {
    const cohort = Array.from({ length: 12 }, (_, index) => request(index + 1));
    const result = buildLocalRecognitionChoices("balanced-cohort", cohort);
    const positions = result.map(({ choices }) =>
      choices.indexOf("cloud-upload")
    );

    expect(
      Array.from(
        { length: 4 },
        (_, position) =>
          positions.filter((observed) => observed === position).length
      )
    ).toEqual([3, 3, 3, 3]);
    expect(result.every(({ choices }) => choices.includes("uncertain"))).toBe(
      true
    );
  });

  test("receipts hash the exact original and presented choice arrays", () => {
    const input = request(1, ["umbrella", "cloud-upload", "cloud-download"]);
    const [result] = buildLocalRecognitionChoices("cohort-a", [input]);
    if (!result) {
      throw new Error("Missing recognition choice fixture result");
    }

    expect(result.receipt).toMatchObject({
      choiceCount: 4,
      cohortId: "cohort-a",
      orderedChoicesHash: orderedRecognitionChoicesHash(result.choices),
      originalChoicesHash: originalRecognitionChoicesHash(input.meanings),
      presentationHash: input.presentationHash,
      requestId: input.requestId,
    });
    expect(result.receipt.originalChoicesHash).toBe(
      hash(JSON.stringify(input.meanings))
    );
    expect(result.receipt.orderedChoicesHash).toBe(
      hash(JSON.stringify(result.choices))
    );
  });

  test("rejects ambiguous or duplicate cohort identities", () => {
    expect(() =>
      buildLocalRecognitionChoices("cohort-a", [request(1), request(1)])
    ).toThrow("valid declared cohort");
    expect(() =>
      buildLocalRecognitionChoices("cohort-a", [
        { ...request(1), presentationHash: "not-a-hash" },
      ])
    ).toThrow("valid declared cohort");
    expect(() =>
      buildLocalRecognitionChoices("cohort-a", [
        request(1, ["cloud-download", "umbrella", "folder"]),
      ])
    ).toThrow("valid declared cohort");
    expect(() =>
      buildLocalRecognitionChoices("cohort-a", [
        request(1, ["cloud-upload", "uncertain", "umbrella"]),
      ])
    ).toThrow("valid declared cohort");
  });
});

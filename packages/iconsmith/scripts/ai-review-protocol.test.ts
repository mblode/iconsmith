import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import {
  AI_REVIEW_FINAL_VALIDATION_RESERVE_MS,
  AI_REVIEW_RECOGNITION_BUDGET_DIVISOR,
  AI_REVIEW_RECOGNITION_MAX_MS,
  aiReviewStageDeadlines,
  runAiReviewProtocol,
} from "./ai-review-protocol.js";

const evidenceHashes = (images: Record<string, Uint8Array>) =>
  Object.fromEntries(
    Object.entries(images).map(([name, bytes]) => [
      name,
      createHash("sha256").update(bytes).digest("hex"),
    ])
  );

test("budgets recognition early and reserves final validation once", () => {
  expect(aiReviewStageDeadlines(1000, 481_000)).toEqual({
    craftDeadlineAt: 476_000,
    finalValidationReserveMs: 5000,
    recognitionBudgetMs: 120_000,
    recognitionDeadlineAt: 121_000,
  });
  expect(aiReviewStageDeadlines(1000, 81_000)).toEqual({
    craftDeadlineAt: 76_000,
    finalValidationReserveMs: 5000,
    recognitionBudgetMs: 20_000,
    recognitionDeadlineAt: 21_000,
  });
  expect(AI_REVIEW_RECOGNITION_MAX_MS).toBe(120_000);
  expect(AI_REVIEW_RECOGNITION_BUDGET_DIVISOR).toBe(4);
  expect(AI_REVIEW_FINAL_VALIDATION_RESERVE_MS).toBe(5000);
  expect(() => aiReviewStageDeadlines(1000, 6000)).toThrow(
    "leave final validation time"
  );
});

test("seals recognition before revealing intended meaning and family anchors", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ai-protocol-"));
  const out = path.join(root, "review");
  let calls = 0;
  try {
    const result = await runAiReviewProtocol({
      deadlineAt: Date.now() + 10_000,
      invoke: ({ deadlineAt: stageDeadlineAt, questions, images }) => {
        calls += 1;
        if (calls === 1) {
          expect(stageDeadlineAt).toBeLessThan(Date.now() + 3000);
          expect(Object.keys(images)).toEqual(["s001.png"]);
          expect(questions[0].prompt).not.toContain("cloud-upload");
          expect(
            readFileSync(path.join(out, "protocol.json"), "utf-8")
          ).not.toContain('"concept"');
          expect(existsSync(path.join(out, "sealed-context.json"))).toBe(false);
        } else {
          expect(stageDeadlineAt).toBeGreaterThan(Date.now() + 4000);
          expect(stageDeadlineAt).toBeLessThanOrEqual(Date.now() + 5000);
          expect(
            JSON.parse(
              readFileSync(path.join(out, "recognition.json"), "utf-8")
            ).status
          ).toBe("complete");
          expect(questions[0].prompt).toContain(
            "intended concept for s001.png is cloud-upload"
          );
          expect(
            Object.keys(images).some((name) => name.startsWith("family-"))
          ).toBe(true);
        }
        return Promise.resolve({
          answers: Object.fromEntries(
            questions.map((question) => [
              question.id,
              {
                choice: question.choices[0],
                evidence: "Observed fixture",
                treatment: "",
              },
            ])
          ),
          evidenceHashes: evidenceHashes(images),
          model: "fixture-critic",
          status: "complete" as const,
        });
      },
      model: "fixture-critic",
      out,
      stimuli: [
        {
          concept: "cloud-upload",
          familyReferences: [Buffer.from("anchor")],
          id: "s001",
          image: Buffer.from("image"),
          meanings: ["cloud-upload", "cloud-download", "umbrella"],
        },
      ],
    });
    expect(calls).toBe(2);
    expect(result.status).toBe("complete");
    expect(result.qualified).toBe(false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("deduplicates shared anchors and preserves uncertain recognition", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ai-protocol-dedup-"));
  const out = path.join(root, "review");
  let calls = 0;
  try {
    const result = await runAiReviewProtocol({
      deadlineAt: Date.now() + 10_000,
      invoke: ({ images, questions }) => {
        calls += 1;
        if (calls === 2) {
          expect(
            Object.keys(images).filter((name) => name.startsWith("family-"))
          ).toHaveLength(1);
        }
        return Promise.resolve({
          answers: Object.fromEntries(
            questions.map((question) => [
              question.id,
              {
                choice: question.id.endsWith("-recognition")
                  ? "uncertain"
                  : question.choices[0],
                evidence: "Observed fixture",
                treatment: "",
              },
            ])
          ),
          evidenceHashes: evidenceHashes(images),
          model: "fixture-critic",
          status: "complete" as const,
        });
      },
      model: "fixture-critic",
      out,
      stimuli: ["s001", "s002"].map((id) => ({
        concept: "key",
        familyReferences: [Buffer.from("shared-anchor")],
        id,
        image: Buffer.from(id),
        meanings: ["key", "lock", "cloud"],
      })),
    });
    expect("recognition" in result ? result.recognition : null).toEqual([
      { correct: null, id: "s001" },
      { correct: null, id: "s002" },
    ]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test.each([
  ["missing", (_hashes: Record<string, string>) => ({})],
  [
    "wrong",
    (hashes: Record<string, string>) => ({
      ...hashes,
      [Object.keys(hashes)[0] ?? ""]: "0".repeat(64),
    }),
  ],
  [
    "extra",
    (hashes: Record<string, string>) => ({
      ...hashes,
      "unseen.png": "0".repeat(64),
    }),
  ],
])("refuses %s stage image evidence", async (_case, alter) => {
  const root = mkdtempSync(path.join(tmpdir(), "ai-protocol-evidence-"));
  let calls = 0;
  try {
    const result = await runAiReviewProtocol({
      deadlineAt: Date.now() + 10_000,
      invoke: ({ images, questions }) => {
        calls += 1;
        const hashes = evidenceHashes(images);
        return Promise.resolve({
          answers: Object.fromEntries(
            questions.map((question) => [
              question.id,
              {
                choice: question.choices[0],
                evidence: "Observed",
                treatment: "",
              },
            ])
          ),
          evidenceHashes: calls === 2 ? alter(hashes) : hashes,
          model: "fixture-critic",
          status: "complete" as const,
        });
      },
      model: "fixture-critic",
      out: path.join(root, "review"),
      stimuli: [
        {
          concept: "key",
          familyReferences: [Buffer.from("anchor")],
          id: "s001",
          image: Buffer.from("image"),
          meanings: ["key", "lock", "cloud"],
        },
      ],
    });
    expect(result.status).toBe("craft-incomplete");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects reviewer mutation of the immutable image packet", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ai-protocol-mutation-"));
  const image = Buffer.from("image");
  try {
    await expect(
      runAiReviewProtocol({
        deadlineAt: Date.now() + 10_000,
        invoke: ({ images }) => {
          images["s001.png"][0] = 0;
          return Promise.resolve({
            answers: null,
            model: null,
            status: "incomplete",
          });
        },
        model: "fixture-critic",
        out: path.join(root, "review"),
        stimuli: [
          {
            concept: "key",
            familyReferences: [Buffer.from("anchor")],
            id: "s001",
            image,
            meanings: ["key", "lock", "cloud"],
          },
        ],
      })
    ).rejects.toThrow("mutated immutable protocol images");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("incomplete recognition never starts craft or invents recognition answers", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ai-protocol-incomplete-"));
  const out = path.join(root, "review");
  let calls = 0;
  try {
    const result = await runAiReviewProtocol({
      deadlineAt: Date.now() + 10_000,
      invoke: () => {
        calls += 1;
        return Promise.resolve({
          answers: null,
          model: null,
          status: "incomplete" as const,
        });
      },
      model: "fixture-critic",
      out,
      stimuli: [
        {
          concept: "key",
          familyReferences: [Buffer.from("anchor")],
          id: "s001",
          image: Buffer.from("image"),
          meanings: ["key", "lock", "cloud"],
        },
      ],
    });
    expect(result.status).toBe("recognition-incomplete");
    expect(calls).toBe(1);
    expect(existsSync(path.join(out, "craft.json"))).toBe(false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

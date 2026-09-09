import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import { DRAFT_ACCEPTANCE_CONTRACT } from "../src/eval/acceptance-contract.js";
import {
  AI_REVIEW_FINAL_VALIDATION_RESERVE_MS,
  AI_REVIEW_RECOGNITION_BUDGET_DIVISOR,
  AI_REVIEW_RECOGNITION_MAX_MS,
  aiReviewStageDeadlines,
  buildFreeRecognitionQuestions,
  buildRecognitionQuestions,
  recognitionQuestionsHash,
  runAiReviewProtocol,
  runProspectiveAiReviewProtocol,
} from "./ai-review-protocol.js";
import { freezeSynonymKey } from "./quality-labels.js";

const evidenceHashes = (images: Record<string, Uint8Array>) =>
  Object.fromEntries(
    Object.entries(images).map(([name, bytes]) => [
      name,
      createHash("sha256").update(bytes).digest("hex"),
    ])
  );
const questionsById = (
  questions: ReturnType<typeof buildRecognitionQuestions>
) => Object.fromEntries(questions.map((question) => [question.id, question]));

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

test("seals free description before hidden-key adjudication and continues craft after mismatch", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ai-free-protocol-"));
  const out = path.join(root, "review");
  const key = freezeSynonymKey([
    {
      id: "s001",
      meaningProvenanceHash: "a".repeat(64),
      synonyms: ["heart", "love symbol"],
      target: "heart",
    },
  ]);
  let recognizerCalls = 0;
  try {
    const result = await runProspectiveAiReviewProtocol({
      adjudicator: {
        baseModelLineage: "claude",
        invoke: ({ deadlineAt, images, questions }) => {
          expect(deadlineAt).toBe(
            JSON.parse(readFileSync(path.join(out, "protocol.json"), "utf-8"))
              .stageDeadlines.adjudicationDeadlineAt
          );
          expect(existsSync(path.join(out, "recognition-terminal.json"))).toBe(
            true
          );
          expect(existsSync(path.join(out, "synonym-key.json"))).toBe(true);
          expect(Object.keys(images)).toEqual([]);
          expect(questions[0]?.prompt).toContain("Target: heart");
          return Promise.resolve({
            answers: Object.fromEntries(
              questions.map((question) => [
                question.id,
                {
                  choice: "mismatch",
                  evidence: "The sealed description differs",
                  treatment: "none",
                },
              ])
            ),
            baseModelLineage: "claude",
            evidenceHashes: {},
            model: "claude-opus",
            status: "complete" as const,
          });
        },
        model: "claude-opus",
      },
      deadlineAt: Date.now() + 30_000,
      expectedSynonymKeyHash: key.hash,
      out,
      recognizer: {
        baseModelLineage: "gpt",
        invoke: ({ deadlineAt, images, questions }) => {
          recognizerCalls += 1;
          const frozenDeadlines = JSON.parse(
            readFileSync(path.join(out, "protocol.json"), "utf-8")
          ).stageDeadlines;
          expect(deadlineAt).toBe(
            recognizerCalls === 1
              ? frozenDeadlines.recognitionDeadlineAt
              : frozenDeadlines.craftDeadlineAt
          );
          if (recognizerCalls === 1) {
            expect(existsSync(path.join(out, "synonym-key.json"))).toBe(false);
            expect(questions[0]?.choices).toEqual(["described", "unknown"]);
            expect(questions[0]?.prompt).not.toContain("heart");
            expect(JSON.stringify(questions)).not.toContain("love symbol");
          } else {
            expect(questions.map(({ id }) => id)).toEqual([
              "s001-critical",
              "s001-craft",
              "s001-family",
              "s001-native",
              "s001-ship",
            ]);
            expect(JSON.stringify(questions)).toContain(
              "Recognition and synonym adjudication are sealed; do not revise them"
            );
            expect(JSON.stringify(questions)).not.toContain("mismatch");
            expect(JSON.stringify(questions)).not.toContain(
              "The sealed description differs"
            );
          }
          return Promise.resolve({
            answers: Object.fromEntries(
              questions.map((question) => [
                question.id,
                {
                  choice: question.id.endsWith("free-recognition")
                    ? "described"
                    : question.choices[0],
                  evidence: "a square outline",
                  treatment: "none",
                },
              ])
            ),
            baseModelLineage: "gpt",
            evidenceHashes: evidenceHashes(images),
            model: "gpt-astra",
            status: "complete" as const,
          });
        },
        model: "gpt-astra",
      },
      stimuli: [
        {
          concept: "heart",
          familyReferences: [Buffer.from("anchor")],
          id: "s001",
          image: Buffer.from("image"),
          meanings: [],
        },
      ],
      synonymKey: key.rows,
    });
    expect(recognizerCalls).toBe(2);
    expect(result.status).toBe("complete");
    expect(result.productionSealEligible).toBe(false);
    expect(
      ["recognition", "adjudication", "craft"].map((stage) =>
        JSON.parse(
          readFileSync(path.join(out, `${stage}-terminal.json`), "utf-8")
        )
      )
    ).toEqual([
      expect.objectContaining({ complete: true, status: "complete" }),
      expect.objectContaining({ complete: true, status: "complete" }),
      expect.objectContaining({ complete: true, status: "complete" }),
    ]);
    expect("recognition" in result ? result.recognition : null).toEqual([
      { decision: "mismatch", id: "s001", recognitionSuccess: false },
    ]);
    const initialProtocol = readFileSync(
      path.join(out, "protocol.json"),
      "utf-8"
    );
    expect(initialProtocol).not.toContain("heart");
    expect(initialProtocol).not.toContain("love symbol");
    expect(initialProtocol).toContain(
      '"runtimeAccessRestrictionVerified": false'
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test.each(["recognition", "adjudication", "craft"] as const)(
  "seals a durable %s invoke rejection without starting a later stage",
  async (rejectedStage) => {
    const root = mkdtempSync(path.join(tmpdir(), `ai-free-${rejectedStage}-`));
    const out = path.join(root, "review");
    const key = freezeSynonymKey([
      {
        id: "s001",
        meaningProvenanceHash: "d".repeat(64),
        synonyms: ["heart"],
        target: "heart",
      },
    ]);
    let recognizerCalls = 0;
    let adjudicatorCalls = 0;
    try {
      const result = await runProspectiveAiReviewProtocol({
        adjudicator: {
          baseModelLineage: "claude",
          invoke: ({ images, questions }) => {
            adjudicatorCalls += 1;
            if (rejectedStage === "adjudication") {
              return Promise.reject(new Error("adjudication refused"));
            }
            return Promise.resolve({
              answers: Object.fromEntries(
                questions.map((question) => [
                  question.id,
                  {
                    choice: "match",
                    evidence: "sealed description matches",
                    treatment: "none",
                  },
                ])
              ),
              baseModelLineage: "claude",
              evidenceHashes: evidenceHashes(images),
              model: "claude-opus",
              status: "complete" as const,
            });
          },
          model: "claude-opus",
        },
        deadlineAt: Date.now() + 30_000,
        expectedSynonymKeyHash: key.hash,
        out,
        recognizer: {
          baseModelLineage: "gpt",
          invoke: ({ images, questions }) => {
            recognizerCalls += 1;
            const stage = recognizerCalls === 1 ? "recognition" : "craft";
            if (rejectedStage === stage) {
              return Promise.reject(new Error(`${stage} refused`));
            }
            return Promise.resolve({
              answers: Object.fromEntries(
                questions.map((question) => [
                  question.id,
                  {
                    choice: question.id.endsWith("free-recognition")
                      ? "described"
                      : question.choices[0],
                    evidence: "visible heart",
                    treatment: "none",
                  },
                ])
              ),
              baseModelLineage: "gpt",
              evidenceHashes: evidenceHashes(images),
              model: "gpt-astra",
              status: "complete" as const,
            });
          },
          model: "gpt-astra",
        },
        stimuli: [
          {
            concept: "heart",
            familyReferences: [Buffer.from("anchor")],
            id: "s001",
            image: Buffer.from("image"),
            meanings: [],
          },
        ],
        synonymKey: key.rows,
      });
      expect(result.status).toBe(`${rejectedStage}-incomplete`);
      expect(result.productionSealEligible).toBe(false);
      const terminal = JSON.parse(
        readFileSync(path.join(out, `${rejectedStage}-terminal.json`), "utf-8")
      );
      expect(terminal).toMatchObject({
        complete: false,
        status: "invoke-rejected",
      });
      expect(terminal.deadlineAt).toBeLessThanOrEqual(
        JSON.parse(readFileSync(path.join(out, "protocol.json"), "utf-8"))
          .stageDeadlines[`${rejectedStage}DeadlineAt`]
      );
      expect(existsSync(path.join(out, `${rejectedStage}-error.json`))).toBe(
        true
      );
      if (rejectedStage === "recognition") {
        expect(adjudicatorCalls).toBe(0);
        expect(existsSync(path.join(out, "synonym-key.json"))).toBe(false);
      }
      if (rejectedStage === "adjudication") {
        expect(recognizerCalls).toBe(1);
        expect(existsSync(path.join(out, "craft-questions.json"))).toBe(false);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

test("rejects declared or emitted same-lineage synonym adjudication", async () => {
  const questions = buildFreeRecognitionQuestions([{ id: "s001" }]);
  expect(questions[0]?.prompt).not.toContain("target-name");
  const key = freezeSynonymKey([
    {
      id: "s001",
      meaningProvenanceHash: "b".repeat(64),
      synonyms: ["target-name"],
      target: "target-name",
    },
  ]);
  await expect(
    runProspectiveAiReviewProtocol({
      adjudicator: {
        baseModelLineage: "gpt",
        invoke: () => Promise.reject(new Error("must not invoke")),
        model: "other-model",
      },
      deadlineAt: Date.now() + 20_000,
      expectedSynonymKeyHash: key.hash,
      out: path.join(tmpdir(), `same-lineage-${Date.now()}`),
      recognizer: {
        baseModelLineage: "gpt",
        invoke: () => Promise.reject(new Error("must not invoke")),
        model: "gpt-astra",
      },
      stimuli: [
        {
          concept: "target-name",
          familyReferences: [Buffer.from("anchor")],
          id: "s001",
          image: Buffer.from("image"),
          meanings: [],
        },
      ],
      synonymKey: key.rows,
    })
  ).rejects.toThrow("independent reviewers");
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
      recognitionOrderSeed: "protocol-test-seed",
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
      recognitionOrderSeed: "protocol-test-seed",
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
      recognitionOrderSeed: "protocol-test-seed",
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
        recognitionOrderSeed: "protocol-test-seed",
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
      recognitionOrderSeed: "protocol-test-seed",
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

const orderedStimuli = Array.from({ length: 8 }, (_, index) => ({
  concept: `target-${index}`,
  id: `s${String(index).padStart(3, "0")}`,
  meanings: [`target-${index}`, `near-${index}`, `far-${index}`],
}));

test("balances target position and makes caller choice order non-signaling", () => {
  const first = buildRecognitionQuestions(orderedStimuli, "balanced-seed");
  const positions = first.map(({ choices }, index) =>
    choices.indexOf(orderedStimuli[index]?.concept ?? "")
  );
  expect(
    Array.from(
      { length: 4 },
      (_, position) => positions.filter((value) => value === position).length
    )
  ).toEqual([2, 2, 2, 2]);
  expect(
    first
      .flatMap(({ choices }) => choices)
      .filter((choice) => choice === "uncertain")
  ).toHaveLength(8);

  const reversedInputs = orderedStimuli.map((row) => ({
    ...row,
    meanings: row.meanings.toReversed(),
  }));
  expect(buildRecognitionQuestions(reversedInputs, "balanced-seed")).toEqual(
    first
  );
  expect(
    questionsById(
      buildRecognitionQuestions(orderedStimuli.toReversed(), "balanced-seed")
    )
  ).toEqual(questionsById(first));
});

test("reproduces recognition order and changes its identity with the seed", () => {
  const first = buildRecognitionQuestions(orderedStimuli, "seed-one");
  const repeated = buildRecognitionQuestions(orderedStimuli, "seed-one");
  const changed = buildRecognitionQuestions(orderedStimuli, "seed-two");
  expect(repeated).toEqual(first);
  expect(recognitionQuestionsHash(repeated)).toBe(
    recognitionQuestionsHash(first)
  );
  expect(changed).not.toEqual(first);
  expect(recognitionQuestionsHash(changed)).not.toBe(
    recognitionQuestionsHash(first)
  );
});

test("passes exact frozen recognition questions and draft craft anchors before concept-aware craft", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ai-protocol-order-"));
  const out = path.join(root, "review");
  let calls = 0;
  try {
    await runAiReviewProtocol({
      deadlineAt: Date.now() + 10_000,
      invoke: ({ images, questions }) => {
        calls += 1;
        if (calls === 1) {
          expect(questions).toEqual(
            JSON.parse(
              readFileSync(
                path.join(out, "recognition-questions.json"),
                "utf-8"
              )
            )
          );
          expect(
            questions.every(({ prompt }) => !prompt.includes("target-object"))
          ).toBe(true);
          expect(existsSync(path.join(out, "sealed-context.json"))).toBe(false);
        } else {
          expect(existsSync(path.join(out, "recognition.json"))).toBe(true);
          expect(existsSync(path.join(out, "sealed-context.json"))).toBe(true);
          expect(questions[0]?.prompt).toContain(
            "intended concept for s001.png is target-object"
          );
          const { craftScale } = DRAFT_ACCEPTANCE_CONTRACT.calibration;
          const craftQuestion = questions.find(({ id }) => id === "s001-craft");
          expect(craftQuestion?.choices).toEqual(
            Array.from(
              { length: craftScale.maximum - craftScale.minimum + 1 },
              (_, index) => String(index + craftScale.minimum)
            )
          );
          expect(craftQuestion?.prompt).toContain(
            `Rate construction craft from ${craftScale.minimum} to ${craftScale.maximum}`
          );
          expect(craftQuestion?.prompt).toContain(
            `A 9 means ${craftScale.nine}.`
          );
          expect(craftQuestion?.prompt).toContain(
            `A 10 means ${craftScale.ten}.`
          );
        }
        return Promise.resolve({
          answers: Object.fromEntries(
            questions.map((question) => [
              question.id,
              {
                choice: question.choices[0] ?? "uncertain",
                evidence: "Observed fixture",
                treatment: "none",
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
      recognitionOrderSeed: "exact-question-seed",
      stimuli: [
        {
          concept: "target-object",
          familyReferences: [Buffer.from("anchor")],
          id: "s001",
          image: Buffer.from("image"),
          meanings: ["target-object", "near-object", "far-object"],
        },
      ],
    });
    expect(calls).toBe(2);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects a target name encoded in the pre-recognition stimulus identity", async () => {
  const key = freezeSynonymKey([
    {
      id: "heart",
      meaningProvenanceHash: "c".repeat(64),
      synonyms: ["love symbol"],
      target: "heart",
    },
  ]);
  await expect(
    runProspectiveAiReviewProtocol({
      adjudicator: {
        baseModelLineage: "claude",
        invoke: () => Promise.reject(new Error("must not invoke")),
        model: "claude-opus",
      },
      deadlineAt: Date.now() + 20_000,
      expectedSynonymKeyHash: key.hash,
      out: path.join(tmpdir(), `target-exposure-${Date.now()}`),
      recognizer: {
        baseModelLineage: "gpt",
        invoke: () => Promise.reject(new Error("must not invoke")),
        model: "gpt-astra",
      },
      stimuli: [
        {
          concept: "heart",
          familyReferences: [Buffer.from("anchor")],
          id: "heart",
          image: Buffer.from("image"),
          meanings: [],
        },
      ],
      synonymKey: key.rows,
    })
  ).rejects.toThrow("opaque IDs");
});

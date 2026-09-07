import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import {
  ASTRA_STRUCTURED_AUTHOR_MODEL,
  astraConstructionJsonSchema,
  runNativeAstraStructuredAuthor,
  validateAstraStructuredTrace,
} from "./local-astra-author.js";
import { finalReviewJsonSchema } from "./local-claude-author.js";

const context = (model: string) =>
  JSON.stringify({ payload: { model }, type: "turn_context" });

it("rejects tool use and a substituted model in native traces", () => {
  expect(() =>
    validateAstraStructuredTrace(
      `${context(ASTRA_STRUCTURED_AUTHOR_MODEL)}\n${JSON.stringify({ payload: { type: "local_shell_call" }, type: "response_item" })}`
    )
  ).toThrow("prohibited tool");
  expect(() => validateAstraStructuredTrace(context("gpt-5.6-sol"))).toThrow(
    "model identity differed"
  );
  expect(() =>
    validateAstraStructuredTrace(context(ASTRA_STRUCTURED_AUTHOR_MODEL))
  ).not.toThrow();
});

const expectStrictRequiredProperties = (schema: unknown) => {
  if (typeof schema !== "object" || schema === null) {
    return;
  }
  const record = schema as Record<string, unknown>;
  const properties = record.properties as Record<string, unknown> | undefined;
  if (properties) {
    expect(record.required).toEqual(Object.keys(properties));
    for (const child of Object.values(properties)) {
      expectStrictRequiredProperties(child);
    }
  }
  if (record.items) {
    expectStrictRequiredProperties(record.items);
  }
};

it("serializes every Astra object property as required", () => {
  expectStrictRequiredProperties(astraConstructionJsonSchema);
  expectStrictRequiredProperties(finalReviewJsonSchema);
  expect(astraConstructionJsonSchema.properties.programs).toMatchObject({
    required: ["filled", "outlined"],
  });
});

it("runs Astra through the shared structured lifecycle", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "astra-structured-"));
  const out = path.join(root, "run");
  const invoke = vi.fn(({ images, prompt, schema }) =>
    schema === astraConstructionJsonSchema
      ? (expect(images).toEqual({ "reference.png": Buffer.from("reference") }),
        Promise.resolve({
          addressedDefectIds: [],
          programs: {
            filled: null,
            outlined: "icon ring\nfinish outlined\ncircle 12,12 r8",
          },
        }))
      : (expect(prompt).toContain("cannot change or return geometry"),
        Promise.resolve({
          reviewMarkdown: "Exact proof inspected.",
          unresolved: [],
        }))
  );
  const review = vi.fn(({ images, model, out: reviewOut }) => {
    // The production reviewer owns this directory and creates it on entry.
    mkdirSync(reviewOut, { recursive: false });
    return Promise.resolve({
      answers: {
        "author-self-review-outlined": {
          choice: "pass",
          evidence: "Counter remains open.",
          treatment: "",
        },
      },
      evidenceHashes: Object.fromEntries(
        Object.keys(images).map((name) => [name, "hash"])
      ),
      model,
      status: "complete" as const,
    });
  });
  try {
    const result = await runNativeAstraStructuredAuthor({
      check: () =>
        Promise.resolve({
          proofs: { outlined: Buffer.from("png") },
          status: 0,
          stderr: "",
          stdout: "ok",
        }),
      concept: "ring",
      deadlineAt: Date.now() + 600_000,
      finishes: ["outlined"],
      invoke,
      out,
      preflight: () => ({
        cliVersion: "test",
        executable: "/test/codex",
        executableSha256: "sha",
        loggedIn: true,
      }),
      prompt: "Draw a ring.",
      referenceImages: { "reference.png": Buffer.from("reference") },
      review: review as never,
    });
    expect(result).toMatchObject({
      model: ASTRA_STRUCTURED_AUTHOR_MODEL,
      status: "delivered",
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({
        images: expect.objectContaining({
          "anchor-reference.png": Buffer.from("reference"),
          "outlined-proof.png": Buffer.from("png"),
        }),
        model: ASTRA_STRUCTURED_AUTHOR_MODEL,
      })
    );
    expect(
      JSON.parse(
        readFileSync(path.join(out, "native-astra-author.json"), "utf-8")
      )
    ).toMatchObject({
      requestedModel: ASTRA_STRUCTURED_AUTHOR_MODEL,
      selfInspection: true,
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import {
  claudeStructuredArgs,
  claudeStreamInput,
  nativeClaudeAuthorAdapters,
  constructionJsonSchema,
  runNativeClaudeStructuredAuthor,
} from "./local-claude-author.js";
import { STRUCTURED_AUTHOR_MODEL } from "./local-structured-author.js";

it("pins native structured construction to Claude Opus with no tools", () => {
  const args = claudeStructuredArgs(constructionJsonSchema);
  expect(
    args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)
  ).toEqual(["--tools", ""]);
  expect(
    args.slice(
      args.indexOf("--allowedTools"),
      args.indexOf("--allowedTools") + 2
    )
  ).toEqual(["--allowedTools", ""]);
  expect(args[args.indexOf("--model") + 1]).toBe(STRUCTURED_AUTHOR_MODEL);
  expect(args[args.indexOf("--effort") + 1]).toBe("high");
  const mediumArgs = claudeStructuredArgs(constructionJsonSchema, "medium");
  expect(mediumArgs[mediumArgs.indexOf("--effort") + 1]).toBe("medium");
  expect(args).toContain("--json-schema");
  expect(args).toContain("--input-format");
  expect(args).not.toContain("Read");
  const stream = JSON.parse(
    claudeStreamInput("construct", {
      "reference.png": Buffer.from("exact-reference"),
    })
  );
  const image = stream.message.content.find(
    (item: { type: string }) => item.type === "image"
  );
  expect(Buffer.from(image.source.data, "base64").toString()).toBe(
    "exact-reference"
  );
});

it("refuses a reusable static container without a call factory", () => {
  expect(() =>
    nativeClaudeAuthorAdapters({
      concept: "ring",
      container: {} as never,
      deadlineAt: Date.now() + 10_000,
      out: "/unused",
      referenceImages: { "reference.png": Buffer.from("reference") },
    })
  ).toThrow("call-scoped container factory");
});

it("allocates self-review from its own parent-deadline call scope", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "claude-call-scope-"));
  const receiptRoot = path.join(root, "receipts");
  const runtimeRoot = path.join(root, "runtime");
  mkdirSync(receiptRoot);
  mkdirSync(runtimeRoot);
  const deadlineAt = Date.now() + 60_000;
  const config = { namePrefix: "call-specific" };
  const containerFactory = {
    create: vi.fn(() => ({ config, scope: {} })),
  };
  const review = vi.fn(() =>
    Promise.resolve({
      answers: {
        "author-self-review-outlined": {
          choice: "pass",
          evidence: "Open counter.",
          treatment: "",
        },
      },
      apiChargeUsd: null,
      billing: "subscription",
      craftApproved: false,
      evidenceHashes: {},
      instrumentQualified: false,
      model: STRUCTURED_AUTHOR_MODEL,
      status: "complete" as const,
    })
  );
  try {
    const adapters = nativeClaudeAuthorAdapters({
      concept: "ring",
      containerFactory: containerFactory as never,
      deadlineAt,
      invoke: vi.fn(),
      out: receiptRoot,
      preflight: () => ({
        authMethod: "claude.ai",
        cliVersion: "test",
        executable: "/test/claude",
        executableSha256: "sha",
        loggedIn: true,
      }),
      referenceImages: { "reference.png": Buffer.from("reference") },
      review: review as never,
      runtimeRoot,
    });
    await adapters.inspect({
      deadlineAt: deadlineAt - 10_000,
      model: STRUCTURED_AUTHOR_MODEL,
      programHashes: { outlined: "program-hash" },
      proofHashes: { outlined: "proof-hash" },
      proofs: { outlined: Buffer.from("proof") },
    });
    expect(containerFactory.create).not.toHaveBeenCalled();
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({
        deadlineAt: deadlineAt - 10_000,
        nativeCall: {
          containerFactory,
          ordinal: 0,
          parentDeadlineAt: deadlineAt,
          runtimeCwd: path.join(runtimeRoot, "00-author-self-review"),
          stageKind: "author-self-review",
        },
        out: path.join(receiptRoot, "00-author-self-review"),
      })
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("runs construction, exact-proof self-inspection, and review-only finalization", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "native-structured-author-"));
  const out = path.join(root, "run");
  const invoke = vi.fn(({ images, prompt, schema }) => {
    if (schema === constructionJsonSchema) {
      expect(images).toEqual({
        "reference.png": Buffer.from("reference"),
      });
      return Promise.resolve({
        addressedDefectIds: [],
        programs: { outlined: "icon ring\nfinish outlined\ncircle 12,12 r8" },
      });
    }
    expect(prompt).toContain("cannot change or return geometry");
    return Promise.resolve({
      reviewMarkdown: "Exact proof inspected.",
      unresolved: [],
    });
  });
  const review = vi.fn(({ images, out: reviewOut }) => {
    // The production reviewer owns this directory and creates it on entry.
    mkdirSync(reviewOut, { recursive: false });
    return Promise.resolve({
      answers: {
        "author-self-review-outlined": {
          choice: "pass",
          evidence: "The counter remains open at native size.",
          treatment: "",
        },
      },
      apiChargeUsd: null,
      billing: "subscription",
      craftApproved: false,
      evidenceHashes: Object.fromEntries(
        Object.keys(images).map((name) => [name, "hash"])
      ),
      instrumentQualified: false,
      model: STRUCTURED_AUTHOR_MODEL,
      status: "complete" as const,
    });
  });
  try {
    const result = await runNativeClaudeStructuredAuthor({
      check: () =>
        Promise.resolve({
          proofs: { outlined: Buffer.from("png") },
          status: 0,
          stderr: "",
          stdout: "check0",
        }),
      concept: "ring",
      deadlineAt: Date.now() + 600_000,
      effort: "medium",
      finishes: ["outlined"],
      invoke,
      out,
      preflight: () => ({
        authMethod: "claude.ai",
        cliVersion: "9.9.9 test",
        executable: "/test/claude",
        executableSha256: "test-sha256",
        loggedIn: true,
      }),
      prompt: "Draw a ring.",
      referenceImages: { "reference.png": Buffer.from("reference") },
      review: review as never,
    });
    expect(result.status).toBe("delivered");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({
        images: expect.objectContaining({
          "anchor-reference.png": Buffer.from("reference"),
          "outlined-proof.png": Uint8Array.from(Buffer.from("png")),
        }),
      })
    );
    expect(
      JSON.parse(
        readFileSync(path.join(out, "native-claude-author.json"), "utf-8")
      )
    ).toMatchObject({
      actualCliVersion: "9.9.9 test",
      billing: "subscription",
      concept: "ring",
      craftApproved: false,
      instrumentQualified: false,
      requestedEffort: "medium",
      requestedModel: STRUCTURED_AUTHOR_MODEL,
      selfInspection: true,
    });
    expect(
      JSON.parse(readFileSync(path.join(out, "author-review.json"), "utf-8"))
    ).toEqual({ unresolved: [] });
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ effort: "medium" })
    );
    expect(
      JSON.parse(
        readFileSync(path.join(out, "00-construct/request.json"), "utf-8")
      )
    ).toMatchObject({ effort: "medium", model: STRUCTURED_AUTHOR_MODEL });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

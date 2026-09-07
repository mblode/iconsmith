import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import sharp from "sharp";
import { expect, test } from "vitest";

import {
  codexReviewStageTimeoutMs,
  parseCodexStructuredOutput,
  reviewImagesWithCodex,
} from "./local-codex-review.js";

test("bounds Codex stages by the configured ceiling and absolute deadline", () => {
  expect(codexReviewStageTimeoutMs(undefined, undefined, 100)).toBe(240_000);
  expect(codexReviewStageTimeoutMs(undefined, 480_000, 100)).toBe(480_000);
  expect(codexReviewStageTimeoutMs(12_000, 480_000, 2000)).toBe(10_000);
  expect(() => codexReviewStageTimeoutMs(undefined, -1)).toThrow("1..480000");
  expect(() => codexReviewStageTimeoutMs(undefined, 480_001)).toThrow(
    "1..480000"
  );
});

const fixture = async (
  scenario:
    | "complete"
    | "extra-attachment"
    | "hidden-tool"
    | "low-attachment"
    | "missing-attachment"
    | "nonoriginal-tool"
    | "changed"
    | "late-completion"
    | "duplicate-bytes"
) => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-review-"));
  const image = await sharp({
    create: { background: "#000", channels: 4, height: 16, width: 16 },
  })
    .png()
    .toBuffer();
  const trace = (cwd: string) => {
    const attached = {
      detail: scenario === "low-attachment" ? "low" : "high",
      image_url: `data:image/png;base64,${image.toString("base64")}`,
      type: "input_image",
    };
    const content = scenario === "missing-attachment" ? [] : [attached];
    if (scenario === "duplicate-bytes") {
      content.push({ ...attached });
    }
    if (scenario === "extra-attachment") {
      content.push({
        detail: "high",
        image_url: `data:image/png;base64,${Buffer.from("outside").toString("base64")}`,
        type: "input_image",
      });
    }
    const traceRecords: { payload: Record<string, unknown>; type: string }[] = [
      {
        payload: { cwd, id: "00000000-0000-0000-0000-000000000000" },
        type: "session_meta",
      },
      { payload: { model: "gpt-6-astra" }, type: "turn_context" },
      {
        payload: { content, role: "user", type: "message" },
        type: "response_item",
      },
    ];
    if (scenario === "hidden-tool" || scenario === "nonoriginal-tool") {
      traceRecords.push({
        payload: {
          arguments: JSON.stringify({
            detail: scenario === "nonoriginal-tool" ? "low" : "original",
            path: path.join(cwd, "candidate.png"),
          }),
          call_id: "call-1",
          name: "view_image",
          status: "completed",
          type: "function_call",
        },
        type: "response_item",
      });
    }
    return traceRecords.map((record) => JSON.stringify(record)).join("\n");
  };
  const result = await reviewImagesWithCodex({
    deadlineAt: scenario === "late-completion" ? Date.now() + 5 : undefined,
    images:
      scenario === "duplicate-bytes"
        ? { "candidate.png": image, "reference.png": image }
        : { "candidate.png": image },
    invoke: async ({ cwd, prompt }) => {
      expect(prompt).toContain(
        "For every factual claim about a count, contact, merge, clipping, closure, or disappearing feature"
      );
      expect(prompt).toContain("use an uncertainty choice when one is offered");
      expect(prompt).toContain(
        "while selecting only from the provided choices"
      );
      if (scenario === "changed") {
        writeFileSync(path.join(cwd, "candidate.png"), "changed");
      }
      if (scenario === "late-completion") {
        await sleep(10);
      }
      return {
        code: 0,
        killed: false,
        stderr: "",
        stdout: [
          {
            thread_id: "00000000-0000-0000-0000-000000000000",
            type: "thread.started",
          },
          {
            item: {
              text: "I inspected the supplied image at original detail.",
              type: "agent_message",
            },
            type: "item.completed",
          },
          {
            item: {
              text: JSON.stringify({
                answers: {
                  "S001-ship": {
                    choice: "yes",
                    evidence: "Clear native pixels.",
                    treatment: "",
                  },
                },
              }),
              type: "agent_message",
            },
            type: "item.completed",
          },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n"),
      };
    },
    model: "gpt-6-astra",
    out: path.join(root, "out"),
    prepareContext: () => ({ args: [], receiptName: "context-preflight.json" }),
    questions: [
      { choices: ["yes", "no"], id: "S001-ship", prompt: "Ship unchanged?" },
    ],
    readTrace: (_stdout, cwd) => trace(cwd),
  });
  return { result, root };
};

test("accepts only byte-matched original-detail Codex image inspection", async () => {
  const { result, root } = await fixture("complete");
  try {
    expect(result).toMatchObject({
      model: "gpt-6-astra",
      provider: "openai-codex",
      status: "complete",
    });
    expect(result.imageInspection?.complete).toBe(true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("accepts duplicate image bytes only with matching attachment multiplicity and order", async () => {
  const { result, root } = await fixture("duplicate-bytes");
  try {
    expect(result.status).toBe("complete");
    expect(result.imageInspection?.images).toMatchObject({
      "candidate.png": { exposed: true },
      "reference.png": { exposed: true },
    });
    expect(result.evidenceHashes["candidate.png"]).toBe(
      result.evidenceHashes["reference.png"]
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("does not accept a Codex answer after its absolute deadline", async () => {
  const { result, root } = await fixture("late-completion");
  try {
    expect(result.status).toBe("incomplete");
    expect(result.reason).toContain("deadline exhausted");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test.each([
  "extra-attachment",
  "missing-attachment",
  "hidden-tool",
  "low-attachment",
  "nonoriginal-tool",
] as const)(
  "rejects an unscoped attachment or tool trace: %s",
  async (scenario) => {
    const { result, root } = await fixture(scenario);
    try {
      expect(result.status).toBe("incomplete");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

test.each(["changed"] as const)(
  "refuses altered on-disk evidence: %s",
  async (scenario) => {
    const { result, root } = await fixture(scenario);
    try {
      expect(result.status).toBe("incomplete");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

test("requires the unique schema-valid answer to be the final agent message", () => {
  const answer = JSON.stringify({
    answers: {
      question: { choice: "yes", evidence: "pixels", treatment: "none" },
    },
  });
  const stdout = [answer, "trailing commentary"].map((text) =>
    JSON.stringify({
      item: { text, type: "agent_message" },
      type: "item.completed",
    })
  );
  expect(() => parseCodexStructuredOutput(stdout.join("\n"))).toThrow(
    "unambiguous"
  );
});

test("rejects multiple schema-valid agent messages", () => {
  const answer = JSON.stringify({
    answers: {
      question: { choice: "yes", evidence: "pixels", treatment: "none" },
    },
  });
  const stdout = [answer, answer].map((text) =>
    JSON.stringify({
      item: { text, type: "agent_message" },
      type: "item.completed",
    })
  );
  expect(() => parseCodexStructuredOutput(stdout.join("\n"))).toThrow(
    "unambiguous"
  );
});

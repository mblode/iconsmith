import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { expect, it } from "vitest";

import { png } from "../src/tools/render.js";
import { reviewImages, reviewStageTimeoutMs } from "./local-review.js";

it("bounds reviewer stages by the configured ceiling and absolute deadline", () => {
  expect(reviewStageTimeoutMs(undefined, undefined, 100)).toBe(240_000);
  expect(reviewStageTimeoutMs(undefined, 480_000, 100)).toBe(480_000);
  expect(reviewStageTimeoutMs(12_000, 480_000, 2000)).toBe(10_000);
  expect(() => reviewStageTimeoutMs(undefined, 480_001)).toThrow("1..480000");
  expect(() => reviewStageTimeoutMs(undefined, 0)).toThrow("1..480000");
});

it.each([
  "complete",
  "timeout",
  "missing-image",
  "failed-image",
  "missing-answer",
  "extra-answer",
  "invalid-choice",
  "denied",
  "outside-read",
  "changed-image",
  "missing-model",
  "wrong-model",
  "recovered-interruption",
  "unproven-interruption",
  "activity-after-recovery",
  "late-completion",
])("binds review completion to actual evidence: %s", async (scenario) => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-review-"));
  const out = path.join(root, "review");
  const source = await png(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="8"/></svg>',
    24
  );
  try {
    const result = await reviewImages({
      deadlineAt: scenario === "late-completion" ? Date.now() + 5 : undefined,
      effort: scenario === "complete" ? "medium" : undefined,
      images: { "candidate.png": source },
      invoke: async ({ cwd, effort, prompt, schema }) => {
        expect(effort).toBe(scenario === "complete" ? "medium" : "high");
        expect(
          JSON.parse(readFileSync(path.join(out, "request.json"), "utf-8"))
            .requestedEffort
        ).toBe(effort);
        expect(prompt).toContain("Host-measured grayscale samples");
        expect(prompt).toContain('"width":24');
        expect(prompt).toContain(
          "For every factual claim about a count, contact, merge, clipping, closure, or disappearing feature"
        );
        expect(prompt).toContain(
          "use an uncertainty choice when one is offered"
        );
        expect(prompt).toContain(
          "while selecting only from the provided choices"
        );
        expect(JSON.parse(schema).properties.answers.required).toEqual([
          "counter",
        ]);
        expect(readFileSync(path.join(cwd, "candidate.png"))).toEqual(source);
        if (scenario === "changed-image") {
          writeFileSync(path.join(cwd, "candidate.png"), "changed");
        }
        const answer = {
          choice: scenario === "invalid-choice" ? "maybe" : "no",
          evidence: "The centre is solid black.",
          treatment: "",
        };
        const answers =
          scenario === "missing-answer"
            ? {}
            : {
                counter: answer,
                ...(scenario === "extra-answer" ? { surprise: answer } : {}),
              };
        const events = [
          {
            model:
              scenario === "missing-model"
                ? ""
                : `${scenario === "wrong-model" ? "different" : "claude-opus-5"}[1m]`,
            subtype: "init",
            type: "system",
          },
          {
            message: {
              content: [
                {
                  id: "read-1",
                  input: {
                    file_path:
                      scenario === "outside-read"
                        ? "../answer-key.json"
                        : "candidate.png",
                  },
                  name: "Read",
                  type: "tool_use",
                },
              ],
            },
            type: "assistant",
          },
          ...(scenario === "missing-image"
            ? []
            : [
                {
                  message: {
                    content: [
                      {
                        content: [
                          {
                            source: {
                              data: source.toString("base64"),
                              type: "base64",
                            },
                            type: "image",
                          },
                        ],
                        is_error: scenario === "failed-image",
                        tool_use_id: "read-1",
                        type: "tool_result",
                      },
                    ],
                  },
                  type: "user",
                },
              ]),
          ...(scenario.includes("interruption") ||
          scenario === "activity-after-recovery"
            ? [
                {
                  message: {
                    content: [
                      {
                        id: "structured-1",
                        input: { answers },
                        name: "StructuredOutput",
                        type: "tool_use",
                      },
                    ],
                  },
                  type: "assistant",
                },
                ...(scenario === "activity-after-recovery"
                  ? [{ message: { content: [] }, type: "assistant" }]
                  : []),
              ]
            : [
                {
                  is_error: false,
                  permission_denials: scenario === "denied" ? ["Read"] : [],
                  structured_output: { answers },
                  subtype: "success",
                  type: "result",
                },
              ]),
        ];
        const interrupted =
          scenario.includes("interruption") ||
          scenario === "activity-after-recovery";
        if (scenario === "late-completion") {
          await sleep(10);
        }
        return {
          code: interrupted || scenario === "timeout" ? null : 0,
          killed: interrupted || scenario === "timeout",
          quiescent:
            scenario === "recovered-interruption" ||
            scenario === "activity-after-recovery",
          stderr: "",
          stdout: events.map((event) => JSON.stringify(event)).join("\n"),
        };
      },
      out,
      questions: [
        {
          choices: ["yes", "no", "uncertain"],
          compactChoices: true,
          id: "counter",
          prompt: "Is the centre open?",
        },
      ],
    });
    expect(result.status).toBe(
      scenario === "complete" || scenario === "recovered-interruption"
        ? "complete"
        : "incomplete"
    );
    expect(result.craftApproved).toBe(false);
    expect(result.instrumentQualified).toBe(false);
    if (result.status === "complete") {
      expect(result.provider).toBe("anthropic-claude");
    } else {
      expect(result).not.toHaveProperty("provider");
    }
    expect(result.answers?.counter.choice).toBe(
      scenario === "complete" || scenario === "recovered-interruption"
        ? "no"
        : undefined
    );
    if (scenario === "recovered-interruption") {
      expect(result.completionProvenance).toBe(
        "host-validated-after-reviewer-interruption"
      );
    }
    if (scenario === "late-completion") {
      expect(result.reason).toContain("deadline exhausted");
    }
    expect(
      JSON.parse(readFileSync(path.join(out, "review.json"), "utf-8"))
    ).toEqual(result);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("rejects invalid effort before creating a review or invoking a provider", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "invalid-review-effort-"));
  let calls = 0;
  try {
    await expect(
      reviewImages({
        effort: "unbounded" as never,
        images: {},
        invoke: () => {
          calls += 1;
          return Promise.reject(new Error("must not dispatch"));
        },
        out: path.join(root, "review"),
        questions: [],
      })
    ).rejects.toThrow("effort must be medium or high");
    expect(calls).toBe(0);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

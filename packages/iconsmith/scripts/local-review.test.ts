import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { png } from "../src/tools/render.js";
import { reviewImages } from "./local-review.js";

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
])("binds review completion to actual evidence: %s", async (scenario) => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-review-"));
  const out = path.join(root, "review");
  const source = await png(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="8"/></svg>',
    24
  );
  try {
    const result = await reviewImages({
      images: { "candidate.png": source },
      invoke: ({ cwd, prompt, schema }) => {
        expect(prompt).toContain("Host-measured grayscale samples");
        expect(prompt).toContain('"width":24');
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
                        content: [{ type: "image" }],
                        is_error: scenario === "failed-image",
                        tool_use_id: "read-1",
                        type: "tool_result",
                      },
                    ],
                  },
                  type: "user",
                },
              ]),
          {
            is_error: false,
            permission_denials: scenario === "denied" ? ["Read"] : [],
            structured_output: { answers },
            subtype: "success",
            type: "result",
          },
        ];
        return Promise.resolve({
          code: scenario === "timeout" ? 143 : 0,
          killed: scenario === "timeout",
          stderr: "",
          stdout: events.map((event) => JSON.stringify(event)).join("\n"),
        });
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
      scenario === "complete" ? "complete" : "incomplete"
    );
    expect(result.craftApproved).toBe(false);
    expect(result.instrumentQualified).toBe(false);
    expect(result.answers?.counter.choice).toBe(
      scenario === "complete" ? "no" : undefined
    );
    expect(
      JSON.parse(readFileSync(path.join(out, "review.json"), "utf-8"))
    ).toEqual(result);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

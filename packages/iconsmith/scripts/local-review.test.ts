import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { expect, it, vi } from "vitest";

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

it("returns incomplete without invoking a host fallback", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "review-no-container-"));
  try {
    const source = await png(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="8"/></svg>',
      24
    );
    const result = await reviewImages({
      images: { "candidate.png": source },
      out: path.join(root, "review"),
      questions: [
        { choices: ["yes", "no"], id: "visible", prompt: "Visible?" },
      ],
    });
    expect(result).toMatchObject({
      reason: expect.stringContaining("explicit diagnostic container"),
      status: "incomplete",
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("allocates a unique Claude review runtime while keeping receipts separate", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "review-factory-"));
  const out = path.join(root, "receipts", "review");
  mkdirSync(path.dirname(out));
  const runtimeCwd = path.join(root, "runtime", "reviewer-claude");
  mkdirSync(path.dirname(runtimeCwd));
  const parentDeadlineAt = Date.now() + 30_000;
  const config = { marker: "call-scoped" } as never;
  const create = vi.fn((request: { cwd: string; deadlineAt: number }) => {
    mkdirSync(request.cwd);
    return {
      config,
      scope: {
        cwd: request.cwd,
        deadlineAt: request.deadlineAt,
        intent: {} as never,
        stateDirectory: path.join(request.cwd, "native-state"),
      },
    };
  });
  try {
    const source = await png(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="8"/></svg>',
      24
    );
    await reviewImages({
      deadlineAt: parentDeadlineAt - 5000,
      images: { "candidate.png": source },
      invokeContained: (request, received) => {
        expect(received).toBe(config);
        expect(request.cwd).toBe(runtimeCwd);
        return Promise.resolve({
          code: null,
          killed: false,
          stderr: "diagnostic",
          stdout: "",
        });
      },
      maxStageMs: 1000,
      nativeCall: {
        containerFactory: { create } as never,
        ordinal: 6,
        parentDeadlineAt,
        runtimeCwd,
        stageKind: "reviewer-claude",
      },
      out,
      questions: [
        { choices: ["yes", "no"], id: "visible", prompt: "Visible?" },
      ],
    });
    expect(create).toHaveBeenCalledWith({
      cwd: runtimeCwd,
      deadlineAt: parentDeadlineAt,
      ordinal: 6,
      stageKind: "reviewer-claude",
    });
    expect(existsSync(path.join(out, "process.json"))).toBe(true);
    expect(existsSync(path.join(runtimeCwd, "candidate.png"))).toBe(true);
    expect(existsSync(path.join(out, "candidate.png"))).toBe(false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("rejects a reusable static Claude container outside diagnostics", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "review-static-"));
  try {
    const source = await png(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="8"/></svg>',
      24
    );
    await expect(
      reviewImages({
        container: {} as never,
        images: { "candidate.png": source },
        out: path.join(root, "review"),
        questions: [
          { choices: ["yes", "no"], id: "visible", prompt: "Visible?" },
        ],
      })
    ).rejects.toThrow("Static Claude container config cannot run a review");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("rejects overlapping Claude runtime and receipt paths before reservation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "review-overlap-"));
  const create = vi.fn();
  try {
    const source = await png(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="8"/></svg>',
      24
    );
    await expect(
      reviewImages({
        deadlineAt: Date.now() + 5000,
        images: { "candidate.png": source },
        nativeCall: {
          containerFactory: { create } as never,
          ordinal: 6,
          parentDeadlineAt: Date.now() + 10_000,
          runtimeCwd: path.join(root, "review", "runtime"),
          stageKind: "reviewer-claude",
        },
        out: path.join(root, "review"),
        questions: [
          { choices: ["yes", "no"], id: "visible", prompt: "Visible?" },
        ],
      })
    ).rejects.toThrow("receipts must stay outside");
    expect(create).not.toHaveBeenCalled();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it.each([
  "complete",
  "output-result",
  "foreign-result",
  "nested-image",
  "server-tool",
  "read",
  "image",
  "wrong-model",
])(
  "sealed text Claude review rejects image and file access: %s",
  async (scenario) => {
    const root = mkdtempSync(path.join(tmpdir(), "claude-text-review-"));
    try {
      const result = await reviewImages({
        evidenceMode: "sealed-text",
        images: {},
        invoke: ({ prompt }) => {
          expect(prompt).toContain("Do not read files");
          expect(prompt).not.toContain("Host-measured");
          const extras: Record<string, unknown> = {
            read: {
              id: "read-1",
              input: { file_path: "key.json" },
              name: "Read",
              type: "tool_use",
            },
            "server-tool": {
              id: "server-1",
              name: "web_search",
              type: "server_tool_use",
            },
          };
          const extra = extras[scenario] ?? {
            source: { data: "AA==", type: "base64" },
            type: "image",
          };
          return Promise.resolve({
            code: 0,
            killed: false,
            stderr: "",
            stdout: [
              {
                model:
                  scenario === "wrong-model" ? "other" : "claude-opus-5[1m]",
                subtype: "init",
                type: "system",
              },
              ...(["read", "image", "server-tool"].includes(scenario)
                ? [{ message: { content: [extra] }, type: "assistant" }]
                : []),
              ...(["output-result", "foreign-result", "nested-image"].includes(
                scenario
              )
                ? [
                    {
                      message: {
                        content: [
                          {
                            id: "output-1",
                            input: {},
                            name: "StructuredOutput",
                            type: "tool_use",
                          },
                        ],
                      },
                      type: "assistant",
                    },
                    {
                      message: {
                        content: [
                          {
                            content:
                              scenario === "nested-image"
                                ? [
                                    {
                                      source: { data: "AA==", type: "base64" },
                                      type: "image",
                                    },
                                  ]
                                : [{ text: "Accepted", type: "text" }],
                            tool_use_id:
                              scenario === "foreign-result"
                                ? "other"
                                : "output-1",
                            type: "tool_result",
                          },
                        ],
                      },
                      type: "user",
                    },
                  ]
                : []),
              {
                is_error: false,
                structured_output: {
                  answers: {
                    s001: {
                      choice: "match",
                      evidence: "Same meaning.",
                      treatment: "",
                    },
                  },
                },
                subtype: "success",
                type: "result",
              },
            ]
              .map((event) => JSON.stringify(event))
              .join("\n"),
          });
        },
        out: path.join(root, "out"),
        questions: [
          {
            choices: ["match", "uncertain"],
            id: "s001",
            prompt: "Sealed description: heart. Target: heart.",
          },
        ],
      });
      expect(result.status).toBe(
        ["complete", "output-result"].includes(scenario)
          ? "complete"
          : "incomplete"
      );
      expect(result.baseModelLineage).toBe(
        ["complete", "output-result"].includes(scenario)
          ? "claude-opus-5"
          : null
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

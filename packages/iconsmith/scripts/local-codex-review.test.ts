import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import sharp from "sharp";
import { expect, test, vi } from "vitest";

import {
  codexReviewStageTimeoutMs,
  parseCodexStructuredOutput,
  reviewImagesWithCodex,
} from "./local-codex-review.js";
import { CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE } from "./local-native-call-factory.js";

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

test("returns a collector inspection capability bound to the exact adapter request", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-inspection-seal-"));
  const runtimeCwd = path.join(root, "runtime");
  const out = path.join(root, "out");
  const deadlineAt = Date.now() + 30_000;
  const image = await sharp({
    create: { background: "#000", channels: 4, height: 16, width: 16 },
  })
    .png()
    .toBuffer();
  const collectorTrace = {
    file: "/collector/trace.jsonl",
    receiptFile: "/collector/receipt.json",
    receiptSha256: "a".repeat(64),
    sha256: "b".repeat(64),
  } as never;
  const persistValidatedAdapterTrace = vi.fn(() => collectorTrace);
  const create = vi.fn((request: { cwd: string; deadlineAt: number }) => {
    mkdirSync(request.cwd);
    return {
      config: { environment: { CODEX_HOME: "/call/state" } } as never,
      persistValidatedAdapterTrace,
      scope: {
        cwd: request.cwd,
        deadlineAt: request.deadlineAt,
        intent: {} as never,
        stateDirectory: path.join(request.cwd, "native-state"),
      },
    };
  });
  const stdout = JSON.stringify({
    item: {
      text: JSON.stringify({
        answers: {
          "author-self-review-outlined": {
            choice: "pass",
            evidence: "Exact proof is clear.",
            treatment: "",
          },
        },
      }),
      type: "agent_message",
    },
    type: "item.completed",
  });
  const trace = [
    {
      payload: { cwd: runtimeCwd, id: "00000000-0000-0000-0000-000000000021" },
      type: "session_meta",
    },
    { payload: { model: "gpt-6-astra" }, type: "turn_context" },
    {
      payload: {
        content: [
          {
            detail: "high",
            image_url: `data:image/png;base64,${image.toString("base64")}`,
            type: "input_image",
          },
        ],
        role: "user",
        type: "message",
      },
      type: "response_item",
    },
  ]
    .map((record) => JSON.stringify(record))
    .join("\n");
  try {
    const result = await reviewImagesWithCodex({
      deadlineAt: deadlineAt - 5000,
      images: { "outlined-proof.png": image },
      invokeContained: () =>
        Promise.resolve({ code: 0, killed: false, stderr: "", stdout }),
      model: "gpt-6-astra",
      nativeCall: {
        containerFactory: { create } as never,
        inspectionLifecycle: {
          collectorRequestId: "00000000-0000-0000-0000-000000000020",
          lifecycleRequestSha256: "c".repeat(64),
          programHashes: { outlined: "d".repeat(64) },
          proofHashes: { outlined: "e".repeat(64) },
        },
        ordinal: 0,
        parentDeadlineAt: deadlineAt,
        runtimeCwd,
        stageKind: "author-self-review",
      },
      out,
      prepareContainedContext: () =>
        Promise.resolve({ args: [], receiptName: "context-preflight.json" }),
      questions: [
        {
          choices: ["pass", "fail", "uncertain"],
          id: "author-self-review-outlined",
          prompt: "Inspect exact proof.",
        },
      ],
      readTrace: () => trace,
    });
    expect(result).toMatchObject({
      collectorInspectionTrace: collectorTrace,
      status: "complete",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        inspectionRequestBinding: expect.objectContaining({
          collectorRequestId: "00000000-0000-0000-0000-000000000020",
          lifecycleRequestSha256: "c".repeat(64),
        }),
      })
    );
    expect(persistValidatedAdapterTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        inspectionInvocation: expect.objectContaining({
          emittedSessionId: "00000000-0000-0000-0000-000000000021",
          lifecycleRequestSha256: "c".repeat(64),
          rawAnswers: expect.stringContaining("author-self-review-outlined"),
        }),
        orderedAttachments: [
          expect.objectContaining({ name: "outlined-proof.png" }),
        ],
      })
    );
    const [[persisted]] = persistValidatedAdapterTrace.mock
      .calls as unknown as [
      [
        {
          inspectionInvocation: { adapterRequest: string };
        },
      ],
    ];
    const adapterRequest = JSON.parse(
      persisted.inspectionInvocation.adapterRequest
    );
    expect(adapterRequest.inspectionLifecycle).toEqual({
      collectorRequestId: "00000000-0000-0000-0000-000000000020",
      lifecycleRequestSha256: "c".repeat(64),
      programHashes: { outlined: "d".repeat(64) },
      proofHashes: { outlined: "e".repeat(64) },
    });
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

test("allocates a unique Codex review runtime while keeping receipts separate", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-review-factory-"));
  const out = path.join(root, "receipts", "review");
  mkdirSync(path.dirname(out));
  const runtimeCwd = path.join(root, "runtime", "reviewer-codex");
  mkdirSync(path.dirname(runtimeCwd));
  const parentDeadlineAt = Date.now() + 30_000;
  const accessProbe = {
    plan: { stageId: "07-reviewer-codex-clarification" },
  } as never;
  const config = { environment: { CODEX_HOME: "/call/state" } } as never;
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
  const image = await sharp({
    create: { background: "#000", channels: 4, height: 16, width: 16 },
  })
    .png()
    .toBuffer();
  try {
    await reviewImagesWithCodex({
      deadlineAt: parentDeadlineAt - 5000,
      images: { "candidate.png": image },
      invokeContained: (request, received) => {
        expect(received).toBe(config);
        expect(request.cwd).toBe(runtimeCwd);
        expect(request.args).not.toContain("--disable");
        return Promise.resolve({
          code: null,
          killed: false,
          stderr: "diagnostic",
          stdout: "",
        });
      },
      maxStageMs: 1000,
      model: "gpt-6-astra",
      nativeCall: {
        accessProbe,
        containerFactory: { create } as never,
        ordinal: 7,
        parentDeadlineAt,
        runtimeCwd,
        stageKind: "reviewer-codex-clarification",
      },
      out,
      prepareContainedContext: ({ out: contextOut }) => {
        expect(contextOut).toBe(runtimeCwd);
        return Promise.resolve({
          args: [],
          receiptName: "context-preflight.json",
        });
      },
      questions: [
        { choices: ["yes", "no"], id: "visible", prompt: "Visible?" },
      ],
    });
    expect(create).toHaveBeenCalledWith({
      accessProbe,
      cwd: runtimeCwd,
      deadlineAt: parentDeadlineAt,
      ordinal: 7,
      stageKind: "reviewer-codex-clarification",
    });
    expect(existsSync(path.join(out, "process.json"))).toBe(true);
    expect(existsSync(path.join(runtimeCwd, "candidate.png"))).toBe(true);
    expect(existsSync(path.join(runtimeCwd, "schema.json"))).toBe(true);
    expect(existsSync(path.join(out, "schema.json"))).toBe(false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("settles an allocated call when contained context preparation fails", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-review-context-fail-"));
  const out = path.join(root, "receipts");
  const runtimeCwd = path.join(root, "runtime", "reviewer-codex");
  mkdirSync(path.dirname(runtimeCwd), { recursive: true });
  const parentDeadlineAt = Date.now() + 30_000;
  const persistSettlement = vi.fn();
  const invokeContained = vi.fn();
  const create = vi.fn((request: { cwd: string; deadlineAt: number }) => {
    mkdirSync(request.cwd);
    return {
      config: {
        environment: { CODEX_HOME: "/call/state" },
        observeStop: () => true,
        persistSettlement,
      } as never,
      scope: {
        cwd: request.cwd,
        deadlineAt: request.deadlineAt,
        intent: {} as never,
        stateDirectory: path.join(request.cwd, "native-state"),
      },
    };
  });
  const image = await sharp({
    create: { background: "#000", channels: 4, height: 16, width: 16 },
  })
    .png()
    .toBuffer();
  try {
    await expect(
      reviewImagesWithCodex({
        deadlineAt: parentDeadlineAt - 5000,
        images: { "candidate.png": image },
        invokeContained,
        model: "gpt-6-astra",
        nativeCall: {
          containerFactory: { create } as never,
          ordinal: 0,
          parentDeadlineAt,
          runtimeCwd,
          stageKind: "reviewer-codex",
        },
        out,
        prepareContainedContext: () => {
          throw new Error("context probe failed before invocation");
        },
        questions: [
          { choices: ["yes", "no"], id: "visible", prompt: "Visible?" },
        ],
      })
    ).rejects.toThrow("context probe failed before invocation");
    expect(invokeContained).not.toHaveBeenCalled();
    expect(persistSettlement).toHaveBeenCalledWith({
      artifactEligible: false,
      cancelledByStop: true,
      containerAbsent: false,
      containerId: null,
      containmentScope: "docker-private-pid-namespace",
      controlEvidence: null,
      process: null,
      reason: expect.stringContaining("context probe failed before invocation"),
      status: "containment-unproven",
    });
    expect(persistSettlement.mock.calls[0]?.[0].reason).toContain(
      "STOP was latched"
    );
    expect(
      JSON.parse(readFileSync(path.join(out, "process.json"), "utf-8"))
    ).toMatchObject({
      code: null,
      killed: false,
      stderr: expect.stringContaining("context probe failed before invocation"),
      stdout: "",
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("binds the exact view-image removal while retaining the inline image", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-review-disabled-view-"));
  const out = path.join(root, "receipts");
  const runtimeCwd = path.join(root, "runtime", "diagnostic");
  mkdirSync(path.dirname(runtimeCwd), { recursive: true });
  const parentDeadlineAt = Date.now() + 30_000;
  const config = { environment: { CODEX_HOME: "/call/state" } } as never;
  const create = vi.fn(
    (request: {
      cwd: string;
      deadlineAt: number;
      diagnosticDisabledFeatures?: readonly ["view_image"];
    }) => {
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
    }
  );
  const image = await sharp({
    create: { background: "#000", channels: 4, height: 16, width: 16 },
  })
    .png()
    .toBuffer();
  try {
    await reviewImagesWithCodex({
      deadlineAt: parentDeadlineAt - 5000,
      images: { "stimulus.png": image },
      invokeContained: (request) => {
        expect(request.args.slice(0, 3)).toEqual([
          "exec",
          "--disable",
          "view_image",
        ]);
        const imageFlag = request.args.indexOf("--image");
        expect(imageFlag).toBeGreaterThan(-1);
        expect(request.args[imageFlag + 1]).toBe(
          path.join(runtimeCwd, "stimulus.png")
        );
        return Promise.resolve({
          code: null,
          killed: false,
          stderr: "diagnostic fixture",
          stdout: "",
        });
      },
      model: "gpt-5.4-mini",
      nativeCall: {
        containerFactory: { create } as never,
        diagnosticDisabledFeatures: ["view_image"],
        ordinal: 0,
        parentDeadlineAt,
        runtimeCwd,
        stageKind: "diagnostic-mini-image-capability",
      },
      out,
      prepareContainedContext: () =>
        Promise.resolve({ args: [], receiptName: "context-preflight.json" }),
      questions: [
        { choices: ["heart", "other"], id: "meaning", prompt: "Meaning?" },
      ],
    });
    expect(create).toHaveBeenCalledWith({
      cwd: runtimeCwd,
      deadlineAt: parentDeadlineAt,
      diagnosticDisabledFeatures: ["view_image"],
      ordinal: 0,
      stageKind: "diagnostic-mini-image-capability",
    });
    expect(
      JSON.parse(readFileSync(path.join(out, "request.json"), "utf-8"))
    ).toMatchObject({ diagnosticDisabledFeatures: ["view_image"] });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("refuses the retired Mini v3 profile before allocation or preparation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-review-mini-retired-"));
  const create = vi.fn();
  const prepareContainedContext = vi.fn();
  const invokeContained = vi.fn();
  const parentDeadlineAt = Date.now() + 30_000;
  try {
    await expect(
      reviewImagesWithCodex({
        deadlineAt: parentDeadlineAt - 5000,
        images: { "stimulus.png": new Uint8Array([1]) },
        invokeContained,
        model: "gpt-5.4-mini",
        nativeCall: {
          containerFactory: { create } as never,
          ordinal: 0,
          parentDeadlineAt,
          runtimeCwd: path.join(root, "runtime"),
          stageKind: "reviewer-mini",
        },
        out: path.join(root, "receipts"),
        prepareContainedContext,
        questions: [
          { choices: ["heart", "other"], id: "meaning", prompt: "Meaning?" },
        ],
        reviewProfile: CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE,
      })
    ).rejects.toThrow("retired after D376");
    expect(create).not.toHaveBeenCalled();
    expect(prepareContainedContext).not.toHaveBeenCalled();
    expect(invokeContained).not.toHaveBeenCalled();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test.each(["missing", "sealed-text", "diagnostic-combination"] as const)(
  "refuses Mini review profile mismatch before allocation: %s",
  async (failure) => {
    const root = mkdtempSync(path.join(tmpdir(), "codex-review-mini-refusal-"));
    const create = vi.fn();
    const parentDeadlineAt = Date.now() + 30_000;
    const image = await sharp({
      create: { background: "#000", channels: 4, height: 16, width: 16 },
    })
      .png()
      .toBuffer();
    try {
      await expect(
        reviewImagesWithCodex({
          deadlineAt: parentDeadlineAt - 5000,
          evidenceMode: failure === "sealed-text" ? "sealed-text" : "images",
          images: failure === "sealed-text" ? {} : { "stimulus.png": image },
          model: "gpt-5.4-mini",
          nativeCall: {
            containerFactory: { create } as never,
            ...(failure === "diagnostic-combination"
              ? { diagnosticDisabledFeatures: ["view_image"] as const }
              : {}),
            ordinal: 0,
            parentDeadlineAt,
            runtimeCwd: path.join(root, "runtime"),
            stageKind:
              failure === "diagnostic-combination"
                ? "diagnostic-mini-image-capability"
                : "reviewer-mini",
          },
          out: path.join(root, "receipts"),
          questions: [
            { choices: ["heart"], id: "meaning", prompt: "Meaning?" },
          ],
          ...(failure === "missing"
            ? {}
            : { reviewProfile: CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE }),
        })
      ).rejects.toThrow("exact inline-image runtime profile");
      expect(create).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

test.each([
  {
    disabledFeatures: ["shell_tool"] as never,
    stageKind: "diagnostic-mini-image-capability",
  },
  {
    disabledFeatures: ["view_image"] as const,
    stageKind: "reviewer-codex",
  },
])(
  "refuses unsupported or production-shaped diagnostic feature removal",
  async ({ disabledFeatures, stageKind }) => {
    const root = mkdtempSync(path.join(tmpdir(), "codex-review-bad-feature-"));
    const image = await sharp({
      create: { background: "#000", channels: 4, height: 16, width: 16 },
    })
      .png()
      .toBuffer();
    const parentDeadlineAt = Date.now() + 30_000;
    try {
      await expect(
        reviewImagesWithCodex({
          deadlineAt: parentDeadlineAt - 5000,
          images: { "stimulus.png": image },
          invokeContained: () =>
            Promise.resolve({ code: 0, killed: false, stderr: "", stdout: "" }),
          model: "gpt-5.4-mini",
          nativeCall: {
            containerFactory: { create: vi.fn() } as never,
            diagnosticDisabledFeatures: disabledFeatures,
            ordinal: 0,
            parentDeadlineAt,
            runtimeCwd: path.join(root, "runtime"),
            stageKind,
          },
          out: path.join(root, "receipts"),
          questions: [
            { choices: ["heart", "other"], id: "meaning", prompt: "Meaning?" },
          ],
        })
      ).rejects.toThrow("exact image capability diagnostic");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

test("persists only the exact trace after attachment, answer and model validation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-review-trace-"));
  const out = path.join(root, "receipts", "review");
  mkdirSync(path.dirname(out));
  const runtimeCwd = path.join(root, "runtime", "reviewer-codex");
  mkdirSync(path.dirname(runtimeCwd));
  const parentDeadlineAt = Date.now() + 30_000;
  const config = { environment: { CODEX_HOME: "/call/state" } } as never;
  const persistValidatedAdapterTrace = vi.fn(() => ({
    file: "/collector/adapter-trace.jsonl",
    receiptFile: "/collector/adapter-trace-receipt.json",
    receiptSha256: "1".repeat(64),
    sha256: "2".repeat(64),
  }));
  const create = vi.fn((request: { cwd: string; deadlineAt: number }) => {
    mkdirSync(request.cwd);
    return {
      config,
      persistValidatedAdapterTrace,
      scope: {
        cwd: request.cwd,
        deadlineAt: request.deadlineAt,
        intent: {} as never,
        stateDirectory: path.join(request.cwd, "native-state"),
      },
    };
  });
  const image = await sharp({
    create: { background: "#000", channels: 4, height: 16, width: 16 },
  })
    .png()
    .toBuffer();
  const trace = [
    { payload: { model: "gpt-6-astra" }, type: "turn_context" },
    {
      payload: {
        content: [
          {
            detail: "high",
            image_url: `data:image/png;base64,${image.toString("base64")}`,
            type: "input_image",
          },
        ],
        role: "user",
        type: "message",
      },
      type: "response_item",
    },
  ]
    .map((record) => JSON.stringify(record))
    .join("\n");
  try {
    const result = await reviewImagesWithCodex({
      deadlineAt: parentDeadlineAt - 5000,
      images: { "candidate.png": image },
      invokeContained: () =>
        Promise.resolve({
          code: 0,
          killed: false,
          stderr: "",
          stdout: JSON.stringify({
            item: {
              text: JSON.stringify({
                answers: {
                  visible: {
                    choice: "yes",
                    evidence: "Visible native pixels.",
                    treatment: "",
                  },
                },
              }),
              type: "agent_message",
            },
            type: "item.completed",
          }),
        }),
      maxStageMs: 1000,
      model: "gpt-6-astra",
      nativeCall: {
        containerFactory: { create } as never,
        ordinal: 7,
        parentDeadlineAt,
        runtimeCwd,
        stageKind: "reviewer-codex",
      },
      out,
      prepareContainedContext: () =>
        Promise.resolve({ args: [], receiptName: "context-preflight.json" }),
      questions: [
        { choices: ["yes", "no"], id: "visible", prompt: "Visible?" },
      ],
      readTrace: () => trace,
    });
    expect(result.status).toBe("complete");
    expect(persistValidatedAdapterTrace).toHaveBeenCalledWith({
      adapter: "codex-jsonl-v1",
      evidenceMode: "images",
      model: "gpt-6-astra",
      orderedAttachments: [
        {
          name: "candidate.png",
          sha256: result.evidenceHashes["candidate.png"],
        },
      ],
      trace,
      traceSha256: result.imageInspection?.traceSha256,
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("does not persist a rejected tool-bearing adapter trace", async () => {
  const persistValidatedAdapterTrace = vi.fn();
  const root = mkdtempSync(path.join(tmpdir(), "codex-review-rejected-trace-"));
  const runtimeCwd = path.join(root, "runtime");
  const image = await sharp({
    create: { background: "#000", channels: 4, height: 16, width: 16 },
  })
    .png()
    .toBuffer();
  const parentDeadlineAt = Date.now() + 30_000;
  try {
    const result = await reviewImagesWithCodex({
      deadlineAt: parentDeadlineAt - 5000,
      images: { "candidate.png": image },
      invokeContained: () =>
        Promise.resolve({
          code: 0,
          killed: false,
          stderr: "",
          stdout: JSON.stringify({
            item: {
              text: JSON.stringify({
                answers: {
                  visible: {
                    choice: "yes",
                    evidence: "pixels",
                    treatment: "",
                  },
                },
              }),
              type: "agent_message",
            },
            type: "item.completed",
          }),
        }),
      maxStageMs: 1000,
      model: "gpt-6-astra",
      nativeCall: {
        containerFactory: {
          create: ({ cwd, deadlineAt }) => {
            mkdirSync(cwd);
            return {
              config: { environment: { CODEX_HOME: "/call/state" } } as never,
              persistValidatedAdapterTrace,
              scope: {
                cwd,
                deadlineAt,
                intent: {} as never,
                stateDirectory: path.join(cwd, "native-state"),
              },
            } as never;
          },
        },
        ordinal: 0,
        parentDeadlineAt,
        runtimeCwd,
        stageKind: "reviewer-codex",
      },
      out: path.join(root, "receipt"),
      prepareContainedContext: () =>
        Promise.resolve({ args: [], receiptName: "context-preflight.json" }),
      questions: [
        { choices: ["yes", "no"], id: "visible", prompt: "Visible?" },
      ],
      readTrace: () =>
        [
          { payload: { model: "gpt-6-astra" }, type: "turn_context" },
          {
            payload: {
              name: "view_image",
              type: "function_call",
            },
            type: "response_item",
          },
        ]
          .map((record) => JSON.stringify(record))
          .join("\n"),
    });
    expect(result.status).toBe("incomplete");
    expect(persistValidatedAdapterTrace).not.toHaveBeenCalled();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects a reusable static Codex container outside diagnostics", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-review-static-"));
  const image = await sharp({
    create: { background: "#000", channels: 4, height: 16, width: 16 },
  })
    .png()
    .toBuffer();
  try {
    await expect(
      reviewImagesWithCodex({
        container: {} as never,
        images: { "candidate.png": image },
        model: "gpt-6-astra",
        out: path.join(root, "review"),
        questions: [
          { choices: ["yes", "no"], id: "visible", prompt: "Visible?" },
        ],
      })
    ).rejects.toThrow("Static Codex container config cannot run a review");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects aliased Codex runtime and receipt paths before reservation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-review-overlap-"));
  const create = vi.fn();
  const actual = path.join(root, "actual");
  mkdirSync(actual);
  const alias = path.join(root, "alias");
  symlinkSync(actual, alias, "dir");
  const image = await sharp({
    create: { background: "#000", channels: 4, height: 16, width: 16 },
  })
    .png()
    .toBuffer();
  try {
    await expect(
      reviewImagesWithCodex({
        deadlineAt: Date.now() + 5000,
        images: { "candidate.png": image },
        model: "gpt-6-astra",
        nativeCall: {
          containerFactory: { create } as never,
          ordinal: 7,
          parentDeadlineAt: Date.now() + 10_000,
          runtimeCwd: path.join(alias, "review", "runtime"),
          stageKind: "reviewer-codex",
        },
        out: path.join(actual, "review"),
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

test.each(["complete", "image", "tool", "web-tool", "wrong-model"])(
  "sealed text Codex review binds no-image/no-tool evidence: %s",
  async (scenario) => {
    const root = mkdtempSync(path.join(tmpdir(), "codex-text-review-"));
    try {
      const result = await reviewImagesWithCodex({
        evidenceMode: "sealed-text",
        images: {},
        invoke: ({ prompt }) => {
          expect(prompt).toContain("Do not use tools");
          return Promise.resolve({
            code: 0,
            killed: false,
            stderr: "",
            stdout: JSON.stringify({
              item: {
                text: JSON.stringify({
                  answers: {
                    s001: {
                      choice: "match",
                      evidence: "Same meaning.",
                      treatment: "",
                    },
                  },
                }),
                type: "agent_message",
              },
              type: "item.completed",
            }),
          });
        },
        model: "gpt-5.6-sol",
        out: path.join(root, "out"),
        prepareContext: () => ({
          args: [],
          receiptName: "context-preflight.json",
        }),
        questions: [
          {
            choices: ["match", "uncertain"],
            id: "s001",
            prompt: "Sealed description: heart. Target: heart.",
          },
        ],
        readTrace: () =>
          [
            {
              payload: {
                model:
                  scenario === "wrong-model" ? "gpt-6-astra" : "gpt-5.6-sol",
              },
              type: "turn_context",
            },
            {
              payload: {
                content: [
                  { text: "sealed description", type: "input_text" },
                  ...(scenario === "image"
                    ? [
                        {
                          image_url: "data:image/png;base64,AA==",
                          type: "input_image",
                        },
                      ]
                    : []),
                ],
                role: "user",
                type: "message",
              },
              type: "response_item",
            },
            ...(["tool", "web-tool"].includes(scenario)
              ? [
                  {
                    payload: {
                      name: "read_file",
                      type:
                        scenario === "web-tool"
                          ? "web_search_call"
                          : "function_call",
                    },
                    type: "response_item",
                  },
                ]
              : []),
          ]
            .map((record) => JSON.stringify(record))
            .join("\n"),
      });
      expect(result.status).toBe(
        scenario === "complete" ? "complete" : "incomplete"
      );
      expect(result.baseModelLineage).toBe(
        scenario === "complete" ? "gpt-5.6-sol" : null
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

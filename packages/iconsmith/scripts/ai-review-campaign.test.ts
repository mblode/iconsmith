import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { expect, it, vi } from "vitest";

import { runAiReviewCampaign } from "./ai-review-campaign.js";
import type {
  AiReviewCampaignInput,
  AiReviewRoute,
} from "./ai-review-campaign.js";

const fixture = () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-ai-review-"));
  const image = path.join(cwd, "candidate.png");
  const anchor = path.join(cwd, "anchor.png");
  const tooling = path.join(cwd, "runner.ts");
  writeFileSync(image, "candidate");
  writeFileSync(anchor, "anchor");
  writeFileSync(tooling, "tooling");
  const input: AiReviewCampaignInput = {
    packetId: "packet-1",
    stimuli: [
      {
        concept: "bell-pause",
        familyReferences: [anchor],
        id: "s001",
        image,
        meanings: ["bell-pause", "bell-play", "bell-off"],
      },
    ],
  };
  return { anchor, cwd, image, input, tooling };
};

const route = (id: string, model: string, invoke = vi.fn()): AiReviewRoute => ({
  command: `/pinned/${id}`,
  id,
  invoke,
  model,
});
const complete = (model: string) =>
  vi.fn(({ images, questions }: Parameters<AiReviewRoute["invoke"]>[0]) =>
    Promise.resolve({
      answers: Object.fromEntries(
        questions.map((question) => [
          question.id,
          {
            choice: question.choices[0] ?? "uncertain",
            evidence: "visible evidence",
            treatment: "none",
          },
        ])
      ),
      evidenceHashes: Object.fromEntries(
        Object.entries(images).map(([name, bytes]) => [
          name,
          createHash("sha256").update(bytes).digest("hex"),
        ])
      ),
      model,
      status: "complete" as const,
    })
  );
const digest = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const options = (
  data: ReturnType<typeof fixture>,
  routes: AiReviewRoute[]
) => ({
  input: data.input,
  maxPackets: 1,
  out: path.join(data.cwd, "out"),
  perReviewerMaxMs: 10_000,
  routes,
  runtimeIdentity: { hash: "runtime" },
  toolingFiles: [data.tooling],
  verifyRuntime: vi.fn(),
});

it("freezes a packet without invoking reviewers by default", async () => {
  const data = fixture();
  try {
    const routes = [
      route("codex", "gpt-6-astra"),
      route("claude", "claude-opus-5"),
    ];
    const result = await runAiReviewCampaign(options(data, routes));
    expect(result.status).toBe("dry-run");
    expect(
      routes.every(({ invoke }) => !vi.mocked(invoke).mock.calls.length)
    ).toBe(true);
    expect(
      JSON.parse(readFileSync(path.join(data.cwd, "out/intent.json"), "utf-8"))
    ).toMatchObject({
      qualified: false,
      routes: [
        { command: "/pinned/codex", model: "gpt-6-astra" },
        { command: "/pinned/claude", model: "claude-opus-5" },
      ],
    });
    const frozen = readFileSync(
      path.join(data.cwd, "out/intent.json"),
      "utf-8"
    );
    expect(frozen).not.toContain('"concept":');
    expect(frozen).not.toContain("candidate.png");
    expect(frozen).not.toContain("anchor.png");
  } finally {
    rmSync(data.cwd, { force: true, recursive: true });
  }
});

it("refuses a concurrent duplicate dispatch for the same route", async () => {
  const data = fixture();
  try {
    const codex = vi.fn(
      async ({ images, questions }: Parameters<AiReviewRoute["invoke"]>[0]) => {
        await delay(5);
        return {
          answers: Object.fromEntries(
            questions.map((question) => [
              question.id,
              {
                choice: question.choices[0] ?? "uncertain",
                evidence: "visible evidence",
                treatment: "none",
              },
            ])
          ),
          evidenceHashes: Object.fromEntries(
            Object.entries(images).map(([name, bytes]) => [
              name,
              createHash("sha256").update(bytes).digest("hex"),
            ])
          ),
          model: "gpt-6-astra",
          status: "complete" as const,
        };
      }
    );
    const configured = options(data, [
      route("codex", "gpt-6-astra", codex),
      route("claude", "claude-opus-5", complete("claude-opus-5")),
    ]);
    const first = runAiReviewCampaign({ ...configured, execute: true });
    await expect(
      runAiReviewCampaign({ ...configured, execute: true })
    ).rejects.toThrow("dispatch is already active");
    await first;
    expect(codex).toHaveBeenCalledTimes(2);
  } finally {
    rmSync(data.cwd, { force: true, recursive: true });
  }
});

it("resumes terminal reviewers without dispatching them twice", async () => {
  const data = fixture();
  try {
    const codex = complete("gpt-6-astra");
    const claude = complete("claude-opus-5");
    const configured = options(data, [
      route("codex", "gpt-6-astra", codex),
      route("claude", "claude-opus-5", claude),
    ]);
    await runAiReviewCampaign({ ...configured, execute: true });
    await runAiReviewCampaign({ ...configured, execute: true });
    expect(codex).toHaveBeenCalledTimes(2);
    expect(claude).toHaveBeenCalledTimes(2);
    writeFileSync(
      path.join(data.cwd, "out/codex/recognition.json"),
      '{"tampered":true}\n'
    );
    await expect(
      runAiReviewCampaign({ ...configured, execute: true })
    ).rejects.toThrow("terminal does not match intent");
  } finally {
    rmSync(data.cwd, { force: true, recursive: true });
  }
});

it("preserves incomplete outcomes and refuses a changed saved result", async () => {
  const data = fixture();
  try {
    const incomplete = vi.fn(() =>
      Promise.resolve({
        answers: null,
        model: "gpt-6-astra",
        reason: "timed out",
        status: "incomplete" as const,
      })
    );
    const configured = options(data, [
      route("codex", "gpt-6-astra", incomplete),
      route("claude", "claude-opus-5", complete("claude-opus-5")),
    ]);
    const first = await runAiReviewCampaign({ ...configured, execute: true });
    expect(first.outcomes?.[0]).toMatchObject({
      qualified: false,
      status: "recognition-incomplete",
    });
    await runAiReviewCampaign({ ...configured, execute: true });
    expect(incomplete).toHaveBeenCalledTimes(1);
    writeFileSync(
      path.join(data.cwd, "out/codex/result.json"),
      '{"status":"complete"}\n'
    );
    await expect(
      runAiReviewCampaign({ ...configured, execute: true })
    ).rejects.toThrow("terminal does not match intent");
  } finally {
    rmSync(data.cwd, { force: true, recursive: true });
  }
});

it("binds route executable paths and bytes to the frozen runtime", async () => {
  const data = fixture();
  try {
    const author = path.join(data.cwd, "author");
    const reviewer = path.join(data.cwd, "reviewer");
    writeFileSync(author, "author-v1");
    writeFileSync(reviewer, "reviewer-v1");
    const configured = options(data, [
      { ...route("codex", "gpt-6-astra"), command: author },
      { ...route("claude", "claude-opus-5"), command: reviewer },
    ]);
    const runtimeIdentity = {
      manifest: {
        author: { executable: author, sha256: digest(author) },
        reviewer: { executable: reviewer, sha256: digest(reviewer) },
      },
    };
    writeFileSync(author, "author-v2");
    await expect(
      runAiReviewCampaign({ ...configured, runtimeIdentity })
    ).rejects.toThrow("route does not match frozen runtime");
  } finally {
    rmSync(data.cwd, { force: true, recursive: true });
  }
});

it("dispatches distinct model routes through one pinned executable exactly once", async () => {
  const data = fixture();
  try {
    const shared = path.join(data.cwd, "multi-model-reviewer");
    writeFileSync(shared, "shared-cli-v1");
    const critic = complete("critic-model");
    const panelOne = complete("panel-model-one");
    const panelTwo = complete("panel-model-two");
    const configured = {
      ...options(data, [
        { ...route("critic", "critic-model", critic), command: shared },
        {
          ...route("panel-one", "panel-model-one", panelOne),
          command: shared,
        },
        {
          ...route("panel-two", "panel-model-two", panelTwo),
          command: shared,
        },
      ]),
      runtimeIdentity: {
        manifest: {
          reviewer: { executable: shared, sha256: digest(shared) },
        },
      },
    };

    await runAiReviewCampaign({ ...configured, execute: true });
    await runAiReviewCampaign({ ...configured, execute: true });

    expect(critic).toHaveBeenCalledTimes(2);
    expect(panelOne).toHaveBeenCalledTimes(2);
    expect(panelTwo).toHaveBeenCalledTimes(2);
    const terminals = ["critic", "panel-one", "panel-two"].map((id) =>
      JSON.parse(
        readFileSync(path.join(data.cwd, `out/${id}/terminal.json`), "utf-8")
      )
    );
    expect(terminals.map(({ model }) => model)).toEqual([
      "critic-model",
      "panel-model-one",
      "panel-model-two",
    ]);
    expect(new Set(terminals.map(({ intentHash }) => intentHash)).size).toBe(3);
  } finally {
    rmSync(data.cwd, { force: true, recursive: true });
  }
});

it("refuses changed packet bytes and ambiguous partial reviewer directories", async () => {
  const data = fixture();
  try {
    const configured = options(data, [
      route("codex", "gpt-6-astra", complete("gpt-6-astra")),
      route("claude", "claude-opus-5", complete("claude-opus-5")),
    ]);
    await runAiReviewCampaign(configured);
    writeFileSync(data.image, "tampered");
    await expect(runAiReviewCampaign(configured)).rejects.toThrow(
      "intent changed"
    );
    writeFileSync(data.image, "candidate");
    mkdirSync(path.join(data.cwd, "out/codex"));
    await expect(
      runAiReviewCampaign({ ...configured, execute: true })
    ).rejects.toThrow("Ambiguous partial");
  } finally {
    rmSync(data.cwd, { force: true, recursive: true });
  }
});

it("requires independent explicit routes and bounded reviewer deadlines", async () => {
  const data = fixture();
  try {
    const duplicate = [route("one", "same"), route("two", "same")];
    await expect(runAiReviewCampaign(options(data, duplicate))).rejects.toThrow(
      "distinct pinned bounded routes"
    );
    await expect(
      runAiReviewCampaign(
        options(data, [route("same", "a"), route("same", "b")])
      )
    ).rejects.toThrow("distinct pinned bounded routes");
    await expect(
      runAiReviewCampaign({
        ...options(data, [route("one", "a"), route("two", "b")]),
        perReviewerMaxMs: 480_001,
      })
    ).rejects.toThrow("distinct pinned bounded routes");
    await expect(
      runAiReviewCampaign(
        options(data, [route("../escape", "a"), route("two", "b")])
      )
    ).rejects.toThrow("distinct pinned bounded routes");
  } finally {
    rmSync(data.cwd, { force: true, recursive: true });
  }
});

it("revalidates tooling before each sequential provider boundary", async () => {
  const data = fixture();
  try {
    const first = complete("gpt-6-astra");
    first.mockImplementationOnce(({ images, questions }) => {
      writeFileSync(data.tooling, "changed during campaign");
      return Promise.resolve({
        answers: Object.fromEntries(
          questions.map((question) => [
            question.id,
            {
              choice: question.choices[0] ?? "uncertain",
              evidence: "visible evidence",
              treatment: "none",
            },
          ])
        ),
        evidenceHashes: Object.fromEntries(
          Object.entries(images).map(([name, bytes]) => [
            name,
            createHash("sha256").update(bytes).digest("hex"),
          ])
        ),
        model: "gpt-6-astra",
        status: "complete" as const,
      });
    });
    const second = complete("claude-opus-5");
    const configured = options(data, [
      route("codex", "gpt-6-astra", first),
      route("claude", "claude-opus-5", second),
    ]);
    const result = await runAiReviewCampaign({
      ...configured,
      execute: true,
    });
    expect(result.outcomes?.[0]).toMatchObject({
      qualified: false,
      status: "errored",
    });
    expect(second).not.toHaveBeenCalled();
  } finally {
    rmSync(data.cwd, { force: true, recursive: true });
  }
});

it("records every route as unstarted when the stop sentinel already exists", async () => {
  const data = fixture();
  try {
    const stopFile = path.join(data.cwd, "STOP");
    writeFileSync(stopFile, "invalid evidence\n");
    const codex = complete("gpt-6-astra");
    const claude = complete("claude-opus-5");
    const result = await runAiReviewCampaign({
      ...options(data, [
        route("codex", "gpt-6-astra", codex),
        route("claude", "claude-opus-5", claude),
      ]),
      execute: true,
      stopFile,
    });
    expect(codex).not.toHaveBeenCalled();
    expect(claude).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([
      expect.objectContaining({ routeId: "codex", status: "unstarted" }),
      expect.objectContaining({ routeId: "claude", status: "unstarted" }),
    ]);
    expect(
      JSON.parse(readFileSync(path.join(data.cwd, "out/stop.json"), "utf-8"))
    ).toMatchObject({ intentHash: result.intentHash, stopFile });
  } finally {
    rmSync(data.cwd, { force: true, recursive: true });
  }
});

it("seals an interrupted route and never dispatches later routes", async () => {
  const data = fixture();
  try {
    const stopFile = path.join(data.cwd, "STOP");
    const codex = complete("gpt-6-astra");
    codex.mockImplementationOnce((request) => {
      writeFileSync(stopFile, "invalid recognition evidence\n");
      return complete("gpt-6-astra")(request);
    });
    const claude = complete("claude-opus-5");
    const configured = {
      ...options(data, [
        route("codex", "gpt-6-astra", codex),
        route("claude", "claude-opus-5", claude),
      ]),
      execute: true,
      stopFile,
    };
    const first = await runAiReviewCampaign(configured);
    expect(first.outcomes).toEqual([
      expect.objectContaining({ status: "stopped" }),
      expect.objectContaining({ routeId: "claude", status: "unstarted" }),
    ]);
    expect(codex).toHaveBeenCalledTimes(1);
    expect(claude).not.toHaveBeenCalled();

    const resumed = await runAiReviewCampaign(configured);
    expect(resumed.outcomes).toEqual([
      expect.objectContaining({ status: "stopped" }),
      expect.objectContaining({ routeId: "claude", status: "unstarted" }),
    ]);
    expect(codex).toHaveBeenCalledTimes(1);
    expect(claude).not.toHaveBeenCalled();
  } finally {
    rmSync(data.cwd, { force: true, recursive: true });
  }
});

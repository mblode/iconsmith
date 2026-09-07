import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, vi } from "vitest";

import { assessAiReviewCampaign } from "./ai-review-assessment.js";
import { runAiReviewCampaign } from "./ai-review-campaign.js";
import type { AiReviewRoute } from "./ai-review-campaign.js";

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const fixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), "ai-review-assessment-"));
  const image = path.join(root, "candidate.png");
  const anchor = path.join(root, "anchor.png");
  const tooling = path.join(root, "tooling.ts");
  writeFileSync(image, "candidate");
  writeFileSync(anchor, "anchor");
  writeFileSync(tooling, "tooling");
  return { anchor, image, out: path.join(root, "campaign"), root, tooling };
};
const answerFor = (
  suffix: string | undefined,
  overrides: { craft?: string; critical?: string; ship?: string }
) => {
  if (suffix === "recognition") {
    return "bell-pause";
  }
  if (suffix === "craft") {
    return overrides.craft ?? "9";
  }
  if (suffix === "critical") {
    return overrides.critical ?? "no";
  }
  if (suffix === "ship") {
    return overrides.ship ?? "yes";
  }
  return "yes";
};
const reviewer = (
  id: string,
  provider: string,
  overrides: { craft?: string; critical?: string; ship?: string } = {}
): AiReviewRoute => ({
  command: `/pinned/${id}`,
  id,
  invoke: vi.fn(
    ({ images, questions }: Parameters<AiReviewRoute["invoke"]>[0]) =>
      Promise.resolve({
        answers: Object.fromEntries(
          questions.map((question) => [
            question.id,
            {
              choice: answerFor(question.id.split("-").at(-1), overrides),
              evidence: "visible pixels",
              treatment: "none",
            },
          ])
        ),
        evidenceHashes: Object.fromEntries(
          Object.entries(images).map(([name, bytes]) => [name, digest(bytes)])
        ),
        model: id,
        provider,
        status: "complete" as const,
      })
  ),
  model: id,
});
const run = (data: ReturnType<typeof fixture>, routes: AiReviewRoute[]) =>
  runAiReviewCampaign({
    execute: true,
    input: {
      packetId: "packet",
      stimuli: [
        {
          concept: "bell-pause",
          familyReferences: [data.anchor],
          id: "s001",
          image: data.image,
          meanings: ["bell-pause", "bell-play", "bell-off"],
        },
      ],
    },
    maxPackets: 1,
    out: data.out,
    perReviewerMaxMs: 10_000,
    routes,
    runtimeIdentity: { hash: "test" },
    toolingFiles: [data.tooling],
    verifyRuntime: vi.fn(),
  });

test("assesses complete development receipts without claiming qualification", async () => {
  const data = fixture();
  try {
    await run(data, [
      reviewer("model-a", "provider-a"),
      reviewer("model-b", "provider-b"),
    ]);
    expect(assessAiReviewCampaign(data.out)).toMatchObject({
      instrumentQualified: false,
      outcomes: [
        {
          completeReviewers: 2,
          imageSha256: digest(readFileSync(data.image)),
          incompleteReviewers: 0,
          reviews: [
            { identity: { model: "model-a", provider: "provider-a" } },
            { identity: { model: "model-b", provider: "provider-b" } },
          ],
          status: "accepted",
        },
      ],
      qualified: false,
      scope: "development-ai-review",
    });
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

test("requires complete receipts from both frozen reviewers for acceptance", async () => {
  const data = fixture();
  try {
    await run(data, [
      reviewer("model-a", "provider-a"),
      reviewer("model-b", "provider-b"),
    ]);
    unlinkSync(path.join(data.out, "model-b/terminal.json"));
    expect(assessAiReviewCampaign(data.out).outcomes[0]).toMatchObject({
      completeReviewers: 1,
      incompleteReviewers: 1,
      status: "incomplete",
    });
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

test("quarantines any critical flag and preserves contradictory judgments", async () => {
  const data = fixture();
  try {
    await run(data, [
      reviewer("model-a", "provider-a", { critical: "yes" }),
      reviewer("model-b", "provider-b"),
    ]);
    expect(assessAiReviewCampaign(data.out).outcomes[0]).toMatchObject({
      conflicts: ["critical"],
      status: "quarantined",
    });
  } finally {
    rmSync(data.root, { force: true, recursive: true });
  }
});

test("does not promote low craft, missing terminals or tampered evidence", async () => {
  const low = fixture();
  try {
    await run(low, [
      reviewer("model-a", "provider-a", { craft: "7" }),
      reviewer("model-b", "provider-b", { craft: "9" }),
    ]);
    expect(assessAiReviewCampaign(low.out).outcomes[0]?.status).toBe(
      "rejected"
    );
    unlinkSync(path.join(low.out, "model-b/terminal.json"));
    expect(assessAiReviewCampaign(low.out).outcomes[0]).toMatchObject({
      completeReviewers: 1,
      incompleteReviewers: 1,
      status: "incomplete",
    });
  } finally {
    rmSync(low.root, { force: true, recursive: true });
  }

  const tampered = fixture();
  try {
    await run(tampered, [
      reviewer("model-a", "provider-a"),
      reviewer("model-b", "provider-b"),
    ]);
    writeFileSync(
      path.join(tampered.out, "model-a/recognition.json"),
      `${readFileSync(path.join(tampered.out, "model-a/recognition.json"), "utf-8")} `
    );
    expect(assessAiReviewCampaign(tampered.out).outcomes[0]).toMatchObject({
      completeReviewers: 1,
      incompleteReviewers: 1,
      status: "incomplete",
    });
  } finally {
    rmSync(tampered.root, { force: true, recursive: true });
  }
});

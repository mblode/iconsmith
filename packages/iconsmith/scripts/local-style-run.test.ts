import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import {
  createStyleRevision,
  selectStyle,
  STYLE_COMPILER,
} from "../src/pipeline/style.js";
import { specAt } from "../src/tools/spec.js";
import { runLocalStyle } from "./local-style-run.js";

// Synthetic provider trace for integration fixtures, not real image-view evidence.
const fixtureTrace = (_stdout: string, cwd: string) =>
  [
    {
      payload: {
        call_id: "fixture",
        status: "completed",
        type: "custom_tool_call",
      },
      type: "response_item",
    },
    {
      payload: {
        call_id: "fixture",
        output: ["outlined", "filled"].map((paint) => ({
          image_url: `data:image/png;base64,${readFileSync(path.join(cwd, `${paint}.proof.png`)).toString("base64")}`,
          type: "input_image",
        })),
        type: "custom_tool_call_output",
      },
      type: "response_item",
    },
  ]
    .map((record) => JSON.stringify(record))
    .join("\n");

const reviewVerdict = (optics: string) => ({
  answers: Object.fromEntries(
    ["meaning", "style", "optics", "family"].map((id) => [
      id,
      {
        choice: { meaning: "ring", optics }[id] ?? "pass",
        evidence: "Injected test observation.",
        treatment: "Enlarge the counter.",
      },
    ])
  ),
  apiChargeUsd: null,
  billing: "subscription",
  craftApproved: false,
  evidenceHashes: {},
  instrumentQualified: false,
  model: "test-reviewer",
  status: "complete" as const,
});

const writesReview = (scenario: string, interrupted: boolean) =>
  scenario !== "missing-review" &&
  (!interrupted || scenario === "interrupted-with-review");

it.each([
  "delivered",
  "selected-master",
  "composition",
  "altered-composition",
  "altered-composition-source",
  "missing-review",
  "interrupted-finalization",
  "interrupted-with-review",
  "repeated-interruption",
  "missing-inspection",
  "author-failed",
  "altered-input",
  "altered-image",
  "altered-reference-proof",
  "altered-runtime",
  "altered-runtime-link",
  "malformed-review",
  "duplicate-limitations",
])("requires checked artifacts and honest delivery: %s", async (scenario) => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-delivery-"));
  const out = path.join(root, "run");
  mkdirSync(out);
  const compositionPath = path.join(root, "sketch.png");
  const hasComposition = scenario.includes("composition");
  if (hasComposition) {
    writeFileSync(
      compositionPath,
      await sharp({
        create: { background: "white", channels: 4, height: 24, width: 24 },
      })
        .png()
        .toBuffer()
    );
  }
  const revisionPath = path.join(root, "revision.json");
  writeFileSync(
    revisionPath,
    JSON.stringify({
      calibration: "unvalidated",
      compiler: STYLE_COMPILER,
      id: "delivery-fixture",
      masters: { large: specAt(), small: specAt({ size: 16 }) },
      parts: [
        "selected-master",
        "altered-image",
        "altered-reference-proof",
      ].includes(scenario)
        ? [
            {
              master: "small",
              part: {
                closed: true,
                d: "M0 0L1 0L1 1Z",
                h: 1,
                icons: ["unselected-secret"],
                id: "unselected-secret",
                instances: 1,
                nodes: 3,
                sizeRange: [1, 1],
                w: 1,
              },
              provenance: { date: "2026-09-06", origin: "original" },
            },
          ]
        : [],
      policy: DEFAULT_POLICY,
      references: [
        "selected-master",
        "altered-image",
        "altered-reference-proof",
      ].includes(scenario)
        ? [
            {
              master: "small",
              name: "unselected-secret",
              provenance: { date: "2026-09-06", origin: "original" },
              svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>',
            },
            {
              master: "large",
              name: "allowed-ring",
              provenance: { date: "2026-09-06", origin: "original" },
              svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="black" stroke-width="2"/></svg>',
            },
          ]
        : [],
      rubric: "Host fixture, not craft evaluation.",
    })
  );
  try {
    const result = await runLocalStyle({
      args: () => [],
      command: "must-not-run",
      composition: hasComposition
        ? { path: compositionPath, source: "Synthetic composition fixture" }
        : undefined,
      concept: "ring",
      env: process.env,
      invoke: (brief, cwd, images) => {
        const interrupted =
          scenario === "repeated-interruption" ||
          (["interrupted-finalization", "interrupted-with-review"].includes(
            scenario
          ) &&
            path.basename(cwd) === "attempt-1");
        if (scenario === "interrupted-finalization" && !interrupted) {
          expect(brief).toContain("previous author was interrupted");
          expect(
            readFileSync(path.join(cwd, "outlined.icon"), "utf-8")
          ).toContain("circle 12,12 r9");
        }
        if (hasComposition) {
          expect(images[0]).toBe(path.join(cwd, "composition.png"));
          expect(brief).toContain("unapproved composition hypothesis");
          expect(readFileSync(images[0])).toEqual(
            readFileSync(compositionPath)
          );
          const target =
            scenario === "altered-composition-source"
              ? "composition.json"
              : "composition.png";
          if (scenario !== "composition") {
            writeFileSync(path.join(cwd, target), "changed");
          }
        }
        if (scenario === "selected-master") {
          const packet = JSON.parse(
            readFileSync(path.join(cwd, "revision.json"), "utf-8")
          );
          expect(Object.keys(packet.masters)).toEqual(["large"]);
          expect(packet.parts).toEqual([]);
          expect(
            packet.references.map((ref: { name: string }) => ref.name)
          ).toEqual(["allowed-ring"]);
          expect(JSON.stringify(packet)).not.toContain("unselected-secret");
          expect(images).toEqual([
            path.join(cwd, "references.png"),
            path.join(cwd, "reference-0-proof.png"),
          ]);
          const receipt = JSON.parse(
            readFileSync(path.join(cwd, "author-images.json"), "utf-8")
          );
          expect(receipt).toEqual(
            images.map((image) => ({
              name: path.basename(image),
              sha256: createHash("sha256")
                .update(readFileSync(image))
                .digest("hex"),
            }))
          );
          const proofs = JSON.parse(
            readFileSync(path.join(cwd, "reference-proofs.json"), "utf-8")
          );
          expect(proofs).toHaveLength(1);
          expect(proofs[0]).toMatchObject({
            name: "reference-0-proof.png",
            nativeSize: 24,
            opticalMasterClaim: false,
          });
        }
        expect(brief).toContain(
          "Missing or malformed author-review.json means incomplete delivery"
        );
        writeFileSync(
          path.join(cwd, "outlined.icon"),
          "icon ring\nfinish outlined\ncircle 12,12 r9"
        );
        writeFileSync(
          path.join(cwd, "filled.icon"),
          "icon ring\nfinish filled\ncircle 12,12 r10\nhole circle 12,12 r8"
        );
        if (writesReview(scenario, interrupted)) {
          writeFileSync(
            path.join(cwd, "author-review.json"),
            JSON.stringify({ unresolved: [] })
          );
          writeFileSync(
            path.join(cwd, "review.md"),
            "Test fixture review, no claim of image inspection."
          );
        }
        if (scenario === "malformed-review") {
          writeFileSync(path.join(cwd, "author-review.json"), '{"unresolved":');
        }
        if (scenario === "duplicate-limitations") {
          const item = {
            description: "Duplicate evidence",
            id: "same",
            kind: "visual",
          };
          writeFileSync(
            path.join(cwd, "author-review.json"),
            JSON.stringify({ unresolved: [item, item] })
          );
        }
        if (scenario === "altered-runtime-link") {
          const link = path.join(cwd, "dependency");
          rmSync(link);
          writeFileSync(link, "replaced dependency");
        }
        if (scenario === "altered-runtime") {
          writeFileSync(
            path.join(cwd, "checker.mjs"),
            "throw new Error('tampered checker must never execute')"
          );
        }
        if (scenario === "altered-reference-proof") {
          writeFileSync(images[1], "altered native reference proof");
        }
        if (scenario === "altered-image") {
          writeFileSync(images[0], "altered reference image");
        }
        if (scenario === "altered-input") {
          writeFileSync(path.join(cwd, "spec.json"), "{}");
        }
        const code = scenario === "author-failed" ? 1 : 0;
        return Promise.resolve({
          code: interrupted ? null : code,
          killed: false,
          stderr: "",
          stdout: "",
        });
      },
      master: "large",
      meanings: ["disc", "ring", "frame"],
      out,
      prepareRuntime: ["altered-runtime", "altered-runtime-link"].includes(
        scenario
      )
        ? (directory) => {
            const checker = path.join(directory, "checker.mjs");
            writeFileSync(checker, "// pinned runtime");
            const target = path.join(root, "runtime-dependency");
            mkdirSync(target);
            const link = path.join(directory, "dependency");
            symlinkSync(target, link, "dir");
            return Promise.resolve({
              checker,
              node: process.execPath,
              permissionArgs: [],
              protectedFiles: ["checker.mjs"],
              protectedLinks: { [link]: realpathSync(target) },
            });
          }
        : undefined,
      readTrace: scenario === "missing-inspection" ? () => "" : fixtureTrace,
      review: (request) => {
        expect(Object.keys(request.images)).not.toContain("composition.png");
        const meaning = request.questions.find(
          (question) => question.id === "meaning"
        );
        if (scenario === "selected-master") {
          expect(Object.keys(request.images)).toContain(
            "reference-0-proof.png"
          );
          expect(Object.keys(request.images)).not.toContain(
            "reference-1-proof.png"
          );
        }
        const style = request.questions.find(
          (question) => question.id === "style"
        );
        expect(style?.prompt).toContain('"declaredStrokeWidthsOn24Grid":[2]');
        expect(style?.prompt).not.toContain("unselected-secret");
        expect(meaning?.prompt).not.toContain("ring");
        expect(meaning?.choices).toEqual([
          "disc",
          "ring",
          "frame",
          "uncertain",
        ]);
        return Promise.resolve(reviewVerdict("pass"));
      },
      revisionPath,
    });
    expect(result.status).toBe(
      [
        "delivered",
        "selected-master",
        "composition",
        "interrupted-finalization",
        "interrupted-with-review",
      ].includes(scenario)
        ? "delivered"
        : "incomplete"
    );
    if (
      ["interrupted-finalization", "interrupted-with-review"].includes(scenario)
    ) {
      expect(result.attempts.map((item) => item.status)).toEqual([
        "incomplete",
        "review-clear",
      ]);
    }
    if (scenario === "repeated-interruption") {
      expect(result.attempts).toHaveLength(3);
      expect(result.qualityStatus).toBe("not-reviewed");
    }
    if (["malformed-review", "duplicate-limitations"].includes(scenario)) {
      expect(result.authorReview).toBeNull();
      expect(result.authorReviewError).toBeTruthy();
      expect(result.qualityStatus).toBe("not-reviewed");
      expect(result.attempts).toHaveLength(1);
    }
    if (scenario === "selected-master") {
      const staged = createStyleRevision(
        JSON.parse(readFileSync(path.join(out, "revision.json"), "utf-8"))
      );
      const original = createStyleRevision(
        JSON.parse(readFileSync(revisionPath, "utf-8"))
      );
      expect(result.sourceRevisionHash).toBe(original.hash);
      expect(staged.hash).not.toBe(original.hash);
      expect(result.style).toBe(selectStyle(staged, "large").key);
      expect(
        JSON.parse(
          readFileSync(path.join(out, "outlined.artifact.json"), "utf-8")
        ).style
      ).toBe(staged.hash);
    }
    expect(result.craftApproved).toBe(false);
    expect(result.reviewContentValidated).toBe(false);
    expect(result.missing).toEqual(
      ["missing-review", "repeated-interruption"].includes(scenario)
        ? ["author-review.json"]
        : []
    );
    expect(result.changedInputs).toEqual(
      {
        "altered-composition": ["composition.png"],
        "altered-composition-source": ["composition.json"],
        "altered-image": ["references.png"],
        "altered-input": ["spec.json"],
        "altered-reference-proof": ["reference-0-proof.png"],
        "altered-runtime": ["checker.mjs"],
        "altered-runtime-link": ["dependency"],
      }[scenario] ?? []
    );
    expect(result.checkExitCode).toBe(
      [
        "altered-composition",
        "altered-composition-source",
        "altered-input",
        "altered-image",
        "altered-reference-proof",
        "altered-runtime",
        "altered-runtime-link",
      ].includes(scenario)
        ? null
        : 0
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it.each([
  "repair",
  "repeat",
  "regression",
  "repair-failed",
  "uncertain",
  "author-veto",
  "wrong-meaning",
  "representation",
])(
  "preserves the best valid candidate through bounded review: %s",
  async (scenario) => {
    const root = mkdtempSync(path.join(tmpdir(), "iconsmith-repair-"));
    const out = path.join(root, "run");
    mkdirSync(out);
    const revisionPath = path.join(root, "revision.json");
    writeFileSync(
      revisionPath,
      JSON.stringify({
        calibration: "unvalidated",
        compiler: STYLE_COMPILER,
        id: "repair-fixture",
        masters: { large: specAt() },
        parts: [],
        policy: DEFAULT_POLICY,
        references: [],
        rubric: "Test fixture.",
      })
    );
    let authors = 0;
    let reviewers = 0;
    try {
      const result = await runLocalStyle({
        args: () => [],
        command: "must-not-run",
        concept: "ring",
        env: process.env,
        invoke: (brief, cwd, images) => {
          authors += 1;
          const radius = authors === 1 || scenario === "repeat" ? 9 : 8;
          if (authors > 1) {
            expect(brief).toContain("independent observations");
            expect(images.map((image) => path.basename(image))).toEqual([
              "previous-outlined.proof.png",
              "previous-filled.proof.png",
            ]);
            for (const image of images) {
              expect(readFileSync(image)).toEqual(
                readFileSync(
                  path.join(
                    out,
                    "attempt-1",
                    path.basename(image).replace("previous-", "")
                  )
                )
              );
            }
          } else {
            expect(images).toEqual([]);
          }
          writeFileSync(
            path.join(cwd, "outlined.icon"),
            `icon ring\nfinish outlined\ncircle 12,12 r${radius}`
          );
          writeFileSync(
            path.join(cwd, "filled.icon"),
            `icon ring\nfinish filled\ncircle 12,12 r${radius + 1}\nhole circle 12,12 r${radius - 1}`
          );
          writeFileSync(path.join(cwd, "review.md"), "Fixture delivery.");
          const unresolved =
            authors === 1 &&
            ["author-veto", "representation"].includes(scenario)
              ? [
                  {
                    description:
                      "Known author defect must not disappear into a positive reviewer score.",
                    id: "known-defect",
                    kind:
                      scenario === "representation"
                        ? "representation"
                        : "visual",
                  },
                ]
              : [];
          writeFileSync(
            path.join(cwd, "author-review.json"),
            JSON.stringify({ unresolved })
          );
          return Promise.resolve({
            code: authors === 2 && scenario === "repair-failed" ? 1 : 0,
            killed: false,
            stderr: "",
            stdout: "",
          });
        },
        master: "large",
        meanings: ["disc", "ring", "frame"],
        out,
        readTrace: fixtureTrace,
        review: () => {
          reviewers += 1;
          const decision =
            reviewers === 1 && scenario !== "author-veto" ? "fail" : "pass";
          const verdict = reviewVerdict(
            scenario === "uncertain" ? "uncertain" : decision
          );
          if (scenario === "wrong-meaning" && reviewers === 1) {
            verdict.answers.meaning.choice = "disc";
            verdict.answers.optics.choice = "pass";
          }
          if (scenario === "regression" && reviewers === 2) {
            verdict.answers.meaning.choice = "disc";
          }
          return Promise.resolve(verdict);
        },
        revisionPath,
      });
      const singleAttempt = ["uncertain", "representation"].includes(scenario);
      expect(authors).toBe(singleAttempt ? 1 : 2);
      const repaired = ["repair", "author-veto", "wrong-meaning"].includes(
        scenario
      );
      expect(result.selectedAttempt).toBe(
        path.join(out, repaired ? "attempt-2" : "attempt-1")
      );
      const expected =
        scenario === "uncertain" ? "review-uncertain" : "needs-repair";
      const selectedStatus = repaired ? "review-clear" : expected;
      expect(result.qualityStatus).toBe(
        scenario === "representation"
          ? "representation-blocked"
          : selectedStatus
      );
      if (scenario === "representation") {
        expect(reviewers).toBe(0);
      }
      if (scenario === "repeat") {
        expect(reviewers).toBe(1);
      }
      expect(result.craftApproved).toBe(false);
      expect(result.instrumentQualified).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

it("refuses missing, duplicate or invalid confusion plans before invoking an author", async () => {
  const out = mkdtempSync(path.join(tmpdir(), "iconsmith-meanings-"));
  try {
    await Promise.all(
      [
        ["ring"],
        ["ring", "ring", "disc"],
        ["disc", "frame", "square"],
        ["ring", "disc", "uncertain"],
      ].map((meanings) =>
        expect(
          runLocalStyle({
            args: () => [],
            command: "must-not-run",
            concept: "ring",
            env: {},
            invoke: () => {
              throw new Error("Author must not run");
            },
            master: "large",
            meanings,
            out,
            readTrace: fixtureTrace,
            revisionPath: "must-not-read",
          })
        ).rejects.toBeInstanceOf(ZodError)
      )
    );
  } finally {
    rmSync(out, { force: true, recursive: true });
  }
});

it.each(["elapsed", "inherited"])(
  "never invokes an author after the shared deadline: %s",
  async (scenario) => {
    const root = mkdtempSync(path.join(tmpdir(), "iconsmith-deadline-"));
    const out = path.join(root, "out");
    mkdirSync(out);
    const revisionPath = path.join(root, "revision.json");
    writeFileSync(
      revisionPath,
      JSON.stringify(
        createStyleRevision({
          calibration: "unvalidated",
          compiler: STYLE_COMPILER,
          id: "deadline-fixture",
          masters: { native: specAt() },
          parts: [],
          policy: DEFAULT_POLICY,
          references: [],
          rubric: "Fixture only",
        }).definition
      )
    );
    const invoke = vi.fn();
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValue(scenario === "inherited" ? 200 : 600_001);
    try {
      const result = await runLocalStyle({
        args: () => [],
        command: "not-a-real-command",
        concept: "ring",
        deadlineAt: scenario === "inherited" ? 100 : undefined,
        env: process.env,
        invoke,
        master: "native",
        meanings: ["ring", "disc", "square"],
        out,
        revisionPath,
      });
      expect(invoke).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        craftApproved: false,
        deadlineExceeded: true,
        maxWallMs: 600_000,
        status: "incomplete",
        stoppedReason: "deadline-exhausted",
      });
    } finally {
      now.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  }
);

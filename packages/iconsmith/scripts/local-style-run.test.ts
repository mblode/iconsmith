import { createHash } from "node:crypto";
import {
  existsSync,
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
import type { NativeCallContainerFactory } from "./local-native-call-factory.js";
import { createNativeStyleRouteForTest } from "./local-native-route.js";
import type {
  NativeStyleReviewRequest,
  NativeStyleReviewResult,
} from "./local-native-route.js";
import {
  normalizeLocalGenerationTerminal,
  runLocalStyle,
} from "./local-style-run.js";

it("normalizes a delivered but uncleared author result to an incomplete terminal", () => {
  expect(
    normalizeLocalGenerationTerminal(
      {
        completionProvenance: "structured-native-author-complete",
        qualityStatus: "representation-blocked",
        status: "delivered",
      },
      false
    )
  ).toEqual({
    authorOriginalCompletionProvenance: "structured-native-author-complete",
    authorOriginalStatus: "delivered",
    completionProvenance: "structured-native-author-complete",
    qualityStatus: "representation-blocked",
    status: "incomplete",
  });
});

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

const lateAuthorClock = (scenario: string) =>
  scenario === "author-stage-late"
    ? vi.spyOn(Date, "now").mockReturnValue(1_000_000)
    : undefined;

it.each([
  "delivered",
  "selected-master",
  "composition",
  "altered-composition",
  "altered-composition-source",
  "missing-review",
  "interrupted-finalization",
  "interrupted-finalization-mutated",
  "interrupted-with-review",
  "repeated-interruption",
  "missing-inspection",
  "author-failed",
  "author-stage-late",
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
  const clock = lateAuthorClock(scenario);
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
      // The scenario matrix intentionally exercises every delivery guard.
      // oxlint-disable-next-line eslint/complexity
      invoke: (brief, cwd, images) => {
        expect(brief).toContain(
          "This prompt is the complete BRIEF.md; do not reread BRIEF.md."
        );
        expect(brief).toContain("Treat checker.mjs as an opaque executable");
        expect(brief).toContain("use its output to repair the DSL");
        expect(brief).toContain("never read or search its source");
        expect(brief).not.toContain("Read BRIEF.md and execute");
        expect(brief).toContain("Execute this brief.");
        expect(brief).toContain("Run the real checker after each revision:");
        expect(brief).toContain("checker.mjs");
        expect(brief).toContain("revision.json");
        const interrupted =
          scenario === "repeated-interruption" ||
          ([
            "interrupted-finalization",
            "interrupted-finalization-mutated",
            "interrupted-with-review",
          ].includes(scenario) &&
            path.basename(cwd) === "attempt-1");
        if (
          [
            "interrupted-finalization",
            "interrupted-finalization-mutated",
          ].includes(scenario) &&
          !interrupted
        ) {
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
          scenario === "interrupted-finalization-mutated" && !interrupted
            ? "icon ring\nfinish outlined\ncircle 12,12 r8"
            : "icon ring\nfinish outlined\ncircle 12,12 r9"
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
        clock?.mockReturnValue(1_300_001);
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
        expect(
          request.questions.find(({ id }) => id === "family")?.prompt
        ).toContain("own enclosing circle or host");
        expect(
          request.questions.find(({ id }) => id === "optics")?.prompt
        ).toContain("shaft-to-head tangent transition");
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
    if (scenario === "interrupted-finalization") {
      expect(result.attempts.map((item) => item.status)).toEqual([
        "incomplete",
        "review-clear",
      ]);
    }
    if (scenario === "interrupted-finalization-mutated") {
      expect(result.changedInputs).toContain(
        "finalization-geometry:outlined.icon"
      );
      expect(result.attempts.map((item) => item.status)).toEqual([
        "incomplete",
        "incomplete",
      ]);
    }
    if (scenario === "interrupted-with-review") {
      expect(result.attempts.map((item) => item.status)).toEqual([
        "review-clear",
      ]);
      expect(result.completionProvenance).toBe(
        "host-validated-after-author-interruption"
      );
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
    if (scenario === "author-stage-late") {
      expect(result.authorStageDeadlineExceeded).toBe(true);
      expect(result.qualityStatus).toBe("not-reviewed");
      expect(result.deadlineExceeded).toBe(false);
    }
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
        "interrupted-finalization-mutated": [
          "finalization-geometry:outlined.icon",
        ],
      }[scenario] ?? []
    );
    let expectedCheckExitCode: number | null = 0;
    if (
      [
        "altered-composition",
        "altered-composition-source",
        "altered-input",
        "altered-image",
        "altered-reference-proof",
        "altered-runtime",
        "altered-runtime-link",
      ].includes(scenario)
    ) {
      expectedCheckExitCode = null;
    } else if (scenario === "interrupted-finalization-mutated") {
      expectedCheckExitCode = 1;
    }
    expect(result.checkExitCode).toBe(expectedCheckExitCode);
  } finally {
    clock?.mockRestore();
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
      if (scenario === "uncertain") {
        expect(reviewers).toBe(2);
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

it.each(["missing", "invalid"])(
  "refuses %s contained review configuration before author invocation",
  async (scenario) => {
    const root = mkdtempSync(
      path.join(tmpdir(), "iconsmith-review-preflight-")
    );
    const out = path.join(root, "out");
    mkdirSync(out);
    const revisionPath = path.join(root, "revision.json");
    writeFileSync(
      revisionPath,
      JSON.stringify({
        calibration: "unvalidated",
        compiler: STYLE_COMPILER,
        id: "review-preflight-fixture",
        masters: { native: specAt() },
        parts: [],
        policy: DEFAULT_POLICY,
        references: [],
        rubric: "Fixture only",
      })
    );
    const invoke = vi.fn();
    const reviewerContainer =
      scenario === "invalid"
        ? {
            dockerCommand: "docker",
            environment: {},
            image: `reviewer@sha256:${"a".repeat(64)}`,
            namePrefix: "iconsmith-review",
            nativeCliVersion: "fixture",
            nativeCommand: "/usr/local/bin/claude",
            nativeExecutableHostPath: revisionPath,
            nativeExecutableSha256: createHash("sha256")
              .update(readFileSync(revisionPath))
              .digest("hex"),
            persistIdentity: vi.fn(),
            persistSettlement: vi.fn(),
            stateMounts: [
              {
                containerPath: "/usr/local/bin/claude",
                hostPath: revisionPath,
                readOnly: true,
              },
            ],
          }
        : undefined;
    try {
      const result = await runLocalStyle({
        args: () => [],
        command: "must-not-run",
        concept: "ring",
        env: {},
        invoke,
        master: "native",
        meanings: ["ring", "disc", "square"],
        out,
        readTrace: fixtureTrace,
        reviewerContainer,
        revisionPath,
      });
      expect(invoke).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        status: "incomplete",
        stoppedReason: "author-incomplete",
      });
      expect(
        JSON.parse(
          readFileSync(path.join(out, "attempt-1", "author.json"), "utf-8")
        ).stderr
      ).toMatch(
        scenario === "missing"
          ? /valid contained reviewer/u
          : /absolute Docker client/u
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

it("refuses the uncontained real author route before provider invocation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-author-preflight-"));
  const out = path.join(root, "out");
  mkdirSync(out);
  const revisionPath = path.join(root, "revision.json");
  writeFileSync(
    revisionPath,
    JSON.stringify({
      calibration: "unvalidated",
      compiler: STYLE_COMPILER,
      id: "author-preflight-fixture",
      masters: { native: specAt() },
      parts: [],
      policy: DEFAULT_POLICY,
      references: [],
      rubric: "Fixture only",
    })
  );
  const review = vi.fn();
  try {
    const result = await runLocalStyle({
      args: () => [],
      command: "must-not-run",
      concept: "ring",
      env: {},
      master: "native",
      meanings: ["ring", "disc", "square"],
      out,
      readTrace: fixtureTrace,
      review,
      revisionPath,
    });
    expect(review).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "incomplete",
      stoppedReason: "author-incomplete",
    });
    expect(
      JSON.parse(
        readFileSync(path.join(out, "attempt-1", "author.json"), "utf-8")
      ).stderr
    ).toMatch(/author host execution is disabled/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it.each([
  { failedClarification: false, interrupted: false, mode: "ordinary" },
  { failedClarification: false, interrupted: true, mode: "interrupted" },
  {
    failedClarification: true,
    interrupted: false,
    mode: "failed clarification",
  },
])(
  "routes the exact AL16 author evidence uncertainty through both independent clarifications: $mode",
  async ({ failedClarification, interrupted }) => {
    const root = mkdtempSync(path.join(tmpdir(), "iconsmith-native-route-"));
    const out = path.join(root, "evidence");
    const runtimeRoot = path.join(root, "runtime");
    mkdirSync(out);
    mkdirSync(runtimeRoot);
    const revisionPath = path.join(root, "revision.json");
    writeFileSync(
      revisionPath,
      JSON.stringify({
        calibration: "unvalidated",
        compiler: STYLE_COMPILER,
        id: "native-route-fixture",
        masters: { native: specAt() },
        parts: [],
        policy: DEFAULT_POLICY,
        references: [
          {
            master: "native",
            name: "ring-anchor",
            provenance: { date: "2026-09-06", origin: "original" },
            svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>',
          },
        ],
        rubric: "Fixture only",
      })
    );
    const reviewRequests: {
      choices: readonly string[];
      deadlineAt: number;
      imageEntries: readonly { name: string; sha256: string }[];
      ordinal: number;
      out: string;
      parentDeadlineAt: number;
      prompts: readonly string[];
      runtimeCwd: string;
    }[] = [];
    const unusedFactory = {} as NativeCallContainerFactory;
    const reviewer = (id: string, lineage: string, model: string) => ({
      containerFactory: unusedFactory,
      id,
      lineage,
      model,
      run: vi.fn((request: NativeStyleReviewRequest) => {
        reviewRequests.push({
          choices:
            request.questions.find((question) => question.id === "meaning")
              ?.choices ?? [],
          deadlineAt: request.deadlineAt,
          imageEntries: Object.entries(request.images).map(([name, bytes]) => ({
            name,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          })),
          ordinal: request.nativeCall.ordinal,
          out: request.out,
          parentDeadlineAt: request.nativeCall.parentDeadlineAt,
          prompts: request.questions.map((question) => question.prompt),
          runtimeCwd: request.nativeCall.runtimeCwd,
        });
        if (
          failedClarification &&
          [7, 9].includes(request.nativeCall.ordinal)
        ) {
          return Promise.resolve({
            answers: null,
            evidenceHashes: { [`${id}.png`]: "a".repeat(64) },
            model,
            reason: "Clarification fixture did not complete.",
            status: "incomplete" as const,
          } satisfies NativeStyleReviewResult);
        }
        return Promise.resolve({
          answers: Object.fromEntries(
            request.questions.map((question) => [
              question.id,
              {
                choice: question.id === "meaning" ? "ring" : "pass",
                evidence: `${id} inspected the supplied pixels.`,
                treatment: "",
              },
            ])
          ),
          evidenceHashes: { [`${id}.png`]: "a".repeat(64) },
          model,
          status: "complete" as const,
        } satisfies NativeStyleReviewResult);
      }),
    });
    const authorCalls: { completionDeadlineAt: number; deadlineAt: number }[] =
      [];
    let nativePrompt = "";
    const route = createNativeStyleRouteForTest({
      author: {
        id: "astra-author",
        lineage: "astra",
        run: async (request) => {
          nativePrompt = request.prompt;
          authorCalls.push({
            completionDeadlineAt: request.completionDeadlineAt,
            deadlineAt: request.deadlineAt,
          });
          mkdirSync(request.out);
          writeFileSync(
            path.join(request.out, "outlined.icon"),
            "icon ring\nfinish outlined\ncircle 12,12 r9"
          );
          writeFileSync(
            path.join(request.out, "filled.icon"),
            "icon ring\nfinish filled\ncircle 12,12 r10\nhole circle 12,12 r8"
          );
          const checked = await request.check(request.out);
          const programHashes = Object.fromEntries(
            request.finishes.map((finish) => [
              finish,
              createHash("sha256")
                .update(readFileSync(path.join(request.out, `${finish}.icon`)))
                .digest("hex"),
            ])
          );
          const proofHashes = Object.fromEntries(
            request.finishes.map((finish) => [
              finish,
              createHash("sha256")
                .update(checked.proofs[finish] ?? new Uint8Array())
                .digest("hex"),
            ])
          );
          writeFileSync(
            path.join(request.out, "author-review.json"),
            JSON.stringify({
              unresolved: [
                {
                  description:
                    "Outlined: lock recognition remains uncertain in both 16px/1x panels because the shackle opening is difficult to resolve, compared with anchor-reference-5-proof.png.",
                  id: "outlined-lock-recognition",
                  kind: "representation",
                },
                {
                  description:
                    "Filled: lock recognition remains uncertain in both 16px/1x panels because the badge's shackle opening is difficult to distinguish; anchor-reference-4-proof.png provides clearer lock recognition.",
                  id: "filled-lock-recognition",
                  kind: "representation",
                },
              ],
            })
          );
          writeFileSync(path.join(request.out, "review.md"), "Fixture review.");
          const structuredResult = {
            completionDeadlineAt: request.completionDeadlineAt,
            completionProvenance: interrupted
              ? "host-validated-after-contained-finalization-interruption"
              : "structured-finalization-complete",
            deadlineAt: request.deadlineAt,
            ...(interrupted
              ? {
                  finalizationInterruption: {
                    inspectionHash: "b".repeat(64),
                    kind: "structured-finalization-interruption" as const,
                    programHashes,
                    settlement: {
                      accounting: "settled" as const,
                      callId: "final-call",
                      containerAbsent: true as const,
                      containerId: "c".repeat(64),
                      containment: "container-absent" as const,
                      containmentScope: "docker-private-pid-namespace" as const,
                      deadlineAt: request.deadlineAt,
                      deadlineExceeded: false as const,
                      // Injected route control only; real trigger authority is tested by the native factory and collector replay.
                      diagnosticTrigger: {
                        descriptorFile: path.join(
                          root,
                          "diagnostic-descriptor.json"
                        ),
                        descriptorSha256: "f".repeat(64),
                        file: path.join(root, "diagnostic-trigger.json"),
                        sha256: "a".repeat(64),
                        terminalLineSha256: "b".repeat(64),
                      },
                      evidenceFile: path.join(
                        root,
                        "container-settlement.json"
                      ),
                      evidenceHash: "d".repeat(64),
                      intentHash: "e".repeat(64),
                      killed: true as const,
                      kind: "verified-contained-finalization-interruption" as const,
                      outcome: "failed" as const,
                      processCode: null,
                      quiescenceScope:
                        "process-group-and-observed-descendants" as const,
                      quiescent: true as const,
                      settledAt: Date.now(),
                      stage: "04-finalize",
                    },
                    stageDeadlineAt: request.completionDeadlineAt,
                  },
                }
              : {}),
            mechanism: "experimental-injected-adapters",
            model: "fixture-astra",
            programHashes,
            proofHashes,
            repairBudget: {
              compiler: { requested: 1, used: 0 },
              totalRetrySlots: 3,
              totalRetrySlotsUsed: 0,
              visual: { requested: 1, used: 0 },
            },
            stages: [
              {
                attempt: 0,
                inspection: {
                  defects: [],
                  inspectionEvidence:
                    "The lower-right lock shackle is difficult to resolve at 16px.",
                  uncertainties: [
                    {
                      description:
                        "Native outlined lock recognition remains uncertain.",
                      finish: "outlined",
                    },
                    {
                      description:
                        "Native filled lock recognition remains uncertain.",
                      finish: "filled",
                    },
                  ],
                },
                programHashes,
                proofHashes,
                status: "inspected",
              },
            ],
            status: "delivered-with-uncertainty" as const,
          };
          writeFileSync(
            path.join(request.out, "structured-author.json"),
            JSON.stringify(structuredResult, null, 2)
          );
          return structuredResult;
        },
      },
      reviewers: [
        reviewer("reviewer-one", "claude", "claude-opus-5"),
        reviewer("reviewer-two", "gpt-5-5", "gpt-5.5"),
      ],
      runtimeRoot,
    });
    try {
      const deadlineAt = Date.now() + 1_200_000;
      const result = await runLocalStyle({
        args: () => [],
        command: "must-not-run",
        concept: "ring",
        deadlineAt,
        env: {},
        master: "native",
        maxWallMs: 1_200_000,
        meanings: ["ring", "disc", "square"],
        nativeRoute: route,
        out,
        revisionPath,
      });
      expect(authorCalls).toHaveLength(1);
      expect(authorCalls[0]).toMatchObject({ deadlineAt });
      expect(authorCalls[0]?.completionDeadlineAt).toBeLessThan(deadlineAt);
      expect(nativePrompt).toContain("BUNDLED ICONSMITH GUIDANCE");
      expect(nativePrompt).toContain("SELECTED SPEC");
      expect(nativePrompt).toContain("ADMITTED PARTS");
      expect(nativePrompt).toContain("REFERENCE ORDER");
      expect(nativePrompt).toContain("LAYOUT CONTEXT");
      expect(nativePrompt).toContain(
        "No cohort measurements are supplied to the host checker"
      );
      expect(nativePrompt).toContain("Do not emit `cohort`");
      expect(nativePrompt).toContain(
        "A `keyline` declaration asserts that the rendered visual extent matches that named width and height on both axes"
      );
      expect(nativePrompt).toContain(
        "Removing an incompatible declaration changes the claim, not the native footprint"
      );
      expect(nativePrompt).toContain("The host writes programs, compiles them");
      expect(nativePrompt).not.toMatch(
        /Read SKILL\.md|checker\.mjs|view_image|Run the real checker|Up to four revisions|Only write here/u
      );
      expect(reviewRequests).toHaveLength(4);
      expect(reviewRequests.map((request) => request.ordinal)).toEqual([
        6, 7, 8, 9,
      ]);
      expect(reviewRequests[0]?.imageEntries.map(({ name }) => name)).toEqual([
        expect.stringMatching(/^candidate-[a-f0-9]{24}\.png$/u),
        "anchor-01.png",
      ]);
      expect(
        reviewRequests.every(
          (request) =>
            JSON.stringify(request.imageEntries) ===
            JSON.stringify(reviewRequests[0]?.imageEntries)
        )
      ).toBe(true);
      const packetInput = JSON.parse(
        readFileSync(
          path.join(
            out,
            "attempt-1",
            "author-review-packet",
            "campaign-input.host.json"
          ),
          "utf-8"
        )
      );
      expect(packetInput.stimuli[0].familyReferences).toHaveLength(1);
      expect(
        JSON.parse(
          readFileSync(
            path.join(out, "attempt-1", "author-review-packet", "receipt.json"),
            "utf-8"
          )
        ).authorEvidence
      ).toMatchObject({
        mode: "evidence-only-uncertainty",
        uncertaintyCount: 4,
      });
      expect(reviewRequests[0]?.choices).toEqual(reviewRequests[1]?.choices);
      expect(reviewRequests[0]?.choices).toContain("uncertain");
      expect(reviewRequests[0]?.choices).toEqual(
        expect.arrayContaining(["ring", "disc", "square"])
      );
      expect(
        reviewRequests.every(
          (request) =>
            request.parentDeadlineAt === deadlineAt &&
            request.deadlineAt < deadlineAt &&
            request.runtimeCwd.startsWith(runtimeRoot) &&
            request.out.startsWith(path.join(out, "attempt-1"))
        )
      ).toBe(true);
      expect(
        new Set(reviewRequests.map((request) => request.runtimeCwd)).size
      ).toBe(4);
      expect(result).toMatchObject({
        completionProvenance: interrupted
          ? "host-validated-after-contained-finalization-interruption"
          : "structured-native-author-complete",
        craftApproved: false,
        qualityStatus: failedClarification
          ? "review-incomplete"
          : "review-clear",
        stoppedReason: failedClarification
          ? "review-incomplete"
          : "review-clear",
      });
      expect(result.reviews).toHaveLength(2);
      expect(reviewRequests[0]?.prompts.join(" ")).not.toContain(
        "Native outlined lock recognition remains uncertain"
      );
      expect(reviewRequests[2]?.prompts.join(" ")).not.toContain(
        "Native outlined lock recognition remains uncertain"
      );
      expect(reviewRequests[1]?.prompts.join(" ")).toContain(
        "Native outlined lock recognition remains uncertain"
      );
      expect(reviewRequests[1]?.prompts.join(" ")).toContain(
        '"source":"structured-inspection"'
      );
      expect(result.nativeRoute).toMatchObject({
        export: {
          completedAt: expect.any(Number),
          deadlineAt: expect.any(Number),
          startedAt: expect.any(Number),
        },
        externalReviewRedraws: 0,
        reviewers: [{ id: "reviewer-one" }, { id: "reviewer-two" }],
      });
      const exportTiming = result.nativeRoute?.export;
      if (
        exportTiming?.deadlineAt === undefined ||
        exportTiming.startedAt === undefined
      ) {
        throw new Error("Native export timing was not recorded");
      }
      expect(exportTiming.deadlineAt - exportTiming.startedAt).toBe(10_000);
      expect(
        JSON.parse(
          readFileSync(
            path.join(out, "attempt-1", "author-uncertainty-routing.json"),
            "utf-8"
          )
        )
      ).toMatchObject({
        independentClarificationRequired: true,
        uncertainties: expect.arrayContaining([
          expect.objectContaining({ id: "outlined-lock-recognition" }),
          expect.objectContaining({ finish: "outlined" }),
        ]),
      });
      const recognitionReceipt = JSON.parse(
        readFileSync(
          path.join(out, "attempt-1", "recognition-choices.json"),
          "utf-8"
        )
      );
      expect(recognitionReceipt).not.toHaveProperty("targetMeaning");
      expect(recognitionReceipt).not.toHaveProperty("choices");
      const meaningObservations = [1, 2].map((index) =>
        JSON.parse(
          readFileSync(
            path.join(out, "attempt-1", `meaning-observation-${index}.json`),
            "utf-8"
          )
        )
      );
      expect(
        meaningObservations.map((observation) => observation.choices)
      ).toEqual([reviewRequests[1]?.choices, reviewRequests[3]?.choices]);
      expect(
        meaningObservations.every(
          (observation) =>
            observation.orderedChoicesHash ===
            recognitionReceipt.orderedChoicesHash
        )
      ).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

it("refuses an inadmissible native host check before launching the checker or exporting artifacts", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-check-admission-"));
  const out = path.join(root, "evidence");
  const runtimeRoot = path.join(root, "runtime");
  mkdirSync(out);
  mkdirSync(runtimeRoot);
  const revisionPath = path.join(root, "revision.json");
  writeFileSync(
    revisionPath,
    JSON.stringify({
      calibration: "unvalidated",
      compiler: STYLE_COMPILER,
      id: "check-admission-fixture",
      masters: { native: specAt() },
      parts: [],
      policy: DEFAULT_POLICY,
      references: [],
      rubric: "Fixture only",
    })
  );
  const unusedFactory = {} as NativeCallContainerFactory;
  const reviewer = (id: string, lineage: string) => ({
    containerFactory: unusedFactory,
    id,
    lineage,
    model: `${id}-model`,
    run: vi.fn(),
  });
  const reviewers = [
    reviewer("reviewer-one", "claude"),
    reviewer("reviewer-two", "gpt-5-5"),
  ] as const;
  const deadlineAt = 2_200_000;
  const route = createNativeStyleRouteForTest({
    author: {
      id: "astra-author",
      lineage: "astra",
      run: async (request) => {
        mkdirSync(request.out);
        vi.setSystemTime(request.completionDeadlineAt - 1);
        await request.check(request.out);
        throw new Error("Checker admission unexpectedly returned");
      },
    },
    reviewers,
    runtimeRoot,
  });
  try {
    await expect(
      runLocalStyle({
        args: () => [],
        command: "must-not-run",
        concept: "ring",
        deadlineAt,
        env: {},
        master: "native",
        maxWallMs: 1_200_000,
        meanings: ["ring", "disc", "square"],
        nativeRoute: route,
        out,
        revisionPath,
      })
    ).rejects.toThrow("Insufficient deadline reserve for host-check");
    expect(reviewers.every(({ run }) => run.mock.calls.length === 0)).toBe(
      true
    );
    expect(existsSync(path.join(out, "outlined.icon"))).toBe(false);
    expect(existsSync(path.join(out, "delivery.json"))).toBe(false);

    vi.setSystemTime(1_000_000);
    const exportOut = path.join(root, "export-evidence");
    mkdirSync(exportOut);
    const exportRoute = createNativeStyleRouteForTest({
      author: {
        id: "astra-author",
        lineage: "astra",
        run: (request) => {
          mkdirSync(request.out);
          writeFileSync(path.join(request.out, "candidate-marker"), "exact");
          vi.setSystemTime(request.deadlineAt - 6000);
          return Promise.resolve({} as never);
        },
      },
      reviewers,
      runtimeRoot,
    });
    await expect(
      runLocalStyle({
        args: () => [],
        command: "must-not-run",
        concept: "ring",
        deadlineAt,
        env: {},
        master: "native",
        maxWallMs: 1_200_000,
        meanings: ["ring", "disc", "square"],
        nativeRoute: exportRoute,
        out: exportOut,
        revisionPath,
      })
    ).rejects.toThrow("Insufficient deadline reserve for artifact-export");
    expect(
      readFileSync(
        path.join(exportOut, "attempt-1", "candidate-marker"),
        "utf-8"
      )
    ).toBe("exact");
    expect(existsSync(path.join(exportOut, "candidate-marker"))).toBe(false);
    expect(existsSync(path.join(exportOut, "delivery.json"))).toBe(false);

    vi.setSystemTime(1_000_000);
    const latePublicationOut = path.join(root, "late-publication-evidence");
    mkdirSync(latePublicationOut);
    let publicationClock: ReturnType<typeof vi.spyOn> | undefined;
    const latePublicationRoute = createNativeStyleRouteForTest({
      author: {
        id: "astra-author",
        lineage: "astra",
        run: (request) => {
          mkdirSync(request.out);
          writeFileSync(path.join(request.out, "candidate-marker"), "exact");
          let calls = 0;
          publicationClock = vi.spyOn(Date, "now").mockImplementation(() => {
            calls += 1;
            return calls >= 8
              ? request.deadlineAt
              : request.deadlineAt - 10_000;
          });
          return Promise.resolve({} as never);
        },
      },
      reviewers,
      runtimeRoot,
    });
    await expect(
      runLocalStyle({
        args: () => [],
        command: "must-not-run",
        concept: "ring",
        deadlineAt,
        env: {},
        master: "native",
        maxWallMs: 1_200_000,
        meanings: ["ring", "disc", "square"],
        nativeRoute: latePublicationRoute,
        out: latePublicationOut,
        revisionPath,
      })
    ).rejects.toThrow("Delivery publication returned after its stage deadline");
    publicationClock?.mockRestore();
    expect(
      readFileSync(path.join(latePublicationOut, "candidate-marker"), "utf-8")
    ).toBe("exact");
    expect(existsSync(path.join(latePublicationOut, "delivery.json"))).toBe(
      false
    );

    vi.setSystemTime(1_000_000);
    const staleOut = path.join(root, "stale-evidence");
    mkdirSync(staleOut);
    writeFileSync(path.join(staleOut, "delivery.json"), "stale");
    await expect(
      runLocalStyle({
        args: () => [],
        command: "must-not-run",
        concept: "ring",
        deadlineAt,
        env: {},
        master: "native",
        maxWallMs: 1_200_000,
        meanings: ["ring", "disc", "square"],
        nativeRoute: exportRoute,
        out: staleOut,
        revisionPath,
      })
    ).rejects.toThrow("Native artifact export requires a fresh delivery path");
    expect(readFileSync(path.join(staleOut, "delivery.json"), "utf-8")).toBe(
      "stale"
    );
    expect(existsSync(path.join(staleOut, "candidate-marker"))).toBe(false);
  } finally {
    vi.useRealTimers();
    rmSync(root, { force: true, recursive: true });
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

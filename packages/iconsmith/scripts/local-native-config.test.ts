import { spawnSync } from "node:child_process";
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

import { expect, it, vi } from "vitest";

import { createFamilyReferencePacket } from "./family-reference-packet.js";
import * as astraAuthor from "./local-astra-author.js";
import * as codexReview from "./local-codex-review.js";
import { CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE } from "./local-native-call-factory.js";
import {
  configureNativeStyleRoute,
  nativeRetrievalReview,
  readNativeRouteManifest,
} from "./local-native-config.js";
import type { NativeRouteManifest } from "./local-native-config.js";
import {
  bindDiagnosticFinalizationPlan,
  readDiagnosticFinalizationPlan,
} from "./local-native-interruption-diagnostic.js";

const hash = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");
const fixture = () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "native-route-config-"))
  );
  const frozen = (name: string) => {
    const file = path.join(root, name);
    const bytes = name.endsWith("-ca")
      ? "-----BEGIN CERTIFICATE-----\nfixture"
      : name;
    writeFileSync(file, bytes, { mode: 0o700 });
    return { path: file, sha256: hash(bytes) };
  };
  const actor = (model: string) => ({
    cliVersion: "0.154.0-alpha.3",
    codexAssets: {
      certificateBundle: frozen(`${model}-ca`),
      codeModeHost: frozen(`${model}-helper`),
    },
    effort: "high" as const,
    executable: frozen(model),
    model,
    provider: "codex" as const,
    stateFiles: [
      { relativePath: "auth.json", source: frozen(`${model}-auth`) },
    ],
  });
  const manifest: NativeRouteManifest = {
    author: actor("gpt-6-astra"),
    billing: "subscription",
    docker: { ...frozen("docker"), resolvedPath: path.join(root, "docker") },
    image: `debian@sha256:${"a".repeat(64)}`,
    reviewers: [actor("gpt-5.5"), actor("gpt-5.6-sol")],
    schemaVersion: 1,
  };
  const save = (value: unknown = manifest) => {
    const bytes = JSON.stringify(value);
    const file = path.join(root, "manifest.json");
    writeFileSync(file, bytes);
    return { file, hash: hash(bytes) };
  };
  return { manifest, root, save };
};

const diagnosticBinding = (
  f: ReturnType<typeof fixture>,
  routeHash: string,
  deadlineAt: number
) => {
  const packet = createFamilyReferencePacket({
    concept: "folder-lock",
    excludedFamilies: ["folder-lock"],
    excludedSourceHashes: [],
    librarySet: "blode-icons",
    librarySourceHash: "1".repeat(64),
    sources: [
      {
        admissionRequested: false,
        intent: {
          evidence: "folder body",
          polarity: "body",
          treatment: "preserve body",
        },
        source: {
          finish: "outlined",
          name: "folder",
          provenance: { date: "2026-09-09", origin: "literal" },
          svg: '<svg viewBox="0 0 24 24"><path d="M3 5H10L12 7H21V20H3Z"/></svg>',
        },
      },
    ],
  });
  const packetFile = path.join(f.root, "diagnostic-packet.json");
  const packetBytes = `${JSON.stringify(packet)}\n`;
  writeFileSync(packetFile, packetBytes);
  const revisionFile = path.join(f.root, "diagnostic-revision.json");
  const revisionBytes = '{"revision":"fixture"}\n';
  writeFileSync(revisionFile, revisionBytes);
  const target = {
    concept: "folder-lock",
    family: "folder",
    master: "16" as const,
    slotIds: [
      "folder/folder-lock/16/outlined",
      "folder/folder-lock/16/filled",
    ] as const,
  };
  const planFile = path.join(f.root, "diagnostic-plan.json");
  const plan = {
    campaignHash: "2".repeat(64),
    expiresAt: deadlineAt - 1000,
    familyPacket: {
      file: packetFile,
      packetHash: packet.packetHash,
      sha256: hash(packetBytes),
    },
    image: f.manifest.image,
    kind: "iconsmith-finalization-interruption-plan-v1",
    maxWallMs: 1_200_000,
    planFile,
    qualification: false,
    revisionHash: hash(revisionBytes),
    routeHash,
    schemaVersion: 1,
    target,
  };
  const planBytes = `${JSON.stringify(plan)}\n`;
  writeFileSync(planFile, planBytes);
  return bindDiagnosticFinalizationPlan({
    actual: {
      campaignHash: plan.campaignHash,
      concept: target.concept,
      deadlineAt,
      family: target.family,
      familyPacket: { ...plan.familyPacket },
      image: plan.image,
      master: target.master,
      maxWallMs: plan.maxWallMs,
      requestId: "4".repeat(64),
      revisionFile,
      revisionHash: plan.revisionHash,
      routeHash,
      slotIds: target.slotIds,
    },
    loaded: readDiagnosticFinalizationPlan({
      file: planFile,
      sha256: hash(planBytes),
    }),
  });
};

it("limits the frozen interruption capability to the author finalization adapter", async () => {
  const f = fixture();
  const runAuthor = vi
    .spyOn(astraAuthor, "runNativeAstraStructuredAuthor")
    .mockResolvedValue({} as never);
  try {
    const saved = f.save();
    const out = path.join(f.root, "diagnostic-result");
    mkdirSync(out);
    const deadlineAt = Date.now() + 1_200_000;
    const route = configureNativeStyleRoute({
      deadlineAt,
      diagnosticFinalization: diagnosticBinding(f, saved.hash, deadlineAt),
      manifest: f.manifest,
      out,
      requestId: "4".repeat(64),
      routeHash: saved.hash,
      startedAt: Date.now(),
    });
    await route.author.run({
      check: () =>
        Promise.resolve({
          proofs: {},
          status: 0,
          stderr: "",
          stdout: "",
        }),
      completionDeadlineAt: deadlineAt,
      concept: "folder-lock",
      deadlineAt,
      finishes: ["outlined", "filled"],
      out: path.join(out, "author"),
      prompt: "fixture",
      referenceImages: {},
      runtimeRoot: route.runtimeRoot,
    });
    expect(runAuthor).toHaveBeenCalledWith(
      expect.objectContaining({
        enableDiagnosticFinalizationInterruption: true,
      })
    );
    expect(() =>
      route.reviewers[0].containerFactory.create({
        cwd: path.join(route.runtimeRoot, "reviewer-diagnostic"),
        deadlineAt,
        diagnosticFinalization: {
          finalizedReceiptHash: "a".repeat(64),
          inspectionHash: "a".repeat(64),
          programHashes: { outlined: "a".repeat(64) },
          responseSchemaHash: "a".repeat(64),
          stageDeadlineAt: deadlineAt,
        },
        ordinal: 0,
        stageKind: "finalize",
      })
    ).toThrow("single-use and finalization-only");
  } finally {
    runAuthor.mockRestore();
    rmSync(f.root, { force: true, recursive: true });
  }
});

it("refuses a transplanted diagnostic binding before creating native control", () => {
  const f = fixture();
  try {
    const saved = f.save();
    const out = path.join(f.root, "transplanted-result");
    mkdirSync(out);
    const deadlineAt = Date.now() + 1_200_000;
    expect(() =>
      configureNativeStyleRoute({
        deadlineAt,
        diagnosticFinalization: diagnosticBinding(f, saved.hash, deadlineAt),
        manifest: f.manifest,
        out,
        requestId: "6".repeat(64),
        routeHash: saved.hash,
        startedAt: Date.now(),
      })
    ).toThrow("binding was transplanted");
    expect(existsSync(path.join(out, "native-control"))).toBe(false);
  } finally {
    rmSync(f.root, { force: true, recursive: true });
  }
});

it("reserves exactly two automatic retrieval calls with the original deadline and shared factory", async () => {
  const f = fixture();
  const review = vi
    .spyOn(codexReview, "reviewImagesWithCodex")
    .mockResolvedValue({ answers: null } as Awaited<
      ReturnType<typeof codexReview.reviewImagesWithCodex>
    >);
  try {
    const saved = f.save();
    const out = path.join(f.root, "result");
    mkdirSync(out);
    const deadlineAt = Date.now() + 1_200_000;
    const route = configureNativeStyleRoute({
      deadlineAt,
      manifest: f.manifest,
      out,
      requestId: "retrieval-fixture",
      retrievalCalls: 2,
      routeHash: saved.hash,
      startedAt: deadlineAt - 1_200_000,
    });
    expect(route.budget).toMatchObject({
      authorDeadlineAt: deadlineAt - 370_000,
      maxCalls: 12,
      maxRetrievalCalls: 2,
      retrievalReserveMs: 240_000,
    });
    const invoke = nativeRetrievalReview(route);
    const request = {
      deadlineAt: route.budget.retrievalDeadlineAt,
      images: {},
      out: path.join(out, "retrieval-result"),
      questions: [],
    };
    await expect(invoke({ ...request, deadlineAt })).rejects.toThrow(
      "deadline identity mismatch"
    );
    await invoke(request);
    await invoke(request);
    expect(review.mock.calls.map(([call]) => call.nativeCall?.ordinal)).toEqual(
      [10, 11]
    );
    expect(
      review.mock.calls.map(([call]) => call.nativeCall?.stageKind)
    ).toEqual(["retrieval-discovery", "retrieval-selection"]);
    for (const [call] of review.mock.calls) {
      expect(call).toMatchObject({
        deadlineAt: route.budget.retrievalDeadlineAt,
        maxStageMs: 120_000,
        model: "gpt-6-astra",
        nativeCall: { parentDeadlineAt: deadlineAt },
      });
    }
    expect(review.mock.calls[0][0].nativeCall?.containerFactory).toBe(
      review.mock.calls[1][0].nativeCall?.containerFactory
    );
    await expect(invoke(request)).rejects.toThrow("allowance exhausted");
    expect(() => nativeRetrievalReview({ ...route })).toThrow(
      "no reserved automatic retrieval"
    );
    expect(review).toHaveBeenCalledTimes(2);
  } finally {
    review.mockRestore();
    rmSync(f.root, { force: true, recursive: true });
  }
});

it("does not renew the frozen retrieval slice when route setup is re-entered later", () => {
  const f = fixture();
  const startedAt = 1_000_000;
  const deadlineAt = startedAt + 1_200_000;
  const clock = vi.spyOn(Date, "now");
  try {
    const saved = f.save();
    const configureAt = (name: string, now: number) => {
      clock.mockReturnValue(now);
      const out = path.join(f.root, name);
      mkdirSync(out);
      return configureNativeStyleRoute({
        deadlineAt,
        manifest: f.manifest,
        out,
        requestId: name,
        retrievalCalls: 2,
        routeHash: saved.hash,
        startedAt,
      });
    };
    const initial = configureAt("initial", startedAt + 1);
    const reentered = configureAt("reentered", startedAt + 100_000);
    expect(reentered.budget).toEqual(initial.budget);
    expect(reentered.budget.retrievalDeadlineAt).toBe(startedAt + 240_000);
    expect(
      JSON.parse(
        readFileSync(
          path.join(f.root, "reentered/native-control/launch.json"),
          "utf-8"
        )
      ).budget
    ).toEqual(initial.budget);
  } finally {
    clock.mockRestore();
    rmSync(f.root, { force: true, recursive: true });
  }
});

it("refuses expired retrieval before invoking the adapter and never gives a packet route a retrieval callback", async () => {
  const f = fixture();
  const review = vi.spyOn(codexReview, "reviewImagesWithCodex");
  try {
    const saved = f.save();
    const build = (name: string, retrievalCalls: 0 | 2) => {
      const out = path.join(f.root, name);
      mkdirSync(out);
      return configureNativeStyleRoute({
        deadlineAt: Date.now() + 1_200_000,
        manifest: f.manifest,
        out,
        requestId: name,
        retrievalCalls,
        routeHash: saved.hash,
        startedAt: Date.now(),
      });
    };
    expect(() => nativeRetrievalReview(build("packet", 0))).toThrow(
      "no reserved automatic retrieval"
    );
    const route = build("automatic", 2);
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValue(route.budget.retrievalDeadlineAt - 4999);
    try {
      await expect(
        nativeRetrievalReview(route)({
          deadlineAt: route.budget.retrievalDeadlineAt,
          images: {},
          out: path.join(f.root, "expired"),
          questions: [],
        })
      ).rejects.toThrow("reserve exhausted");
    } finally {
      clock.mockRestore();
    }
    expect(review).not.toHaveBeenCalled();
  } finally {
    review.mockRestore();
    rmSync(f.root, { force: true, recursive: true });
  }
});

it("retrieval selection honors the shared STOP sentinel before a provider intent", async () => {
  const f = fixture();
  const review = vi
    .spyOn(codexReview, "reviewImagesWithCodex")
    .mockResolvedValueOnce({ answers: null } as Awaited<
      ReturnType<typeof codexReview.reviewImagesWithCodex>
    >);
  try {
    const saved = f.save();
    const out = path.join(f.root, "result");
    mkdirSync(out);
    const route = configureNativeStyleRoute({
      deadlineAt: Date.now() + 1_200_000,
      manifest: f.manifest,
      out,
      requestId: "stop-retrieval",
      retrievalCalls: 2,
      routeHash: saved.hash,
      startedAt: Date.now(),
    });
    const invoke = nativeRetrievalReview(route);
    const request = {
      deadlineAt: route.budget.retrievalDeadlineAt,
      images: { "style.png": new Uint8Array([1]) },
      out: path.join(out, "discovery"),
      questions: [{ choices: ["none"], id: "body", prompt: "Select a body" }],
    };
    // Only discovery is stubbed. Selection executes the real adapter and factory.
    await invoke(request);
    writeFileSync(path.join(out, "native-control/calls/STOP"), "stop");
    await expect(
      invoke({ ...request, out: path.join(out, "selection") })
    ).rejects.toThrow("stopped");
    expect(
      JSON.parse(
        readFileSync(
          path.join(out, "native-control/calls/dispatches.json"),
          "utf-8"
        )
      ).calls
    ).toEqual([]);
    expect(
      readFileSync(path.join(out, "native-control/calls/stopped.json"), "utf-8")
    ).toContain("stop-sentinel");
  } finally {
    review.mockRestore();
    rmSync(f.root, { force: true, recursive: true });
  }
});

it("binds the exact route and refuses self-consistent manifest replacement under its prior hash", () => {
  const f = fixture();
  try {
    const original = f.save();
    expect(
      readNativeRouteManifest(original.file, original.hash).manifest.author
        .model
    ).toBe("gpt-6-astra");
    f.manifest.author.cliVersion = "changed";
    f.save();
    expect(() => readNativeRouteManifest(original.file, original.hash)).toThrow(
      "manifest identity changed"
    );
  } finally {
    rmSync(f.root, { force: true, recursive: true });
  }
});

it("retains historical Mini parsing but refuses dispatch before reservation", () => {
  const f = fixture();
  try {
    f.manifest.reviewers[0] = {
      ...f.manifest.reviewers[0],
      model: "gpt-5.4-mini",
      reviewProfile: CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE,
    };
    const saved = f.save();
    const verified = readNativeRouteManifest(saved.file, saved.hash);
    expect(verified.manifest.reviewers[0]).toMatchObject({
      model: "gpt-5.4-mini",
      reviewProfile: CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE,
    });
    const out = path.join(f.root, "mini-route");
    mkdirSync(out);
    expect(() =>
      configureNativeStyleRoute({
        deadlineAt: Date.now() + 1_200_000,
        manifest: verified.manifest,
        out,
        requestId: "mini-reviewer-fixture",
        routeHash: saved.hash,
        startedAt: Date.now(),
      })
    ).toThrow("retired after D376");
    expect(existsSync(path.join(out, "native-control"))).toBe(false);
    expect(existsSync(`${out}.native-runtime`)).toBe(false);
  } finally {
    rmSync(f.root, { force: true, recursive: true });
  }
});

it.each([
  "legacy-profile",
  "goal-enabled-profile",
  "missing-profile",
  "profiled-author",
  "profiled-standard-model",
])("refuses Mini profile mismatch: %s", (failure) => {
  const f = fixture();
  try {
    if (failure === "legacy-profile") {
      f.manifest.reviewers[0].model = "gpt-5.4-mini";
      f.manifest.reviewers[0].reviewProfile =
        "inline-images-no-view-image-v1" as never;
    } else if (failure === "goal-enabled-profile") {
      f.manifest.reviewers[0].model = "gpt-5.4-mini";
      f.manifest.reviewers[0].reviewProfile =
        "mini-inline-images-no-tools-v2" as never;
    } else if (failure === "missing-profile") {
      f.manifest.reviewers[0].model = "gpt-5.4-mini";
    } else if (failure === "profiled-author") {
      f.manifest.author.reviewProfile = CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE;
    } else {
      f.manifest.reviewers[0].reviewProfile =
        CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE;
    }
    const saved = f.save();
    expect(() => readNativeRouteManifest(saved.file, saved.hash)).toThrow();
  } finally {
    rmSync(f.root, { force: true, recursive: true });
  }
});

it.each([
  "duplicate-lineage",
  "ambient-state",
  "executable-drift",
  "paid-route",
  "unknown-model",
  "unsupported-version",
  "unsupported-claude-author",
])("refuses %s before constructing any provider factory", (failure) => {
  const f = fixture();
  try {
    if (failure === "duplicate-lineage") {
      f.manifest.reviewers[0] = f.manifest.author;
    }
    if (failure === "ambient-state") {
      f.manifest.author.stateFiles = [
        { relativePath: "../AGENTS.md", source: f.manifest.author.executable },
      ];
    }
    if (failure === "executable-drift") {
      writeFileSync(f.manifest.author.executable.path, "changed");
    }
    if (failure === "unsupported-version") {
      f.manifest.author.cliVersion = "future-unverified";
    }
    if (failure === "unknown-model") {
      f.manifest.author.model = "marketing-alias";
    }
    if (failure === "unsupported-claude-author") {
      f.manifest.author.provider = "claude";
      f.manifest.author.cliVersion = "2.1.263";
      f.manifest.author.model = "claude-opus-5";
      delete f.manifest.author.codexAssets;
      f.manifest.author.stateFiles = [
        {
          relativePath: ".claude/.credentials.json",
          source: f.manifest.author.executable,
        },
      ];
    }
    const recorded = f.save(
      failure === "paid-route" ? { ...f.manifest, billing: "api" } : f.manifest
    );
    expect(() =>
      readNativeRouteManifest(recorded.file, recorded.hash)
    ).toThrow();
  } finally {
    rmSync(f.root, { force: true, recursive: true });
  }
});

it("constructs the canonical adapters with one original budget and an empty shared dispatch journal", () => {
  const f = fixture();
  try {
    const saved = f.save();
    const verified = readNativeRouteManifest(saved.file, saved.hash);
    const out = path.join(f.root, "result");
    mkdirSync(out);
    const deadlineAt = Date.now() + 1_200_000;
    const route = configureNativeStyleRoute({
      deadlineAt,
      manifest: verified.manifest,
      out,
      requestId: "fixture-request",
      routeHash: verified.hash,
      startedAt: deadlineAt - 1_200_000,
    });
    expect(route.author.lineage).toBe("gpt-6-astra");
    expect(route.reviewers.map((reviewer) => reviewer.lineage)).toEqual([
      "gpt-5-5",
      "gpt-5-6-sol",
    ]);
    const launch = JSON.parse(
      readFileSync(path.join(out, "native-control/launch.json"), "utf-8")
    );
    expect(launch.budget).toMatchObject({
      authorDeadlineAt: deadlineAt - 370_000,
      deadlineAt,
      maxCalls: 10,
    });
    expect(
      JSON.parse(
        readFileSync(
          path.join(out, "native-control/calls/dispatches.json"),
          "utf-8"
        )
      ).calls
    ).toEqual([]);
  } finally {
    rmSync(f.root, { force: true, recursive: true });
  }
});

it.each(["model-disagreement", "missing-parent-deadline"])(
  "canonical CLI refuses %s before output or provider setup",
  (failure) => {
    const f = fixture();
    try {
      const saved = f.save();
      const out = path.join(f.root, "must-not-exist");
      const args = [
        "--import",
        "tsx",
        "scripts/local-generate.ts",
        "folder-lock",
        out,
        "--revision",
        path.join(f.root, "absent-revision"),
        "--master",
        "native16",
        "--meanings",
        path.join(f.root, "absent-meanings"),
        "--native-route",
        saved.file,
        "--native-route-hash",
        saved.hash,
        ...(failure === "missing-parent-deadline"
          ? []
          : ["--deadline-at", String(Date.now() + 1_200_000)]),
        ...(failure === "model-disagreement"
          ? ["--model", "gpt-5.5"]
          : ["--library", f.root, "--library-set", "blode-icons"]),
      ];
      const result = spawnSync(process.execPath, args, {
        encoding: "utf-8",
        timeout: 10_000,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        failure === "model-disagreement"
          ? "Native launch arguments disagree"
          : "A parent-issued --deadline-at is required"
      );
      expect(() => readFileSync(path.join(out, "run.json"))).toThrow();
    } finally {
      rmSync(f.root, { force: true, recursive: true });
    }
  }
);

it("preserves Docker invocation aliases while refusing resolved executable retargeting", () => {
  const f = fixture();
  try {
    const alias = path.join(f.root, "docker-alias");
    symlinkSync(f.manifest.docker.path, alias);
    f.manifest.docker.path = alias;
    const saved = f.save();
    expect(
      readNativeRouteManifest(saved.file, saved.hash).manifest.docker.path
    ).toBe(alias);
    rmSync(alias);
    symlinkSync(f.manifest.author.executable.path, alias);
    expect(() => readNativeRouteManifest(saved.file, saved.hash)).toThrow(
      "Docker invocation resolution changed"
    );
  } finally {
    rmSync(f.root, { force: true, recursive: true });
  }
});

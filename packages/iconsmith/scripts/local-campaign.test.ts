import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, vi } from "vitest";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import {
  STYLE_COMPILER,
  createStyleRevision,
  selectStyle,
  compileStyle,
} from "../src/pipeline/style.js";
import { specAt } from "../src/tools/canvas.js";
import { opticalProof } from "../src/tools/proof.js";
import {
  createCampaignManifest,
  createReliabilityReplayManifest,
} from "./campaign-manifest.js";
import { createFamilyReferencePacket } from "./family-reference-packet.js";
import {
  corpusTreeHash,
  frozenCampaignPlanHash,
  intentFile,
  launchFile,
  planLocalCampaign,
  productionToolingIdentity,
  requestIntent,
  readCampaignTerminalEvidence,
  runLocalCampaign,
  verifyCampaignTerminalEvidence,
} from "./local-campaign.js";
import type { NativeRouteManifest } from "./local-native-config.js";
import * as structuredAuthor from "./local-structured-author.js";
import { DEVELOPMENT_FAMILIES } from "./quality-population.js";
import { captureRuntimeIdentity } from "./runtime-identity.js";

const deferred = () => {
  let finish: ((value: undefined) => void) | undefined;
  // Controlled settlement is required to test concurrent resume before child output.
  // oxlint-disable-next-line promise/avoid-new, promise/prefer-await-to-callbacks
  const promise = new Promise<undefined>((resolve) => {
    finish = resolve;
  });
  return { promise, resolve: (value?: undefined) => finish?.(value) };
};

const fixture = async () => {
  const { mkdtempSync } = await import("node:fs");
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-campaign-"));
  const library = path.join(root, "library");
  const meaningsDirectory = path.join(root, "meanings");
  const fixturePackage = path.join(root, "repo", "packages", "iconsmith");
  const fixtureScripts = path.join(fixturePackage, "scripts");
  mkdirSync(library);
  mkdirSync(meaningsDirectory);
  mkdirSync(fixtureScripts, { recursive: true });
  for (const name of [
    "family-parts.ts",
    "family-reference-packet.ts",
    "local-author-context.ts",
    "local-generate.ts",
    "local-retrieval.ts",
    "local-review.ts",
    "local-runtime.ts",
    "local-style-run.ts",
    "reference-proofs.ts",
  ]) {
    writeFileSync(path.join(fixtureScripts, name), `// fixture ${name}\n`);
  }
  writeFileSync(path.join(root, "repo", "package-lock.json"), "{}\n");
  writeFileSync(path.join(library, "box.svg"), "<svg/>");
  const manifestFile = path.join(root, "manifest.json");
  const frozen = createCampaignManifest(
    "development",
    {
      sources: [
        { id: "blode-icons", records: 20, treeHash: corpusTreeHash(library) },
      ],
    },
    []
  );
  writeFileSync(manifestFile, JSON.stringify(frozen));
  for (const { concept } of DEVELOPMENT_FAMILIES) {
    writeFileSync(
      path.join(meaningsDirectory, `${concept}.json`),
      JSON.stringify([concept, `${concept}-other`, `${concept}-alternate`])
    );
  }
  const native = path.join(root, "native-cli");
  writeFileSync(native, "#!/bin/sh\necho fixture-v1\n", { mode: 0o755 });
  const runtime = captureRuntimeIdentity(native, native);
  runtime.manifest.reviewer.command = "claude";
  const runtimeFile = path.join(root, "runtime.json");
  runtime.hash = createHash("sha256")
    .update(JSON.stringify(runtime.manifest))
    .digest("hex");
  writeFileSync(runtimeFile, JSON.stringify(runtime));
  const revisionFile = path.join(root, "revision.json");
  writeFileSync(revisionFile, "{}");
  return {
    authorCommand: native,
    authorModel: "gpt-6-astra",
    concurrency: 1,
    execute: false,
    generator: path.join(fixtureScripts, "local-generate.ts"),
    library,
    manifestFile,
    maxRequests: 2,
    meaningsDirectory,
    out: path.join(root, "campaign"),
    revisionFile,
    root,
    runtimeFile,
    verifyRuntime: () => runtime,
  };
};

const nativeFixture = async () => {
  const base = await fixture();
  const frozen = (name: string) => {
    const file = path.join(base.root, `native-${name}`);
    const bytes = name.endsWith("-ca")
      ? "-----BEGIN CERTIFICATE-----\nfixture"
      : name;
    writeFileSync(file, bytes, { mode: 0o700 });
    return {
      path: realpathSync(file),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  };
  const actor = (model: "gpt-6-astra" | "gpt-5.5" | "gpt-5.6-sol") => ({
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
  const docker = frozen("docker");
  const manifest: NativeRouteManifest = {
    author: actor("gpt-6-astra"),
    billing: "subscription",
    docker: { ...docker, resolvedPath: docker.path },
    image: `debian@sha256:${"a".repeat(64)}`,
    reviewers: [actor("gpt-5.5"), actor("gpt-5.6-sol")],
    schemaVersion: 1,
  };
  const bytes = JSON.stringify(manifest);
  const runtimeFile = path.join(base.root, "native-manifest.json");
  writeFileSync(runtimeFile, bytes);
  return {
    ...base,
    authorCommand: undefined,
    authorModel: undefined,
    nativeRouteHash: createHash("sha256").update(bytes).digest("hex"),
    out: path.join(realpathSync(base.root), "campaign"),
    runtimeFile,
  };
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const flag = (args: readonly string[], name: string) =>
  args.at(args.indexOf(name) + 1);
const frozenIntent = (
  plan: ReturnType<typeof planLocalCampaign>,
  request: ReturnType<typeof planLocalCampaign>["requests"][number]
) => {
  const issuedAt = Date.now();
  return {
    ...requestIntent(plan, request),
    deadlineAt: issuedAt + request.maxWallMs,
    issuedAt,
  };
};

const writeDeliveredFixture = (
  options: Awaited<ReturnType<typeof fixture>>,
  args: readonly string[]
) => {
  const destination = String(args.at(4));
  const attempt = path.join(destination, "attempt-1");
  mkdirSync(attempt, { recursive: true });
  writeFileSync(path.join(attempt, "outlined.svg"), "<svg><path/></svg>");
  writeFileSync(path.join(attempt, "filled.svg"), "<svg><path/></svg>");
  const runtimeHash = JSON.parse(
    readFileSync(options.runtimeFile, "utf-8")
  ).hash;
  writeFileSync(
    path.join(destination, "run.json"),
    JSON.stringify({
      authorCommand: options.authorCommand,
      concept: args.at(3),
      requestId: flag(args, "--request-id"),
      requestedModel: options.authorModel,
      route: "automatic-retrieval",
      runtimeHash,
      toolingHash: flag(args, "--tooling-hash"),
    })
  );
  writeFileSync(
    path.join(destination, "request.json"),
    JSON.stringify({
      deadlineAt: Number(flag(args, "--deadline-at")),
      deadlineExceeded: false,
      elapsedMs: 1,
      master: flag(args, "--master"),
      maxWallMs: Number(flag(args, "--max-wall-ms")),
      nativeSize: Number(flag(args, "--master")),
      qualityStatus: "review-clear",
      requestId: flag(args, "--request-id"),
      route: "automatic-retrieval",
      runtimeHash,
      selectedAttempt: attempt,
      status: "delivered",
      toolingHash: flag(args, "--tooling-hash"),
    })
  );
};

const writeNativeIncompleteFixture = (
  options: Awaited<ReturnType<typeof nativeFixture>>,
  args: readonly string[],
  accounting: "none" | "settled" = "settled"
) => {
  const destination = String(args.at(4));
  const attempt = path.join(destination, "attempt-1");
  mkdirSync(attempt, { recursive: true });
  for (const [name, bytes] of [
    ["outlined.svg", "<svg><path/></svg>"],
    ["filled.svg", "<svg><path/></svg>"],
    ["program.dsl", "circle(8,8,3)"],
    ["checks.json", '{"status":"passed"}'],
    ["review.json", '{"unresolved":["visible-defect"]}'],
  ] as const) {
    writeFileSync(path.join(attempt, name), bytes);
  }
  const runtimeHash = options.nativeRouteHash;
  const deadlineAt = Number(flag(args, "--deadline-at"));
  const requestId = String(flag(args, "--request-id"));
  writeFileSync(
    path.join(destination, "run.json"),
    JSON.stringify({
      authorCommand: JSON.parse(readFileSync(options.runtimeFile, "utf-8"))
        .author.executable.path,
      concept: args.at(3),
      requestId,
      requestedModel: "gpt-6-astra",
      route: "automatic-retrieval",
      runtimeHash,
      toolingHash: flag(args, "--tooling-hash"),
    })
  );
  writeFileSync(
    path.join(destination, "request.json"),
    JSON.stringify({
      attempts: [{ directory: attempt, status: "incomplete" }],
      deadlineAt,
      deadlineExceeded: false,
      elapsedMs: 10,
      master: flag(args, "--master"),
      maxWallMs: Number(flag(args, "--max-wall-ms")),
      nativeSize: Number(flag(args, "--master")),
      qualityStatus: "not-reviewed",
      requestId,
      route: "automatic-retrieval",
      runtimeHash,
      selectedAttempt: attempt,
      status: "incomplete",
      toolingHash: flag(args, "--tooling-hash"),
    })
  );
  const control = path.join(destination, "native-control");
  const calls = path.join(control, "calls");
  mkdirSync(calls, { recursive: true });
  const routeHash = options.nativeRouteHash;
  const reservation = {
    billing: "subscription",
    deadlineAt,
    maxCalls: 12,
    minimumCallReserveMs: 5000,
    reservationId: requestId,
    routeHash,
  };
  const reservationHash = createHash("sha256")
    .update(JSON.stringify(reservation))
    .digest("hex");
  writeFileSync(
    path.join(calls, "reservation.json"),
    JSON.stringify({ reservation, reservationHash })
  );
  writeFileSync(
    path.join(control, "launch.json"),
    JSON.stringify({
      budget: { deadlineAt, maxCalls: 12 },
      requestId,
      reservationHash,
      routeHash,
    })
  );
  if (accounting === "none") {
    writeFileSync(
      path.join(calls, "dispatches.json"),
      JSON.stringify({ calls: [], reservationHash })
    );
    return;
  }
  const callId = "fixture-call-1";
  const callIntent = {
    callId,
    deadlineAt,
    dispatchedAt: deadlineAt - 1000,
    minimumRemainingMs: 5000,
    requestId,
    reservationHash,
    routeHash,
    stage: "00-construct",
  };
  const intentHash = createHash("sha256")
    .update(JSON.stringify(callIntent))
    .digest("hex");
  const started = { intentHash, startedAt: deadlineAt - 900 };
  const startedHash = createHash("sha256")
    .update(JSON.stringify(started))
    .digest("hex");
  writeFileSync(
    path.join(calls, "dispatches.json"),
    JSON.stringify({
      calls: [{ callId, intentHash, startedHash }],
      reservationHash,
    })
  );
  writeFileSync(
    path.join(calls, `${callId}.intent.json`),
    JSON.stringify(callIntent)
  );
  writeFileSync(
    path.join(calls, `${callId}.started.json`),
    JSON.stringify(started)
  );
  const evidenceDirectory = path.join(control, "author", "00-construct");
  mkdirSync(evidenceDirectory, { recursive: true });
  const containerId = "b".repeat(64);
  const image = `debian@sha256:${"a".repeat(64)}`;
  writeFileSync(
    path.join(evidenceDirectory, "container-identity.json"),
    JSON.stringify({
      containerId,
      containerName: "iconsmith-native-call-acde1234abcd",
      image,
      ownershipToken: "12345678-1234-4123-8123-123456789abc",
    })
  );
  const evidenceFile = path.join(
    evidenceDirectory,
    "container-settlement.json"
  );
  const evidenceBytes = `${JSON.stringify(
    {
      container: {
        artifactEligible: true,
        containerAbsent: true,
        containerId,
        containmentScope: "docker-private-pid-namespace",
        image,
        process: {
          code: 0,
          killed: false,
          quiescenceScope: "process-group-and-observed-descendants",
          quiescent: true,
        },
        status: "complete",
      },
      deadlineAt,
      intentHash,
    },
    null,
    2
  )}\n`;
  writeFileSync(evidenceFile, evidenceBytes);
  writeFileSync(
    path.join(calls, `${callId}.terminal.json`),
    JSON.stringify({
      accounting: "settled",
      containment: "container-absent",
      deadlineExceeded: false,
      evidenceFile,
      evidenceHash: createHash("sha256").update(evidenceBytes).digest("hex"),
      intentHash,
      outcome: "complete",
      settledAt: deadlineAt - 800,
    })
  );
};

const duplicateNativeStage = (destination: string) => {
  const calls = path.join(destination, "native-control", "calls");
  const original = JSON.parse(
    readFileSync(path.join(calls, "fixture-call-1.intent.json"), "utf-8")
  );
  const callId = "fixture-call-2";
  const intent = {
    ...original,
    callId,
    dispatchedAt: original.dispatchedAt + 1,
  };
  const intentHash = createHash("sha256")
    .update(JSON.stringify(intent))
    .digest("hex");
  const started = { intentHash, startedAt: original.dispatchedAt + 2 };
  const startedHash = createHash("sha256")
    .update(JSON.stringify(started))
    .digest("hex");
  writeFileSync(
    path.join(calls, `${callId}.intent.json`),
    JSON.stringify(intent)
  );
  writeFileSync(
    path.join(calls, `${callId}.started.json`),
    JSON.stringify(started)
  );
  const dispatchFile = path.join(calls, "dispatches.json");
  const dispatches = JSON.parse(readFileSync(dispatchFile, "utf-8"));
  dispatches.calls.push({ callId, intentHash, startedHash });
  writeFileSync(dispatchFile, JSON.stringify(dispatches));
  const evidenceDirectory = path.join(
    destination,
    "native-control",
    "author",
    "duplicate-stage"
  );
  mkdirSync(evidenceDirectory);
  const originalEvidence = path.join(
    destination,
    "native-control",
    "author",
    "00-construct"
  );
  writeFileSync(
    path.join(evidenceDirectory, "container-identity.json"),
    readFileSync(path.join(originalEvidence, "container-identity.json"))
  );
  const evidenceFile = path.join(
    evidenceDirectory,
    "container-settlement.json"
  );
  const evidence = JSON.parse(
    readFileSync(
      path.join(originalEvidence, "container-settlement.json"),
      "utf-8"
    )
  );
  evidence.intentHash = intentHash;
  const evidenceBytes = `${JSON.stringify(evidence, null, 2)}\n`;
  writeFileSync(evidenceFile, evidenceBytes);
  writeFileSync(
    path.join(calls, `${callId}.terminal.json`),
    JSON.stringify({
      accounting: "settled",
      containment: "container-absent",
      deadlineExceeded: false,
      evidenceFile,
      evidenceHash: createHash("sha256").update(evidenceBytes).digest("hex"),
      intentHash,
      outcome: "complete",
      settledAt: original.dispatchedAt + 3,
    })
  );
};

const dryRun = (result: Awaited<ReturnType<typeof runLocalCampaign>>) => {
  if (!("requests" in result)) {
    throw new Error("Expected a dry-run result");
  }
  return result;
};

const settledOuter = () =>
  Promise.resolve({
    code: 1,
    killed: false,
    quiescenceScope: "process-group-and-observed-descendants" as const,
    quiescent: true,
    stderr: "",
    stdout: "",
  });

test.each(["campaign", "request"])(
  "a latched %s stop leaves subsequent requests unstarted after resume",
  async (scope) => {
    const options = { ...(await fixture()), execute: true };
    const spawn = vi.fn((_command: string, args: readonly string[]) => {
      writeDeliveredFixture(options, args);
      if (scope === "campaign") {
        writeFileSync(path.join(options.out, "STOP"), "stop");
      } else {
        const control = path.join(String(args.at(4)), "native-control/calls");
        mkdirSync(control, { recursive: true });
        writeFileSync(
          path.join(control, "stopped.json"),
          JSON.stringify({ reason: "stop-sentinel" })
        );
      }
      return { signal: null, status: 0 };
    });
    try {
      const result = await runLocalCampaign({
        ...options,
        spawn: spawn as never,
      });
      expect(result).toMatchObject({ dispatched: 1 });
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(
        readFileSync(path.join(options.out, "stopped.json"), "utf-8")
      ).toContain("observed");
      rmSync(path.join(options.out, "STOP"), { force: true });
      expect(
        dryRun(await runLocalCampaign({ ...options, execute: false })).scheduled
      ).toEqual([]);
      expect(
        await runLocalCampaign({ ...options, spawn: spawn as never })
      ).toMatchObject({
        dispatched: 0,
      });
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(options.root, { force: true, recursive: true });
    }
  }
);

const executionResults = (
  result: Awaited<ReturnType<typeof runLocalCampaign>>
) => {
  if (!result.results) {
    throw new Error("Expected execution results");
  }
  return result.results;
};

test.each(["program.dsl", "proofs/native-dark.png", "reviews/panel.json"])(
  "refuses resume after selected %s changes without redispatch",
  async (name) => {
    const options = { ...(await fixture()), execute: true, maxRequests: 1 };
    let selected = "";
    let calls = 0;
    const spawn = (_command: string, args: readonly string[]) => {
      calls += 1;
      writeDeliveredFixture(options, args);
      selected = path.join(String(args.at(4)), "attempt-1", name);
      mkdirSync(path.dirname(selected), { recursive: true });
      writeFileSync(selected, "original evidence");
      return { signal: null, status: 0 };
    };
    try {
      const first = await runLocalCampaign({
        ...options,
        spawn: spawn as never,
      });
      expect(executionResults(first)[0]).toMatchObject({
        terminal: { status: "delivered" },
      });
      writeFileSync(selected, "changed evidence");
      await expect(
        runLocalCampaign({ ...options, spawn: spawn as never })
      ).rejects.toThrow();
      expect(calls).toBe(1);
    } finally {
      rmSync(options.root, { force: true, recursive: true });
    }
  }
);

test.each(["symlink", "hardlink"])(
  "quarantines linked selected review evidence (%s)",
  async (kind) => {
    const options = { ...(await fixture()), execute: true, maxRequests: 1 };
    const spawn = (_command: string, args: readonly string[]) => {
      writeDeliveredFixture(options, args);
      const outside = path.join(options.root, "external-review.json");
      writeFileSync(outside, "{}");
      const target = path.join(String(args.at(4)), "attempt-1", "review.json");
      (kind === "symlink" ? symlinkSync : linkSync)(outside, target);
      return { signal: null, status: 0 };
    };
    try {
      const result = await runLocalCampaign({
        ...options,
        spawn: spawn as never,
      });
      expect(executionResults(result)[0]).toMatchObject({
        outerRefusal: true,
        terminal: { status: "refused" },
      });
    } finally {
      rmSync(options.root, { force: true, recursive: true });
    }
  }
);

test("dry-run freezes all 40 pair requests and bounds the scheduled batch", async () => {
  const options = await fixture();
  try {
    const result = dryRun(await runLocalCampaign(options));
    expect(result).toMatchObject({
      aiQualification: "pending",
      concurrency: 1,
      maxRequests: 2,
      mode: "dry-run",
      qualificationAuthority: "ai-only",
    });
    expect(result.requests).toHaveLength(40);
    expect(result.ledger.slots).toHaveLength(80);
    expect(result.scheduled).toHaveLength(2);
    const [firstRequest] = result.requests;
    expect(firstRequest.slotIds).toHaveLength(2);
    symlinkSync(options.authorCommand, path.join(options.root, "claude"));
    const originalPath = process.env.PATH;
    process.env.PATH = `${options.root}${path.delimiter}${originalPath}`;
    const verifiedRuntime = captureRuntimeIdentity(options.authorCommand);
    writeFileSync(options.runtimeFile, JSON.stringify(verifiedRuntime));
    const cli = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.resolve(import.meta.dirname, "local-campaign.ts"),
        "--author-command",
        options.authorCommand,
        "--runtime",
        options.runtimeFile,
        "--manifest",
        options.manifestFile,
        "--revision",
        options.revisionFile,
        "--library",
        options.library,
        "--meanings",
        options.meaningsDirectory,
        "--out",
        options.out,
        "--generator",
        options.generator,
        "--max-requests",
        "2",
        "--concurrency",
        "1",
      ],
      { encoding: "utf-8" }
    );
    process.env.PATH = originalPath;
    expect(cli.status, cli.stderr).toBe(0);
    const cliResult = JSON.parse(cli.stdout);
    expect(cliResult.mode).toBe("dry-run");
    expect(cliResult.scheduled).toHaveLength(2);
    expect(cliResult.scheduled[0]).toMatchObject({ concept: "cloud-upload" });
    expect(() => planLocalCampaign({ ...options, concurrency: 2 })).toThrow(
      "sequential"
    );
    writeFileSync(options.revisionFile, '{"changed":true}');
    expect(planLocalCampaign(options).revisionHash).not.toBe(
      result.revisionHash
    );
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("tooling identity prunes asset trees but retains corpus source", () => {
  const identity = productionToolingIdentity(
    path.resolve(import.meta.dirname, "local-generate.ts")
  );
  const names = identity.files.map(({ name }) => name);
  expect(names).toContain("src/corpus/load.ts");
  expect(
    names.some((name) =>
      /(?:^|\/)(?:\.corpus|node_modules|dist)(?:\/|$)/u.test(name)
    )
  ).toBe(false);
  expect(names.some((name) => name.startsWith("corpus/"))).toBe(false);
});

test("rejects malformed development campaign denominators", async () => {
  const options = await fixture();
  try {
    const frozen = JSON.parse(readFileSync(options.manifestFile, "utf-8"));
    frozen.manifest.slots.pop();
    frozen.hash = digest(frozen.manifest);
    writeFileSync(options.manifestFile, JSON.stringify(frozen));
    expect(() => planLocalCampaign(options)).toThrow(
      "20 unique families and 80 unique slots"
    );
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("executes only the bounded batch and skips only hash-validated terminals", async () => {
  const options = { ...(await fixture()), execute: true, maxRequests: 1 };
  let calls = 0;
  const timeouts: number[] = [];
  const spawn = (
    _command: string,
    args: readonly string[],
    spawnOptions: { timeout?: number }
  ) => {
    calls += 1;
    timeouts.push(spawnOptions.timeout ?? 0);
    expect(flag(args, "--library-hash")).toBe(corpusTreeHash(options.library));
    const destination = args.at(4);
    if (!destination) {
      throw new Error("missing fixture destination");
    }
    mkdirSync(destination);
    writeFileSync(
      path.join(destination, "run.json"),
      JSON.stringify({
        authorCommand:
          options.authorCommand ??
          "/Applications/ChatGPT.app/Contents/Resources/codex",
        concept: args.at(3),
        requestId: flag(args, "--request-id"),
        requestedModel: options.authorModel ?? "gpt-6-astra",
        route: "automatic-retrieval",
        runtimeHash: JSON.parse(readFileSync(options.runtimeFile, "utf-8"))
          .hash,
        toolingHash: flag(args, "--tooling-hash"),
      })
    );
    writeFileSync(
      path.join(destination, "request.json"),
      JSON.stringify({
        deadlineAt: Number(flag(args, "--deadline-at")),
        deadlineExceeded: false,
        elapsedMs: 12,
        master: flag(args, "--master"),
        maxWallMs: Number(flag(args, "--max-wall-ms")),
        nativeSize: Number(flag(args, "--master")),
        qualityStatus: "not-reviewed",
        requestId: flag(args, "--request-id"),
        route: "automatic-retrieval",
        runtimeHash: JSON.parse(readFileSync(options.runtimeFile, "utf-8"))
          .hash,
        status: "incomplete",
        toolingHash: flag(args, "--tooling-hash"),
      })
    );
    return { status: 1 };
  };
  try {
    const first = await runLocalCampaign({ ...options, spawn: spawn as never });
    const [firstResult] = executionResults(first);
    expect(first).toMatchObject({ dispatched: 1 });
    expect(firstResult).toMatchObject({
      aiQualified: false,
      skipped: false,
      terminal: { status: "incomplete" },
    });
    const second = await runLocalCampaign({
      ...options,
      maxRequests: 2,
      spawn: spawn as never,
    });
    const [secondResult] = executionResults(second);
    expect(second).toMatchObject({ dispatched: 2 });
    expect(secondResult).toMatchObject({ skipped: true });
    expect(calls).toBe(3);
    expect(timeouts.every((timeout) => timeout > 0)).toBe(true);
    expect(second.ledger.slots).toHaveLength(80);
    expect(
      second.ledger.slots.filter(({ status }) => status === "pending")
    ).toHaveLength(74);
    const [firstReceipt] = executionResults(first);
    const resumedDryRun = dryRun(
      await runLocalCampaign({ ...options, execute: false, maxRequests: 1 })
    );
    expect(resumedDryRun.scheduled).toHaveLength(1);
    expect(resumedDryRun.scheduled[0].requestId).not.toBe(
      firstReceipt.requestId
    );
    writeFileSync(
      path.join(options.out, "receipts", `${firstReceipt.requestId}.json`),
      JSON.stringify({ ...firstReceipt, requestFileHash: "b".repeat(64) })
    );
    await expect(
      runLocalCampaign({ ...options, spawn: spawn as never })
    ).rejects.toThrow("identity validation");
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("records a missing child terminal as an identity-bound outer refusal", async () => {
  const options = { ...(await fixture()), execute: true, maxRequests: 1 };
  try {
    const first = await runLocalCampaign({
      ...options,
      spawn: (() => ({
        error: new Error("fixture timeout"),
        signal: "SIGTERM",
        status: null,
      })) as never,
    });
    const [result] = executionResults(first);
    expect(result).toMatchObject({
      outerRefusal: true,
      reason: "Generator returned without a terminal receipt",
      terminal: { status: "refused" },
    });
    const resumed = dryRun(
      await runLocalCampaign({ ...options, execute: false })
    );
    expect(resumed.scheduled[0]?.requestId).not.toBe(result.requestId);
    const receiptFile = path.join(
      options.out,
      "receipts",
      `${result.requestId}.json`
    );
    const receipt = JSON.parse(readFileSync(receiptFile, "utf-8"));
    writeFileSync(
      receiptFile,
      JSON.stringify({ ...receipt, reason: "changed" })
    );
    await expect(
      runLocalCampaign({ ...options, execute: false })
    ).rejects.toThrow("identity validation");
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("binds retained invalid child bytes by canonical path and hash on resume", async () => {
  const options = { ...(await fixture()), execute: true, maxRequests: 1 };
  try {
    const first = await runLocalCampaign({
      ...options,
      ownedProcess: (call) => {
        writeDeliveredFixture(options, call.args);
        const file = path.join(String(call.args.at(4)), "request.json");
        const terminal = JSON.parse(readFileSync(file, "utf-8"));
        writeFileSync(
          file,
          JSON.stringify({ ...terminal, qualityStatus: "invalid-fixture" })
        );
        return settledOuter();
      },
    });
    const [receipt] = executionResults(first);
    const [request] = planLocalCampaign(options).requests;
    const retainedPath = path.join(
      realpathSync(path.dirname(request.destination)),
      path.basename(request.destination),
      "request.json"
    );
    expect(receipt).toMatchObject({
      invalidChildOutputHash: createHash("sha256")
        .update(readFileSync(retainedPath))
        .digest("hex"),
      invalidChildOutputPath: retainedPath,
      outerRefusal: true,
    });
    await expect(
      runLocalCampaign({ ...options, execute: false })
    ).resolves.toMatchObject({
      mode: "dry-run",
    });
    writeFileSync(retainedPath, '{"changed":true}\n');
    await expect(
      runLocalCampaign({ ...options, execute: false })
    ).rejects.toThrow("identity validation");
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("rejects a child output added after a no-output refusal", async () => {
  const options = { ...(await fixture()), execute: true, maxRequests: 1 };
  try {
    const first = await runLocalCampaign({
      ...options,
      ownedProcess: () => settledOuter(),
    });
    const [receipt] = executionResults(first);
    expect(receipt).toMatchObject({
      invalidChildOutputHash: null,
      invalidChildOutputPath: null,
      outerRefusal: true,
    });
    const [request] = planLocalCampaign(options).requests;
    mkdirSync(request.destination, { recursive: true });
    writeFileSync(path.join(request.destination, "request.json"), "{}\n");
    await expect(
      runLocalCampaign({ ...options, execute: false })
    ).rejects.toThrow("identity validation");
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("does not seal an outer refusal with unscoped parent settlement", async () => {
  const options = { ...(await fixture()), execute: true, maxRequests: 1 };
  try {
    await expect(
      runLocalCampaign({
        ...options,
        ownedProcess: () =>
          Promise.resolve({
            code: 1,
            killed: false,
            quiescent: true,
            stderr: "",
            stdout: "",
          }),
      })
    ).rejects.toThrow("Parent settlement evidence is invalid");
    const [request] = planLocalCampaign(options).requests;
    expect(() =>
      readFileSync(
        path.join(options.out, "receipts", `${request.requestId}.json`),
        "utf-8"
      )
    ).toThrow();
    await expect(
      runLocalCampaign({ ...options, execute: false })
    ).rejects.toThrow("Unsettled outer dispatch blocks campaign resume");
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test.each([
  ["missing quiescence scope", { quiescenceScope: undefined }],
  ["wrong quiescence scope", { quiescenceScope: "process-group-only" }],
  ["unknown field", { unexpected: true }],
  [
    "unsettled parent retaining child bytes",
    { quiescenceScope: undefined, quiescent: false },
  ],
] as const)("rejects outer refusal with %s", async (_label, mutation) => {
  const options = { ...(await fixture()), execute: true, maxRequests: 1 };
  try {
    const first = await runLocalCampaign({
      ...options,
      ownedProcess: (call) => {
        writeDeliveredFixture(options, call.args);
        const file = path.join(String(call.args.at(4)), "request.json");
        const terminal = JSON.parse(readFileSync(file, "utf-8"));
        writeFileSync(
          file,
          JSON.stringify({ ...terminal, qualityStatus: "invalid-fixture" })
        );
        return settledOuter();
      },
    });
    const [result] = executionResults(first);
    const file = path.join(options.out, "receipts", `${result.requestId}.json`);
    const { integrityHash: ignored, ...receipt } = JSON.parse(
      readFileSync(file, "utf-8")
    );
    expect(ignored).toBeTypeOf("string");
    receipt.parentSettlement = { ...receipt.parentSettlement, ...mutation };
    writeFileSync(
      file,
      JSON.stringify({ ...receipt, integrityHash: digest(receipt) })
    );
    await expect(
      runLocalCampaign({ ...options, execute: false })
    ).rejects.toThrow("identity validation");
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test.each([
  { child: { signal: "SIGTERM", status: null }, label: "signaled" },
  { child: { signal: null, status: 1 }, label: "nonzero" },
  {
    child: { error: new Error("fixture timeout"), signal: null, status: null },
    label: "errored",
  },
])("quarantines a delivered receipt from a $label child", async ({ child }) => {
  const options = { ...(await fixture()), execute: true, maxRequests: 1 };
  try {
    const result = await runLocalCampaign({
      ...options,
      spawn: ((_command: string, args: readonly string[]) => {
        writeDeliveredFixture(options, args);
        return child;
      }) as never,
    });
    expect(executionResults(result)[0]).toMatchObject({
      outerRefusal: true,
      reason: expect.stringContaining("clean, parent-observed on-time"),
      terminal: { status: "refused" },
    });
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("quarantines delivery completed after the parent deadline", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T00:00:00Z"));
  const options = { ...(await fixture()), execute: true, maxRequests: 1 };
  try {
    const result = await runLocalCampaign({
      ...options,
      spawn: ((_command: string, args: readonly string[]) => {
        writeDeliveredFixture(options, args);
        vi.setSystemTime(Date.now() + 1_200_000);
        return { signal: null, status: 0 };
      }) as never,
    });
    expect(executionResults(result)[0]).toMatchObject({
      outerRefusal: true,
      reason: expect.stringContaining("original parent deadline"),
    });
  } finally {
    vi.useRealTimers();
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("rejects a rehashed launch descriptor that differs from current dispatch", async () => {
  const options = { ...(await fixture()), execute: true, maxRequests: 1 };
  try {
    await expect(
      runLocalCampaign({
        ...options,
        spawn: (() => {
          throw new Error("interrupt after launch descriptor commit");
        }) as never,
      })
    ).rejects.toThrow("interrupt after launch descriptor commit");
    const [request] = planLocalCampaign(options).requests;
    // Fixture-only rewind: the injected executor threw without starting a process.
    // Model a pre-dispatch crash so this test reaches descriptor validation.
    rmSync(`${request.destination}.outer-start.json`);
    const file = launchFile(request);
    const launch = JSON.parse(readFileSync(file, "utf-8"));
    launch.descriptor.args = [...launch.descriptor.args, "--qualification"];
    launch.hash = createHash("sha256")
      .update(JSON.stringify(launch.descriptor))
      .digest("hex");
    writeFileSync(file, JSON.stringify(launch));
    let dispatched = false;
    await expect(
      runLocalCampaign({
        ...options,
        spawn: (() => {
          dispatched = true;
          return { status: 0 };
        }) as never,
      })
    ).rejects.toThrow("does not match current dispatch");
    expect(dispatched).toBe(false);
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("an unknown prior attempt blocks automatic rerun", async () => {
  const options = await fixture();
  try {
    const plan = planLocalCampaign(options);
    mkdirSync(options.out);
    mkdirSync(path.join(options.out, "requests"));
    mkdirSync(path.join(options.out, "receipts"));
    writeFileSync(
      path.join(options.out, "campaign-lock.json"),
      JSON.stringify(plan)
    );
    mkdirSync(plan.requests[0].destination);
    await expect(runLocalCampaign(options)).rejects.toThrow(
      "Unknown attempt blocks automatic charging"
    );
    await expect(
      runLocalCampaign({ ...options, execute: true })
    ).rejects.toThrow("Unknown attempt blocks automatic charging");
    const [request] = plan.requests;
    writeFileSync(
      intentFile(request),
      JSON.stringify(frozenIntent(plan, request))
    );
    writeFileSync(
      path.join(request.destination, "request.json"),
      JSON.stringify({
        deadlineAt: Date.now() + request.maxWallMs,
        deadlineExceeded: false,
        elapsedMs: request.maxWallMs,
        maxWallMs: request.maxWallMs,
        qualityStatus: "review-clear",
        status: "delivered",
      })
    );
    await expect(runLocalCampaign(options)).rejects.toThrow(
      "Unknown attempt blocks automatic charging"
    );
    expect(
      readFileSync(path.join(options.out, "campaign-lock.json"), "utf-8")
    ).toContain(plan.campaignHash);
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("refuses an incomplete campaign directory before dispatch", async () => {
  const options = { ...(await fixture()), execute: true };
  try {
    const plan = planLocalCampaign(options);
    mkdirSync(options.out);
    writeFileSync(
      path.join(options.out, "campaign-lock.json"),
      JSON.stringify(plan)
    );
    let dispatched = false;
    await expect(
      runLocalCampaign({
        ...options,
        spawn: (() => {
          dispatched = true;
          return { status: 1 };
        }) as never,
      })
    ).rejects.toThrow("structurally incomplete");
    expect(dispatched).toBe(false);
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("blocks child-only terminal recovery without redispatch", async () => {
  const options = { ...(await fixture()), execute: true, maxRequests: 40 };
  try {
    const plan = planLocalCampaign(options);
    mkdirSync(options.out);
    mkdirSync(path.join(options.out, "requests"));
    mkdirSync(path.join(options.out, "receipts"));
    writeFileSync(
      path.join(options.out, "campaign-lock.json"),
      JSON.stringify(plan)
    );
    const [request] = plan.requests;
    writeFileSync(
      intentFile(request),
      JSON.stringify(frozenIntent(plan, request))
    );
    mkdirSync(request.destination);
    const attempt = path.join(request.destination, "attempt-1");
    mkdirSync(attempt);
    writeFileSync(path.join(attempt, "outlined.svg"), "<svg><path/></svg>");
    writeFileSync(path.join(attempt, "filled.svg"), "<svg><path/></svg>");
    writeFileSync(
      path.join(request.destination, "run.json"),
      JSON.stringify({
        authorCommand: plan.execution.authorCommand,
        concept: request.concept,
        requestId: request.requestId,
        requestedModel: plan.execution.authorModel,
        route: plan.execution.route,
        runtimeHash: plan.execution.runtimeHash,
        toolingHash: plan.execution.toolingHash,
      })
    );
    writeFileSync(
      path.join(request.destination, "request.json"),
      JSON.stringify({
        deadlineAt: JSON.parse(readFileSync(intentFile(request), "utf-8"))
          .deadlineAt,
        deadlineExceeded: false,
        elapsedMs: 12,
        master: String(request.master),
        maxWallMs: request.maxWallMs,
        nativeSize: request.master,
        qualityStatus: "review-clear",
        requestId: request.requestId,
        route: plan.execution.route,
        runtimeHash: plan.execution.runtimeHash,
        selectedAttempt: attempt,
        status: "delivered",
        toolingHash: plan.execution.toolingHash,
      })
    );
    let charged = 0;
    await expect(
      runLocalCampaign({
        ...options,
        spawn: (() => {
          charged += 1;
          return { status: 0 };
        }) as never,
      })
    ).rejects.toThrow("Unsettled child-only attempt blocks automatic recovery");
    expect(charged).toBe(0);
    expect(
      readFileSync(path.join(request.destination, "request.json"), "utf-8")
    ).toContain('"status":"delivered"');
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("accepts a native incomplete terminal only after strict call settlement", async () => {
  const options = { ...(await nativeFixture()), execute: true, maxRequests: 1 };
  try {
    const result = await runLocalCampaign({
      ...options,
      ownedProcess: (call) => {
        writeNativeIncompleteFixture(options, call.args);
        return settledOuter();
      },
    });
    const [receipt] = executionResults(result);
    expect(receipt).toMatchObject({
      nativeAccountingHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      terminal: { qualityStatus: "not-reviewed", status: "incomplete" },
    });
    expect(receipt).not.toHaveProperty("outerRefusal");
    expect(receipt.artifacts.map(({ name }: { name: string }) => name)).toEqual(
      [
        "checks.json",
        "filled.svg",
        "outlined.svg",
        "program.dsl",
        "review.json",
      ]
    );
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

const terminalCapability = async (
  options: Awaited<ReturnType<typeof nativeFixture>>
) => {
  const plan = planLocalCampaign(options);
  const [request] = plan.requests;
  return {
    capability: await verifyCampaignTerminalEvidence({
      expectedPlanHash: frozenCampaignPlanHash(plan),
      plan,
      receiptRoot: path.join(options.out, "receipts"),
      requestId: request.requestId,
    }),
    plan,
    request,
  };
};

const rewriteReceipt = (
  file: string,
  mutate: (value: Record<string, unknown>) => void
) => {
  const receipt = JSON.parse(readFileSync(file, "utf-8"));
  mutate(receipt);
  delete receipt.integrityHash;
  receipt.integrityHash = digest(receipt);
  writeFileSync(file, JSON.stringify(receipt));
};

test("issues a process-local terminal capability and revalidates retained produced evidence", async () => {
  const options = { ...(await nativeFixture()), execute: true, maxRequests: 1 };
  try {
    await runLocalCampaign({
      ...options,
      ownedProcess: (call) => {
        writeNativeIncompleteFixture(options, call.args);
        return settledOuter();
      },
    });
    const { capability, request } = await terminalCapability(options);
    expect(readCampaignTerminalEvidence(capability)).toMatchObject({
      authorEvidenceVerified: false,
      disposition: "produced",
      planAuthority: "caller-frozen",
      qualificationGranted: false,
      requestId: request.requestId,
      selectedEvidence: {
        artifacts: expect.arrayContaining([
          {
            name: "outlined.svg",
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          },
          {
            name: "filled.svg",
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          },
        ]),
        state: "retained-produced",
        treeHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      terminalStatus: "incomplete",
    });
    const copiedCapability = JSON.parse(`{"kind":"${capability.kind}"}`);
    expect(() => readCampaignTerminalEvidence(copiedCapability)).toThrow(
      "not process-local authority"
    );
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("reports honest unstarted selected evidence absence", async () => {
  const options = {
    ...(await nativeFixture()),
    execute: false,
    maxRequests: 1,
  };
  try {
    const { capability } = await terminalCapability(options);
    expect(readCampaignTerminalEvidence(capability)).toMatchObject({
      deadlineAt: null,
      disposition: "unstarted",
      nativeAccountingStatus: "not-started",
      selectedEvidence: { state: "verified-absent" },
      terminalStatus: "unstarted",
    });
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("keeps rejected child bytes separate from selected evidence", async () => {
  const options = { ...(await nativeFixture()), execute: true, maxRequests: 1 };
  try {
    await runLocalCampaign({
      ...options,
      ownedProcess: (call) => {
        writeNativeIncompleteFixture(options, call.args);
        const requestFile = path.join(String(call.args.at(4)), "request.json");
        const terminal = JSON.parse(readFileSync(requestFile, "utf-8"));
        writeFileSync(
          requestFile,
          JSON.stringify({ ...terminal, qualityStatus: "unknown-quality" })
        );
        return settledOuter();
      },
    });
    const { capability } = await terminalCapability(options);
    expect(readCampaignTerminalEvidence(capability)).toMatchObject({
      disposition: "production-unknown",
      retainedFailureEvidence: {
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        state: "retained-rejected-child",
      },
      selectedEvidence: { state: "verified-absent" },
      terminalStatus: "refused",
    });
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test.each([
  "selected-tree",
  "selected-symlink",
  "missing-paint",
  "unknown-accounting",
  "late-parent",
  "wrong-deadline",
  "wrong-route",
  "duplicate-slot-alias",
] as const)(
  "revalidation refuses %s tampering after capability issuance",
  async (fault) => {
    const options = {
      ...(await nativeFixture()),
      execute: true,
      maxRequests: 1,
    };
    try {
      await runLocalCampaign({
        ...options,
        ownedProcess: (call) => {
          writeNativeIncompleteFixture(options, call.args);
          return settledOuter();
        },
      });
      const { capability, plan, request } = await terminalCapability(options);
      if (fault === "selected-tree") {
        writeFileSync(
          path.join(request.destination, "attempt-1", "checks.json"),
          '{"changed":true}'
        );
      } else if (fault === "selected-symlink") {
        const attempt = path.join(request.destination, "attempt-1");
        unlinkSync(path.join(attempt, "filled.svg"));
        symlinkSync(
          path.join(attempt, "outlined.svg"),
          path.join(attempt, "filled.svg")
        );
      } else if (fault === "missing-paint") {
        unlinkSync(path.join(request.destination, "attempt-1", "filled.svg"));
      } else if (fault === "unknown-accounting") {
        const file = path.join(
          request.destination,
          "native-control",
          "calls",
          "fixture-call-1.terminal.json"
        );
        const terminal = JSON.parse(readFileSync(file, "utf-8"));
        writeFileSync(
          file,
          JSON.stringify({ ...terminal, accounting: "unknown" })
        );
      } else if (fault === "late-parent") {
        const file = path.join(
          options.out,
          "receipts",
          `${request.requestId}.json`
        );
        const intent = JSON.parse(readFileSync(intentFile(request), "utf-8"));
        rewriteReceipt(file, (receipt) => {
          receipt.parentCompletedAt = intent.deadlineAt;
        });
      } else if (fault === "wrong-deadline") {
        const file = intentFile(request);
        const intent = JSON.parse(readFileSync(file, "utf-8"));
        writeFileSync(
          file,
          JSON.stringify({ ...intent, deadlineAt: intent.deadlineAt + 1 })
        );
      } else if (fault === "wrong-route") {
        const requestFile = path.join(request.destination, "request.json");
        const terminal = JSON.parse(readFileSync(requestFile, "utf-8"));
        const changed = { ...terminal, route: "wrong-route" };
        writeFileSync(requestFile, JSON.stringify(changed));
        const receiptFile = path.join(
          options.out,
          "receipts",
          `${request.requestId}.json`
        );
        rewriteReceipt(receiptFile, (receipt) => {
          receipt.requestFileHash = createHash("sha256")
            .update(JSON.stringify(changed))
            .digest("hex");
          receipt.terminal = changed;
        });
      } else {
        const [, duplicate] = plan.requests;
        if (!duplicate) {
          throw new Error("Fixture requires a second request");
        }
        duplicate.slotIds = [...request.slotIds];
      }
      expect(() => readCampaignTerminalEvidence(capability)).toThrow();
    } finally {
      rmSync(options.root, { force: true, recursive: true });
    }
  }
);

test.each(["directory", "dangling-symlink"] as const)(
  "refuses an orphaned %s at an otherwise unstarted request path",
  async (kind) => {
    const options = {
      ...(await nativeFixture()),
      execute: false,
      maxRequests: 1,
    };
    try {
      const plan = planLocalCampaign(options);
      const [request] = plan.requests;
      mkdirSync(path.dirname(request.destination), { recursive: true });
      if (kind === "directory") {
        mkdirSync(request.destination);
        writeFileSync(path.join(request.destination, "orphan.svg"), "orphan");
      } else {
        symlinkSync(
          path.join(options.root, "missing-destination"),
          request.destination
        );
      }
      await expect(
        verifyCampaignTerminalEvidence({
          expectedPlanHash: frozenCampaignPlanHash(plan),
          plan,
          receiptRoot: path.join(options.out, "receipts"),
          requestId: request.requestId,
        })
      ).rejects.toThrow();
    } finally {
      rmSync(options.root, { force: true, recursive: true });
    }
  }
);

test("refuses rejected child evidence relabeled as a delivered terminal", async () => {
  const options = { ...(await nativeFixture()), execute: true, maxRequests: 1 };
  try {
    await runLocalCampaign({
      ...options,
      ownedProcess: (call) => {
        writeNativeIncompleteFixture(options, call.args);
        const requestFile = path.join(String(call.args.at(4)), "request.json");
        const terminal = JSON.parse(readFileSync(requestFile, "utf-8"));
        writeFileSync(
          requestFile,
          JSON.stringify({ ...terminal, qualityStatus: "unknown-quality" })
        );
        return settledOuter();
      },
    });
    const { capability, request } = await terminalCapability(options);
    const receiptFile = path.join(
      options.out,
      "receipts",
      `${request.requestId}.json`
    );
    rewriteReceipt(receiptFile, (receipt) => {
      receipt.terminal = {
        ...(receipt.terminal as Record<string, unknown>),
        status: "delivered",
      };
    });
    expect(() => readCampaignTerminalEvidence(capability)).toThrow();
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("refuses wrong plan, request, and unsafe receipt-root identities", async () => {
  const options = { ...(await nativeFixture()), execute: true, maxRequests: 1 };
  try {
    await runLocalCampaign({
      ...options,
      ownedProcess: (call) => {
        writeNativeIncompleteFixture(options, call.args);
        return settledOuter();
      },
    });
    const plan = planLocalCampaign(options);
    const [request] = plan.requests;
    const planHash = frozenCampaignPlanHash(plan);
    await expect(
      verifyCampaignTerminalEvidence({
        expectedPlanHash: "0".repeat(64),
        plan,
        receiptRoot: path.join(options.out, "receipts"),
        requestId: request.requestId,
      })
    ).rejects.toThrow("plan identity");
    await expect(
      verifyCampaignTerminalEvidence({
        expectedPlanHash: planHash,
        plan,
        receiptRoot: path.join(options.out, "receipts"),
        requestId: "missing",
      })
    ).rejects.toThrow("not unique");
    const receipts = path.join(options.out, "receipts");
    const stored = path.join(options.out, "stored-receipts");
    renameSync(receipts, stored);
    symlinkSync(stored, receipts);
    await expect(
      verifyCampaignTerminalEvidence({
        expectedPlanHash: planHash,
        plan,
        receiptRoot: receipts,
        requestId: request.requestId,
      })
    ).rejects.toThrow("unsafe");
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("accepts a native early failure with an empty settled call journal", async () => {
  const options = { ...(await nativeFixture()), execute: true, maxRequests: 1 };
  try {
    const result = await runLocalCampaign({
      ...options,
      ownedProcess: (call) => {
        writeNativeIncompleteFixture(options, call.args, "none");
        return settledOuter();
      },
    });
    expect(executionResults(result)[0]).toMatchObject({
      nativeAccountingHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      terminal: { status: "incomplete" },
    });
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test.each([
  "missing-terminal",
  "unknown-settlement",
  "tampered-evidence",
  "reservation-substitution",
  "orphan-start",
  "duplicate-stage",
  "wrong-container-image",
] as const)("quarantines native incomplete output with %s", async (fault) => {
  const options = { ...(await nativeFixture()), execute: true, maxRequests: 1 };
  try {
    await expect(
      runLocalCampaign({
        ...options,
        ownedProcess: (call) => {
          writeNativeIncompleteFixture(options, call.args);
          const destination = String(call.args.at(4));
          const calls = path.join(destination, "native-control", "calls");
          if (fault === "missing-terminal") {
            unlinkSync(path.join(calls, "fixture-call-1.terminal.json"));
          } else if (fault === "unknown-settlement") {
            const file = path.join(calls, "fixture-call-1.terminal.json");
            const terminal = JSON.parse(readFileSync(file, "utf-8"));
            writeFileSync(
              file,
              JSON.stringify({ ...terminal, accounting: "unknown" })
            );
          } else if (fault === "tampered-evidence") {
            const terminal = JSON.parse(
              readFileSync(
                path.join(calls, "fixture-call-1.terminal.json"),
                "utf-8"
              )
            );
            writeFileSync(terminal.evidenceFile, '{"tampered":true}\n');
          } else if (fault === "reservation-substitution") {
            const file = path.join(calls, "reservation.json");
            const envelope = JSON.parse(readFileSync(file, "utf-8"));
            envelope.reservation.routeHash = "c".repeat(64);
            envelope.reservationHash = createHash("sha256")
              .update(JSON.stringify(envelope.reservation))
              .digest("hex");
            writeFileSync(file, JSON.stringify(envelope));
          } else if (fault === "orphan-start") {
            writeFileSync(
              path.join(calls, "orphan.started.json"),
              JSON.stringify({ intentHash: "d".repeat(64), startedAt: 1 })
            );
          } else if (fault === "duplicate-stage") {
            duplicateNativeStage(destination);
          } else {
            const file = path.join(
              destination,
              "native-control",
              "author",
              "00-construct",
              "container-identity.json"
            );
            const identity = JSON.parse(readFileSync(file, "utf-8"));
            writeFileSync(
              file,
              JSON.stringify({
                ...identity,
                image: `debian@sha256:${"f".repeat(64)}`,
              })
            );
          }
          return settledOuter();
        },
      })
    ).rejects.toThrow("unproven native accounting");
    const [request] = planLocalCampaign(options).requests;
    const receipt = JSON.parse(
      readFileSync(
        path.join(options.out, "receipts", `${request.requestId}.json`),
        "utf-8"
      )
    );
    expect(receipt).toMatchObject({
      artifacts: [],
      invalidChildOutputHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      nativeAccountingHash: null,
      nativeAccountingStatus: "unproven",
      outerRefusal: true,
      reason: expect.stringContaining("Invalid generator output"),
      terminal: { qualityStatus: "outer-refusal", status: "refused" },
    });
    expect(
      JSON.parse(readFileSync(path.join(options.out, "stopped.json"), "utf-8"))
    ).toMatchObject({
      reason: "unproven-native-accounting",
      requestId: request.requestId,
    });
    await expect(
      runLocalCampaign({ ...options, execute: false })
    ).rejects.toThrow("unproven native accounting");
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("resumes a malformed native child only after all calls settled", async () => {
  const options = { ...(await nativeFixture()), execute: true, maxRequests: 1 };
  try {
    const first = await runLocalCampaign({
      ...options,
      ownedProcess: (call) => {
        writeNativeIncompleteFixture(options, call.args);
        const file = path.join(String(call.args.at(4)), "request.json");
        const terminal = JSON.parse(readFileSync(file, "utf-8"));
        writeFileSync(
          file,
          JSON.stringify({ ...terminal, qualityStatus: "unknown-quality" })
        );
        return settledOuter();
      },
    });
    const [receipt] = executionResults(first);
    expect(receipt).toMatchObject({
      nativeAccountingHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      nativeAccountingStatus: "settled",
      outerRefusal: true,
    });
    const resumed = await runLocalCampaign({ ...options, execute: false });
    expect("scheduled" in resumed).toBe(true);
    expect(
      ("scheduled" in resumed ? resumed.scheduled : []).some(
        (request: { requestId: string }) =>
          request.requestId === receipt.requestId
      )
    ).toBe(false);
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("binds a pre-native zero-call refusal before allowing resume", async () => {
  const options = { ...(await nativeFixture()), execute: true, maxRequests: 1 };
  try {
    const first = await runLocalCampaign({
      ...options,
      ownedProcess: () => Promise.resolve(settledOuter()),
    });
    const [receipt] = executionResults(first);
    expect(receipt).toMatchObject({
      nativeAccountingHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      nativeAccountingStatus: "pre-native-zero-call",
      outerRefusal: true,
    });
    await expect(
      runLocalCampaign({ ...options, execute: false })
    ).resolves.toMatchObject({
      mode: "dry-run",
    });
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("rejects changed pre-native zero-call evidence on resume", async () => {
  const options = { ...(await nativeFixture()), execute: true, maxRequests: 1 };
  try {
    const first = await runLocalCampaign({
      ...options,
      ownedProcess: (call) => {
        const control = path.join(
          String(call.args.at(4)),
          "native-control",
          "calls"
        );
        mkdirSync(control, { recursive: true });
        writeFileSync(
          path.join(control, "preflight.json"),
          '{"state":"failed"}'
        );
        return Promise.resolve(settledOuter());
      },
    });
    expect(executionResults(first)[0]).toMatchObject({
      nativeAccountingStatus: "pre-native-zero-call",
    });
    const [request] = planLocalCampaign(options).requests;
    writeFileSync(
      path.join(
        request.destination,
        "native-control",
        "calls",
        "preflight.json"
      ),
      '{"state":"changed"}'
    );
    await expect(
      runLocalCampaign({ ...options, execute: false })
    ).rejects.toThrow("identity validation");
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("resume rejects changed evidence from a native incomplete attempt", async () => {
  const options = { ...(await nativeFixture()), execute: true, maxRequests: 1 };
  try {
    const first = await runLocalCampaign({
      ...options,
      ownedProcess: (call) => {
        writeNativeIncompleteFixture(options, call.args);
        return settledOuter();
      },
    });
    const [receipt] = executionResults(first);
    writeFileSync(
      path.join(receipt.terminal.selectedAttempt, "checks.json"),
      '{"status":"changed"}'
    );
    await expect(
      runLocalCampaign({ ...options, execute: false })
    ).rejects.toThrow("identity validation");
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test.each(["change", "delete", "add", "symlink"] as const)(
  "terminal capability rejects collector subtree mutation: %s",
  async (mutation) => {
    const options = {
      ...(await nativeFixture()),
      execute: true,
      maxRequests: 1,
    };
    try {
      const plan = planLocalCampaign(options);
      const [request] = plan.requests;
      const collector = path.join(
        request.destination,
        "native-control",
        "author",
        "00-construct",
        "collector-raw-answers.json"
      );
      await runLocalCampaign({
        ...options,
        ownedProcess: (call) => {
          writeNativeIncompleteFixture(options, call.args);
          writeFileSync(collector, '{"answers":"retained"}');
          return settledOuter();
        },
      });
      const capability = await verifyCampaignTerminalEvidence({
        expectedPlanHash: frozenCampaignPlanHash(plan),
        plan,
        receiptRoot: path.join(options.out, "receipts"),
        requestId: request.requestId,
      });
      expect(
        readCampaignTerminalEvidence(capability).authorEvidenceVerified
      ).toBe(false);
      if (mutation === "change") {
        writeFileSync(collector, '{"answers":"forged"}');
      } else if (mutation === "add") {
        writeFileSync(`${collector}.extra`, "unrecorded");
      } else {
        rmSync(collector);
        if (mutation === "symlink") {
          symlinkSync(
            path.join(path.dirname(collector), "container-settlement.json"),
            collector
          );
        }
      }
      expect(() => readCampaignTerminalEvidence(capability)).toThrow();
      await expect(
        runLocalCampaign({ ...options, execute: false })
      ).rejects.toThrow();
    } finally {
      rmSync(options.root, { force: true, recursive: true });
    }
  }
);

test("campaign retains and refuses a fabricated collector-sealed author claim", async () => {
  const options = { ...(await nativeFixture()), execute: true, maxRequests: 1 };
  try {
    const first = await runLocalCampaign({
      ...options,
      ownedProcess: (call) => {
        writeNativeIncompleteFixture(options, call.args);
        const selected = path.join(String(call.args.at(4)), "attempt-1");
        const programs = {
          filled: "filled fixture",
          outlined: "outlined fixture",
        };
        const proofs = { filled: "filled proof", outlined: "outlined proof" };
        for (const paint of ["outlined", "filled"] as const) {
          writeFileSync(path.join(selected, `${paint}.icon`), programs[paint]);
          writeFileSync(
            path.join(selected, `${paint}.proof.png`),
            proofs[paint]
          );
        }
        writeFileSync(
          path.join(selected, "structured-author.json"),
          JSON.stringify({
            authorEvidence: {
              status: "collector-sealed-requires-downstream-replay",
            },
            deadlineAt: Number(flag(call.args, "--deadline-at")),
            model: "gpt-6-astra",
            programHashes: Object.fromEntries(
              Object.entries(programs).map(([paint, bytes]) => [
                paint,
                createHash("sha256").update(bytes).digest("hex"),
              ])
            ),
            proofHashes: Object.fromEntries(
              Object.entries(proofs).map(([paint, bytes]) => [
                paint,
                createHash("sha256").update(bytes).digest("hex"),
              ])
            ),
          })
        );
        return settledOuter();
      },
    });
    const [receipt] = executionResults(first);
    expect(receipt.outerRefusal).toBe(true);
    expect(receipt.reason).toContain(
      "Structured author contributors are invalid"
    );
    expect(receipt.invalidChildOutputHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.artifacts).toEqual([]);
    const plan = planLocalCampaign(options);
    const capability = await verifyCampaignTerminalEvidence({
      expectedPlanHash: frozenCampaignPlanHash(plan),
      plan,
      receiptRoot: path.join(options.out, "receipts"),
      requestId: receipt.requestId,
    });
    expect(readCampaignTerminalEvidence(capability)).toMatchObject({
      authorEvidenceVerified: false,
      disposition: "production-unknown",
      retainedFailureEvidence: { state: "retained-rejected-child" },
    });
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("refuses before spawn when only the parent settlement reserve remains", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T00:00:00Z"));
  const options = { ...(await fixture()), execute: true, maxRequests: 1 };
  try {
    await expect(
      runLocalCampaign({
        ...options,
        spawn: (() => {
          throw new Error("interrupt after launch descriptor commit");
        }) as never,
      })
    ).rejects.toThrow("interrupt after launch descriptor commit");
    const [request] = planLocalCampaign(options).requests;
    // Fixture-only pre-dispatch state; no real child ran in the injected executor.
    rmSync(`${request.destination}.outer-start.json`);
    const intent = JSON.parse(readFileSync(intentFile(request), "utf-8"));
    vi.setSystemTime(intent.deadlineAt - 1000);
    let spawned = false;
    const result = await runLocalCampaign({
      ...options,
      spawn: (() => {
        spawned = true;
        return { status: 0 };
      }) as never,
    });
    expect(spawned).toBe(false);
    expect(result.dispatched).toBe(0);
    expect(executionResults(result)[0]).toMatchObject({
      outerRefusal: true,
      reason: "Parent settlement reserve exhausted before generator dispatch",
    });
  } finally {
    vi.useRealTimers();
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("rejects copied terminal output without echoed invocation identity", async () => {
  const options = { ...(await fixture()), execute: true, maxRequests: 1 };
  try {
    const plan = planLocalCampaign(options);
    mkdirSync(options.out);
    mkdirSync(path.join(options.out, "requests"));
    mkdirSync(path.join(options.out, "receipts"));
    writeFileSync(
      path.join(options.out, "campaign-lock.json"),
      JSON.stringify(plan)
    );
    const [request] = plan.requests;
    writeFileSync(
      intentFile(request),
      JSON.stringify(frozenIntent(plan, request))
    );
    mkdirSync(request.destination);
    writeFileSync(
      path.join(request.destination, "run.json"),
      JSON.stringify({
        authorCommand: plan.execution.authorCommand,
        concept: request.concept,
        requestedModel: plan.execution.authorModel,
        route: plan.execution.route,
      })
    );
    writeFileSync(
      path.join(request.destination, "request.json"),
      JSON.stringify({
        deadlineAt: JSON.parse(readFileSync(intentFile(request), "utf-8"))
          .deadlineAt,
        deadlineExceeded: false,
        elapsedMs: 12,
        master: String(request.master),
        maxWallMs: request.maxWallMs,
        nativeSize: request.master,
        qualityStatus: "construction-failed",
        route: plan.execution.route,
        status: "incomplete",
      })
    );
    await expect(runLocalCampaign(options)).rejects.toThrow(
      "Generator output identity mismatch"
    );
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("awaits owned generator settlement and records the parent deadline cap", async () => {
  const options = { ...(await fixture()), execute: true, maxRequests: 1 };
  try {
    const result = await runLocalCampaign({
      ...options,
      ownedProcess: async (call) => {
        expect(call.timeoutMs).toBeGreaterThan(0);
        expect(call.timeoutMs).toBeLessThan(
          Number(flag(call.args, "--max-wall-ms"))
        );
        await Promise.resolve();
        writeDeliveredFixture(options, call.args);
        return {
          code: 0,
          killed: false,
          quiescenceScope: "process-group-and-observed-descendants",
          quiescent: true,
          stderr: "",
          stdout: "",
        };
      },
    });
    expect(executionResults(result)[0]).toMatchObject({
      parentSettlement: { quiescent: true },
      terminal: { status: "delivered" },
    });
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("unsettled outer generator forbids artifact hashing, further dispatch and resume", async () => {
  const options = { ...(await fixture()), execute: true, maxRequests: 2 };
  let calls = 0;
  try {
    const result = await runLocalCampaign({
      ...options,
      ownedProcess: (call) => {
        calls += 1;
        writeDeliveredFixture(options, call.args);
        return Promise.resolve({
          code: 0,
          killed: false,
          quiescenceScope: "process-group-and-observed-descendants" as const,
          quiescent: false,
          stderr: "unsettled",
          stdout: "",
        });
      },
    });
    expect(calls).toBe(1);
    expect(executionResults(result)[0]).toMatchObject({
      artifacts: [],
      invalidChildOutputHash: null,
      invalidChildOutputPath: null,
      outerRefusal: true,
      parentSettlement: {
        quiescenceScope: "process-group-and-observed-descendants",
        quiescent: false,
      },
      terminal: { status: "refused" },
    });
    await expect(
      runLocalCampaign({ ...options, execute: false })
    ).rejects.toThrow("blocks campaign resume");
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("concurrent resume cannot start an active request before its output directory exists", async () => {
  const options = { ...(await fixture()), execute: true, maxRequests: 1 };
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  const first = runLocalCampaign({
    ...options,
    ownedProcess: async () => {
      calls += 1;
      entered.resolve();
      await release.promise;
      return {
        code: 1,
        killed: false,
        quiescenceScope: "process-group-and-observed-descendants" as const,
        quiescent: true,
        stderr: "",
        stdout: "",
      };
    },
  });
  try {
    await entered.promise;
    await expect(runLocalCampaign(options)).rejects.toThrow(
      "Unsettled outer dispatch"
    );
    expect(calls).toBe(1);
  } finally {
    release.resolve();
    await first;
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("late incomplete child output becomes an outer deadline refusal", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const options = { ...(await fixture()), execute: true, maxRequests: 1 };
  try {
    const result = await runLocalCampaign({
      ...options,
      ownedProcess: (call) => {
        writeDeliveredFixture(options, call.args);
        const file = path.join(String(call.args.at(4)), "request.json");
        const terminal = JSON.parse(readFileSync(file, "utf-8"));
        writeFileSync(
          file,
          JSON.stringify({ ...terminal, status: "incomplete" })
        );
        vi.setSystemTime(Number(flag(call.args, "--deadline-at")) + 1);
        return Promise.resolve({
          code: 1,
          killed: false,
          quiescenceScope: "process-group-and-observed-descendants" as const,
          quiescent: true,
          stderr: "",
          stdout: "",
        });
      },
    });
    expect(executionResults(result)[0]).toMatchObject({
      outerRefusal: true,
      reason: expect.stringContaining("original parent deadline"),
      terminal: { deadlineExceeded: true, status: "refused" },
    });
  } finally {
    vi.useRealTimers();
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("resume rejects a rehashed incomplete receipt settled after its deadline", async () => {
  const options = { ...(await fixture()), execute: true, maxRequests: 1 };
  try {
    const first = await runLocalCampaign({
      ...options,
      ownedProcess: (call) => {
        writeDeliveredFixture(options, call.args);
        const file = path.join(String(call.args.at(4)), "request.json");
        const terminal = JSON.parse(readFileSync(file, "utf-8"));
        writeFileSync(
          file,
          JSON.stringify({ ...terminal, status: "incomplete" })
        );
        return Promise.resolve({
          code: 1,
          killed: false,
          quiescenceScope: "process-group-and-observed-descendants" as const,
          quiescent: true,
          stderr: "",
          stdout: "",
        });
      },
    });
    const [result] = executionResults(first);
    const file = path.join(options.out, "receipts", `${result.requestId}.json`);
    const { integrityHash: ignored, ...receipt } = JSON.parse(
      readFileSync(file, "utf-8")
    );
    expect(ignored).toBeTypeOf("string");
    receipt.parentCompletedAt = receipt.terminal.deadlineAt + 1;
    writeFileSync(
      file,
      JSON.stringify({ ...receipt, integrityHash: digest(receipt) })
    );
    await expect(
      runLocalCampaign({ ...options, execute: false })
    ).rejects.toThrow("identity validation");
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("full launch closure binds indirect source and quarantines post-dispatch drift", async () => {
  const f = await fixture();
  try {
    const indirect = path.join(path.dirname(f.generator), "family-parts.ts");
    let calls = 0;
    const result = await runLocalCampaign({
      ...f,
      execute: true,
      spawn: ((_command, _args) => {
        calls += 1;
        writeFileSync(indirect, "// changed during execution\n");
        return { signal: null, status: 1, stderr: "", stdout: "" };
      }) as typeof spawnSync,
    });
    expect(calls).toBe(1);
    expect(JSON.stringify(result)).toContain(
      "Production source closure changed"
    );
    const plan = planLocalCampaign({ ...f, execute: false });
    const launch = JSON.parse(
      readFileSync(launchFile(plan.requests[0]), "utf-8")
    );
    expect(
      launch.descriptor.sourceFiles.some(
        (row: { file: string }) => row.file === indirect
      )
    ).toBe(true);
  } finally {
    rmSync(f.root, { force: true, recursive: true });
  }
});

const sharedPacketFixture = async () => {
  const options = await nativeFixture();
  const familyPacketsDirectory = path.join(options.root, "packets");
  mkdirSync(familyPacketsDirectory);
  for (const { concept } of DEVELOPMENT_FAMILIES) {
    const packet = createFamilyReferencePacket({
      concept,
      excludedFamilies: [],
      excludedSourceHashes: [],
      librarySet: "blode-icons",
      librarySourceHash: "a".repeat(64),
      sources: [
        {
          admissionRequested: false,
          intent: {
            evidence: "Test control",
            polarity: "body",
            treatment: "Reference only",
          },
          source: {
            finish: "filled",
            name: "box",
            provenance: {
              date: "2026-09-08",
              origin: "original",
              set: "blode-icons",
            },
            svg: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/></svg>',
          },
        },
      ],
    });
    writeFileSync(
      path.join(familyPacketsDirectory, `${concept}.json`),
      JSON.stringify(packet)
    );
  }
  return { ...options, familyPacketsDirectory };
};

test("freezes one shared packet across both masters and bounds ten native calls", async () => {
  const options = await sharedPacketFixture();
  try {
    const plan = planLocalCampaign(options);
    expect(plan.execution.route).toBe("shared-family-packet");
    expect(plan.execution.maximumNativeCallsPerRequest).toBe(10);
    expect(plan.requests).toHaveLength(40);
    expect(plan.requests[0].familyPacket).toEqual(
      plan.requests[1].familyPacket
    );
    const packetFile = plan.requests[0].familyPacket?.file;
    if (!packetFile) {
      throw new Error("Missing fixture packet");
    }
    writeFileSync(packetFile, `${readFileSync(packetFile, "utf-8")}\n`);
    const changed = planLocalCampaign(options);
    expect(changed.requests[0].requestId).not.toBe(plan.requests[0].requestId);
    expect(changed.requests[1].requestId).not.toBe(plan.requests[1].requestId);
    expect(changed.requests[2].requestId).toBe(plan.requests[2].requestId);
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test.each(["missing", "tampered", "wrong-concept", "symlink"])(
  "refuses %s shared packet before any dispatch",
  async (fault) => {
    const options = await sharedPacketFixture();
    const spawn = vi.fn();
    try {
      const file = path.join(
        options.familyPacketsDirectory,
        `${DEVELOPMENT_FAMILIES[0].concept}.json`
      );
      if (fault === "missing") {
        unlinkSync(file);
      } else if (fault === "tampered") {
        const packet = JSON.parse(readFileSync(file, "utf-8"));
        packet.packetHash = "0".repeat(64);
        writeFileSync(file, JSON.stringify(packet));
      } else if (fault === "wrong-concept") {
        writeFileSync(
          file,
          readFileSync(
            path.join(
              options.familyPacketsDirectory,
              `${DEVELOPMENT_FAMILIES[1].concept}.json`
            )
          )
        );
      } else {
        const bytes = readFileSync(file);
        unlinkSync(file);
        const other = path.join(options.root, "elsewhere.json");
        writeFileSync(other, bytes);
        symlinkSync(other, file);
      }
      await expect(
        runLocalCampaign({ ...options, execute: true, spawn: spawn as never })
      ).rejects.toThrow();
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      rmSync(options.root, { force: true, recursive: true });
    }
  }
);

test("dispatches the exact shared packet and refuses bytes changed in flight", async () => {
  const options = await sharedPacketFixture();
  try {
    const plan = planLocalCampaign(options);
    const spawn = vi.fn((_command: string, args: readonly string[]) => {
      const file = flag(args, "--family-packet");
      if (!file) {
        throw new Error("Missing dispatched packet");
      }
      expect(file).toBe(plan.requests[0].familyPacket?.file);
      const descriptor = JSON.parse(
        readFileSync(launchFile(plan.requests[0]), "utf-8")
      );
      expect(JSON.stringify(descriptor)).toContain(file);
      writeFileSync(file, `${readFileSync(file, "utf-8")}\n`);
      return { signal: null, status: 0, stderr: "", stdout: "" };
    });
    const result = await runLocalCampaign({
      ...options,
      execute: true,
      spawn: spawn as never,
    });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).toContain(
      "Family packet changed during generator execution"
    );
    expect(
      result.ledger.slots.filter(
        (slot: { status: string }) => slot.status === "pending"
      )
    ).toHaveLength(78);
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("reliability replay keeps six exact requests and refuses rehashed population drift", async () => {
  const options = await fixture();
  try {
    const frozen = createReliabilityReplayManifest({
      sources: [
        {
          id: "blode-icons",
          records: 20,
          treeHash: corpusTreeHash(options.library),
        },
      ],
    });
    writeFileSync(
      path.join(options.meaningsDirectory, "hammer-check.json"),
      JSON.stringify(["hammer-check", "hammer", "axe"])
    );
    writeFileSync(options.manifestFile, JSON.stringify(frozen));
    const plan = planLocalCampaign(options);
    expect(
      plan.requests.map(({ concept, master }) => `${concept}-${master}`)
    ).toEqual([
      "folder-lock-16",
      "hammer-check-16",
      "bell-pause-24",
      "folder-lock-24",
      "cloud-upload-24",
      "bicycle-16",
    ]);
    expect(plan.requests.flatMap(({ slotIds }) => slotIds)).toHaveLength(12);
    expect(
      plan.requests.every(({ maxWallMs }) => maxWallMs === 1_200_000)
    ).toBe(true);
    for (const mutate of [
      (value: typeof frozen) => {
        value.manifest.slots.pop();
      },
      (value: typeof frozen) => {
        value.manifest.requests =
          value.manifest.requests.toReversed() as unknown as typeof value.manifest.requests;
      },
      (value: typeof frozen) => {
        value.manifest.assumptions.deadlineMsPerConceptSizePair = 2_400_000;
      },
      (value: typeof frozen) => {
        value.manifest.population.historicalIntentSha256 = "a".repeat(64);
      },
    ]) {
      const changed = structuredClone(frozen);
      mutate(changed);
      changed.hash = digest(changed.manifest);
      writeFileSync(options.manifestFile, JSON.stringify(changed));
      expect(() => planLocalCampaign(options)).toThrow(
        "exact six frozen requests and twelve slots"
      );
    }
    const catalog = createCampaignManifest(
      "catalog",
      {
        sources: [
          {
            id: "blode-icons",
            records: 1,
            treeHash: corpusTreeHash(options.library),
          },
        ],
      },
      [{ set: "blode-icons", slug: "box" }]
    );
    writeFileSync(options.manifestFile, JSON.stringify(catalog));
    expect(() => planLocalCampaign(options)).toThrow(
      "catalog remains disabled"
    );
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("binds a replayed author leaf to the live parent capability without granting approval", async () => {
  const options = { ...(await nativeFixture()), execute: true, maxRequests: 1 };
  options.revisionFile = realpathSync(options.revisionFile);
  options.out = path.join(realpathSync(options.root), "campaign");
  const revision = {
    calibration: "unvalidated",
    compiler: STYLE_COMPILER,
    id: "campaign-render-binding",
    masters: { "16": specAt({ size: 16 }) },
    parts: [],
    policy: DEFAULT_POLICY,
    references: [],
    rubric: "Development fixture; no quality approval",
  };
  writeFileSync(options.revisionFile, JSON.stringify(revision));
  const style = selectStyle(createStyleRevision(revision), "16");
  // The leaf's real collector/trace rejection matrix is exercised by the structured
  // author tests. This join test isolates the parent binding, never live quality.
  const replay = vi
    .spyOn(structuredAuthor, "replayStructuredAuthorEvidence")
    .mockReturnValue({
      evidenceReceiptSha256s: ["a".repeat(64), "b".repeat(64), "c".repeat(64)],
      kind: "replayed-collector-sealed-author-lineage-v1",
      structuralReplayVerified: true,
    });
  let selected = "";
  try {
    const result = await runLocalCampaign({
      ...options,
      ownedProcess: async (call) => {
        writeNativeIncompleteFixture(options, call.args);
        selected = path.join(String(call.args.at(4)), "attempt-1");
        const deadlineAt = Number(flag(call.args, "--deadline-at"));
        const programHashes: Record<string, string> = {};
        const proofHashes: Record<string, string> = {};
        await Promise.all(
          ["outlined", "filled"].map(async (paint) => {
            const artifact = compileStyle(
              style,
              `icon box\nfinish ${paint}\nrect 4,4 8x8 r1`
            );
            const { program } = artifact;
            const { proof } = await opticalProof(artifact.svg, 16);
            writeFileSync(
              path.join(selected, `${paint}.artifact.json`),
              JSON.stringify(artifact)
            );
            writeFileSync(path.join(selected, `${paint}.svg`), artifact.svg);
            writeFileSync(path.join(selected, `${paint}.icon`), program);
            writeFileSync(path.join(selected, `${paint}.proof.png`), proof);
            programHashes[paint] = createHash("sha256")
              .update(program)
              .digest("hex");
            proofHashes[paint] = createHash("sha256")
              .update(proof)
              .digest("hex");
          })
        );
        writeFileSync(
          path.join(selected, "structured-author.json"),
          JSON.stringify({
            authorEvidence: {
              inspection: {
                collectorRequestId: "inspected-author",
                emittedModel: "gpt-6-astra",
                emittedSessionId: "inspection-session",
                intentHash: "d".repeat(64),
                lifecycleRequestSha256: "e".repeat(64),
                stageDeadlineAt: deadlineAt - 100,
                traceReceiptSha256: "b".repeat(64),
                traceSha256: "f".repeat(64),
              },
              status: "collector-sealed-requires-downstream-replay",
              verifiedForProduction: false,
            },
            completionDeadlineAt: deadlineAt - 50,
            deadlineAt,
            model: "gpt-6-astra",
            programHashes,
            proofHashes,
          })
        );
        return settledOuter();
      },
    });
    const [receipt] = executionResults(result);
    expect(receipt.outerRefusal).not.toBe(true);
    const plan = planLocalCampaign(options);
    await expect(
      verifyCampaignTerminalEvidence({
        expectedPlanHash: frozenCampaignPlanHash(plan),
        plan,
        receiptRoot: path.join(options.out, "receipts"),
        requestId: receipt.requestId,
      })
    ).rejects.toThrow("frozen style revision");
    const capability = await verifyCampaignTerminalEvidence({
      expectedPlanHash: frozenCampaignPlanHash(plan),
      plan,
      receiptRoot: path.join(options.out, "receipts"),
      requestId: receipt.requestId,
      revisionFile: options.revisionFile,
    });
    const report = readCampaignTerminalEvidence(capability);
    expect(replay).toHaveBeenCalled();
    expect(report).toMatchObject({
      authorEvidence: {
        authorId: "codex:gpt-6-astra",
        authorLineage: "gpt-6-astra",
        kind: "parent-replayed-author-inspection-v1",
        nativeRouteHash: options.nativeRouteHash,
      },
      authorEvidenceVerified: true,
      disposition: "produced",
      qualificationGranted: false,
    });
    if (report.selectedEvidence.state !== "retained-produced") {
      throw new Error("Expected retained selected evidence");
    }
    expect(report.authorEvidence?.selectedTreeSha256).toBe(
      report.selectedEvidence.treeHash
    );
    expect(report.authorEvidence?.paints.outlined.svgSha256).toBe(
      report.selectedEvidence.outlinedSha256
    );
    expect(() => readCampaignTerminalEvidence({ ...capability })).toThrow();
    writeFileSync(
      path.join(selected, "outlined.proof.png"),
      "changed inspected proof"
    );
    expect(() => readCampaignTerminalEvidence(capability)).toThrow();
  } finally {
    replay.mockRestore();
    rmSync(options.root, { force: true, recursive: true });
  }
});

const diagnosticCampaignFixture = async () => {
  const options = await sharedPacketFixture();
  const base = planLocalCampaign(options);
  const [request] = base.requests;
  const diagnosticFinalizationPlanFile = path.join(
    realpathSync(options.root),
    "diagnostic-plan.json"
  );
  const diagnostic = {
    campaignHash: base.campaignHash,
    expiresAt: Date.now() + 600_000,
    familyPacket: request.familyPacket,
    image: JSON.parse(readFileSync(options.runtimeFile, "utf-8")).image,
    kind: "iconsmith-finalization-interruption-plan-v1",
    maxWallMs: request.maxWallMs,
    planFile: diagnosticFinalizationPlanFile,
    qualification: false,
    revisionHash: base.revisionHash,
    routeHash: options.nativeRouteHash,
    schemaVersion: 1,
    target: {
      concept: request.concept,
      family: request.family,
      master: String(request.master),
      slotIds: request.slotIds,
    },
  };
  const bytes = JSON.stringify(diagnostic);
  writeFileSync(diagnosticFinalizationPlanFile, bytes);
  return {
    ...options,
    diagnosticFinalizationPlanFile,
    diagnosticFinalizationPlanSha256: createHash("sha256")
      .update(bytes)
      .digest("hex"),
  };
};

test("diagnostic campaign freezes one target and binds child arguments and launch bytes", async () => {
  const options = await diagnosticCampaignFixture();
  try {
    const plan = planLocalCampaign(options);
    const spawn = vi.fn((_command: string, args: readonly string[]) => {
      expect(flag(args, "--diagnostic-finalization-plan")).toBe(
        options.diagnosticFinalizationPlanFile
      );
      expect(flag(args, "--diagnostic-finalization-plan-sha256")).toBe(
        options.diagnosticFinalizationPlanSha256
      );
      expect(flag(args, "--campaign-hash")).toBe(plan.campaignHash);
      expect(flag(args, "--family")).toBe(plan.requests[0].family);
      expect(
        args.flatMap((arg, index) =>
          arg === "--slot-id" ? [args[index + 1]] : []
        )
      ).toEqual(plan.requests[0].slotIds);
      expect(readFileSync(launchFile(plan.requests[0]), "utf-8")).toContain(
        options.diagnosticFinalizationPlanFile
      );
      writeFileSync(
        options.diagnosticFinalizationPlanFile,
        `${readFileSync(options.diagnosticFinalizationPlanFile, "utf-8")}\n`
      );
      return { signal: null, status: 0, stderr: "", stdout: "" };
    });
    const result = await runLocalCampaign({
      ...options,
      execute: true,
      maxRequests: 1,
      spawn: spawn as never,
    });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).toContain(
      "Diagnostic finalization plan changed during generator execution"
    );
    await expect(
      runLocalCampaign({ ...options, execute: true, spawn: spawn as never })
    ).rejects.toThrow(/identity changed/u);
    expect(spawn).toHaveBeenCalledTimes(1);
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test.each(["campaignHash", "revisionHash", "routeHash"])(
  "diagnostic campaign refuses rehashed %s mismatch before dispatch",
  async (field) => {
    const options = await diagnosticCampaignFixture();
    try {
      const diagnostic = JSON.parse(
        readFileSync(options.diagnosticFinalizationPlanFile, "utf-8")
      );
      diagnostic[field] = "b".repeat(64);
      const bytes = JSON.stringify(diagnostic);
      writeFileSync(options.diagnosticFinalizationPlanFile, bytes);
      options.diagnosticFinalizationPlanSha256 = createHash("sha256")
        .update(bytes)
        .digest("hex");
      expect(() => planLocalCampaign(options)).toThrow(/frozen/u);
    } finally {
      rmSync(options.root, { force: true, recursive: true });
    }
  }
);

test("expired diagnostic can be read for replay but cannot dispatch", async () => {
  const options = await diagnosticCampaignFixture();
  try {
    const diagnostic = JSON.parse(
      readFileSync(options.diagnosticFinalizationPlanFile, "utf-8")
    );
    diagnostic.expiresAt = Date.now() - 1000;
    const bytes = JSON.stringify(diagnostic);
    writeFileSync(options.diagnosticFinalizationPlanFile, bytes);
    options.diagnosticFinalizationPlanSha256 = createHash("sha256")
      .update(bytes)
      .digest("hex");
    expect(planLocalCampaign(options).requests).toHaveLength(40);
    const spawn = vi.fn();
    await expect(
      runLocalCampaign({ ...options, execute: true, spawn: spawn as never })
    ).rejects.toThrow(/expired before dispatch/u);
    expect(spawn).not.toHaveBeenCalled();
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("diagnostic hook is absent from an unselected child and normal plan", async () => {
  const options = await diagnosticCampaignFixture();
  try {
    const diagnostic = JSON.parse(
      readFileSync(options.diagnosticFinalizationPlanFile, "utf-8")
    );
    diagnostic.target.master = "24";
    diagnostic.target.slotIds = diagnostic.target.slotIds.map((slot: string) =>
      slot.replace("/16/", "/24/")
    );
    const bytes = JSON.stringify(diagnostic);
    writeFileSync(options.diagnosticFinalizationPlanFile, bytes);
    options.diagnosticFinalizationPlanSha256 = createHash("sha256")
      .update(bytes)
      .digest("hex");
    const spawn = vi.fn((_command: string, args: readonly string[]) => {
      expect(args).not.toContain("--diagnostic-finalization-plan");
      expect(args).not.toContain("--campaign-hash");
      expect(args).not.toContain("--slot-id");
      return { signal: null, status: 1, stderr: "fixture refusal", stdout: "" };
    });
    await runLocalCampaign({
      ...options,
      execute: true,
      maxRequests: 1,
      spawn: spawn as never,
    });
    expect(spawn).toHaveBeenCalledTimes(1);
    const normal = planLocalCampaign({
      ...options,
      diagnosticFinalizationPlanFile: undefined,
      diagnosticFinalizationPlanSha256: undefined,
    });
    expect(normal.execution).not.toHaveProperty("diagnosticFinalization");
    expect(() =>
      planLocalCampaign({
        ...options,
        diagnosticFinalizationPlanSha256: undefined,
      })
    ).toThrow(/paired/u);
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("diagnostic expiry beyond original request clock refuses before launch intent", async () => {
  const options = await diagnosticCampaignFixture();
  try {
    const diagnostic = JSON.parse(
      readFileSync(options.diagnosticFinalizationPlanFile, "utf-8")
    );
    diagnostic.expiresAt = Date.now() + 2_400_000;
    const bytes = JSON.stringify(diagnostic);
    writeFileSync(options.diagnosticFinalizationPlanFile, bytes);
    options.diagnosticFinalizationPlanSha256 = createHash("sha256")
      .update(bytes)
      .digest("hex");
    const plan = planLocalCampaign(options);
    const spawn = vi.fn();
    await expect(
      runLocalCampaign({ ...options, execute: true, spawn: spawn as never })
    ).rejects.toThrow(/exceeds the original/u);
    expect(spawn).not.toHaveBeenCalled();
    expect(() => readFileSync(intentFile(plan.requests[0]))).toThrow();
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

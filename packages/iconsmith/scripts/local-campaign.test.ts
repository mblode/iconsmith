import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import { createCampaignManifest } from "./campaign-manifest.js";
import {
  corpusTreeHash,
  intentFile,
  requestIntent,
  planLocalCampaign,
  productionToolingIdentity,
  runLocalCampaign,
} from "./local-campaign.js";
import { DEVELOPMENT_FAMILIES } from "./quality-population.js";
import { captureRuntimeIdentity } from "./runtime-identity.js";

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

const dryRun = (result: ReturnType<typeof runLocalCampaign>) => {
  if (!("requests" in result)) {
    throw new Error("Expected a dry-run result");
  }
  return result;
};

const executionResults = (result: ReturnType<typeof runLocalCampaign>) => {
  if (!result.results) {
    throw new Error("Expected execution results");
  }
  return result.results;
};

test("dry-run freezes all 40 pair requests and bounds the scheduled batch", async () => {
  const options = await fixture();
  try {
    const result = dryRun(runLocalCampaign(options));
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
    const { symlinkSync } = await import("node:fs");
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
  const spawn = (_command: string, args: readonly string[]) => {
    calls += 1;
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
        deadlineAt: Date.now() + 1000,
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
    const first = runLocalCampaign({ ...options, spawn: spawn as never });
    const [firstResult] = executionResults(first);
    expect(first).toMatchObject({ dispatched: 1 });
    expect(firstResult).toMatchObject({
      aiQualified: false,
      skipped: false,
      terminal: { status: "incomplete" },
    });
    const second = runLocalCampaign({
      ...options,
      maxRequests: 2,
      spawn: spawn as never,
    });
    const [secondResult] = executionResults(second);
    expect(second).toMatchObject({ dispatched: 2 });
    expect(secondResult).toMatchObject({ skipped: true });
    expect(calls).toBe(3);
    expect(second.ledger.slots).toHaveLength(80);
    expect(
      second.ledger.slots.filter(({ status }) => status === "pending")
    ).toHaveLength(74);
    const [firstReceipt] = executionResults(first);
    const resumedDryRun = dryRun(
      runLocalCampaign({ ...options, execute: false, maxRequests: 1 })
    );
    expect(resumedDryRun.scheduled).toHaveLength(1);
    expect(resumedDryRun.scheduled[0].requestId).not.toBe(
      firstReceipt.requestId
    );
    writeFileSync(
      path.join(options.out, "receipts", `${firstReceipt.requestId}.json`),
      JSON.stringify({ ...firstReceipt, requestFileHash: "b".repeat(64) })
    );
    expect(() =>
      runLocalCampaign({ ...options, spawn: spawn as never })
    ).toThrow("identity validation");
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
    expect(() => runLocalCampaign(options)).toThrow(
      "Unknown attempt blocks automatic charging"
    );
    expect(() => runLocalCampaign({ ...options, execute: true })).toThrow(
      "Unknown attempt blocks automatic charging"
    );
    const [request] = plan.requests;
    writeFileSync(
      intentFile(request),
      JSON.stringify(requestIntent(plan, request))
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
    expect(() => runLocalCampaign(options)).toThrow(
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
    expect(() =>
      runLocalCampaign({
        ...options,
        spawn: (() => {
          dispatched = true;
          return { status: 1 };
        }) as never,
      })
    ).toThrow("structurally incomplete");
    expect(dispatched).toBe(false);
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

test("recovers a terminal result and resumes it idempotently", async () => {
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
      JSON.stringify(requestIntent(plan, request))
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
        deadlineAt: Date.now() + request.maxWallMs,
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
    const preview = dryRun(runLocalCampaign({ ...options, execute: false }));
    expect(preview.scheduled.map(({ requestId }) => requestId)).not.toContain(
      request.requestId
    );
    expect(
      preview.ledger.slots.filter(
        ({ requestId }) => requestId === request.requestId
      )
    ).toMatchObject([
      { status: "pending-independent-review" },
      { status: "pending-independent-review" },
    ]);
    let charged = 0;
    const recovered = runLocalCampaign({
      ...options,
      spawn: ((_command: string, args: readonly string[]) => {
        charged += 1;
        const destination = String(args.at(4));
        mkdirSync(destination);
        writeFileSync(
          path.join(destination, "run.json"),
          JSON.stringify({
            authorCommand: plan.execution.authorCommand,
            concept: args.at(3),
            requestId: flag(args, "--request-id"),
            requestedModel: plan.execution.authorModel,
            route: plan.execution.route,
            runtimeHash: JSON.parse(readFileSync(options.runtimeFile, "utf-8"))
              .hash,
            toolingHash: flag(args, "--tooling-hash"),
          })
        );
        writeFileSync(
          path.join(destination, "request.json"),
          JSON.stringify({
            deadlineAt: Date.now() + Number(flag(args, "--max-wall-ms")),
            deadlineExceeded: false,
            elapsedMs: 1,
            master: flag(args, "--master"),
            maxWallMs: Number(flag(args, "--max-wall-ms")),
            nativeSize: Number(flag(args, "--master")),
            qualityStatus: "construction-failed",
            requestId: flag(args, "--request-id"),
            route: plan.execution.route,
            runtimeHash: JSON.parse(readFileSync(options.runtimeFile, "utf-8"))
              .hash,
            status: "incomplete",
            toolingHash: flag(args, "--tooling-hash"),
          })
        );
        return { status: 1 };
      }) as never,
    });
    expect(executionResults(recovered)[0]).toMatchObject({
      recoveredAfterInterruption: true,
      skipped: true,
    });
    expect(recovered.dispatched).toBe(39);
    expect(charged).toBe(39);
    const recoveredReceiptFile = path.join(
      options.out,
      "receipts",
      `${request.requestId}.json`
    );
    const recoveredReceipt = readFileSync(recoveredReceiptFile, "utf-8");
    const secondResume = runLocalCampaign({
      ...options,
      spawn: (() => {
        charged += 1;
        throw new Error("A complete resume must not spawn");
      }) as never,
    });
    expect(secondResume.dispatched).toBe(0);
    expect(charged).toBe(39);
    expect(readFileSync(recoveredReceiptFile, "utf-8")).toBe(recoveredReceipt);
  } finally {
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
      JSON.stringify(requestIntent(plan, request))
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
        deadlineAt: Date.now() + request.maxWallMs,
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
    expect(() => runLocalCampaign(options)).toThrow(
      "Generator output identity mismatch"
    );
  } finally {
    rmSync(options.root, { force: true, recursive: true });
  }
});

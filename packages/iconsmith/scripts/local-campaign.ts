/** Bounded local campaign driver around the canonical local-generate entrypoint. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { writeCampaignEvidence } from "./campaign-evidence.js";
import { verifyRuntimeIdentity } from "./runtime-identity.js";

const sha = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) {
    return `[${v.map(canonical).join(",")}]`;
  }
  if (v && typeof v === "object") {
    return `{${Object.entries(v)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
};
interface Frozen {
  hash: string;
  manifest: {
    assumptions: { deadlineMsPerConceptSizePair: number };
    concepts: { concept: string; family: string }[];
    kind: "catalog" | "development";
    slots: {
      concept: string;
      family: string;
      finish: "filled" | "outlined";
      nativeSize: 16 | 24;
      slotId: string;
    }[];
    source: { id: string; treeHash: string };
  };
}
interface Options {
  authorCommand?: string;
  authorModel?: string;
  concurrency: number;
  execute: boolean;
  generator: string;
  library: string;
  manifestFile: string;
  maxRequests: number;
  meaningsDirectory: string;
  out: string;
  revisionFile: string;
  runtimeFile: string;
  verifyRuntime?: typeof verifyRuntimeIdentity;
  spawn?: typeof spawnSync;
}
const TOOL_FILES = [
  "family-parts.ts",
  "family-reference-packet.ts",
  "local-author-context.ts",
  "local-generate.ts",
  "local-retrieval.ts",
  "local-review.ts",
  "local-runtime.ts",
  "local-style-run.ts",
  "reference-proofs.ts",
];
/** Matches corpus/build.ts: sha256(sorted `relativePath\0fileHash` lines). */
export const corpusTreeHash = (dir: string) =>
  sha(
    readdirSync(dir)
      .filter((n) => /^[a-z][a-z0-9-]*\.svg$/u.test(n))
      .map(
        (n) =>
          `${path.basename(dir)}/${n}\0${sha(readFileSync(path.join(dir, n)))}`
      )
      .toSorted()
      .join("\n")
  );
const productionFiles = (root: string, relative = ""): string[] =>
  readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(
    (entry) => {
      const name = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === ".corpus" ||
          (relative === "" && entry.name === "corpus")
        ) {
          return [];
        }
        return productionFiles(root, name);
      }
      return /\.(?:json|md|ts)$/u.test(name) && !name.endsWith(".test.ts")
        ? [name]
        : [];
    }
  );

export const productionToolingIdentity = (generator: string) => {
  const packageRoot = path.dirname(path.dirname(generator));
  const files = [
    ...productionFiles(packageRoot),
    ...TOOL_FILES.map((name) => `scripts/${name}`),
    path.relative(
      packageRoot,
      path.resolve(packageRoot, "../../package-lock.json")
    ),
  ]
    .filter((name, index, all) => all.indexOf(name) === index)
    .toSorted()
    .map((name) => ({
      name,
      sha256: sha(readFileSync(path.join(packageRoot, name))),
    }));
  return { files, hash: sha(canonical(files)) };
};
// Terminal validation deliberately centralizes all status-dependent invariants.
// eslint-disable-next-line complexity
const isTerminal = (v: unknown, request?: Request) => {
  if (!v || typeof v !== "object") {
    return false;
  }
  const x = v as Record<string, unknown>;
  const base =
    typeof x.status === "string" &&
    ["delivered", "incomplete", "refused"].includes(x.status) &&
    typeof x.deadlineExceeded === "boolean" &&
    typeof x.elapsedMs === "number" &&
    Number.isFinite(x.elapsedMs) &&
    x.elapsedMs >= 0 &&
    (x.actualUsd === undefined ||
      x.actualUsd === null ||
      (typeof x.actualUsd === "number" &&
        Number.isFinite(x.actualUsd) &&
        x.actualUsd >= 0));
  if (!base) {
    return false;
  }
  const elapsedMs = x.elapsedMs as number;
  if (!request) {
    return true;
  }
  // Failed generators intentionally emit a smaller terminal receipt. They are
  // never eligible for acceptance and remain durable for failure accounting.
  if (x.status !== "delivered") {
    return true;
  }
  if (
    typeof x.deadlineAt !== "number" ||
    !Number.isFinite(x.deadlineAt) ||
    typeof x.maxWallMs !== "number" ||
    x.maxWallMs !== request.maxWallMs ||
    typeof x.qualityStatus !== "string" ||
    (x.deadlineExceeded === false && elapsedMs >= request.maxWallMs) ||
    (x.deadlineExceeded === true && x.qualityStatus !== "deadline-exhausted")
  ) {
    return false;
  }
  return (
    typeof x.selectedAttempt === "string" &&
    [
      "review-clear",
      "review-uncertain",
      "review-incomplete",
      "needs-repair",
      "representation-blocked",
      "deadline-exhausted",
      "not-reviewed",
    ].includes(x.qualityStatus)
  );
};
export const planLocalCampaign = (o: Options) => {
  if (!Number.isInteger(o.maxRequests) || o.maxRequests < 1) {
    throw new Error("--max-requests must be a positive integer");
  }
  if (o.concurrency !== 1) {
    throw new Error("Local campaigns are sequential; --concurrency must be 1");
  }
  const frozen = JSON.parse(readFileSync(o.manifestFile, "utf-8")) as Frozen;
  if (sha(canonical(frozen.manifest)) !== frozen.hash) {
    throw new Error("Frozen campaign manifest changed");
  }
  if (frozen.manifest.kind !== "development") {
    throw new Error(
      "This driver currently accepts the development campaign only"
    );
  }
  if (
    frozen.manifest.concepts.length !== 20 ||
    new Set(frozen.manifest.concepts.map(({ concept }) => concept)).size !==
      20 ||
    new Set(frozen.manifest.concepts.map(({ family }) => family)).size !== 20 ||
    frozen.manifest.slots.length !== 80 ||
    new Set(frozen.manifest.slots.map(({ slotId }) => slotId)).size !== 80
  ) {
    throw new Error(
      "Development campaign must contain 20 unique families and 80 unique slots"
    );
  }
  if (frozen.manifest.source.id !== "blode-icons") {
    throw new Error("Development campaign must pin blode-icons");
  }
  const libraryHash = corpusTreeHash(o.library);
  if (libraryHash !== frozen.manifest.source.treeHash) {
    throw new Error("Library tree does not match frozen campaign source");
  }
  const revisionHash = sha(readFileSync(o.revisionFile));
  const tool = productionToolingIdentity(o.generator);
  const runtime = JSON.parse(readFileSync(o.runtimeFile, "utf-8"));
  (o.verifyRuntime ?? verifyRuntimeIdentity)(runtime);
  const execution = {
    authorCommand:
      o.authorCommand ?? "/Applications/ChatGPT.app/Contents/Resources/codex",
    authorModel: o.authorModel ?? "gpt-6-astra",
    authorReasoningEffort: "high",
    generator: path.resolve(o.generator),
    reviewerCommand: "claude",
    route: "automatic-retrieval",
    runtimeFile: path.resolve(o.runtimeFile),
    runtimeHash: runtime.hash,
    toolingHash: tool.hash,
  };
  if (
    runtime.manifest.author.command !== execution.authorCommand ||
    runtime.manifest.reviewer.command !== execution.reviewerCommand
  ) {
    throw new Error("Runtime commands do not match frozen campaign route");
  }
  const requests = frozen.manifest.concepts.flatMap(({ concept, family }) =>
    ([16, 24] as const).map((master) => {
      const slots = frozen.manifest.slots.filter(
        (s) =>
          s.concept === concept &&
          s.family === family &&
          s.nativeSize === master
      );
      if (
        slots.length !== 2 ||
        new Set(slots.map((s) => s.finish)).size !== 2
      ) {
        throw new Error(`Campaign pair is incomplete: ${family}/${master}`);
      }
      const meaningsFile = path.join(o.meaningsDirectory, `${concept}.json`);
      const bytes = readFileSync(meaningsFile);
      const meanings = JSON.parse(bytes.toString()) as unknown;
      if (
        !Array.isArray(meanings) ||
        !meanings.includes(concept) ||
        meanings.length < 3 ||
        meanings.length > 12
      ) {
        throw new Error(`Invalid frozen meanings: ${concept}`);
      }
      const meaningsHash = sha(bytes);
      const requestId = sha(
        canonical({
          campaignHash: frozen.hash,
          concept,
          execution,
          libraryHash,
          master,
          meaningsHash,
          revisionHash,
        })
      );
      return {
        concept,
        destination: path.join(o.out, "requests", `${concept}-${master}`),
        family,
        master,
        maxWallMs: frozen.manifest.assumptions.deadlineMsPerConceptSizePair,
        meaningsFile,
        meaningsHash,
        requestId,
        slotIds: slots.map((s) => s.slotId),
      };
    })
  );
  return {
    aiQualification: "pending",
    campaignHash: frozen.hash,
    execution,
    libraryHash,
    manifestFile: path.resolve(o.manifestFile),
    qualificationAuthority: "ai-only",
    requests,
    revisionHash,
    tooling: tool,
  };
};
type Plan = ReturnType<typeof planLocalCampaign>;
type Request = Plan["requests"][number];
export const intentFile = (request: Request) =>
  `${request.destination}.intent.json`;
export const requestIntent = (plan: Plan, request: Request) => ({
  campaignHash: plan.campaignHash,
  execution: plan.execution,
  libraryHash: plan.libraryHash,
  request,
  revisionHash: plan.revisionHash,
});
const validateIntent = (plan: Plan, request: Request) => {
  const file = intentFile(request);
  if (
    !existsSync(file) ||
    canonical(JSON.parse(readFileSync(file, "utf-8"))) !==
      canonical(requestIntent(plan, request))
  ) {
    throw new Error(`Request intent identity mismatch: ${request.requestId}`);
  }
};
const validateOutput = (
  plan: Plan,
  request: Request,
  terminal: Record<string, unknown>
) => {
  const runFile = path.join(request.destination, "run.json");
  if (!existsSync(runFile)) {
    throw new Error(`Missing run identity: ${request.requestId}`);
  }
  const run = JSON.parse(readFileSync(runFile, "utf-8"));
  if (
    run.concept !== request.concept ||
    run.route !== plan.execution.route ||
    run.authorCommand !== plan.execution.authorCommand ||
    run.requestedModel !== plan.execution.authorModel ||
    run.requestId !== request.requestId ||
    run.toolingHash !== plan.execution.toolingHash ||
    run.runtimeHash !== plan.execution.runtimeHash ||
    terminal.master !== String(request.master) ||
    terminal.nativeSize !== request.master ||
    terminal.route !== plan.execution.route ||
    terminal.requestId !== request.requestId ||
    terminal.toolingHash !== plan.execution.toolingHash ||
    terminal.runtimeHash !== plan.execution.runtimeHash
  ) {
    throw new Error(`Generator output identity mismatch: ${request.requestId}`);
  }
  if (terminal.status !== "delivered") {
    return [];
  }
  if (typeof terminal.selectedAttempt !== "string") {
    throw new TypeError(
      `Delivered output has no selected attempt: ${request.requestId}`
    );
  }
  const selected = realpathSync(path.resolve(terminal.selectedAttempt));
  const destination = realpathSync(path.resolve(request.destination));
  const relative = path.relative(destination, selected);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Selected attempt escaped request directory: ${request.requestId}`
    );
  }
  return (["outlined.svg", "filled.svg"] as const).map((name) => {
    const file = path.join(selected, name);
    if (!existsSync(file)) {
      throw new Error(`Delivered artifact missing: ${name}`);
    }
    const artifactRelative = path.relative(destination, realpathSync(file));
    if (
      artifactRelative.startsWith("..") ||
      path.isAbsolute(artifactRelative)
    ) {
      throw new Error(`Delivered artifact escaped request directory: ${name}`);
    }
    return { name, sha256: sha(readFileSync(file)) };
  });
};
const loadReceipt = (plan: Plan, request: Request, out: string) => {
  const file = path.join(out, "receipts", `${request.requestId}.json`);
  if (!existsSync(file)) {
    return null;
  }
  validateIntent(plan, request);
  const receipt = JSON.parse(readFileSync(file, "utf-8"));
  const requestFile = path.join(request.destination, "request.json");
  const terminal = existsSync(requestFile)
    ? JSON.parse(readFileSync(requestFile, "utf-8"))
    : null;
  const artifacts = terminal ? validateOutput(plan, request, terminal) : [];
  if (
    receipt.campaignHash !== plan.campaignHash ||
    receipt.requestId !== request.requestId ||
    !existsSync(requestFile) ||
    sha(readFileSync(requestFile)) !== receipt.requestFileHash ||
    !isTerminal(receipt.terminal, request) ||
    canonical(receipt.terminal) !== canonical(terminal) ||
    canonical(receipt.artifacts) !== canonical(artifacts)
  ) {
    throw new Error(
      `Saved terminal receipt failed identity validation: ${request.requestId}`
    );
  }
  return receipt;
};
const inspectPrior = (plan: Plan, request: Request, out: string) => {
  const receipt = loadReceipt(plan, request, out);
  if (receipt || !existsSync(request.destination)) {
    return receipt;
  }
  if (!existsSync(intentFile(request))) {
    throw new Error(
      `Unknown attempt blocks automatic charging: ${request.requestId}`
    );
  }
  validateIntent(plan, request);
  const requestFile = path.join(request.destination, "request.json");
  if (!existsSync(requestFile)) {
    throw new Error(
      `Unknown attempt blocks automatic charging: ${request.requestId}`
    );
  }
  const bytes = readFileSync(requestFile);
  const terminal = JSON.parse(bytes.toString());
  if (!isTerminal(terminal, request)) {
    throw new Error(
      `Unknown attempt blocks automatic charging: ${request.requestId}`
    );
  }
  return {
    aiQualified: false,
    artifacts: validateOutput(plan, request, terminal),
    campaignHash: plan.campaignHash,
    childExitCode: null,
    recoveredAfterInterruption: true,
    requestFileHash: sha(bytes),
    requestId: request.requestId,
    slotIds: request.slotIds,
    terminal,
  };
};
const makeLedger = (frozen: Frozen, plan: Plan, out: string) => ({
  aiQualified: false,
  campaignHash: plan.campaignHash,
  slots: frozen.manifest.slots.map((slot) => {
    const request = plan.requests.find((r) => r.slotIds.includes(slot.slotId));
    if (!request) {
      throw new Error(`Missing request for slot: ${slot.slotId}`);
    }
    const receipt = inspectPrior(plan, request, out);
    let status = "pending";
    if (receipt?.terminal.deadlineExceeded) {
      status = "deadline-exhausted";
    } else if (receipt?.terminal.status === "refused") {
      status = "refused";
    } else if (
      receipt?.terminal.status === "delivered" &&
      receipt.terminal.qualityStatus === "review-clear"
    ) {
      status = "pending-independent-review";
    } else if (receipt?.terminal.status === "delivered") {
      status = "construction-failed";
    } else if (receipt) {
      status = "delivery-incomplete";
    }
    return {
      actualUsd: receipt?.terminal.actualUsd ?? null,
      elapsedMs: receipt?.terminal.elapsedMs ?? null,
      requestId: request.requestId,
      slotId: slot.slotId,
      status,
    };
  }),
});
export const runLocalCampaign = (o: Options) => {
  const plan = planLocalCampaign(o);
  const frozen = JSON.parse(readFileSync(o.manifestFile, "utf-8")) as Frozen;
  const lock = path.join(o.out, "campaign-lock.json");
  if (existsSync(o.out)) {
    if (!existsSync(lock)) {
      throw new Error("Existing campaign directory has no immutable lock");
    }
    if (
      canonical(JSON.parse(readFileSync(lock, "utf-8"))) !== canonical(plan)
    ) {
      throw new Error("Campaign inputs changed since the immutable lock");
    }
    if (
      !existsSync(path.join(o.out, "requests")) ||
      !statSync(path.join(o.out, "requests")).isDirectory() ||
      !existsSync(path.join(o.out, "receipts")) ||
      !statSync(path.join(o.out, "receipts")).isDirectory()
    ) {
      throw new Error("Existing campaign directory is structurally incomplete");
    }
  }
  if (!o.execute) {
    const pending = plan.requests.filter(
      (request) => !inspectPrior(plan, request, o.out)
    );
    return {
      ...plan,
      concurrency: 1,
      ledger: makeLedger(frozen, plan, o.out),
      maxRequests: o.maxRequests,
      mode: "dry-run",
      scheduled: pending.slice(0, o.maxRequests),
    };
  }
  if (!existsSync(o.out)) {
    mkdirSync(o.out);
    mkdirSync(path.join(o.out, "requests"));
    mkdirSync(path.join(o.out, "receipts"));
    writeFileSync(lock, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
  }
  const spawn = o.spawn ?? spawnSync;
  const results = [];
  let dispatched = 0;
  for (const request of plan.requests) {
    const prior = inspectPrior(plan, request, o.out);
    if (prior) {
      const receiptFile = path.join(
        o.out,
        "receipts",
        `${request.requestId}.json`
      );
      if (prior.recoveredAfterInterruption && !existsSync(receiptFile)) {
        writeFileSync(receiptFile, `${JSON.stringify(prior, null, 2)}\n`, {
          flag: "wx",
        });
      }
      results.push({ ...prior, skipped: true });
      continue;
    }
    if (dispatched >= o.maxRequests) {
      continue;
    }
    if (canonical(planLocalCampaign(o)) !== canonical(plan)) {
      throw new Error("Campaign inputs changed before dispatch");
    }
    dispatched += 1;
    const expectedIntent = requestIntent(plan, request);
    const intent = intentFile(request);
    if (existsSync(intent)) {
      validateIntent(plan, request);
    } else {
      writeFileSync(intent, `${JSON.stringify(expectedIntent, null, 2)}\n`, {
        flag: "wx",
      });
    }
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        o.generator,
        request.concept,
        request.destination,
        "--revision",
        o.revisionFile,
        "--master",
        String(request.master),
        "--meanings",
        request.meaningsFile,
        "--library",
        o.library,
        "--library-set",
        "blode-icons",
        "--max-wall-ms",
        String(request.maxWallMs),
        "--codex",
        plan.execution.authorCommand,
        "--model",
        plan.execution.authorModel,
        "--runtime-manifest",
        plan.execution.runtimeFile,
        "--request-id",
        request.requestId,
        "--tooling-hash",
        plan.execution.toolingHash,
      ],
      { encoding: "utf-8" }
    );
    const requestFile = path.join(request.destination, "request.json");
    if (!existsSync(requestFile)) {
      throw new Error(
        `Generator returned without a terminal receipt: ${request.requestId}`
      );
    }
    const bytes = readFileSync(requestFile);
    const terminal = JSON.parse(bytes.toString());
    if (!isTerminal(terminal, request)) {
      throw new Error(
        `Generator receipt is not terminal: ${request.requestId}`
      );
    }
    const artifacts = validateOutput(plan, request, terminal);
    const receipt = {
      aiQualified: false,
      artifacts,
      campaignHash: plan.campaignHash,
      childExitCode: child.status,
      requestFileHash: sha(bytes),
      requestId: request.requestId,
      slotIds: request.slotIds,
      terminal,
    };
    writeFileSync(
      path.join(o.out, "receipts", `${request.requestId}.json`),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { flag: "wx" }
    );
    results.push({ ...receipt, skipped: false });
  }
  const ledger = makeLedger(frozen, plan, o.out);
  writeFileSync(
    path.join(o.out, "campaign-ledger.json"),
    `${JSON.stringify(ledger, null, 2)}\n`
  );
  return { campaignHash: plan.campaignHash, dispatched, ledger, results };
};
if (process.argv[1] === import.meta.filename) {
  const { values } = parseArgs({
    options: {
      "author-command": { type: "string" },
      "author-model": { type: "string" },
      concurrency: { type: "string" },
      execute: { default: false, type: "boolean" },
      generator: { type: "string" },
      library: { type: "string" },
      manifest: { type: "string" },
      "max-requests": { type: "string" },
      meanings: { type: "string" },
      out: { type: "string" },
      revision: { type: "string" },
      runtime: { type: "string" },
    },
  });
  const required = [
    values.generator,
    values.library,
    values.manifest,
    values["max-requests"],
    values.meanings,
    values.out,
    values.revision,
    values.runtime,
    values.concurrency,
  ];
  if (required.some((v) => !v)) {
    throw new Error(
      "Usage: local-campaign.ts --manifest <file> --revision <file> --library <dir> --meanings <dir> --out <new-dir> --generator <local-generate.ts> --max-requests <n> --runtime <frozen-runtime.json> --concurrency 1 [--execute]"
    );
  }
  const result = runLocalCampaign({
    authorCommand: values["author-command"],
    authorModel: values["author-model"],
    concurrency: Number(values.concurrency),
    execute: values.execute,
    generator: path.resolve(values.generator ?? ""),
    library: path.resolve(values.library ?? ""),
    manifestFile: path.resolve(values.manifest ?? ""),
    maxRequests: Number(values["max-requests"]),
    meaningsDirectory: path.resolve(values.meanings ?? ""),
    out: path.resolve(values.out ?? ""),
    revisionFile: path.resolve(values.revision ?? ""),
    runtimeFile: path.resolve(values.runtime ?? ""),
  });
  const crossMaster = values.execute
    ? await writeCampaignEvidence(
        path.resolve(values.out ?? ""),
        JSON.parse(
          readFileSync(
            path.join(values.out ?? "", "campaign-lock.json"),
            "utf-8"
          )
        ).requests
      )
    : null;
  process.stdout.write(
    `${JSON.stringify({ ...result, crossMaster }, null, 2)}\n`
  );
}

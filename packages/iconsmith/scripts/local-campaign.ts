/** Bounded local campaign driver around the canonical local-generate entrypoint. */
import type { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import type { AcceptanceCampaignAuthorEvidence } from "../src/eval/acceptance-contract.js";
import { writeCampaignEvidence } from "./campaign-evidence.js";
import { createReliabilityReplayManifest } from "./campaign-manifest.js";
import { writeDurableJson } from "./durable-json.js";
import { parseFamilyReferencePacket } from "./family-reference-packet.js";
import {
  nativeActorLineage,
  readNativeRouteManifest,
} from "./local-native-config.js";
import { readDiagnosticFinalizationPlan } from "./local-native-interruption-diagnostic.js";
import { runOwnedProcess } from "./local-process.js";
import type { ProcessResult } from "./local-process.js";
import { verifyLocalRenderEvidence } from "./local-render-evidence.js";
import { replayStructuredAuthorEvidence } from "./local-structured-author.js";
import { productionNativeMaximumCalls } from "./review-budget.js";
import {
  captureLaunchDescriptor,
  executeLaunchDescriptor,
  verifyRuntimeIdentity,
} from "./runtime-identity.js";

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
const receiptHash = (receipt: Record<string, unknown>) =>
  sha(canonical(receipt));
const objectHash = (value: unknown) => sha(JSON.stringify(value));
const exactKeys = (value: Record<string, unknown>, expected: string[]) =>
  canonical(Object.keys(value).toSorted()) === canonical(expected.toSorted());
const validParentSettlement = (value: unknown) => {
  if (value === null) {
    return true;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const settlement = value as Record<string, unknown>;
  const expectedKeys = ["code", "killed", "quiescent", "stderr", "stdout"];
  const hasScope = Object.hasOwn(settlement, "quiescenceScope");
  if (hasScope) {
    expectedKeys.push("quiescenceScope");
  }
  return (
    exactKeys(settlement, expectedKeys) &&
    (settlement.code === null ||
      typeof settlement.code === "string" ||
      Number.isInteger(settlement.code)) &&
    typeof settlement.killed === "boolean" &&
    typeof settlement.quiescent === "boolean" &&
    typeof settlement.stderr === "string" &&
    typeof settlement.stdout === "string" &&
    (settlement.quiescent === false || hasScope) &&
    (!hasScope ||
      settlement.quiescenceScope === "process-group-and-observed-descendants")
  );
};
interface Frozen {
  hash: string;
  manifest: {
    assumptions: { deadlineMsPerConceptSizePair: number };
    concepts: { concept: string; family: string }[];
    kind: "catalog" | "development" | "reliability-replay";
    requests?: { concept: string; family: string; master: 16 | 24 }[];
    slots: {
      concept: string;
      family: string;
      finish: "filled" | "outlined";
      nativeSize: 16 | 24;
      slotId: string;
    }[];
    source: { id: string; treeHash: string; concepts: number };
  };
}
interface Options {
  authorCommand?: string;
  authorModel?: string;
  concurrency: number;
  execute: boolean;
  generator: string;
  familyPacketsDirectory?: string;
  diagnosticFinalizationPlanFile?: string;
  diagnosticFinalizationPlanSha256?: string;
  library: string;
  manifestFile: string;
  maxRequests: number;
  meaningsDirectory: string;
  out: string;
  revisionFile: string;
  runtimeFile: string;
  nativeRouteHash?: string;
  verifyRuntime?: typeof verifyRuntimeIdentity;
  spawn?: typeof spawnSync;
  ownedProcess?: typeof runOwnedProcess;
}
const PARENT_SETTLEMENT_RESERVE_MS = 5000;
const outerStartFile = (request: { destination: string }) =>
  `${request.destination}.outer-start.json`;
const outerStartHash = (request: { destination: string }) =>
  existsSync(outerStartFile(request))
    ? sha(readFileSync(outerStartFile(request)))
    : null;
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
  if (
    typeof x.deadlineAt !== "number" ||
    !Number.isFinite(x.deadlineAt) ||
    typeof x.maxWallMs !== "number" ||
    x.maxWallMs !== request.maxWallMs ||
    typeof x.qualityStatus !== "string" ||
    (x.deadlineExceeded === false && elapsedMs >= request.maxWallMs) ||
    (x.deadlineExceeded === true &&
      !["deadline-exhausted", "outer-refusal"].includes(x.qualityStatus))
  ) {
    return false;
  }
  const recognizedQuality = [
    "review-clear",
    "review-uncertain",
    "review-incomplete",
    "needs-repair",
    "representation-blocked",
    "deadline-exhausted",
    "not-reviewed",
    "outer-refusal",
  ].includes(x.qualityStatus);
  return (
    recognizedQuality &&
    (x.status !== "delivered" || typeof x.selectedAttempt === "string")
  );
};
const campaignRetrieval = (directory?: string) => ({
  familyPacketsDirectory: directory ? realpathSync(directory) : null,
  maximumCalls: productionNativeMaximumCalls(directory ? 0 : 2),
  route: directory ? "shared-family-packet" : "automatic-retrieval",
});
const campaignDiagnostic = (
  o: Options,
  nativeRoute: ReturnType<typeof readNativeRouteManifest> | undefined
) => {
  if (
    Boolean(o.diagnosticFinalizationPlanFile) !==
    Boolean(o.diagnosticFinalizationPlanSha256)
  ) {
    throw new Error(
      "Diagnostic finalization plan requires paired file and SHA256"
    );
  }
  const diagnosticFinalization = o.diagnosticFinalizationPlanFile
    ? readDiagnosticFinalizationPlan({
        file: o.diagnosticFinalizationPlanFile,
        sha256: o.diagnosticFinalizationPlanSha256 ?? "",
      })
    : undefined;
  if (
    diagnosticFinalization &&
    (!nativeRoute ||
      !o.familyPacketsDirectory ||
      diagnosticFinalization.plan.routeHash !== o.nativeRouteHash ||
      diagnosticFinalization.plan.image !== nativeRoute.manifest.image)
  ) {
    throw new Error(
      "Diagnostic finalization requires its frozen native shared-packet route"
    );
  }
  return diagnosticFinalization ? { diagnosticFinalization } : {};
};
const campaignExecution = (o: Options, toolingHash: string) => {
  const retrieval = campaignRetrieval(o.familyPacketsDirectory);
  const nativeRoute = o.nativeRouteHash
    ? readNativeRouteManifest(o.runtimeFile, o.nativeRouteHash)
    : undefined;
  const runtime =
    nativeRoute ?? JSON.parse(readFileSync(o.runtimeFile, "utf-8"));
  if (!nativeRoute) {
    (o.verifyRuntime ?? verifyRuntimeIdentity)(runtime);
  }
  if (nativeRoute && [o.authorCommand, o.authorModel].some(Boolean)) {
    throw new Error(
      "Native route model and command come only from the frozen manifest"
    );
  }
  const execution = {
    ...campaignDiagnostic(o, nativeRoute),
    authorCommand:
      nativeRoute?.manifest.author.executable.path ??
      o.authorCommand ??
      "/Applications/ChatGPT.app/Contents/Resources/codex",
    authorModel:
      nativeRoute?.manifest.author.model ?? o.authorModel ?? "gpt-6-astra",
    authorReasoningEffort: "high",
    campaignStopFile: path.resolve(o.out, "STOP"),
    familyPacketsDirectory: retrieval.familyPacketsDirectory,
    generator: path.resolve(o.generator),
    maximumNativeCallsPerRequest: nativeRoute ? retrieval.maximumCalls : null,
    nativeRouteHash: o.nativeRouteHash ?? null,
    reviewerCommand:
      nativeRoute?.manifest.reviewers[0].executable.path ?? "claude",
    route: retrieval.route,
    runtimeFile: path.resolve(o.runtimeFile),
    runtimeHash: runtime.hash,
    toolingHash,
  };
  if (
    !nativeRoute &&
    (runtime.manifest.author.command !== execution.authorCommand ||
      runtime.manifest.reviewer.command !== execution.reviewerCommand)
  ) {
    throw new Error("Runtime commands do not match frozen campaign route");
  }
  return execution;
};
const validateCampaignDiagnostic = (
  plan: Pick<Plan, "campaignHash" | "execution" | "requests" | "revisionHash">
) => {
  const diagnostic = plan.execution.diagnosticFinalization?.plan;
  if (diagnostic) {
    const targets = plan.requests.filter(
      (request) =>
        request.concept === diagnostic.target.concept &&
        request.family === diagnostic.target.family &&
        String(request.master) === diagnostic.target.master
    );
    const [target] = targets;
    if (
      targets.length !== 1 ||
      !target ||
      diagnostic.campaignHash !== plan.campaignHash ||
      diagnostic.revisionHash !== plan.revisionHash ||
      diagnostic.maxWallMs !== target.maxWallMs ||
      canonical(diagnostic.target.slotIds) !== canonical(target.slotIds) ||
      canonical(diagnostic.familyPacket) !== canonical(target.familyPacket)
    ) {
      throw new Error(
        "Diagnostic finalization plan does not match exactly one frozen campaign request"
      );
    }
  }
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
  if (!["development", "reliability-replay"].includes(frozen.manifest.kind)) {
    throw new Error(
      "This driver accepts development or the frozen reliability replay only; catalog remains disabled"
    );
  }
  if (frozen.manifest.kind === "reliability-replay") {
    const expected = createReliabilityReplayManifest({
      sources: [
        {
          id: frozen.manifest.source.id,
          records: frozen.manifest.source.concepts,
          treeHash: frozen.manifest.source.treeHash,
        },
      ],
    });
    if (canonical(expected.manifest) !== canonical(frozen.manifest)) {
      throw new Error(
        "Reliability replay must contain the exact six frozen requests and twelve slots"
      );
    }
  } else if (
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
  const execution = campaignExecution(o, tool.hash);
  const pairs =
    frozen.manifest.kind === "reliability-replay"
      ? (frozen.manifest.requests ?? [])
      : frozen.manifest.concepts.flatMap(({ concept, family }) =>
          ([16, 24] as const).map((master) => ({ concept, family, master }))
        );
  const requests = pairs.map(({ concept, family, master }) => {
    const slots = frozen.manifest.slots.filter(
      (s) =>
        s.concept === concept && s.family === family && s.nativeSize === master
    );
    if (slots.length !== 2 || new Set(slots.map((s) => s.finish)).size !== 2) {
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
    let familyPacket: null | {
      file: string;
      sha256: string;
      packetHash: string;
    } = null;
    if (execution.familyPacketsDirectory) {
      const file = path.join(
        execution.familyPacketsDirectory,
        `${concept}.json`
      );
      if (!lstatSync(file).isFile() || realpathSync(file) !== file) {
        throw new Error(
          `Family packet must be a regular non-symlink file: ${concept}`
        );
      }
      const packetBytes = readFileSync(file);
      const packet = parseFamilyReferencePacket(
        JSON.parse(packetBytes.toString())
      );
      if (
        packet.concept !== concept ||
        packet.librarySet !== frozen.manifest.source.id
      ) {
        throw new Error(`Family packet campaign identity mismatch: ${concept}`);
      }
      familyPacket = {
        file,
        packetHash: packet.packetHash,
        sha256: sha(packetBytes),
      };
    }
    const requestId = sha(
      canonical({
        campaignHash: frozen.hash,
        concept,
        execution,
        familyPacket,
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
      familyPacket,
      master,
      maxWallMs: frozen.manifest.assumptions.deadlineMsPerConceptSizePair,
      meaningsFile,
      meaningsHash,
      requestId,
      slotIds: slots.map((s) => s.slotId),
    };
  });
  validateCampaignDiagnostic({
    campaignHash: frozen.hash,
    execution,
    requests,
    revisionHash,
  });
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

export type CampaignTerminalEvidenceReport = Readonly<{
  kind: "iconsmith-verified-campaign-terminal-evidence-report-v1";
  planHash: string;
  campaignHash: string;
  requestId: string;
  requestIntentHash: string | null;
  slotIds: readonly string[];
  deadlineAt: number | null;
  route: string;
  runtimeHash: string;
  toolingHash: string;
  terminalStatus: "delivered" | "incomplete" | "refused" | "unstarted";
  qualityStatus: string | null;
  disposition: "produced" | "production-unknown" | "unstarted";
  selectedEvidence:
    | Readonly<{ state: "verified-absent" }>
    | Readonly<{
        state: "retained-produced";
        treeHash: string;
        artifacts: readonly Readonly<{ name: string; sha256: string }>[];
        outlinedSha256: string;
        filledSha256: string;
      }>;
  retainedFailureEvidence: null | Readonly<{
    state: "retained-rejected-child";
    sha256: string;
  }>;
  nativeAccountingStatus: "not-started" | "pre-native-zero-call" | "settled";
  authorEvidenceVerified: boolean;
  authorEvidence: AcceptanceCampaignAuthorEvidence | null;
  qualificationGranted: false;
  planAuthority: "caller-frozen";
}>;
export interface CampaignTerminalEvidenceCapability {
  readonly kind: "iconsmith-campaign-terminal-evidence-capability-v1";
}
type TerminalCapabilityState = Readonly<{
  plan: Plan;
  expectedPlanHash: string;
  requestId: string;
  receiptRoot: string;
  reportHash: string;
  revisionFile: string | null;
}>;
const terminalCapabilities = new WeakMap<
  CampaignTerminalEvidenceCapability,
  TerminalCapabilityState
>();
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
};
export const frozenCampaignPlanHash = (plan: Plan) => sha(canonical(plan));
/** A request-level stop or uncertain call settlement also stops later requests. */
const campaignStopped = (plan: Plan, out: string, persist = true) => {
  const latch = path.join(out, "stopped.json");
  if (existsSync(latch)) {
    return true;
  }
  const observed = [
    path.join(out, "STOP"),
    ...plan.requests.map((request) =>
      path.join(request.destination, "native-control/calls/stopped.json")
    ),
  ].find(existsSync);
  if (!observed) {
    return false;
  }
  if (persist) {
    writeDurableJson(latch, {
      campaignHash: plan.campaignHash,
      observed,
      observedAt: Date.now(),
    });
  }
  return true;
};
export const intentFile = (request: Request) =>
  `${request.destination}.intent.json`;
export const launchFile = (request: Request) =>
  `${request.destination}.launch.json`;
export const requestIntent = (plan: Plan, request: Request) => ({
  campaignHash: plan.campaignHash,
  execution: plan.execution,
  libraryHash: plan.libraryHash,
  request,
  revisionHash: plan.revisionHash,
});
interface DispatchIntent extends ReturnType<typeof requestIntent> {
  deadlineAt: number;
  issuedAt: number;
}
const dispatchIntent = (plan: Plan, request: Request, issuedAt: number) => ({
  ...requestIntent(plan, request),
  deadlineAt: issuedAt + request.maxWallMs,
  issuedAt,
});
const readDispatchIntent = (plan: Plan, request: Request): DispatchIntent => {
  const file = intentFile(request);
  const intent = JSON.parse(readFileSync(file, "utf-8")) as DispatchIntent;
  const { deadlineAt, issuedAt, ...identity } = intent;
  if (
    canonical(identity) !== canonical(requestIntent(plan, request)) ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(deadlineAt) ||
    deadlineAt !== issuedAt + request.maxWallMs
  ) {
    throw new Error(`Request intent identity mismatch: ${request.requestId}`);
  }
  return intent;
};
const validateIntent = (plan: Plan, request: Request) => {
  const file = intentFile(request);
  if (!existsSync(file)) {
    throw new Error(`Request intent identity mismatch: ${request.requestId}`);
  }
  readDispatchIntent(plan, request);
};
/** Bind every selected evidence byte; runtime dependencies belong outside this tree. */
const selectedEvidence = (
  directory: string,
  relative = ""
): { name: string; sha256: string }[] => {
  const current = path.join(directory, relative);
  const info = lstatSync(current);
  if (info.isSymbolicLink()) {
    throw new Error(`Selected evidence contains a symlink: ${relative || "."}`);
  }
  if (info.isFile()) {
    if (info.nlink !== 1) {
      throw new Error(`Selected evidence contains a hard link: ${relative}`);
    }
    return [{ name: relative, sha256: sha(readFileSync(current)) }];
  }
  if (!info.isDirectory()) {
    throw new Error(`Selected evidence is not a regular file: ${relative}`);
  }
  return readdirSync(current)
    .toSorted()
    .flatMap((name) =>
      selectedEvidence(directory, relative ? `${relative}/${name}` : name)
    );
};
const strictEvidenceTree = (
  directory: string,
  relative = ""
): { kind: "directory" | "file"; name: string; sha256?: string }[] => {
  const current = path.join(directory, relative);
  const info = lstatSync(current);
  if (info.isSymbolicLink()) {
    throw new Error(
      `Native accounting evidence contains a symlink: ${relative || "."}`
    );
  }
  if (info.isFile()) {
    if (info.nlink !== 1) {
      throw new Error(
        `Native accounting evidence contains a hard link: ${relative}`
      );
    }
    return [
      { kind: "file", name: relative, sha256: sha(readFileSync(current)) },
    ];
  }
  if (!info.isDirectory()) {
    throw new Error(
      `Native accounting evidence is not a regular file: ${relative}`
    );
  }
  return [
    { kind: "directory", name: relative || "." },
    ...readdirSync(current)
      .toSorted()
      .flatMap((name) =>
        strictEvidenceTree(directory, relative ? `${relative}/${name}` : name)
      ),
  ];
};
const strictJsonFile = (file: string) => {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new Error(
      `Native accounting evidence is not a unique regular file: ${file}`
    );
  }
  return JSON.parse(readFileSync(file, "utf-8"));
};
const containedEvidenceFile = (root: string, file: string) => {
  if (!path.isAbsolute(file)) {
    throw new Error("Native settlement evidence path must be absolute");
  }
  const resolvedRoot = realpathSync(root);
  const resolvedFile = realpathSync(file);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Native settlement evidence escaped its control root");
  }
  strictJsonFile(resolvedFile);
  return resolvedFile;
};
// Native accounting stays centralized so every terminal status uses the same checks.
// oxlint-disable-next-line eslint/complexity
const validateNativeAccounting = (
  plan: Plan,
  request: Request,
  intent: DispatchIntent
) => {
  if (!plan.execution.nativeRouteHash) {
    return null;
  }
  const control = path.join(request.destination, "native-control");
  const calls = path.join(control, "calls");
  for (const directory of [control, calls]) {
    const info = lstatSync(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      realpathSync(directory) !== path.resolve(directory)
    ) {
      throw new Error("Native call accounting directory is not owned");
    }
  }
  const launch = strictJsonFile(path.join(control, "launch.json"));
  const reservationEnvelope = strictJsonFile(
    path.join(calls, "reservation.json")
  );
  const { reservation } = reservationEnvelope;
  const expectedCalls = plan.execution.maximumNativeCallsPerRequest;
  const pinnedImage = readNativeRouteManifest(
    plan.execution.runtimeFile,
    plan.execution.nativeRouteHash
  ).manifest.image;
  if (
    expectedCalls === null ||
    !reservation ||
    reservationEnvelope.reservationHash !== objectHash(reservation) ||
    launch.reservationHash !== reservationEnvelope.reservationHash ||
    launch.requestId !== request.requestId ||
    launch.routeHash !== plan.execution.nativeRouteHash ||
    launch.budget?.deadlineAt !== intent.deadlineAt ||
    launch.budget?.maxCalls !== expectedCalls ||
    reservation.reservationId !== request.requestId ||
    reservation.routeHash !== plan.execution.nativeRouteHash ||
    reservation.deadlineAt !== intent.deadlineAt ||
    reservation.maxCalls !== expectedCalls ||
    reservation.billing !== "subscription"
  ) {
    throw new Error("Native reservation identity or call budget mismatch");
  }
  const dispatches = strictJsonFile(path.join(calls, "dispatches.json"));
  const intentFiles = readdirSync(calls)
    .filter((name) => name.endsWith(".intent.json"))
    .toSorted();
  const terminalFiles = readdirSync(calls)
    .filter((name) => name.endsWith(".terminal.json"))
    .toSorted();
  const startedFiles = readdirSync(calls)
    .filter((name) => name.endsWith(".started.json"))
    .toSorted();
  if (
    dispatches.reservationHash !== reservationEnvelope.reservationHash ||
    !Array.isArray(dispatches.calls) ||
    dispatches.calls.length !== intentFiles.length ||
    dispatches.calls.length > expectedCalls ||
    new Set(dispatches.calls.map((call: { callId?: unknown }) => call.callId))
      .size !== dispatches.calls.length
  ) {
    throw new Error("Native dispatch journal does not match its intents");
  }
  const seenStages = new Set<string>();
  // Each journal member binds intent, terminal, container, identity and start evidence.
  // oxlint-disable-next-line eslint/complexity
  const summaries = intentFiles.map((name) => {
    const callIntent = strictJsonFile(path.join(calls, name));
    const intentHash = objectHash(callIntent);
    const dispatch = dispatches.calls.find(
      (call: { callId?: unknown }) => call.callId === callIntent.callId
    );
    if (
      !dispatch ||
      name !== `${callIntent.callId}.intent.json` ||
      typeof callIntent.callId !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/u.test(callIntent.callId) ||
      dispatch.intentHash !== intentHash ||
      callIntent.requestId !== request.requestId ||
      callIntent.reservationHash !== reservationEnvelope.reservationHash ||
      callIntent.routeHash !== plan.execution.nativeRouteHash ||
      callIntent.deadlineAt !== intent.deadlineAt ||
      !Number.isSafeInteger(callIntent.dispatchedAt) ||
      callIntent.dispatchedAt < intent.issuedAt ||
      callIntent.dispatchedAt >= callIntent.deadlineAt ||
      !Number.isSafeInteger(callIntent.minimumRemainingMs) ||
      callIntent.minimumRemainingMs < 1 ||
      typeof callIntent.stage !== "string" ||
      !callIntent.stage ||
      seenStages.has(callIntent.stage)
    ) {
      throw new Error("Native call intent identity mismatch");
    }
    seenStages.add(callIntent.stage);
    const terminalFile = path.join(calls, `${callIntent.callId}.terminal.json`);
    const terminal = strictJsonFile(terminalFile);
    if (
      terminal.intentHash !== intentHash ||
      terminal.accounting !== "settled" ||
      terminal.containment !== "container-absent" ||
      !["complete", "failed", "cancelled"].includes(terminal.outcome) ||
      !Number.isSafeInteger(terminal.settledAt) ||
      terminal.settledAt < callIntent.dispatchedAt ||
      terminal.deadlineExceeded !==
        terminal.settledAt >= callIntent.deadlineAt ||
      typeof terminal.evidenceHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(terminal.evidenceHash)
    ) {
      throw new Error("Native terminal settlement is incomplete");
    }
    const evidenceFile = containedEvidenceFile(control, terminal.evidenceFile);
    const evidenceBytes = readFileSync(evidenceFile);
    const evidence = JSON.parse(evidenceBytes.toString("utf-8"));
    const { container } = evidence;
    const identity = strictJsonFile(
      path.join(path.dirname(evidenceFile), "container-identity.json")
    );
    if (
      sha(evidenceBytes) !== terminal.evidenceHash ||
      evidence.intentHash !== intentHash ||
      evidence.deadlineAt !== callIntent.deadlineAt ||
      !container ||
      container.containerAbsent !== true ||
      container.containmentScope !== "docker-private-pid-namespace" ||
      typeof container.containerId !== "string" ||
      !/^[a-f0-9]{64}$/u.test(container.containerId) ||
      identity.containerId !== container.containerId ||
      identity.image !== pinnedImage ||
      typeof identity.containerName !== "string" ||
      !/^iconsmith-[a-z0-9][a-z0-9-]{0,50}$/u.test(identity.containerName) ||
      typeof identity.ownershipToken !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
        identity.ownershipToken
      ) ||
      container.status === "containment-unproven" ||
      (terminal.outcome === "failed" &&
        container.status !== "workload-failed") ||
      (terminal.outcome === "cancelled" &&
        (container.status !== "workload-failed" ||
          container.process?.killed !== true)) ||
      (terminal.outcome === "complete" &&
        (container.status !== "complete" ||
          container.artifactEligible !== true ||
          container.process?.code !== 0 ||
          container.process?.killed !== false)) ||
      (container.process &&
        (container.process.quiescent !== true ||
          container.process.quiescenceScope !==
            "process-group-and-observed-descendants"))
    ) {
      throw new Error("Native container settlement evidence is invalid");
    }
    const startedFile = path.join(calls, `${callIntent.callId}.started.json`);
    if (existsSync(startedFile)) {
      const started = strictJsonFile(startedFile);
      if (
        dispatch.startedHash !== objectHash(started) ||
        started.intentHash !== intentHash ||
        !Number.isSafeInteger(started.startedAt) ||
        started.startedAt < callIntent.dispatchedAt ||
        started.startedAt >= callIntent.deadlineAt ||
        started.startedAt > terminal.settledAt
      ) {
        throw new Error("Native start journal is invalid");
      }
    } else if (
      dispatch.startedHash !== undefined ||
      terminal.outcome === "complete"
    ) {
      throw new Error("Native start evidence is missing");
    }
    return {
      callId: callIntent.callId,
      evidenceHash: terminal.evidenceHash,
      identityHash: sha(
        readFileSync(
          path.join(path.dirname(evidenceFile), "container-identity.json")
        )
      ),
      intentHash,
      outcome: terminal.outcome,
      stage: callIntent.stage,
      terminalHash: sha(readFileSync(terminalFile)),
    };
  });
  const expectedTerminals = intentFiles.map((name) =>
    name.replace(/\.intent\.json$/u, ".terminal.json")
  );
  const expectedStarts = dispatches.calls
    .filter((call: { startedHash?: unknown }) => call.startedHash !== undefined)
    .map((call: { callId: string }) => `${call.callId}.started.json`)
    .toSorted();
  if (
    canonical(terminalFiles) !== canonical(expectedTerminals) ||
    canonical(startedFiles) !== canonical(expectedStarts)
  ) {
    throw new Error("Native call journal contains orphan settlement records");
  }
  return {
    calls: summaries,
    // Settlement proves quiescence; retain every collector byte as well so a
    // later read cannot accept changed traces, answers or request attachments.
    // This is byte integrity, not author inspection or qualification authority.
    evidence: strictEvidenceTree(control),
    maxCalls: expectedCalls,
    reservationHash: reservationEnvelope.reservationHash,
    routeHash: plan.execution.nativeRouteHash,
  };
};
interface NativeRefusalAccounting {
  hash: string | null;
  status: "legacy" | "pre-native-zero-call" | "settled" | "unproven";
}
const nativeRefusalAccounting = (
  plan: Plan,
  request: Request,
  intent: DispatchIntent
): NativeRefusalAccounting => {
  if (!plan.execution.nativeRouteHash) {
    return { hash: null, status: "legacy" };
  }
  const control = path.join(request.destination, "native-control");
  if (!existsSync(control)) {
    return {
      hash: receiptHash({ control: "absent", requestId: request.requestId }),
      status: "pre-native-zero-call",
    };
  }
  const evidence = strictEvidenceTree(control);
  const hasCallJournal = evidence.some(({ name }) =>
    /\.(?:intent|started|terminal)\.json$/u.test(name)
  );
  if (!hasCallJournal) {
    const dispatchFile = path.join(control, "calls", "dispatches.json");
    if (existsSync(dispatchFile)) {
      const dispatches = strictJsonFile(dispatchFile);
      if (!Array.isArray(dispatches.calls) || dispatches.calls.length !== 0) {
        throw new Error("Native zero-call journal claims a dispatch");
      }
    }
    if (
      [
        path.join(control, "launch.json"),
        path.join(control, "calls", "reservation.json"),
        dispatchFile,
      ].every(existsSync)
    ) {
      const accounting = validateNativeAccounting(plan, request, intent);
      if (!accounting) {
        throw new Error("Native accounting unexpectedly resolved as legacy");
      }
      return { hash: receiptHash(accounting), status: "settled" };
    }
    return {
      hash: receiptHash({ evidence, requestId: request.requestId }),
      status: "pre-native-zero-call",
    };
  }
  const accounting = validateNativeAccounting(plan, request, intent);
  if (!accounting) {
    throw new Error("Native accounting unexpectedly resolved as legacy");
  }
  return { hash: receiptHash(accounting), status: "settled" };
};
const captureNativeRefusalAccounting = (
  plan: Plan,
  request: Request,
  intent: DispatchIntent
): NativeRefusalAccounting => {
  try {
    return nativeRefusalAccounting(plan, request, intent);
  } catch {
    return { hash: null, status: "unproven" };
  }
};
// eslint-disable-next-line complexity
const validateOutput = (
  plan: Plan,
  request: Request,
  terminal: Record<string, unknown>,
  captureAuthor?: (evidence: AcceptanceCampaignAuthorEvidence) => void
) => {
  const intent = readDispatchIntent(plan, request);
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
    terminal.deadlineAt !== intent.deadlineAt ||
    terminal.maxWallMs !== request.maxWallMs ||
    terminal.route !== plan.execution.route ||
    terminal.requestId !== request.requestId ||
    terminal.toolingHash !== plan.execution.toolingHash ||
    terminal.runtimeHash !== plan.execution.runtimeHash
  ) {
    throw new Error(`Generator output identity mismatch: ${request.requestId}`);
  }
  if (
    terminal.deadlineExceeded !==
      (terminal.elapsedMs as number) >= request.maxWallMs ||
    (terminal.deadlineExceeded === true &&
      terminal.qualityStatus !== "deadline-exhausted")
  ) {
    throw new Error(
      `Generator deadline accounting mismatch: ${request.requestId}`
    );
  }
  if (
    terminal.status === "delivered" &&
    typeof terminal.selectedAttempt !== "string"
  ) {
    throw new TypeError(
      `Delivered output has no selected attempt: ${request.requestId}`
    );
  }
  if (typeof terminal.selectedAttempt !== "string") {
    if (Array.isArray(terminal.attempts) && terminal.attempts.length > 0) {
      throw new Error(
        `Generator reported attempts without a selected attempt: ${request.requestId}`
      );
    }
    return [];
  }
  const selectedPath = path.resolve(terminal.selectedAttempt);
  const selected = realpathSync(selectedPath);
  const destination = realpathSync(path.resolve(request.destination));
  const relative = path.relative(destination, selected);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Selected attempt escaped request directory: ${request.requestId}`
    );
  }
  // Resolve containment first, then reject indirection anywhere below the request.
  let component = destination;
  const lexicalRelative = path.relative(
    path.resolve(request.destination),
    selectedPath
  );
  if (lexicalRelative.startsWith("..") || path.isAbsolute(lexicalRelative)) {
    throw new Error(
      `Selected attempt path escaped request directory: ${request.requestId}`
    );
  }
  for (const name of lexicalRelative.split(path.sep)) {
    component = path.join(component, name);
    if (lstatSync(component).isSymbolicLink()) {
      throw new Error(
        `Selected attempt contains a symlink: ${request.requestId}`
      );
    }
  }
  for (const name of ["outlined.svg", "filled.svg"] as const) {
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
  }
  const artifacts = selectedEvidence(selected);
  const authorFile = path.join(selected, "structured-author.json");
  if (plan.execution.nativeRouteHash && existsSync(authorFile)) {
    const author = strictJsonFile(authorFile);
    if (
      author.authorEvidence?.status ===
      "collector-sealed-requires-downstream-replay"
    ) {
      if (
        author.deadlineAt !== intent.deadlineAt ||
        author.model !== plan.execution.authorModel ||
        ["outlined", "filled"].some(
          (paint) =>
            author.programHashes?.[paint] !==
              sha(readFileSync(path.join(selected, `${paint}.icon`))) ||
            author.proofHashes?.[paint] !==
              sha(readFileSync(path.join(selected, `${paint}.proof.png`)))
        )
      ) {
        throw new Error(
          "Selected author evidence does not bind the campaign artifacts"
        );
      }
      const replay = replayStructuredAuthorEvidence(author, {
        expectedDeadlineAt: intent.deadlineAt,
        expectedRequestId: request.requestId,
        rootDirectory: path.join(request.destination, "native-control"),
      });
      if (captureAuthor) {
        const actor = readNativeRouteManifest(
          plan.execution.runtimeFile,
          plan.execution.nativeRouteHash
        ).manifest.author;
        const { inspection } = author.authorEvidence;
        if (inspection.emittedModel !== actor.model) {
          throw new Error(
            "Selected author inspection model differs from frozen author"
          );
        }
        const paints = Object.fromEntries(
          (["outlined", "filled"] as const).map((paint) => [
            paint,
            {
              programSha256: author.programHashes[paint],
              proofSha256: author.proofHashes[paint],
              svgSha256: sha(readFileSync(path.join(selected, `${paint}.svg`))),
            },
          ])
        ) as AcceptanceCampaignAuthorEvidence["paints"];
        captureAuthor(
          deepFreeze({
            authorId: `${actor.provider}:${actor.model}`,
            authorLineage: nativeActorLineage(actor),
            authorModel: actor.model,
            authorReceiptSha256: sha(readFileSync(authorFile)),
            completionDeadlineAt: author.completionDeadlineAt,
            evidenceReceiptSha256s: [...replay.evidenceReceiptSha256s],
            inspection: {
              collectorRequestId: inspection.collectorRequestId,
              emittedModel: inspection.emittedModel,
              emittedSessionId: inspection.emittedSessionId,
              intentHash: inspection.intentHash,
              lifecycleRequestSha256: inspection.lifecycleRequestSha256,
              stageDeadlineAt: inspection.stageDeadlineAt,
              traceReceiptSha256: inspection.traceReceiptSha256,
              traceSha256: inspection.traceSha256,
            },
            kind: "parent-replayed-author-inspection-v1",
            nativeRouteHash: plan.execution.nativeRouteHash,
            paints,
            selectedTreeSha256: sha(canonical(artifacts)),
          })
        );
      }
    }
  }
  return artifacts;
};
const expectedChildOutputFile = (request: Request) =>
  path.join(
    realpathSync(path.dirname(path.resolve(request.destination))),
    path.basename(request.destination),
    "request.json"
  );
const retainedInvalidChildOutput = (
  request: Request,
  parentSettlement?: ProcessResult
) => {
  const expected = expectedChildOutputFile(request);
  if (parentSettlement?.quiescent === false || !existsSync(expected)) {
    return { hash: null, path: null };
  }
  const metadata = lstatSync(expected);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    realpathSync(expected) !== expected
  ) {
    throw new Error("Invalid child output is not a bound regular file");
  }
  return { hash: sha(readFileSync(expected)), path: expected };
};
const validRetainedInvalidChildOutput = (
  request: Request,
  receipt: Record<string, unknown>
) => {
  const expected = expectedChildOutputFile(request);
  const storedPath = receipt.invalidChildOutputPath;
  const storedHash = receipt.invalidChildOutputHash;
  const settlement = receipt.parentSettlement;
  const unsettled =
    Boolean(settlement) &&
    typeof settlement === "object" &&
    !Array.isArray(settlement) &&
    (settlement as Record<string, unknown>).quiescent === false;
  if (storedPath === null && storedHash === null) {
    return unsettled || !existsSync(expected);
  }
  if (
    unsettled ||
    storedPath !== expected ||
    typeof storedHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(storedHash) ||
    !existsSync(expected)
  ) {
    return false;
  }
  const metadata = lstatSync(expected);
  return (
    metadata.isFile() &&
    !metadata.isSymbolicLink() &&
    metadata.nlink === 1 &&
    realpathSync(expected) === expected &&
    sha(readFileSync(expected)) === storedHash
  );
};
// eslint-disable-next-line complexity
const loadReceipt = (
  plan: Plan,
  request: Request,
  out: string,
  captureAuthor?: (evidence: AcceptanceCampaignAuthorEvidence) => void
) => {
  const file = path.join(out, "receipts", `${request.requestId}.json`);
  if (!existsSync(file)) {
    return null;
  }
  validateIntent(plan, request);
  const receipt = JSON.parse(readFileSync(file, "utf-8"));
  if (receipt.outerStartHash !== outerStartHash(request)) {
    throw new Error(
      `Saved outer dispatch failed identity validation: ${request.requestId}`
    );
  }
  if (receipt.outerRefusal === true) {
    const intent = readDispatchIntent(plan, request);
    if (receipt.nativeAccountingStatus === "unproven") {
      throw new Error(
        `Saved outer refusal has unproven native accounting: ${request.requestId}`
      );
    }
    const nativeAccounting = nativeRefusalAccounting(plan, request, intent);
    const { integrityHash, ...hashedReceipt } = receipt;
    if (
      typeof integrityHash !== "string" ||
      integrityHash !== receiptHash(hashedReceipt) ||
      receipt.campaignHash !== plan.campaignHash ||
      receipt.requestId !== request.requestId ||
      canonical(receipt.slotIds) !== canonical(request.slotIds) ||
      receipt.aiQualified !== false ||
      receipt.artifacts?.length !== 0 ||
      receipt.terminal?.status !== "refused" ||
      receipt.terminal?.requestId !== request.requestId ||
      receipt.terminal?.deadlineAt !== intent.deadlineAt ||
      receipt.terminal?.maxWallMs !== request.maxWallMs ||
      receipt.terminal?.route !== plan.execution.route ||
      receipt.terminal?.runtimeHash !== plan.execution.runtimeHash ||
      receipt.terminal?.toolingHash !== plan.execution.toolingHash ||
      !isTerminal(receipt.terminal, request) ||
      receipt.terminal.deadlineExceeded !==
        receipt.terminal.elapsedMs >= request.maxWallMs ||
      typeof receipt.reason !== "string" ||
      !receipt.reason.trim() ||
      !(
        receipt.childExitCode === null ||
        Number.isInteger(receipt.childExitCode)
      ) ||
      !(
        receipt.childSignal === null || typeof receipt.childSignal === "string"
      ) ||
      !(
        receipt.childError === null || typeof receipt.childError === "string"
      ) ||
      !(
        receipt.invalidChildOutputHash === null ||
        /^[a-f0-9]{64}$/u.test(receipt.invalidChildOutputHash)
      ) ||
      !validRetainedInvalidChildOutput(request, receipt) ||
      !validParentSettlement(receipt.parentSettlement) ||
      receipt.nativeAccountingStatus !== nativeAccounting.status ||
      receipt.nativeAccountingHash !== nativeAccounting.hash
    ) {
      throw new Error(
        `Saved outer refusal failed identity validation: ${request.requestId}`
      );
    }
    return receipt;
  }
  const requestFile = path.join(request.destination, "request.json");
  const terminal = existsSync(requestFile)
    ? JSON.parse(readFileSync(requestFile, "utf-8"))
    : null;
  const artifacts = terminal
    ? validateOutput(plan, request, terminal, captureAuthor)
    : [];
  const nativeAccounting = terminal
    ? validateNativeAccounting(plan, request, readDispatchIntent(plan, request))
    : null;
  const { integrityHash, ...hashedReceipt } = receipt;
  if (
    typeof integrityHash !== "string" ||
    integrityHash !== receiptHash(hashedReceipt) ||
    receipt.campaignHash !== plan.campaignHash ||
    receipt.requestId !== request.requestId ||
    receipt.aiQualified !== false ||
    canonical(receipt.slotIds) !== canonical(request.slotIds) ||
    !existsSync(requestFile) ||
    sha(readFileSync(requestFile)) !== receipt.requestFileHash ||
    !isTerminal(receipt.terminal, request) ||
    canonical(receipt.terminal) !== canonical(terminal) ||
    canonical(receipt.artifacts) !== canonical(artifacts) ||
    receipt.nativeAccountingHash !==
      (nativeAccounting ? receiptHash(nativeAccounting) : null) ||
    !(
      receipt.childExitCode === null || Number.isInteger(receipt.childExitCode)
    ) ||
    !(
      receipt.childSignal === null || typeof receipt.childSignal === "string"
    ) ||
    !(receipt.childError === null || typeof receipt.childError === "string") ||
    typeof receipt.parentCompletedAt !== "number" ||
    !Number.isFinite(receipt.parentCompletedAt) ||
    receipt.parentCompletedAt >= readDispatchIntent(plan, request).deadlineAt ||
    (receipt.parentSettlement !== null &&
      receipt.parentSettlement?.quiescent !== true) ||
    (plan.execution.nativeRouteHash &&
      receipt.parentSettlement?.quiescent !== true) ||
    (terminal?.status === "delivered" &&
      (receipt.childExitCode !== 0 ||
        receipt.childSignal !== null ||
        receipt.childError !== null))
  ) {
    throw new Error(
      `Saved terminal receipt failed identity validation: ${request.requestId}`
    );
  }
  return receipt;
};
const writeOuterRefusal = (
  plan: Plan,
  request: Request,
  out: string,
  child: ReturnType<typeof spawnSync>,
  reason: string,
  parentSettlement?: ProcessResult
) => {
  const savedParentSettlement = parentSettlement ?? null;
  if (!validParentSettlement(savedParentSettlement)) {
    throw new Error("Parent settlement evidence is invalid");
  }
  const intent = readDispatchIntent(plan, request);
  const nativeAccounting = captureNativeRefusalAccounting(
    plan,
    request,
    intent
  );
  const invalidChildOutput = retainedInvalidChildOutput(
    request,
    parentSettlement
  );
  const elapsedMs = Math.max(0, Date.now() - intent.issuedAt);
  const unsignedReceipt = {
    aiQualified: false,
    artifacts: [],
    campaignHash: plan.campaignHash,
    childError: child.error ? String(child.error) : null,
    childExitCode: child.status,
    childSignal: child.signal,
    invalidChildOutputHash: invalidChildOutput.hash,
    invalidChildOutputPath: invalidChildOutput.path,
    nativeAccountingHash: nativeAccounting.hash,
    nativeAccountingStatus: nativeAccounting.status,
    outerRefusal: true,
    outerStartHash: outerStartHash(request),
    parentSettlement: savedParentSettlement,
    reason,
    requestId: request.requestId,
    slotIds: request.slotIds,
    terminal: {
      actualUsd: null,
      deadlineAt: intent.deadlineAt,
      deadlineExceeded: elapsedMs >= request.maxWallMs,
      elapsedMs,
      maxWallMs: request.maxWallMs,
      qualityStatus: "outer-refusal",
      requestId: request.requestId,
      route: plan.execution.route,
      runtimeHash: plan.execution.runtimeHash,
      status: "refused",
      toolingHash: plan.execution.toolingHash,
    },
  };
  const receipt = {
    ...unsignedReceipt,
    integrityHash: receiptHash(unsignedReceipt),
  };
  if (nativeAccounting.status === "unproven") {
    const stop = path.join(out, "stopped.json");
    if (!existsSync(stop)) {
      writeDurableJson(stop, {
        campaignHash: plan.campaignHash,
        observedAt: Date.now(),
        reason: "unproven-native-accounting",
        requestId: request.requestId,
      });
    }
  }
  writeDurableJson(
    path.join(out, "receipts", `${request.requestId}.json`),
    receipt
  );
  return receipt;
};
const inspectPrior = (
  plan: Plan,
  request: Request,
  out: string,
  captureAuthor?: (evidence: AcceptanceCampaignAuthorEvidence) => void
) => {
  const receipt = loadReceipt(plan, request, out, captureAuthor);
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
  if (existsSync(path.join(request.destination, "run.json"))) {
    validateOutput(plan, request, terminal);
  }
  if (!isTerminal(terminal, request)) {
    throw new Error(
      `Unknown attempt blocks automatic charging: ${request.requestId}`
    );
  }
  validateOutput(plan, request, terminal);
  validateNativeAccounting(plan, request, readDispatchIntent(plan, request));
  throw new Error(
    `Unsettled child-only attempt blocks automatic recovery and charging: ${request.requestId}`
  );
};
const pathEntryExists = (entry: string) => {
  try {
    lstatSync(entry);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false;
    }
    throw error;
  }
};
const verifiedReceiptRoot = (request: Request, receiptRoot: string) => {
  const expected = path.join(
    path.dirname(path.dirname(path.resolve(request.destination))),
    "receipts"
  );
  if (path.resolve(receiptRoot) !== expected) {
    throw new Error(
      "Campaign terminal receipt root does not match the frozen request"
    );
  }
  if (existsSync(expected)) {
    const metadata = lstatSync(expected);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      realpathSync(expected) !== expected
    ) {
      throw new Error("Campaign terminal receipt root is unsafe");
    }
  }
  return expected;
};
const selectedEvidenceReport = (
  artifacts: readonly { name: string; sha256: string }[],
  terminalStatus: unknown
): CampaignTerminalEvidenceReport["selectedEvidence"] => {
  if (artifacts.length === 0) {
    if (terminalStatus === "delivered") {
      throw new Error("Campaign delivered terminal has no selected evidence");
    }
    return { state: "verified-absent" };
  }
  const outlined = artifacts.filter(({ name }) => name === "outlined.svg");
  const filled = artifacts.filter(({ name }) => name === "filled.svg");
  if (outlined.length !== 1 || filled.length !== 1) {
    throw new Error(
      "Campaign selected evidence does not contain exactly two paints"
    );
  }
  return {
    artifacts: artifacts.map(({ name, sha256 }) => ({ name, sha256 })),
    filledSha256: filled[0].sha256,
    outlinedSha256: outlined[0].sha256,
    state: "retained-produced",
    treeHash: sha(canonical(artifacts)),
  };
};
const buildCampaignTerminalEvidenceReport = (
  plan: Plan,
  expectedPlanHash: string,
  requestId: string,
  receiptRoot: string
): CampaignTerminalEvidenceReport => {
  if (
    !/^[a-f0-9]{64}$/u.test(expectedPlanHash) ||
    frozenCampaignPlanHash(plan) !== expectedPlanHash
  ) {
    throw new Error("Campaign terminal plan identity changed");
  }
  if (!plan.execution.nativeRouteHash) {
    throw new Error(
      "Campaign terminal authority requires a frozen native route"
    );
  }
  const diagnostic = plan.execution.diagnosticFinalization;
  if (
    diagnostic &&
    canonical(
      readDiagnosticFinalizationPlan({
        file: diagnostic.file,
        sha256: diagnostic.sha256,
      })
    ) !== canonical(diagnostic)
  ) {
    throw new Error("Campaign diagnostic identity changed");
  }
  const matches = plan.requests.filter(
    (entry) => entry.requestId === requestId
  );
  if (matches.length !== 1) {
    throw new Error(
      "Campaign terminal request identity is not unique in the frozen plan"
    );
  }
  const request = matches[0] as Request;
  const verifiedRoot = verifiedReceiptRoot(request, receiptRoot);
  const out = path.dirname(verifiedRoot);
  // Capture only within this revalidation; no durable flag can issue authority.
  // inspectPrior must still finish parent settlement and native accounting checks.
  const captured: { value: AcceptanceCampaignAuthorEvidence | null } = {
    value: null,
  };
  const receipt = inspectPrior(plan, request, out, (evidence) => {
    captured.value = evidence;
  });
  if (!receipt) {
    if (
      pathEntryExists(request.destination) ||
      pathEntryExists(intentFile(request)) ||
      pathEntryExists(launchFile(request)) ||
      pathEntryExists(outerStartFile(request)) ||
      pathEntryExists(path.join(verifiedRoot, `${request.requestId}.json`))
    ) {
      throw new Error("Campaign request has ambiguous pre-terminal evidence");
    }
    return deepFreeze({
      authorEvidence: null,
      authorEvidenceVerified: false,
      campaignHash: plan.campaignHash,
      deadlineAt: null,
      disposition: "unstarted",
      kind: "iconsmith-verified-campaign-terminal-evidence-report-v1",
      nativeAccountingStatus: "not-started",
      planAuthority: "caller-frozen",
      planHash: expectedPlanHash,
      qualificationGranted: false,
      qualityStatus: null,
      requestId,
      requestIntentHash: null,
      retainedFailureEvidence: null,
      route: plan.execution.route,
      runtimeHash: plan.execution.runtimeHash,
      selectedEvidence: { state: "verified-absent" },
      slotIds: [...request.slotIds],
      terminalStatus: "unstarted",
      toolingHash: plan.execution.toolingHash,
    });
  }
  const intent = readDispatchIntent(plan, request);
  if (receipt.parentSettlement?.quiescent !== true) {
    throw new Error(
      "Campaign terminal parent settlement is not proven quiescent"
    );
  }
  const artifacts = receipt.artifacts as { name: string; sha256: string }[];
  const terminal = receipt.terminal as Record<string, unknown>;
  const produced = artifacts.length > 0;
  const reportSelectedEvidence = selectedEvidenceReport(
    artifacts,
    terminal.status
  );
  const retainedFailureEvidence =
    receipt.outerRefusal === true &&
    typeof receipt.invalidChildOutputHash === "string"
      ? {
          sha256: receipt.invalidChildOutputHash,
          state: "retained-rejected-child" as const,
        }
      : null;
  return deepFreeze({
    authorEvidence: captured.value,
    authorEvidenceVerified: captured.value !== null,
    campaignHash: plan.campaignHash,
    deadlineAt: intent.deadlineAt,
    disposition: produced ? "produced" : "production-unknown",
    kind: "iconsmith-verified-campaign-terminal-evidence-report-v1",
    nativeAccountingStatus:
      receipt.outerRefusal === true
        ? receipt.nativeAccountingStatus
        : "settled",
    planAuthority: "caller-frozen",
    planHash: expectedPlanHash,
    qualificationGranted: false,
    qualityStatus:
      typeof terminal.qualityStatus === "string"
        ? terminal.qualityStatus
        : null,
    requestId,
    requestIntentHash: sha(readFileSync(intentFile(request))),
    retainedFailureEvidence,
    route: plan.execution.route,
    runtimeHash: plan.execution.runtimeHash,
    selectedEvidence: reportSelectedEvidence,
    slotIds: [...request.slotIds],
    terminalStatus: terminal.status as "delivered" | "incomplete" | "refused",
    toolingHash: plan.execution.toolingHash,
  });
};
/**
 * Issues terminal evidence against a plan identity already frozen and trusted by
 * the caller. This validates terminal bytes; it does not establish plan authority.
 */
export const verifyCampaignTerminalEvidence = async (input: {
  plan: Plan;
  expectedPlanHash: string;
  requestId: string;
  receiptRoot: string;
  /** Required for author provenance; bytes must match the caller-frozen revision. */
  revisionFile?: string;
}): Promise<CampaignTerminalEvidenceCapability> => {
  const report = buildCampaignTerminalEvidenceReport(
    input.plan,
    input.expectedPlanHash,
    input.requestId,
    input.receiptRoot
  );
  const reportHash = sha(canonical(report));
  let verifiedRevisionFile: string | null = null;
  if (report.authorEvidenceVerified) {
    if (!input.revisionFile) {
      throw new Error(
        "Author provenance requires the frozen style revision file"
      );
    }
    const request = input.plan.requests.find(
      (entry) => entry.requestId === input.requestId
    );
    const receipt = strictJsonFile(
      path.join(input.receiptRoot, `${input.requestId}.json`)
    );
    if (!request || typeof receipt.terminal?.selectedAttempt !== "string") {
      throw new Error("Author provenance has no selected rendering");
    }
    verifiedRevisionFile = path.resolve(input.revisionFile);
    await verifyLocalRenderEvidence({
      expectedConcept: request.familyPacket ? request.concept : undefined,
      expectedRevisionHash: input.plan.revisionHash,
      familyPacket: request.familyPacket ?? undefined,
      master: String(request.master),
      revisionFile: input.revisionFile,
      selectedDirectory: receipt.terminal.selectedAttempt,
    });
    const after = buildCampaignTerminalEvidenceReport(
      input.plan,
      input.expectedPlanHash,
      input.requestId,
      input.receiptRoot
    );
    if (sha(canonical(after)) !== reportHash) {
      throw new Error(
        "Campaign evidence changed during rendering verification"
      );
    }
  }
  const capability = Object.freeze({
    kind: "iconsmith-campaign-terminal-evidence-capability-v1" as const,
  });
  terminalCapabilities.set(capability, {
    expectedPlanHash: input.expectedPlanHash,
    plan: input.plan,
    receiptRoot: path.resolve(input.receiptRoot),
    reportHash,
    requestId: input.requestId,
    revisionFile: verifiedRevisionFile,
  });
  return capability;
};
export const readCampaignTerminalEvidence = (
  capability: CampaignTerminalEvidenceCapability
): CampaignTerminalEvidenceReport => {
  const state = terminalCapabilities.get(capability);
  if (!state) {
    throw new Error(
      "Campaign terminal evidence capability is not process-local authority"
    );
  }
  if (state.revisionFile) {
    const request = state.plan.requests.find(
      (entry) => entry.requestId === state.requestId
    );
    const inputs = [
      { file: state.revisionFile, sha256: state.plan.revisionHash },
      ...(request?.familyPacket ? [request.familyPacket] : []),
    ];
    for (const input of inputs) {
      const info = lstatSync(input.file);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.nlink !== 1 ||
        realpathSync(input.file) !== path.resolve(input.file) ||
        sha(readFileSync(input.file)) !== input.sha256
      ) {
        throw new Error(
          "Campaign rendering input changed after capability issuance"
        );
      }
    }
  }
  const report = buildCampaignTerminalEvidenceReport(
    state.plan,
    state.expectedPlanHash,
    state.requestId,
    state.receiptRoot
  );
  if (sha(canonical(report)) !== state.reportHash) {
    throw new Error(
      "Campaign terminal evidence changed after capability issuance"
    );
  }
  return report;
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
// eslint-disable-next-line complexity
export const runLocalCampaign = async (o: Options) => {
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
  if (existsSync(o.out)) {
    for (const request of plan.requests) {
      const receipt = loadReceipt(plan, request, o.out);
      if (!receipt && existsSync(outerStartFile(request))) {
        throw new Error("Unsettled outer dispatch blocks campaign resume");
      }
      if (receipt?.parentSettlement?.quiescent === false) {
        throw new Error("Unproven outer settlement blocks campaign resume");
      }
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
      scheduled: campaignStopped(plan, o.out, false)
        ? []
        : pending.slice(0, o.maxRequests),
    };
  }
  if (!existsSync(o.out)) {
    mkdirSync(o.out);
    mkdirSync(path.join(o.out, "requests"));
    mkdirSync(path.join(o.out, "receipts"));
    writeDurableJson(lock, plan);
  }
  const ownedProcess = o.ownedProcess ?? runOwnedProcess;
  const results = [];
  let dispatched = 0;
  for (const request of plan.requests) {
    if (campaignStopped(plan, o.out)) {
      break;
    }
    const prior = inspectPrior(plan, request, o.out);
    if (prior) {
      const receiptFile = path.join(
        o.out,
        "receipts",
        `${request.requestId}.json`
      );
      if (prior.recoveredAfterInterruption && !existsSync(receiptFile)) {
        writeDurableJson(receiptFile, prior);
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
    const diagnostic = plan.execution.diagnosticFinalization;
    const selectedDiagnostic =
      diagnostic &&
      diagnostic.plan.target.concept === request.concept &&
      diagnostic.plan.target.family === request.family &&
      diagnostic.plan.target.master === String(request.master)
        ? diagnostic
        : undefined;
    if (selectedDiagnostic && selectedDiagnostic.plan.expiresAt <= Date.now()) {
      throw new Error("Diagnostic finalization plan expired before dispatch");
    }
    const intent = intentFile(request);
    const launchPath = launchFile(request);
    let expectedIntent: DispatchIntent;
    let freshIntent = false;
    if (existsSync(intent)) {
      validateIntent(plan, request);
      expectedIntent = readDispatchIntent(plan, request);
    } else {
      freshIntent = true;
      expectedIntent = dispatchIntent(plan, request, Date.now());
      if (
        selectedDiagnostic &&
        selectedDiagnostic.plan.expiresAt > expectedIntent.deadlineAt
      ) {
        throw new Error(
          "Diagnostic finalization expiry exceeds the original request deadline"
        );
      }
      writeDurableJson(intent, expectedIntent);
    }
    const args = [
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
      "--library-hash",
      plan.libraryHash,
      "--library-set",
      "blode-icons",
      ...(request.familyPacket
        ? ["--family-packet", request.familyPacket.file]
        : []),
      "--max-wall-ms",
      String(request.maxWallMs),
      "--deadline-at",
      String(expectedIntent.deadlineAt),
      "--codex",
      plan.execution.authorCommand,
      "--model",
      plan.execution.authorModel,
      ...(plan.execution.nativeRouteHash
        ? [
            "--stop-file",
            plan.execution.campaignStopFile,
            "--native-route",
            plan.execution.runtimeFile,
            "--native-route-hash",
            plan.execution.nativeRouteHash,
          ]
        : ["--runtime-manifest", plan.execution.runtimeFile]),
      ...(selectedDiagnostic
        ? [
            "--diagnostic-finalization-plan",
            selectedDiagnostic.file,
            "--diagnostic-finalization-plan-sha256",
            selectedDiagnostic.sha256,
            "--campaign-hash",
            plan.campaignHash,
            "--family",
            request.family,
            ...request.slotIds.flatMap((slotId) => ["--slot-id", slotId]),
          ]
        : []),
      "--request-id",
      request.requestId,
      "--tooling-hash",
      plan.execution.toolingHash,
    ];
    if (!freshIntent && !existsSync(launchPath)) {
      throw new Error(
        `Dispatch intent has no immutable launch descriptor: ${request.requestId}`
      );
    }
    if (
      productionToolingIdentity(o.generator).hash !== plan.execution.toolingHash
    ) {
      throw new Error(
        "Production source closure changed before generator dispatch"
      );
    }
    const expectedLaunch = captureLaunchDescriptor({
      args,
      command: process.execPath,
      concurrency: o.concurrency,
      cwd: process.cwd(),
      deadlineAt: expectedIntent.deadlineAt,
      identity: {
        configHash: plan.campaignHash,
        effort: plan.execution.authorReasoningEffort,
        model: plan.execution.authorModel,
        routeHash: plan.execution.toolingHash,
      },
      sourceFiles: [
        ...plan.tooling.files.map(({ name }) =>
          path.resolve(path.dirname(path.dirname(o.generator)), name)
        ),
        o.generator,
        o.manifestFile,
        o.revisionFile,
        o.runtimeFile,
        request.meaningsFile,
        ...(request.familyPacket ? [request.familyPacket.file] : []),
        ...(diagnostic ? [diagnostic.file] : []),
      ],
      sourceTrees: [o.library],
    });
    const launch = existsSync(launchPath)
      ? JSON.parse(readFileSync(launchPath, "utf-8"))
      : expectedLaunch;
    if (canonical(launch) !== canonical(expectedLaunch)) {
      throw new Error(
        `Launch descriptor does not match current dispatch: ${request.requestId}`
      );
    }
    if (!existsSync(launchPath)) {
      writeDurableJson(launchPath, launch);
    }
    const dispatchBudgetMs =
      expectedIntent.deadlineAt - Date.now() - PARENT_SETTLEMENT_RESERVE_MS;
    if (dispatchBudgetMs <= 0) {
      results.push({
        ...writeOuterRefusal(
          plan,
          request,
          o.out,
          {
            error: new Error(
              "Parent settlement reserve exhausted before dispatch"
            ),
            signal: null,
            status: null,
          } as ReturnType<typeof spawnSync>,
          "Parent settlement reserve exhausted before generator dispatch"
        ),
        skipped: false,
      });
      break;
    }
    // Exclusive host-owned intent precedes the async provider boundary. A crash
    // after this write is ambiguous and must never silently launch again.
    writeDurableJson(outerStartFile(request), {
      campaignHash: plan.campaignHash,
      deadlineAt: expectedIntent.deadlineAt,
      launchHash: sha(readFileSync(launchPath)),
      requestId: request.requestId,
      startedAt: Date.now(),
    });
    dispatched += 1;
    let parentSettlement: ProcessResult | undefined;
    // Sequential by frozen concurrency=1; settlement must precede the next dispatch.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const child = await executeLaunchDescriptor(launch, async (descriptor) => {
      if (o.spawn) {
        return o.spawn(descriptor.executable, descriptor.args, {
          cwd: descriptor.cwd,
          encoding: "utf-8",
          timeout: dispatchBudgetMs,
        });
      }
      try {
        parentSettlement = await ownedProcess({
          args: descriptor.args,
          command: descriptor.executable,
          cwd: descriptor.cwd,
          env: process.env,
          maxBuffer: 20 * 1024 * 1024,
          timeoutMs: dispatchBudgetMs,
        });
      } catch (error) {
        parentSettlement = {
          code: null,
          killed: false,
          quiescent: false,
          stderr: String(error),
          stdout: "",
        };
      }
      let settlementError: Error | undefined;
      if (parentSettlement.quiescent !== true) {
        settlementError = new Error("Outer generator settlement is unproven");
      } else if (parentSettlement.killed) {
        settlementError = new Error("Outer generator was interrupted");
      }
      return {
        error: settlementError,
        signal: null,
        status:
          typeof parentSettlement.code === "number"
            ? parentSettlement.code
            : null,
        stderr: parentSettlement.stderr,
        stdout: parentSettlement.stdout,
      } as ReturnType<typeof spawnSync>;
    });
    if (parentSettlement && parentSettlement.quiescent !== true) {
      results.push({
        ...writeOuterRefusal(
          plan,
          request,
          o.out,
          child,
          "Outer generator settlement is unproven; child artifacts are ineligible",
          { ...parentSettlement, quiescent: false }
        ),
        skipped: false,
      });
      break;
    }
    if (
      request.familyPacket &&
      (!existsSync(request.familyPacket.file) ||
        !lstatSync(request.familyPacket.file).isFile() ||
        realpathSync(request.familyPacket.file) !== request.familyPacket.file ||
        sha(readFileSync(request.familyPacket.file)) !==
          request.familyPacket.sha256)
    ) {
      results.push({
        ...writeOuterRefusal(
          plan,
          request,
          o.out,
          child,
          "Family packet changed during generator execution; child artifacts are ineligible",
          parentSettlement
        ),
        skipped: false,
      });
      break;
    }
    let diagnosticStable = true;
    if (diagnostic) {
      try {
        diagnosticStable =
          canonical(
            readDiagnosticFinalizationPlan({
              file: diagnostic.file,
              sha256: diagnostic.sha256,
            })
          ) === canonical(diagnostic);
      } catch {
        diagnosticStable = false;
      }
    }
    if (!diagnosticStable) {
      results.push({
        ...writeOuterRefusal(
          plan,
          request,
          o.out,
          child,
          "Diagnostic finalization plan changed during generator execution; child artifacts are ineligible",
          parentSettlement
        ),
        skipped: false,
      });
      break;
    }
    let sourceClosureStable = false;
    try {
      sourceClosureStable =
        productionToolingIdentity(o.generator).hash ===
        plan.execution.toolingHash;
    } catch {
      // Removed or unreadable source is drift, never eligible child evidence.
    }
    if (!sourceClosureStable) {
      results.push({
        ...writeOuterRefusal(
          plan,
          request,
          o.out,
          child,
          "Production source closure changed during generator execution; child artifacts are ineligible",
          parentSettlement
        ),
        skipped: false,
      });
      break;
    }
    const parentCompletedAt = Date.now();
    const requestFile = path.join(request.destination, "request.json");
    if (!existsSync(requestFile)) {
      results.push({
        ...writeOuterRefusal(
          plan,
          request,
          o.out,
          child,
          "Generator returned without a terminal receipt",
          parentSettlement
        ),
        skipped: false,
      });
      continue;
    }
    let bytes: Buffer;
    let terminal: Record<string, unknown>;
    try {
      bytes = readFileSync(requestFile);
      terminal = JSON.parse(bytes.toString()) as Record<string, unknown>;
      if (!isTerminal(terminal, request)) {
        throw new Error("Generator receipt is not terminal");
      }
      validateOutput(plan, request, terminal);
      if (
        plan.execution.nativeRouteHash &&
        parentSettlement?.quiescent !== true
      ) {
        throw new Error(
          "Native child terminal requires owned parent process settlement"
        );
      }
      validateNativeAccounting(plan, request, expectedIntent);
      if (parentCompletedAt >= expectedIntent.deadlineAt) {
        throw new Error("Generator settled after the original parent deadline");
      }
      if (
        terminal.status === "delivered" &&
        (child.status !== 0 ||
          (child.signal !== null && child.signal !== undefined) ||
          (child.error !== null && child.error !== undefined) ||
          parentCompletedAt >= expectedIntent.deadlineAt)
      ) {
        throw new Error(
          "Delivered output requires a clean, parent-observed on-time child exit"
        );
      }
    } catch (error) {
      results.push({
        ...writeOuterRefusal(
          plan,
          request,
          o.out,
          child,
          `Invalid generator output: ${String(error)}`,
          parentSettlement
        ),
        skipped: false,
      });
      continue;
    }
    const artifacts = validateOutput(plan, request, terminal);
    const nativeAccounting = validateNativeAccounting(
      plan,
      request,
      expectedIntent
    );
    const unsignedReceipt = {
      aiQualified: false,
      artifacts,
      campaignHash: plan.campaignHash,
      childError: child.error ? String(child.error) : null,
      childExitCode: child.status,
      childSignal: child.signal ?? null,
      nativeAccountingHash: nativeAccounting
        ? receiptHash(nativeAccounting)
        : null,
      outerStartHash: outerStartHash(request),
      parentCompletedAt,
      parentSettlement: parentSettlement ?? null,
      requestFileHash: sha(bytes),
      requestId: request.requestId,
      slotIds: request.slotIds,
      terminal,
    };
    const receipt = {
      ...unsignedReceipt,
      integrityHash: receiptHash(unsignedReceipt),
    };
    writeDurableJson(
      path.join(o.out, "receipts", `${request.requestId}.json`),
      receipt
    );
    results.push({ ...receipt, skipped: false });
  }
  const ledger = makeLedger(frozen, plan, o.out);
  writeDurableJson(path.join(o.out, "campaign-ledger.json"), ledger, "replace");
  return { campaignHash: plan.campaignHash, dispatched, ledger, results };
};
if (process.argv[1] === import.meta.filename) {
  const { values } = parseArgs({
    options: {
      "author-command": { type: "string" },
      "author-model": { type: "string" },
      concurrency: { type: "string" },
      "diagnostic-finalization-plan": { type: "string" },
      "diagnostic-finalization-plan-sha256": { type: "string" },
      execute: { default: false, type: "boolean" },
      "family-packets": { type: "string" },
      generator: { type: "string" },
      library: { type: "string" },
      manifest: { type: "string" },
      "max-requests": { type: "string" },
      meanings: { type: "string" },
      "native-route-hash": { type: "string" },
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
  const result = await runLocalCampaign({
    authorCommand: values["author-command"],
    authorModel: values["author-model"],
    concurrency: Number(values.concurrency),
    diagnosticFinalizationPlanFile: values["diagnostic-finalization-plan"]
      ? path.resolve(values["diagnostic-finalization-plan"])
      : undefined,
    diagnosticFinalizationPlanSha256:
      values["diagnostic-finalization-plan-sha256"],
    execute: values.execute,
    familyPacketsDirectory: values["family-packets"]
      ? path.resolve(values["family-packets"])
      : undefined,
    generator: path.resolve(values.generator ?? ""),
    library: path.resolve(values.library ?? ""),
    manifestFile: path.resolve(values.manifest ?? ""),
    maxRequests: Number(values["max-requests"]),
    meaningsDirectory: path.resolve(values.meanings ?? ""),
    nativeRouteHash: values["native-route-hash"],
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

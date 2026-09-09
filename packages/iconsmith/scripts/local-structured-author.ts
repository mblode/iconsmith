/** Host-orchestrated structured author contender. It is not a default route. */
import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { z } from "zod";

import type {
  AdapterTraceBinding,
  VerifiedInterruptedNativeCall,
} from "./local-native-call-factory.js";
import { consumeFactoryIssuedAdapterTrace } from "./local-native-call-factory.js";
import { validateNativeCodexTrace } from "./local-native-trace.js";
import { admitNativeStage } from "./review-budget.js";

export const STRUCTURED_AUTHOR_MODEL = "claude-opus-5";
export const STRUCTURED_FINAL_STAGES_RESERVE_MS = 90_000;
export const STRUCTURED_INSPECTION_RESERVE_MS = 150_000;
export const STRUCTURED_INITIAL_CONSTRUCTION_CAP_MS = 240_000;

const defectSchema = z
  .object({
    description: z.string().min(1),
    finish: z.enum(["outlined", "filled"]),
    id: z.string().min(1),
    kind: z.enum(["representation", "visual"]),
    treatment: z.string().min(1),
  })
  .strict();
const constructionSchema = z
  .object({
    addressedDefectIds: z.array(z.string()),
    programs: z.record(z.enum(["outlined", "filled"]), z.string().min(1)),
  })
  .strict();
const inspectionSchema = z
  .object({
    defects: z.array(defectSchema),
    inspectionEvidence: z.string().min(1),
    uncertainties: z
      .array(
        z.object({ description: z.string().min(1), finish: z.string().min(1) })
      )
      .default([]),
  })
  .strict();
const finalReviewSchema = z
  .object({
    reviewMarkdown: z.string().min(1),
    unresolved: z.array(
      z
        .object({
          description: z.string().min(1),
          id: z.string().min(1),
          kind: z.enum(["representation", "visual"]),
        })
        .strict()
    ),
  })
  .strict();

export type StructuredFinish = "outlined" | "filled";
type Finish = StructuredFinish;
export type StructuredDefect = z.infer<typeof defectSchema>;
type Defect = StructuredDefect;
type Construction = z.infer<typeof constructionSchema>;
export type StructuredInspection = z.infer<typeof inspectionSchema>;
type Inspection = StructuredInspection;

export interface StructuredFinalizationInterruption {
  inspectionHash: string;
  kind: "structured-finalization-interruption";
  programHashes: Readonly<Partial<Record<Finish, string>>>;
  settlement: VerifiedInterruptedNativeCall;
  stageDeadlineAt: number;
}

export interface StructuredFinalizationEnvelope {
  interruption: StructuredFinalizationInterruption;
  kind: "structured-finalization-envelope";
  review: unknown;
}

export interface CollectorSealedStructuredAuthorCall {
  collectorTrace: AdapterTraceBinding;
  interruption?: StructuredFinalizationInterruption;
  kind: "collector-sealed-structured-author-call-v1";
}

export interface CollectorSealedStructuredInspectionCall {
  collectorTrace: AdapterTraceBinding;
  kind: "collector-sealed-structured-inspection-v1";
}

export interface VerifiedAuthorCallEvidence {
  emittedModel: string;
  emittedSessionId: string;
  intentFile: string;
  intentHash: string;
  interrupted: boolean;
  lifecycleRequestFile: string;
  lifecycleRequestSha256: string;
  nativeStage: string;
  requestSha256: string;
  role: "construct" | "repair" | "finalizer";
  settlementSha256: string;
  structuredResponseSha256: string;
  stdoutSha256: string;
  terminalSha256: string;
  traceReceiptFile: string;
  traceReceiptSha256: string;
  traceSha256: string;
}

export interface VerifiedInspectionEvidence {
  adapterRequestSha256: string;
  collectorRequestId: string;
  emittedModel: string;
  emittedSessionId: string;
  intentHash: string;
  lifecycleRequestSha256: string;
  nativeStage: string;
  programHashes: Readonly<Partial<Record<Finish, string>>>;
  proofHashes: Readonly<Partial<Record<Finish, string>>>;
  rawAnswersSha256: string;
  settlementSha256: string;
  stageDeadlineAt: number;
  stdoutSha256: string;
  terminalSha256: string;
  traceReceiptFile: string;
  traceReceiptSha256: string;
  traceSha256: string;
}

export interface StructuredHostCheck {
  proofs: Readonly<Partial<Record<Finish, Uint8Array>>>;
  status: number | null;
  stderr: string;
  stdout: string;
}

export interface StructuredAuthorOptions {
  /** Author completion cap; the original deadline still binds every provider intent. */
  completionDeadlineAt?: number;
  check: (cwd: string) => Promise<StructuredHostCheck>;
  construct: (request: {
    collectorRequestId: string;
    defects: readonly Defect[];
    deadlineAt: number;
    model: string;
    previousPrograms: Readonly<Partial<Record<Finish, string>>>;
    prompt: string;
    stage: "construct" | "repair";
  }) => Promise<unknown>;
  deadlineAt: number;
  finalize: (request: {
    collectorRequestId: string;
    deadlineAt: number;
    inspection: Readonly<{
      defects: readonly Defect[];
      inspectionEvidence: string;
      uncertainties: readonly { description: string; finish: string }[];
    }>;
    inspectionTraceReceiptSha256?: string | null;
    model: string;
    programHashes: Readonly<Partial<Record<Finish, string>>>;
  }) => Promise<unknown>;
  finishes: readonly Finish[];
  inspect: (request: {
    collectorRequestId?: string;
    deadlineAt: number;
    lifecycleRequestSha256?: string;
    model: string;
    programHashes: Readonly<Partial<Record<Finish, string>>>;
    proofs: Readonly<Partial<Record<Finish, Uint8Array>>>;
    proofHashes: Readonly<Partial<Record<Finish, string>>>;
  }) => Promise<unknown>;
  /** Previously generated programs whose exact source hashes are independently frozen. */
  initialPrograms?: Readonly<Partial<Record<Finish, string>>>;
  initialProgramProvenance?: {
    programHashes: Readonly<Partial<Record<Finish, string>>>;
    source: string;
    sourceSha256: string;
  };
  /** Host-compiler correction attempts, separate from inspected visual repairs. */
  maxCompilerRepairs?: number;
  /** Repairs of named defects from a host-valid visual inspection. */
  maxRepairs?: number;
  model?: string;
  out: string;
  prompt: string;
}

const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

const proofHashes = (
  finishes: readonly Finish[],
  proofs: StructuredHostCheck["proofs"]
) =>
  Object.fromEntries(
    finishes.map((finish) => {
      const proof = proofs[finish];
      if (!proof) {
        throw new Error(`Host checker omitted ${finish} proof`);
      }
      return [finish, digest(proof)];
    })
  );

const compilerDiagnosticFinish = (
  stdout: string,
  finishes: readonly Finish[]
): Finish => {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "findings" in parsed &&
      Array.isArray(parsed.findings)
    ) {
      for (const finding of parsed.findings) {
        if (
          typeof finding === "object" &&
          finding !== null &&
          "severity" in finding &&
          finding.severity === "error" &&
          "finish" in finding &&
          (finding.finish === "outlined" || finding.finish === "filled") &&
          finishes.includes(finding.finish)
        ) {
          return finding.finish;
        }
      }
    }
  } catch {
    // Unstructured checker output remains bound into the defect description.
  }
  return finishes[0] ?? "outlined";
};

const requireTime = (deadlineAt: number) => {
  if (Date.now() >= deadlineAt) {
    throw new Error("Structured author deadline exhausted");
  }
};

// The value used by the lifecycle is re-read from collector-sealed response
// bytes. Fields supplied by an injected callback never become author evidence.
// oxlint-disable-next-line eslint/complexity -- every receipt authority and byte binding is checked together.
const unwrapCollectorSealedCall = (
  value: unknown,
  expectedRole: VerifiedAuthorCallEvidence["role"],
  expectedLifecycleRequestSha256: string
): {
  evidence?: VerifiedAuthorCallEvidence;
  interruption?: StructuredFinalizationInterruption;
  value: unknown;
} => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    value.kind !== "collector-sealed-structured-author-call-v1"
  ) {
    return { value };
  }
  const envelope = value as CollectorSealedStructuredAuthorCall;
  const binding = envelope.collectorTrace;
  consumeFactoryIssuedAdapterTrace(binding);
  const author = binding.authorInvocation;
  if (
    !author ||
    author.role !== expectedRole ||
    author.lifecycleRequestSha256 !== expectedLifecycleRequestSha256
  ) {
    throw new Error("Collector author trace role did not match the lifecycle");
  }
  for (const file of [
    binding.file,
    binding.receiptFile,
    author.intentFile,
    author.lifecycleRequestFile,
    author.requestFile,
    author.structuredResponseFile,
    author.settlementFile,
    author.terminalFile,
    ...(author.diagnosticTrigger
      ? [
          author.diagnosticTrigger.descriptorFile,
          author.diagnosticTrigger.file,
          author.diagnosticTrigger.identityFile,
        ]
      : []),
  ]) {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new Error("Collector author evidence must be owned regular files");
    }
  }
  const receiptBytes = readFileSync(binding.receiptFile);
  const responseBytes = readFileSync(author.structuredResponseFile);
  const receipt = JSON.parse(receiptBytes.toString("utf-8"));
  if (
    digest(receiptBytes) !== binding.receiptSha256 ||
    digest(readFileSync(binding.file)) !== binding.sha256 ||
    digest(
      JSON.stringify(JSON.parse(readFileSync(author.intentFile, "utf-8")))
    ) !== author.intentHash ||
    digest(readFileSync(author.lifecycleRequestFile)) !==
      author.lifecycleRequestSha256 ||
    digest(readFileSync(author.requestFile)) !== author.requestSha256 ||
    digest(responseBytes) !== author.structuredResponseSha256 ||
    digest(readFileSync(author.settlementFile)) !== author.settlementSha256 ||
    digest(readFileSync(author.terminalFile)) !== author.terminalSha256 ||
    (author.interrupted &&
      (!author.diagnosticTrigger ||
        digest(readFileSync(author.diagnosticTrigger.descriptorFile)) !==
          author.diagnosticTrigger.descriptorSha256 ||
        digest(readFileSync(author.diagnosticTrigger.file)) !==
          author.diagnosticTrigger.sha256 ||
        digest(readFileSync(author.diagnosticTrigger.identityFile)) !==
          author.diagnosticTrigger.identitySha256)) ||
    (!author.interrupted && author.diagnosticTrigger !== undefined) ||
    JSON.stringify(receipt.authorInvocation) !== JSON.stringify(author) ||
    receipt.traceSha256 !== binding.sha256 ||
    receipt.model !== receipt.emittedModel ||
    receipt.kind !== "collector-owned-adapter-trace-v1"
  ) {
    throw new Error("Collector author evidence bytes did not bind exactly");
  }
  return {
    evidence: {
      emittedModel: receipt.emittedModel,
      emittedSessionId: author.emittedSessionId,
      intentFile: author.intentFile,
      intentHash: author.intentHash,
      interrupted: author.interrupted,
      lifecycleRequestFile: author.lifecycleRequestFile,
      lifecycleRequestSha256: author.lifecycleRequestSha256,
      nativeStage: receipt.nativeStage,
      requestSha256: author.requestSha256,
      role: author.role,
      settlementSha256: author.settlementSha256,
      stdoutSha256: author.stdoutSha256,
      structuredResponseSha256: author.structuredResponseSha256,
      terminalSha256: author.terminalSha256,
      traceReceiptFile: binding.receiptFile,
      traceReceiptSha256: binding.receiptSha256,
      traceSha256: binding.sha256,
    },
    ...(envelope.interruption ? { interruption: envelope.interruption } : {}),
    value: (() => {
      const parsed = JSON.parse(responseBytes.toString("utf-8"));
      if (
        expectedRole !== "finalizer" &&
        typeof parsed === "object" &&
        parsed !== null &&
        "programs" in parsed &&
        typeof parsed.programs === "object" &&
        parsed.programs !== null
      ) {
        return {
          ...parsed,
          programs: Object.fromEntries(
            Object.entries(parsed.programs).filter(
              ([, program]) => program !== null
            )
          ),
        };
      }
      return parsed;
    })(),
  };
};

const sealedInspectionAnswersSchema = z
  .object({
    answers: z.record(
      z
        .object({
          choice: z.enum(["pass", "fail", "uncertain"]),
          evidence: z.string().min(1),
          treatment: z.string(),
        })
        .strict()
    ),
  })
  .strict();

// Inspection authority is consumed separately from geometry-contributor traces.
// oxlint-disable-next-line eslint/complexity -- all bound collector bytes are checked together.
const unwrapCollectorSealedInspection = (
  value: unknown,
  expected: {
    collectorRequestId: string;
    lifecycleRequestSha256: string;
    model: string;
    programHashes: Readonly<Partial<Record<Finish, string>>>;
    proofHashes: Readonly<Partial<Record<Finish, string>>>;
    stageDeadlineAt: number;
  },
  finishes: readonly Finish[]
): { evidence?: VerifiedInspectionEvidence; value: unknown } => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    value.kind !== "collector-sealed-structured-inspection-v1"
  ) {
    return { value };
  }
  const binding = (value as CollectorSealedStructuredInspectionCall)
    .collectorTrace;
  consumeFactoryIssuedAdapterTrace(binding);
  const inspection = binding.inspectionInvocation;
  if (
    !inspection ||
    inspection.collectorRequestId !== expected.collectorRequestId ||
    inspection.lifecycleRequestSha256 !== expected.lifecycleRequestSha256
  ) {
    throw new Error(
      "Collector inspection trace did not match the lifecycle request"
    );
  }
  for (const file of [
    binding.file,
    binding.receiptFile,
    inspection.adapterRequestFile,
    inspection.intentFile,
    inspection.rawAnswersFile,
    inspection.settlementFile,
    inspection.terminalFile,
  ]) {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new Error(
        "Collector inspection evidence must be owned regular files"
      );
    }
  }
  const receiptBytes = readFileSync(binding.receiptFile);
  const requestBytes = readFileSync(inspection.adapterRequestFile);
  const answersBytes = readFileSync(inspection.rawAnswersFile);
  const receipt = JSON.parse(receiptBytes.toString("utf-8"));
  const adapterRequest = JSON.parse(requestBytes.toString("utf-8"));
  if (
    digest(receiptBytes) !== binding.receiptSha256 ||
    digest(readFileSync(binding.file)) !== binding.sha256 ||
    digest(requestBytes) !== inspection.adapterRequestSha256 ||
    digest(answersBytes) !== inspection.rawAnswersSha256 ||
    digest(
      JSON.stringify(JSON.parse(readFileSync(inspection.intentFile, "utf-8")))
    ) !== inspection.intentHash ||
    digest(readFileSync(inspection.settlementFile)) !==
      inspection.settlementSha256 ||
    digest(readFileSync(inspection.terminalFile)) !==
      inspection.terminalSha256 ||
    JSON.stringify(receipt.inspectionInvocation) !==
      JSON.stringify(inspection) ||
    receipt.traceSha256 !== binding.sha256 ||
    receipt.model !== receipt.emittedModel ||
    receipt.model !== expected.model ||
    receipt.kind !== "collector-owned-adapter-trace-v1" ||
    adapterRequest.model !== expected.model ||
    adapterRequest.deadlineAt !== expected.stageDeadlineAt ||
    adapterRequest.inspectionLifecycle?.collectorRequestId !==
      expected.collectorRequestId ||
    adapterRequest.inspectionLifecycle?.lifecycleRequestSha256 !==
      expected.lifecycleRequestSha256 ||
    JSON.stringify(adapterRequest.inspectionLifecycle?.programHashes) !==
      JSON.stringify(expected.programHashes) ||
    JSON.stringify(adapterRequest.inspectionLifecycle?.proofHashes) !==
      JSON.stringify(expected.proofHashes) ||
    JSON.stringify(
      Object.entries(adapterRequest.evidenceHashes ?? {}).map(
        ([name, sha256]) => ({ name, sha256 })
      )
    ) !== JSON.stringify(receipt.orderedAttachments) ||
    finishes.some(
      (finish) =>
        adapterRequest.evidenceHashes?.[`${finish}-proof.png`] !==
        expected.proofHashes[finish]
    )
  ) {
    throw new Error("Collector inspection evidence bytes did not bind exactly");
  }
  const { answers } = sealedInspectionAnswersSchema.parse(
    JSON.parse(answersBytes.toString("utf-8"))
  );
  const expectedIds = finishes.map((finish) => `author-self-review-${finish}`);
  if (
    Object.keys(answers).length !== expectedIds.length ||
    expectedIds.some((id) => !answers[id])
  ) {
    throw new Error("Collector inspection answers did not cover every paint");
  }
  const mapped = {
    defects: Object.entries(answers).flatMap(([id, answer]) =>
      answer.choice === "fail"
        ? [
            {
              description: answer.evidence,
              finish: id.replace("author-self-review-", ""),
              id,
              kind: "visual" as const,
              treatment:
                answer.treatment || "Repair only the named visible region.",
            },
          ]
        : []
    ),
    inspectionEvidence: Object.values(answers)
      .map((answer) => answer.evidence)
      .join(" "),
    uncertainties: Object.entries(answers).flatMap(([id, answer]) =>
      answer.choice === "uncertain"
        ? [
            {
              description: answer.evidence,
              finish: id.replace("author-self-review-", ""),
            },
          ]
        : []
    ),
  };
  return {
    evidence: {
      adapterRequestSha256: inspection.adapterRequestSha256,
      collectorRequestId: inspection.collectorRequestId,
      emittedModel: receipt.emittedModel,
      emittedSessionId: inspection.emittedSessionId,
      intentHash: inspection.intentHash,
      lifecycleRequestSha256: inspection.lifecycleRequestSha256,
      nativeStage: receipt.nativeStage,
      programHashes: { ...expected.programHashes },
      proofHashes: { ...expected.proofHashes },
      rawAnswersSha256: inspection.rawAnswersSha256,
      settlementSha256: inspection.settlementSha256,
      stageDeadlineAt: expected.stageDeadlineAt,
      stdoutSha256: inspection.stdoutSha256,
      terminalSha256: inspection.terminalSha256,
      traceReceiptFile: binding.receiptFile,
      traceReceiptSha256: binding.receiptSha256,
      traceSha256: binding.sha256,
    },
    value: mapped,
  };
};

export interface StructuredAuthorEvidenceReplay {
  evidenceReceiptSha256s: readonly string[];
  kind: "replayed-collector-sealed-author-lineage-v1";
  structuralReplayVerified: true;
}

const replayRecord = (value: unknown, message: string) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
};

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[]
) =>
  JSON.stringify(Object.keys(value).toSorted()) ===
  JSON.stringify([...keys].toSorted());

const replayFile = (file: unknown, rootDirectory?: string) => {
  if (typeof file !== "string" || !path.isAbsolute(file)) {
    throw new Error("Collector replay path must be absolute");
  }
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error("Collector replay evidence must be an owned regular file");
  }
  const actual = realpathSync(file);
  if (rootDirectory) {
    const root = realpathSync(rootDirectory);
    const relative = path.relative(root, actual);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("Collector replay evidence escaped its bounded root");
    }
  }
  return readFileSync(actual);
};

const replayJson = (bytes: Uint8Array, message: string) => {
  try {
    return replayRecord(
      JSON.parse(Buffer.from(bytes).toString("utf-8")),
      message
    );
  } catch (error) {
    throw new Error(message, { cause: error });
  }
};

const replayCollectorReceipt = (
  evidence: Record<string, unknown>,
  rootDirectory?: string
) => {
  const receiptBytes = replayFile(evidence.traceReceiptFile, rootDirectory);
  if (digest(receiptBytes) !== evidence.traceReceiptSha256) {
    throw new Error("Collector replay receipt hash changed");
  }
  const receipt = replayJson(
    receiptBytes,
    "Collector replay receipt is invalid"
  );
  if (
    receipt.kind !== "collector-owned-adapter-trace-v1" ||
    receipt.traceSha256 !== evidence.traceSha256 ||
    receipt.emittedModel !== evidence.emittedModel ||
    receipt.model !== evidence.emittedModel ||
    receipt.nativeStage !== evidence.nativeStage ||
    typeof receipt.traceFile !== "string" ||
    path.basename(receipt.traceFile) !== receipt.traceFile
  ) {
    throw new Error("Collector replay receipt identity did not bind exactly");
  }
  const traceFile = path.join(
    path.dirname(evidence.traceReceiptFile as string),
    receipt.traceFile
  );
  const traceBytes = replayFile(traceFile, rootDirectory);
  if (digest(traceBytes) !== evidence.traceSha256) {
    throw new Error("Collector replay trace bytes changed");
  }
  return {
    receipt,
    receiptSha256: digest(receiptBytes),
    trace: Buffer.from(traceBytes).toString("utf-8"),
  };
};

const replayAttachments = (value: unknown) => {
  if (!Array.isArray(value)) {
    throw new TypeError("Collector replay attachments are invalid");
  }
  return value.map((item) => {
    const attachment = replayRecord(
      item,
      "Collector replay attachment is invalid"
    );
    if (
      typeof attachment.name !== "string" ||
      typeof attachment.sha256 !== "string" ||
      !/^[a-f\d]{64}$/u.test(attachment.sha256)
    ) {
      throw new TypeError("Collector replay attachment identity is invalid");
    }
    return { name: attachment.name, sha256: attachment.sha256 };
  });
};

// oxlint-disable-next-line eslint/complexity -- settlement replay rejects every invalid terminal combination together.
const replaySettlement = (
  invocation: Record<string, unknown>,
  nativeStage: unknown,
  interrupted: boolean,
  authorBinding: {
    lifecycleBytes: Uint8Array;
    requestBytes: Uint8Array;
    responseText: string;
  },
  options: {
    expectedDeadlineAt: number;
    expectedRequestId: string;
    rootDirectory: string;
  }
) => {
  const intentBytes = replayFile(invocation.intentFile, options.rootDirectory);
  const settlementBytes = replayFile(
    invocation.settlementFile,
    options.rootDirectory
  );
  const terminalBytes = replayFile(
    invocation.terminalFile,
    options.rootDirectory
  );
  const intent = replayJson(intentBytes, "Collector replay intent is invalid");
  const settlement = replayJson(
    settlementBytes,
    "Collector replay settlement is invalid"
  );
  const terminal = replayJson(
    terminalBytes,
    "Collector replay terminal is invalid"
  );
  const container = replayRecord(
    settlement.container,
    "Collector replay container settlement is invalid"
  );
  const process = replayRecord(
    container.process,
    "Collector replay process settlement is invalid"
  );
  const intentHash = digest(JSON.stringify(intent));
  if (
    intent.stage !== nativeStage ||
    intent.requestId !== options.expectedRequestId ||
    intent.deadlineAt !== options.expectedDeadlineAt ||
    intentHash !== invocation.intentHash ||
    digest(settlementBytes) !== invocation.settlementSha256 ||
    digest(terminalBytes) !== invocation.terminalSha256 ||
    settlement.intentHash !== intentHash ||
    terminal.intentHash !== intentHash ||
    terminal.evidenceHash !== invocation.settlementSha256 ||
    terminal.accounting !== "settled" ||
    terminal.containment !== "container-absent" ||
    terminal.deadlineExceeded !== false ||
    container.containerAbsent !== true ||
    process.quiescent !== true ||
    digest(String(process.stdout ?? "")) !== invocation.stdoutSha256 ||
    (interrupted
      ? container.status !== "workload-failed" || terminal.outcome !== "failed"
      : container.status !== "complete" ||
        terminal.outcome !== "complete" ||
        process.code !== 0 ||
        process.killed !== false)
  ) {
    throw new Error("Collector replay settlement did not bind exactly");
  }
  const stdout = String(process.stdout ?? "");
  if (!interrupted) {
    if (invocation.diagnosticTrigger !== undefined) {
      throw new Error(
        "Collector replay complete call carried a diagnostic trigger"
      );
    }
    return stdout;
  }
  const diagnostic = replayRecord(
    invocation.diagnosticTrigger,
    "Collector replay diagnostic trigger is missing"
  );
  if (
    !hasExactKeys(diagnostic, [
      "descriptorFile",
      "descriptorSha256",
      "file",
      "identityFile",
      "identitySha256",
      "sha256",
      "terminalLineSha256",
    ])
  ) {
    throw new Error("Collector replay diagnostic trigger binding changed");
  }
  const descriptorBytes = replayFile(
    diagnostic.descriptorFile,
    options.rootDirectory
  );
  const triggerBytes = replayFile(diagnostic.file, options.rootDirectory);
  const identityBytes = replayFile(
    diagnostic.identityFile,
    options.rootDirectory
  );
  const descriptor = replayJson(
    descriptorBytes,
    "Collector replay diagnostic descriptor is invalid"
  );
  const trigger = replayJson(
    triggerBytes,
    "Collector replay diagnostic trigger is invalid"
  );
  const identity = replayJson(
    identityBytes,
    "Collector replay diagnostic container identity is invalid"
  );
  const lifecycle = replayJson(
    authorBinding.lifecycleBytes,
    "Collector replay finalization lifecycle is invalid"
  );
  const request = replayJson(
    authorBinding.requestBytes,
    "Collector replay finalization request is invalid"
  );
  if (
    !hasExactKeys(descriptor, [
      "createdAt",
      "diagnosticId",
      "descriptorReceipt",
      "expectedImage",
      "expiresAt",
      "kind",
      "originalDeadlineAt",
      "requestId",
      "reservationHash",
      "routeHash",
      "schemaVersion",
    ]) ||
    !hasExactKeys(trigger, [
      "action",
      "callId",
      "containerId",
      "containerName",
      "descriptorHash",
      "finalizedReceiptHash",
      "image",
      "inspectionHash",
      "intentHash",
      "observedAt",
      "originalDeadlineAt",
      "ownershipTokenHash",
      "parsedFinalReviewSha256",
      "programHashes",
      "requestId",
      "reservationHash",
      "responseSchemaHash",
      "routeHash",
      "stage",
      "stageDeadlineAt",
      "terminalLineSha256",
    ]) ||
    digest(descriptorBytes) !== diagnostic.descriptorSha256 ||
    digest(triggerBytes) !== diagnostic.sha256 ||
    digest(identityBytes) !== diagnostic.identitySha256 ||
    trigger.descriptorHash !== diagnostic.descriptorSha256 ||
    trigger.terminalLineSha256 !== diagnostic.terminalLineSha256 ||
    descriptor.descriptorReceipt !== diagnostic.descriptorFile ||
    descriptor.kind !== "native-finalization-interruption-diagnostic" ||
    descriptor.schemaVersion !== 1 ||
    descriptor.requestId !== intent.requestId ||
    descriptor.reservationHash !== intent.reservationHash ||
    descriptor.routeHash !== intent.routeHash ||
    descriptor.originalDeadlineAt !== options.expectedDeadlineAt ||
    trigger.action !== "diagnostic-kill" ||
    trigger.callId !== intent.callId ||
    trigger.containerId !== container.containerId ||
    trigger.containerId !== identity.containerId ||
    trigger.containerName !== identity.containerName ||
    trigger.image !== descriptor.expectedImage ||
    trigger.image !== identity.image ||
    trigger.intentHash !== intentHash ||
    trigger.originalDeadlineAt !== descriptor.originalDeadlineAt ||
    trigger.requestId !== intent.requestId ||
    trigger.reservationHash !== intent.reservationHash ||
    trigger.routeHash !== intent.routeHash ||
    trigger.stage !== nativeStage ||
    trigger.finalizedReceiptHash !== invocation.requestSha256 ||
    trigger.inspectionHash !== digest(JSON.stringify(lifecycle.inspection)) ||
    JSON.stringify(trigger.programHashes) !==
      JSON.stringify(
        Object.entries(
          replayRecord(
            lifecycle.programHashes,
            "Collector replay finalization program hashes are invalid"
          )
        ).toSorted(([left], [right]) => left.localeCompare(right))
      ) ||
    trigger.responseSchemaHash !== digest(JSON.stringify(request.schema)) ||
    trigger.stageDeadlineAt !== lifecycle.deadlineAt ||
    trigger.stageDeadlineAt !== request.stageDeadlineAt ||
    typeof trigger.observedAt !== "number" ||
    !Number.isSafeInteger(trigger.observedAt) ||
    typeof descriptor.createdAt !== "number" ||
    !Number.isSafeInteger(descriptor.createdAt) ||
    typeof descriptor.expiresAt !== "number" ||
    !Number.isSafeInteger(descriptor.expiresAt) ||
    typeof trigger.stageDeadlineAt !== "number" ||
    typeof descriptor.originalDeadlineAt !== "number" ||
    descriptor.createdAt > trigger.observedAt ||
    trigger.observedAt >= descriptor.expiresAt ||
    trigger.observedAt >= trigger.stageDeadlineAt ||
    trigger.stageDeadlineAt > descriptor.originalDeadlineAt ||
    typeof terminal.settledAt !== "number" ||
    !Number.isSafeInteger(terminal.settledAt) ||
    terminal.settledAt < trigger.observedAt ||
    trigger.ownershipTokenHash !== digest(String(identity.ownershipToken ?? ""))
  ) {
    throw new Error("Collector replay diagnostic trigger did not bind exactly");
  }
  const terminalLines = stdout
    .split("\n")
    .filter((line) => digest(line) === diagnostic.terminalLineSha256);
  if (terminalLines.length !== 1) {
    throw new Error("Collector replay diagnostic terminal line changed");
  }
  const terminalEvent = replayJson(
    Buffer.from(terminalLines[0] ?? ""),
    "Collector replay diagnostic terminal line is invalid"
  );
  const terminalItem = replayRecord(
    terminalEvent.item,
    "Collector replay diagnostic terminal item is invalid"
  );
  let parsedFinalReview: unknown;
  try {
    parsedFinalReview = JSON.parse(String(terminalItem.text ?? ""));
  } catch (error) {
    throw new Error("Collector replay diagnostic final review is invalid", {
      cause: error,
    });
  }
  if (
    terminalEvent.type !== "item.completed" ||
    terminalItem.type !== "agent_message" ||
    terminalItem.text !== authorBinding.responseText ||
    digest(JSON.stringify(parsedFinalReview)) !==
      trigger.parsedFinalReviewSha256
  ) {
    throw new Error("Collector replay diagnostic final review changed");
  }
  return stdout;
};

const replayFinalAgentMessage = (stdout: string) => {
  let events: Record<string, unknown>[];
  try {
    events = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) =>
        replayRecord(JSON.parse(line), "Collector stdout event is invalid")
      );
  } catch (error) {
    throw new Error("Collector replay stdout is not valid JSONL", {
      cause: error,
    });
  }
  const messages = events.flatMap((event) => {
    const item =
      typeof event.item === "object" && event.item !== null
        ? (event.item as Record<string, unknown>)
        : undefined;
    return event.type === "item.completed" &&
      item?.type === "agent_message" &&
      typeof item.text === "string"
      ? [item.text]
      : [];
  });
  const parsed = messages.flatMap((message, index) => {
    try {
      JSON.parse(message);
      return [{ index, message }];
    } catch {
      return [];
    }
  });
  if (parsed.length !== 1 || parsed[0]?.index !== messages.length - 1) {
    throw new Error(
      "Collector replay stdout lacks one final structured message"
    );
  }
  return parsed[0].message;
};

// Root/campaign code separately owns selected-tree and parent accounting authority.
// oxlint-disable-next-line eslint/complexity -- ancestry replay is one fail-closed boundary.
export const replayStructuredAuthorEvidence = (
  value: unknown,
  options: {
    expectedDeadlineAt: number;
    expectedRequestId: string;
    rootDirectory: string;
  }
): StructuredAuthorEvidenceReplay => {
  const receipt = replayRecord(value, "Structured author receipt is invalid");
  const evidence = replayRecord(
    receipt.authorEvidence,
    "Structured author receipt lacks collector evidence"
  );
  const programHashes = replayRecord(
    receipt.programHashes,
    "Structured author program hashes are invalid"
  );
  const replayProofHashes = replayRecord(
    receipt.proofHashes,
    "Structured author proof hashes are invalid"
  );
  const contributors = replayRecord(
    evidence.contributors,
    "Structured author contributors are invalid"
  );
  const missing = replayRecord(
    evidence.missingContributorStages,
    "Structured author missing-contributor evidence is invalid"
  );
  const inspectionEvidence = replayRecord(
    evidence.inspection,
    "Structured author inspection evidence is missing"
  );
  const inspectionValue = inspectionSchema.parse(evidence.inspectionValue);
  const completionEvidence = replayRecord(
    evidence.completion,
    "Structured author finalizer evidence is missing"
  );
  if (
    evidence.kind !== "collector-sealed-author-lineage-v1" ||
    evidence.status !== "collector-sealed-requires-downstream-replay" ||
    evidence.verifiedForProduction !== false ||
    typeof receipt.model !== "string" ||
    receipt.deadlineAt !== options.expectedDeadlineAt ||
    !Number.isSafeInteger(receipt.completionDeadlineAt) ||
    (receipt.completionDeadlineAt as number) > options.expectedDeadlineAt ||
    !Object.keys(programHashes).length ||
    JSON.stringify(Object.keys(programHashes)) !==
      JSON.stringify(Object.keys(replayProofHashes)) ||
    Object.values(programHashes).some(
      (hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash)
    ) ||
    Object.values(replayProofHashes).some(
      (hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash)
    )
  ) {
    throw new Error("Structured author collector evidence is not replayable");
  }

  const receiptHashes = new Set<string>();
  const sessions = new Map<string, string>();
  const remember = (entry: Record<string, unknown>, receiptHash: string) => {
    if (typeof entry.emittedSessionId !== "string") {
      throw new TypeError("Collector replay session identity is missing");
    }
    const prior = sessions.get(entry.emittedSessionId);
    if (prior && prior !== receiptHash) {
      throw new Error(
        "Collector replay reused a session across distinct calls"
      );
    }
    sessions.set(entry.emittedSessionId, receiptHash);
    receiptHashes.add(receiptHash);
  };
  const replayAuthor = (
    entry: Record<string, unknown>,
    expectedRole: string
  ) => {
    const replayed = replayCollectorReceipt(entry, options.rootDirectory);
    const invocation = replayRecord(
      replayed.receipt.authorInvocation,
      "Collector replay author invocation is missing"
    );
    for (const key of [
      "emittedSessionId",
      "intentHash",
      "interrupted",
      "lifecycleRequestFile",
      "lifecycleRequestSha256",
      "requestSha256",
      "role",
      "settlementSha256",
      "structuredResponseSha256",
      "stdoutSha256",
      "terminalSha256",
    ]) {
      if (entry[key] !== invocation[key]) {
        throw new Error(
          "Collector replay author summary did not match receipt"
        );
      }
    }
    if (entry.role !== expectedRole || entry.emittedModel !== receipt.model) {
      throw new Error("Collector replay author role or model did not match");
    }
    const lifecycleBytes = replayFile(
      invocation.lifecycleRequestFile,
      options.rootDirectory
    );
    const requestBytes = replayFile(
      invocation.requestFile,
      options.rootDirectory
    );
    const responseBytes = replayFile(
      invocation.structuredResponseFile,
      options.rootDirectory
    );
    if (
      digest(lifecycleBytes) !== invocation.lifecycleRequestSha256 ||
      digest(requestBytes) !== invocation.requestSha256 ||
      digest(responseBytes) !== invocation.structuredResponseSha256
    ) {
      throw new Error("Collector replay author bytes changed");
    }
    const responseText = Buffer.from(responseBytes).toString("utf-8");
    const stdout = replaySettlement(
      invocation,
      replayed.receipt.nativeStage,
      invocation.interrupted === true,
      { lifecycleBytes, requestBytes, responseText },
      options
    );
    const stdoutAnswer = replayFinalAgentMessage(stdout);
    if (stdoutAnswer !== responseText) {
      throw new Error(
        "Collector replay author response did not come from stdout"
      );
    }
    if (
      !["images", "sealed-text"].includes(String(replayed.receipt.evidenceMode))
    ) {
      throw new Error("Collector replay author evidence mode is invalid");
    }
    validateNativeCodexTrace(replayed.trace, {
      evidenceMode:
        replayed.receipt.evidenceMode === "images" ? "images" : "sealed-text",
      expectedAttachments: replayAttachments(
        replayed.receipt.orderedAttachments
      ),
      expectedFinalAnswer: stdoutAnswer,
      expectedModel: entry.emittedModel as string,
      expectedSessionId: entry.emittedSessionId as string,
    });
    remember(entry, replayed.receiptSha256);
    return {
      lifecycle: replayJson(
        lifecycleBytes,
        "Collector replay lifecycle request is invalid"
      ),
      response: replayJson(
        responseBytes,
        "Collector replay author response is invalid"
      ),
    };
  };

  for (const [finish, selectedHash] of Object.entries(programHashes)) {
    if (
      !Array.isArray(contributors[finish]) ||
      !Array.isArray(missing[finish])
    ) {
      throw new TypeError("Structured author paint ancestry is incomplete");
    }
    const paintContributors = contributors[finish] as unknown[];
    if ((missing[finish] as unknown[]).length || !paintContributors.length) {
      throw new Error(
        "Structured author paint ancestry has missing collector seals"
      );
    }
    let lastProgram: unknown;
    const seen = new Set<string>();
    for (const item of paintContributors) {
      const contributor = replayRecord(
        item,
        "Collector contributor is invalid"
      );
      if (
        (contributor.role !== "construct" && contributor.role !== "repair") ||
        typeof contributor.traceReceiptSha256 !== "string" ||
        seen.has(contributor.traceReceiptSha256)
      ) {
        throw new Error("Collector contributor lineage is ambiguous");
      }
      seen.add(contributor.traceReceiptSha256);
      const author = replayAuthor(contributor, contributor.role);
      if (
        author.lifecycle.model !== receipt.model ||
        author.lifecycle.stage !== contributor.role ||
        typeof author.lifecycle.collectorRequestId !== "string" ||
        !Number.isSafeInteger(author.lifecycle.deadlineAt) ||
        (author.lifecycle.deadlineAt as number) >
          (receipt.completionDeadlineAt as number) ||
        digest(JSON.stringify(author.lifecycle)) !==
          contributor.lifecycleRequestSha256
      ) {
        throw new Error("Collector contributor lifecycle did not bind exactly");
      }
      lastProgram = replayRecord(
        author.response.programs,
        "Collector contributor response omitted programs"
      )[finish];
    }
    if (
      typeof lastProgram !== "string" ||
      digest(lastProgram) !== selectedHash
    ) {
      throw new Error(
        "Collector contributor ancestry did not produce selected program"
      );
    }
  }

  const inspectionReplay = replayCollectorReceipt(
    inspectionEvidence,
    options.rootDirectory
  );
  const inspectionInvocation = replayRecord(
    inspectionReplay.receipt.inspectionInvocation,
    "Collector replay inspection invocation is missing"
  );
  for (const key of [
    "adapterRequestSha256",
    "collectorRequestId",
    "emittedSessionId",
    "intentHash",
    "lifecycleRequestSha256",
    "rawAnswersSha256",
    "settlementSha256",
    "stdoutSha256",
    "terminalSha256",
  ]) {
    if (inspectionEvidence[key] !== inspectionInvocation[key]) {
      throw new Error(
        "Collector replay inspection summary did not match receipt"
      );
    }
  }
  const adapterRequestBytes = replayFile(
    inspectionInvocation.adapterRequestFile,
    options.rootDirectory
  );
  const answerBytes = replayFile(
    inspectionInvocation.rawAnswersFile,
    options.rootDirectory
  );
  if (
    digest(adapterRequestBytes) !== inspectionInvocation.adapterRequestSha256 ||
    digest(answerBytes) !== inspectionInvocation.rawAnswersSha256
  ) {
    throw new Error("Collector replay inspection bytes changed");
  }
  const inspectionStdout = replaySettlement(
    inspectionInvocation,
    inspectionReplay.receipt.nativeStage,
    false,
    {
      lifecycleBytes: Buffer.from("{}"),
      requestBytes: adapterRequestBytes,
      responseText: Buffer.from(answerBytes).toString("utf-8"),
    },
    options
  );
  const inspectionStdoutAnswer = replayFinalAgentMessage(inspectionStdout);
  validateNativeCodexTrace(inspectionReplay.trace, {
    evidenceMode: "images",
    expectedAttachments: replayAttachments(
      inspectionReplay.receipt.orderedAttachments
    ),
    expectedFinalAnswer: inspectionStdoutAnswer,
    expectedModel: inspectionEvidence.emittedModel as string,
    expectedSessionId: inspectionEvidence.emittedSessionId as string,
  });
  remember(inspectionEvidence, inspectionReplay.receiptSha256);
  const expectedInspectionLifecycle = {
    collectorRequestId: inspectionEvidence.collectorRequestId,
    deadlineAt: inspectionEvidence.stageDeadlineAt,
    model: receipt.model,
    programHashes,
    proofHashes: replayProofHashes,
  };
  const adapterRequest = replayJson(
    adapterRequestBytes,
    "Collector replay inspection request is invalid"
  );
  if (
    adapterRequest.model !== receipt.model ||
    adapterRequest.deadlineAt !== inspectionEvidence.stageDeadlineAt ||
    !Number.isSafeInteger(inspectionEvidence.stageDeadlineAt) ||
    (inspectionEvidence.stageDeadlineAt as number) >
      (receipt.completionDeadlineAt as number) ||
    digest(JSON.stringify(expectedInspectionLifecycle)) !==
      inspectionEvidence.lifecycleRequestSha256 ||
    JSON.stringify(adapterRequest.inspectionLifecycle) !==
      JSON.stringify({
        collectorRequestId: inspectionEvidence.collectorRequestId,
        lifecycleRequestSha256: inspectionEvidence.lifecycleRequestSha256,
        programHashes,
        proofHashes: replayProofHashes,
      })
  ) {
    throw new Error(
      "Collector replay inspection lifecycle did not bind exactly"
    );
  }
  const evidenceHashes = replayRecord(
    adapterRequest.evidenceHashes,
    "Collector replay inspection attachments are invalid"
  );
  if (
    JSON.stringify(
      Object.entries(evidenceHashes).map(([name, sha256]) => ({ name, sha256 }))
    ) !== JSON.stringify(inspectionReplay.receipt.orderedAttachments)
  ) {
    throw new Error("Collector replay inspection attachment order changed");
  }
  for (const [finish, proofHash] of Object.entries(replayProofHashes)) {
    if (evidenceHashes[`${finish}-proof.png`] !== proofHash) {
      throw new Error("Collector replay inspection omitted an exact proof");
    }
  }
  const { answers } = sealedInspectionAnswersSchema.parse(
    JSON.parse(Buffer.from(answerBytes).toString("utf-8"))
  );
  const stdoutAnswers = replayRecord(
    replayJson(
      Buffer.from(inspectionStdoutAnswer),
      "Collector replay inspection stdout answer is invalid"
    ).answers,
    "Collector replay inspection stdout omitted answers"
  );
  if (JSON.stringify(stdoutAnswers) !== JSON.stringify(answers)) {
    throw new Error(
      "Collector replay inspection answers did not come from stdout"
    );
  }
  const expectedAnswerIds = Object.keys(programHashes).map(
    (finish) => `author-self-review-${finish}`
  );
  if (
    Object.keys(answers).length !== expectedAnswerIds.length ||
    expectedAnswerIds.some((id) => !answers[id])
  ) {
    throw new Error("Collector replay inspection answers are incomplete");
  }
  const replayedInspection = inspectionSchema.parse({
    defects: Object.entries(answers).flatMap(([id, answer]) =>
      answer.choice === "fail"
        ? [
            {
              description: answer.evidence,
              finish: id.replace("author-self-review-", ""),
              id,
              kind: "visual" as const,
              treatment:
                answer.treatment || "Repair only the named visible region.",
            },
          ]
        : []
    ),
    inspectionEvidence: Object.values(answers)
      .map((answer) => answer.evidence)
      .join(" "),
    uncertainties: Object.entries(answers).flatMap(([id, answer]) =>
      answer.choice === "uncertain"
        ? [
            {
              description: answer.evidence,
              finish: id.replace("author-self-review-", ""),
            },
          ]
        : []
    ),
  });
  if (JSON.stringify(replayedInspection) !== JSON.stringify(inspectionValue)) {
    throw new Error("Collector replay inspection mapping changed");
  }

  const finalizer = replayAuthor(completionEvidence, "finalizer");
  if (
    !Number.isSafeInteger(finalizer.lifecycle.deadlineAt) ||
    (finalizer.lifecycle.deadlineAt as number) >
      (receipt.completionDeadlineAt as number) ||
    JSON.stringify(finalizer.lifecycle) !==
      JSON.stringify({
        collectorRequestId: finalizer.lifecycle.collectorRequestId,
        deadlineAt: finalizer.lifecycle.deadlineAt,
        inspection: inspectionValue,
        inspectionTraceReceiptSha256: inspectionEvidence.traceReceiptSha256,
        model: receipt.model,
        programHashes,
      })
  ) {
    throw new Error(
      "Collector replay finalization did not bind accepted evidence"
    );
  }
  finalReviewSchema.parse(finalizer.response);
  return Object.freeze({
    evidenceReceiptSha256s: Object.freeze([...receiptHashes].toSorted()),
    kind: "replayed-collector-sealed-author-lineage-v1" as const,
    structuralReplayVerified: true as const,
  });
};

// Interrupted salvage must reject every partially matching provenance shape.
// oxlint-disable-next-line eslint/complexity
const unwrapFinalization = (
  value: unknown,
  options: {
    deadlineAt: number;
    inspection: Inspection;
    programHashes: Readonly<Partial<Record<Finish, string>>>;
    stageDeadlineAt: number;
  }
) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    value.kind !== "structured-finalization-envelope"
  ) {
    return { interruption: undefined, review: value };
  }
  const envelope = value as StructuredFinalizationEnvelope;
  const { interruption } = envelope;
  const settlement = interruption?.settlement;
  if (
    interruption?.kind !== "structured-finalization-interruption" ||
    interruption.stageDeadlineAt !== options.stageDeadlineAt ||
    interruption.inspectionHash !==
      digest(JSON.stringify(options.inspection)) ||
    JSON.stringify(interruption.programHashes) !==
      JSON.stringify(options.programHashes) ||
    settlement?.kind !== "verified-contained-finalization-interruption" ||
    !/^\d{2}-finalize$/u.test(settlement.stage) ||
    settlement.deadlineAt !== options.deadlineAt ||
    settlement.settledAt >= options.stageDeadlineAt ||
    settlement.accounting !== "settled" ||
    settlement.containment !== "container-absent" ||
    settlement.containerAbsent !== true ||
    settlement.quiescent !== true ||
    settlement.outcome !== "failed"
  ) {
    throw new Error("Interrupted finalization provenance did not bind exactly");
  }
  return { interruption, review: envelope.review };
};

const validatePrograms = (
  construction: Construction,
  finishes: readonly Finish[],
  defects: readonly Defect[]
) => {
  if (finishes.some((finish) => !construction.programs[finish])) {
    throw new Error("Structured author omitted a requested paint program");
  }
  if (
    defects.length > 0 &&
    (construction.addressedDefectIds.length === 0 ||
      construction.addressedDefectIds.some(
        (id) => !defects.some((defect) => defect.id === id)
      ))
  ) {
    throw new Error("Repair did not identify only host-observed defect IDs");
  }
};

// The linear lifecycle keeps every fail-closed transition visible in one place.
// oxlint-disable-next-line eslint/complexity
export const runStructuredAuthor = async (options: StructuredAuthorOptions) => {
  const completionDeadlineAt =
    options.completionDeadlineAt ?? options.deadlineAt;
  if (
    !Number.isSafeInteger(options.deadlineAt) ||
    !Number.isSafeInteger(completionDeadlineAt) ||
    completionDeadlineAt > options.deadlineAt ||
    completionDeadlineAt <= Date.now()
  ) {
    throw new Error(
      "Structured author completion cap must be original-deadline bounded"
    );
  }

  /* oxlint-disable eslint/no-await-in-loop, eslint/no-loop-func, oxc/no-accumulating-spread -- each repair depends on the prior checked proof. */
  const recovery = options.initialPrograms !== undefined;
  const requestedRepairs = options.maxRepairs ?? 1;
  const requestedCompilerRepairs =
    options.maxCompilerRepairs ?? (recovery ? 0 : 1);
  if (
    !Number.isInteger(requestedRepairs) ||
    requestedRepairs < 0 ||
    !Number.isInteger(requestedCompilerRepairs) ||
    requestedCompilerRepairs < 0
  ) {
    throw new Error(
      "Structured author repair limits must be nonnegative integers"
    );
  }
  if (
    !options.finishes.length ||
    new Set(options.finishes).size !== options.finishes.length
  ) {
    throw new Error("Structured author needs distinct requested paints");
  }
  mkdirSync(options.out, { recursive: false });
  const save = (name: string, value: unknown) =>
    writeFileSync(path.join(options.out, name), JSON.stringify(value, null, 2));
  const scheduleStartedAt = Date.now();
  let recoverySourceValid = !recovery;
  if (recovery && options.initialProgramProvenance?.source) {
    try {
      const { source } = options.initialProgramProvenance;
      recoverySourceValid =
        path.isAbsolute(source) &&
        digest(readFileSync(source)) ===
          options.initialProgramProvenance.sourceSha256;
    } catch {
      recoverySourceValid = false;
    }
  }
  if (
    recovery &&
    (requestedRepairs !== 0 ||
      requestedCompilerRepairs !== 0 ||
      !options.initialProgramProvenance?.source.trim() ||
      !recoverySourceValid ||
      options.finishes.some(
        (finish) =>
          !options.initialPrograms?.[finish] ||
          options.initialProgramProvenance?.programHashes[finish] !==
            digest(options.initialPrograms[finish] ?? "")
      ))
  ) {
    throw new Error(
      "Initial programs require exact frozen provenance and zero repairs"
    );
  }
  const model = options.model ?? STRUCTURED_AUTHOR_MODEL;
  const repairSlots = Math.max(
    0,
    Math.floor(
      (completionDeadlineAt -
        scheduleStartedAt -
        STRUCTURED_INSPECTION_RESERVE_MS -
        STRUCTURED_FINAL_STAGES_RESERVE_MS) /
        90_000
    )
  );
  let compilerRepairsUsed = 0;
  let visualRepairsUsed = 0;
  let retrySlotsUsed = 0;
  let programs: Partial<Record<Finish, string>> = recovery
    ? { ...options.initialPrograms }
    : {};
  let acceptedPrograms: Partial<Record<Finish, string>> = {};
  let inspection: Inspection = {
    defects: [],
    inspectionEvidence: "Not inspected",
    uncertainties: [],
  };
  let acceptedInspection = inspection;
  let inspectionEvidence: VerifiedInspectionEvidence | undefined;
  let acceptedInspectionEvidence: VerifiedInspectionEvidence | undefined;
  let acceptedProgramHashes: Partial<Record<Finish, string>> = {};
  let acceptedProofHashes: Partial<Record<Finish, string>> = {};
  let contributorEvidence: Partial<
    Record<Finish, VerifiedAuthorCallEvidence[]>
  > = {};
  let acceptedContributorEvidence: Partial<
    Record<Finish, VerifiedAuthorCallEvidence[]>
  > = {};
  let missingContributorStages: Partial<Record<Finish, string[]>> = {};
  let acceptedMissingContributorStages: Partial<Record<Finish, string[]>> = {};
  const stages: unknown[] = [];
  const runHostCheck = async () => {
    const now = Date.now();
    const admission = admitNativeStage({
      deadlineAt: completionDeadlineAt,
      maximumMs: Math.max(5000, completionDeadlineAt - now),
      now,
      remainingReserveMs: 0,
      stage: "host-check",
    });
    const checked = await options.check(options.out);
    requireTime(admission.stageDeadlineAt);
    return checked;
  };
  for (let attempt = 0; ; attempt += 1) {
    requireTime(completionDeadlineAt);
    const previousPrograms = { ...programs };
    const constructionDeadlineAt = Math.min(
      completionDeadlineAt -
        STRUCTURED_INSPECTION_RESERVE_MS -
        STRUCTURED_FINAL_STAGES_RESERVE_MS,
      attempt === 0
        ? scheduleStartedAt + STRUCTURED_INITIAL_CONSTRUCTION_CAP_MS
        : Number.POSITIVE_INFINITY
    );
    let construction: Construction;
    try {
      let stageDeadlineAt = constructionDeadlineAt;
      if (!recovery) {
        ({ stageDeadlineAt } = admitNativeStage({
          deadlineAt: completionDeadlineAt,
          maximumMs: STRUCTURED_INITIAL_CONSTRUCTION_CAP_MS,
          now: Date.now(),
          remainingReserveMs: completionDeadlineAt - constructionDeadlineAt,
          stage: attempt === 0 ? "construct" : "repair",
        }));
      }
      if (recovery) {
        construction = { addressedDefectIds: [], programs };
      } else {
        const role = attempt === 0 ? "construct" : "repair";
        const lifecycleRequest = Object.freeze({
          collectorRequestId: randomUUID(),
          deadlineAt: stageDeadlineAt,
          defects: Object.freeze(
            inspection.defects.map((defect) => Object.freeze({ ...defect }))
          ),
          model,
          previousPrograms: Object.freeze({ ...previousPrograms }),
          prompt: options.prompt,
          stage: role,
        } as const);
        const lifecycleRequestSha256 = digest(JSON.stringify(lifecycleRequest));
        const sealed = unwrapCollectorSealedCall(
          await options.construct(lifecycleRequest),
          role,
          lifecycleRequestSha256
        );
        construction = constructionSchema.parse(sealed.value);
        for (const finish of options.finishes) {
          const next = construction.programs[finish];
          if (next === previousPrograms[finish]) {
            continue;
          }
          if (sealed.evidence) {
            contributorEvidence[finish] = [
              ...(contributorEvidence[finish] ?? []),
              sealed.evidence,
            ];
          } else {
            missingContributorStages[finish] = [
              ...(missingContributorStages[finish] ?? []),
              `${String(attempt).padStart(2, "0")}-${role}`,
            ];
          }
        }
      }
      if (!recovery) {
        requireTime(stageDeadlineAt);
      }
      validatePrograms(construction, options.finishes, inspection.defects);
    } catch (error) {
      if (attempt === 0 || Object.keys(acceptedPrograms).length === 0) {
        throw error;
      }
      programs = { ...acceptedPrograms };
      inspection = acceptedInspection;
      inspectionEvidence = acceptedInspectionEvidence;
      contributorEvidence = structuredClone(acceptedContributorEvidence);
      missingContributorStages = structuredClone(
        acceptedMissingContributorStages
      );
      for (const finish of options.finishes) {
        writeFileSync(
          path.join(options.out, `${finish}.icon`),
          programs[finish] ?? ""
        );
      }
      const restored = await runHostCheck();
      const restoredProgramHashes = Object.fromEntries(
        options.finishes.map((finish) => [
          finish,
          digest(readFileSync(path.join(options.out, `${finish}.icon`))),
        ])
      );
      const restoredProofHashes = proofHashes(
        options.finishes,
        restored.proofs
      );
      if (
        restored.status !== 0 ||
        JSON.stringify(restoredProgramHashes) !==
          JSON.stringify(acceptedProgramHashes) ||
        JSON.stringify(restoredProofHashes) !==
          JSON.stringify(acceptedProofHashes)
      ) {
        throw new Error(
          "Failed repair fallback did not reproduce its accepted host proof",
          { cause: error }
        );
      }
      stages.push({
        attempt,
        error: error instanceof Error ? error.message : String(error),
        programHashes: restoredProgramHashes,
        proofHashes: restoredProofHashes,
        status: "repair-invocation-failed-restored",
      });
      break;
    }
    programs = { ...programs, ...construction.programs };
    for (const finish of options.finishes) {
      writeFileSync(
        path.join(options.out, `${finish}.icon`),
        programs[finish] ?? ""
      );
    }
    const checked = await runHostCheck();
    const programHashes = Object.fromEntries(
      options.finishes.map((finish) => [finish, digest(programs[finish] ?? "")])
    );
    if (checked.status !== 0) {
      for (const finish of options.finishes) {
        writeFileSync(
          path.join(options.out, `rejected-attempt-${attempt}-${finish}.icon`),
          programs[finish] ?? ""
        );
      }
      stages.push({ attempt, checked, programHashes, status: "check-failed" });
      if (
        compilerRepairsUsed < requestedCompilerRepairs &&
        retrySlotsUsed < repairSlots
      ) {
        const compilerDiagnostic = JSON.stringify({
          status: checked.status,
          stderr: checked.stderr,
          stdout: checked.stdout,
        });
        inspection = {
          defects: [
            {
              description: compilerDiagnostic,
              finish: compilerDiagnosticFinish(
                checked.stdout,
                options.finishes
              ),
              id: `host-compiler-attempt-${attempt}`,
              kind: "representation",
              treatment:
                "Correct only the constrained DSL representation identified by the exact host compiler diagnostic.",
            },
          ],
          inspectionEvidence:
            "Host compiler rejection; no visual inspection was performed.",
          uncertainties: [],
        };
        compilerRepairsUsed += 1;
        retrySlotsUsed += 1;
        continue;
      }
      if (Object.keys(acceptedPrograms).length > 0) {
        programs = { ...acceptedPrograms };
        inspection = acceptedInspection;
        inspectionEvidence = acceptedInspectionEvidence;
        contributorEvidence = structuredClone(acceptedContributorEvidence);
        missingContributorStages = structuredClone(
          acceptedMissingContributorStages
        );
        for (const finish of options.finishes) {
          writeFileSync(
            path.join(options.out, `${finish}.icon`),
            programs[finish] ?? ""
          );
        }
        const restored = await runHostCheck();
        const restoredProgramHashes = Object.fromEntries(
          options.finishes.map((finish) => [
            finish,
            digest(readFileSync(path.join(options.out, `${finish}.icon`))),
          ])
        );
        const restoredProofHashes = proofHashes(
          options.finishes,
          restored.proofs
        );
        if (
          restored.status !== 0 ||
          JSON.stringify(restoredProgramHashes) !==
            JSON.stringify(acceptedProgramHashes) ||
          JSON.stringify(restoredProofHashes) !==
            JSON.stringify(acceptedProofHashes)
        ) {
          throw new Error(
            "Restored candidate did not reproduce its accepted host proof"
          );
        }
        break;
      }
      throw new Error("No host-valid program survived compiler repair");
    }
    const checkedProofHashes = proofHashes(options.finishes, checked.proofs);
    requireTime(completionDeadlineAt);
    let candidateInspection: Inspection;
    try {
      const inspectionBudget = admitNativeStage({
        deadlineAt: completionDeadlineAt,
        maximumMs: STRUCTURED_INSPECTION_RESERVE_MS,
        now: Date.now(),
        remainingReserveMs: STRUCTURED_FINAL_STAGES_RESERVE_MS,
        stage: "author-inspection",
      });
      const collectorRequestId = randomUUID();
      const lifecycleRequest = Object.freeze({
        collectorRequestId,
        deadlineAt: inspectionBudget.stageDeadlineAt,
        model,
        programHashes: Object.freeze({ ...programHashes }),
        proofHashes: Object.freeze({ ...checkedProofHashes }),
      });
      const lifecycleRequestSha256 = digest(JSON.stringify(lifecycleRequest));
      const proofCopies = Object.fromEntries(
        Object.entries(checked.proofs).map(([finish, proof]) => [
          finish,
          proof ? Uint8Array.from(proof) : proof,
        ])
      );
      const sealedInspection = unwrapCollectorSealedInspection(
        await options.inspect({
          ...lifecycleRequest,
          lifecycleRequestSha256,
          proofs: proofCopies,
        }),
        {
          collectorRequestId,
          lifecycleRequestSha256,
          model,
          programHashes,
          proofHashes: checkedProofHashes,
          stageDeadlineAt: inspectionBudget.stageDeadlineAt,
        },
        options.finishes
      );
      if (
        Object.entries(proofCopies).some(
          ([finish, proof]) =>
            proof && digest(proof) !== checkedProofHashes[finish as Finish]
        )
      ) {
        throw new Error("Inspection callback mutated its exact proof bytes");
      }
      candidateInspection = inspectionSchema.parse(sealedInspection.value);
      inspectionEvidence = sealedInspection.evidence;
      requireTime(inspectionBudget.stageDeadlineAt);
    } catch (error) {
      if (attempt === 0 || Object.keys(acceptedPrograms).length === 0) {
        throw error;
      }
      programs = { ...acceptedPrograms };
      inspection = acceptedInspection;
      inspectionEvidence = acceptedInspectionEvidence;
      contributorEvidence = structuredClone(acceptedContributorEvidence);
      missingContributorStages = structuredClone(
        acceptedMissingContributorStages
      );
      for (const finish of options.finishes) {
        writeFileSync(
          path.join(options.out, `${finish}.icon`),
          programs[finish] ?? ""
        );
      }
      const restored = await runHostCheck();
      const restoredProgramHashes = Object.fromEntries(
        options.finishes.map((finish) => [
          finish,
          digest(readFileSync(path.join(options.out, `${finish}.icon`))),
        ])
      );
      const restoredProofHashes = proofHashes(
        options.finishes,
        restored.proofs
      );
      if (
        restored.status !== 0 ||
        JSON.stringify(restoredProgramHashes) !==
          JSON.stringify(acceptedProgramHashes) ||
        JSON.stringify(restoredProofHashes) !==
          JSON.stringify(acceptedProofHashes)
      ) {
        throw new Error(
          "Failed repair inspection fallback did not reproduce its accepted host proof",
          { cause: error }
        );
      }
      stages.push({
        attempt,
        error: error instanceof Error ? error.message : String(error),
        programHashes: restoredProgramHashes,
        proofHashes: restoredProofHashes,
        status: "repair-inspection-failed-restored",
      });
      break;
    }
    inspection = candidateInspection;
    acceptedInspection = candidateInspection;
    acceptedInspectionEvidence = inspectionEvidence;
    acceptedProgramHashes = programHashes;
    acceptedProofHashes = checkedProofHashes;
    acceptedPrograms = { ...programs };
    acceptedContributorEvidence = structuredClone(contributorEvidence);
    acceptedMissingContributorStages = structuredClone(
      missingContributorStages
    );
    stages.push({
      attempt,
      inspection,
      ...(recovery
        ? { initialProgramProvenance: options.initialProgramProvenance }
        : {}),
      programHashes,
      proofHashes: checkedProofHashes,
      status: "inspected",
    });
    if (inspection.defects.length === 0) {
      break;
    }
    if (
      visualRepairsUsed >= requestedRepairs ||
      retrySlotsUsed >= repairSlots
    ) {
      break;
    }
    visualRepairsUsed += 1;
    retrySlotsUsed += 1;
  }
  if (!Object.keys(programs).length) {
    throw new Error("No host-valid program survived");
  }
  const programHashes = Object.fromEntries(
    options.finishes.map((finish) => [
      finish,
      digest(readFileSync(path.join(options.out, `${finish}.icon`))),
    ])
  );
  const finalCheck = await runHostCheck();
  const finalProofHashes = proofHashes(options.finishes, finalCheck.proofs);
  if (
    finalCheck.status !== 0 ||
    JSON.stringify(programHashes) !== JSON.stringify(acceptedProgramHashes) ||
    JSON.stringify(finalProofHashes) !== JSON.stringify(acceptedProofHashes)
  ) {
    throw new Error("Final programs are not bound to the accepted host proofs");
  }
  requireTime(completionDeadlineAt);
  const finalizationBudget = admitNativeStage({
    deadlineAt: completionDeadlineAt,
    maximumMs: STRUCTURED_FINAL_STAGES_RESERVE_MS,
    now: Date.now(),
    remainingReserveMs: 0,
    stage: "author-finalization",
  });
  const finalizationRequest = Object.freeze({
    collectorRequestId: randomUUID(),
    deadlineAt: finalizationBudget.stageDeadlineAt,
    inspection: Object.freeze({
      defects: Object.freeze(
        inspection.defects.map((defect) => Object.freeze({ ...defect }))
      ),
      inspectionEvidence: inspection.inspectionEvidence,
      uncertainties: Object.freeze(
        inspection.uncertainties.map((uncertainty) =>
          Object.freeze({ ...uncertainty })
        )
      ),
    }),
    inspectionTraceReceiptSha256:
      acceptedInspectionEvidence?.traceReceiptSha256 ?? null,
    model,
    programHashes: Object.freeze({ ...programHashes }),
  } as const);
  const finalizationRequestSha256 = digest(JSON.stringify(finalizationRequest));
  const sealedFinalization = unwrapCollectorSealedCall(
    await options.finalize(finalizationRequest),
    "finalizer",
    finalizationRequestSha256
  );
  const finalization = unwrapFinalization(
    sealedFinalization.interruption
      ? {
          interruption: sealedFinalization.interruption,
          kind: "structured-finalization-envelope",
          review: sealedFinalization.value,
        }
      : sealedFinalization.value,
    {
      deadlineAt: options.deadlineAt,
      inspection,
      programHashes,
      stageDeadlineAt: finalizationBudget.stageDeadlineAt,
    }
  );
  requireTime(finalizationBudget.stageDeadlineAt);
  const review = finalReviewSchema.parse(finalization.review);
  if (
    inspection.defects.some(
      (defect) => !review.unresolved.some((item) => item.id === defect.id)
    )
  ) {
    throw new Error("Final review omitted a surviving inspected defect");
  }
  writeFileSync(
    path.join(options.out, "author-review.json"),
    JSON.stringify({ unresolved: review.unresolved }, null, 2)
  );
  writeFileSync(path.join(options.out, "review.md"), review.reviewMarkdown);
  let status = "delivered";
  const unresolvedVisual = review.unresolved.some(
    (item) => item.kind === "visual"
  );
  const unresolvedRepresentation = review.unresolved.some(
    (item) => item.kind === "representation"
  );
  if (inspection.defects.length || unresolvedVisual) {
    status = "rejected-visible-defects";
  } else if (
    inspection.uncertainties.length ||
    (recovery && unresolvedRepresentation)
  ) {
    status = recovery
      ? "review-pending-uncertainty"
      : "delivered-with-uncertainty";
  }
  for (const finish of options.finishes) {
    const contributors = acceptedContributorEvidence[finish] ?? [];
    if (
      new Set(contributors.map(({ traceReceiptSha256 }) => traceReceiptSha256))
        .size !== contributors.length ||
      contributors.some(
        ({ nativeStage, role }) =>
          role === "finalizer" || !nativeStage.endsWith(`-${role}`)
      )
    ) {
      throw new Error("Collector author contributor lineage is ambiguous");
    }
  }
  if (
    sealedFinalization.evidence &&
    (sealedFinalization.evidence.role !== "finalizer" ||
      !sealedFinalization.evidence.nativeStage.endsWith("-finalize"))
  ) {
    throw new Error("Collector finalizer lineage is ambiguous");
  }
  let authorEvidenceStatus:
    | "collector-sealed-requires-downstream-replay"
    | "missing-collector-seals"
    | "requires-recursive-source-verification" = "missing-collector-seals";
  if (recovery) {
    authorEvidenceStatus = "requires-recursive-source-verification";
  } else if (
    sealedFinalization.evidence &&
    acceptedInspectionEvidence &&
    options.finishes.every(
      (finish) =>
        (acceptedContributorEvidence[finish]?.length ?? 0) > 0 &&
        (acceptedMissingContributorStages[finish]?.length ?? 0) === 0
    )
  ) {
    authorEvidenceStatus = "collector-sealed-requires-downstream-replay";
  }
  const authorEvidence = {
    authority: "process-local-factory-issued",
    completion: sealedFinalization.evidence ?? null,
    contributors: Object.fromEntries(
      options.finishes.map((finish) => [
        finish,
        acceptedContributorEvidence[finish] ?? [],
      ])
    ),
    inspection: acceptedInspectionEvidence ?? null,
    inspectionValue: acceptedInspection,
    kind: "collector-sealed-author-lineage-v1",
    missingContributorStages: Object.fromEntries(
      options.finishes.map((finish) => [
        finish,
        acceptedMissingContributorStages[finish] ?? [],
      ])
    ),
    status: authorEvidenceStatus,
    verifiedForProduction: false,
  };
  const receipt = {
    authorEvidence,
    completionDeadlineAt,
    completionProvenance: finalization.interruption
      ? "host-validated-after-contained-finalization-interruption"
      : "structured-finalization-complete",
    deadlineAt: options.deadlineAt,
    ...(finalization.interruption
      ? { finalizationInterruption: finalization.interruption }
      : {}),
    mechanism: "experimental-injected-adapters",
    model,
    programHashes,
    proofHashes: finalProofHashes,
    repairBudget: {
      compiler: {
        requested: requestedCompilerRepairs,
        used: compilerRepairsUsed,
      },
      totalRetrySlots: repairSlots,
      totalRetrySlotsUsed: retrySlotsUsed,
      visual: { requested: requestedRepairs, used: visualRepairsUsed },
    },
    stages,
    status,
  };
  save("structured-author.json", receipt);
  /* oxlint-enable eslint/no-await-in-loop, eslint/no-loop-func, oxc/no-accumulating-spread */
  return receipt as Omit<typeof receipt, "authorEvidence"> & {
    authorEvidence?: typeof receipt.authorEvidence;
  };
};

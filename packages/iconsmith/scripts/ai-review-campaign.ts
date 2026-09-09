/** Resumable, evidence-bound orchestration for small AI-only review packets. */
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  AI_REVIEW_FINAL_VALIDATION_RESERVE_MS,
  AI_REVIEW_RECOGNITION_ORDER_VERSION,
  buildRecognitionQuestions,
  recognitionQuestionsHash,
  runAiReviewProtocol,
  runProspectiveAiReviewProtocol,
} from "./ai-review-protocol.js";
import type {
  AiProtocolStimulus,
  ProspectiveProtocolReviewer,
  ProtocolReviewer,
} from "./ai-review-protocol.js";
import {
  AI_REVIEW_FREE_RECOGNITION_VERSION,
  freezeSynonymKey,
} from "./quality-labels.js";
import type { SynonymKeyRow } from "./quality-labels.js";

export interface AiReviewRoute {
  command: string;
  id: string;
  invoke: ProtocolReviewer;
  model: string;
}
interface AiReviewPacketRow {
  concept: string;
  familyReferences: readonly string[];
  id: string;
  image: string;
  meanings: readonly string[];
}
export interface AiReviewCampaignInput {
  packetId: string;
  recognitionOrderSeed?: string;
  stimuli: readonly AiReviewPacketRow[];
}

export interface ProspectiveAiReviewRoute {
  adjudicator: {
    baseModelLineage: string;
    command: string;
    id: string;
    invoke: ProspectiveProtocolReviewer;
    model: string;
  };
  baseModelLineage: string;
  command: string;
  id: string;
  invoke: ProspectiveProtocolReviewer;
  model: string;
}

class CampaignStoppedError extends Error {
  override readonly name = "CampaignStoppedError";
}

const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf-8"));
const writeDurableExclusiveJson = (
  directory: string,
  name: string,
  value: unknown
) => {
  const descriptor = openSync(path.join(directory, name), "wx", 0o600);
  try {
    writeFileSync(descriptor, json(value));
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const directoryDescriptor = openSync(directory, "r");
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
};

const artifactTreeHash = (directory: string) => {
  const files = (current: string): { file: string; sha256: string }[] =>
    readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Reviewer artifact tree contains a symlink: ${file}`);
      }
      if (entry.isDirectory()) {
        return files(file);
      }
      const relative = path.relative(directory, file);
      return relative === "terminal.json"
        ? []
        : [{ file: relative, sha256: sha(readFileSync(file)) }];
    });
  return sha(
    JSON.stringify(
      files(directory).toSorted((a, b) => a.file.localeCompare(b.file))
    )
  );
};

const verifyRouteRuntimeBindings = (
  routes: readonly AiReviewRoute[],
  identity: unknown
) => {
  const runtime = identity as {
    manifest?: {
      author?: { executable?: string; sha256?: string };
      reviewer?: { executable?: string; sha256?: string };
    };
  };
  if (!runtime.manifest) {
    return;
  }
  const routeExecutables = routes.map(({ command }) => realpathSync(command));
  // This pins the CLI transport, not reviewer independence. Distinct model and
  // route identities may intentionally share one pinned multi-model CLI.
  const executables = [runtime.manifest.author, runtime.manifest.reviewer].map(
    (entry) => ({
      executable: entry?.executable ? realpathSync(entry.executable) : "",
      sha256: entry?.sha256,
    })
  );
  for (const [index, route] of routes.entries()) {
    const executable = routeExecutables[index] ?? "";
    const match = executables.find((entry) => entry.executable === executable);
    if (!match || match.sha256 !== sha(readFileSync(executable))) {
      throw new Error(
        `Reviewer route does not match frozen runtime: ${route.id}`
      );
    }
  }
};

const freezePacket = (
  input: AiReviewCampaignInput,
  recognitionOrderSeed: string
) => {
  if (
    !/^[a-z0-9-]+$/u.test(input.packetId) ||
    !input.stimuli.length ||
    input.stimuli.length > 20 ||
    new Set(input.stimuli.map(({ id }) => id)).size !== input.stimuli.length ||
    input.stimuli.some(
      ({ concept, id }) => !concept.trim() || !/^[a-z0-9-]+$/u.test(id)
    )
  ) {
    throw new Error("AI review campaign needs one bounded, unique packet");
  }
  const stimuli: AiProtocolStimulus[] = input.stimuli.map((row) => ({
    concept: row.concept,
    familyReferences: row.familyReferences.map((file) =>
      readFileSync(realpathSync(file))
    ),
    id: row.id,
    image: readFileSync(realpathSync(row.image)),
    meanings: [...row.meanings],
  }));
  const recognitionQuestions = buildRecognitionQuestions(
    stimuli,
    recognitionOrderSeed
  );
  const manifest = input.stimuli.map((row, index) => ({
    // The controller commits to the target, while reviewer containers receive
    // only their stage image directory and the ordered alternatives.
    conceptSha256: sha(row.concept),
    familyReferences: row.familyReferences.map((_file, anchor) => ({
      sha256: sha(stimuli[index]?.familyReferences[anchor] ?? new Uint8Array()),
    })),
    id: row.id,
    image: {
      sha256: sha(stimuli[index]?.image ?? new Uint8Array()),
    },
    meanings: [...row.meanings],
    recognitionChoices: recognitionQuestions[index]?.choices,
  }));
  return {
    manifest,
    recognitionQuestionsHash: recognitionQuestionsHash(recognitionQuestions),
    stimuli,
  };
};

const validArtifactHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

export const readAiReviewTerminal = (options: {
  campaignIntentHash: string;
  directory: string;
  model: string;
  originalDeadlineAt?: number;
  routeId: string;
}) => {
  const { campaignIntentHash, directory, model, originalDeadlineAt, routeId } =
    options;
  const terminalFile = path.join(directory, "terminal.json");
  if (!existsSync(terminalFile)) {
    throw new Error(`Ambiguous partial reviewer directory: ${directory}`);
  }
  const terminal = readJson(terminalFile);
  if (
    terminal.intentHash !==
      sha(JSON.stringify({ campaignIntentHash, route: routeId })) ||
    terminal.model !== model ||
    ![
      "complete",
      "recognition-incomplete",
      "craft-incomplete",
      "errored",
      "stopped",
    ].includes(terminal.status) ||
    terminal.qualified !== false ||
    !Number.isFinite(terminal.startedAt) ||
    !Number.isFinite(terminal.deadlineAt) ||
    terminal.deadlineAt <= terminal.startedAt ||
    (originalDeadlineAt !== undefined &&
      terminal.deadlineAt > originalDeadlineAt) ||
    !Number.isFinite(terminal.elapsedMs) ||
    terminal.elapsedMs < 0 ||
    !validArtifactHash(terminal.artifactTreeHash) ||
    terminal.artifactTreeHash !== artifactTreeHash(directory)
  ) {
    throw new Error(
      `Saved reviewer terminal does not match intent: ${directory}`
    );
  }
  if (!["errored", "stopped"].includes(terminal.status)) {
    const resultFile = path.join(directory, "result.json");
    if (
      !existsSync(resultFile) ||
      terminal.resultHash !== sha(JSON.stringify(readJson(resultFile)))
    ) {
      throw new Error(
        `Saved reviewer result does not match terminal: ${directory}`
      );
    }
  }
  return {
    result: ["errored", "stopped"].includes(terminal.status)
      ? null
      : readJson(path.join(directory, "result.json")),
    terminal,
  };
};

// Sequential resume, stop, dispatch-lock and evidence-sealing branches are kept
// together so every provider boundary is guarded by the same state machine.
// oxlint-disable-next-line eslint/complexity
export const runAiReviewCampaign = async (options: {
  execute?: boolean;
  input: AiReviewCampaignInput;
  maxPackets: number;
  originalDeadlineAt?: number;
  out: string;
  perReviewerMaxMs: number;
  routes: readonly AiReviewRoute[];
  runtimeIdentity: unknown;
  stopFile?: string;
  toolingFiles: readonly string[];
  verifyRuntime: (identity: unknown) => unknown;
}) => {
  if (
    !Number.isInteger(options.maxPackets) ||
    options.maxPackets !== 1 ||
    !Number.isFinite(options.perReviewerMaxMs) ||
    options.perReviewerMaxMs <= 0 ||
    options.perReviewerMaxMs > 480_000 ||
    (options.originalDeadlineAt !== undefined &&
      !Number.isSafeInteger(options.originalDeadlineAt)) ||
    options.routes.length < 2 ||
    new Set(options.routes.map(({ id }) => id)).size !==
      options.routes.length ||
    new Set(options.routes.map(({ model }) => model)).size !==
      options.routes.length ||
    options.routes.some(
      ({ command, id, model }) =>
        !command.startsWith("/") || !/^[a-z0-9-]+$/u.test(id) || !model.trim()
    )
  ) {
    throw new Error("AI review campaign needs distinct pinned bounded routes");
  }
  options.verifyRuntime(options.runtimeIdentity);
  verifyRouteRuntimeBindings(options.routes, options.runtimeIdentity);
  if (!options.toolingFiles.length) {
    throw new Error("AI review campaign needs frozen tooling files");
  }
  const readToolingIdentity = () =>
    Object.fromEntries(
      options.toolingFiles.toSorted().map((file) => {
        const resolved = realpathSync(file);
        return [resolved, sha(readFileSync(resolved))];
      })
    );
  const toolingIdentity = readToolingIdentity();
  if (options.stopFile && !path.isAbsolute(options.stopFile)) {
    throw new Error("AI review campaign stop file must be absolute");
  }
  const recognitionOrderSeed =
    options.input.recognitionOrderSeed ??
    sha(`iconsmith-ai-review-order\0${options.input.packetId}`);
  const packet = freezePacket(options.input, recognitionOrderSeed);
  const intent = {
    authority: "AI diagnostic only",
    maxPackets: options.maxPackets,
    packet: packet.manifest,
    packetId: options.input.packetId,
    ...(options.originalDeadlineAt === undefined
      ? {}
      : { originalDeadlineAt: options.originalDeadlineAt }),
    perReviewerMaxMs: options.perReviewerMaxMs,
    qualified: false,
    recognitionOrderSeed,
    recognitionOrderVersion: AI_REVIEW_RECOGNITION_ORDER_VERSION,
    recognitionQuestionsHash: packet.recognitionQuestionsHash,
    routes: options.routes.map(({ command, id, model }) => ({
      command,
      id,
      model,
    })),
    runtimeIdentity: options.runtimeIdentity,
    stopFile: options.stopFile,
    toolingIdentity,
  };
  const intentHash = sha(JSON.stringify(intent));
  if (existsSync(path.join(options.out, "intent.json"))) {
    const saved = readFileSync(path.join(options.out, "intent.json"), "utf-8");
    if (sha(JSON.stringify(JSON.parse(saved))) !== intentHash) {
      throw new Error("AI review campaign intent changed on resume");
    }
  } else {
    mkdirSync(options.out, { recursive: false });
    writeFileSync(path.join(options.out, "intent.json"), json(intent), {
      flag: "wx",
    });
  }
  if (options.execute !== true) {
    return { intentHash, qualified: false, status: "dry-run" as const };
  }
  const stopReceipt = path.join(options.out, "stop.json");
  const campaignStopped = () => {
    if (existsSync(stopReceipt)) {
      return true;
    }
    if (!options.stopFile || !existsSync(options.stopFile)) {
      return false;
    }
    try {
      writeFileSync(
        stopReceipt,
        json({
          intentHash,
          observedAt: Date.now(),
          reason: "stop-sentinel-observed",
          stopFile: options.stopFile,
        }),
        { flag: "wx" }
      );
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "EEXIST" ||
        !existsSync(stopReceipt)
      ) {
        throw error;
      }
    }
    return true;
  };
  const outcomes = [];
  for (const route of options.routes) {
    const directory = path.join(options.out, route.id);
    const dispatchLock = `${directory}.dispatch-lock`;
    const reviewerIntent = { campaignIntentHash: intentHash, route: route.id };
    if (existsSync(dispatchLock)) {
      throw new Error(`Reviewer dispatch is already active: ${route.id}`);
    }
    if (existsSync(directory)) {
      outcomes.push(
        readAiReviewTerminal({
          campaignIntentHash: intentHash,
          directory,
          model: route.model,
          originalDeadlineAt: options.originalDeadlineAt,
          routeId: route.id,
        }).terminal
      );
      continue;
    }
    if (campaignStopped()) {
      outcomes.push({
        model: route.model,
        qualified: false,
        reason: "campaign-stopped-before-dispatch",
        routeId: route.id,
        status: "unstarted" as const,
      });
      continue;
    }
    if (
      options.originalDeadlineAt !== undefined &&
      options.originalDeadlineAt - Date.now() <=
        AI_REVIEW_FINAL_VALIDATION_RESERVE_MS
    ) {
      outcomes.push({
        deadlineAt: options.originalDeadlineAt,
        model: route.model,
        qualified: false,
        reason: "campaign-original-deadline-expired",
        routeId: route.id,
        status: "unstarted" as const,
      });
      continue;
    }
    mkdirSync(dispatchLock, { recursive: false });
    const startedAt = Date.now();
    const deadlineAt = Math.min(
      startedAt + options.perReviewerMaxMs,
      options.originalDeadlineAt ?? Number.POSITIVE_INFINITY
    );
    const verifyDispatchIdentity = () => {
      options.verifyRuntime(options.runtimeIdentity);
      verifyRouteRuntimeBindings(options.routes, options.runtimeIdentity);
      if (
        JSON.stringify(readToolingIdentity()) !==
        JSON.stringify(toolingIdentity)
      ) {
        throw new Error("AI review campaign tooling changed before dispatch");
      }
    };
    try {
      if (campaignStopped()) {
        throw new CampaignStoppedError("Campaign stopped before route invoke");
      }
      verifyDispatchIdentity();
      // Routes are intentionally dispatched sequentially so the executable
      // campaign has one explicit provider boundary at a time.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const result = await runAiReviewProtocol({
        deadlineAt,
        expectedRecognitionQuestionsHash: packet.recognitionQuestionsHash,
        invoke: async (request) => {
          if (campaignStopped()) {
            throw new CampaignStoppedError(
              "Campaign stopped before provider invoke"
            );
          }
          verifyDispatchIdentity();
          const response = await route.invoke(request);
          if (campaignStopped()) {
            throw new CampaignStoppedError(
              "Campaign stopped after provider invoke"
            );
          }
          verifyDispatchIdentity();
          return response;
        },
        model: route.model,
        out: directory,
        recognitionOrderSeed,
        stimuli: packet.stimuli,
      });
      verifyDispatchIdentity();
      const terminal = {
        artifactTreeHash: artifactTreeHash(directory),
        deadlineAt,
        elapsedMs: Date.now() - startedAt,
        intentHash: sha(JSON.stringify(reviewerIntent)),
        model: route.model,
        qualified: false,
        resultHash: sha(JSON.stringify(result)),
        startedAt,
        status: result.status,
      };
      writeFileSync(path.join(directory, "terminal.json"), json(terminal), {
        flag: "wx",
      });
      outcomes.push(terminal);
    } catch (error) {
      // A protocol directory may contain valuable incomplete evidence. Never
      // erase or rerun it; seal the failure for explicit operator review.
      if (!existsSync(directory)) {
        mkdirSync(directory, { recursive: false });
      }
      const terminal = {
        artifactTreeHash: artifactTreeHash(directory),
        deadlineAt,
        elapsedMs: Date.now() - startedAt,
        intentHash: sha(JSON.stringify(reviewerIntent)),
        model: route.model,
        qualified: false,
        reason: String(error),
        startedAt,
        status: error instanceof CampaignStoppedError ? "stopped" : "errored",
      };
      writeFileSync(path.join(directory, "terminal.json"), json(terminal), {
        flag: "wx",
      });
      outcomes.push(terminal);
    } finally {
      rmSync(dispatchLock, { force: true, recursive: true });
    }
  }
  return {
    intentHash,
    outcomes,
    qualified: false,
    status: "diagnostic" as const,
  };
};

/** Fresh-run campaign wrapper for the prospective free-description protocol.
 * Its intent commits to the hidden key hash and public artifact identities,
 * while never serializing targets or synonyms before recognition. Runtime
 * access confinement is not yet canonical evidence, so every outcome remains
 * diagnostic and production-ineligible. */
// Freeze, dispatch and settlement checks stay together for the prospective path.
// oxlint-disable-next-line eslint/complexity
export const runProspectiveAiReviewCampaign = async (options: {
  execute?: boolean;
  input: AiReviewCampaignInput;
  originalDeadlineAt: number;
  out: string;
  perReviewerMaxMs: number;
  routes: readonly ProspectiveAiReviewRoute[];
  synonymKey: readonly SynonymKeyRow[];
  toolingFiles: readonly string[];
}) => {
  if (
    !/^[a-z0-9-]+$/u.test(options.input.packetId) ||
    !options.input.stimuli.length ||
    options.input.stimuli.length > 20 ||
    !Number.isSafeInteger(options.originalDeadlineAt) ||
    options.originalDeadlineAt <= Date.now() ||
    !Number.isFinite(options.perReviewerMaxMs) ||
    options.perReviewerMaxMs <= 0 ||
    options.perReviewerMaxMs > 480_000 ||
    !options.routes.length ||
    new Set(options.routes.map(({ id }) => id)).size !==
      options.routes.length ||
    options.routes.some(
      (route) =>
        !/^[a-z0-9-]+$/u.test(route.id) ||
        !/^[a-z0-9-]+$/u.test(route.adjudicator.id) ||
        !route.command.startsWith("/") ||
        !route.adjudicator.command.startsWith("/") ||
        !route.model.trim() ||
        !route.adjudicator.model.trim() ||
        !route.baseModelLineage.trim() ||
        !route.adjudicator.baseModelLineage.trim() ||
        route.baseModelLineage === route.adjudicator.baseModelLineage
    ) ||
    !options.toolingFiles.length
  ) {
    throw new Error("Prospective campaign needs bounded independent routes");
  }
  const stimuli: AiProtocolStimulus[] = options.input.stimuli.map((row) => ({
    concept: row.concept,
    familyReferences: row.familyReferences.map((file) =>
      readFileSync(realpathSync(file))
    ),
    id: row.id,
    image: readFileSync(realpathSync(row.image)),
    meanings: [],
  }));
  if (
    new Set(stimuli.map(({ id }) => id)).size !== stimuli.length ||
    stimuli.some(({ id }) => !/^[a-z0-9-]+$/u.test(id))
  ) {
    throw new Error("Prospective campaign needs unique opaque row identities");
  }
  const key = freezeSynonymKey(options.synonymKey);
  if (
    key.rows.length !== stimuli.length ||
    key.rows.some((row, index) => row.id !== stimuli[index]?.id)
  ) {
    throw new Error("Prospective campaign synonym key population changed");
  }
  const toolingIdentity = Object.fromEntries(
    options.toolingFiles.toSorted().map((file) => {
      const resolved = realpathSync(file);
      return [resolved, sha(readFileSync(resolved))];
    })
  );
  const intent = {
    authority: "AI diagnostic only",
    originalDeadlineAt: options.originalDeadlineAt,
    packet: stimuli.map((row) => ({
      familyReferenceHashes: row.familyReferences.map(sha),
      id: row.id,
      imageHash: sha(row.image),
    })),
    packetId: options.input.packetId,
    perReviewerMaxMs: options.perReviewerMaxMs,
    productionSealEligible: false,
    protocolVersion: AI_REVIEW_FREE_RECOGNITION_VERSION,
    routes: options.routes.map((route) => ({
      adjudicator: {
        baseModelLineage: route.adjudicator.baseModelLineage,
        command: route.adjudicator.command,
        id: route.adjudicator.id,
        model: route.adjudicator.model,
      },
      baseModelLineage: route.baseModelLineage,
      command: route.command,
      id: route.id,
      model: route.model,
    })),
    runtimeAccessRestrictionVerified: false,
    synonymKeyHash: key.hash,
    toolingIdentity,
  };
  const intentHash = sha(JSON.stringify(intent));
  if (existsSync(options.out)) {
    throw new Error("Prospective campaigns are fresh-run only");
  }
  mkdirSync(options.out, { recursive: false });
  writeDurableExclusiveJson(options.out, "intent.json", intent);
  if (options.execute !== true) {
    return { intentHash, qualified: false, status: "dry-run" as const };
  }
  const outcomes = [];
  for (const route of options.routes) {
    const startedAt = Date.now();
    const deadlineAt = Math.min(
      options.originalDeadlineAt,
      startedAt + options.perReviewerMaxMs
    );
    const directory = path.join(options.out, route.id);
    if (deadlineAt - startedAt <= AI_REVIEW_FINAL_VALIDATION_RESERVE_MS) {
      outcomes.push({
        model: route.model,
        qualified: false,
        reason: "campaign-original-deadline-expired",
        routeId: route.id,
        status: "unstarted" as const,
      });
      continue;
    }
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop
      const result = await runProspectiveAiReviewProtocol({
        adjudicator: route.adjudicator,
        deadlineAt,
        expectedSynonymKeyHash: key.hash,
        out: directory,
        recognizer: route,
        stimuli,
        synonymKey: key.rows,
      });
      const terminal = {
        artifactTreeHash: artifactTreeHash(directory),
        deadlineAt,
        elapsedMs: Date.now() - startedAt,
        intentHash: sha(
          JSON.stringify({ campaignIntentHash: intentHash, route: route.id })
        ),
        model: route.model,
        productionSealEligible: false,
        qualified: false,
        resultHash: sha(JSON.stringify(result)),
        routeId: route.id,
        startedAt,
        status: result.status,
      };
      writeDurableExclusiveJson(directory, "terminal.json", terminal);
      outcomes.push(terminal);
    } catch (error) {
      if (!existsSync(directory)) {
        mkdirSync(directory, { recursive: false });
      }
      const terminal = {
        artifactTreeHash: artifactTreeHash(directory),
        deadlineAt,
        elapsedMs: Date.now() - startedAt,
        intentHash: sha(
          JSON.stringify({ campaignIntentHash: intentHash, route: route.id })
        ),
        model: route.model,
        productionSealEligible: false,
        qualified: false,
        reason: String(error),
        routeId: route.id,
        startedAt,
        status: "errored" as const,
      };
      writeDurableExclusiveJson(directory, "terminal.json", terminal);
      outcomes.push(terminal);
    }
  }
  return {
    intentHash,
    outcomes,
    qualified: false,
    status: "diagnostic" as const,
  };
};

/** Resumable, evidence-bound orchestration for small AI-only review packets. */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { runAiReviewProtocol } from "./ai-review-protocol.js";
import type {
  AiProtocolStimulus,
  ProtocolReviewer,
} from "./ai-review-protocol.js";

export interface AiReviewRoute {
  command: string;
  id: string;
  invoke: ProtocolReviewer;
  model: string;
}
export interface AiReviewPacketRow {
  concept: string;
  familyReferences: readonly string[];
  id: string;
  image: string;
  meanings: readonly string[];
}
export interface AiReviewCampaignInput {
  packetId: string;
  stimuli: readonly AiReviewPacketRow[];
}

class CampaignStoppedError extends Error {
  override readonly name = "CampaignStoppedError";
}

const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf-8"));

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

const freezePacket = (input: AiReviewCampaignInput) => {
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
  const manifest = input.stimuli.map((row, index) => ({
    // The campaign root is visible before recognition. Commit to the target
    // and source bytes without exposing the answer or filename there.
    conceptSha256: sha(row.concept),
    familyReferences: row.familyReferences.map((_file, anchor) => ({
      sha256: sha(stimuli[index]?.familyReferences[anchor] ?? new Uint8Array()),
    })),
    id: row.id,
    image: {
      sha256: sha(stimuli[index]?.image ?? new Uint8Array()),
    },
    meanings: [...row.meanings],
  }));
  return { manifest, stimuli };
};

const validArtifactHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

export const readAiReviewTerminal = (options: {
  campaignIntentHash: string;
  directory: string;
  model: string;
  routeId: string;
}) => {
  const { campaignIntentHash, directory, model, routeId } = options;
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
  const packet = freezePacket(options.input);
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
  const intent = {
    authority: "AI diagnostic only",
    maxPackets: options.maxPackets,
    packet: packet.manifest,
    packetId: options.input.packetId,
    perReviewerMaxMs: options.perReviewerMaxMs,
    qualified: false,
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
  if (existsSync(options.out)) {
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
    mkdirSync(dispatchLock, { recursive: false });
    const startedAt = Date.now();
    const deadlineAt = startedAt + options.perReviewerMaxMs;
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

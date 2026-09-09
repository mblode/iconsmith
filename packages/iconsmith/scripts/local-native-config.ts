/** Serialized native route inputs. No executable callbacks or ambient provider state. */
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  assertCodexReviewerDispatchable,
  reviewImagesWithCodex,
} from "./local-codex-review.js";
import {
  validateNativeCliContainerConfig,
  validateCodexContainerAssets,
} from "./local-container-runtime.js";
import {
  CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE,
  createNativeCallContainerFactory,
} from "./local-native-call-factory.js";
import type { NativeCallScope } from "./local-native-call-factory.js";
import {
  assertDiagnosticFinalizationPlanBinding,
  materializeDiagnosticFinalizationPlan,
} from "./local-native-interruption-diagnostic.js";
import type {
  BoundDiagnosticFinalizationPlan,
  DiagnosticFinalizationCapability,
} from "./local-native-interruption-diagnostic.js";
import { createNativeStyleRoute } from "./local-native-route.js";
import type {
  NativeStyleReviewerConfig,
  NativeStyleRoute,
} from "./local-native-route.js";
import type { LocalRetrievalReview } from "./local-retrieval.js";
import { createNativeCallBoundary } from "./native-call-boundary.js";
import { freezeProductionNativeRequestBudget } from "./review-budget.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const absolute = z.string().refine(path.isAbsolute, "Expected absolute path");
const frozenFile = z.object({ path: absolute, sha256: hashSchema }).strict();
const actorSchema = z
  .object({
    cliVersion: z.string().min(1),
    codexAssets: z
      .object({ certificateBundle: frozenFile, codeModeHost: frozenFile })
      .strict()
      .optional(),
    effort: z.literal("high"),
    executable: frozenFile,
    model: z.string().min(1),
    provider: z.enum(["codex", "claude"]),
    reviewProfile: z.literal(CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE).optional(),
    stateFiles: z
      .array(
        z
          .object({ relativePath: z.string().min(1), source: frozenFile })
          .strict()
      )
      .min(1),
  })
  .strict();
const manifestSchema = z
  .object({
    author: actorSchema,
    billing: z.literal("subscription"),
    docker: frozenFile.extend({ resolvedPath: absolute }).strict(),
    image: z.string().regex(/^[^\s]+@sha256:[a-f0-9]{64}$/u),
    reviewers: z.tuple([actorSchema, actorSchema]),
    schemaVersion: z.literal(1),
  })
  .strict();
export type NativeRouteManifest = z.infer<typeof manifestSchema>;
export type NativeRouteActor = NativeRouteManifest["author"];
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const verifiedFile = (file: z.infer<typeof frozenFile>) => {
  const metadata = lstatSync(file.path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    realpathSync(file.path) !== file.path ||
    digest(readFileSync(file.path)) !== file.sha256
  ) {
    throw new Error("Native route frozen file identity changed");
  }
};
const verifiedDocker = (file: NativeRouteManifest["docker"]) => {
  if (realpathSync(file.path) !== file.resolvedPath) {
    throw new Error("Native Docker invocation resolution changed");
  }
  verifiedFile({ path: file.resolvedPath, sha256: file.sha256 });
};
/** Explicit adapter roster; runtime aliases and efforts do not create lineages. */
export const nativeActorLineage = (actor: NativeRouteActor) => {
  const models =
    actor.provider === "claude"
      ? ["claude-opus-5"]
      : ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4-mini"];
  if (!models.includes(actor.model)) {
    throw new Error(
      "Native route model has no verified adapter roster identity"
    );
  }
  return actor.model;
};
const validateActor = (actor: NativeRouteActor) => {
  nativeActorLineage(actor);
  if (
    (actor.reviewProfile !== undefined &&
      (actor.provider !== "codex" ||
        actor.model !== "gpt-5.4-mini" ||
        actor.reviewProfile !== CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE)) ||
    (actor.model === "gpt-5.4-mini" &&
      actor.reviewProfile !== CODEX_MINI_INLINE_ONLY_REVIEW_PROFILE)
  ) {
    throw new Error(
      "Native mini reviewer requires its exact inline-image runtime profile"
    );
  }
  if (
    actor.cliVersion !==
    (actor.provider === "codex" ? "0.154.0-alpha.3" : "2.1.263")
  ) {
    throw new Error(
      "Native CLI version is outside the verified adapter roster"
    );
  }
  verifiedFile(actor.executable);
  const allowed =
    actor.provider === "codex"
      ? ["auth.json"]
      : [".claude/.credentials.json", ".claude.json"];
  if (
    new Set(actor.stateFiles.map((file) => file.relativePath)).size !==
      actor.stateFiles.length ||
    actor.stateFiles.some((file) => !allowed.includes(file.relativePath))
  ) {
    throw new Error(
      "Native route state must contain only explicit authentication files"
    );
  }
  for (const file of actor.stateFiles) {
    verifiedFile(file.source);
  }
  if (actor.provider === "codex") {
    if (
      !actor.codexAssets ||
      !actor.stateFiles.some((file) => file.relativePath === "auth.json")
    ) {
      throw new Error(
        "Codex route requires frozen trust, helper and authentication assets"
      );
    }
    verifiedFile(actor.codexAssets.certificateBundle);
    verifiedFile(actor.codexAssets.codeModeHost);
  } else if (
    actor.codexAssets ||
    !actor.stateFiles.some(
      (file) => file.relativePath === ".claude/.credentials.json"
    )
  ) {
    throw new Error(
      "Claude route requires its explicit subscription credential file"
    );
  }
};
export const readNativeRouteManifest = (
  file: string,
  expectedSha256: string
) => {
  if (!hashSchema.safeParse(expectedSha256).success) {
    throw new Error(
      "Native route requires a previously frozen manifest SHA-256"
    );
  }
  const bytes = readFileSync(file);
  if (digest(bytes) !== expectedSha256) {
    throw new Error("Native route manifest identity changed");
  }
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString("utf-8")));
  verifiedDocker(manifest.docker);
  const actors = [manifest.author, ...manifest.reviewers];
  for (const actor of actors) {
    validateActor(actor);
  }
  if (manifest.author.provider !== "codex") {
    throw new Error(
      "Claude author requires a separately verified Node runtime; this route is unavailable"
    );
  }
  if (
    manifest.author.reviewProfile !== undefined ||
    !["gpt-6-astra", "claude-opus-5"].includes(manifest.author.model) ||
    new Set(actors.map(nativeActorLineage)).size !== 3
  ) {
    throw new Error(
      "Native route requires one supported author and two independent model lineages"
    );
  }
  return { hash: expectedSha256, manifest };
};

export const nativeActorContainer = (
  manifest: NativeRouteManifest,
  actor: NativeRouteActor,
  scope: Pick<NativeCallScope, "stateDirectory">
) => {
  verifiedDocker(manifest.docker);
  validateActor(actor);
  const nativeCommand = `/runtime/${actor.provider}`;
  const codexAssets = actor.codexAssets
    ? {
        certificateBundle: {
          containerPath: "/etc/ssl/certs/ca-certificates.crt",
          hostPath: actor.codexAssets.certificateBundle.path,
          sha256: actor.codexAssets.certificateBundle.sha256,
        },
        cliVersion: actor.cliVersion,
        codeModeHost: {
          containerPath: "/runtime/codex-code-mode-host",
          hostPath: actor.codexAssets.codeModeHost.path,
          sha256: actor.codexAssets.codeModeHost.sha256,
        },
      }
    : undefined;
  const config = {
    codexAssets,
    dockerCommand: manifest.docker.path,
    environment: {
      HOME: scope.stateDirectory,
      ...(actor.provider === "codex"
        ? { CODEX_HOME: scope.stateDirectory }
        : {}),
    },
    image: manifest.image,
    namePrefix: "iconsmith-native-call",
    nativeCliVersion: actor.cliVersion,
    nativeCommand,
    nativeExecutableHostPath: actor.executable.path,
    nativeExecutableSha256: actor.executable.sha256,
    stateMounts: [
      {
        containerPath: nativeCommand,
        hostPath: actor.executable.path,
        readOnly: true,
      },
      {
        containerPath: scope.stateDirectory,
        hostPath: scope.stateDirectory,
        readOnly: false,
      },
      ...actor.stateFiles.map((file) => ({
        containerPath: path.join(scope.stateDirectory, file.relativePath),
        hostPath: file.source.path,
        readOnly: true,
      })),
      ...(codexAssets
        ? [
            { ...codexAssets.certificateBundle, readOnly: true },
            { ...codexAssets.codeModeHost, readOnly: true },
          ]
        : []),
    ],
  };
  const validation = {
    ...config,
    persistIdentity: () => {
      throw new Error("Validation-only container cannot dispatch");
    },
    persistSettlement: () => {
      throw new Error("Validation-only container cannot settle");
    },
  };
  validateNativeCliContainerConfig(validation);
  if (codexAssets) {
    validateCodexContainerAssets(validation);
  }
  return config;
};

export const createConfiguredNativeFactory = (options: {
  actor: NativeRouteActor;
  manifest: NativeRouteManifest;
  boundaryDirectory: string;
  evidenceDirectory: string;
  runtimeRoot: string;
  deadlineAt: number;
  requestId: string;
  reservationHash: string;
  diagnosticFinalization?: DiagnosticFinalizationCapability;
}) =>
  createNativeCallContainerFactory({
    boundaryDirectory: options.boundaryDirectory,
    buildContainer: (scope) =>
      nativeActorContainer(options.manifest, options.actor, scope),
    evidenceDirectory: options.evidenceDirectory,
    minimumRemainingMs: 5000,
    parentDeadlineAt: options.deadlineAt,
    requestId: options.requestId,
    reservationHash: options.reservationHash,
    rootDirectory: options.runtimeRoot,
    stateEnvironmentName:
      options.actor.provider === "codex" ? "CODEX_HOME" : "HOME",
    ...(options.diagnosticFinalization
      ? { diagnosticFinalization: options.diagnosticFinalization }
      : {}),
  });

const retrievalReviews = new WeakMap<NativeStyleRoute, LocalRetrievalReview>();
/** Only the original canonical route can supply its bounded retrieval adapter. */
export const nativeRetrievalReview = (
  route: NativeStyleRoute
): LocalRetrievalReview => {
  const review = retrievalReviews.get(route);
  if (!review) {
    throw new Error("Native route has no reserved automatic retrieval calls");
  }
  return review;
};

/** Construct the real adapters and shared journal only after the manifest is verified. */
export const configureNativeStyleRoute = (options: {
  campaignStopFile?: string;
  manifest: NativeRouteManifest;
  routeHash: string;
  out: string;
  deadlineAt: number;
  requestId: string;
  retrievalCalls?: 0 | 2;
  startedAt: number;
  diagnosticFinalization?: BoundDiagnosticFinalizationPlan;
}) => {
  const retrievalCalls = options.retrievalCalls ?? 0;
  if (options.diagnosticFinalization) {
    assertDiagnosticFinalizationPlanBinding({
      binding: options.diagnosticFinalization,
      deadlineAt: options.deadlineAt,
      image: options.manifest.image,
      requestId: options.requestId,
      retrievalCalls,
      routeHash: options.routeHash,
    });
  }
  // Refuse the whole route before author cost or reservation if a reviewer
  // cannot dispatch. Never silently remove or replace that reviewer.
  for (const reviewer of options.manifest.reviewers) {
    assertCodexReviewerDispatchable(reviewer.reviewProfile);
  }
  const budget = freezeProductionNativeRequestBudget({
    deadlineAt: options.deadlineAt,
    now: Date.now(),
    retrievalCalls,
    startedAt: options.startedAt,
  });
  const runtimeRoot = `${realpathSync(options.out)}.native-runtime`;
  const control = path.join(options.out, "native-control");
  mkdirSync(runtimeRoot, { mode: 0o700 });
  mkdirSync(control, { mode: 0o700 });
  const boundaryDirectory = path.join(control, "calls");
  const reservationHash = createNativeCallBoundary(boundaryDirectory, {
    billing: "subscription",
    ...(options.campaignStopFile
      ? { campaignStopFile: options.campaignStopFile }
      : {}),
    deadlineAt: options.deadlineAt,
    maxCalls: budget.maxCalls,
    minimumCallReserveMs: 5000,
    reservationId: options.requestId,
    routeHash: options.routeHash,
  });
  const diagnosticFinalization = options.diagnosticFinalization
    ? materializeDiagnosticFinalizationPlan({
        binding: options.diagnosticFinalization,
        descriptorReceipt: path.join(
          control,
          "finalization-interruption-descriptor.json"
        ),
        reservationHash,
      })
    : undefined;
  const factory = (
    actor: NativeRouteActor,
    name: string,
    diagnostic?: DiagnosticFinalizationCapability
  ) => {
    const evidenceDirectory = path.join(control, name);
    mkdirSync(evidenceDirectory, { mode: 0o700 });
    return createConfiguredNativeFactory({
      actor,
      boundaryDirectory,
      deadlineAt: options.deadlineAt,
      evidenceDirectory,
      manifest: options.manifest,
      requestId: options.requestId,
      reservationHash,
      runtimeRoot,
      ...(diagnostic ? { diagnosticFinalization: diagnostic } : {}),
    });
  };
  const { author } = options.manifest;
  const preflightState = path.join(runtimeRoot, "preflight-state");
  mkdirSync(preflightState, { mode: 0o700 });
  const authorIdentity = {
    container: {
      ...nativeActorContainer(options.manifest, author, {
        stateDirectory: preflightState,
      }),
      persistIdentity: () => {
        throw new Error("Author identity probe cannot dispatch");
      },
      persistSettlement: () => {
        throw new Error("Author identity probe cannot settle");
      },
    },
    containerFactory: factory(author, "author", diagnosticFinalization),
    id: "author",
    lineage: nativeActorLineage(author).replaceAll(".", "-"),
  };
  const reviewer = (
    actor: NativeRouteActor,
    index: number
  ): NativeStyleReviewerConfig => {
    const shared = {
      containerFactory: factory(actor, `reviewer-${index}`),
      id: `reviewer-${index}`,
      lineage: nativeActorLineage(actor).replaceAll(".", "-"),
    };
    return actor.provider === "codex"
      ? {
          ...shared,
          model: actor.model,
          provider: "openai-codex",
          ...(actor.reviewProfile
            ? { reviewProfile: actor.reviewProfile }
            : {}),
        }
      : { ...shared, effort: actor.effort, provider: "anthropic-claude" };
  };
  const route = createNativeStyleRoute({
    author:
      author.provider === "codex"
        ? {
            ...authorIdentity,
            ...(diagnosticFinalization
              ? { enableDiagnosticFinalizationInterruption: true as const }
              : {}),
            provider: "openai-astra",
          }
        : {
            ...authorIdentity,
            effort: author.effort,
            provider: "anthropic-claude",
          },
    budget,
    reviewers: [
      reviewer(options.manifest.reviewers[0], 0),
      reviewer(options.manifest.reviewers[1], 1),
    ],
    runtimeRoot,
  });
  if (budget.maxRetrievalCalls === 2) {
    if (author.provider !== "codex") {
      throw new Error(
        "Native automatic retrieval requires the verified Codex adapter"
      );
    }
    const containerFactory = factory(author, "retrieval");
    let calls = 0;
    retrievalReviews.set(route, async (request) => {
      if (calls >= budget.maxRetrievalCalls) {
        throw new Error("Native retrieval call allowance exhausted");
      }
      if (request.deadlineAt !== budget.retrievalDeadlineAt) {
        throw new Error("Native retrieval deadline identity mismatch");
      }
      if (budget.retrievalDeadlineAt - Date.now() < 5000) {
        throw new Error("Native retrieval reserve exhausted");
      }
      const index = calls;
      calls += 1;
      return await reviewImagesWithCodex({
        ...request,
        maxStageMs: budget.retrievalMaximumMs,
        model: author.model,
        nativeCall: {
          containerFactory,
          ordinal: budget.maxAuthorCalls + budget.maxReviewCalls + index,
          parentDeadlineAt: options.deadlineAt,
          runtimeCwd: path.join(runtimeRoot, `retrieval-${index}`),
          stageKind:
            index === 0 ? "retrieval-discovery" : "retrieval-selection",
        },
      });
    });
  }
  writeFileSync(
    path.join(control, "launch.json"),
    JSON.stringify(
      {
        budget,
        requestId: options.requestId,
        reservationHash,
        routeHash: options.routeHash,
        runtimeRoot,
      },
      null,
      2
    ),
    { flag: "wx" }
  );
  return route as NativeStyleRoute & { budget: typeof budget };
};

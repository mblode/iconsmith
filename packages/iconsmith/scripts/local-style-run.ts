/** Selected-style local run: prepare, author, recheck, require delivery. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  lstatSync,
  realpathSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { createStyleRevision, selectStyle } from "../src/pipeline/style.js";
import { sheet } from "../src/tools/render.js";
import { prepareAuthorReviewPacket } from "./author-review-packet.js";
import type {
  AuthorReviewPacketUncertainty,
  ReviewPacketFile,
} from "./author-review-packet.js";
import type { readAuthorTrace } from "./local-author-evidence.js";
import { collectAuthorInspection } from "./local-author-evidence.js";
import type { CompositionInput } from "./local-composition.js";
import {
  COMPOSITION_INSTRUCTIONS,
  stageComposition,
} from "./local-composition.js";
import { validateNativeCliContainerConfig } from "./local-container-runtime.js";
import type { NativeCliContainerConfig } from "./local-container-runtime.js";
import type {
  NativeStyleReviewResult,
  NativeStyleRoute,
} from "./local-native-route.js";
import { assertCanonicalNativeStyleRoute } from "./local-native-route.js";
import { runOwnedProcess } from "./local-process.js";
import type { ProcessResult } from "./local-process.js";
import { buildLocalRecognitionChoices } from "./local-recognition-choices.js";
import { reviewImages } from "./local-review.js";
import type { LocalRuntime } from "./local-runtime.js";
import { referenceProofName, referenceProofs } from "./reference-proofs.js";
import {
  admitNativeStage,
  freezeProductionNativeRequestBudget,
} from "./review-budget.js";
import {
  constructionEvidence,
  constructionStyleQuestion,
} from "./review-construction.js";

const AUTHOR_REVIEW_INSTRUCTIONS =
  "author-review.json must be an object with unresolved: an array of objects {id, kind, description}. kind is representation or visual. Use representation only when the required construction cannot be expressed with the available DSL or admitted parts, and name the missing capability. A missing or misplaced element that existing primitives can repair is visual; an omitted connecting line is not a missing drawing capability. Include every known or uncertain remaining defect, including subpixel contour defects. Each description must identify a failed requirement and the observed evidence. Record intentional rendering tradeoffs in review.md; do not call them unresolved solely because an alternative would optimize a different property. Normal antialiasing, a symmetric stroke split across pixel columns, or lower peak contrast alone is not a failed requirement when readability, continuity, centering and family consistency are preserved. If those properties are actually lost or their preservation is uncertain, keep the issue unresolved. An empty unresolved array means no known or uncertain defect, never approval. Keep limitation IDs stable across repairs.";

const authorReviewSchema = z
  .object({
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
  .strict()
  .refine(
    (review) =>
      new Set(review.unresolved.map((item) => item.id)).size ===
      review.unresolved.length,
    "Limitation IDs must be distinct"
  );

export const normalizeLocalGenerationTerminal = <
  Result extends {
    completionProvenance: string;
    qualityStatus: string;
    status: string;
  },
>(
  result: Result,
  deadlineExceeded: boolean
) => {
  const qualityStatus = deadlineExceeded
    ? "deadline-exhausted"
    : result.qualityStatus;
  return {
    ...result,
    authorOriginalCompletionProvenance: result.completionProvenance,
    authorOriginalStatus: result.status,
    qualityStatus,
    status:
      result.status === "delivered" && qualityStatus === "review-clear"
        ? "delivered"
        : "incomplete",
  };
};

export interface LocalStyleOptions {
  /** Fixed allocation for this phase; never recomputed from shrinking time. */
  authorBudgetMs?: number;
  reviewerReserveMs?: number;
  reviewerCommand?: string;
  reviewerContainer?: NativeCliContainerConfig;
  maxWallMs?: number;
  /** Internal shared deadline, including author, review and repair attempts. */
  deadlineAt?: number;
  out: string;
  revisionPath: string;
  master: string;
  finish?: "outlined" | "filled";
  concept: string;
  meanings: readonly string[];
  guidance?: string;
  composition?: CompositionInput;
  command: string;
  args: (
    brief: string,
    permissionArgs: readonly string[],
    images: readonly string[]
  ) => string[];
  prepareRuntime?: (out: string) => Promise<LocalRuntime>;
  env: NodeJS.ProcessEnv;
  /** Test seam for the external author. Compilation always runs for real. */
  invoke?: (
    brief: string,
    cwd: string,
    images: readonly string[]
  ) => Promise<ProcessResult>;
  review?: typeof reviewImages;
  /** Test seam for host-owned native session evidence. */
  readTrace?: typeof readAuthorTrace;
  /** Canonical contained structured route. Mutually exclusive with legacy seams. */
  nativeRoute?: NativeStyleRoute;
}
type NativeBudget = ReturnType<typeof freezeProductionNativeRequestBudget>;
type PreparedLocalStyleOptions = LocalStyleOptions & {
  nativeBudget?: NativeBudget;
};
const remainingTime = (options: LocalStyleOptions) =>
  (options.deadlineAt ?? Infinity) - Date.now();
const isContainedPath = (relative: string) =>
  relative === "" ||
  (relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative));
const requireRunTime = (options: LocalStyleOptions) => {
  if (remainingTime(options) <= 0) {
    throw new Error("Run deadline exhausted before author invocation");
  }
};
const requireContainedProviderPath = (options: LocalStyleOptions) => {
  if (options.nativeRoute) {
    if (options.invoke || options.review || options.reviewerContainer) {
      throw new Error(
        "Native route cannot be combined with legacy provider seams"
      );
    }
    return;
  }
  if (!options.review) {
    if (!options.reviewerContainer) {
      throw new Error(
        "Native review requires a valid contained reviewer before author invocation"
      );
    }
    validateNativeCliContainerConfig(options.reviewerContainer);
  }
  if (!options.invoke) {
    throw new Error(
      "Native author host execution is disabled until a contained author adapter is configured"
    );
  }
};
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const nativeSkillExcerpt = (source: string) => {
  const start = source.indexOf("## The house spec");
  const end = source.indexOf("### Examples", start);
  if (start === -1 || end <= start) {
    throw new Error(
      "Bundled Iconsmith skill is missing native author sections"
    );
  }
  return source.slice(start, end).trim();
};

const nativeStructuredPrompt = (options: {
  concept: string;
  finishes: readonly string[];
  guidance?: string;
  parts: unknown;
  referenceOrder: unknown;
  skillSource: string;
  spec: unknown;
}) => `Design ${options.concept} as ${options.finishes.join(" and ")} Iconsmith constrained DSL programs.
You are one stage in a host-owned structured lifecycle. Return only the JSON schema requested for this stage. The host writes programs, compiles them, renders proofs, performs image inspection, and supplies exact compiler or visual defects to a later bounded stage. You have no file paths, shell, checker, image-view tool, network, agents, or writable artifact directory. Do not claim to have used any of them. Never emit SVG or raw path data.
Selected style facts below are immutable host input. The selected spec overrides generic skill defaults. Use only the listed parts. Reference-order entries correspond to the separately attached immutable reference images.

LAYOUT CONTEXT
No cohort measurements are supplied to the host checker for this request. Do not emit \`cohort\`.
A \`keyline\` declaration asserts that the rendered visual extent matches that named width and height on both axes within host tolerance. Keylines are optional: declare one only when the source-supported construction can meet both axes under aspect-preserving layout. If no keyline fits, preserve the source-supported aspect without declaring one and retain the resulting host warning; do not distort the source to silence it. Removing an incompatible declaration changes the claim, not the native footprint, and is not itself a visual repair.

INTENDED FINISHES
${JSON.stringify(options.finishes)}

SELECTED SPEC
${JSON.stringify(options.spec, null, 2)}

ADMITTED PARTS
${JSON.stringify(options.parts, null, 2)}

REFERENCE ORDER
${JSON.stringify(options.referenceOrder, null, 2)}

BUNDLED ICONSMITH GUIDANCE (exact house-spec, grammar, and paint-pair excerpt)
${nativeSkillExcerpt(options.skillSource)}

REQUEST GUIDANCE
${options.guidance?.trim() || "No additional guidance."}`;

const authorRuntime = async (options: LocalStyleOptions) => {
  if (options.prepareRuntime) {
    const runtime = await options.prepareRuntime(options.out);
    return { ...runtime, checkerArgs: [runtime.checker] };
  }
  return {
    checkerArgs: [
      "--import",
      import.meta.resolve("tsx"),
      fileURLToPath(new URL("style-check.ts", import.meta.url)),
    ],
    node: process.execPath,
    permissionArgs: [],
    protectedFiles: [],
  };
};

const changedRuntimeLinks = (
  runtime: { node: string; protectedLinks?: Record<string, string> },
  out: string
) =>
  Object.entries(runtime.protectedLinks ?? {})
    .filter(([link, target]) => {
      try {
        return (
          !lstatSync(link).isSymbolicLink() || realpathSync(link) !== target
        );
      } catch {
        return true;
      }
    })
    .map(([link]) => path.relative(out, link));

// This packet builder's branches correspond to optional, protected evidence.
// oxlint-disable-next-line eslint/complexity
const authorStyle = async (options: PreparedLocalStyleOptions) => {
  const { out } = options;
  const sourceRevision = createStyleRevision(
    JSON.parse(readFileSync(options.revisionPath, "utf-8"))
  );
  const selected = selectStyle(sourceRevision, options.master);
  // The author needs only this master's dependencies. The complete revision
  // can contain other masters' target specimens and must stay outside its packet.
  const revision = createStyleRevision({
    ...sourceRevision.definition,
    masters: { [options.master]: selected.spec },
    parts: sourceRevision.definition.parts.filter(
      (entry) => entry.master === options.master
    ),
    references: sourceRevision.definition.references.filter(
      (entry) => entry.master === options.master
    ),
  });
  const style = selectStyle(revision, options.master);
  const paints: ("outlined" | "filled")[] = options.finish
    ? [options.finish]
    : ["outlined", "filled"];
  const save = (name: string, data: string | Uint8Array) =>
    writeFileSync(path.join(out, name), data);
  save("revision.json", JSON.stringify(revision.definition, null, 2));
  save("spec.json", JSON.stringify(style.spec, null, 2));
  save(
    "parts-names.json",
    JSON.stringify(
      style.parts.map(
        ({ id, name, w, h, closed, nodes, icons, sourceFillRule }) => ({
          closed,
          h,
          id,
          name,
          nodes,
          paint: sourceFillRule
            ? "fixed-source-ink"
            : "centerline-or-silhouette",
          sources: icons,
          w,
        })
      ),
      null,
      2
    )
  );
  save(
    "reference-order.json",
    JSON.stringify(
      style.references.map((r) => r.name),
      null,
      2
    )
  );
  if (style.references.length) {
    save(
      "references.png",
      await sheet(
        style.references.map((r) => r.svg),
        { cols: 4, size: 96 }
      )
    );
  }
  const referenceEvidence = await referenceProofs(
    style.references.map((reference) => reference.svg),
    style.spec.size
  );
  for (const evidence of referenceEvidence) {
    save(evidence.manifest.name, evidence.proof);
    save(
      evidence.manifest.name.replace(/\.png$/u, ".json"),
      JSON.stringify(evidence.manifest, null, 2)
    );
  }
  save(
    "reference-proofs.json",
    JSON.stringify(
      referenceEvidence.map((evidence) => evidence.manifest),
      null,
      2
    )
  );
  const skillSource = readFileSync(
    fileURLToPath(new URL("../references/drawing.md", import.meta.url)),
    "utf-8"
  );
  save("SKILL.md", skillSource);
  const compositionImages = await stageComposition(options.composition, out);
  const runtime = await authorRuntime(options);
  const checkerNode = runtime.node;
  const checker = [
    ...runtime.checkerArgs,
    path.join(out, "revision.json"),
    options.master,
    out,
    ...(options.finish ? [options.finish] : []),
  ];
  const imageNames = [
    ...compositionImages,
    ...(style.references.length ? ["references.png"] : []),
    ...referenceEvidence.map((evidence) => evidence.manifest.name),
    ...paints
      .map((paint) => `previous-${paint}.proof.png`)
      .filter((name) => readdirSync(out).includes(name)),
  ];
  const images = imageNames.map((name) => path.join(out, name));
  save(
    "author-images.json",
    JSON.stringify(
      imageNames.map((name) => ({
        name,
        sha256: createHash("sha256")
          .update(readFileSync(path.join(out, name)))
          .digest("hex"),
      })),
      null,
      2
    )
  );
  // Reserve time for independent review and a targeted repair; the author cannot
  // consume the whole request merely because its own per-process cap allows it.
  const authorBudgetMs = Math.max(
    1,
    Math.min(options.authorBudgetMs ?? 300_000, remainingTime(options))
  );
  const brief = `Design ${options.concept} in the pinned reference style. Read SKILL.md, spec.json and parts-names.json. Selected spec values override generic house defaults. ${style.references.length ? "Inspect references.png; reference-order.json lists its row-major order." : "No reference images supplied; do not claim reference matching."}
Reference-<index>-proof images use the same reference-order.json indices and candidate native size. They show unchanged source drawings at 1x/2x on both surfaces, not newly calibrated optical masters. Compare matching raster columns as well as enlarged contours.
Initial image attachments, in order: ${imageNames.length ? imageNames.join(", ") : "none"}. Images named previous-* show the candidate before this repair, never the final output.
${compositionImages.length ? COMPOSITION_INSTRUCTIONS : ""}
Write ${paints.map((p) => `${p}.icon`).join(" and ")} and author-review.json in this directory; review.md may retain fuller design notes. ${AUTHOR_REVIEW_INSTRUCTIONS} Do not modify compiler, specs or reference files. Use only constrained DSL primitives and admitted parts; no raw path data. No network, API tools, other agents or installs.
${options.guidance ?? ""}
This prompt is the complete BRIEF.md; do not reread BRIEF.md. Treat checker.mjs as an opaque executable: run the exact command below and use its output to repair the DSL; never read or search its source.
Run the real checker after each revision:
${[checkerNode, ...checker].map(quote).join(" ")}
Use the native view_image tool with detail original to inspect every final *.proof.png after the final checker run; byte-matching tool-returned images are required for delivery. Inspect newly generated proof PNGs; initial attachments show references or previous candidates only. Listing files, reading image metadata or analysing pixel JSON does not establish visual inspection. If image viewing is unavailable or fails, state that inspection is incomplete in review.md and retain any uncertain defects; never claim to have seen an image from metadata alone. Inspect both *.proof.png files (or the requested single paint) for native 1x/2x pixels on light and dark surfaces, the enlarged PNGs and native.png at ${style.spec.size}px. Use each paint’s .pixels.json to verify a disputed gap or counter with exact native and retina grayscale rows[y][x], in local zero-based image pixels; do not transcribe whole matrices or substitute them for image inspection. Each matrix is hash-bound to its .native.png or .retina.png. These host files avoid custom raster scripts or dependency lookup. Review gaps, counter survival, curves, modifier readability and family proportions. Check each mark against its own enclosing circle or host, including optical placement and clearance. Inspect arrowhead opening, arm balance and the shaft-to-head tangent transition at native size. Normal antialiasing is not itself a defect: identify a lost distinction, break, imbalance or inconsistent weight. Inspect resolved SVG contours when feature warnings identify tiny regions: invisibility at native size does not prove a contour is redundant. Account for intended holes and solid regions; repair unexpected holes or report them as unresolved. Never dismiss a contour as Boolean bookkeeping without geometric evidence. Preserve attempt-N programs before changes; checker snapshots retain compile evidence. Fix errors and explain unresolved warnings. A clean check is not a craft verdict. Up to four revisions within ${Math.floor(authorBudgetMs / 1000)} seconds, including final checks and image inspection. Finish a valid first candidate early; spend remaining time on a specific visible defect, not a long written defense. Review.md should be concise: construction choices, actual defects, and inspection evidence. Keep inspection notes in review.md and record all unresolved defects in author-review.json. Missing or malformed author-review.json means incomplete delivery, regardless of process exit code. Only write here. Execute this brief.`;
  save("BRIEF.md", brief);
  const intent = {
    billing: "subscription",
    craftApproved: false,
    master: options.master,
    nativeSize: style.spec.size,
    paints,
    sourceRevisionHash: sourceRevision.hash,
    style: style.key,
  };
  save(
    "delivery.json",
    JSON.stringify({ ...intent, status: "running" }, null, 2)
  );
  const invoke =
    options.invoke ??
    ((prompt: string): Promise<ProcessResult> =>
      runOwnedProcess({
        args: options.args(prompt, runtime.permissionArgs, images),
        command: options.command,
        cwd: out,
        env: options.env,
        maxBuffer: 20 * 1024 * 1024,
        timeoutMs: authorBudgetMs,
      }));
  const inputNames = [
    "revision.json",
    "spec.json",
    "parts-names.json",
    "reference-order.json",
    "SKILL.md",
    "BRIEF.md",
    ...runtime.protectedFiles,
    "author-images.json",
    "reference-proofs.json",
    ...referenceEvidence.map((evidence) =>
      evidence.manifest.name.replace(/\.png$/u, ".json")
    ),
    ...(compositionImages.length ? ["composition.json"] : []),
    ...imageNames,
  ];
  const inputs = new Map(
    inputNames.map((name) => [name, readFileSync(path.join(out, name))])
  );
  if (options.nativeRoute) {
    const budget = options.nativeBudget;
    if (!budget || budget.deadlineAt !== options.deadlineAt) {
      throw new Error(
        "Native author requires the frozen original request budget"
      );
    }
    const runtimeRoot = path.join(
      options.nativeRoute.runtimeRoot,
      path.basename(options.out),
      "author"
    );
    const structuredOut = path.join(out, "structured-author");
    const referenceImages = Object.fromEntries(
      imageNames.map((name) => [name, readFileSync(path.join(out, name))])
    );
    const structuredPrompt = nativeStructuredPrompt({
      concept: options.concept,
      finishes: paints,
      guidance: options.guidance,
      parts: JSON.parse(
        readFileSync(path.join(out, "parts-names.json"), "utf-8")
      ),
      referenceOrder: JSON.parse(
        readFileSync(path.join(out, "reference-order.json"), "utf-8")
      ),
      skillSource,
      spec: JSON.parse(readFileSync(path.join(out, "spec.json"), "utf-8")),
    });
    const structured = await options.nativeRoute.author.run({
      check: (cwd) => {
        const now = Date.now();
        const checkAdmission = admitNativeStage({
          deadlineAt: budget.authorDeadlineAt,
          maximumMs: Math.max(
            5000,
            Math.min(remainingTime(options), budget.authorDeadlineAt - now)
          ),
          now,
          remainingReserveMs: 0,
          stage: "host-check",
        });
        const structuredChecker = [
          ...runtime.checkerArgs,
          path.join(out, "revision.json"),
          options.master,
          cwd,
          ...(options.finish ? [options.finish] : []),
        ];
        const checked = spawnSync(checkerNode, structuredChecker, {
          cwd,
          encoding: "utf-8",
          env: options.env,
          timeout: checkAdmission.timeoutMs,
        });
        if (Date.now() >= checkAdmission.stageDeadlineAt) {
          throw new Error("Host check returned after its stage deadline");
        }
        return Promise.resolve({
          proofs: Object.fromEntries(
            paints.flatMap((paint) => {
              try {
                return [
                  [paint, readFileSync(path.join(cwd, `${paint}.proof.png`))],
                ];
              } catch {
                return [];
              }
            })
          ),
          status: checked.status,
          stderr: checked.stderr ?? "",
          stdout: checked.stdout ?? "",
        });
      },
      completionDeadlineAt: budget.authorDeadlineAt,
      concept: options.concept,
      deadlineAt: budget.deadlineAt,
      finishes: paints,
      out: structuredOut,
      prompt: structuredPrompt,
      referenceImages,
      runtimeRoot,
    });
    for (const entry of readdirSync(structuredOut, { withFileTypes: true })) {
      if (entry.isFile()) {
        copyFileSync(
          path.join(structuredOut, entry.name),
          path.join(out, entry.name)
        );
      }
    }
    const changedInputs = inputNames.filter((name) => {
      try {
        return !inputs.get(name)?.equals(readFileSync(path.join(out, name)));
      } catch {
        return true;
      }
    });
    let authorReview: z.infer<typeof authorReviewSchema> | null = null;
    let authorReviewError: string | null = null;
    try {
      authorReview = authorReviewSchema.parse(
        JSON.parse(readFileSync(path.join(out, "author-review.json"), "utf-8"))
      );
    } catch (error) {
      authorReviewError = String(error);
    }
    const missing = [
      ...paints.map((paint) => `${paint}.icon`),
      "author-review.json",
    ].filter((name) => {
      try {
        return !readFileSync(path.join(out, name), "utf-8").trim();
      } catch {
        return true;
      }
    });
    const structuredCompletionProvenance = structured.completionProvenance;
    const delivered =
      changedInputs.length === 0 &&
      missing.length === 0 &&
      authorReview !== null &&
      [
        "structured-finalization-complete",
        "host-validated-after-contained-finalization-interruption",
      ].includes(structuredCompletionProvenance) &&
      ["delivered", "delivered-with-uncertainty"].includes(structured.status);
    let completionProvenance = "incomplete";
    if (delivered) {
      completionProvenance =
        structuredCompletionProvenance ===
        "host-validated-after-contained-finalization-interruption"
          ? structuredCompletionProvenance
          : "structured-native-author-complete";
    }
    const result = {
      ...intent,
      authorExitCode: undefined,
      authorReview,
      authorReviewError,
      authorStageDeadlineAt: budget.authorDeadlineAt,
      authorStageDeadlineExceeded: Date.now() >= budget.authorDeadlineAt,
      changedInputs,
      checkExitCode: delivered ? 0 : null,
      completionProvenance,
      imageInspection: null,
      imageInspectionError: null,
      missing,
      paints,
      reviewContentValidated: false,
      status: delivered ? "delivered" : "incomplete",
      structuredAuthor: structured,
    };
    save("delivery.json", JSON.stringify(result, null, 2));
    return result;
  }
  let author: ProcessResult;
  let authorStageDeadlineAt: number | null = null;
  try {
    if (remainingTime(options) <= (options.reviewerReserveMs ?? 0)) {
      throw new Error("Reviewer reserve reached before author invocation");
    }
    requireRunTime(options);
    const admission = admitNativeStage({
      deadlineAt: options.deadlineAt ?? Date.now() + authorBudgetMs,
      maximumMs: Math.max(5000, authorBudgetMs),
      now: Date.now(),
      remainingReserveMs: options.reviewerReserveMs ?? 0,
      stage: "author",
    });
    authorStageDeadlineAt = admission.stageDeadlineAt;
    if (authorBudgetMs < 5000) {
      throw new Error("Insufficient deadline reserve for author");
    }
    requireContainedProviderPath(options);
    author = await invoke(brief, out, images);
  } catch (error) {
    author = { code: null, killed: false, stderr: String(error), stdout: "" };
  }
  const authorStageDeadlineExceeded =
    authorStageDeadlineAt !== null && Date.now() >= authorStageDeadlineAt;
  save("author.json", JSON.stringify(author, null, 2));
  const changedInputs = [
    ...changedRuntimeLinks(runtime, out),
    ...inputNames.filter((name) => {
      try {
        return !inputs.get(name)?.equals(readFileSync(path.join(out, name)));
      } catch {
        return true;
      }
    }),
  ];
  const checked = changedInputs.length
    ? {
        status: null,
        stderr: "Pinned input changed; final check refused.",
        stdout: "",
      }
    : spawnSync(checkerNode, checker, {
        cwd: out,
        encoding: "utf-8",
        env: options.env,
        timeout: Math.max(1, remainingTime(options)),
      });
  save("check-output.txt", `${checked.stdout ?? ""}\n${checked.stderr ?? ""}`);
  const missing = [
    ...paints.map((p) => `${p}.icon`),
    "author-review.json",
  ].filter((name) => {
    try {
      return !readFileSync(path.join(out, name), "utf-8").trim();
    } catch {
      return true;
    }
  });
  let authorReview: z.infer<typeof authorReviewSchema> | null = null;
  let authorReviewError: string | null = null;
  try {
    authorReview = authorReviewSchema.parse(
      JSON.parse(readFileSync(path.join(out, "author-review.json"), "utf-8"))
    );
  } catch (error) {
    authorReviewError = String(error);
  }
  const { imageInspection, imageInspectionError } = collectAuthorInspection(
    author.stdout,
    out,
    paints,
    options.env,
    options.readTrace
  );
  save(
    "author-inspection.json",
    JSON.stringify({ imageInspection, imageInspectionError }, null, 2)
  );
  const hostValid = [
    !authorStageDeadlineExceeded,
    checked.status === 0,
    missing.length === 0,
    authorReview !== null,
    imageInspection?.complete === true,
  ].every(Boolean);
  let completionProvenance = "incomplete";
  if (author.code === 0 && !author.killed) {
    completionProvenance = "author-process-complete";
  } else if (author.code === null && hostValid) {
    completionProvenance = "host-validated-after-author-interruption";
  }
  const complete = hostValid && completionProvenance !== "incomplete";
  const result = {
    ...intent,
    authorExitCode: author.code,
    authorReview,
    authorReviewError,
    authorStageDeadlineAt,
    authorStageDeadlineExceeded,
    changedInputs,
    checkExitCode: checked.status,
    completionProvenance,
    imageInspection,
    imageInspectionError,
    missing,
    reviewContentValidated: false,
    status: complete ? "delivered" : "incomplete",
  };
  save("delivery.json", JSON.stringify(result, null, 2));
  return result;
};

const recognitionQuestion = (meanings: readonly string[]) => ({
  choices: [...meanings, "uncertain"],
  id: "meaning",
  prompt:
    "Identify the candidate icon from the alternatives. The intended answer is withheld. Choose uncertain if none fits or multiple alternatives are equally plausible. Base the choice on visible features, including modifiers; explain what you actually see.",
});

const qualityQuestions = (
  meanings: readonly string[],
  facts: ReturnType<typeof constructionEvidence>
) => [
  recognitionQuestion(meanings),
  constructionStyleQuestion(facts),
  {
    choices: ["pass", "fail", "uncertain"],
    id: "optics",
    prompt:
      "At the labelled native size, are meaningful gaps/counters and modifiers readable at both device scales and on both surfaces? Inspect arrowhead opening, arm balance, directional legibility and the shaft-to-head tangent transition where arrows are present. Reject a demonstrably collapsed feature, not deliberate solid modifiers or antialiasing itself.",
  },
  {
    choices: ["pass", "fail", "uncertain"],
    id: "family",
    prompt:
      "Do the delivered paints preserve the same concept, apparent scale and layout, allowing deliberate optical differences? For a single paint, assess consistency of repeated forms within it. Assess marks relative to their own enclosing circle or host, including optical placement and surrounding clearance, not only whole-icon centering. Intentional asymmetry is allowed; identify an observed imbalance and its visible location rather than inferring failure from asymmetry alone.",
  },
];

type AuthorResult = Awaited<ReturnType<typeof authorStyle>>;
type LegacyReviewResult = Awaited<ReturnType<typeof reviewImages>>;
type ReviewResult = LegacyReviewResult | NativeStyleReviewResult;
interface Candidate {
  directory: string;
  delivery: AuthorResult;
  review: ReviewResult;
  reviews: readonly ReviewResult[];
  hash: string;
}

const structuredInspectionEvidenceSchema = z.object({
  stages: z.array(
    z.object({
      inspection: z.object({
        defects: z.array(
          z.object({
            id: z.string(),
            kind: z.enum(["representation", "visual"]),
          })
        ),
        uncertainties: z.array(
          z.object({ description: z.string(), finish: z.string() })
        ),
      }),
    })
  ),
});

const structuredFinalInspection = (delivery: AuthorResult) => {
  if (!("structuredAuthor" in delivery)) {
    return;
  }
  const parsed = structuredInspectionEvidenceSchema.safeParse(
    delivery.structuredAuthor
  );
  return parsed.success ? parsed.data.stages.at(-1)?.inspection : undefined;
};

const demonstratedRepresentationIds = (delivery: AuthorResult) =>
  new Set(
    (structuredFinalInspection(delivery)?.defects ?? [])
      .filter((defect) => defect.kind === "representation")
      .map((defect) => defect.id)
  );

const evidenceOnlyAuthorUncertainties = (delivery: AuthorResult) => {
  const inspection = structuredFinalInspection(delivery);
  if (!inspection) {
    return [];
  }
  const demonstrated = demonstratedRepresentationIds(delivery);
  return [
    ...inspection.uncertainties.map((uncertainty) => ({
      ...uncertainty,
      source: "structured-inspection" as const,
    })),
    ...(delivery.authorReview?.unresolved ?? [])
      .filter(
        (item) => item.kind === "representation" && !demonstrated.has(item.id)
      )
      .map((item) => ({
        description: item.description,
        id: item.id,
        kind: "representation" as const,
        source: "author-final-review" as const,
      })),
  ];
};

const blockingAuthorLimitations = (delivery: AuthorResult) => {
  const inspection = structuredFinalInspection(delivery);
  const demonstrated = demonstratedRepresentationIds(delivery);
  return (delivery.authorReview?.unresolved ?? []).filter(
    (item) => item.kind === "visual" || !inspection || demonstrated.has(item.id)
  );
};

const judgeMeaning = (review: ReviewResult, concept: string): ReviewResult => {
  const observed = review.answers?.meaning?.choice ?? null;
  let decision = "uncertain";
  if (observed !== null && observed !== "uncertain") {
    decision = observed === concept ? "pass" : "fail";
  }
  return review.answers?.meaning
    ? {
        ...review,
        answers: {
          ...review.answers,
          meaning: {
            ...review.answers.meaning,
            choice: decision,
            evidence: `Selected ${observed}; expected ${concept}. ${review.answers.meaning.evidence}`,
          },
        },
      }
    : review;
};

const aggregateReviews = (reviews: readonly ReviewResult[]): ReviewResult => {
  if (reviews.some((review) => !review.answers)) {
    return {
      answers: null,
      evidenceHashes: Object.assign(
        {},
        ...reviews.map((review) => review.evidenceHashes)
      ),
      model: null,
      reason: "At least one independent review was incomplete",
      status: "incomplete",
    };
  }
  const ids = Object.keys(reviews[0]?.answers ?? {});
  const answers = Object.fromEntries(
    ids.map((id) => {
      const observations = reviews.flatMap((review) =>
        review.answers?.[id] ? [review.answers[id]] : []
      );
      let choice = "uncertain";
      if (observations.some((answer) => answer.choice === "fail")) {
        choice = "fail";
      } else if (observations.every((answer) => answer.choice === "pass")) {
        choice = "pass";
      }
      return [
        id,
        {
          choice,
          evidence: observations.map((answer) => answer.evidence).join(" "),
          treatment: observations
            .map((answer) => answer.treatment)
            .filter(Boolean)
            .join(" "),
        },
      ];
    })
  );
  return {
    answers,
    evidenceHashes: Object.assign(
      {},
      ...reviews.map((review) => review.evidenceHashes)
    ),
    model: reviews.map((review) => review.model).join(" + "),
    status: "complete",
  };
};

const artifactHash = (options: LocalStyleOptions, delivery: AuthorResult) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        delivery.paints.map((paint) =>
          readFileSync(path.join(options.out, `${paint}.svg`), "utf-8")
        )
      )
    )
    .digest("hex");

const boundFile = (file: string): ReviewPacketFile => ({
  file,
  sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
});

const productionReviewImages = async (
  options: PreparedLocalStyleOptions,
  delivery: AuthorResult,
  selected: ReturnType<typeof selectStyle>,
  uncertainties: readonly AuthorReviewPacketUncertainty[]
) => {
  if (!("structuredAuthor" in delivery)) {
    throw new Error("Native review packet requires structured author evidence");
  }
  if (selected.spec.size !== 16 && selected.spec.size !== 24) {
    throw new Error("Native review packet requires a 16px or 24px master");
  }
  const terminalFile = path.join(options.out, "structured-author.json");
  const terminal = delivery.structuredAuthor as {
    proofHashes?: Readonly<Record<string, string>>;
    stages?: readonly { inspection?: unknown; status?: string }[];
    status?: string;
  };
  const finalStage = [...(terminal.stages ?? [])]
    .toReversed()
    .find((stage) => stage.status === "inspected");
  const inspectionFile = path.join(
    options.out,
    "review-packet-inspection.json"
  );
  writeFileSync(
    inspectionFile,
    JSON.stringify(
      {
        evidenceHashes: terminal.proofHashes ?? {},
        imageInspection: {
          complete: Boolean(finalStage?.inspection),
        },
        status: finalStage?.inspection ? "complete" : "incomplete",
      },
      null,
      2
    ),
    { flag: "wx" }
  );
  const referenceManifestFile = path.join(options.out, "reference-proofs.json");
  const referenceManifest = z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        name: z.string().min(1),
      })
    )
    .parse(JSON.parse(readFileSync(referenceManifestFile, "utf-8")));
  if (
    referenceManifest.length !== selected.references.length ||
    referenceManifest.some(
      (entry, index) =>
        entry.index !== index || entry.name !== referenceProofName(index)
    )
  ) {
    throw new Error("Native review references do not match their frozen order");
  }
  const packetSeed = createHash("sha256")
    .update(
      JSON.stringify({
        concept: options.concept,
        master: options.master,
        sourceRevisionHash: delivery.sourceRevisionHash,
        style: delivery.style,
      })
    )
    .digest("hex")
    .slice(0, 24);
  const prepared = await prepareAuthorReviewPacket({
    authorDirectory: options.out,
    authorEvidence:
      uncertainties.length > 0
        ? { mode: "evidence-only-uncertainty", uncertainties }
        : { mode: "clear" },
    checks: boundFile(path.join(options.out, "checks.json")),
    concept: options.concept,
    expectedNativeSize: selected.spec.size,
    familyProofs: referenceManifest.map((entry) => ({
      ...boundFile(path.join(options.out, entry.name)),
      metadata: boundFile(
        path.join(options.out, entry.name.replace(/\.png$/u, ".json"))
      ),
    })),
    finalAuthorReview: boundFile(path.join(options.out, "author-review.json")),
    finalReviewMarkdown: boundFile(path.join(options.out, "review.md")),
    inspectionReceipt: boundFile(inspectionFile),
    meanings: options.meanings,
    out: path.join(options.out, "author-review-packet"),
    packetId: `review-${packetSeed}`,
    sourceIdentity: {
      referenceProofManifestHash: boundFile(referenceManifestFile).sha256,
      sourceRevisionHash: delivery.sourceRevisionHash,
      styleHash: delivery.style,
    },
    stimulusId: `candidate-${packetSeed}`,
    terminal: boundFile(terminalFile),
  });
  const [stimulus] = prepared.input.stimuli;
  if (!stimulus) {
    throw new Error("Native review packet did not contain a candidate");
  }
  return Object.fromEntries(
    [stimulus.image, ...stimulus.familyReferences].map((file) => [
      path.basename(file),
      readFileSync(file),
    ])
  );
};

// Reviews are intentionally sequential because each admission preserves the
// still-unused call slots under one durable request deadline.
/* oxlint-disable eslint/no-await-in-loop -- independent calls share a sequential durable budget. */
const nativeIndependentReviews = async (
  options: PreparedLocalStyleOptions,
  images: Readonly<Record<string, Uint8Array>>,
  questions: ReturnType<typeof qualityQuestions>,
  recognitionReceipt: unknown,
  evidenceUncertainty: ReturnType<typeof evidenceOnlyAuthorUncertainties>
) => {
  const route = options.nativeRoute;
  const budget = options.nativeBudget;
  if (!route || !budget) {
    throw new Error("Native reviews require a frozen native route");
  }
  writeFileSync(
    path.join(options.out, "recognition-choices.json"),
    JSON.stringify(recognitionReceipt, null, 2)
  );
  const uncertaintyFocus = JSON.stringify(evidenceUncertainty);
  const results: ReviewResult[] = [];
  for (const [index, reviewer] of route.reviewers.entries()) {
    const remainingReviewerCount = route.reviewers.length - index - 1;
    const futureReserveMs =
      remainingReviewerCount *
        (budget.reviewerMaximumMs + budget.clarificationMaximumMs) +
      budget.clarificationMaximumMs +
      budget.exportReserveMs;
    const initial = admitNativeStage({
      deadlineAt: budget.deadlineAt,
      maximumMs: budget.reviewerMaximumMs,
      now: Date.now(),
      remainingReserveMs: futureReserveMs,
      stage: `${reviewer.id}-review`,
    });
    const evidenceOut = path.join(
      options.out,
      `independent-review-${reviewer.id}`
    );
    const runtimeCwd = path.join(
      route.runtimeRoot,
      path.basename(options.out),
      `reviewer-${index + 1}`
    );
    let review = await reviewer.run({
      deadlineAt: initial.stageDeadlineAt,
      images,
      maxStageMs: initial.timeoutMs,
      nativeCall: {
        ordinal: 6 + index * 2,
        parentDeadlineAt: budget.deadlineAt,
        runtimeCwd,
        stageKind: `reviewer-${reviewer.id}`,
      },
      out: evidenceOut,
      questions,
    });
    if (Date.now() >= initial.stageDeadlineAt) {
      throw new Error(
        `${reviewer.id} review returned after its stage deadline`
      );
    }
    const answers = Object.values(review.answers ?? {});
    const resolvedPositive = Object.entries(review.answers ?? {}).every(
      ([id, answer]) =>
        id === "meaning"
          ? answer.choice === options.concept
          : answer.choice === "pass"
    );
    if (
      review.answers &&
      (answers.some((answer) => answer.choice === "uncertain") ||
        (evidenceUncertainty.length > 0 &&
          answers.length > 0 &&
          resolvedPositive))
    ) {
      const clarification = admitNativeStage({
        deadlineAt: budget.deadlineAt,
        maximumMs: budget.clarificationMaximumMs,
        now: Date.now(),
        remainingReserveMs:
          remainingReviewerCount *
            (budget.reviewerMaximumMs + budget.clarificationMaximumMs) +
          budget.exportReserveMs,
        stage: `${reviewer.id}-clarification`,
      });
      const clarified = await reviewer.run({
        deadlineAt: clarification.stageDeadlineAt,
        images,
        maxStageMs: clarification.timeoutMs,
        nativeCall: {
          ordinal: 7 + index * 2,
          parentDeadlineAt: budget.deadlineAt,
          runtimeCwd: `${runtimeCwd}-clarification`,
          stageKind: `reviewer-${reviewer.id}-clarification`,
        },
        out: `${evidenceOut}-clarification`,
        questions: questions.map((question) => ({
          ...question,
          prompt: `${question.prompt} This is a clarification pass after the initial blind review. Host-bound author evidence focus: ${uncertaintyFocus}. Resolve uncertainty only when the supplied pixels establish the answer; otherwise retain uncertain and state the missing evidence.`,
        })),
      });
      if (Date.now() >= clarification.stageDeadlineAt) {
        throw new Error(
          `${reviewer.id} clarification returned after its stage deadline`
        );
      }
      review = clarified;
    }
    results.push(judgeMeaning(review, options.concept));
  }
  writeFileSync(
    path.join(options.out, "independent-reviews.json"),
    JSON.stringify(
      route.reviewers.map((reviewer, index) => ({
        id: reviewer.id,
        lineage: reviewer.lineage,
        model: reviewer.model,
        result: results[index],
      })),
      null,
      2
    )
  );
  return results as unknown as readonly [ReviewResult, ReviewResult];
};
/* oxlint-enable eslint/no-await-in-loop */

// oxlint-disable-next-line eslint/complexity -- evidence staging has explicit fail-closed branches.
const inspectCandidate = async (
  options: PreparedLocalStyleOptions,
  delivery: AuthorResult
) => {
  const revision = createStyleRevision(
    JSON.parse(readFileSync(path.join(options.out, "revision.json"), "utf-8"))
  );
  const selected = selectStyle(revision, options.master);
  const imageNames = [
    ...delivery.paints.map((paint) => `${paint}.proof.png`),
    "native.png",
    ...selected.references.map((_reference, index) =>
      referenceProofName(index)
    ),
    ...(readdirSync(options.out).includes("references.png")
      ? ["references.png"]
      : []),
  ];
  const facts = constructionEvidence({
    candidates: Object.fromEntries(
      delivery.paints.map((paint) => [
        paint,
        {
          proof: readFileSync(path.join(options.out, `${paint}.proof.png`)),
          svg: readFileSync(path.join(options.out, `${paint}.svg`), "utf-8"),
        },
      ])
    ),
    nativeSize: selected.spec.size,
    referenceSheet: selected.references.length
      ? readFileSync(path.join(options.out, "references.png"))
      : undefined,
    references: selected.references.map((reference) => reference.svg),
  });
  writeFileSync(
    path.join(options.out, "construction-evidence.json"),
    JSON.stringify(facts, null, 2)
  );
  let reviewImagesByName = Object.fromEntries(
    imageNames.map((name) => [
      name.replaceAll(".", "-").replace(/-png$/u, ".png"),
      readFileSync(path.join(options.out, name)),
    ])
  );
  let questions = qualityQuestions(options.meanings, facts);
  if (options.nativeRoute) {
    const authorUncertainties = evidenceOnlyAuthorUncertainties(delivery);
    reviewImagesByName = await productionReviewImages(
      options,
      delivery,
      selected,
      authorUncertainties
    );
    const uncertaintyFocus = JSON.stringify(authorUncertainties);
    writeFileSync(
      path.join(options.out, "author-uncertainty-routing.json"),
      JSON.stringify(
        {
          focusSha256: createHash("sha256")
            .update(uncertaintyFocus)
            .digest("hex"),
          independentClarificationRequired: authorUncertainties.length > 0,
          uncertainties: authorUncertainties,
        },
        null,
        2
      )
    );
    const presentationHash = createHash("sha256")
      .update(
        JSON.stringify(
          Object.entries(reviewImagesByName).map(([name, bytes]) => ({
            name,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          }))
        )
      )
      .digest("hex");
    const [recognition] = buildLocalRecognitionChoices(
      `${revision.definition.id}:${options.master}`,
      [
        {
          meanings: options.meanings,
          presentationHash,
          requestId: "meaning",
          targetMeaning: options.concept,
        },
      ]
    );
    if (!recognition) {
      throw new Error("Native recognition choices were not created");
    }
    questions = questions.map((question) =>
      question.id === "meaning"
        ? { ...question, choices: [...recognition.choices] }
        : question
    );
    const reviews = await nativeIndependentReviews(
      options,
      reviewImagesByName,
      questions,
      recognition.receipt,
      authorUncertainties
    );
    for (const [index, review] of reviews.entries()) {
      writeFileSync(
        path.join(options.out, `meaning-observation-${index + 1}.json`),
        JSON.stringify(
          {
            choices: [...recognition.choices],
            decision: review.answers?.meaning?.choice ?? "uncertain",
            evidenceHashes: review.evidenceHashes,
            expected: options.concept,
            instrumentQualified: false,
            orderedChoicesHash: recognition.receipt.orderedChoicesHash,
            reviewer: options.nativeRoute.reviewers[index]?.id,
          },
          null,
          2
        )
      );
    }
    return {
      delivery,
      directory: options.out,
      hash: artifactHash(options, delivery),
      review: aggregateReviews(reviews),
      reviews,
    };
  }
  const reviewRequest = {
    command: options.reviewerCommand,
    container: options.reviewerContainer,
    deadlineAt: options.deadlineAt,
    images: reviewImagesByName,
    out: path.join(options.out, "independent-review"),
    questions,
  };
  const initialReviewBudget = admitNativeStage({
    deadlineAt: options.deadlineAt ?? Date.now() + 120_000,
    maximumMs: 120_000,
    now: Date.now(),
    remainingReserveMs: 5000,
    stage: "independent-review",
  });
  let review = await (options.review ?? reviewImages)({
    ...reviewRequest,
    deadlineAt: initialReviewBudget.stageDeadlineAt,
  });
  if (Date.now() >= initialReviewBudget.stageDeadlineAt) {
    throw new Error(
      "Independent review returned after its admitted stage deadline"
    );
  }
  if (
    review.answers &&
    Object.values(review.answers).some(
      (answer) => answer.choice === "uncertain"
    ) &&
    remainingTime(options) >= 10_000
  ) {
    const clarificationBudget = admitNativeStage({
      deadlineAt: options.deadlineAt ?? Date.now() + 120_000,
      maximumMs: 120_000,
      now: Date.now(),
      remainingReserveMs: 5000,
      stage: "independent-clarification",
    });
    const clarification = await (options.review ?? reviewImages)({
      ...reviewRequest,
      deadlineAt: clarificationBudget.stageDeadlineAt,
      out: path.join(options.out, "independent-review-clarification"),
      questions: reviewRequest.questions.map((question) => ({
        ...question,
        prompt: `${question.prompt} This is a clarification pass. Resolve uncertainty only when the supplied pixels establish the answer; otherwise retain uncertain and state the missing evidence.`,
      })),
    });
    if (Date.now() >= clarificationBudget.stageDeadlineAt) {
      throw new Error(
        "Independent clarification returned after its admitted stage deadline"
      );
    }
    writeFileSync(
      path.join(options.out, "review-clarification.json"),
      JSON.stringify(clarification, null, 2)
    );
    if (clarification.answers) {
      review = clarification;
    }
  }
  const observed = review.answers?.meaning.choice ?? null;
  let decision = "uncertain";
  if (observed !== null && observed !== "uncertain") {
    decision = observed === options.concept ? "pass" : "fail";
  }
  writeFileSync(
    path.join(options.out, "meaning-observation.json"),
    JSON.stringify(
      {
        choices: options.meanings,
        decision,
        evidenceHashes: review.evidenceHashes,
        expected: options.concept,
        instrumentQualified: false,
        observed,
      },
      null,
      2
    )
  );
  const judged = review.answers
    ? {
        ...review,
        answers: {
          ...review.answers,
          meaning: {
            ...review.answers.meaning,
            choice: decision,
            evidence: `Selected ${observed}; expected ${options.concept}. ${review.answers.meaning.evidence}`,
          },
        },
      }
    : review;
  return {
    delivery,
    directory: options.out,
    hash: artifactHash(options, delivery),
    review: judged,
    reviews: [judged],
  };
};

/** A change must fix a failed dimension without regressing any other one. */
const improves = (next: Candidate, previous: Candidate): boolean => {
  const before = previous.review.answers;
  const after = next.review.answers;
  if (!before || !after) {
    return false;
  }
  const ids = Object.keys(before);
  const previousLimitations = previous.delivery.authorReview?.unresolved ?? [];
  const nextLimitations = next.delivery.authorReview?.unresolved ?? [];
  const noNewLimitations = nextLimitations.every((item) =>
    previousLimitations.some(
      (old) => old.id === item.id && old.kind === item.kind
    )
  );
  const fixedDimension = ids.some(
    (id) => before[id].choice !== "pass" && after[id].choice === "pass"
  );
  return (
    noNewLimitations &&
    ids.every(
      (id) =>
        before[id].choice === after[id].choice || after[id].choice === "pass"
    ) &&
    (fixedDimension || nextLimitations.length < previousLimitations.length)
  );
};

const qualityStatus = (candidate: Candidate) => {
  const { review } = candidate;
  if (!review.answers) {
    return "review-incomplete";
  }
  const answers = Object.values(review.answers);
  if (
    blockingAuthorLimitations(candidate.delivery).length ||
    answers.some((answer) => answer.choice === "fail")
  ) {
    return "needs-repair";
  }
  return answers.every((answer) => answer.choice === "pass")
    ? "review-clear"
    : "review-uncertain";
};

const stopReason = (
  status: string,
  index: number,
  options: LocalStyleOptions
) => {
  if (remainingTime(options) <= 0) {
    return "deadline-exhausted";
  }
  if (index === 3) {
    return "attempt-limit";
  }
  return status === "needs-repair" ? null : status;
};

const attemptGuidance = (
  guidance: string | undefined,
  best: Candidate | undefined,
  interrupted: boolean
) =>
  [
    guidance ?? "",
    ...(interrupted
      ? [
          "This is finalization only. The previous author was interrupted after leaving checked programs. Do not redesign them. Rerun the checker, inspect the final proofs, and write an honest author-review.json. Change geometry only when the checker or your inspection identifies a specific defect, and record that evidence.",
        ]
      : []),
    ...(best
      ? [
          "Repair the existing programs using the independent observations below. Treat them as fallible evidence: inspect each claimed defect before changing geometry. Preserve passing dimensions, family geometry and meaning. Make a geometric improvement, not just different prose. Explain any disputed observation with actual image evidence.",
          JSON.stringify({
            author: best.delivery.authorReview,
            independent: best.review.answers,
          }),
        ]
      : []),
  ].join("\n");

const canResumeFinalization = (
  delivery: AuthorResult,
  index: number,
  options: LocalStyleOptions
) =>
  index < 3 &&
  remainingTime(options) > 0 &&
  delivery.authorExitCode === null &&
  delivery.checkExitCode === 0 &&
  delivery.changedInputs.length === 0 &&
  delivery.imageInspection?.complete === true &&
  delivery.missing.length === 1 &&
  delivery.missing[0] === "author-review.json";

/** One local production loop. Every author/reviewer attempt remains on disk.
 * An unqualified critic can request repairs, never promote an icon to approved.
 */
// oxlint-disable-next-line eslint/complexity -- bounded legacy and native paths retain separate guards.
export const runLocalStyle = async (input: LocalStyleOptions) => {
  const startedAt = Date.now();
  const maxWallMs = input.maxWallMs ?? 600_000;
  if (!Number.isFinite(maxWallMs) || maxWallMs <= 0) {
    throw new Error("Run wall budget must be positive and finite");
  }
  if (input.deadlineAt !== undefined && !Number.isFinite(input.deadlineAt)) {
    throw new Error("Run deadline must be finite");
  }
  const deadlineAt = Math.min(
    input.deadlineAt ?? Infinity,
    startedAt + maxWallMs
  );
  const nativeBudget = input.nativeRoute
    ? (input.nativeRoute.budget ??
      (process.env.NODE_ENV === "test"
        ? freezeProductionNativeRequestBudget({
            deadlineAt,
            now: startedAt,
            startedAt,
          })
        : undefined))
    : undefined;
  if (
    input.nativeRoute &&
    (!nativeBudget || nativeBudget.deadlineAt !== deadlineAt)
  ) {
    throw new Error("Native route budget must match the original run deadline");
  }
  if (input.nativeRoute) {
    assertCanonicalNativeStyleRoute(input.nativeRoute);
    const evidenceRoot = realpathSync(input.out);
    const runtimeRoot = realpathSync(input.nativeRoute.runtimeRoot);
    const relativeEvidence = path.relative(runtimeRoot, evidenceRoot);
    const relativeRuntime = path.relative(evidenceRoot, runtimeRoot);
    if (isContainedPath(relativeEvidence) || isContainedPath(relativeRuntime)) {
      throw new Error(
        "Native provider runtime must stay outside local style evidence"
      );
    }
  }
  const options: PreparedLocalStyleOptions = {
    ...input,
    deadlineAt,
    nativeBudget,
  };
  const totalBudgetMs = deadlineAt - startedAt;
  const authorBudgets = {
    construction: Math.max(1, Math.min(300_000, totalBudgetMs - 180_000)),
    finalization: Math.max(1, Math.min(60_000, totalBudgetMs - 150_000)),
    repair: Math.max(1, Math.min(90_000, totalBudgetMs - 120_000)),
  };
  const budgetFor = (hasBest: boolean, interrupted: boolean) => {
    const availableBeforeReview = Math.max(1, remainingTime(options) - 240_000);
    if (interrupted) {
      return Math.min(authorBudgets.finalization, availableBeforeReview);
    }
    return Math.min(
      hasBest ? authorBudgets.repair : authorBudgets.construction,
      availableBeforeReview
    );
  };
  const meanings = z
    .array(z.string().trim().min(1))
    .min(3)
    .max(12)
    .refine(
      (values) =>
        new Set(values).size === values.length &&
        values.includes(options.concept) &&
        !values.some((value) => ["pass", "fail", "uncertain"].includes(value)),
      "Meanings require distinct alternatives including the concept, without reserved verdict words"
    )
    .parse(options.meanings);
  writeFileSync(
    path.join(options.out, "semantic-plan.json"),
    JSON.stringify({ expected: options.concept, meanings }, null, 2)
  );
  const history: { directory: string; hash?: string; status: string }[] = [];
  await stageComposition(options.composition, options.out);
  const composition = options.composition
    ? {
        ...options.composition,
        path: path.join(options.out, "composition.png"),
      }
    : undefined;
  const seen = new Set<string>();
  // State transitions mirror the bounded construction/finalization/repair loop.
  // oxlint-disable-next-line eslint/complexity
  const attempt = async (
    index: number,
    best?: Candidate,
    interrupted?: { directory: string; delivery: AuthorResult }
  ): Promise<{
    delivery: AuthorResult;
    selected?: Candidate;
    reason: string;
  }> => {
    const directory = path.join(options.out, `attempt-${index}`);
    mkdirSync(directory);
    const seed = interrupted ?? best;
    if (seed) {
      for (const paint of seed.delivery.paints) {
        copyFileSync(
          path.join(seed.directory, `${paint}.icon`),
          path.join(directory, `${paint}.icon`)
        );
        copyFileSync(
          path.join(seed.directory, `${paint}.proof.png`),
          path.join(directory, `previous-${paint}.proof.png`)
        );
      }
    }
    const finalizationPrograms = interrupted
      ? new Map(
          interrupted.delivery.paints.map((paint) => [
            paint,
            readFileSync(path.join(directory, `${paint}.icon`)),
          ])
        )
      : undefined;
    const guidance = attemptGuidance(
      options.guidance,
      best,
      Boolean(interrupted)
    );
    const currentOptions = {
      ...options,
      authorBudgetMs: budgetFor(Boolean(best), Boolean(interrupted)),
      composition,
      guidance,
      meanings,
      out: directory,
      reviewerReserveMs: 240_000,
    };
    const delivery = await authorStyle(currentOptions);
    const changedFinalizationPrograms = finalizationPrograms
      ? [...finalizationPrograms].flatMap(([paint, original]) =>
          original.equals(readFileSync(path.join(directory, `${paint}.icon`)))
            ? []
            : [`${paint}.icon`]
        )
      : [];
    if (changedFinalizationPrograms.length) {
      delivery.changedInputs.push(
        ...changedFinalizationPrograms.map(
          (name) => `finalization-geometry:${name}`
        )
      );
      delivery.completionProvenance = "incomplete";
      delivery.status = "incomplete";
      writeFileSync(
        path.join(directory, "delivery.json"),
        JSON.stringify(delivery, null, 2)
      );
    }
    if (delivery.status !== "delivered") {
      history.push({ directory, status: "incomplete" });
      if (canResumeFinalization(delivery, index, options)) {
        return attempt(index + 1, best, { delivery, directory });
      }
      return {
        delivery: best?.delivery ?? delivery,
        reason:
          remainingTime(options) <= 0
            ? "deadline-exhausted"
            : "author-incomplete",
        selected: best,
      };
    }
    if (
      blockingAuthorLimitations(delivery).some(
        (item) => item.kind === "representation"
      )
    ) {
      history.push({ directory, status: "representation-blocked" });
      return {
        delivery: best?.delivery ?? delivery,
        reason: "representation-blocked",
        selected: best,
      };
    }
    const hash = artifactHash(currentOptions, delivery);
    if (seen.has(hash)) {
      history.push({ directory, hash, status: "repeated-artifact" });
      return {
        delivery: best?.delivery ?? delivery,
        reason: "repeated-artifact",
        selected: best,
      };
    }
    seen.add(hash);
    const candidate = await inspectCandidate(currentOptions, delivery);
    const status = qualityStatus(candidate);
    history.push({ directory, hash, status });
    if (options.nativeRoute) {
      return {
        delivery,
        reason: status,
        selected: candidate,
      };
    }
    if (best && !improves(candidate, best)) {
      return {
        delivery: best.delivery,
        reason: "no-demonstrated-improvement",
        selected: best,
      };
    }
    const stopped = stopReason(status, index, options);
    if (stopped) {
      return {
        delivery,
        reason: stopped,
        selected: candidate,
      };
    }
    return attempt(index + 1, candidate);
  };
  const result = await attempt(1);
  const exportAdmittedAt = Date.now();
  const deliveryPath = path.join(options.out, "delivery.json");
  if (nativeBudget && existsSync(deliveryPath)) {
    throw new Error("Native artifact export requires a fresh delivery path");
  }
  const exportAdmission = nativeBudget
    ? admitNativeStage({
        deadlineAt: nativeBudget.deadlineAt,
        maximumMs: nativeBudget.exportReserveMs,
        minimumMs: nativeBudget.exportReserveMs,
        now: exportAdmittedAt,
        remainingReserveMs: 0,
        stage: "artifact-export",
      })
    : undefined;
  const exportStartedAt = exportAdmission ? exportAdmittedAt : undefined;
  const selectedAttempt =
    result.selected?.directory ?? history.at(-1)?.directory;
  if (selectedAttempt) {
    for (const file of readdirSync(selectedAttempt, {
      withFileTypes: true,
    }).filter((entry) => entry.isFile())) {
      copyFileSync(
        path.join(selectedAttempt, file.name),
        path.join(options.out, file.name)
      );
    }
  }
  const exportCompletedAt = exportAdmission ? Date.now() : undefined;
  if (
    exportAdmission &&
    exportCompletedAt !== undefined &&
    exportCompletedAt >= exportAdmission.stageDeadlineAt
  ) {
    throw new Error("Artifact export returned after its stage deadline");
  }
  const fallbackStatus =
    result.reason === "representation-blocked"
      ? "representation-blocked"
      : "not-reviewed";
  const finalQuality = result.selected
    ? qualityStatus(result.selected)
    : fallbackStatus;
  const receipt = {
    ...result.delivery,
    attempts: history,
    craftApproved: false,
    deadlineExceeded: remainingTime(options) <= 0,
    elapsedMs: Date.now() - startedAt,
    instrumentQualified: false,
    maxWallMs,
    ...(options.nativeRoute
      ? {
          nativeRoute: {
            author: {
              id: options.nativeRoute.author.id,
              lineage: options.nativeRoute.author.lineage,
            },
            budget: options.nativeBudget,
            export: {
              completedAt: exportCompletedAt,
              deadlineAt: exportAdmission?.stageDeadlineAt,
              startedAt: exportStartedAt,
            },
            externalReviewRedraws: 0,
            reviewers: options.nativeRoute.reviewers.map(
              ({ id, lineage, model }) => ({ id, lineage, model })
            ),
            runtimeRoot: options.nativeRoute.runtimeRoot,
          },
          reviews: result.selected?.reviews,
        }
      : {}),
    qualityStatus:
      remainingTime(options) <= 0 ? "deadline-exhausted" : finalQuality,
    selectedAttempt,
    stoppedReason: result.reason,
  };
  writeFileSync(deliveryPath, JSON.stringify(receipt, null, 2));
  if (exportAdmission && Date.now() >= exportAdmission.stageDeadlineAt) {
    unlinkSync(deliveryPath);
    throw new Error("Delivery publication returned after its stage deadline");
  }
  return receipt;
};

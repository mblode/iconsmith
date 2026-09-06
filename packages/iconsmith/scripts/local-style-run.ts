/** Selected-style local run: prepare, author, recheck, require delivery. */
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  lstatSync,
  realpathSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { z } from "zod";

import { createStyleRevision, selectStyle } from "../src/pipeline/style.js";
import { sheet } from "../src/tools/render.js";
import type { readAuthorTrace } from "./local-author-evidence.js";
import { collectAuthorInspection } from "./local-author-evidence.js";
import type { CompositionInput } from "./local-composition.js";
import {
  COMPOSITION_INSTRUCTIONS,
  stageComposition,
} from "./local-composition.js";
import { reviewImages } from "./local-review.js";
import type { LocalRuntime } from "./local-runtime.js";
import { referenceProofName, referenceProofs } from "./reference-proofs.js";
import {
  constructionEvidence,
  constructionStyleQuestion,
} from "./review-construction.js";

export const AUTHOR_REVIEW_INSTRUCTIONS =
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

interface ProcessResult {
  code: number | string | null;
  killed: boolean;
  stdout: string;
  stderr: string;
}
interface LocalStyleOptions {
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
}
const remainingTime = (options: LocalStyleOptions) =>
  (options.deadlineAt ?? Infinity) - Date.now();
const requireRunTime = (options: LocalStyleOptions) => {
  if (remainingTime(options) <= 0) {
    throw new Error("Run deadline exhausted before author invocation");
  }
};
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

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

const authorStyle = async (options: LocalStyleOptions) => {
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
  const paints = options.finish ? [options.finish] : ["outlined", "filled"];
  const save = (name: string, data: string | Uint8Array) =>
    writeFileSync(path.join(out, name), data);
  save("revision.json", JSON.stringify(revision.definition, null, 2));
  save("spec.json", JSON.stringify(style.spec, null, 2));
  save(
    "parts-names.json",
    JSON.stringify(
      style.parts.map(({ id, name, w, h, closed, nodes, icons }) => ({
        closed,
        h,
        id,
        name,
        nodes,
        sources: icons,
        w,
      })),
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
  }
  save(
    "reference-proofs.json",
    JSON.stringify(
      referenceEvidence.map((evidence) => evidence.manifest),
      null,
      2
    )
  );
  copyFileSync(
    fileURLToPath(new URL("../SKILL.md", import.meta.url)),
    path.join(out, "SKILL.md")
  );
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
  const brief = `Design ${options.concept} in the pinned reference style. Read SKILL.md, spec.json and parts-names.json. Selected spec values override generic house defaults. ${style.references.length ? "Inspect references.png; reference-order.json lists its row-major order." : "No reference images supplied; do not claim reference matching."}
Reference-<index>-proof images use the same reference-order.json indices and candidate native size. They show unchanged source drawings at 1x/2x on both surfaces, not newly calibrated optical masters. Compare matching raster columns as well as enlarged contours.
Initial image attachments, in order: ${imageNames.length ? imageNames.join(", ") : "none"}. Images named previous-* show the candidate before this repair, never the final output.
${compositionImages.length ? COMPOSITION_INSTRUCTIONS : ""}
Write ${paints.map((p) => `${p}.icon`).join(" and ")} and author-review.json in this directory; review.md may retain fuller design notes. ${AUTHOR_REVIEW_INSTRUCTIONS} Do not modify compiler, specs or reference files. Use only constrained DSL primitives and admitted parts; no raw path data. No network, API tools, other agents or installs.
${options.guidance ?? ""}
Run the real checker after each revision:
${[checkerNode, ...checker].map(quote).join(" ")}
Use the native view_image tool with detail original to inspect every final *.proof.png after the final checker run; byte-matching tool-returned images are required for delivery. Inspect newly generated proof PNGs; initial attachments show references or previous candidates only. Listing files, reading image metadata or analysing pixel JSON does not establish visual inspection. If image viewing is unavailable or fails, state that inspection is incomplete in review.md and retain any uncertain defects; never claim to have seen an image from metadata alone. Inspect both *.proof.png files (or the requested single paint) for native 1x/2x pixels on light and dark surfaces, the enlarged PNGs and native.png at ${style.spec.size}px. Read each paint’s .pixels.json for exact native and retina grayscale rows[y][x], in local zero-based image pixels. Each matrix is hash-bound to its .native.png or .retina.png. These host files avoid custom raster scripts or dependency lookup. Review gaps, counter survival, curves, modifier readability and family proportions. Normal antialiasing is not itself a defect: identify a lost distinction, break, imbalance or inconsistent weight. Inspect resolved SVG contours when feature warnings identify tiny regions: invisibility at native size does not prove a contour is redundant. Account for intended holes and solid regions; repair unexpected holes or report them as unresolved. Never dismiss a contour as Boolean bookkeeping without geometric evidence. Preserve attempt-N programs before changes; checker snapshots retain compile evidence. Fix errors and explain unresolved warnings. A clean check is not a craft verdict. Up to four revisions, eight minutes. Keep inspection notes in review.md and record all unresolved defects in author-review.json. Missing or malformed author-review.json means incomplete delivery, regardless of process exit code. Only write here. Read BRIEF.md and execute.`;
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
    (async (prompt: string): Promise<ProcessResult> => {
      try {
        const running = promisify(execFile)(
          options.command,
          options.args(prompt, runtime.permissionArgs, images),
          {
            cwd: out,
            env: options.env,
            maxBuffer: 20 * 1024 * 1024,
            timeout: Math.max(1, Math.min(480_000, remainingTime(options))),
          }
        );
        running.child.stdin?.end();
        const { stdout, stderr } = await running;
        return { code: 0, killed: false, stderr, stdout };
      } catch (error) {
        const failure = error as Error & {
          code?: number | string;
          killed?: boolean;
          stdout?: string;
          stderr?: string;
        };
        return {
          code: failure.code ?? null,
          killed: failure.killed ?? false,
          stderr: failure.stderr ?? String(error),
          stdout: failure.stdout ?? "",
        };
      }
    });
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
    ...(compositionImages.length ? ["composition.json"] : []),
    ...imageNames,
  ];
  const inputs = new Map(
    inputNames.map((name) => [name, readFileSync(path.join(out, name))])
  );
  let author: ProcessResult;
  try {
    requireRunTime(options);
    author = await invoke(brief, out, images);
  } catch (error) {
    author = { code: null, killed: false, stderr: String(error), stdout: "" };
  }
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
  const complete = [
    author.code === 0,
    !author.killed,
    checked.status === 0,
    missing.length === 0,
    authorReview !== null,
    imageInspection?.complete === true,
  ].every(Boolean);
  const result = {
    ...intent,
    authorExitCode: author.code,
    authorReview,
    authorReviewError,
    changedInputs,
    checkExitCode: checked.status,
    imageInspection,
    imageInspectionError,
    missing,
    reviewContentValidated: false,
    status: complete ? "delivered" : "incomplete",
  };
  save("delivery.json", JSON.stringify(result, null, 2));
  return result;
};

export const recognitionQuestion = (meanings: readonly string[]) => ({
  choices: [...meanings, "uncertain"],
  id: "meaning",
  prompt:
    "Identify the candidate icon from the alternatives. The intended answer is withheld. Choose uncertain if none fits or multiple alternatives are equally plausible. Base the choice on visible features, including modifiers; explain what you actually see.",
});

export const qualityQuestions = (
  meanings: readonly string[],
  facts: ReturnType<typeof constructionEvidence>
) => [
  recognitionQuestion(meanings),
  constructionStyleQuestion(facts),
  {
    choices: ["pass", "fail", "uncertain"],
    id: "optics",
    prompt:
      "At the labelled native size, are meaningful gaps/counters and modifiers readable at both device scales and on both surfaces? Reject a demonstrably collapsed feature, not deliberate solid modifiers or antialiasing itself.",
  },
  {
    choices: ["pass", "fail", "uncertain"],
    id: "family",
    prompt:
      "Do the delivered paints preserve the same concept, apparent scale and layout, allowing deliberate optical differences? For a single paint, assess consistency of repeated forms within it.",
  },
];

type AuthorResult = Awaited<ReturnType<typeof authorStyle>>;
type ReviewResult = Awaited<ReturnType<typeof reviewImages>>;
interface Candidate {
  directory: string;
  delivery: AuthorResult;
  review: ReviewResult;
  hash: string;
}

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

const inspectCandidate = async (
  options: LocalStyleOptions,
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
  const review = await (options.review ?? reviewImages)({
    deadlineAt: options.deadlineAt,
    images: Object.fromEntries(
      imageNames.map((name) => [
        name.replaceAll(".", "-").replace(/-png$/u, ".png"),
        readFileSync(path.join(options.out, name)),
      ])
    ),
    out: path.join(options.out, "independent-review"),
    questions: qualityQuestions(options.meanings, facts),
  });
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
    candidate.delivery.authorReview?.unresolved.length ||
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

/** One local production loop. Every author/reviewer attempt remains on disk.
 * An unqualified critic can request repairs, never promote an icon to approved.
 */
export const runLocalStyle = async (input: LocalStyleOptions) => {
  const startedAt = Date.now();
  const maxWallMs = input.maxWallMs ?? 600_000;
  if (!Number.isFinite(maxWallMs) || maxWallMs <= 0) {
    throw new Error("Run wall budget must be positive and finite");
  }
  const options = { ...input, deadlineAt: startedAt + maxWallMs };
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
  const attempt = async (
    index: number,
    best?: Candidate
  ): Promise<{
    delivery: AuthorResult;
    selected?: Candidate;
    reason: string;
  }> => {
    const directory = path.join(options.out, `attempt-${index}`);
    mkdirSync(directory);
    if (best) {
      for (const paint of best.delivery.paints) {
        copyFileSync(
          path.join(best.directory, `${paint}.icon`),
          path.join(directory, `${paint}.icon`)
        );
        copyFileSync(
          path.join(best.directory, `${paint}.proof.png`),
          path.join(directory, `previous-${paint}.proof.png`)
        );
      }
    }
    const guidance = [
      options.guidance ?? "",
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
    const currentOptions = {
      ...options,
      composition,
      guidance,
      meanings,
      out: directory,
    };
    const delivery = await authorStyle(currentOptions);
    if (delivery.status !== "delivered") {
      history.push({ directory, status: "incomplete" });
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
      delivery.authorReview?.unresolved.some(
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
  const fallbackStatus =
    result.reason === "representation-blocked"
      ? "representation-blocked"
      : "not-reviewed";
  const receipt = {
    ...result.delivery,
    attempts: history,
    craftApproved: false,
    deadlineExceeded: remainingTime(options) <= 0,
    elapsedMs: Date.now() - startedAt,
    instrumentQualified: false,
    maxWallMs,
    qualityStatus: result.selected
      ? qualityStatus(result.selected)
      : fallbackStatus,
    selectedAttempt,
    stoppedReason: result.reason,
  };
  writeFileSync(
    path.join(options.out, "delivery.json"),
    JSON.stringify(receipt, null, 2)
  );
  return receipt;
};

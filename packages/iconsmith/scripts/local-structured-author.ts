/** Host-orchestrated structured author contender. It is not a default route. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

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

export interface StructuredHostCheck {
  proofs: Readonly<Partial<Record<Finish, Uint8Array>>>;
  status: number | null;
  stderr: string;
  stdout: string;
}

export interface StructuredAuthorOptions {
  check: (cwd: string) => Promise<StructuredHostCheck>;
  construct: (request: {
    defects: readonly Defect[];
    deadlineAt: number;
    model: string;
    previousPrograms: Readonly<Partial<Record<Finish, string>>>;
    prompt: string;
    stage: "construct" | "repair";
  }) => Promise<unknown>;
  deadlineAt: number;
  finalize: (request: {
    deadlineAt: number;
    inspection: Inspection;
    model: string;
    programHashes: Readonly<Partial<Record<Finish, string>>>;
  }) => Promise<unknown>;
  finishes: readonly Finish[];
  inspect: (request: {
    deadlineAt: number;
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

const requireTime = (deadlineAt: number) => {
  if (Date.now() >= deadlineAt) {
    throw new Error("Structured author deadline exhausted");
  }
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
      (options.deadlineAt -
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
  let acceptedProgramHashes: Partial<Record<Finish, string>> = {};
  let acceptedProofHashes: Partial<Record<Finish, string>> = {};
  const stages: unknown[] = [];
  for (let attempt = 0; ; attempt += 1) {
    requireTime(options.deadlineAt);
    const previousPrograms = { ...programs };
    const previousInspection = inspection;
    const constructionDeadlineAt = Math.min(
      options.deadlineAt -
        STRUCTURED_INSPECTION_RESERVE_MS -
        STRUCTURED_FINAL_STAGES_RESERVE_MS,
      attempt === 0
        ? scheduleStartedAt + STRUCTURED_INITIAL_CONSTRUCTION_CAP_MS
        : Number.POSITIVE_INFINITY
    );
    let construction: Construction;
    try {
      construction = recovery
        ? { addressedDefectIds: [], programs }
        : constructionSchema.parse(
            await options.construct({
              deadlineAt: constructionDeadlineAt,
              defects: inspection.defects,
              model,
              previousPrograms,
              prompt: options.prompt,
              stage: attempt === 0 ? "construct" : "repair",
            })
          );
      validatePrograms(construction, options.finishes, inspection.defects);
    } catch (error) {
      if (attempt === 0 || Object.keys(acceptedPrograms).length === 0) {
        throw error;
      }
      programs = { ...acceptedPrograms };
      inspection = previousInspection;
      for (const finish of options.finishes) {
        writeFileSync(
          path.join(options.out, `${finish}.icon`),
          programs[finish] ?? ""
        );
      }
      const restored = await options.check(options.out);
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
    const checked = await options.check(options.out);
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
      if (Object.keys(acceptedPrograms).length > 0) {
        programs = { ...acceptedPrograms };
        inspection = previousInspection;
        for (const finish of options.finishes) {
          writeFileSync(
            path.join(options.out, `${finish}.icon`),
            programs[finish] ?? ""
          );
        }
        const restored = await options.check(options.out);
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
      if (
        compilerRepairsUsed >= requestedCompilerRepairs ||
        retrySlotsUsed >= repairSlots
      ) {
        throw new Error("No host-valid program survived compiler repair");
      }
      const compilerDiagnostic = JSON.stringify({
        status: checked.status,
        stderr: checked.stderr,
        stdout: checked.stdout,
      });
      inspection = {
        defects: [
          {
            description: compilerDiagnostic,
            finish: options.finishes[0] ?? "outlined",
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
    const checkedProofHashes = proofHashes(options.finishes, checked.proofs);
    requireTime(options.deadlineAt);
    let candidateInspection: Inspection;
    try {
      candidateInspection = inspectionSchema.parse(
        await options.inspect({
          deadlineAt: Math.min(
            options.deadlineAt - STRUCTURED_FINAL_STAGES_RESERVE_MS,
            Date.now() + STRUCTURED_INSPECTION_RESERVE_MS
          ),
          model,
          programHashes,
          proofHashes: checkedProofHashes,
          proofs: checked.proofs,
        })
      );
    } catch (error) {
      if (attempt === 0 || Object.keys(acceptedPrograms).length === 0) {
        throw error;
      }
      programs = { ...acceptedPrograms };
      inspection = previousInspection;
      for (const finish of options.finishes) {
        writeFileSync(
          path.join(options.out, `${finish}.icon`),
          programs[finish] ?? ""
        );
      }
      const restored = await options.check(options.out);
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
    acceptedProgramHashes = programHashes;
    acceptedProofHashes = checkedProofHashes;
    acceptedPrograms = { ...programs };
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
  const finalCheck = await options.check(options.out);
  const finalProofHashes = proofHashes(options.finishes, finalCheck.proofs);
  if (
    finalCheck.status !== 0 ||
    JSON.stringify(programHashes) !== JSON.stringify(acceptedProgramHashes) ||
    JSON.stringify(finalProofHashes) !== JSON.stringify(acceptedProofHashes)
  ) {
    throw new Error("Final programs are not bound to the accepted host proofs");
  }
  requireTime(options.deadlineAt);
  const review = finalReviewSchema.parse(
    await options.finalize({
      deadlineAt: options.deadlineAt,
      inspection,
      model,
      programHashes,
    })
  );
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
  const receipt = {
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
  return receipt;
};

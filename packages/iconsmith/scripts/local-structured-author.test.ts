import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import {
  runStructuredAuthor,
  STRUCTURED_AUTHOR_MODEL,
  STRUCTURED_FINAL_STAGES_RESERVE_MS,
  STRUCTURED_INITIAL_CONSTRUCTION_CAP_MS,
  STRUCTURED_INSPECTION_RESERVE_MS,
} from "./local-structured-author.js";

it("reserves 150 seconds for proof inspection", () => {
  expect(STRUCTURED_INSPECTION_RESERVE_MS).toBe(150_000);
});

const program = (radius: number) =>
  `icon ring\nfinish outlined\ncircle 12,12 r${radius}`;

it("repairs only a named observed defect and finalizes after proof inspection", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  const construct = vi
    .fn()
    .mockResolvedValueOnce({
      addressedDefectIds: [],
      programs: { outlined: program(8) },
    })
    .mockResolvedValueOnce({
      addressedDefectIds: ["small-counter"],
      programs: { outlined: program(9) },
    });
  const inspect = vi
    .fn()
    .mockResolvedValueOnce({
      defects: [
        {
          description: "Counter is too small at native size.",
          finish: "outlined",
          id: "small-counter",
          kind: "visual",
          treatment: "Increase the circle radius.",
        },
      ],
      inspectionEvidence: "Observed on the exact host proof.",
    })
    .mockResolvedValueOnce({
      defects: [],
      inspectionEvidence: "Counter remains visible.",
    });
  try {
    const result = await runStructuredAuthor({
      check: (cwd) =>
        Promise.resolve({
          proofs: {
            outlined: Buffer.from(
              readFileSync(path.join(cwd, "outlined.icon"))
            ),
          },
          status: 0,
          stderr: "",
          stdout: "check0",
        }),
      construct,
      deadlineAt: Date.now() + 600_000,
      finalize: ({ inspection, model }) => {
        expect(model).toBe(STRUCTURED_AUTHOR_MODEL);
        expect(inspection.defects).toEqual([]);
        return Promise.resolve({
          reviewMarkdown: "Inspected exact proof.",
          unresolved: [],
        });
      },
      finishes: ["outlined"],
      inspect,
      out,
      prompt: "Draw a ring with constrained DSL.",
    });
    expect(result.status).toBe("delivered");
    expect(readFileSync(path.join(out, "outlined.icon"), "utf-8")).toBe(
      program(9)
    );
    expect(construct.mock.calls[1]?.[0]).toMatchObject({
      defects: [{ id: "small-counter" }],
      previousPrograms: { outlined: program(8) },
      stage: "repair",
    });
  } finally {
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("restores the prior host-valid DSL when a localized repair fails checking", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  let checks = 0;
  try {
    const result = await runStructuredAuthor({
      check: () => {
        const status = checks === 1 ? 1 : 0;
        checks += 1;
        return Promise.resolve({
          proofs: { outlined: Buffer.from("proof") },
          status,
          stderr: "bad repair",
          stdout: "",
        });
      },
      construct: ({ stage }) =>
        Promise.resolve({
          addressedDefectIds: stage === "repair" ? ["gap"] : [],
          programs: { outlined: stage === "repair" ? "invalid" : program(8) },
        }),
      deadlineAt: Date.now() + 600_000,
      finalize: ({ inspection }) =>
        Promise.resolve({
          reviewMarkdown: "Retained prior candidate.",
          unresolved: inspection.defects.map(({ description, id }) => ({
            description,
            id,
            kind: "visual",
          })),
        }),
      finishes: ["outlined"],
      inspect: () =>
        Promise.resolve({
          defects: [
            {
              description: "Gap uncertain.",
              finish: "outlined",
              id: "gap",
              kind: "visual",
              treatment: "Widen gap.",
            },
          ],
          inspectionEvidence: "Exact proof inspected.",
        }),
      out,
      prompt: "Draw.",
    });
    expect(result.status).toBe("rejected-visible-defects");
    expect(readFileSync(path.join(out, "outlined.icon"), "utf-8")).toBe(
      program(8)
    );
    expect(checks).toBe(4);
  } finally {
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("restores an exact inspected candidate when repair invocation times out", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-07T13:00:00Z"));
  const startedAt = Date.now();
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  const deadlines: { deadlineAt: number; stage: string }[] = [];
  let checks = 0;
  try {
    const result = await runStructuredAuthor({
      check: () => {
        checks += 1;
        return Promise.resolve({
          proofs: { outlined: Buffer.from("proof") },
          status: 0,
          stderr: "",
          stdout: "check0",
        });
      },
      construct: ({ deadlineAt, stage }) => {
        deadlines.push({ deadlineAt, stage });
        if (stage === "repair") {
          writeFileSync(path.join(out, "outlined.icon"), "partial repair");
          return Promise.reject(new Error("owned process timed out"));
        }
        return Promise.resolve({
          addressedDefectIds: [],
          programs: { outlined: program(8) },
        });
      },
      deadlineAt: startedAt + 600_000,
      finalize: ({ deadlineAt, inspection }) => {
        expect(deadlineAt).toBe(startedAt + 600_000);
        return Promise.resolve({
          reviewMarkdown: "Repair timed out; retained inspected proof.",
          unresolved: inspection.defects.map(({ description, id, kind }) => ({
            description,
            id,
            kind,
          })),
        });
      },
      finishes: ["outlined"],
      inspect: ({ deadlineAt }) => {
        expect(deadlineAt).toBe(startedAt + STRUCTURED_INSPECTION_RESERVE_MS);
        return Promise.resolve({
          defects: [
            {
              description: "Pause reads as a face.",
              finish: "outlined",
              id: "author-self-review-outlined",
              kind: "visual",
              treatment: "Relocate the pause badge.",
            },
          ],
          inspectionEvidence: "Observed on the exact proof.",
          uncertainties: [],
        });
      },
      out,
      prompt: "Draw.",
    });
    expect(deadlines).toEqual([
      {
        deadlineAt: startedAt + STRUCTURED_INITIAL_CONSTRUCTION_CAP_MS,
        stage: "construct",
      },
      {
        deadlineAt:
          startedAt +
          600_000 -
          STRUCTURED_INSPECTION_RESERVE_MS -
          STRUCTURED_FINAL_STAGES_RESERVE_MS,
        stage: "repair",
      },
    ]);
    expect(result.status).toBe("rejected-visible-defects");
    expect(result.stages).toContainEqual(
      expect.objectContaining({
        error: "owned process timed out",
        status: "repair-invocation-failed-restored",
      })
    );
    expect(readFileSync(path.join(out, "outlined.icon"), "utf-8")).toBe(
      program(8)
    );
    expect(checks).toBe(3);
  } finally {
    vi.useRealTimers();
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("leaves a second inspection and finalization after A141-like stage timing", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-07T13:00:00Z"));
  const startedAt = Date.now();
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  const constructionDeadlines: number[] = [];
  const inspectionDeadlines: number[] = [];
  let inspection = 0;
  try {
    const result = await runStructuredAuthor({
      check: (cwd) =>
        Promise.resolve({
          proofs: {
            outlined: Buffer.from(
              readFileSync(path.join(cwd, "outlined.icon"))
            ),
          },
          status: 0,
          stderr: "",
          stdout: "check0",
        }),
      construct: ({ deadlineAt, stage }) => {
        constructionDeadlines.push(deadlineAt);
        if (stage === "construct") {
          vi.setSystemTime(startedAt + 211_000);
          return Promise.resolve({
            addressedDefectIds: [],
            programs: { outlined: program(8) },
          });
        }
        vi.setSystemTime(startedAt + 370_000);
        return Promise.resolve({
          addressedDefectIds: ["small-counter"],
          programs: { outlined: program(9) },
        });
      },
      deadlineAt: startedAt + 600_000,
      finalize: ({ deadlineAt }) => {
        expect(deadlineAt).toBe(startedAt + 600_000);
        return Promise.resolve({ reviewMarkdown: "Clean.", unresolved: [] });
      },
      finishes: ["outlined"],
      inspect: ({ deadlineAt }) => {
        inspectionDeadlines.push(deadlineAt);
        inspection += 1;
        if (inspection === 1) {
          vi.setSystemTime(startedAt + 280_000);
          return Promise.resolve({
            defects: [
              {
                description: "Counter is too small.",
                finish: "outlined",
                id: "small-counter",
                kind: "visual",
                treatment: "Increase its radius.",
              },
            ],
            inspectionEvidence: "Exact proof inspected.",
            uncertainties: [],
          });
        }
        vi.setSystemTime(startedAt + 450_000);
        return Promise.resolve({
          defects: [],
          inspectionEvidence: "Repaired proof inspected.",
          uncertainties: [],
        });
      },
      out,
      prompt: "Draw.",
    });
    expect(constructionDeadlines).toEqual([
      startedAt + STRUCTURED_INITIAL_CONSTRUCTION_CAP_MS,
      startedAt +
        600_000 -
        STRUCTURED_INSPECTION_RESERVE_MS -
        STRUCTURED_FINAL_STAGES_RESERVE_MS,
    ]);
    expect(inspectionDeadlines).toEqual([
      startedAt + 211_000 + STRUCTURED_INSPECTION_RESERVE_MS,
      startedAt + 600_000 - STRUCTURED_FINAL_STAGES_RESERVE_MS,
    ]);
    expect(result.status).toBe("delivered");
  } finally {
    vi.useRealTimers();
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("does not accept a host-valid repair whose inspection times out", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  let inspections = 0;
  let checks = 0;
  try {
    const result = await runStructuredAuthor({
      check: (cwd) => {
        checks += 1;
        return Promise.resolve({
          proofs: {
            outlined: Buffer.from(
              readFileSync(path.join(cwd, "outlined.icon"))
            ),
          },
          status: 0,
          stderr: "",
          stdout: "check0",
        });
      },
      construct: ({ stage }) =>
        Promise.resolve({
          addressedDefectIds: stage === "repair" ? ["small-counter"] : [],
          programs: { outlined: stage === "repair" ? program(9) : program(8) },
        }),
      deadlineAt: Date.now() + 600_000,
      finalize: ({ inspection }) =>
        Promise.resolve({
          reviewMarkdown: "Uninspected repair rejected; prior proof retained.",
          unresolved: inspection.defects.map(({ description, id, kind }) => ({
            description,
            id,
            kind,
          })),
        }),
      finishes: ["outlined"],
      inspect: () => {
        inspections += 1;
        if (inspections === 2) {
          return Promise.reject(new Error("inspection timed out"));
        }
        return Promise.resolve({
          defects: [
            {
              description: "Counter is too small.",
              finish: "outlined",
              id: "small-counter",
              kind: "visual",
              treatment: "Increase its radius.",
            },
          ],
          inspectionEvidence: "Original exact proof inspected.",
          uncertainties: [],
        });
      },
      out,
      prompt: "Draw.",
    });
    expect(result.status).toBe("rejected-visible-defects");
    expect(result.stages).toContainEqual(
      expect.objectContaining({
        error: "inspection timed out",
        status: "repair-inspection-failed-restored",
      })
    );
    expect(readFileSync(path.join(out, "outlined.icon"), "utf-8")).toBe(
      program(8)
    );
    expect(checks).toBe(4);
  } finally {
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("rejects final review that silently omits a surviving defect", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  try {
    await expect(
      runStructuredAuthor({
        check: () =>
          Promise.resolve({
            proofs: { outlined: Buffer.from("proof") },
            status: 0,
            stderr: "",
            stdout: "check0",
          }),
        construct: () =>
          Promise.resolve({
            addressedDefectIds: [],
            programs: { outlined: program(8) },
          }),
        deadlineAt: Date.now() + 180_000,
        finalize: () =>
          Promise.resolve({ reviewMarkdown: "Looks good.", unresolved: [] }),
        finishes: ["outlined"],
        inspect: () =>
          Promise.resolve({
            defects: [
              {
                description: "Gap remains uncertain.",
                finish: "outlined",
                id: "gap",
                kind: "visual",
                treatment: "Inspect the gap.",
              },
            ],
            inspectionEvidence: "Exact proof inspected.",
          }),
        out,
        prompt: "Draw.",
      })
    ).rejects.toThrow("omitted a surviving inspected defect");
  } finally {
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("repairs an initial host compiler defect before any visual inspection", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  const rejected = `icon folder-lock\nfinish outlined\nrect 2 7 20 14 r1\narc 8 9 16 9 180 0\nunion\nfit 2 2 20 20`;
  const corrected = `icon folder-lock\nfinish outlined\nrect 2 7 20 14 r1\narc 8 9 16 9 180 0\nfit 2 2 20 20\nunion`;
  const construct = vi
    .fn()
    .mockResolvedValueOnce({
      addressedDefectIds: [],
      programs: { outlined: rejected },
    })
    .mockImplementationOnce(({ defects }) => {
      expect(defects).toEqual([
        expect.objectContaining({
          description: JSON.stringify({
            status: 1,
            stderr: "line 6: Transform operands before Boolean composition",
            stdout: "",
          }),
          id: "host-compiler-attempt-0",
          kind: "representation",
        }),
      ]);
      return Promise.resolve({
        addressedDefectIds: ["host-compiler-attempt-0"],
        programs: { outlined: corrected },
      });
    });
  const inspect = vi.fn().mockResolvedValue({
    defects: [],
    inspectionEvidence: "Inspected corrected host proof only.",
  });
  try {
    const result = await runStructuredAuthor({
      check: (cwd) => {
        const source = readFileSync(path.join(cwd, "outlined.icon"), "utf-8");
        const invalid = source.indexOf("union") < source.indexOf("fit");
        return Promise.resolve({
          proofs: invalid ? {} : { outlined: Buffer.from(source) },
          status: invalid ? 1 : 0,
          stderr: invalid
            ? "line 6: Transform operands before Boolean composition"
            : "",
          stdout: invalid ? "" : "check0",
        });
      },
      construct,
      deadlineAt: Date.now() + 600_000,
      finalize: () =>
        Promise.resolve({
          reviewMarkdown: "Valid and inspected.",
          unresolved: [],
        }),
      finishes: ["outlined"],
      inspect,
      maxRepairs: 1,
      out,
      prompt: "Draw folder-lock.",
    });
    expect(result.status).toBe("delivered");
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(construct.mock.calls[1]?.[0]).toMatchObject({
      previousPrograms: { outlined: rejected },
      stage: "repair",
    });
    expect(
      readFileSync(path.join(out, "rejected-attempt-0-outlined.icon"), "utf-8")
    ).toBe(rejected);
    expect(readFileSync(path.join(out, "outlined.icon"), "utf-8")).toBe(
      corrected
    );
  } finally {
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("keeps a visual repair after correcting an initial compiler defect", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "structured-author-")),
    "run"
  );
  const invalid = "invalid";
  const hostValid = program(8);
  const visuallyRepaired = program(9);
  const construct = vi
    .fn()
    .mockResolvedValueOnce({
      addressedDefectIds: [],
      programs: { outlined: invalid },
    })
    .mockResolvedValueOnce({
      addressedDefectIds: ["host-compiler-attempt-0"],
      programs: { outlined: hostValid },
    })
    .mockResolvedValueOnce({
      addressedDefectIds: ["undersize"],
      programs: { outlined: visuallyRepaired },
    });
  const inspect = vi
    .fn()
    .mockResolvedValueOnce({
      defects: [
        {
          description: "The native mark is undersized.",
          finish: "outlined",
          id: "undersize",
          kind: "visual",
          treatment: "Increase its optical size.",
        },
      ],
      inspectionEvidence: "Inspected the host-valid native proof.",
    })
    .mockResolvedValueOnce({
      defects: [],
      inspectionEvidence: "The repaired native proof fills the keyline.",
    });
  try {
    const result = await runStructuredAuthor({
      check: (cwd) => {
        const source = readFileSync(path.join(cwd, "outlined.icon"), "utf-8");
        return Promise.resolve({
          proofs: source === invalid ? {} : { outlined: Buffer.from(source) },
          status: source === invalid ? 1 : 0,
          stderr: source === invalid ? "invalid DSL" : "",
          stdout: "",
        });
      },
      construct,
      deadlineAt: Date.now() + 600_000,
      finalize: () =>
        Promise.resolve({ reviewMarkdown: "Ready.", unresolved: [] }),
      finishes: ["outlined"],
      inspect,
      maxCompilerRepairs: 1,
      maxRepairs: 1,
      out,
      prompt: "Draw.",
    });
    expect(result.status).toBe("delivered");
    expect(result.repairBudget).toMatchObject({
      compiler: { requested: 1, used: 1 },
      totalRetrySlotsUsed: 2,
      visual: { requested: 1, used: 1 },
    });
    expect(result.repairBudget.totalRetrySlots).toBeGreaterThanOrEqual(2);
    expect(result.repairBudget.totalRetrySlots).toBeLessThanOrEqual(4);
    expect(construct).toHaveBeenCalledTimes(3);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(construct.mock.calls[2]?.[0]).toMatchObject({
      defects: [expect.objectContaining({ id: "undersize", kind: "visual" })],
      previousPrograms: { outlined: hostValid },
      stage: "repair",
    });
    expect(readFileSync(path.join(out, "outlined.icon"), "utf-8")).toBe(
      visuallyRepaired
    );
  } finally {
    rmSync(path.dirname(out), { force: true, recursive: true });
  }
});

it("bounds compiler and visual repairs by their limits and shared deadline slots", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "structured-author-bounds-"));
  const noCompilerOut = path.join(root, "no-compiler");
  await expect(
    runStructuredAuthor({
      check: () =>
        Promise.resolve({
          proofs: {},
          status: 1,
          stderr: "invalid",
          stdout: "",
        }),
      construct: () =>
        Promise.resolve({
          addressedDefectIds: [],
          programs: { outlined: "invalid" },
        }),
      deadlineAt: Date.now() + 600_000,
      finalize: () =>
        Promise.resolve({ reviewMarkdown: "Unreachable.", unresolved: [] }),
      finishes: ["outlined"],
      inspect: () => Promise.reject(new Error("Unreachable")),
      maxCompilerRepairs: 0,
      maxRepairs: 1,
      out: noCompilerOut,
      prompt: "Draw.",
    })
  ).rejects.toThrow("No host-valid program survived compiler repair");

  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T00:00:00Z"));
  const oneSlotOut = path.join(root, "one-slot");
  const construct = vi
    .fn()
    .mockResolvedValueOnce({
      addressedDefectIds: [],
      programs: { outlined: "invalid" },
    })
    .mockResolvedValueOnce({
      addressedDefectIds: ["host-compiler-attempt-0"],
      programs: { outlined: program(8) },
    });
  try {
    const result = await runStructuredAuthor({
      check: (cwd) => {
        const source = readFileSync(path.join(cwd, "outlined.icon"), "utf-8");
        return Promise.resolve({
          proofs: source === "invalid" ? {} : { outlined: Buffer.from(source) },
          status: source === "invalid" ? 1 : 0,
          stderr: source === "invalid" ? "invalid" : "",
          stdout: "",
        });
      },
      construct,
      deadlineAt:
        Date.now() +
        STRUCTURED_INSPECTION_RESERVE_MS +
        STRUCTURED_FINAL_STAGES_RESERVE_MS +
        90_000,
      finalize: ({ inspection }) =>
        Promise.resolve({
          reviewMarkdown: "Visual repair could not use another retry slot.",
          unresolved: inspection.defects.map(({ description, id, kind }) => ({
            description,
            id,
            kind,
          })),
        }),
      finishes: ["outlined"],
      inspect: () =>
        Promise.resolve({
          defects: [
            {
              description: "Still undersized.",
              finish: "outlined",
              id: "undersize",
              kind: "visual",
              treatment: "Increase optical size.",
            },
          ],
          inspectionEvidence: "Inspected.",
        }),
      maxCompilerRepairs: 1,
      maxRepairs: 1,
      out: oneSlotOut,
      prompt: "Draw.",
    });
    expect(result.status).toBe("rejected-visible-defects");
    expect(result.repairBudget).toEqual({
      compiler: { requested: 1, used: 1 },
      totalRetrySlots: 1,
      totalRetrySlotsUsed: 1,
      visual: { requested: 1, used: 0 },
    });
    expect(construct).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
    rmSync(root, { force: true, recursive: true });
  }
});

it("validates repair limits before creating the output directory", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "structured-author-limits-"));
  const out = path.join(root, "run");
  try {
    await expect(
      runStructuredAuthor({
        check: () => Promise.reject(new Error("Unreachable")),
        construct: () => Promise.reject(new Error("Unreachable")),
        deadlineAt: Date.now() + 600_000,
        finalize: () => Promise.reject(new Error("Unreachable")),
        finishes: ["outlined"],
        inspect: () => Promise.reject(new Error("Unreachable")),
        maxCompilerRepairs: -1,
        out,
        prompt: "Draw.",
      })
    ).rejects.toThrow("repair limits must be nonnegative integers");
    expect(() => readFileSync(out)).toThrow();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("preserves explicit uncertainty without authorizing a geometry repair", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "structured-uncertain-"));
  const construct = vi.fn(() =>
    Promise.resolve({
      addressedDefectIds: [],
      programs: { outlined: program(8) },
    })
  );
  try {
    const result = await runStructuredAuthor({
      check: () =>
        Promise.resolve({
          proofs: { outlined: Buffer.from("proof") },
          status: 0,
          stderr: "",
          stdout: "",
        }),
      construct,
      deadlineAt: Date.now() + 600_000,
      finalize: () =>
        Promise.resolve({
          reviewMarkdown: "Uncertainty remains pending.",
          unresolved: [],
        }),
      finishes: ["outlined"],
      inspect: () =>
        Promise.resolve({
          defects: [],
          inspectionEvidence: "Native edge is ambiguous.",
          uncertainties: [
            {
              description: "Cannot determine edge survival.",
              finish: "outlined",
            },
          ],
        }),
      out: path.join(root, "run"),
      prompt: "Draw a ring.",
    });
    expect(construct).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("delivered-with-uncertainty");
    expect(result.stages[0]).toMatchObject({
      inspection: { uncertainties: [{ finish: "outlined" }] },
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("recovers frozen host-valid programs without construction or repair", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "structured-recovery-"));
  const out = path.join(root, "run");
  const source = program(8);
  const sourceHash = createHash("sha256").update(source).digest("hex");
  const sourceReceipt = path.join(root, "source-receipt.json");
  writeFileSync(sourceReceipt, '{"status":"host-valid"}\n');
  const sourceReceiptHash = createHash("sha256")
    .update(readFileSync(sourceReceipt))
    .digest("hex");
  const construct = vi.fn();
  const check = vi.fn((cwd: string) =>
    Promise.resolve({
      proofs: {
        outlined: Buffer.from(
          readFileSync(path.join(cwd, "outlined.icon"), "utf-8")
        ),
      },
      status: 0,
      stderr: "",
      stdout: "check0",
    })
  );
  try {
    const result = await runStructuredAuthor({
      check,
      construct,
      deadlineAt: Date.now() + 600_000,
      finalize: () =>
        Promise.resolve({ reviewMarkdown: "Recovered.", unresolved: [] }),
      finishes: ["outlined"],
      initialProgramProvenance: {
        programHashes: { outlined: sourceHash },
        source: sourceReceipt,
        sourceSha256: sourceReceiptHash,
      },
      initialPrograms: { outlined: source },
      inspect: () =>
        Promise.resolve({
          defects: [],
          inspectionEvidence: "Proof inspected.",
        }),
      maxRepairs: 0,
      out,
      prompt: "Recover retained output only.",
    });
    expect(construct).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      stages: [
        {
          initialProgramProvenance: {
            programHashes: { outlined: sourceHash },
            source: sourceReceipt,
            sourceSha256: sourceReceiptHash,
          },
          status: "inspected",
        },
      ],
      status: "delivered",
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("rejects recovery when frozen source hashes or zero-repair policy differ", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "structured-recovery-bad-"));
  try {
    await expect(
      runStructuredAuthor({
        check: vi.fn(),
        construct: vi.fn(),
        deadlineAt: Date.now() + 600_000,
        finalize: vi.fn(),
        finishes: ["outlined"],
        initialProgramProvenance: {
          programHashes: { outlined: "wrong" },
          source: path.join(root, "missing-receipt.json"),
          sourceSha256: "wrong",
        },
        initialPrograms: { outlined: program(8) },
        inspect: vi.fn(),
        maxRepairs: 0,
        out: path.join(root, "run"),
        prompt: "Recover.",
      })
    ).rejects.toThrow("exact frozen provenance and zero repairs");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it.each([
  {
    defects: [
      {
        description: "The shackle is visibly detached.",
        finish: "outlined" as const,
        id: "detached-shackle",
        kind: "visual" as const,
        treatment: "Reconnect the centered shackle.",
      },
    ],
    expected: "rejected-visible-defects",
    finalUnresolved: [
      {
        description: "The shackle is visibly detached.",
        id: "detached-shackle",
        kind: "visual" as const,
      },
    ],
    uncertainties: [],
  },
  {
    defects: [],
    expected: "rejected-visible-defects",
    finalUnresolved: [
      {
        description: "Final review found a detached shackle.",
        id: "final-detached-shackle",
        kind: "visual" as const,
      },
    ],
    uncertainties: [],
  },
  {
    defects: [],
    expected: "review-pending-uncertainty",
    finalUnresolved: [],
    uncertainties: [
      {
        description: "Native attachment remains ambiguous.",
        finish: "outlined",
      },
    ],
  },
  {
    defects: [],
    expected: "review-pending-uncertainty",
    finalUnresolved: [
      {
        description: "Representation parity remains unresolved.",
        id: "representation-parity",
        kind: "representation" as const,
      },
    ],
    uncertainties: [],
  },
])("does not accept recovered output with $expected", async (assessment) => {
  const root = mkdtempSync(path.join(tmpdir(), "structured-recovery-review-"));
  const out = path.join(root, "run");
  const source = program(8);
  const sourceReceipt = path.join(root, "source-receipt.json");
  writeFileSync(sourceReceipt, '{"status":"host-valid"}\n');
  try {
    const result = await runStructuredAuthor({
      check: () =>
        Promise.resolve({
          proofs: { outlined: Buffer.from("proof") },
          status: 0,
          stderr: "",
          stdout: "check0",
        }),
      construct: vi.fn(),
      deadlineAt: Date.now() + 600_000,
      finalize: () =>
        Promise.resolve({
          reviewMarkdown: "Recovery remains unaccepted.",
          unresolved: assessment.finalUnresolved,
        }),
      finishes: ["outlined"],
      initialProgramProvenance: {
        programHashes: {
          outlined: createHash("sha256").update(source).digest("hex"),
        },
        source: sourceReceipt,
        sourceSha256: createHash("sha256")
          .update(readFileSync(sourceReceipt))
          .digest("hex"),
      },
      initialPrograms: { outlined: source },
      inspect: () =>
        Promise.resolve({
          defects: assessment.defects,
          inspectionEvidence: "Exact proof inspected.",
          uncertainties: assessment.uncertainties,
        }),
      maxRepairs: 0,
      out,
      prompt: "Recover.",
    });
    expect(result.status).toBe(assessment.expected);
    expect(
      JSON.parse(
        readFileSync(path.join(out, "structured-author.json"), "utf-8")
      )
    ).toMatchObject({ status: assessment.expected });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

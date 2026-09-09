/** Offline diagnostic for proposal transport and editable constrained replay. */
import { createHash } from "node:crypto";
import path from "node:path";

import sharp from "sharp";

import type { Proposal, ProposalBlock } from "../src/pipeline/compose.js";
import {
  assertNoGeometry,
  compose,
  describeProposal,
} from "../src/pipeline/compose.js";
import { completeProgram, run as runDsl } from "../src/tools/dsl.js";
import { programFromDoc } from "../src/tools/twin.js";

interface RasterProposalExpectation {
  adjacency: readonly string[];
  blocks: readonly ProposalBlock[];
}

export interface RasterProposalFixture {
  /** Structural coverage only; it cannot prove an op preserves block meaning. */
  blockBindings: readonly (readonly number[])[];
  concept: string;
  expectation: RasterProposalExpectation;
  finish: "filled" | "outlined";
  nativeSize: 16 | 24;
  program: string;
  provenance: {
    /** Human-readable provenance only. Filesystem paths are deliberately excluded. */
    label: string;
    origin: "provider-generated" | "synthetic-host-fixture";
    /** References sent to the image generator, with their admitted licence. */
    references: readonly {
      licence: string;
      set: string;
    }[];
  };
  sourceDimensions: { height: number; width: number };
  sourceSha256: string;
}

export interface RasterProposalFeasibilityResult {
  diagnosticOnly: true;
  editableReplay: true;
  inputSha256: string;
  program: string;
  programSha256: string;
  proposal: Omit<Proposal, "thumbnail"> & { thumbnailSha256: string };
  provenance: RasterProposalFixture["provenance"];
  qualificationEligible: false;
  replayProgram: string;
  replayProgramSha256: string;
  svg: string;
  svgSha256: string;
}

export class RasterProposalUnsupportedError extends Error {
  readonly observed: Omit<Proposal, "thumbnail">;

  constructor(message: string, proposal: Proposal) {
    super(message);
    this.name = "RasterProposalUnsupportedError";
    const { thumbnail: _thumbnail, ...observed } = proposal;
    this.observed = observed;
  }
}

const digest = (value: Buffer | string): string =>
  createHash("sha256").update(value).digest("hex");

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const refuse = (message: string, proposal: Proposal): never => {
  throw new RasterProposalUnsupportedError(message, proposal);
};

const validateProvenance = (
  provenance: RasterProposalFixture["provenance"]
): void => {
  if (!provenance.label.trim() || path.isAbsolute(provenance.label)) {
    throw new Error(
      "Raster provenance requires a nonempty human-readable label, not a filesystem path."
    );
  }
  if (provenance.references.length > 0) {
    throw new Error(
      "Raster proposal diagnostics refuse reference exposure until a canonical licence gate supplies it."
    );
  }
};

/**
 * Diagnose only when the offline reader observes the predeclared composition.
 * The DSL remains explicitly authored. This verifies proposal transport and
 * editable replay, but block bindings prove only structural coverage, not that
 * the program preserves the raster's semantics or native optical design.
 */
export const evaluateRasterProposalFixture = async (
  image: Buffer,
  fixture: RasterProposalFixture
): Promise<RasterProposalFeasibilityResult> => {
  validateProvenance(fixture.provenance);
  const proposal = await compose(image, { model: null });
  assertNoGeometry(proposal);
  const metadata = await sharp(image).metadata();
  if (
    digest(image) !== fixture.sourceSha256 ||
    metadata.width !== fixture.sourceDimensions.width ||
    metadata.height !== fixture.sourceDimensions.height
  ) {
    refuse(
      "Raster proposal is unsupported: source bytes or source dimensions differ from the predeclared fixture.",
      proposal
    );
  }
  if (
    !same(proposal.blocks, fixture.expectation.blocks) ||
    !same(proposal.adjacency, fixture.expectation.adjacency)
  ) {
    refuse(
      `Raster proposal is unsupported: expected ${fixture.expectation.blocks.length} ` +
        `semantic block(s), but the offline reader produced: ${describeProposal(proposal)}`,
      proposal
    );
  }
  if (
    fixture.blockBindings.length !== proposal.blocks.length ||
    fixture.blockBindings.some((binding) => binding.length === 0)
  ) {
    refuse(
      "Raster proposal is unsupported: every semantic block needs an explicit DSL draw-op binding.",
      proposal
    );
  }
  if (/^\s*raw\b/mu.test(fixture.program)) {
    refuse(
      "Raster proposal is unsupported: raw path data cannot enter an editable feasibility program.",
      proposal
    );
  }
  const drawn = runDsl(fixture.program);
  if (drawn.errors.length > 0) {
    refuse(
      `Raster proposal is unsupported: the constrained DSL refused the program (${drawn.errors.join("; ")}).`,
      proposal
    );
  }
  if (drawn.icon !== fixture.concept || drawn.finish !== fixture.finish) {
    refuse(
      "Raster proposal is unsupported: the DSL concept or paint differs from the fixture declaration.",
      proposal
    );
  }
  if (drawn.canvas.spec.size !== fixture.nativeSize) {
    refuse(
      "Raster proposal is unsupported: the DSL optical size differs from the predeclared native target.",
      proposal
    );
  }
  const doc = drawn.canvas.toJSON({ icon: drawn.icon, keyline: drawn.keyline });
  if (doc.draw.some((op) => op.op === "raw")) {
    refuse(
      "Raster proposal is unsupported: replay document contains raw path data.",
      proposal
    );
  }
  const indexes = fixture.blockBindings.flat();
  if (
    new Set(indexes).size !== indexes.length ||
    indexes.some(
      (index) =>
        !Number.isInteger(index) || index < 0 || index >= doc.draw.length
    )
  ) {
    refuse(
      "Raster proposal is unsupported: block bindings must name distinct existing draw ops.",
      proposal
    );
  }
  if (!completeProgram(doc, fixture.program)) {
    refuse(
      "Raster proposal is unsupported: its source program does not replay to the emitted document.",
      proposal
    );
  }
  const replayProgram = programFromDoc(doc);
  const replay = runDsl(replayProgram);
  const svg = drawn.canvas.toSVG();
  if (
    replay.errors.length > 0 ||
    !same(
      replay.canvas.toJSON({ icon: replay.icon, keyline: replay.keyline }),
      doc
    ) ||
    replay.canvas.toSVG() !== svg
  ) {
    refuse(
      "Raster proposal is unsupported: regenerated editable DSL is not an exact replay.",
      proposal
    );
  }
  const { thumbnail, ...words } = proposal;
  return {
    diagnosticOnly: true,
    editableReplay: true,
    inputSha256: digest(image),
    program: fixture.program,
    programSha256: digest(fixture.program),
    proposal: {
      ...words,
      thumbnailSha256: digest(Buffer.from(thumbnail, "base64")),
    },
    provenance: fixture.provenance,
    qualificationEligible: false,
    replayProgram,
    replayProgramSha256: digest(replayProgram),
    svg,
    svgSha256: digest(svg),
  };
};

/**
 * Predeclared before another paid call. With compose({ model: null }), D492's
 * 24px outlined Sunburst crop must read as a folder plus overlapping lock. A
 * one-component reading is an offline pixel-reader refusal. This diagnostic
 * does not exercise or exclude the model-backed semantic reader, selector, or
 * constrained drawer used by Studio.
 */
export const SUNBURST_OUTLINED_24_FIXTURE: RasterProposalFixture = {
  blockBindings: [[0], [1, 2, 3]],
  concept: "folder-lock",
  expectation: {
    adjacency: ["block 2 overlaps block 1"],
    blocks: [
      { cell: "center", shape: "square", size: "dominant" },
      { cell: "bottom-right", shape: "square", size: "small" },
    ],
  },
  finish: "outlined",
  nativeSize: 24,
  program: [
    "icon folder-lock",
    "finish outlined",
    "line 4,8 9,8 11,10 20,10 20,19 4,19 4,8",
    "arc 16,15 r3 half from left",
    "rect 13,15 6x5 r1",
    "dot 16,17 terminal",
    "",
  ].join("\n"),
  provenance: {
    label:
      "D492 Sunburst transparent sheet, fixed bottom-left 24px outlined crop",
    origin: "provider-generated",
    references: [],
  },
  sourceDimensions: { height: 24, width: 24 },
  sourceSha256:
    "9bf68e1f1b64d8c64e1ce6331b61394f24b40ed38ce1697a9873468d401602a0",
};

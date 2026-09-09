import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  OPTICAL_PROOF_PRESENTATION_PROTOCOL_HASH,
  OPTICAL_PROOF_PRESENTATION_VERSION,
} from "../src/tools/proof.js";
import { prepareAuthorReviewPacket } from "./author-review-packet.js";
import type {
  AuthorReviewPacketOptions,
  ReviewPacketFile,
} from "./author-review-packet.js";

const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const bound = (file: string): ReviewPacketFile => ({ file, sha256: sha(file) });
const proofMetadata = (nativeSize: 16 | 24, proofSha256?: string) => {
  const tile = nativeSize * 8;
  const column = tile + 32;
  const row = tile + 88;
  return {
    coordinateSpace: "24x24 SVG viewport",
    deviceScales: [1, 2],
    nativeCell: {
      darkTop: row + 44,
      height: nativeSize,
      left: 3 * column + 16,
      lightTop: 44,
      width: nativeSize,
    },
    nativeSize,
    opticalMasterClaim: false,
    presentationProtocolHash: OPTICAL_PROOF_PRESENTATION_PROTOCOL_HASH,
    presentationVersion: OPTICAL_PROOF_PRESENTATION_VERSION,
    ...(proofSha256 ? { proofSha256 } : {}),
    surfaces: ["black-on-white", "white-on-black monochrome inversion"],
  };
};
const fixture = async () => {
  const root = mkdtempSync(path.join(tmpdir(), "author-review-packet-"));
  const authorDirectory = path.join(root, "author");
  mkdirSync(authorDirectory);
  const native = await sharp({
    create: { background: "black", channels: 4, height: 16, width: 16 },
  })
    .png()
    .toBuffer();
  const proof = await sharp({
    create: { background: "white", channels: 4, height: 432, width: 640 },
  })
    .png()
    .toBuffer();
  const programHashes: Record<string, string> = {};
  const proofHashes: Record<string, string> = {};
  for (const finish of ["outlined", "filled"]) {
    const program = path.join(authorDirectory, `${finish}.icon`);
    const proofFile = path.join(authorDirectory, `${finish}.proof.png`);
    writeFileSync(program, `${finish} program`);
    writeFileSync(proofFile, proof);
    writeFileSync(path.join(authorDirectory, `${finish}.native.png`), native);
    programHashes[finish] = sha(program);
    proofHashes[finish] = sha(proofFile);
    writeFileSync(
      path.join(authorDirectory, `${finish}.proof.json`),
      JSON.stringify(proofMetadata(16))
    );
  }
  const inspectionValue = {
    defects: [],
    inspectionEvidence: "Inspected exact pixels",
    uncertainties: [],
  };
  const checksFile = path.join(authorDirectory, "checks.json");
  writeFileSync(
    checksFile,
    JSON.stringify({
      exactReplay: true,
      nativeSize: 16,
      paints: ["outlined", "filled"],
      pairChecked: true,
    })
  );
  const inspectionFile = path.join(authorDirectory, "inspection.json");
  writeFileSync(
    inspectionFile,
    JSON.stringify({
      evidenceHashes: {
        filled: proofHashes.filled,
        outlined: proofHashes.outlined,
      },
      imageInspection: { complete: true },
      status: "complete",
    })
  );
  const finalAuthorReviewFile = path.join(
    authorDirectory,
    "author-review.json"
  );
  writeFileSync(finalAuthorReviewFile, JSON.stringify({ unresolved: [] }));
  const finalReviewMarkdownFile = path.join(authorDirectory, "review.md");
  writeFileSync(finalReviewMarkdownFile, "Reviewed exact evidence.");
  const terminalFile = path.join(root, "terminal.json");
  writeFileSync(
    terminalFile,
    JSON.stringify({
      programHashes,
      proofHashes,
      stages: [
        {
          inspection: inspectionValue,
          programHashes,
          proofHashes,
          status: "inspected",
        },
      ],
      status: "delivered",
    })
  );
  const anchor = path.join(root, "anchor.png");
  writeFileSync(anchor, proof);
  const anchorMetadata = path.join(root, "anchor.json");
  writeFileSync(anchorMetadata, JSON.stringify(proofMetadata(16, sha(anchor))));
  const options: AuthorReviewPacketOptions = {
    authorDirectory,
    checks: bound(checksFile),
    concept: "bell-pause",
    expectedNativeSize: 16,
    familyProofs: [{ ...bound(anchor), metadata: bound(anchorMetadata) }],
    finalAuthorReview: bound(finalAuthorReviewFile),
    finalReviewMarkdown: bound(finalReviewMarkdownFile),
    inspectionReceipt: bound(inspectionFile),
    meanings: ["bell-pause", "bell-off"],
    out: path.join(root, "out"),
    packetId: "bell-pause-review",
    sourceIdentity: { familyPacketHash: "a".repeat(64) },
    stimulusId: "arm-a",
    terminal: bound(terminalFile),
  };
  return {
    anchorMetadata,
    inspectionFile,
    options,
  };
};

describe("prepareAuthorReviewPacket", () => {
  it("builds a deterministic board from terminal-bound proofs", async () => {
    const { options } = await fixture();
    const result = await prepareAuthorReviewPacket(options);
    expect(result.receipt.qualified).toBe(false);
    expect(result.input.stimuli[0]?.familyReferences).toHaveLength(1);
    expect(existsSync(result.input.stimuli[0]?.image ?? "")).toBe(true);
  });
  it("admits only an exact evidence-only uncertainty envelope", async () => {
    const { options } = await fixture();
    const terminal = JSON.parse(readFileSync(options.terminal.file, "utf-8"));
    terminal.status = "delivered-with-uncertainty";
    terminal.stages[0].inspection.uncertainties = [
      {
        description: "Native shackle pixels remain ambiguous.",
        finish: "outlined",
      },
    ];
    writeFileSync(options.terminal.file, JSON.stringify(terminal));
    options.terminal = bound(options.terminal.file);
    options.authorEvidence = {
      mode: "evidence-only-uncertainty",
      uncertainties: [
        {
          description: "Native shackle pixels remain ambiguous.",
          finish: "outlined",
          source: "structured-inspection",
        },
      ],
    };
    const result = await prepareAuthorReviewPacket(options);
    expect(result.receipt.authorEvidence).toMatchObject({
      mode: "evidence-only-uncertainty",
      uncertaintyCount: 1,
    });
  });
  it("refuses a forged evidence-only uncertainty envelope", async () => {
    const { options } = await fixture();
    const terminal = JSON.parse(readFileSync(options.terminal.file, "utf-8"));
    terminal.status = "delivered-with-uncertainty";
    terminal.stages[0].inspection.uncertainties = [
      {
        description: "Native shackle pixels remain ambiguous.",
        finish: "outlined",
      },
    ];
    writeFileSync(options.terminal.file, JSON.stringify(terminal));
    options.terminal = bound(options.terminal.file);
    options.authorEvidence = {
      mode: "evidence-only-uncertainty",
      uncertainties: [
        {
          description: "Different host assertion.",
          finish: "outlined",
          source: "structured-inspection",
        },
      ],
    };
    await expect(prepareAuthorReviewPacket(options)).rejects.toThrow(
      "complete admissible author review evidence"
    );
  });
  it.each([
    ["missing", undefined],
    ["null", null],
    ["object", {}],
  ])("refuses %s structured uncertainty arrays", async (_name, value) => {
    const { options } = await fixture();
    const terminal = JSON.parse(readFileSync(options.terminal.file, "utf-8"));
    terminal.stages[0].inspection.uncertainties = value;
    writeFileSync(options.terminal.file, JSON.stringify(terminal));
    options.terminal = bound(options.terminal.file);
    await expect(prepareAuthorReviewPacket(options)).rejects.toThrow(
      "complete admissible author review evidence"
    );
  });
  it.each([
    ["missing", undefined],
    ["null", null],
    ["object", {}],
  ])("refuses %s author uncertainty arrays", async (_name, value) => {
    const { options } = await fixture();
    writeFileSync(
      options.finalAuthorReview.file,
      JSON.stringify(value === undefined ? {} : { unresolved: value })
    );
    options.finalAuthorReview = bound(options.finalAuthorReview.file);
    await expect(prepareAuthorReviewPacket(options)).rejects.toThrow(
      "complete admissible author review evidence"
    );
  });
  it.each([
    [
      "unsafe ID",
      (f: Awaited<ReturnType<typeof fixture>>) => {
        f.options.packetId = "Unsafe_ID";
      },
    ],
    [
      "mutated proof",
      (f: Awaited<ReturnType<typeof fixture>>) => {
        const [proof] = f.options.familyProofs;
        if (!proof) {
          throw new Error("fixture missing proof");
        }
        writeFileSync(proof.file, "changed");
      },
    ],
    [
      "missing proof",
      (f: Awaited<ReturnType<typeof fixture>>) => {
        f.options.familyProofs = [];
      },
    ],
    [
      "wrong master",
      (f: Awaited<ReturnType<typeof fixture>>) => {
        writeFileSync(
          f.anchorMetadata,
          JSON.stringify(proofMetadata(24, f.options.familyProofs[0]?.sha256))
        );
        const [proof] = f.options.familyProofs;
        if (!proof) {
          throw new Error("fixture missing proof");
        }
        proof.metadata = bound(f.anchorMetadata);
      },
    ],
    [
      "forged delivered status",
      (f: Awaited<ReturnType<typeof fixture>>) => {
        writeFileSync(
          f.options.finalAuthorReview.file,
          JSON.stringify({ unresolved: [{ id: "d1" }] })
        );
        f.options.finalAuthorReview = bound(f.options.finalAuthorReview.file);
      },
    ],
    [
      "stale inspection",
      (f: Awaited<ReturnType<typeof fixture>>) => {
        writeFileSync(
          f.inspectionFile,
          JSON.stringify({
            evidenceHashes: {
              filled: "b".repeat(64),
              outlined: "b".repeat(64),
            },
            imageInspection: { complete: true },
            status: "complete",
          })
        );
        f.options.inspectionReceipt = bound(f.inspectionFile);
      },
    ],
    [
      "metadata mutation",
      (f: Awaited<ReturnType<typeof fixture>>) => {
        writeFileSync(f.anchorMetadata, "{}");
      },
    ],
  ])("refuses %s", async (_name, mutate) => {
    const data = await fixture();
    mutate(data);
    await expect(prepareAuthorReviewPacket(data.options)).rejects.toThrow();
  });
  it.each([
    [
      "an old candidate presentation",
      (metadata: Record<string, unknown>) => {
        delete metadata.presentationVersion;
        delete metadata.presentationProtocolHash;
      },
    ],
    [
      "a changed presentation protocol hash",
      (metadata: Record<string, unknown>) => {
        metadata.presentationProtocolHash = "b".repeat(64);
      },
    ],
    [
      "a shifted native cell",
      (metadata: Record<string, unknown>) => {
        metadata.nativeCell = {
          ...(metadata.nativeCell as Record<string, unknown>),
          left: 0,
        };
      },
    ],
    [
      "an extended native cell schema",
      (metadata: Record<string, unknown>) => {
        metadata.nativeCell = {
          ...(metadata.nativeCell as Record<string, unknown>),
          scale: 1,
        };
      },
    ],
  ])(
    "refuses %s even when its metadata file is freshly read",
    async (_name, mutate) => {
      const { options } = await fixture();
      const metadataFile = path.join(
        options.authorDirectory,
        "outlined.proof.json"
      );
      const metadata = JSON.parse(readFileSync(metadataFile, "utf-8"));
      mutate(metadata);
      writeFileSync(metadataFile, JSON.stringify(metadata));
      await expect(prepareAuthorReviewPacket(options)).rejects.toThrow(
        "wrong native master metadata"
      );
    }
  );
  it("refuses a hash-bound proof with the wrong sheet dimensions", async () => {
    const data = await fixture();
    const [anchor] = data.options.familyProofs;
    if (!anchor) {
      throw new Error("fixture missing proof");
    }
    const wrong = await sharp({
      create: { background: "white", channels: 4, height: 16, width: 16 },
    })
      .png()
      .toBuffer();
    writeFileSync(anchor.file, wrong);
    anchor.sha256 = sha(anchor.file);
    writeFileSync(
      data.anchorMetadata,
      JSON.stringify(proofMetadata(16, anchor.sha256))
    );
    anchor.metadata = bound(data.anchorMetadata);
    await expect(prepareAuthorReviewPacket(data.options)).rejects.toThrow(
      "wrong native master metadata"
    );
  });
  it("leaves a pre-existing output unchanged", async () => {
    const { options } = await fixture();
    mkdirSync(options.out);
    const sentinel = path.join(options.out, "keep");
    writeFileSync(sentinel, "original");
    await expect(prepareAuthorReviewPacket(options)).rejects.toThrow(
      "already exists"
    );
    expect(readFileSync(sentinel, "utf-8")).toBe("original");
  });
});

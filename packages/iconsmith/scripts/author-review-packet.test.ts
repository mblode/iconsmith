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

import { prepareAuthorReviewPacket } from "./author-review-packet.js";
import type { ReviewPacketFile } from "./author-review-packet.js";

const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const bound = (file: string): ReviewPacketFile => ({ file, sha256: sha(file) });
const fixture = async () => {
  const root = mkdtempSync(path.join(tmpdir(), "author-review-packet-"));
  const authorDirectory = path.join(root, "author");
  mkdirSync(authorDirectory);
  const png = await sharp({
    create: { background: "black", channels: 4, height: 16, width: 16 },
  })
    .png()
    .toBuffer();
  const programHashes: Record<string, string> = {};
  const proofHashes: Record<string, string> = {};
  for (const finish of ["outlined", "filled"]) {
    const program = path.join(authorDirectory, `${finish}.icon`);
    const proof = path.join(authorDirectory, `${finish}.proof.png`);
    writeFileSync(program, `${finish} program`);
    writeFileSync(proof, png);
    writeFileSync(path.join(authorDirectory, `${finish}.native.png`), png);
    programHashes[finish] = sha(program);
    proofHashes[finish] = sha(proof);
    writeFileSync(
      path.join(authorDirectory, `${finish}.proof.json`),
      JSON.stringify({
        deviceScales: [1, 2],
        nativeSize: 16,
        opticalMasterClaim: false,
        proofSha256: proofHashes[finish],
      })
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
  writeFileSync(anchor, png);
  const anchorMetadata = path.join(root, "anchor.json");
  writeFileSync(
    anchorMetadata,
    JSON.stringify({
      deviceScales: [1, 2],
      nativeSize: 16,
      opticalMasterClaim: false,
      proofSha256: sha(anchor),
    })
  );
  return {
    anchorMetadata,
    inspectionFile,
    options: {
      authorDirectory,
      checks: bound(checksFile),
      concept: "bell-pause",
      expectedNativeSize: 16 as const,
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
    },
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
          JSON.stringify({
            deviceScales: [1, 2],
            nativeSize: 24,
            opticalMasterClaim: false,
            proofSha256: f.options.familyProofs[0]?.sha256,
          })
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

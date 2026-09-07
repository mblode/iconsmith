/** Evidence-bound preparation for AI review of completed native author output. */
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import sharp from "sharp";

import type { AiReviewCampaignInput } from "./ai-review-campaign.js";

const HASH = /^[a-f0-9]{64}$/u;
const digest = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const fileHash = (file: string) => digest(readFileSync(file));
export interface ReviewPacketFile {
  file: string;
  sha256: string;
}
export interface AuthorReviewPacketOptions {
  authorDirectory: string;
  checks: ReviewPacketFile;
  concept: string;
  expectedNativeSize: 16 | 24;
  familyProofs: readonly (ReviewPacketFile & { metadata: ReviewPacketFile })[];
  finalAuthorReview: ReviewPacketFile;
  finalReviewMarkdown: ReviewPacketFile;
  inspectionReceipt: ReviewPacketFile;
  meanings: readonly string[];
  out: string;
  packetId: string;
  sourceIdentity: Readonly<Record<string, string>>;
  stimulusId: string;
  terminal: ReviewPacketFile;
}
const verifyFile = (value: ReviewPacketFile, label: string) => {
  if (!HASH.test(value.sha256) || fileHash(value.file) !== value.sha256) {
    throw new Error(`${label} is missing or mutated`);
  }
};
const verifyProofMetadata = (
  metadata: ReviewPacketFile,
  size: 16 | 24,
  proofHash: string,
  requireProofBinding: boolean
) => {
  verifyFile(metadata, "Proof metadata");
  const value = JSON.parse(readFileSync(metadata.file, "utf-8"));
  if (
    value.nativeSize !== size ||
    value.opticalMasterClaim !== false ||
    value.deviceScales?.join(",") !== "1,2" ||
    (requireProofBinding
      ? value.proofSha256 !== proofHash
      : value.proofSha256 !== undefined && value.proofSha256 !== proofHash)
  ) {
    throw new Error("Review proof has the wrong native master metadata");
  }
};
const panel = async (bytes: Uint8Array, name: string) => {
  const meta = await sharp(bytes).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!(width && height)) {
    throw new Error(`Invalid author raster: ${name}`);
  }
  const label = Buffer.from(
    `<svg width="${width}" height="28"><rect width="100%" height="100%" fill="white"/><text x="4" y="19" font-family="sans-serif" font-size="14" fill="#111">${name.replace(".png", "")}</text></svg>`
  );
  return sharp({
    create: { background: "white", channels: 4, height: height + 28, width },
  })
    .composite([
      { input: label, left: 0, top: 0 },
      { input: Buffer.from(bytes), left: 0, top: 28 },
    ])
    .png()
    .toBuffer();
};
const composeBoard = async (
  files: readonly { bytes: Uint8Array; name: string }[]
) => {
  const panels = await Promise.all(
    files.map(({ bytes, name }) => panel(bytes, name))
  );
  const metas = await Promise.all(
    panels.map((bytes) => sharp(bytes).metadata())
  );
  const columns = Math.min(2, panels.length);
  const rows = Math.ceil(panels.length / columns);
  const widths = Array.from({ length: columns }, (_unused, column) =>
    Math.max(
      ...metas
        .filter((_m, i) => i % columns === column)
        .map((m) => m.width ?? 0)
    )
  );
  const heights = Array.from({ length: rows }, (_unused, row) =>
    Math.max(
      ...metas
        .filter((_m, i) => Math.floor(i / columns) === row)
        .map((m) => m.height ?? 0)
    )
  );
  return sharp({
    create: {
      background: "white",
      channels: 4,
      height: heights.reduce((total, value) => total + value, 0),
      width: widths.reduce((total, value) => total + value, 0),
    },
  })
    .composite(
      panels.map((input, i) => ({
        input,
        left: widths
          .slice(0, i % columns)
          .reduce((sum, value) => sum + value, 0),
        top: heights
          .slice(0, Math.floor(i / columns))
          .reduce((sum, value) => sum + value, 0),
      }))
    )
    .png()
    .toBuffer();
};

// Lifecycle validation is intentionally kept in one fail-closed transaction.
// oxlint-disable-next-line eslint/complexity
export const prepareAuthorReviewPacket = async (
  options: AuthorReviewPacketOptions
) => {
  if (existsSync(options.out)) {
    throw new Error("Review output already exists");
  }
  if (
    !/^[a-z0-9-]+$/u.test(options.packetId) ||
    !/^[a-z0-9-]+$/u.test(options.stimulusId)
  ) {
    throw new Error("Review packet IDs must be safe lowercase identifiers");
  }
  if (!options.familyProofs.length || !options.meanings.length) {
    throw new Error("Review packet needs meanings and matched family proofs");
  }
  if (
    !Object.keys(options.sourceIdentity).length ||
    Object.values(options.sourceIdentity).some((value) => !HASH.test(value))
  ) {
    throw new Error("Review packet needs immutable source identities");
  }
  for (const [file, label] of [
    [options.terminal, "Author terminal"],
    [options.checks, "Author checks"],
    [options.inspectionReceipt, "Inspection receipt"],
    [options.finalAuthorReview, "Final author review"],
    [options.finalReviewMarkdown, "Final review prose"],
  ] as const) {
    verifyFile(file, label);
  }
  const terminal = JSON.parse(readFileSync(options.terminal.file, "utf-8"));
  const checks = JSON.parse(readFileSync(options.checks.file, "utf-8"));
  const inspection = JSON.parse(
    readFileSync(options.inspectionReceipt.file, "utf-8")
  );
  const authorReview = JSON.parse(
    readFileSync(options.finalAuthorReview.file, "utf-8")
  );
  const finalStage = [...(terminal.stages ?? [])]
    .toReversed()
    .find((stage) => stage.status === "inspected");
  if (
    terminal.status !== "delivered" ||
    !finalStage ||
    JSON.stringify(finalStage.programHashes) !==
      JSON.stringify(terminal.programHashes) ||
    JSON.stringify(finalStage.proofHashes) !==
      JSON.stringify(terminal.proofHashes) ||
    !finalStage.inspection?.inspectionEvidence?.trim() ||
    finalStage.inspection.defects?.length !== 0 ||
    finalStage.inspection.uncertainties?.length !== 0 ||
    inspection.status !== "complete" ||
    inspection.imageInspection?.complete !== true ||
    authorReview.unresolved?.length !== 0 ||
    !readFileSync(options.finalReviewMarkdown.file, "utf-8").trim()
  ) {
    throw new Error(
      "Delivered status lacks complete, clear author review evidence"
    );
  }
  if (
    checks.exactReplay !== true ||
    checks.nativeSize !== options.expectedNativeSize ||
    checks.pairChecked !== true ||
    JSON.stringify(checks.paints) !== JSON.stringify(["outlined", "filled"])
  ) {
    throw new Error("Author checks do not prove an exact native pair");
  }
  const authorFiles: { bytes: Uint8Array; name: string }[] = [];
  for (const finish of ["outlined", "filled"] as const) {
    const program = path.join(options.authorDirectory, `${finish}.icon`);
    const proof = path.join(options.authorDirectory, `${finish}.proof.png`);
    const proofHash = fileHash(proof);
    if (
      terminal.programHashes?.[finish] !== fileHash(program) ||
      terminal.proofHashes?.[finish] !== proofHash ||
      !Object.values(inspection.evidenceHashes ?? {}).includes(proofHash)
    ) {
      throw new Error(`Author lifecycle does not bind ${finish} evidence`);
    }
    const proofMetadataFile = path.join(
      options.authorDirectory,
      `${finish}.proof.json`
    );
    verifyProofMetadata(
      { file: proofMetadataFile, sha256: fileHash(proofMetadataFile) },
      options.expectedNativeSize,
      proofHash,
      false
    );
    // The proof is already terminal- and inspection-bound and contains the
    // checker-rendered native 1x/2x views. Do not add a separately mutable
    // native raster to the reviewer board.
    authorFiles.push({
      bytes: readFileSync(proof),
      name: `${finish}.proof.png`,
    });
  }
  for (const proof of options.familyProofs) {
    verifyFile(proof, "Family proof");
    verifyProofMetadata(
      proof.metadata,
      options.expectedNativeSize,
      proof.sha256,
      true
    );
  }
  const board = await composeBoard(authorFiles);
  mkdirSync(options.out, { recursive: false });
  const packetDirectory = path.join(options.out, "review-packet");
  mkdirSync(packetDirectory);
  const candidate = path.join(packetDirectory, `${options.stimulusId}.png`);
  writeFileSync(candidate, board, { flag: "wx" });
  const anchors = options.familyProofs.map((proof, index) => {
    const target = path.join(
      packetDirectory,
      `anchor-${String(index + 1).padStart(2, "0")}.png`
    );
    cpSync(proof.file, target, { errorOnExist: true, force: false });
    if (fileHash(target) !== proof.sha256) {
      throw new Error("Copied family proof drifted");
    }
    return target;
  });
  const input: AiReviewCampaignInput = {
    packetId: options.packetId,
    stimuli: [
      {
        concept: options.concept,
        familyReferences: anchors,
        id: options.stimulusId,
        image: candidate,
        meanings: [...options.meanings],
      },
    ],
  };
  const receipt = {
    authority: "delivered-author-development-review-preparation-only",
    candidateSha256: fileHash(candidate),
    checksSha256: options.checks.sha256,
    familyProofs: options.familyProofs.map((proof, index) => ({
      metadataSha256: proof.metadata.sha256,
      path: anchors[index],
      sha256: proof.sha256,
    })),
    finalAuthorReviewSha256: options.finalAuthorReview.sha256,
    finalReviewMarkdownSha256: options.finalReviewMarkdown.sha256,
    inputHash: digest(JSON.stringify(input)),
    inspectionReceiptSha256: options.inspectionReceipt.sha256,
    packetId: options.packetId,
    qualified: false,
    sourceIdentity: { ...options.sourceIdentity },
    terminalSha256: options.terminal.sha256,
  } as const;
  writeFileSync(
    path.join(options.out, "campaign-input.host.json"),
    `${JSON.stringify(input, null, 2)}\n`,
    { flag: "wx" }
  );
  writeFileSync(
    path.join(options.out, "receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: "wx" }
  );
  return { input, receipt };
};

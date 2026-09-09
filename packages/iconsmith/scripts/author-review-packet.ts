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

import {
  OPTICAL_PROOF_PRESENTATION_PROTOCOL_HASH,
  OPTICAL_PROOF_PRESENTATION_VERSION,
} from "../src/tools/proof.js";
import type { AiReviewCampaignInput } from "./ai-review-campaign.js";

const HASH = /^[a-f0-9]{64}$/u;
const digest = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const fileHash = (file: string) => digest(readFileSync(file));
const exactRecord = (
  value: unknown,
  expected: Readonly<Record<string, unknown>>
) => {
  if (!value || typeof value !== "object") {
    return false;
  }
  return (
    JSON.stringify(Object.keys(value).toSorted()) ===
      JSON.stringify(Object.keys(expected).toSorted()) &&
    Object.entries(expected).every(
      ([key, expectedValue]) =>
        (value as Record<string, unknown>)[key] === expectedValue
    )
  );
};
export interface ReviewPacketFile {
  file: string;
  sha256: string;
}
export interface AuthorReviewPacketOptions {
  authorEvidence?:
    | { mode: "clear" }
    | {
        mode: "evidence-only-uncertainty";
        uncertainties: readonly AuthorReviewPacketUncertainty[];
      };
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
export interface AuthorReviewPacketUncertainty {
  description: string;
  finish?: string;
  id?: string;
  kind?: "representation";
  source: "author-final-review" | "structured-inspection";
}
const verifyFile = (value: ReviewPacketFile, label: string) => {
  if (!HASH.test(value.sha256) || fileHash(value.file) !== value.sha256) {
    throw new Error(`${label} is missing or mutated`);
  }
};
const verifyProofMetadata = async (
  metadata: ReviewPacketFile,
  size: 16 | 24,
  proof: ReviewPacketFile,
  requireProofBinding: boolean
) => {
  verifyFile(metadata, "Proof metadata");
  verifyFile(proof, "Review proof");
  const value = JSON.parse(readFileSync(metadata.file, "utf-8"));
  const tile = size * 8;
  const column = tile + 32;
  const row = tile + 88;
  const nativeCell = {
    darkTop: row + 44,
    height: size,
    left: 3 * column + 16,
    lightTop: 44,
    width: size,
  };
  const dimensions = await sharp(proof.file).metadata();
  if (
    value.coordinateSpace !== "24x24 SVG viewport" ||
    value.presentationVersion !== OPTICAL_PROOF_PRESENTATION_VERSION ||
    value.presentationProtocolHash !==
      OPTICAL_PROOF_PRESENTATION_PROTOCOL_HASH ||
    value.nativeSize !== size ||
    value.opticalMasterClaim !== false ||
    !Array.isArray(value.deviceScales) ||
    value.deviceScales.length !== 2 ||
    value.deviceScales[0] !== 1 ||
    value.deviceScales[1] !== 2 ||
    !exactRecord(value.nativeCell, nativeCell) ||
    JSON.stringify(value.surfaces) !==
      JSON.stringify([
        "black-on-white",
        "white-on-black monochrome inversion",
      ]) ||
    dimensions.width !== column * 4 ||
    dimensions.height !== row * 2 ||
    (requireProofBinding
      ? value.proofSha256 !== proof.sha256
      : value.proofSha256 !== undefined && value.proofSha256 !== proof.sha256)
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
  const inspectionDefects = finalStage?.inspection?.defects;
  const inspectionUncertainties = finalStage?.inspection?.uncertainties;
  const authorUnresolved = authorReview.unresolved;
  const evidenceArraysValid =
    Array.isArray(inspectionDefects) &&
    Array.isArray(inspectionUncertainties) &&
    inspectionUncertainties.every(
      (item: unknown) =>
        exactRecord(item, {
          description: (item as { description?: unknown })?.description,
          finish: (item as { finish?: unknown })?.finish,
        }) &&
        typeof (item as { description?: unknown }).description === "string" &&
        Boolean((item as { description: string }).description.trim()) &&
        typeof (item as { finish?: unknown }).finish === "string" &&
        Boolean((item as { finish: string }).finish.trim())
    ) &&
    Array.isArray(authorUnresolved) &&
    authorUnresolved.every(
      (item: unknown) =>
        exactRecord(item, {
          description: (item as { description?: unknown })?.description,
          id: (item as { id?: unknown })?.id,
          kind: (item as { kind?: unknown })?.kind,
        }) &&
        typeof (item as { description?: unknown }).description === "string" &&
        Boolean((item as { description: string }).description.trim()) &&
        typeof (item as { id?: unknown }).id === "string" &&
        Boolean((item as { id: string }).id.trim()) &&
        ["representation", "visual"].includes(
          String((item as { kind?: unknown }).kind)
        )
    );
  const expectedUncertainties: AuthorReviewPacketUncertainty[] = [
    ...(Array.isArray(inspectionUncertainties)
      ? inspectionUncertainties
      : []
    ).map((uncertainty: Omit<AuthorReviewPacketUncertainty, "source">) => ({
      ...uncertainty,
      source: "structured-inspection" as const,
    })),
    ...(Array.isArray(authorUnresolved) ? authorUnresolved : []).map(
      (uncertainty: Omit<AuthorReviewPacketUncertainty, "source">) => ({
        ...uncertainty,
        source: "author-final-review" as const,
      })
    ),
  ];
  const authorEvidence = options.authorEvidence ?? { mode: "clear" as const };
  const clearEvidence =
    evidenceArraysValid &&
    authorEvidence.mode === "clear" &&
    terminal.status === "delivered" &&
    expectedUncertainties.length === 0;
  const evidenceOnlyUncertainty =
    evidenceArraysValid &&
    authorEvidence.mode === "evidence-only-uncertainty" &&
    terminal.status === "delivered-with-uncertainty" &&
    expectedUncertainties.length > 0 &&
    authorUnresolved.every(
      (item: { kind?: string }) => item.kind === "representation"
    ) &&
    JSON.stringify(authorEvidence.uncertainties) ===
      JSON.stringify(expectedUncertainties);
  if (
    !(clearEvidence || evidenceOnlyUncertainty) ||
    !finalStage ||
    JSON.stringify(finalStage.programHashes) !==
      JSON.stringify(terminal.programHashes) ||
    JSON.stringify(finalStage.proofHashes) !==
      JSON.stringify(terminal.proofHashes) ||
    !finalStage.inspection?.inspectionEvidence?.trim() ||
    inspectionDefects.length !== 0 ||
    inspection.status !== "complete" ||
    inspection.imageInspection?.complete !== true ||
    !readFileSync(options.finalReviewMarkdown.file, "utf-8").trim()
  ) {
    throw new Error(
      "Delivered status lacks complete admissible author review evidence"
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
  const authorFiles = await Promise.all(
    (["outlined", "filled"] as const).map(async (finish) => {
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
      await verifyProofMetadata(
        { file: proofMetadataFile, sha256: fileHash(proofMetadataFile) },
        options.expectedNativeSize,
        { file: proof, sha256: proofHash },
        false
      );
      // The proof is already terminal- and inspection-bound and contains the
      // checker-rendered native 1x/2x views. Do not add a separately mutable
      // native raster to the reviewer board.
      return {
        bytes: readFileSync(proof),
        name: `${finish}.proof.png`,
      };
    })
  );
  await Promise.all(
    options.familyProofs.map(async (proof) => {
      verifyFile(proof, "Family proof");
      await verifyProofMetadata(
        proof.metadata,
        options.expectedNativeSize,
        proof,
        true
      );
    })
  );
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
    authorEvidence:
      authorEvidence.mode === "clear"
        ? { mode: "clear" }
        : {
            mode: authorEvidence.mode,
            uncertaintyCount: authorEvidence.uncertainties.length,
            uncertaintySha256: digest(
              JSON.stringify(authorEvidence.uncertainties)
            ),
          },
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

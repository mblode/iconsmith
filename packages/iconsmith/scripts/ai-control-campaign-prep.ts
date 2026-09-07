/** Prepare a sealed control packet for the existing two-stage AI review runner. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import sharp from "sharp";

import { opticalProof } from "../src/tools/proof.js";

const sha = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf-8"));

interface PublicRow {
  canonicalArtifactHash: string;
  evidenceHashes: Record<string, string>;
  id: string;
  nativeSize: number;
  recognitionChoices: string[];
}
interface SecretRow {
  canonicalArtifactHash: string;
  finish: "filled" | "outlined";
  id: string;
  recognitionAnswer: string;
  recognitionChoices: string[];
  sourceSlug: string;
  sourceSvgSha256: string;
}

export const candidateSheet = async (
  root: string,
  evidence: Record<string, string>
) => {
  const order = [
    "enlarged-light.png",
    "1x-light.png",
    "2x-light.png",
    "enlarged-dark.png",
    "1x-dark.png",
    "2x-dark.png",
  ];
  const matched = order.map((suffix) => {
    const entry = Object.entries(evidence).find(([file]) =>
      file.endsWith(`/${suffix}`)
    );
    if (!entry) {
      throw new Error(`Control evidence is missing ${suffix}`);
    }
    const [relative, expected] = entry;
    const bytes = readFileSync(path.join(root, relative));
    if (sha(bytes) !== expected) {
      throw new Error(`Control evidence hash changed: ${relative}`);
    }
    return { bytes, suffix };
  });
  const metadata = await Promise.all(
    matched.map(async ({ bytes }) => ({
      bytes,
      info: await sharp(bytes).metadata(),
    }))
  );
  const cellWidth = Math.max(
    144,
    ...metadata.map(({ info }) => (info.width ?? 0) + 16)
  );
  const contentHeight = Math.max(
    136,
    ...metadata.map(({ info }) => (info.height ?? 0) + 16)
  );
  const rowHeight = contentHeight + 24;
  const labels = ["Enlarged vector", "Native / 1x", "Native / 2x"];
  const frame = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cellWidth * 3}" height="${rowHeight * 2}"><rect width="${cellWidth * 3}" height="${rowHeight}" fill="white"/><rect y="${rowHeight}" width="${cellWidth * 3}" height="${rowHeight}" fill="black"/>${[0, 1].flatMap((row) => labels.map((label, column) => `<text x="${column * cellWidth + 8}" y="${row * rowHeight + 18}" fill="${row ? "white" : "black"}" font-size="12" font-family="Arial,sans-serif">${label}</text>`)).join("")}</svg>`
  );
  return sharp(frame)
    .composite(
      metadata.map(({ bytes, info }, index) => {
        const column = index % 3;
        const row = Math.floor(index / 3);
        const width = info.width ?? 0;
        const height = info.height ?? 0;
        return {
          input: bytes,
          left: column * cellWidth + Math.floor((cellWidth - width) / 2),
          top: row * rowHeight + 24 + Math.floor((contentHeight - height) / 2),
        };
      })
    )
    .png()
    .toBuffer();
};

export const prepareAiControlCampaign = async (options: {
  key: string;
  library: string;
  out: string;
  packet: string;
}) => {
  const packet = readJson(options.packet) as {
    images: PublicRow[];
    packetId: string;
  };
  const key = readJson(options.key) as { stimuli: SecretRow[] };
  if (packet.images.length !== 10 || packet.packetId !== "P01") {
    throw new Error(
      "Calibration preparation requires frozen P01 with ten rows"
    );
  }
  const secrets = new Map(key.stimuli.map((row) => [row.id, row]));
  mkdirSync(options.out, { recursive: false });
  const stimuli = await Promise.all(
    packet.images.map(async (row) => {
      const secret = secrets.get(row.id);
      if (
        !secret ||
        secret.canonicalArtifactHash !== row.canonicalArtifactHash ||
        JSON.stringify(secret.recognitionChoices) !==
          JSON.stringify(row.recognitionChoices)
      ) {
        throw new Error(`Sealed control identity mismatch: ${row.id}`);
      }
      const candidate = await candidateSheet(
        path.dirname(path.dirname(options.packet)),
        row.evidenceHashes
      );
      const suffix = secret.finish === "filled" ? "-filled" : "";
      const sourceFile = path.join(
        options.library,
        `${secret.sourceSlug}${suffix}.svg`
      );
      const source = readFileSync(sourceFile, "utf-8");
      if (sha(source) !== secret.sourceSvgSha256) {
        throw new Error(`Source anchor changed: ${row.id}`);
      }
      const anchorProof = await opticalProof(source, row.nativeSize);
      const anchor = anchorProof.proof;
      const candidateName = `${row.id}.png`;
      const anchorName = `${row.id}-source-anchor.png`;
      writeFileSync(path.join(options.out, candidateName), candidate, {
        flag: "wx",
      });
      writeFileSync(path.join(options.out, anchorName), anchor, { flag: "wx" });
      return {
        concept: secret.recognitionAnswer,
        familyReferences: [anchorName],
        id: row.id.toLowerCase(),
        image: candidateName,
        meanings: row.recognitionChoices,
      };
    })
  );
  const runnable = { packetId: "a132-objective-control-development", stimuli };
  const packetFile = path.join(options.out, "packet.json");
  writeFileSync(packetFile, json(runnable), { flag: "wx" });
  const receipt = {
    authority: "objective-control development diagnostic only",
    hostTruthIncluded: false,
    instrumentQualified: false,
    packet: path.basename(options.packet),
    packetSha256: sha(readFileSync(options.packet)),
    qualified: false,
    reviewerRoutesRequired: [
      "openai-codex/gpt-6-astra",
      "anthropic-claude/claude-opus-5",
    ],
    rows: stimuli.length,
    runnablePacketSha256: sha(json(runnable)),
    scopeLimitation:
      "Exact source anchors make this a reconstruction-defect diagnostic; it cannot establish novel generated craft quality.",
    seal: "Recognition sees ID-only candidate sheets and alternatives; concepts and source anchors are revealed only after recognition is sealed. Control kind, corruption objective and host truth are absent from the runnable packet.",
    stimulusBindings: packet.images.map(({ canonicalArtifactHash, id }) => ({
      canonicalArtifactHash,
      reviewerId: id.toLowerCase(),
    })),
  };
  writeFileSync(path.join(options.out, "receipt.json"), json(receipt), {
    flag: "wx",
  });
  return receipt;
};

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      key: { type: "string" },
      library: { type: "string" },
      out: { type: "string" },
      packet: { type: "string" },
    },
  });
  if (!values.key || !values.library || !values.out || !values.packet) {
    throw new Error(
      "Usage: ai-control-campaign-prep --packet FILE --key FILE --library DIR --out DIR"
    );
  }
  console.log(
    await prepareAiControlCampaign({
      key: path.resolve(values.key),
      library: path.resolve(values.library),
      out: path.resolve(values.out),
      packet: path.resolve(values.packet),
    })
  );
}

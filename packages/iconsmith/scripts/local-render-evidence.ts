import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  createStyleRevision,
  replayStyle,
  selectStyle,
} from "../src/pipeline/style.js";
import type { StyleArtifact, StyleRevision } from "../src/pipeline/style.js";
import { opticalProof } from "../src/tools/proof.js";
import {
  applyFamilyReferencePacket,
  parseFamilyReferencePacket,
} from "./family-reference-packet.js";

const HASH = /^[a-f0-9]{64}$/u;
const PAINTS = ["outlined", "filled"] as const;
const artifactSchema = z
  .object({
    compiler: z.string().min(1),
    finish: z.enum(PAINTS),
    master: z.string().min(1),
    program: z.string().min(1),
    sourceExactRegistryHash: z.string().min(1).optional(),
    style: z.string().min(1),
    svg: z.string().min(1),
    svgHash: z.string().min(1),
  })
  .strict();

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const regularFile = (file: string, label: string) => {
  const resolved = path.resolve(file);
  const info = lstatSync(resolved);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    realpathSync(resolved) !== resolved
  ) {
    throw new Error(`${label} must be a regular non-linked file`);
  }
  return resolved;
};

const regularDirectory = (directory: string) => {
  const resolved = path.resolve(directory);
  const info = lstatSync(resolved);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    realpathSync(resolved) !== resolved
  ) {
    throw new Error(
      "Selected directory must be a regular non-linked directory"
    );
  }
  return resolved;
};

const requiredFiles = (
  revisionFile: string,
  selectedDirectory: string,
  familyPacketFile?: string
) => [
  revisionFile,
  ...(familyPacketFile ? [familyPacketFile] : []),
  ...PAINTS.flatMap((paint) =>
    ["artifact.json", "icon", "proof.png", "svg"].map((extension) =>
      path.join(selectedDirectory, `${paint}.${extension}`)
    )
  ),
];

const captureFiles = (files: readonly string[]) =>
  new Map(
    files.map((file) => {
      const verified = regularFile(
        file,
        `Render evidence ${path.basename(file)}`
      );
      const bytes = readFileSync(verified);
      return [verified, { bytes, sha256: digest(bytes) }] as const;
    })
  );

const applyFrozenFamilyPacket = async (options: {
  before: ReturnType<typeof captureFiles>;
  expectedConcept?: string;
  familyPacket?: {
    packetHash: string;
    sha256: string;
  };
  familyPacketFile?: string;
  master: string;
  sourceRevision: StyleRevision;
}) => {
  if (!(options.familyPacket && options.familyPacketFile)) {
    return options.sourceRevision;
  }
  const packetBytes = options.before.get(options.familyPacketFile)?.bytes;
  if (!packetBytes || digest(packetBytes) !== options.familyPacket.sha256) {
    throw new Error("Family reference packet differs from the frozen request");
  }
  const packet = parseFamilyReferencePacket(
    JSON.parse(packetBytes.toString("utf-8"))
  );
  if (
    packet.packetHash !== options.familyPacket.packetHash ||
    packet.concept !== options.expectedConcept
  ) {
    throw new Error("Family reference packet request identity mismatch");
  }
  const applied = await applyFamilyReferencePacket(
    options.sourceRevision,
    options.master,
    packet
  );
  return applied.revision;
};

export const verifyLocalRenderEvidence = async (options: {
  expectedConcept?: string;
  revisionFile: string;
  expectedRevisionHash: string;
  familyPacket?: {
    file: string;
    packetHash: string;
    sha256: string;
  };
  master: string;
  selectedDirectory: string;
}): Promise<void> => {
  if (
    !HASH.test(options.expectedRevisionHash) ||
    !options.master ||
    Boolean(options.familyPacket) !== Boolean(options.expectedConcept)
  ) {
    throw new Error("Render evidence identity is invalid");
  }
  const revisionFile = regularFile(options.revisionFile, "Style revision");
  const familyPacketFile = options.familyPacket
    ? regularFile(options.familyPacket.file, "Family reference packet")
    : undefined;
  if (
    options.familyPacket &&
    (!HASH.test(options.familyPacket.sha256) ||
      !HASH.test(options.familyPacket.packetHash))
  ) {
    throw new Error("Family reference packet identity is invalid");
  }
  const selectedDirectory = regularDirectory(options.selectedDirectory);
  const files = requiredFiles(
    revisionFile,
    selectedDirectory,
    familyPacketFile
  );
  const before = captureFiles(files);
  const revisionBytes = before.get(revisionFile)?.bytes;
  if (
    !revisionBytes ||
    digest(revisionBytes) !== options.expectedRevisionHash
  ) {
    throw new Error("Style revision differs from the frozen campaign revision");
  }

  const sourceRevision = createStyleRevision(
    JSON.parse(revisionBytes.toString("utf-8"))
  );
  const effectiveRevision = await applyFrozenFamilyPacket({
    before,
    expectedConcept: options.expectedConcept,
    familyPacket: options.familyPacket,
    familyPacketFile,
    master: options.master,
    sourceRevision,
  });
  const sourceSelection = selectStyle(effectiveRevision, options.master);
  const restrictedRevision = createStyleRevision({
    ...effectiveRevision.definition,
    masters: { [options.master]: sourceSelection.spec },
    parts: effectiveRevision.definition.parts.filter(
      (entry) => entry.master === options.master
    ),
    references: effectiveRevision.definition.references.filter(
      (entry) => entry.master === options.master
    ),
  });
  const selection = selectStyle(restrictedRevision, options.master);

  const expectedProofs = await Promise.all(
    PAINTS.map(async (paint) => {
      const artifactFile = path.join(
        selectedDirectory,
        `${paint}.artifact.json`
      );
      const programFile = path.join(selectedDirectory, `${paint}.icon`);
      const svgFile = path.join(selectedDirectory, `${paint}.svg`);
      const artifact = artifactSchema.parse(
        JSON.parse(before.get(artifactFile)?.bytes.toString("utf-8") ?? "")
      );
      if (artifact.sourceExactRegistryHash !== undefined) {
        throw new Error(
          "Source-exact render replay requires its frozen registry"
        );
      }
      const program = before.get(programFile)?.bytes.toString("utf-8");
      const svg = before.get(svgFile)?.bytes.toString("utf-8");
      if (
        artifact.finish !== paint ||
        artifact.master !== options.master ||
        artifact.program !== program ||
        artifact.svg !== svg
      ) {
        throw new Error(`${paint} render artifact differs from selected files`);
      }
      const replayed = replayStyle(selection, artifact as StyleArtifact);
      if (replayed !== svg) {
        throw new Error(`${paint} render has the wrong native master`);
      }
      const evidence = await opticalProof(replayed, selection.spec.size);
      return {
        paint,
        proof: evidence.proof,
      };
    })
  );

  const after = captureFiles(files);
  if (
    files.some((file) => before.get(file)?.sha256 !== after.get(file)?.sha256)
  ) {
    throw new Error("Render evidence changed during verification");
  }
  for (const { paint, proof } of expectedProofs) {
    const retained = before.get(
      path.join(selectedDirectory, `${paint}.proof.png`)
    )?.bytes;
    if (!retained || !Buffer.from(proof).equals(retained)) {
      throw new Error(
        `${paint} proof is not the optical proof of its replayed SVG`
      );
    }
  }
};

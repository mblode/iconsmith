import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import {
  STYLE_COMPILER,
  compileStyle,
  createStyleRevision,
  selectStyle,
  styleHash,
} from "../src/pipeline/style.js";
import { specAt } from "../src/tools/canvas.js";
import { opticalProof } from "../src/tools/proof.js";
import {
  applyFamilyReferencePacket,
  createFamilyReferencePacket,
} from "./family-reference-packet.js";
import { verifyLocalRenderEvidence } from "./local-render-evidence.js";

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const fixture = async (withFamilyPacket = false) => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "iconsmith-render-evidence-"))
  );
  const selectedDirectory = path.join(root, "selected");
  mkdirSync(selectedDirectory);
  const definition = {
    calibration: "unvalidated",
    compiler: STYLE_COMPILER,
    id: "render-evidence-test",
    masters: {
      "16": specAt({ radius: 1, size: 16, stroke: 1.5 }),
      "24": specAt(),
    },
    parts: [],
    policy: DEFAULT_POLICY,
    references: [],
    rubric: "Verify exact local render evidence.",
  };
  const revisionFile = path.join(root, "revision.json");
  writeFileSync(revisionFile, JSON.stringify(definition));
  const sourceRevision = createStyleRevision(definition);
  const packet = withFamilyPacket
    ? createFamilyReferencePacket({
        concept: "render-evidence",
        excludedFamilies: [],
        excludedSourceHashes: [],
        librarySet: "blode-icons",
        librarySourceHash: "a".repeat(64),
        sources: [
          {
            admissionRequested: false,
            intent: {
              evidence: "Canonical fixture source.",
              polarity: "body",
              treatment: "Use the source as a reference.",
            },
            source: {
              finish: "outlined",
              name: "fixture-source",
              provenance: {
                date: "2026-09-09",
                origin: "literal",
                set: "blode-icons",
              },
              svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/></svg>',
            },
          },
        ],
      })
    : undefined;
  const packetFile = packet ? path.join(root, "family-packet.json") : undefined;
  if (packet && packetFile) {
    writeFileSync(packetFile, JSON.stringify(packet));
  }
  const applied = packet
    ? await applyFamilyReferencePacket(sourceRevision, "16", packet)
    : undefined;
  const effectiveRevision = applied?.revision ?? sourceRevision;
  const sourceSelection = selectStyle(effectiveRevision, "16");
  const restricted = createStyleRevision({
    ...effectiveRevision.definition,
    masters: { "16": sourceSelection.spec },
    parts: effectiveRevision.definition.parts.filter(
      ({ master }) => master === "16"
    ),
    references: effectiveRevision.definition.references.filter(
      ({ master }) => master === "16"
    ),
  });
  const selection = selectStyle(restricted, "16");
  await Promise.all(
    (["outlined", "filled"] as const).map(async (paint) => {
      const program = `icon render-evidence\nfinish ${paint}\nrect 4,4 16x16 r1`;
      const artifact = compileStyle(selection, program);
      const proof = await opticalProof(artifact.svg, 16);
      writeFileSync(path.join(selectedDirectory, `${paint}.icon`), program);
      writeFileSync(
        path.join(selectedDirectory, `${paint}.artifact.json`),
        JSON.stringify(artifact)
      );
      writeFileSync(path.join(selectedDirectory, `${paint}.svg`), artifact.svg);
      writeFileSync(
        path.join(selectedDirectory, `${paint}.proof.png`),
        proof.proof
      );
    })
  );
  return {
    ...(packet && packetFile
      ? {
          expectedConcept: packet.concept,
          familyPacket: {
            file: packetFile,
            packetHash: packet.packetHash,
            sha256: sha(readFileSync(packetFile)),
          },
        }
      : {}),
    expectedRevisionHash: sha(readFileSync(revisionFile)),
    master: "16",
    revisionFile,
    selectedDirectory,
  };
};

describe("local render evidence", () => {
  it("replays genuine programs and their optical proofs", async () => {
    const options = await fixture();
    await expect(verifyLocalRenderEvidence(options)).resolves.toBeUndefined();
  });

  it("replays genuine programs against a frozen family packet", async () => {
    const options = await fixture(true);
    await expect(verifyLocalRenderEvidence(options)).resolves.toBeUndefined();
  });

  it("refuses a family packet bound to a different concept", async () => {
    const options = await fixture(true);
    await expect(
      verifyLocalRenderEvidence({
        ...options,
        expectedConcept: "different-concept",
      })
    ).rejects.toThrow("Family reference packet request identity mismatch");
  });

  it("refuses a family packet bound to a different packet hash", async () => {
    const options = await fixture(true);
    if (!options.familyPacket) {
      throw new Error("Packet fixture is missing its frozen identity");
    }
    await expect(
      verifyLocalRenderEvidence({
        ...options,
        familyPacket: {
          ...options.familyPacket,
          packetHash: "b".repeat(64),
        },
      })
    ).rejects.toThrow("Family reference packet request identity mismatch");
  });

  it("refuses changed packet bytes under the original file hash", async () => {
    const options = await fixture(true);
    if (!options.familyPacket) {
      throw new Error("Packet fixture is missing its frozen identity");
    }
    writeFileSync(
      options.familyPacket.file,
      `${readFileSync(options.familyPacket.file, "utf-8")}\n`
    );
    await expect(verifyLocalRenderEvidence(options)).rejects.toThrow(
      "Family reference packet differs from the frozen request"
    );
  });

  it("refuses a rewritten SVG even when its declarative hashes agree", async () => {
    const options = await fixture();
    const svgFile = path.join(options.selectedDirectory, "outlined.svg");
    const artifactFile = path.join(
      options.selectedDirectory,
      "outlined.artifact.json"
    );
    const rewritten = `${readFileSync(svgFile, "utf-8")}<!-- rewritten -->`;
    const artifact = JSON.parse(readFileSync(artifactFile, "utf-8"));
    artifact.svg = rewritten;
    artifact.svgHash = styleHash(rewritten);
    writeFileSync(svgFile, rewritten);
    writeFileSync(artifactFile, JSON.stringify(artifact));
    await expect(verifyLocalRenderEvidence(options)).rejects.toThrow(
      "Stored style artifact differs from exact replay"
    );
  });

  it("refuses a proof generated from a different selected SVG", async () => {
    const options = await fixture();
    const other = await opticalProof(
      readFileSync(path.join(options.selectedDirectory, "filled.svg"), "utf-8"),
      16
    );
    writeFileSync(
      path.join(options.selectedDirectory, "outlined.proof.png"),
      other.proof
    );
    await expect(verifyLocalRenderEvidence(options)).rejects.toThrow(
      "outlined proof is not the optical proof"
    );
  });
});

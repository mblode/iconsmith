/** Bounded existing-DSL optical experiment for distinct filled folder-lock masters. */
/* eslint-disable no-await-in-loop, prefer-destructuring, unicorn/consistent-function-scoping -- deterministic evidence generation keeps master order explicit */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import {
  compileStyle,
  createStyleRevision,
  replayStyle,
  selectStyle,
  STYLE_COMPILER,
} from "../src/pipeline/style.js";
import { SPEC } from "../src/tools/canvas.js";
import type { FamilySource } from "./family-parts.js";
import {
  familySourceParts,
  inspectNativeSourceFidelity,
} from "./family-parts.js";
import {
  applyFamilyReferencePacket,
  createFamilyReferencePacket,
} from "./family-reference-packet.js";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

const THRESHOLDS = [64, 128, 192] as const;
const MODIFIER_ZONE = { x0: 13.5, y0: 9.5 } as const;

interface Candidate {
  id: string;
  master: 16 | 24;
  program: string;
}

const FOLDER_LOCK_OPTICAL_CANDIDATES: readonly Candidate[] = [
  {
    id: "16-a-projecting",
    master: 16,
    program: `icon folder-lock-optical-16-a
finish filled
part folder-1-filled-0 at 2,3 scale 1
part lock-filled-0 at 14,10.5 scale 0.54
union
hole rect 16.7,11.58 3.24x2.7 r0.55
hole rect 17.78,16.44 1.08x2.7 r0.45`,
  },
  {
    id: "16-b-farther-projecting",
    master: 16,
    program: `icon folder-lock-optical-16-b
finish filled
part folder-1-filled-0 at 2,3 scale 1
part lock-filled-0 at 14.8,10.2 scale 0.56
union
hole rect 17.6,11.32 3.36x2.8 r0.6
hole rect 18.72,16.36 1.12x2.8 r0.45`,
  },
  {
    id: "24-a-projecting",
    master: 24,
    program: `icon folder-lock-optical-24-a
finish filled
part folder-1-filled-0 at 2,3 scale 1
part lock-filled-0 at 14.4,11 scale 0.48
union
hole rect 16.8,11.96 2.88x2.4 r0.5
hole rect 17.76,16.28 0.96x2.4 r0.4`,
  },
  {
    id: "24-b-farther-projecting",
    master: 24,
    program: `icon folder-lock-optical-24-b
finish filled
part folder-1-filled-0 at 2,3 scale 1
part lock-filled-0 at 14.8,10.75 scale 0.5
union
hole rect 17.3,11.75 3x2.5 r0.5
hole rect 18.3,16.25 1x2.5 r0.4`,
  },
] as const;

const nativePng = (svg: string, size: 16 | 24, surface: "dark" | "light") => {
  const dark = surface === "dark";
  return sharp(
    Buffer.from(svg.replaceAll("currentColor", dark ? "#fff" : "#111")),
    { density: (72 * size) / 24 }
  )
    .resize(size, size, { fit: "contain" })
    .flatten({ background: dark ? "#111" : "#fff" })
    .png()
    .toBuffer();
};

const lightPixels = async (svg: string, size: 16 | 24) => {
  const png = await nativePng(svg, size, "light");
  const { data, info } = await sharp(png)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width };
};

const compareGeometry = async (
  candidateSvg: string,
  folderSvg: string,
  size: 16 | 24
) => {
  const [candidate, folder] = await Promise.all([
    lightPixels(candidateSvg, size),
    lightPixels(folderSvg, size),
  ]);
  const thresholds = THRESHOLDS.map((threshold) => {
    let hostDifferenceOutsideModifierZone = 0;
    let projectingInk = 0;
    for (let index = 0; index < candidate.data.length; index += 1) {
      const x = index % candidate.width;
      const y = Math.floor(index / candidate.width);
      const unitX = ((x + 0.5) * 24) / size;
      const unitY = ((y + 0.5) * 24) / size;
      const candidateInk = 255 - candidate.data[index] >= threshold;
      const folderInk = 255 - folder.data[index] >= threshold;
      if (
        (unitX < MODIFIER_ZONE.x0 || unitY < MODIFIER_ZONE.y0) &&
        candidateInk !== folderInk
      ) {
        hostDifferenceOutsideModifierZone += 1;
      }
      if (candidateInk && !folderInk && (unitX > 22 || unitY > 20)) {
        projectingInk += 1;
      }
    }
    return { hostDifferenceOutsideModifierZone, projectingInk, threshold };
  });
  return {
    modifierZone: { ...MODIFIER_ZONE, x1: 24, y1: 24 },
    thresholds,
  };
};

const labeledBoard = async (
  out: string,
  rows: readonly {
    files: readonly string[];
    label: string;
    master: 16 | 24;
  }[]
) => {
  const labelWidth = 340;
  const cellWidth = 132;
  const headerHeight = 72;
  const rowHeight = 126;
  const width = labelWidth + cellWidth * 2;
  const height = headerHeight + rowHeight * rows.length;
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const background = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f4f2ed"/><text x="16" y="28" font-family="sans-serif" font-size="17" font-weight="700" fill="#111">Folder-lock optical experiment · native ×4</text><text x="${labelWidth + cellWidth / 2}" y="55" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#333">LIGHT</text><text x="${labelWidth + cellWidth * 1.5}" y="55" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#333">DARK</text>${rows
    .map((row, index) => {
      const y = headerHeight + index * rowHeight;
      return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#d2cec5"/><text x="16" y="${y + 42}" font-family="sans-serif" font-size="16" font-weight="700" fill="#111">${escape(row.label)}</text><text x="16" y="${y + 63}" font-family="sans-serif" font-size="12" fill="#555">native ${row.master}px · nearest-neighbour enlargement ×4</text>`;
    })
    .join("")}</svg>`;
  const composites: { input: Buffer; left: number; top: number }[] = [
    { input: Buffer.from(background), left: 0, top: 0 },
  ];
  for (const [rowIndex, row] of rows.entries()) {
    for (const [columnIndex, file] of row.files.entries()) {
      const side = row.master * 4;
      const image = await sharp(readFileSync(path.join(out, file)))
        .resize(side, side, { kernel: sharp.kernel.nearest })
        .png()
        .toBuffer();
      composites.push({
        input: image,
        left: labelWidth + columnIndex * cellWidth + (cellWidth - side) / 2,
        top: headerHeight + rowIndex * rowHeight + (rowHeight - side) / 2,
      });
    }
  }
  return sharp({
    create: { background: "#f4f2ed", channels: 3, height, width },
  })
    .composite(composites)
    .png()
    .toBuffer();
};

const buildFolderLockOpticalExperiment = async (options: {
  library: string;
  out: string;
}) => {
  mkdirSync(options.out, { recursive: false });
  const packageVersion = JSON.parse(
    readFileSync(path.join(options.library, "package.json"), "utf-8")
  ).version as string;
  const source = (file: string, name: string): FamilySource => ({
    finish: "filled",
    name,
    provenance: {
      date: "2026-09-08",
      icon: file,
      licenses: ["MIT"],
      origin: "literal",
      set: "blode-icons",
      version: packageVersion,
    },
    svg: readFileSync(path.join(options.library, "icons-svg", file), "utf-8"),
  });
  const sources = [
    source("folder-1-filled.svg", "folder-1"),
    source("lock-filled.svg", "lock"),
  ];
  const referenceFile = "folder-shield-filled.svg";
  const referenceSvg = readFileSync(
    path.join(options.library, "icons-svg", referenceFile),
    "utf-8"
  );
  writeFileSync(
    path.join(options.out, `reference-${referenceFile}`),
    referenceSvg
  );
  const reference = source(referenceFile, "folder-shield");
  const referenceParts = familySourceParts(reference);
  const sourceRows = [
    ...sources.map(({ provenance, svg }) => ({
      file: provenance.icon,
      sha256: hash(svg),
    })),
    { file: referenceFile, sha256: hash(referenceSvg) },
  ];
  const librarySourceHash = hash(JSON.stringify(sourceRows));
  const packet = createFamilyReferencePacket({
    concept: "folder-lock-optical-experiment",
    excludedFamilies: [],
    excludedSourceHashes: [],
    librarySet: "blode-icons",
    librarySourceHash,
    sources: sources.map((item) => ({
      admissionRequested: true,
      intent: {
        evidence: `Exact ${item.provenance.icon} bytes supply editable experiment geometry.`,
        polarity: item.name === "folder-1" ? "body" : "modifier",
        treatment: "bounded source-part composition",
      },
      source: item,
    })),
  });
  const packetBytes = `${JSON.stringify(packet, null, 2)}\n`;
  writeFileSync(path.join(options.out, "family-packet.json"), packetBytes);
  const base = () =>
    createStyleRevision({
      calibration: "unvalidated",
      compiler: STYLE_COMPILER,
      id: "wave-c-folder-lock-optical-experiment",
      masters: { "16": { ...SPEC, size: 16 }, "24": { ...SPEC, size: 24 } },
      parts: [],
      policy: DEFAULT_POLICY,
      references: [],
      rubric: "Development-only optical experiment; no visual qualification.",
    });
  const boardRows = [];
  const outputs = [];
  for (const candidate of FOLDER_LOCK_OPTICAL_CANDIDATES) {
    const master = String(candidate.master) as "16" | "24";
    const applied = await applyFamilyReferencePacket(base(), master, packet);
    if (applied.admissions.some(({ admission }) => admission !== "admitted")) {
      throw new Error(`${candidate.id}: source admission refused`);
    }
    const selection = selectStyle(applied.revision, master);
    const artifact = compileStyle(selection, candidate.program);
    const replay = replayStyle(selection, artifact);
    const folderProgram = `icon folder-only-${master}\nfinish filled\npart folder-1-filled-0 at 2,3 scale 1`;
    const folderArtifact = compileStyle(selection, folderProgram);
    const iconBytes = `${candidate.program}\n`;
    const iconFile = `${candidate.id}.icon`;
    const svgFile = `${candidate.id}.svg`;
    writeFileSync(path.join(options.out, iconFile), iconBytes);
    writeFileSync(path.join(options.out, svgFile), artifact.svg);
    const native = [];
    const files = [];
    for (const surface of ["light", "dark"] as const) {
      const bytes = await nativePng(artifact.svg, candidate.master, surface);
      const file = `${candidate.id}.${surface}.png`;
      writeFileSync(path.join(options.out, file), bytes);
      native.push({ file, sha256: hash(bytes), surface });
      files.push(file);
    }
    const topology = await inspectNativeSourceFidelity(
      artifact.svg,
      artifact.svg,
      candidate.master
    );
    outputs.push({
      applicationHash: applied.applicationHash,
      compiler: artifact.compiler,
      exactReplay: replay === artifact.svg,
      geometry: await compareGeometry(
        artifact.svg,
        folderArtifact.svg,
        candidate.master
      ),
      iconFile,
      iconSha256: hash(iconBytes),
      id: candidate.id,
      master: candidate.master,
      native,
      packetHash: packet.packetHash,
      retained: true,
      styleHash: artifact.style,
      svgFile,
      svgSha256: hash(artifact.svg),
      topologyByThreshold: topology.actualTopology,
    });
    boardRows.push({ files, label: candidate.id, master: candidate.master });
  }
  const board = await labeledBoard(options.out, boardRows);
  writeFileSync(path.join(options.out, "native-4x-board.png"), board);
  const distinct = {
    icon:
      new Set(outputs.map(({ iconSha256 }) => iconSha256)).size ===
      outputs.length,
    svg:
      new Set(outputs.map(({ svgSha256 }) => svgSha256)).size ===
      outputs.length,
  };
  if (!(distinct.icon && distinct.svg)) {
    throw new Error(
      "The 16px and 24px optical masters must have distinct programs and SVGs"
    );
  }
  const body = {
    board: { file: "native-4x-board.png", sha256: hash(board) },
    candidateLimit: {
      actualPerMaster: Object.fromEntries(
        [16, 24].map((master) => [
          master,
          FOLDER_LOCK_OPTICAL_CANDIDATES.filter(
            (candidate) => candidate.master === master
          ).length,
        ])
      ),
      maximum: 2,
    },
    compiler: STYLE_COMPILER,
    distinctMasterIdentity: distinct,
    observations: {
      localBoardInspection:
        "Candidate A and farther-projecting candidate B both retain the folder silhouette outside the modifier zone. B exposes more modifier ink, but both still read locally as a stacked-counter badge rather than an independently clear padlock; this is a retained recognition failure, not a visual pass.",
      topology:
        "Hole counts are raw 64/128/192 antialias-threshold observations; they are not a forced two-hole gate.",
    },
    outputs,
    packet: {
      file: "family-packet.json",
      packetHash: packet.packetHash,
      sha256: hash(packetBytes),
    },
    qualification:
      "development-only existing-DSL composition; exact replay, source admission, projection pixels and topology diagnostics do not visually qualify either master",
    referenceGuidance: {
      copiedFile: `reference-${referenceFile}`,
      file: referenceFile,
      note: "The first painted shape is the lower-right shield modifier. Its exact house bounds guide placement; the second shape is a purpose-redrawn folder host, so this experiment only asserts preservation outside the declared modifier zone.",
      paintedShapeBounds: referenceParts.map(({ part, x, y }) => ({
        height: part.h,
        width: part.w,
        x,
        y,
      })),
      sha256: hash(referenceSvg),
    },
    sourceIdentities: sourceRows,
    version: 1,
  };
  const receipt = { ...body, receiptSha256: hash(JSON.stringify(body)) };
  writeFileSync(
    path.join(options.out, "receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  return receipt;
};

if (process.argv[1]?.endsWith("family-folder-lock-optical-experiment.ts")) {
  const out = process.argv[2];
  if (!out) {
    throw new Error(
      "Usage: family-folder-lock-optical-experiment.ts <new-output-directory> [blode-icons-package]"
    );
  }
  const library =
    process.argv[3] ??
    path.join(
      process.env.HOME ?? "",
      "Code/mblode/blode-icons/packages/blode-icons-react"
    );
  await buildFolderLockOpticalExperiment({ library, out });
}

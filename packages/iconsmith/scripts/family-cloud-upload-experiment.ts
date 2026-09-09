/** Bounded existing-DSL host-clearance experiment for filled cloud-upload. */
/* eslint-disable no-await-in-loop, prefer-destructuring, unicorn/consistent-function-scoping -- deterministic evidence generation keeps master order explicit */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const MODIFIER_ZONE = { x0: 6.5, x1: 17.5, y0: 8.5, y1: 24 } as const;

interface Candidate {
  id: string;
  master: 16 | 24;
  program: string;
}

const CLOUD_UPLOAD_CANDIDATES: readonly Candidate[] = [
  {
    id: "16-a-host-clearance",
    master: 16,
    program: `icon cloud-upload-clearance-16
finish filled
part cloud-filled-0 at 1,4 scale 1
line 12,8.75 17.25,14 17.25,22 6.75,22 6.75,14 12,8.75 r1 solid
subtract r1
part arrow-up-filled-0 at 8,11 scale 0.6`,
  },
  {
    id: "24-a-host-clearance",
    master: 24,
    program: `icon cloud-upload-clearance-24
finish filled
part cloud-filled-0 at 1,4 scale 1
line 12,9.75 17,14.75 17,22 7,22 7,14.75 12,9.75 r1 solid
subtract r1
part arrow-up-filled-0 at 8.5,12 scale 0.5`,
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
  hostSvg: string,
  clearedHostSvg: string,
  size: 16 | 24
) => {
  const [candidate, host, clearedHost] = await Promise.all([
    lightPixels(candidateSvg, size),
    lightPixels(hostSvg, size),
    lightPixels(clearedHostSvg, size),
  ]);
  return {
    modifierZone: MODIFIER_ZONE,
    thresholds: THRESHOLDS.map((threshold) => {
      let clearedHostInk = 0;
      let hostDifferenceOutsideModifierZone = 0;
      let modifierInkPixels = 0;
      for (let index = 0; index < candidate.data.length; index += 1) {
        const x = index % candidate.width;
        const y = Math.floor(index / candidate.width);
        const unitX = ((x + 0.5) * 24) / size;
        const unitY = ((y + 0.5) * 24) / size;
        const inZone =
          unitX >= MODIFIER_ZONE.x0 &&
          unitX <= MODIFIER_ZONE.x1 &&
          unitY >= MODIFIER_ZONE.y0 &&
          unitY <= MODIFIER_ZONE.y1;
        const candidateInk = 255 - candidate.data[index] >= threshold;
        const hostInk = 255 - host.data[index] >= threshold;
        const clearedHostInkAtPixel =
          255 - clearedHost.data[index] >= threshold;
        if (!inZone && candidateInk !== hostInk) {
          hostDifferenceOutsideModifierZone += 1;
        }
        if (inZone && hostInk && !clearedHostInkAtPixel) {
          clearedHostInk += 1;
        }
        if (inZone && candidateInk && !clearedHostInkAtPixel) {
          modifierInkPixels += 1;
        }
      }
      return {
        clearedHostInk,
        hostDifferenceOutsideModifierZone,
        modifierInkPixels,
        threshold,
      };
    }),
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
  const labelWidth = 480;
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
  const background = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f4f2ed"/><text x="16" y="28" font-family="sans-serif" font-size="17" font-weight="700" fill="#111">Cloud-upload host clearance · native ×4</text><text x="${labelWidth + cellWidth / 2}" y="55" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#333">LIGHT</text><text x="${labelWidth + cellWidth * 1.5}" y="55" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#333">DARK</text>${rows
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

const buildCloudUploadExperiment = async (options: {
  baseline: string;
  library: string;
  out: string;
}) => {
  mkdirSync(options.out, { recursive: false });
  const baselineOut = path.join(options.out, "baseline");
  mkdirSync(baselineOut);
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
  const baselineSource = source("cloud-upload-filled.svg", "cloud-upload");
  const sources = [
    source("cloud-filled.svg", "cloud"),
    source("arrow-up-filled.svg", "arrow-up"),
  ];
  const referenceFile = "cloud-simple-upload-filled.svg";
  const referenceSvg = readFileSync(
    path.join(options.library, "icons-svg", referenceFile),
    "utf-8"
  );
  writeFileSync(
    path.join(options.out, `reference-${referenceFile}`),
    referenceSvg
  );
  const referenceParts = familySourceParts(
    source(referenceFile, "cloud-simple-upload")
  );
  const sourceRows = [
    ...sources.map(({ provenance, svg }) => ({
      file: provenance.icon,
      sha256: hash(svg),
    })),
    { file: referenceFile, sha256: hash(referenceSvg) },
  ];
  const packet = createFamilyReferencePacket({
    concept: "cloud-upload-host-clearance-experiment",
    excludedFamilies: [],
    excludedSourceHashes: [],
    librarySet: "blode-icons",
    librarySourceHash: hash(JSON.stringify(sourceRows)),
    sources: sources.map((item) => ({
      admissionRequested: true,
      intent: {
        evidence: `Exact ${item.provenance.icon} bytes supply editable experiment geometry.`,
        polarity: item.name === "cloud" ? "body" : "modifier",
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
      id: "wave-e-cloud-upload-host-clearance-experiment",
      masters: { "16": { ...SPEC, size: 16 }, "24": { ...SPEC, size: 24 } },
      parts: [],
      policy: DEFAULT_POLICY,
      references: [],
      rubric:
        "Development-only host-clearance experiment; no visual qualification.",
    });
  const baseline = [];
  const boardRows: { files: string[]; label: string; master: 16 | 24 }[] = [];
  for (const master of [16, 24] as const) {
    const files = ["icon", "svg", "light.png", "dark.png"].map(
      (suffix) => `cloud-upload-filled-${master}.${suffix}`
    );
    for (const file of files) {
      copyFileSync(
        path.join(options.baseline, file),
        path.join(baselineOut, file)
      );
    }
    const [iconFile, svgFile, lightFile, darkFile] = files;
    const baselineSvg = readFileSync(path.join(baselineOut, svgFile), "utf-8");
    const sourceFidelity = await inspectNativeSourceFidelity(
      baselineSvg,
      baselineSource.svg,
      master
    );
    baseline.push({
      exactSourceReconstruction: true,
      files: files.map((file) => ({
        file: path.join("baseline", file),
        sha256: hash(readFileSync(path.join(baselineOut, file))),
      })),
      iconFile: path.join("baseline", iconFile),
      master,
      sourceFidelity,
      svgFile: path.join("baseline", svgFile),
    });
    boardRows.push({
      files: [
        path.join("baseline", lightFile),
        path.join("baseline", darkFile),
      ],
      label: `${master}px baseline · open negative arrow`,
      master,
    });
  }
  const outputs = [];
  for (const candidate of CLOUD_UPLOAD_CANDIDATES) {
    const master = String(candidate.master) as "16" | "24";
    const applied = await applyFamilyReferencePacket(base(), master, packet);
    if (applied.admissions.some(({ admission }) => admission !== "admitted")) {
      throw new Error(`${candidate.id}: source admission refused`);
    }
    const selection = selectStyle(applied.revision, master);
    const artifact = compileStyle(selection, candidate.program);
    const replay = replayStyle(selection, artifact);
    const programLines = candidate.program.split("\n");
    const arrowLine = programLines.at(-1);
    if (!arrowLine?.startsWith("part arrow-up-filled-0")) {
      throw new Error(
        `${candidate.id}: arrow must be the final separate group`
      );
    }
    const clearedHostProgram = programLines.slice(0, -1).join("\n");
    const clearedHost = compileStyle(selection, clearedHostProgram);
    const host = compileStyle(
      selection,
      `icon cloud-only-${master}\nfinish filled\npart cloud-filled-0 at 1,4 scale 1`
    );
    const iconBytes = `${candidate.program}\n`;
    const iconFile = `${candidate.id}.icon`;
    const svgFile = `${candidate.id}.svg`;
    writeFileSync(path.join(options.out, iconFile), iconBytes);
    writeFileSync(path.join(options.out, svgFile), artifact.svg);
    const native = [];
    const boardFiles = [];
    for (const surface of ["light", "dark"] as const) {
      const bytes = await nativePng(artifact.svg, candidate.master, surface);
      const file = `${candidate.id}.${surface}.png`;
      writeFileSync(path.join(options.out, file), bytes);
      native.push({ file, sha256: hash(bytes), surface });
      boardFiles.push(file);
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
        host.svg,
        clearedHost.svg,
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
    boardRows.push({
      files: boardFiles,
      label: `${candidate.master}px candidate · host clearance + positive arrow`,
      master: candidate.master,
    });
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
      "The 16px and 24px masters must have distinct programs and SVGs"
    );
  }
  const paintedPathCounts = outputs.map(({ id, svgFile }) => ({
    id,
    paintedPathCount:
      readFileSync(path.join(options.out, svgFile), "utf-8").match(/<path\b/gu)
        ?.length ?? 0,
  }));
  if (
    paintedPathCounts.some(({ paintedPathCount }) => paintedPathCount !== 2)
  ) {
    throw new Error("Cleared cloud and arrow must remain two painted groups");
  }
  const baselineMasterIdentity = {
    iconIdentical:
      baseline[0]?.files.find(({ file }) => file.endsWith(".icon"))?.sha256 ===
      baseline[1]?.files.find(({ file }) => file.endsWith(".icon"))?.sha256,
    svgIdentical:
      baseline[0]?.files.find(({ file }) => file.endsWith(".svg"))?.sha256 ===
      baseline[1]?.files.find(({ file }) => file.endsWith(".svg"))?.sha256,
  };
  const body = {
    baseline: {
      disposition:
        "Retained rejected experiment baseline: exact direct source reconstruction, but its open negative arrow is weak at native 16px. Rejection is for this optical experiment, not source fidelity.",
      masterIdentity: baselineMasterIdentity,
      outputs: baseline,
      source: {
        file: baselineSource.provenance.icon,
        sha256: hash(baselineSource.svg),
      },
    },
    board: { file: "native-4x-board.png", sha256: hash(board) },
    candidateLimit: { actualPerMaster: { "16": 1, "24": 1 }, maximum: 1 },
    compiler: STYLE_COMPILER,
    diagnosis: {
      cause:
        "The baseline is an exact single-contour source replay with no union and the correct cloud-upload reference. Its arrow is an open negative cut reaching the lower exterior, so native-size antialiasing and opening width govern recognition; closed-hole topology is not a semantic arrow test.",
      excluded: [
        "union drift",
        "source admission mismatch",
        "reference choice mismatch",
      ],
      mechanism:
        "The candidate repeats the folder-lock mechanism in a second family: subtract a bounded rounded clearance region from the host before adding an admitted modifier as a separate later painted group.",
      modifierZoneInterpretation:
        "The declared modifier zone measures the nominal arrow and clearance area, but it excludes part of the filled cutter stroke expansion and Boolean-intersection antialias fringe. The 24px result records 2 and 3 differing pixels outside that box at thresholds 128 and 192. Those values are real raster evidence and prevent a claim that the outer host contour is unchanged; zero at threshold 64 only means no difference was detected outside this analysis box at that threshold.",
    },
    distinctMasterIdentity: distinct,
    observations: {
      localBoardInspection:
        "The 24px candidate has a clearly separated positive arrow. At 16px the arrow remains identifiable but its head crowds the cloud roof and its shaft is weak at the strict threshold. In both masters the large clearance turns the solid host into a narrow open cloud band; the 16px band is especially uneven. Retain as development evidence for operation order, not an admission or visual pass.",
      topology:
        "Ink-component and hole counts are raw 64/128/192 antialias-threshold observations. The separate positive arrow may be its own component; counts do not visually qualify it.",
      visualLimitations: [
        "The 16px arrowhead nearly touches the cloud roof and the shaft falls from 24 modifier pixels at threshold 64 to 6 at threshold 192.",
        "The rounded polygon cutter removes enough mass that both candidates read as an open band rather than the original solid-cloud silhouette.",
        "Boolean intersection antialiasing changes up to three native pixels outside the declared modifier zone at the stricter thresholds.",
        "The 16px raw topology reports five holes at threshold 64 and none at 128 or 192; this instability is diagnostic and is not treated as semantic counter evidence.",
      ],
    },
    operationOrder: {
      assertion:
        "Each program places the admitted cloud, subtracts a closed rounded existing-DSL cutter from that host, then places the admitted arrow as a separate final group. There is no union after arrow placement.",
      existingDslOnly: true,
      paintedPathCounts,
    },
    outputs,
    packet: {
      file: "family-packet.json",
      packetHash: packet.packetHash,
      sha256: hash(packetBytes),
    },
    qualification:
      "development-only existing-DSL composition; source admission, exact replay, native pixel diagnostics and distinct master bytes do not visually qualify either master",
    referenceGuidance: {
      copiedFile: `reference-${referenceFile}`,
      file: referenceFile,
      note: "The house reference uses an open cloud band and a separate positive upload arrow. Its exact arrow bounds guide placement; this experiment preserves the solid cloud source and approximates the surrounding opening with a compiler-generated rounded cutter.",
      paintedShapeBounds: referenceParts.map(({ part, x, y }) => ({
        height: part.h,
        width: part.w,
        x,
        y,
      })),
      sha256: hash(referenceSvg),
    },
    sourceIdentities: sourceRows,
    version: 2,
  };
  const receipt = { ...body, receiptSha256: hash(JSON.stringify(body)) };
  writeFileSync(
    path.join(options.out, "receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  return receipt;
};

if (process.argv[1]?.endsWith("family-cloud-upload-experiment.ts")) {
  const baseline = process.argv[2];
  const out = process.argv[3];
  if (!(baseline && out)) {
    throw new Error(
      "Usage: family-cloud-upload-experiment.ts <baseline-directory> <new-output-directory> [blode-icons-package]"
    );
  }
  const library =
    process.argv[4] ??
    path.join(
      process.env.HOME ?? "",
      "Code/mblode/blode-icons/packages/blode-icons-react"
    );
  await buildCloudUploadExperiment({ baseline, library, out });
}

/** Build a development construction board from admitted local source packets. */
/* eslint-disable no-await-in-loop, prefer-destructuring, unicorn/consistent-function-scoping -- artifact rows are deliberately emitted in stable order */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import {
  compileStyle,
  createStyleRevision,
  selectStyle,
  STYLE_COMPILER,
} from "../src/pipeline/style.js";
import { SPEC } from "../src/tools/canvas.js";
import type { Finish } from "../src/types.js";
import { CONSTRUCTION_CLASSES } from "./family-construction-coverage.js";
import type { ConstructionClass } from "./family-construction-coverage.js";
import {
  familySourceParts,
  familySourceProgram,
  inspectNativeSourceFidelity,
} from "./family-parts.js";
import type { FamilySource } from "./family-parts.js";
import {
  applyFamilyReferencePacket,
  createFamilyReferencePacket,
} from "./family-reference-packet.js";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

interface Placement {
  name: string;
  scale: number;
  x: number;
  y: number;
}

export interface ConstructionBoardCase {
  classes: readonly ConstructionClass[];
  family: string;
  mode: "composition" | "reconstruction";
  notes: readonly string[];
  placements?: readonly Placement[];
  primary: string;
  sources: readonly string[];
}

export const CONSTRUCTION_BOARD_CASES: readonly ConstructionBoardCase[] = [
  {
    classes: ["container", "narrow"],
    family: "folder-lock",
    mode: "composition",
    notes: [
      "Exposed regression: shoulder, shackle, host occlusion and small counter remain development evidence.",
    ],
    placements: [{ name: "lock", scale: 0.42, x: 14, y: 11.5 }],
    primary: "folder-1",
    sources: ["folder-1", "lock"],
  },
  {
    classes: ["organic", "symbol"],
    family: "cloud-upload",
    mode: "reconstruction",
    notes: [
      "Exposed regression: direct house reconstruction tests cloud contour and arrow cutout together.",
    ],
    primary: "cloud-upload",
    sources: ["cloud-upload"],
  },
  {
    classes: ["symbol", "dense"],
    family: "bell-pause",
    mode: "composition",
    notes: [
      "Exposed regression: bell clearance and repeated pause bars remain visible for review.",
    ],
    placements: [{ name: "pause", scale: 0.34, x: 9.1, y: 9 }],
    primary: "bell",
    sources: ["bell", "pause"],
  },
  {
    classes: ["container", "dense"],
    family: "camera",
    mode: "reconstruction",
    notes: ["Exposed native-counter control."],
    primary: "camera-1",
    sources: ["camera-1"],
  },
  {
    classes: ["container", "symbol"],
    family: "shield-check",
    mode: "reconstruction",
    notes: [
      "Exposed turned-placement and tip-clearance control uses the admitted shield-check-2 family member.",
    ],
    primary: "shield-check-2",
    sources: ["shield-check-2"],
  },
  {
    classes: ["tool", "symbol", "narrow"],
    family: "hammer-check",
    mode: "composition",
    notes: [
      "Exposed regression: handle-only repair and check placement remain development evidence.",
    ],
    placements: [{ name: "check", scale: 0.3, x: 14.5, y: 14 }],
    primary: "hammer",
    sources: ["hammer", "check"],
  },
  {
    classes: ["organic", "dense", "narrow"],
    family: "jellyfish",
    mode: "composition",
    notes: [
      "Exposed regression: source cloud rim plus DSL tentacles is a composition, not a house jellyfish reconstruction.",
    ],
    primary: "cloud",
    sources: ["cloud"],
  },
  {
    classes: ["organic", "asymmetric"],
    family: "heart",
    mode: "reconstruction",
    notes: ["Exposed organic silhouette control."],
    primary: "heart",
    sources: ["heart"],
  },
  {
    classes: ["organic", "asymmetric"],
    family: "eye",
    mode: "reconstruction",
    notes: [
      "Exposed eye-family contour control uses the admitted eye-closed member.",
    ],
    primary: "eye-closed",
    sources: ["eye-closed"],
  },
  {
    classes: ["transport", "dense", "narrow"],
    family: "bicycle",
    mode: "reconstruction",
    notes: [
      "Exposed bicycle case uses the verified house bike source identity.",
    ],
    primary: "bike",
    sources: ["bike"],
  },
  {
    classes: ["tool", "dense", "narrow"],
    family: "scissors",
    mode: "reconstruction",
    notes: ["Exposed rotated source-part and narrow-bridge control."],
    primary: "scissors-1",
    sources: ["scissors-1"],
  },
  {
    classes: ["container", "symbol", "asymmetric"],
    family: "credit-card-check",
    mode: "composition",
    notes: [
      "Exposed regression: asymmetric badge and dense card detail remain development evidence.",
    ],
    placements: [{ name: "check", scale: 0.28, x: 15, y: 13 }],
    primary: "credit-card-1",
    sources: ["credit-card-1", "check"],
  },
  {
    classes: ["dense", "symbol"],
    family: "repeated-grid",
    mode: "reconstruction",
    notes: ["Required repeated-symbol spacing control."],
    primary: "grid",
    sources: ["grid"],
  },
  {
    classes: ["transport", "asymmetric"],
    family: "rocket",
    mode: "reconstruction",
    notes: ["Transport silhouette and off-axis source control."],
    primary: "rocket-2",
    sources: ["rocket-2"],
  },
  {
    classes: ["organic", "narrow", "asymmetric"],
    family: "feather",
    mode: "reconstruction",
    notes: ["Organic curve and narrow-stem control."],
    primary: "feather",
    sources: ["feather"],
  },
  {
    classes: ["tool", "narrow", "asymmetric"],
    family: "key",
    mode: "reconstruction",
    notes: ["Narrow connector and asymmetric teeth control."],
    primary: "key-1",
    sources: ["key-1"],
  },
] as const;

const LOCAL_BOARD_OBSERVATIONS: Readonly<Record<string, string>> = {
  "bell-pause":
    "The pause bars merge into the bell body in both filled native renders.",
  "credit-card-check":
    "The check modifier merges into the card body in both filled native renders.",
  "folder-lock":
    "The lock modifier merges into the folder body in both filled native renders.",
  "hammer-check":
    "The check modifier merges into the hammer body in both filled native renders.",
  jellyfish:
    "The DSL tentacles survive, but the filled cloud-derived rim remains a solid host shape.",
};

export const constructionClassCoverage = (
  cases: readonly ConstructionBoardCase[]
) =>
  Object.fromEntries(
    CONSTRUCTION_CLASSES.map((constructionClass) => [
      constructionClass,
      [
        ...new Set(
          cases
            .filter(({ classes }) => classes.includes(constructionClass))
            .map(({ family }) => family)
        ),
      ],
    ])
  ) as Record<ConstructionClass, string[]>;

const sourceProgramLines = (source: FamilySource) =>
  familySourceProgram(source).split("\n").slice(2);

const placedSourceLines = (source: FamilySource, placement: Placement) => {
  const parts = familySourceParts(source);
  const x0 = Math.min(...parts.map(({ x }) => x));
  const y0 = Math.min(...parts.map(({ y }) => y));
  return parts.map(
    ({ id, x, y }) =>
      `part ${id} at ${placement.x + (x - x0) * placement.scale},${placement.y + (y - y0) * placement.scale} scale ${placement.scale}`
  );
};

export const constructionProgram = (
  row: ConstructionBoardCase,
  finish: Finish,
  sources: readonly FamilySource[]
) => {
  const byName = new Map(sources.map((source) => [source.name, source]));
  const primary = byName.get(row.primary);
  if (!primary) {
    throw new Error(`${row.family}: missing primary source ${row.primary}`);
  }
  const lines = [
    `icon ${row.family}`,
    `finish ${finish}`,
    ...sourceProgramLines(primary),
  ];
  if (row.family === "jellyfish") {
    lines.push(
      "line 7,16 7,20",
      "line 10.5,16 10.5,21",
      "line 14,16 14,21",
      "line 17,16 17,20"
    );
  }
  for (const placement of row.placements ?? []) {
    const source = byName.get(placement.name);
    if (!source) {
      throw new Error(`${row.family}: missing placed source ${placement.name}`);
    }
    lines.push(...placedSourceLines(source, placement));
  }
  return lines.join("\n");
};

const nativePng = (svg: string, size: 16 | 24, surface: "dark" | "light") => {
  const dark = surface === "dark";
  const resolved = svg.replaceAll("currentColor", dark ? "#fff" : "#111");
  return sharp(Buffer.from(resolved), { density: (72 * size) / 24 })
    .resize(size, size, { fit: "contain" })
    .flatten({ background: dark ? "#111" : "#fff" })
    .png()
    .toBuffer();
};

const boardPng = async (
  out: string,
  rows: readonly { family: string; files: readonly string[]; label: string }[]
) => {
  const tile = 72;
  const labelWidth = 320;
  const rowHeight = 92;
  const headerHeight = 50;
  const width = labelWidth + tile * 8;
  const height = headerHeight + rowHeight * rows.length;
  const composites: { input: Buffer; left: number; top: number }[] = [];
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const labels = [
    "O16 L",
    "O16 D",
    "O24 L",
    "O24 D",
    "F16 L",
    "F16 D",
    "F24 L",
    "F24 D",
  ];
  const text = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f4f2ed"/><text x="16" y="30" font-family="sans-serif" font-size="18" font-weight="700" fill="#111">Geometry construction evidence</text>${labels.map((label, index) => `<text x="${labelWidth + index * tile + tile / 2}" y="31" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#333">${label}</text>`).join("")}${rows
    .map((row, index) => {
      const y = headerHeight + index * rowHeight;
      return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#d2cec5"/><text x="16" y="${y + 33}" font-family="sans-serif" font-size="15" font-weight="700" fill="#111">${escape(row.family)}</text><text x="16" y="${y + 53}" font-family="sans-serif" font-size="11" fill="#555">${escape(row.label)}</text>`;
    })
    .join("")}</svg>`;
  composites.push({ input: Buffer.from(text), left: 0, top: 0 });
  for (const [rowIndex, row] of rows.entries()) {
    for (const [columnIndex, file] of row.files.entries()) {
      const input = await sharp(readFileSync(path.join(out, file)))
        .resize(tile, tile, { kernel: sharp.kernel.nearest })
        .png()
        .toBuffer();
      composites.push({
        input,
        left: labelWidth + columnIndex * tile,
        top: headerHeight + rowIndex * rowHeight + 10,
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

const buildConstructionBoard = async (options: {
  cases?: readonly ConstructionBoardCase[];
  library: string;
  out: string;
}) => {
  const cases = options.cases ?? CONSTRUCTION_BOARD_CASES;
  const coverage = constructionClassCoverage(cases);
  for (const constructionClass of CONSTRUCTION_CLASSES) {
    if (coverage[constructionClass].length < 2) {
      throw new Error(
        `Construction class ${constructionClass} needs two distinct families`
      );
    }
  }
  mkdirSync(options.out, { recursive: false });
  const packageVersion = JSON.parse(
    readFileSync(path.join(options.library, "package.json"), "utf-8")
  ).version as string;
  const files = readdirSync(path.join(options.library, "icons-svg"))
    .filter((file) => /^[a-z][a-z0-9-]*\.svg$/u.test(file))
    .toSorted();
  const sourceRows = files.map((file) => ({
    file,
    svg: readFileSync(path.join(options.library, "icons-svg", file), "utf-8"),
  }));
  const librarySourceHash = hash(JSON.stringify(sourceRows));
  const base = () =>
    createStyleRevision({
      calibration: "unvalidated",
      compiler: STYLE_COMPILER,
      id: "wave-b-construction-board",
      masters: { "16": { ...SPEC, size: 16 }, "24": { ...SPEC, size: 24 } },
      parts: [],
      policy: DEFAULT_POLICY,
      references: [],
      rubric: "Development geometry board; no visual qualification.",
    });
  const manifestRows = [];
  const visualRows = [];
  for (const row of cases) {
    const outputs = [];
    const packetFiles = [];
    const sourceIdentities = [];
    const visualFiles: string[] = [];
    for (const finish of ["outlined", "filled"] as const) {
      const sources = row.sources.map((name): FamilySource => {
        const file = `${name}${finish === "filled" ? "-filled" : ""}.svg`;
        const found = sourceRows.find((source) => source.file === file);
        if (!found) {
          throw new Error(`${row.family}: missing verified source ${file}`);
        }
        return {
          finish,
          name,
          provenance: {
            date: "2026-09-08",
            icon: file,
            licenses: ["MIT"],
            origin: "literal",
            set: "blode-icons",
            version: packageVersion,
          },
          svg: found.svg,
        };
      });
      const packet = createFamilyReferencePacket({
        concept: row.family,
        excludedFamilies: [],
        excludedSourceHashes: [],
        librarySet: "blode-icons",
        librarySourceHash,
        sources: sources.map((source) => ({
          admissionRequested: true,
          intent: {
            evidence: `Exact ${source.provenance.icon} bytes supply ${source.name} geometry.`,
            polarity: source.name === row.primary ? "body" : "modifier",
            treatment:
              row.mode === "reconstruction"
                ? "exact source reconstruction"
                : "bounded source-part composition",
          },
          source,
        })),
      });
      const packetFile = `${row.family}-${finish}.family-packet.json`;
      const packetBytes = `${JSON.stringify(packet, null, 2)}\n`;
      writeFileSync(path.join(options.out, packetFile), packetBytes);
      packetFiles.push({
        file: packetFile,
        finish,
        packetHash: packet.packetHash,
        sha256: hash(packetBytes),
      });
      sourceIdentities.push(
        ...sources.map((source) => ({
          file: source.provenance.icon,
          finish,
          name: source.name,
          sha256: hash(source.svg),
        }))
      );
      let revision = base();
      for (const master of ["16", "24"] as const) {
        const applied = await applyFamilyReferencePacket(
          revision,
          master,
          packet
        );
        revision = applied.revision;
        if (
          applied.admissions.some(({ admission }) => admission !== "admitted")
        ) {
          throw new Error(
            `${row.family}/${finish}/${master}: source admission refused: ${JSON.stringify(applied.admissions)}`
          );
        }
        const program = constructionProgram(row, finish, sources);
        const artifact = compileStyle(selectStyle(revision, master), program);
        const stem = `${row.family}-${finish}-${master}`;
        const iconFile = `${stem}.icon`;
        const svgFile = `${stem}.svg`;
        writeFileSync(path.join(options.out, iconFile), `${program}\n`);
        writeFileSync(path.join(options.out, svgFile), artifact.svg);
        const native = [];
        for (const surface of ["light", "dark"] as const) {
          const bytes = await nativePng(
            artifact.svg,
            Number(master) as 16 | 24,
            surface
          );
          const file = `${stem}.${surface}.png`;
          writeFileSync(path.join(options.out, file), bytes);
          native.push({ file, sha256: hash(bytes), surface });
          visualFiles.push(file);
        }
        const topology = await inspectNativeSourceFidelity(
          artifact.svg,
          artifact.svg,
          Number(master) as 16 | 24
        );
        outputs.push({
          applicationHash: applied.applicationHash,
          compiler: artifact.compiler,
          finish,
          iconFile,
          iconSha256: hash(`${program}\n`),
          master,
          native,
          packetHash: packet.packetHash,
          styleHash: artifact.style,
          svgFile,
          svgSha256: hash(artifact.svg),
          topology: topology.actualTopology,
        });
      }
    }
    manifestRows.push({
      ...row,
      localBoardObservation: LOCAL_BOARD_OBSERVATIONS[row.family],
      outputs,
      packetFiles,
      sourceIdentities,
    });
    visualRows.push({
      family: row.family,
      files: visualFiles,
      label: `${row.mode} · ${row.classes.join(" + ")}`,
    });
  }
  const board = await boardPng(options.out, visualRows);
  writeFileSync(path.join(options.out, "construction-board.png"), board);
  const body = {
    board: { file: "construction-board.png", sha256: hash(board) },
    cases: manifestRows,
    classCoverage: coverage,
    compiler: STYLE_COMPILER,
    labels: {
      localBoardObservation:
        "direct inspection of this rendered board; a visible failure remains evidence, while absence of an observation is not a pass",
      mode: "reconstruction means a direct admitted house-source replay; composition means editable admitted source parts and DSL primitives",
      overlap:
        "Classes are nonexclusive and every overlap is disclosed per case.",
    },
    qualification:
      "development-only; local compiler and topology diagnostics are not AI visual qualification",
    review: {
      aiInspection: "not-run; root owns independent visual dispatch",
      engineeringStatus:
        "generated through canonical source admission and compiler",
      visualStatus:
        "unqualified; composite rows retain explicit development notes",
    },
    version: 1,
  };
  const manifest = { ...body, manifestSha256: hash(JSON.stringify(body)) };
  writeFileSync(
    path.join(options.out, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return manifest;
};

if (process.argv[1]?.endsWith("family-construction-board.ts")) {
  const out = process.argv[2];
  if (!out) {
    throw new Error(
      "Usage: family-construction-board.ts <new-output-directory> [blode-icons-package]"
    );
  }
  const library =
    process.argv[3] ??
    path.join(
      process.env.HOME ?? "",
      "Code/mblode/blode-icons/packages/blode-icons-react"
    );
  await buildConstructionBoard({ library, out });
}

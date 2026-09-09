/** One bounded filled folder-lock Boolean repair candidate. */
/* eslint-disable no-await-in-loop, prefer-destructuring -- sequential admission preserves immutable revision order */
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
  applyFamilyReferencePacket,
  createFamilyReferencePacket,
} from "./family-reference-packet.js";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

const FOLDER_LOCK_FILLED_REPAIR_PROGRAM = `icon folder-lock
finish filled
part folder-1-filled-0 at 2,3 scale 1
part lock-filled-0 at 14,11.5 scale 0.42
union
hole rect 15.5,12 4x3 r0.5
hole rect 16.5,15.5 2x3 r0.5`;

const nativePng = (svg: string, size: 16 | 24, dark: boolean) =>
  sharp(Buffer.from(svg.replaceAll("currentColor", dark ? "#fff" : "#111")), {
    density: (72 * size) / 24,
  })
    .resize(size, size, { fit: "contain" })
    .flatten({ background: dark ? "#111" : "#fff" })
    .png()
    .toBuffer();

const counterPixels = async (png: Buffer, size: 16 | 24) => {
  const { data, info } = await sharp(png)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const x0 = Math.floor((15.5 * size) / 24);
  const x1 = Math.ceil((19.5 * size) / 24);
  const y0 = Math.floor((12 * size) / 24);
  const y1 = Math.ceil((18.5 * size) / 24);
  let background = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (
        data[offset] > 245 &&
        data[offset + 1] > 245 &&
        data[offset + 2] > 245
      ) {
        background += 1;
      }
    }
  }
  return { background, region: { x0, x1, y0, y1 } };
};

const buildFolderLockFilledRepair = async (options: {
  baseline: string;
  library: string;
  out: string;
}) => {
  mkdirSync(options.out, { recursive: false });
  const baselineDirectory = path.join(options.out, "baseline");
  mkdirSync(baselineDirectory);
  const sources = ["folder-1-filled.svg", "lock-filled.svg"].map(
    (file): FamilySource => ({
      finish: "filled",
      name: file.replace(/-filled\.svg$/u, ""),
      provenance: {
        date: "2026-09-08",
        icon: file,
        licenses: ["MIT"],
        origin: "literal",
        set: "blode-icons",
        version: JSON.parse(
          readFileSync(path.join(options.library, "package.json"), "utf-8")
        ).version as string,
      },
      svg: readFileSync(path.join(options.library, "icons-svg", file), "utf-8"),
    })
  );
  const libraryFiles = ["folder-1-filled.svg", "lock-filled.svg"].map(
    (file) => ({
      file,
      svg: readFileSync(path.join(options.library, "icons-svg", file), "utf-8"),
    })
  );
  const librarySourceHash = hash(JSON.stringify(libraryFiles));
  const packet = createFamilyReferencePacket({
    concept: "folder-lock-filled-repair",
    excludedFamilies: [],
    excludedSourceHashes: [],
    librarySet: "blode-icons",
    librarySourceHash,
    sources: sources.map((source) => ({
      admissionRequested: true,
      intent: {
        evidence: `Exact ${source.provenance.icon} bytes supply repair geometry.`,
        polarity: source.name === "folder-1" ? "body" : "modifier",
        treatment: "bounded Boolean composition",
      },
      source,
    })),
  });
  const packetBytes = `${JSON.stringify(packet, null, 2)}\n`;
  writeFileSync(path.join(options.out, "family-packet.json"), packetBytes);
  let revision = createStyleRevision({
    calibration: "unvalidated",
    compiler: STYLE_COMPILER,
    id: "wave-b-folder-lock-filled-repair",
    masters: { "16": { ...SPEC, size: 16 }, "24": { ...SPEC, size: 24 } },
    parts: [],
    policy: DEFAULT_POLICY,
    references: [],
    rubric: "Development-only filled folder-lock Boolean repair.",
  });
  const outputs = [];
  for (const master of ["16", "24"] as const) {
    const applied = await applyFamilyReferencePacket(revision, master, packet);
    revision = applied.revision;
    if (applied.admissions.some(({ admission }) => admission !== "admitted")) {
      throw new Error(`Repair source admission refused at ${master}px`);
    }
    const selection = selectStyle(revision, master);
    const artifact = compileStyle(selection, FOLDER_LOCK_FILLED_REPAIR_PROGRAM);
    const replay = replayStyle(selection, artifact);
    const iconBytes = `${FOLDER_LOCK_FILLED_REPAIR_PROGRAM}\n`;
    const stem = `folder-lock-filled-${master}`;
    writeFileSync(path.join(options.out, `${stem}.icon`), iconBytes);
    writeFileSync(path.join(options.out, `${stem}.svg`), artifact.svg);
    const native = [];
    for (const surface of ["light", "dark"] as const) {
      const bytes = await nativePng(
        artifact.svg,
        Number(master) as 16 | 24,
        surface === "dark"
      );
      const file = `${stem}.${surface}.png`;
      writeFileSync(path.join(options.out, file), bytes);
      native.push({ file, sha256: hash(bytes), surface });
    }
    const baselineNames = [
      `${stem}.icon`,
      `${stem}.svg`,
      `${stem}.light.png`,
      `${stem}.dark.png`,
    ];
    const baselineHashes = baselineNames.map((file) => {
      const source = path.join(options.baseline, file);
      copyFileSync(source, path.join(baselineDirectory, file));
      return { file: `baseline/${file}`, sha256: hash(readFileSync(source)) };
    });
    const baselineLight = readFileSync(
      path.join(options.baseline, `${stem}.light.png`)
    );
    const candidateLight = readFileSync(
      path.join(options.out, `${stem}.light.png`)
    );
    const before = await counterPixels(
      baselineLight,
      Number(master) as 16 | 24
    );
    const after = await counterPixels(
      candidateLight,
      Number(master) as 16 | 24
    );
    outputs.push({
      applicationHash: applied.applicationHash,
      baseline: baselineHashes,
      compiler: artifact.compiler,
      exactReplay: replay === artifact.svg,
      guard: {
        after,
        before,
        name: "modifierCounterBackgroundPixelsInExpectedRegion",
        passed: after.background >= before.background + 2,
      },
      iconSha256: hash(iconBytes),
      master,
      native,
      packetHash: packet.packetHash,
      styleHash: artifact.style,
      svgSha256: hash(artifact.svg),
    });
  }
  const body = {
    candidate:
      "Boolean union of admitted folder and lock, followed by two semantic rect holes for the shackle and key slot",
    compiler: STYLE_COMPILER,
    input: { baselineDirectory: options.baseline },
    outputs,
    packet: {
      file: "family-packet.json",
      packetHash: packet.packetHash,
      sha256: hash(packetBytes),
    },
    qualification:
      "development-only candidate; named pixel guard and exact replay do not close visual review",
    version: 1,
  };
  const receipt = { ...body, receiptSha256: hash(JSON.stringify(body)) };
  writeFileSync(
    path.join(options.out, "receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  return receipt;
};

if (process.argv[1]?.endsWith("family-folder-lock-repair.ts")) {
  const [
    baseline,
    out,
    library = path.join(
      process.env.HOME ?? "",
      "Code/mblode/blode-icons/packages/blode-icons-react"
    ),
  ] = process.argv.slice(2);
  if (!baseline || !out) {
    throw new Error(
      "Usage: family-folder-lock-repair.ts <baseline-board-directory> <new-output-directory> [blode-icons-package]"
    );
  }
  await buildFolderLockFilledRepair({ baseline, library, out });
}

/** Build supplemental native-size evidence without changing the construction board. */
/* eslint-disable no-await-in-loop, unicorn/consistent-function-scoping -- artifact rows are deliberately emitted in stable order */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

interface BoardManifest {
  cases: readonly {
    family: string;
    mode: "composition" | "reconstruction";
    outputs: readonly {
      finish: "filled" | "outlined";
      master: "16" | "24";
      native: readonly { file: string; surface: "dark" | "light" }[];
    }[];
  }[];
}

const columns = [
  ["outlined", "16", "light"],
  ["outlined", "16", "dark"],
  ["outlined", "24", "light"],
  ["outlined", "24", "dark"],
  ["filled", "16", "light"],
  ["filled", "16", "dark"],
  ["filled", "24", "light"],
  ["filled", "24", "dark"],
] as const;

const renderSheet = async (
  boardDirectory: string,
  manifest: BoardManifest,
  scale: 1 | 4
) => {
  const labelWidth = 360;
  const tile = scale === 1 ? 72 : 112;
  const rowHeight = scale === 1 ? 54 : 112;
  const headerHeight = 58;
  const diagnosticRows = 2;
  const width = labelWidth + tile * columns.length;
  const height =
    headerHeight + rowHeight * (manifest.cases.length + diagnosticRows);
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const labels = columns.map(
    ([finish, size, surface]) =>
      `${finish[0]?.toUpperCase()}${size} ${surface[0]?.toUpperCase()} ${scale === 1 ? "actual" : "x4"}`
  );
  const rowLabels = manifest.cases.map(
    ({ family, mode }) => `${family} · ${mode}`
  );
  rowLabels.push(
    "eye-open · REFUSED at outlined 16px; eye-closed is not a qualification substitute",
    "shield-check · REFUSED at outlined 16px; board uses disclosed shield-check-2"
  );
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f4f2ed"/><text x="16" y="27" font-family="sans-serif" font-size="17" font-weight="700" fill="#111">Native evidence · ${scale === 1 ? "actual pixels" : "uniform 4x nearest-neighbour"}</text><text x="16" y="46" font-family="sans-serif" font-size="10" fill="#555">Taxonomy is provisional; empty refusal rows are diagnostics, not replacements.</text>${labels.map((label, index) => `<text x="${labelWidth + index * tile + tile / 2}" y="34" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#333">${label}</text>`).join("")}${rowLabels
    .map((label, index) => {
      const y = headerHeight + index * rowHeight;
      const refused = index >= manifest.cases.length;
      return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#d2cec5"/><text x="16" y="${y + Math.min(31, rowHeight / 2 + 5)}" font-family="sans-serif" font-size="${refused ? 11 : 13}" font-weight="${refused ? 400 : 700}" fill="${refused ? "#a21c1c" : "#111"}">${escape(label)}</text>`;
    })
    .join("")}</svg>`;
  const composites: { input: Buffer; left: number; top: number }[] = [
    { input: Buffer.from(svg), left: 0, top: 0 },
  ];
  for (const [rowIndex, row] of manifest.cases.entries()) {
    for (const [columnIndex, [finish, master, surface]] of columns.entries()) {
      const output = row.outputs.find(
        (candidate) =>
          candidate.finish === finish && candidate.master === master
      );
      const native = output?.native.find(
        (candidate) => candidate.surface === surface
      );
      if (!native) {
        throw new Error(`Missing ${row.family}/${finish}/${master}/${surface}`);
      }
      const input =
        scale === 1
          ? readFileSync(path.join(boardDirectory, native.file))
          : await sharp(readFileSync(path.join(boardDirectory, native.file)))
              .resize(Number(master) * scale, Number(master) * scale, {
                kernel: sharp.kernel.nearest,
              })
              .png()
              .toBuffer();
      const renderedSize = Number(master) * scale;
      composites.push({
        input,
        left:
          labelWidth +
          columnIndex * tile +
          Math.floor((tile - renderedSize) / 2),
        top:
          headerHeight +
          rowIndex * rowHeight +
          Math.floor((rowHeight - renderedSize) / 2),
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

export const buildNativePresentationReceipt = async (options: {
  boardDirectory: string;
  out: string;
}) => {
  mkdirSync(options.out, { recursive: false });
  const manifestBytes = readFileSync(
    path.join(options.boardDirectory, "manifest.json")
  );
  const manifest = JSON.parse(manifestBytes.toString("utf-8")) as BoardManifest;
  const actual = await renderSheet(options.boardDirectory, manifest, 1);
  const enlarged = await renderSheet(options.boardDirectory, manifest, 4);
  writeFileSync(path.join(options.out, "native-actual-size.png"), actual);
  writeFileSync(path.join(options.out, "native-uniform-4x.png"), enlarged);
  const body = {
    diagnostics: {
      observedFilledFailures: [
        "folder-lock",
        "bell-pause",
        "hammer-check",
        "credit-card-check",
      ],
      observedFilledLimitation:
        "jellyfish tentacles survive, but the cloud-derived rim remains a solid host shape",
      refusedSources: [
        {
          admission: "refused at outlined 16px source fidelity",
          name: "eye-open",
          sha256:
            "c3f1a21ab91ab1b262e13a7d4eb5db625798fdeea37dffc20892e6bb6bcfc66e",
        },
        {
          admission: "refused at outlined 16px source fidelity",
          name: "shield-check",
          sha256:
            "dbf9442cef9e25d02f921439ada3286f499c7107c971be1cb5b165e38e48decb",
        },
      ],
    },
    input: {
      directory: options.boardDirectory,
      manifestSha256: hash(manifestBytes),
    },
    presentation: {
      actual: {
        file: "native-actual-size.png",
        scale: 1,
        sha256: hash(actual),
      },
      enlarged: {
        file: "native-uniform-4x.png",
        kernel: "nearest",
        scale: 4,
        sha256: hash(enlarged),
      },
    },
    qualification:
      "development evidence only; class taxonomy is provisional and no visual family gate is closed",
    version: 2,
  };
  const receipt = { ...body, receiptSha256: hash(JSON.stringify(body)) };
  const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(path.join(options.out, "receipt.json"), receiptBytes);
  return receipt;
};

if (process.argv[1]?.endsWith("family-construction-native-sheet.ts")) {
  const [boardDirectory, out] = process.argv.slice(2);
  if (!boardDirectory || !out) {
    throw new Error(
      "Usage: family-construction-native-sheet.ts <board-directory> <new-output-directory>"
    );
  }
  await buildNativePresentationReceipt({ boardDirectory, out });
}

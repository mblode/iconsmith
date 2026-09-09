/** Full-library admitted-source reconstruction regression; never a generation score. */
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { parseIconSvg } from "../src/corpus/load.js";
import { compilePaint } from "../src/pipeline/reconstruct.js";
import { createStyleRevision, STYLE_COMPILER } from "../src/pipeline/style.js";
import { run } from "../src/tools/dsl.js";
import { png } from "../src/tools/render.js";
import {
  admitFamilyParts,
  inspectFamilySourceAdmission,
} from "./family-parts.js";
import type { FamilySourceAdmissionDisposition } from "./family-parts.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const replayLibraryIcon = async (
  concept: string,
  finish: "outlined" | "filled",
  svg: string
) => {
  const paths = parseIconSvg(svg).map((s) => s.d);
  if (!paths.length) {
    throw new Error("No drawable shapes");
  }
  const compiled = compilePaint(concept, paths, finish);
  const result = compiled.program.canvas.toSVG();
  const replay = run(compiled.source, compiled.extras);
  const exactReplay =
    replay.errors.length === 0 && replay.canvas.toSVG() === result;
  const errors = await Promise.all(
    [16, 24].map(async (size) => {
      const pixels = async (source: string) =>
        sharp(await png(source, size))
          .flatten({ background: "#fff" })
          .greyscale()
          .raw()
          .toBuffer();
      const [actual, reference] = await Promise.all([
        pixels(result),
        pixels(svg),
      ]);
      let absolute = 0;
      for (let i = 0; i < actual.length; i += 1) {
        absolute += Math.abs(actual[i] - reference[i]);
      }
      return { meanAbsolutePixelError: absolute / (255 * actual.length), size };
    })
  );
  return { errors, exactReplay, program: compiled.source, svg: result };
};

const readFrozenInventory = (
  inventoryFile: string,
  expectedInventorySha256: string
) => {
  const inventoryBytes = readFileSync(inventoryFile, "utf-8");
  if (
    !/^[a-f0-9]{64}$/u.test(expectedInventorySha256) ||
    digest(inventoryBytes) !== expectedInventorySha256
  ) {
    throw new Error("Frozen inventory byte identity mismatch");
  }
  const { manifest, rows } = JSON.parse(inventoryBytes);
  if (
    !Array.isArray(rows) ||
    rows.length === 0 ||
    rows.length !== manifest.files ||
    new Set(rows.map((row) => row.file)).size !== rows.length ||
    rows.some(
      (row) =>
        typeof row.file !== "string" ||
        path.basename(row.file) !== row.file ||
        !row.file.endsWith(".svg") ||
        !/^[a-f0-9]{64}$/u.test(row.sha256)
    ) ||
    digest(
      JSON.stringify(rows.map(({ file, sha256 }) => ({ file, sha256 })))
    ) !== manifest.sourceHash
  ) {
    throw new Error("Source inventory identity is invalid");
  }
  return { manifest, rows };
};

export const replayLibrary = async (
  inventoryFile: string,
  destination: string,
  expectedInventorySha256: string
) => {
  const { manifest, rows } = readFrozenInventory(
    inventoryFile,
    expectedInventorySha256
  );
  mkdirSync(destination, { recursive: false });
  const results = [];
  for (const row of rows) {
    let sourceVerified = false;
    try {
      const file = path.join(manifest.source, row.file);
      if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) {
        throw new Error("Source must be a regular file");
      }
      const svg = readFileSync(file, "utf-8");
      if (digest(svg) !== row.sha256) {
        throw new Error("Source bytes differ from the frozen inventory");
      }
      sourceVerified = true;
      // Preserve bounded geometry/raster memory over the complete library.
      // eslint-disable-next-line no-await-in-loop
      const result = await replayLibraryIcon(row.concept, row.finish, svg);
      results.push({
        errors: result.errors,
        exactReplay: result.exactReplay,
        file: row.file,
        sourceVerified,
      });
    } catch (error) {
      results.push({
        error: String(error),
        exactReplay: false,
        file: row.file,
        sourceVerified,
      });
    }
  }
  const summary = {
    exactReplay: results.filter((r) => r.exactReplay).length,
    failures: results.filter((r) => !r.exactReplay).length,
    generationQualified: false,
    inventorySha256: expectedInventorySha256,
    kind: "admitted-source-reconstruction",
    rasterDifferenceThreshold: 0.01,
    rasterDifferences: results.filter((r) =>
      r.errors?.some((e) => e.meanAbsolutePixelError > 0.01)
    ).length,
    sourceHash: manifest.sourceHash,
    sourceIdentityVerified: results.every((result) => result.sourceVerified),
    total: rows.length,
  };
  writeFileSync(
    path.join(destination, "results.json"),
    JSON.stringify({ results, summary }, null, 2)
  );
  return summary;
};

/** Re-run actual family-parts admission over the same frozen source population.
 * The caller supplies a fresh explicit compiler revision; no historic revision
 * is silently migrated and every refusal stays in the denominator. */
export const admitLibrarySources = async (options: {
  inventoryFile: string;
  expectedInventorySha256: string;
  revisionFile: string;
  expectedRevisionSha256: string;
  master: string;
  destination: string;
}) => {
  const { manifest, rows } = readFrozenInventory(
    options.inventoryFile,
    options.expectedInventorySha256
  );
  const revisionBytes = readFileSync(options.revisionFile, "utf-8");
  if (
    !/^[a-f0-9]{64}$/u.test(options.expectedRevisionSha256) ||
    digest(revisionBytes) !== options.expectedRevisionSha256
  ) {
    throw new Error("Frozen admission revision identity mismatch");
  }
  const revision = createStyleRevision(JSON.parse(revisionBytes));
  if (
    revision.definition.parts.length ||
    !revision.definition.masters[options.master]
  ) {
    throw new Error(
      "Admission audit requires an empty-parts revision and existing master"
    );
  }
  mkdirSync(options.destination, { recursive: false });
  const results: {
    file: string;
    sourceVerified: boolean;
    status: "source-admitted" | "refused";
    parts?: number;
    indexedParts?: number;
    assemblyParts?: number;
    dependencyParts?: number;
    representations?: FamilySourceAdmissionDisposition;
    reason?: string;
  }[] = [];
  for (const row of rows) {
    let sourceVerified = false;
    let representations: FamilySourceAdmissionDisposition | undefined;
    try {
      const file = path.join(manifest.source, row.file);
      const metadata = lstatSync(file);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error("Source must be a regular file");
      }
      const svg = readFileSync(file, "utf-8");
      if (digest(svg) !== row.sha256) {
        throw new Error("Source bytes differ from the frozen inventory");
      }
      sourceVerified = true;
      const source = {
        finish: row.finish,
        name: row.concept,
        provenance: {
          date: "2026-09-07",
          icon: row.file,
          licenses: ["MIT"],
          origin: "literal" as const,
          set: "blode-icons",
        },
        svg,
      };
      // Preserve both representations even when neither can be admitted.
      // eslint-disable-next-line no-await-in-loop
      representations = await inspectFamilySourceAdmission(
        revision,
        options.master,
        source
      );
      // Each source is isolated against one frozen base, with bounded raster memory.
      // eslint-disable-next-line no-await-in-loop
      const admitted = await admitFamilyParts(revision, options.master, [
        source,
      ]);
      const { parts } = admitted.definition;
      const assemblyParts = parts.filter(
        ({ part }) => "sourceAssembly" in part
      ).length;
      const dependencyParts = parts.filter(({ part }) =>
        Boolean(part.sourceAssemblyOnly)
      ).length;
      results.push({
        assemblyParts,
        dependencyParts,
        file: row.file,
        indexedParts: parts.length - assemblyParts - dependencyParts,
        parts: parts.length,
        representations,
        sourceVerified,
        status: "source-admitted",
      });
    } catch (error) {
      results.push({
        file: row.file,
        reason: String(error),
        representations,
        sourceVerified,
        status: "refused",
      });
    }
  }
  const summary = {
    admitted: results.filter(({ status }) => status === "source-admitted")
      .length,
    compiler: STYLE_COMPILER,
    generationQualified: false,
    inventorySha256: options.expectedInventorySha256,
    kind: "family-source-admission-audit",
    master: options.master,
    refused: results.filter(({ status }) => status === "refused").length,
    revisionHash: revision.hash,
    revisionSha256: options.expectedRevisionSha256,
    sourceHash: manifest.sourceHash,
    sourceIdentityVerified: results.every(
      ({ sourceVerified }) => sourceVerified
    ),
    total: rows.length,
  };
  writeFileSync(
    path.join(options.destination, "admission-results.json"),
    `${JSON.stringify({ rows: results, summary }, null, 2)}\n`,
    { flag: "wx" }
  );
  return summary;
};

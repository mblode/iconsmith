/** Full-library admitted-source reconstruction regression; never a generation score. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { parseIconSvg } from "../src/corpus/load.js";
import { compilePaint } from "../src/pipeline/reconstruct.js";
import { run } from "../src/tools/dsl.js";
import { png } from "../src/tools/render.js";

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

export const replayLibrary = async (
  inventoryFile: string,
  destination: string
) => {
  const { manifest, rows } = JSON.parse(readFileSync(inventoryFile, "utf-8"));
  mkdirSync(destination, { recursive: false });
  const results = [];
  for (const row of rows) {
    const svg = readFileSync(path.join(manifest.source, row.file), "utf-8");
    try {
      // Preserve bounded geometry/raster memory over the complete library.
      // eslint-disable-next-line no-await-in-loop
      const result = await replayLibraryIcon(row.concept, row.finish, svg);
      results.push({
        errors: result.errors,
        exactReplay: result.exactReplay,
        file: row.file,
      });
    } catch (error) {
      results.push({
        error: String(error),
        exactReplay: false,
        file: row.file,
      });
    }
  }
  const summary = {
    exactReplay: results.filter((r) => r.exactReplay).length,
    failures: results.filter((r) => !r.exactReplay).length,
    generationQualified: false,
    kind: "admitted-source-reconstruction",
    rasterDifferenceThreshold: 0.01,
    rasterDifferences: results.filter((r) =>
      r.errors?.some((e) => e.meanAbsolutePixelError > 0.01)
    ).length,
    sourceHash: manifest.sourceHash,
    total: rows.length,
  };
  writeFileSync(
    path.join(destination, "results.json"),
    JSON.stringify({ results, summary }, null, 2)
  );
  return summary;
};

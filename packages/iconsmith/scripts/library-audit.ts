/** Whole-library reference coverage. Source measurements are never generation scores. */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { auditIcon } from "../src/corpus/audit.js";
import { parseIconSvg } from "../src/corpus/load.js";
import { png, sheet } from "../src/tools/render.js";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const inspectLibraryIcon = (file: string, svg: string) => {
  const finish = file.endsWith("-filled.svg") ? "filled" : "outlined";
  const concept = file.replace(/(?:-filled)?\.svg$/u, "");
  const identity = { concept, file, finish, sha256: hash(svg) };
  try {
    const shapes = parseIconSvg(svg);
    if (!shapes.length) {
      throw new Error("No drawable shapes");
    }
    const a = auditIcon(concept, svg);
    const tags = [
      a.curves.length ? "curved" : "straight",
      a.curves.some((c) => c.cls === "freeform") ? "freeform" : "geometric",
      a.edges.some((e) => e.offAxis > 1) ? "off-axis" : "axis-aligned",
      a.subpaths >= 8 ? "dense" : "sparse",
      a.nearClosed.length ? "open-contours" : "closed-contours",
      /-(?:check|plus|minus|off|lock|upload|download|pause|play|heart|star)(?:-|$)/u.test(
        concept
      )
        ? "modifier-name"
        : "base-name",
    ];
    return {
      ...identity,
      error: null,
      shapes: shapes.length,
      subpaths: a.subpaths,
      tags,
    };
  } catch (error) {
    return {
      ...identity,
      error: String(error),
      shapes: null,
      subpaths: null,
      tags: ["parse-failed"],
    };
  }
};

export const auditLibrary = async (source: string, destination: string) => {
  const files = readdirSync(source)
    .filter((f) => f.endsWith(".svg"))
    .toSorted();
  if (!files.length) {
    throw new Error("No SVG library found");
  }
  mkdirSync(destination, { recursive: false });
  const rows = files.map((file) =>
    inspectLibraryIcon(file, readFileSync(path.join(source, file), "utf-8"))
  );
  const concepts = [...new Set(rows.map((r) => r.concept))].toSorted();
  const required = concepts.flatMap((concept) =>
    ["outlined", "filled"].flatMap((finish) =>
      [16, 24].map((size) => ({
        concept,
        finish,
        generationStatus: "not-generated",
        humanApproval: null,
        referencePresent: rows.some(
          (r) => r.concept === concept && r.finish === finish
        ),
        size,
      }))
    )
  );
  const groups = Object.fromEntries(
    [...new Set(rows.flatMap((r) => r.tags))]
      .toSorted()
      .map((tag) => [tag, rows.filter((r) => r.tags.includes(tag)).length])
  );
  const manifest = {
    concepts: concepts.length,
    files: rows.length,
    generatedRows: 0,
    generationQualified: false,
    groups,
    kind: "source-library-audit",
    parseFailures: rows.filter((r) => r.error).length,
    requiredGenerationRows: required.length,
    source: path.resolve(source),
    sourceHash: hash(
      JSON.stringify(rows.map(({ file, sha256 }) => ({ file, sha256 })))
    ),
  };
  writeFileSync(
    path.join(destination, "inventory.json"),
    JSON.stringify({ manifest, rows }, null, 2)
  );
  writeFileSync(
    path.join(destination, "generation-coverage.json"),
    JSON.stringify(required, null, 2)
  );
  const pages = [];
  const renderingFailures = [];
  for (let start = 0; start < rows.length; start += 128) {
    const page = rows.slice(start, start + 128);
    const valid = [];
    for (const row of page) {
      try {
        const svg = readFileSync(path.join(source, row.file), "utf-8");
        // Bounded raster validation; a broken file remains in inventory and failures.
        // eslint-disable-next-line no-await-in-loop
        await png(svg, 16);
        valid.push({ file: row.file, svg });
      } catch (error) {
        renderingFailures.push({ error: String(error), file: row.file });
      }
    }
    const id = String(pages.length + 1).padStart(3, "0");
    for (const size of [16, 24]) {
      if (valid.length) {
        // Bounded pages avoid loading the complete raster library into memory.
        writeFileSync(
          path.join(destination, `source-${id}-${size}.png`),
          // eslint-disable-next-line no-await-in-loop
          await sheet(
            valid.map((r) => r.svg),
            { cols: 16, size }
          )
        );
      }
    }
    pages.push({ files: valid.map((r) => r.file), id });
  }
  writeFileSync(
    path.join(destination, "pages.json"),
    JSON.stringify({ pages, renderingFailures }, null, 2)
  );
  writeFileSync(
    path.join(destination, "README.md"),
    "These are ORIGINAL SOURCE icons, not generated results. Every SVG is inventoried and hashed. Pages preserve filename order, 16 columns, with actual 16px and 24px tiles. pages.json maps every tile. Parse and raster failures remain recorded. generation-coverage.json requires each concept in both paints and both sizes; source presence never satisfies generation or human approval. Morphology tags are descriptive coverage strata, not quality verdicts or sealed family boundaries.\n"
  );
  return {
    ...manifest,
    pages: pages.length,
    renderingFailures: renderingFailures.length,
  };
};

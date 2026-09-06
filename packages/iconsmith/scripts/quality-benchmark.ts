/** Local audit packets: immutable evidence, blinded review IDs, missing rows retained. */
import { createHash, randomInt } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { STYLE_COMPILER, styleHash } from "../src/pipeline/style.js";
import { Canvas } from "../src/tools/canvas.js";
import { completeProgram, run } from "../src/tools/dsl.js";
import { lint } from "../src/tools/lint.js";
import { opticalProof } from "../src/tools/proof.js";
import { sheet } from "../src/tools/render.js";

export const DEVELOPMENT_FAMILIES = [
  ["cloud", "cloud-upload", "open body and external modifier"],
  ["bell", "bell-pause", "curved body and interrupted rim"],
  ["shield", "shield-check", "curved counter and acute intersections"],
  ["folder", "folder-lock", "asymmetric body and badge clearance"],
  ["clock", "clock-check", "intersecting cutters"],
  ["jellyfish", "jellyfish", "organic continuous contours"],
  ["satellite", "satellite-dish", "curved diagonal construction"],
  ["camera", "camera-sparkle", "nested counters and detail"],
  ["bookmark", "bookmark-play", "concave contour and solid modifier"],
  ["key", "key", "thin connecting features"],
  ["headphones", "headphones", "symmetric curved terminals"],
  ["leaf", "leaf", "asymmetric organic silhouette"],
  ["bicycle", "bicycle", "dense linked circular forms"],
  ["scissors", "scissors", "crossing diagonal bars"],
  ["hand", "hand-heart", "dense organic detail"],
  ["battery", "battery-charging", "wide body and negative modifier"],
  ["umbrella", "umbrella", "curved canopy and narrow stem"],
  ["rocket", "rocket", "diagonal pointed body"],
  ["credit-card", "credit-card-check", "wide body and short gaps"],
  ["hourglass", "hourglass", "narrow waist and enclosed counters"],
].map(([family, concept, challenge]) => ({ challenge, concept, family }));

export interface AuditInput {
  concept: string;
  family: string;
  finish: "outlined" | "filled";
  program: string;
  source: string;
  authorship: "model" | "manual";
  /** Original run receipt; unavailable facts must remain explicitly null. */
  model: string | null;
  elapsedMs: number | null;
  actualUsd: number | null;
}

export const freezeDevelopment = (directory: string) => {
  mkdirSync(directory, { recursive: false });
  const manifest = {
    families: DEVELOPMENT_FAMILIES,
    finishes: ["outlined", "filled"],
    frozenAt: new Date().toISOString(),
    holdoutClosure: "pending-source-alias-geometry-and-history-audit",
    humanLabels: "pending",
    id: "blode-quality-development-v1",
    rubric: "docs/plans/generation-quality-10.md",
    sizes: [16, 24],
  };
  const hash = styleHash(manifest);
  writeFileSync(
    path.join(directory, "manifest.json"),
    JSON.stringify({ hash, manifest }, null, 2)
  );
  return { hash, manifest };
};

export const exportAudit = async (
  directory: string,
  inputs: readonly AuditInput[],
  frozenManifestPath: string
) => {
  const frozen = JSON.parse(readFileSync(frozenManifestPath, "utf-8"));
  if (styleHash(frozen.manifest) !== frozen.hash) {
    throw new Error("Frozen benchmark manifest changed");
  }
  const families = new Map<string, string>(
    frozen.manifest.families.map(
      (entry: { family: string; concept: string }) => [
        entry.family,
        entry.concept,
      ]
    )
  );
  if (families.size !== 20) {
    throw new Error("Expected 20 distinct development families");
  }
  if (inputs.some((input) => families.get(input.family) !== input.concept)) {
    throw new Error("Unexpected benchmark concept or family");
  }
  mkdirSync(directory, { recursive: false });
  const shuffled = [...inputs];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const key = [];
  const rendered = [];
  for (const [index, input] of shuffled.entries()) {
    const id = `Q${String(index + 1).padStart(3, "0")}`;
    const result = run(input.program);
    const doc = result.canvas.toJSON({
      icon: result.icon,
      keyline: result.keyline,
    });
    const svg = result.canvas.toSVG();
    const replay =
      result.canvas.finish === input.finish &&
      result.errors.length === 0 &&
      completeProgram(doc, input.program) &&
      Canvas.fromJSON(doc).toSVG() === svg;
    const findings = lint(result.canvas, { keyline: result.keyline });
    const save = (extension: string, bytes: string | Uint8Array) =>
      writeFileSync(path.join(directory, `${id}.${extension}`), bytes);
    save("icon", input.program);
    save("svg", svg);
    for (const size of [16, 24]) {
      // Keep raster memory bounded when exporting a full benchmark.
      // eslint-disable-next-line no-await-in-loop
      const evidence = await opticalProof(svg, size);
      save(`${size}.png`, evidence.native);
      save(`${size}.proof.png`, evidence.proof);
    }
    const receipt = {
      ...input,
      compiler: STYLE_COMPILER,
      errors: result.errors,
      findings,
      id,
      opticalMasterClaim: false,
      paintMatches: result.canvas.finish === input.finish,
      program: undefined,
      programSha256: createHash("sha256").update(input.program).digest("hex"),
      replay,
      spec: result.canvas.spec,
      status:
        replay && !findings.some((finding) => finding.severity === "error")
          ? "needs-human-review"
          : "construction-failed",
      svgSha256: createHash("sha256").update(svg).digest("hex"),
    };
    key.push(receipt);
    rendered.push(svg);
  }
  const missing = [...families].flatMap(([family, concept]) =>
    ["outlined", "filled"]
      .filter(
        (finish) =>
          !inputs.some(
            (input) => input.family === family && input.finish === finish
          )
      )
      .map((finish) => ({ concept, family, finish, status: "not-generated" }))
  );
  writeFileSync(
    path.join(directory, "provenance.json"),
    JSON.stringify(
      { artifacts: key, manifestHash: frozen.hash, missing, qualified: false },
      null,
      2
    )
  );
  writeFileSync(
    path.join(directory, "human-review.json"),
    JSON.stringify(
      key.map(({ id }) => ({
        approved: null,
        craftRating: null,
        defects: [],
        familyFit: null,
        id,
        native16: null,
        native24: null,
        recognition: null,
      })),
      null,
      2
    )
  );
  if (rendered.length) {
    writeFileSync(
      path.join(directory, "contact-sheet.png"),
      await sheet(rendered, { cols: 4, size: 160 })
    );
  }
  writeFileSync(
    path.join(directory, "README.md"),
    "Review Q-numbered PNGs without provenance.json or .icon source. Rows follow Q-number order. Inspect both native proof sizes. Record independent recognition before revealing the concept. Missing labels are pending, never passes. These 16px images are downsampled proofs, not calibrated optical masters.\n"
  );
  return { count: key.length, missing: missing.length, qualified: false };
};

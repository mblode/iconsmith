import { createHash, randomInt } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Local audit packets: immutable evidence, blinded review IDs, missing rows retained. */
import sharp from "sharp";

import {
  createStyleRevision,
  selectStyle,
  replayStyle,
  styleHash,
} from "../src/pipeline/style.js";
import type { StyleArtifact } from "../src/pipeline/style.js";
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
  artifact: StyleArtifact;
  revision: unknown;
  terminal: { status: string; deadlineExceeded: boolean };
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

const validateInputs = (
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
  const sizes: number[] = frozen.manifest.sizes;
  const finishes: string[] = frozen.manifest.finishes;
  if (
    !families.size ||
    families.size !== frozen.manifest.families.length ||
    new Set(families.values()).size !== families.size ||
    !sizes?.length ||
    new Set(sizes).size !== sizes.length ||
    sizes.some((size) => ![16, 20, 24].includes(size)) ||
    !finishes?.length ||
    new Set(finishes).size !== finishes.length ||
    finishes.some((finish) => !["outlined", "filled"].includes(finish))
  ) {
    throw new Error("Invalid benchmark population");
  }
  if (inputs.some((input) => families.get(input.family) !== input.concept)) {
    throw new Error("Unexpected benchmark concept or family");
  }
  const identities = new Set<string>();
  const selections = new Map<AuditInput, ReturnType<typeof selectStyle>>();
  for (const input of inputs) {
    const selection = selectStyle(
      createStyleRevision(input.revision),
      input.artifact.master
    );
    if (
      !sizes.includes(selection.spec.size) ||
      !finishes.includes(input.finish)
    ) {
      throw new Error("Unexpected benchmark master or paint");
    }
    if (
      input.artifact.style !== selection.revision.hash ||
      styleHash(input.artifact.svg) !== input.artifact.svgHash
    ) {
      throw new Error("Artifact dependency or SVG hash mismatch");
    }
    const identity = `${input.family}:${input.finish}:${selection.spec.size}`;
    if (identities.has(identity)) {
      throw new Error("Duplicate benchmark output");
    }
    identities.add(identity);
    selections.set(input, selection);
  }
  return { families, finishes, frozen, identities, selections, sizes };
};

const auditStatus = (
  replay: boolean,
  findings: ReturnType<typeof lint>,
  terminal: AuditInput["terminal"]
) => {
  if (!replay || findings.some((finding) => finding.severity === "error")) {
    return "construction-failed";
  }
  if (terminal.deadlineExceeded) {
    return "deadline-exhausted";
  }
  if (terminal.status !== "delivered") {
    return "delivery-incomplete";
  }
  return "needs-human-review";
};

export const exportAudit = async (
  directory: string,
  inputs: readonly AuditInput[],
  frozenManifestPath: string
) => {
  const { frozen, families, sizes, finishes, identities, selections } =
    validateInputs(inputs, frozenManifestPath);
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
    const selection = selections.get(input);
    if (!selection) {
      throw new Error("Missing admitted selection");
    }
    const { program, svg } = input.artifact;
    const result = run(program, [...selection.parts], { spec: selection.spec });
    let exactReplay = false;
    try {
      exactReplay = replayStyle(selection, input.artifact) === svg;
    } catch {
      /* Retain original evidence as a failed row. */
    }
    const doc = result.canvas.toJSON({
      icon: result.icon,
      keyline: result.keyline,
    });
    const replay =
      result.icon === input.concept &&
      result.canvas.finish === input.finish &&
      result.errors.length === 0 &&
      exactReplay &&
      completeProgram(doc, program, selection.parts, {
        spec: selection.spec,
      }) &&
      Canvas.fromJSON(doc, [...selection.parts], selection.spec).toSVG() ===
        svg;
    const findings = lint(result.canvas, { keyline: result.keyline });
    const save = (extension: string, bytes: string | Uint8Array) =>
      writeFileSync(path.join(directory, `${id}.${extension}`), bytes);
    save("icon", program);
    save(
      "revision.json",
      JSON.stringify(selection.revision.definition, null, 2)
    );
    save("svg", svg);
    for (const size of [selection.spec.size]) {
      // Keep raster memory bounded when exporting a full benchmark.
      // eslint-disable-next-line no-await-in-loop
      const evidence = await opticalProof(svg, size);
      save(`${size}.png`, evidence.native);
      save(`${size}.proof.png`, evidence.proof);
    }
    const receipt = {
      ...input,
      artifact: undefined,
      compiler: input.artifact.compiler,
      errors: result.errors,
      findings,
      id,
      master: selection.master,
      nativeSize: selection.spec.size,
      opticalMasterClaim: "pending-human-calibration",
      paintMatches: result.canvas.finish === input.finish,
      programSha256: createHash("sha256").update(program).digest("hex"),
      replay,
      revision: undefined,
      revisionHash: selection.revision.hash,
      spec: result.canvas.spec,
      status: auditStatus(replay, findings, input.terminal),
      svgSha256: createHash("sha256").update(svg).digest("hex"),
    };
    key.push(receipt);
    rendered.push(svg);
  }
  const missing = [...families].flatMap(([family, concept]) =>
    sizes.flatMap((nativeSize) =>
      finishes
        .filter(
          (finish) => !identities.has(`${family}:${finish}:${nativeSize}`)
        )
        .map((finish) => ({
          concept,
          family,
          finish,
          nativeSize,
          status: "not-generated",
        }))
    )
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
      key.map(({ id, svgSha256, nativeSize }) => ({
        approved: null,
        craftRating: null,
        defects: [],
        familyFit: null,
        humanIdentity: null,
        id,
        native16: null,
        native24: null,
        nativeSize,
        recognition: null,
        svgSha256,
      })),
      null,
      2
    )
  );
  const batches: { count: number; id: string; images: string[] }[] = [];
  for (let start = 0; start < rendered.length; start += 20) {
    const batch = `batch-${String(batches.length + 1).padStart(3, "0")}`;
    const rows = key.slice(start, start + 20);
    // eslint-disable-next-line no-await-in-loop
    const image = await sheet(rendered.slice(start, start + 20), {
      cols: 4,
      size: 160,
    });
    const labelsSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${Math.ceil(rows.length / 4) * 160}">${rows.map((row, index) => `<text x="${(index % 4) * 160 + 8}" y="${Math.floor(index / 4) * 160 + 155}" font-family="Arial,sans-serif" font-size="10" fill="#555">${row.id} · ${row.nativeSize}px</text>`).join("")}</svg>`
    );
    // eslint-disable-next-line no-await-in-loop
    const labelled = await sharp(image)
      .composite([{ input: labelsSvg }])
      .png()
      .toBuffer();
    writeFileSync(path.join(directory, `${batch}.png`), labelled);
    const labels = rows.map(({ id, svgSha256, nativeSize }) => ({
      craftRating: null,
      criticalDefect: null,
      defects: [],
      familyFit: null,
      humanIdentity: null,
      id,
      nativeLegibility: null,
      nativeSize,
      recognition: null,
      shipUnchanged: null,
      svgSha256,
    }));
    writeFileSync(
      path.join(directory, `${batch}.labels.json`),
      JSON.stringify(labels, null, 2)
    );
    batches.push({
      count: rows.length,
      id: batch,
      images: rows.map((row) => row.id),
    });
  }
  writeFileSync(
    path.join(directory, "batches.json"),
    JSON.stringify(batches, null, 2)
  );
  writeFileSync(
    path.join(directory, "README.md"),
    "Review Q-numbered PNGs without provenance.json or .icon source. Each batch has at most 20 rows in Q-number order; use batches.json to map positions. Inspect the requested native proof size. Record independent recognition before revealing the concept. Missing labels are pending, never passes. Each row represents only its pinned native master; human optical calibration is pending.\n"
  );
  return { count: key.length, missing: missing.length, qualified: false };
};

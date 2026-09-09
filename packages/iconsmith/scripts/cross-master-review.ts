import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { png } from "../src/tools/render.js";

const CROSS_MASTER_EVIDENCE_VERSION = "native-svg-pixel-binding-v2";

const digest = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const validHash = (value: string) => /^[a-f0-9]{64}$/u.test(value);

export interface CrossMasterEvidence {
  concept: string;
  family: string;
  finish: "outlined" | "filled";
  nativeImageFile: string;
  nativeImageSha256: string;
  nativeSize: 16 | 24;
  /** Declare when a semantic modifier is expected, or explicitly rule it out. */
  modifierEvidence?: "present" | "not-applicable";
  /** Optional host-produced mask isolating the semantic modifier. */
  modifierMaskFile?: string;
  modifierMaskSha256?: string;
  svgFile: string;
  svgSha256: string;
}

interface MeasuredEvidence extends CrossMasterEvidence {
  modifier: null | { centroid: { x: number; y: number }; pixels: number };
  modifierExpectation: "not-applicable" | "present" | "unknown";
  paintedMass: number;
}

const measureMask = async (file: string, nativeSize: number) => {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== nativeSize || info.height !== nativeSize) {
    throw new Error(`Modifier mask is not native ${nativeSize}px evidence`);
  }
  let pixels = 0;
  let xTotal = 0;
  let yTotal = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const weight = data[offset + 3] / 255;
      pixels += weight;
      xTotal += (x + 0.5) * weight;
      yTotal += (y + 0.5) * weight;
    }
  }
  if (pixels === 0) {
    throw new Error("Modifier mask contains no evidence");
  }
  return {
    centroid: {
      x: xTotal / pixels / nativeSize,
      y: yTotal / pixels / nativeSize,
    },
    pixels,
  };
};

const pixelDifference = async (left: string, right: string, size: number) => {
  const raw = (file: string) =>
    sharp(file).ensureAlpha().resize(size, size).raw().toBuffer();
  const [a, b] = await Promise.all([raw(left), raw(right)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference += Math.abs(a[index] - b[index]);
  }
  return difference / (a.length * 255);
};

const verifyNativeRendering = async (
  native: Buffer,
  svg: Buffer,
  nativeSize: number
) => {
  if (nativeSize !== 16 && nativeSize !== 24) {
    throw new Error("Cross-master evidence requires native16 or native24");
  }
  const { data: nativePixels, info: nativeInfo } = await sharp(native)
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (nativeInfo.width !== nativeSize || nativeInfo.height !== nativeSize) {
    throw new Error("Native evidence dimensions do not match its master");
  }
  const renderedPixels = await sharp(
    await png(svg.toString("utf-8"), nativeSize)
  )
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer();
  if (!nativePixels.equals(renderedPixels)) {
    throw new Error("Native evidence does not match the bound SVG rendering");
  }
  let paintedMass = 0;
  for (let offset = 0; offset < nativePixels.length; offset += 4) {
    const luminance =
      nativePixels[offset] * 0.2126 +
      nativePixels[offset + 1] * 0.7152 +
      nativePixels[offset + 2] * 0.0722;
    paintedMass += (nativePixels[offset + 3] / 255) * (1 - luminance / 255);
  }
  if (paintedMass === 0) {
    throw new Error("Native evidence contains no painted pixels");
  }
  return paintedMass;
};

const verifyAndMeasure = async (
  row: CrossMasterEvidence
): Promise<MeasuredEvidence> => {
  if (!row.concept.trim() || !row.family.trim()) {
    throw new Error("Missing cross-master family identity");
  }
  const native = readFileSync(row.nativeImageFile);
  const svg = readFileSync(row.svgFile);
  if (
    !validHash(row.nativeImageSha256) ||
    !validHash(row.svgSha256) ||
    digest(native) !== row.nativeImageSha256 ||
    digest(svg) !== row.svgSha256
  ) {
    throw new Error("Cross-master evidence hash mismatch");
  }
  const paintedMass = await verifyNativeRendering(native, svg, row.nativeSize);
  const hasMask = row.modifierMaskFile !== undefined;
  if (hasMask !== (row.modifierMaskSha256 !== undefined)) {
    throw new Error(
      "Modifier evidence file and hash must be supplied together"
    );
  }
  if (row.modifierEvidence === "not-applicable" && hasMask) {
    throw new Error("No-modifier evidence cannot include a modifier mask");
  }
  let modifier = null;
  if (row.modifierMaskFile && row.modifierMaskSha256) {
    const mask = readFileSync(row.modifierMaskFile);
    if (
      !validHash(row.modifierMaskSha256) ||
      digest(mask) !== row.modifierMaskSha256
    ) {
      throw new Error("Modifier evidence hash mismatch");
    }
    modifier = await measureMask(row.modifierMaskFile, row.nativeSize);
  }
  return {
    ...row,
    modifier,
    modifierExpectation:
      row.modifierEvidence ?? (hasMask ? "present" : "unknown"),
    paintedMass,
  };
};

// Sibling, modifier and paint checks remain together so one receipt owns the denominator.
// eslint-disable-next-line complexity
export const reviewCrossMasterEvidence = async (
  evidence: readonly CrossMasterEvidence[]
) => {
  if (evidence.length === 0) {
    throw new Error("Cross-master evidence is empty");
  }
  const rows = await Promise.all(evidence.map(verifyAndMeasure));
  const identities = rows.map(
    (row) => `${row.family}/${row.concept}/${row.finish}/${row.nativeSize}`
  );
  if (new Set(identities).size !== identities.length) {
    throw new Error("Duplicate cross-master evidence row");
  }
  const familyKeys = [
    ...new Set(rows.map((row) => `${row.family}/${row.concept}`)),
  ].toSorted();
  const issues: string[] = [];
  const comparisons = [];
  for (const key of familyKeys) {
    const familyRows = rows.filter(
      (row) => `${row.family}/${row.concept}` === key
    );
    for (const finish of ["outlined", "filled"] as const) {
      const byFinish = familyRows.filter((row) => row.finish === finish);
      const small = byFinish.find((row) => row.nativeSize === 16);
      const large = byFinish.find((row) => row.nativeSize === 24);
      if (!small || !large) {
        issues.push(`${key}/${finish}: missing 16/24 sibling`);
        continue;
      }
      const expectationMismatch =
        small.modifierExpectation !== large.modifierExpectation;
      if (expectationMismatch) {
        issues.push(`${key}/${finish}: modifier applicability mismatch`);
      }
      const modifierExpected =
        small.modifierExpectation === "present" &&
        large.modifierExpectation === "present";
      const modifierUnknown =
        small.modifierExpectation === "unknown" ||
        large.modifierExpectation === "unknown";
      if (modifierUnknown) {
        issues.push(`${key}/${finish}: unknown modifier evidence`);
      } else if (modifierExpected && (!small.modifier || !large.modifier)) {
        issues.push(`${key}/${finish}: missing modifier sibling evidence`);
      }
      const shiftPxAt24 =
        small.modifier && large.modifier
          ? Math.hypot(
              small.modifier.centroid.x - large.modifier.centroid.x,
              small.modifier.centroid.y - large.modifier.centroid.y
            ) * 24
          : null;
      if (shiftPxAt24 !== null && shiftPxAt24 > 1) {
        issues.push(`${key}/${finish}: shifted modifier evidence`);
      }
      let modifierAssessment = "aligned";
      if (
        small.modifierExpectation === "not-applicable" &&
        large.modifierExpectation === "not-applicable"
      ) {
        modifierAssessment = "not-applicable";
      } else if (modifierUnknown) {
        modifierAssessment = "unknown";
      } else if (expectationMismatch || !small.modifier || !large.modifier) {
        modifierAssessment = "missing-sibling";
      } else if ((shiftPxAt24 ?? 0) > 1) {
        modifierAssessment = "shifted";
      }
      comparisons.push({
        finish,
        key,
        modifierAssessment,
        modifierShiftPxAt24: shiftPxAt24,
        native16Sha256: small.nativeImageSha256,
        native24Sha256: large.nativeImageSha256,
        svg16Sha256: small.svgSha256,
        svg24Sha256: large.svgSha256,
      });
    }
    for (const nativeSize of [16, 24] as const) {
      const outlined = familyRows.find(
        (row) => row.nativeSize === nativeSize && row.finish === "outlined"
      );
      const filled = familyRows.find(
        (row) => row.nativeSize === nativeSize && row.finish === "filled"
      );
      if (outlined && filled) {
        comparisons.push({
          advisory: "measured-paint-distinction-only" as const,
          key,
          nativeSize,
          // Four tiny native comparisons are clearer beside their family rows.
          // eslint-disable-next-line no-await-in-loop
          pixelDifference: await pixelDifference(
            outlined.nativeImageFile,
            filled.nativeImageFile,
            nativeSize
          ),
        });
      }
    }
  }
  const memberHashes = rows
    .map((row) => ({
      id: `${row.family}/${row.concept}/${row.finish}/${row.nativeSize}`,
      modifierEvidence: row.modifierEvidence ?? null,
      modifierMaskSha256: row.modifierMaskSha256 ?? null,
      nativeImageSha256: row.nativeImageSha256,
      svgSha256: row.svgSha256,
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const body = {
    comparisons,
    evidence: rows,
    evidenceVersion: CROSS_MASTER_EVIDENCE_VERSION,
    issues,
    memberHash: digest(JSON.stringify(memberHashes)),
    memberHashes,
    status: "pending-independent-review" as const,
  };
  return {
    complete: issues.length === 0,
    hash: digest(JSON.stringify(body)),
    receipt: body,
    // Automated measurements locate missing/shifted evidence but never approve
    // optical family coherence.
    reviewRequired: true,
  };
};

export const readCrossMasterReview = async (receiptFile: string) => {
  const frozen = JSON.parse(readFileSync(receiptFile, "utf-8")) as Awaited<
    ReturnType<typeof reviewCrossMasterEvidence>
  >;
  if (
    frozen.receipt.evidenceVersion !== CROSS_MASTER_EVIDENCE_VERSION ||
    frozen.receipt.status !== "pending-independent-review" ||
    digest(JSON.stringify(frozen.receipt)) !== frozen.hash
  ) {
    throw new Error("Cross-master receipt changed");
  }
  const rebuilt = await reviewCrossMasterEvidence(frozen.receipt.evidence);
  if (
    rebuilt.hash !== frozen.hash ||
    rebuilt.receipt.memberHash !== frozen.receipt.memberHash
  ) {
    throw new Error("Cross-master receipt members changed");
  }
  return frozen;
};

export const writeCrossMasterReview = async (
  directory: string,
  evidence: readonly CrossMasterEvidence[]
) => {
  const result = await reviewCrossMasterEvidence(evidence);
  mkdirSync(directory, { recursive: false });
  writeFileSync(
    path.join(directory, "receipt.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { flag: "wx" }
  );
  const ordered = [...evidence].toSorted((a, b) =>
    `${a.family}/${a.concept}/${a.nativeSize}/${a.finish}`.localeCompare(
      `${b.family}/${b.concept}/${b.nativeSize}/${b.finish}`
    )
  );
  const tile = 96;
  const images = await Promise.all(
    ordered.map((row) =>
      sharp(row.nativeImageFile)
        .resize(64, 64, { kernel: "nearest" })
        .extend({
          background: "#ffffff",
          bottom: 16,
          left: 16,
          right: 16,
          top: 16,
        })
        .png()
        .toBuffer()
    )
  );
  const columns = 4;
  const rows = Math.ceil(images.length / columns);
  await sharp({
    create: {
      background: "#e8e8e8",
      channels: 4,
      height: Math.max(rows, 1) * tile,
      width: columns * tile,
    },
  })
    .composite(
      images.map((input, index) => ({
        input,
        left: (index % columns) * tile,
        top: Math.floor(index / columns) * tile,
      }))
    )
    .png()
    .toFile(path.join(directory, "review.png"));
  return result;
};

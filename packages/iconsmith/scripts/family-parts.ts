/** Admit reusable family components without splitting counters or snapping curves. */
import { createHash } from "node:crypto";

import sharp from "sharp";

import { parseIconSvg } from "../src/corpus/load.js";
import { bbox, parsePath, serialise, translate } from "../src/geometry/path.js";
import {
  compileStyle,
  createStyleRevision,
  selectStyle,
  styleHash,
} from "../src/pipeline/style.js";
import type { StyleRevision } from "../src/pipeline/style.js";
import { issueSourceOriginGrant } from "../src/tools/canvas.js";
import type { Canvas, SourceOriginGrant } from "../src/tools/canvas.js";
import { png } from "../src/tools/render.js";
import { issueSourceExactResolver } from "../src/tools/source-exact.js";
import type { SourceExactResolver } from "../src/tools/source-exact.js";
import type { Finish } from "../src/types.js";
import { resolveSourceFeatureAdmissionProfile } from "./source-feature-admission-profile.js";

type Dependency = StyleRevision["definition"]["parts"][number];
export interface FamilySource {
  finish: Finish;
  name: string;
  provenance: Dependency["provenance"];
  svg: string;
}

export interface FamilySourcePart {
  id: string;
  part: Dependency["part"];
  x: number;
  y: number;
}

const NATIVE_THRESHOLDS = [64, 128, 192] as const;
const svgAttribute = (element: string, name: string): string | undefined =>
  element.match(new RegExp(`\\b${name}="(?<value>[^"]+)"`, "u"))?.groups?.value;

interface RasterTopology {
  holes: number;
  inkComponents: number;
  threshold: (typeof NATIVE_THRESHOLDS)[number];
}

export interface NativeFeatureRegion {
  /** Stable caller label for a source-confirmed local feature. */
  id: string;
  /** The painted polarity that must survive inside the region. */
  polarity: "clear" | "ink";
  /** Bounds in the source icon's 24-unit viewBox. */
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NativeFeatureMeasurement {
  /** Furthest target pixel from the opposite polarity, in native pixels. */
  peakClearancePx: number | null;
  /** Fraction of sampled region pixels with the declared polarity. */
  occupancy: number;
  sampledPixels: number;
  /** Ordered region mask; equality prevents shifted pixels hiding in summaries. */
  targetMask: string;
  targetPixels: number;
}

interface NativeFeatureThresholdFidelity {
  actual: NativeFeatureMeasurement;
  expected: NativeFeatureMeasurement;
  status: "match" | "mismatch" | "uncertain";
  threshold: (typeof NATIVE_THRESHOLDS)[number];
}

interface NativeFeatureFidelity {
  id: string;
  polarity: NativeFeatureRegion["polarity"];
  status: "match" | "mismatch" | "uncertain";
  thresholds: NativeFeatureThresholdFidelity[];
}

export interface NativeSourceFidelity {
  aggregateError: number;
  actualTopology: RasterTopology[];
  expectedTopology: RasterTopology[];
  features: NativeFeatureFidelity[];
  size: 16 | 24;
  status: "match" | "topology-mismatch";
}

const countComponents = (
  painted: Uint8Array,
  width: number,
  target: 0 | 1,
  excludeBoundary: boolean
) => {
  const visited = new Uint8Array(painted.length);
  let count = 0;
  for (let start = 0; start < painted.length; start += 1) {
    if (visited[start] || painted[start] !== target) {
      continue;
    }
    const stack = [start];
    visited[start] = 1;
    let touchesBoundary = false;
    while (stack.length) {
      const index = stack.pop();
      if (index === undefined) {
        continue;
      }
      const x = index % width;
      const y = Math.floor(index / width);
      touchesBoundary ||=
        x === 0 || y === 0 || x === width - 1 || y === width - 1;
      const neighbours = [index - 1, index + 1, index - width, index + width];
      for (const neighbour of neighbours) {
        if (
          neighbour < 0 ||
          neighbour >= painted.length ||
          visited[neighbour] ||
          painted[neighbour] !== target
        ) {
          continue;
        }
        const neighbourX = neighbour % width;
        if (Math.abs(neighbourX - x) > 1) {
          continue;
        }
        visited[neighbour] = 1;
        stack.push(neighbour);
      }
    }
    if (!(excludeBoundary && touchesBoundary)) {
      count += 1;
    }
  }
  return count;
};

const rasterTopology = (
  pixels: Buffer,
  size: 16 | 24,
  threshold: (typeof NATIVE_THRESHOLDS)[number]
): RasterTopology => {
  const painted = Uint8Array.from(pixels, (value) =>
    255 - value >= threshold ? 1 : 0
  );
  return {
    holes: countComponents(painted, size, 0, true),
    inkComponents: countComponents(painted, size, 1, false),
    threshold,
  };
};

const validateFeatureRegion = (region: NativeFeatureRegion) => {
  if (!/^[a-z][a-z0-9-]*$/u.test(region.id)) {
    throw new Error("Native feature region id must be a slug");
  }
  if (region.polarity !== "clear" && region.polarity !== "ink") {
    throw new Error(`${region.id}: feature polarity must be clear or ink`);
  }
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > 24 ||
    region.y + region.height > 24
  ) {
    throw new Error(
      `${region.id}: feature region must fit the 24-unit viewBox`
    );
  }
};

const featureMeasurement = (
  pixels: Buffer,
  size: 16 | 24,
  threshold: (typeof NATIVE_THRESHOLDS)[number],
  region: NativeFeatureRegion
): NativeFeatureMeasurement => {
  const target = region.polarity === "ink" ? 1 : 0;
  const painted = Uint8Array.from(pixels, (value) =>
    255 - value >= threshold ? 1 : 0
  );
  const regionIndexes: number[] = [];
  for (let index = 0; index < painted.length; index += 1) {
    const pixelX = index % size;
    const pixelY = Math.floor(index / size);
    const sourceX = ((pixelX + 0.5) * 24) / size;
    const sourceY = ((pixelY + 0.5) * 24) / size;
    if (
      sourceX >= region.x &&
      sourceX < region.x + region.width &&
      sourceY >= region.y &&
      sourceY < region.y + region.height
    ) {
      regionIndexes.push(index);
    }
  }
  if (!regionIndexes.length) {
    return {
      occupancy: 0,
      peakClearancePx: null,
      sampledPixels: 0,
      targetMask: "",
      targetPixels: 0,
    };
  }
  const targets = regionIndexes.filter((index) => painted[index] === target);
  const opposites = [...painted.keys()].filter(
    (index) => painted[index] !== target
  );
  let peakClearancePx: number | null = targets.length ? 0 : null;
  if (targets.length && !opposites.length) {
    peakClearancePx = null;
  } else if (targets.length) {
    for (const targetIndex of targets) {
      const targetX = targetIndex % size;
      const targetY = Math.floor(targetIndex / size);
      let nearest = Number.POSITIVE_INFINITY;
      for (const oppositeIndex of opposites) {
        const oppositeX = oppositeIndex % size;
        const oppositeY = Math.floor(oppositeIndex / size);
        nearest = Math.min(
          nearest,
          Math.hypot(oppositeX - targetX, oppositeY - targetY)
        );
      }
      peakClearancePx = Math.max(peakClearancePx ?? 0, nearest);
    }
  }
  return {
    occupancy: targets.length / regionIndexes.length,
    peakClearancePx,
    sampledPixels: regionIndexes.length,
    targetMask: regionIndexes
      .map((index) => (painted[index] === target ? "1" : "0"))
      .join(""),
    targetPixels: targets.length,
  };
};

const thresholdFeatureStatus = (
  actual: NativeFeatureMeasurement,
  expected: NativeFeatureMeasurement
): NativeFeatureThresholdFidelity["status"] => {
  if (actual.sampledPixels === 0 || expected.sampledPixels === 0) {
    return "uncertain";
  }
  if (
    actual.sampledPixels === expected.sampledPixels &&
    actual.targetPixels === expected.targetPixels &&
    actual.peakClearancePx === expected.peakClearancePx &&
    actual.targetMask === expected.targetMask
  ) {
    return "match";
  }
  if (
    expected.targetPixels > 0 &&
    (actual.targetPixels === 0 ||
      (expected.peakClearancePx !== null &&
        expected.peakClearancePx > 0 &&
        (actual.peakClearancePx ?? 0) === 0))
  ) {
    return "mismatch";
  }
  return "uncertain";
};

const inspectFeature = (
  actual: Buffer,
  expected: Buffer,
  size: 16 | 24,
  region: NativeFeatureRegion
): NativeFeatureFidelity => {
  validateFeatureRegion(region);
  const thresholds = NATIVE_THRESHOLDS.map((threshold) => {
    const actualMeasurement = featureMeasurement(
      actual,
      size,
      threshold,
      region
    );
    const expectedMeasurement = featureMeasurement(
      expected,
      size,
      threshold,
      region
    );
    return {
      actual: actualMeasurement,
      expected: expectedMeasurement,
      status: thresholdFeatureStatus(actualMeasurement, expectedMeasurement),
      threshold,
    };
  });
  const statuses = thresholds.map(({ status }) => status);
  let status: NativeFeatureFidelity["status"] = "uncertain";
  if (statuses.every((item) => item === "match")) {
    status = "match";
  } else if (statuses.every((item) => item === "mismatch")) {
    status = "mismatch";
  }
  return {
    id: region.id,
    polarity: region.polarity,
    status,
    thresholds,
  };
};

/** Extract exact source-backed parts and their original placements. Admission
 * and evidence boards share this path so a displayed DSL program uses the same
 * representation that crossed the canonical source boundary. */
export const familySourceParts = (source: FamilySource): FamilySourcePart[] => {
  if (!/^[a-z][a-z0-9-]*$/u.test(source.name)) {
    throw new Error("Family source name must be a slug");
  }
  if (
    /<(?:use|mask|clipPath|style|text)\b|\b(?:transform|style|clip-path|mask)\s*=/u.test(
      source.svg
    )
  ) {
    throw new Error(`${source.name}: unsupported source semantics`);
  }
  const shapes = parseIconSvg(source.svg);
  if (!shapes.length) {
    throw new Error(`${source.name}: no painted shapes`);
  }
  return shapes.map((shape, index) => {
    const solid = shape.filled && shape.strokeWidth === 0;
    if (
      (source.finish === "filled" && !solid) ||
      (shape.filled && shape.strokeWidth > 0)
    ) {
      throw new Error(`${source.name}: mixed or incompatible source paint`);
    }
    // SVG fill implicitly closes subpaths; make those host-derived closures explicit.
    const paths = parsePath(shape.d).map((p) =>
      solid ? { ...p, closed: true } : p
    );
    const box = bbox(paths);
    const id = `${source.name}-${source.finish}-${index}`;
    return {
      id,
      part: {
        closed: paths.every((p) => p.closed),
        d: serialise(paths.map((p) => translate(p, -box.x0, -box.y0))),
        h: box.h,
        icons: [source.name],
        id,
        instances: 1,
        name: id,
        nodes: paths.reduce((count, p) => count + p.segs.length, 0),
        sizeRange: [Math.max(box.w, box.h), Math.max(box.w, box.h)] as [
          number,
          number,
        ],
        ...(solid
          ? { sourceFillRule: shape.fillRule ?? ("nonzero" as const) }
          : {}),
        w: box.w,
      },
      x: box.x0,
      y: box.y0,
    };
  });
};

export const familySourceProgram = (source: FamilySource, icon = source.name) =>
  [
    `icon ${icon}`,
    `finish ${source.finish}`,
    ...familySourceParts(source).map(
      ({ id, x, y }) => `part ${id} at ${x},${y} scale 1`
    ),
  ].join("\n");

/** Admission-bound, coordinate-free exact-source authority. Assembly origin
 * replay is deliberately refused until Canvas can place ordered children at
 * their source offsets without routing through quantized public `part`. */
export const createFamilySourceExactResolver = async (input: {
  hostManifestPath: string;
  hostManifestSha256: string;
  master: string;
  requestSha256: string;
  representation: "assembly" | "indexed";
  revision: StyleRevision;
  source: FamilySource;
}): Promise<
  SourceExactResolver & { bindingId: string; revision: StyleRevision }
> => {
  const {
    hostManifestPath,
    hostManifestSha256,
    master,
    requestSha256,
    representation,
    revision,
    source,
  } = input;
  if (!hostManifestPath.startsWith("/")) {
    throw new Error("source-exact requires an absolute host manifest path");
  }
  if (!/^[a-f0-9]{64}$/u.test(hostManifestSha256)) {
    throw new Error("source-exact requires an exact host manifest sha256");
  }
  if (!/^[a-f0-9]{64}$/u.test(requestSha256)) {
    throw new Error("source-exact requires an exact request sha256");
  }
  if (representation === "assembly") {
    throw new Error(
      "source-exact assembly origin replay is not implemented safely"
    );
  }
  const sourceSha256 = createHash("sha256").update(source.svg).digest("hex");
  const profile = resolveSourceFeatureAdmissionProfile({
    finish: source.finish,
    master,
    representation,
    sourceName: source.name,
    sourceOrigin: source.provenance.origin,
    sourceSet: source.provenance.set,
    sourceSha256,
  });
  if (profile.status !== "profiled") {
    throw new Error(
      `${source.name}: source-exact requires a pinned source-feature profile`
    );
  }
  // oxlint-disable-next-line eslint/no-use-before-define -- public admission API is declared after shared inspection helpers
  const disposition = await inspectFamilySourceAdmission(
    revision,
    master,
    source
  );
  const admitted = disposition[representation];
  if (
    admitted.status !== "admitted" ||
    admitted.localFeature.status !== "pass" ||
    admitted.localFeature.profileHash !== profile.profileHash ||
    admitted.localFeature.profileVersion !== profile.profileVersion
  ) {
    throw new Error(
      `${source.name}: source-exact admission refused (${admitted.status}/${admitted.localFeature.status})`
    );
  }
  // oxlint-disable-next-line eslint/no-use-before-define -- public admission API is declared after shared inspection helpers
  const admittedRevision = await admitFamilyParts(revision, master, [source]);
  const extracted = familySourceParts(source);
  const admittedParts = extracted.map(({ id }) => {
    const part = admittedRevision.definition.parts.find(
      (entry) => entry.master === master && entry.part.id === id
    )?.part;
    if (!part) {
      throw new Error(`${source.name}: admitted part ${id} is missing`);
    }
    return part;
  });
  const sourceIdentity = {
    compiler: admittedRevision.definition.compiler,
    finish: source.finish,
    hostManifestPath,
    hostManifestSha256,
    master,
    masterSpecHash: styleHash(selectStyle(admittedRevision, master).spec),
    parts: admittedParts.map((part) => ({
      hash: styleHash(part),
      id: part.id,
    })),
    profileHash: profile.profileHash,
    profileVersion: profile.profileVersion,
    representation,
    requestSha256,
    revisionHash: admittedRevision.hash,
    sourceName: source.name,
    sourceOrigin: source.provenance.origin,
    sourceSet: source.provenance.set,
    sourceSha256,
  };
  const bindingId = `source-${styleHash(sourceIdentity)}`;
  const grants: SourceOriginGrant[] = extracted.map(({ id, x, y }) => {
    const part = admittedParts.find((candidate) => candidate.id === id);
    if (!part) {
      throw new Error(`${source.name}: admitted part ${id} is missing`);
    }
    return issueSourceOriginGrant(part, { sourceHash: sourceSha256, x, y });
  });
  const registryHash = styleHash({ bindingId, sourceIdentity });
  return issueSourceExactResolver({
    bindingId,
    icon: source.name,
    place(id: string, canvas: Canvas, finish: Finish) {
      if (id !== bindingId) {
        throw new Error("unknown source-exact binding");
      }
      if (finish !== source.finish) {
        throw new Error("source-exact finish mismatch");
      }
      if (styleHash(canvas.spec) !== sourceIdentity.masterSpecHash) {
        throw new Error("source-exact master spec mismatch");
      }
      for (const grant of grants) {
        canvas.sourcePart(grant);
      }
    },
    registryHash,
    revision: admittedRevision,
  });
};

/** Builds one constrained source alias while retaining every indexed child.
 * Children stay separate paint elements; the aggregate `d` is extent metadata
 * only and is never rendered by the assembly placement. */
export const familySourceAssembly = (
  source: FamilySource
): FamilySourcePart => {
  const viewBox = source.svg
    .match(/\bviewBox="(?<value>[^"]+)"/u)
    ?.groups?.value?.trim()
    .replaceAll(/\s+/gu, " ");
  if (viewBox !== "0 0 24 24") {
    throw new Error(
      `${source.name}: source assembly requires viewBox 0 0 24 24`
    );
  }
  if (
    /<(?:defs|g|use|mask|clipPath|style|text)\b|\b(?:opacity|fill-opacity|stroke-opacity|transform|style|clip-path|mask)\s*=|(?:fill|stroke)="url\(/u.test(
      source.svg
    )
  ) {
    throw new Error(
      `${source.name}: source assembly has unsupported inherited or resource semantics`
    );
  }
  const indexed = familySourceParts(source);
  if (indexed.length < 2) {
    throw new Error(
      `${source.name}: source assembly needs at least two children`
    );
  }
  const shapes = parseIconSvg(source.svg);
  const svgOpen = source.svg.match(/<svg\b[^>]*>/u)?.[0] ?? "";
  const inheritedFill = svgAttribute(svgOpen, "fill") ?? "black";
  const inheritedStroke = svgAttribute(svgOpen, "stroke") ?? "none";
  const rootJoin = svgAttribute(svgOpen, "stroke-linejoin");
  const inheritedJoin =
    rootJoin === "bevel" || rootJoin === "round" ? rootJoin : "miter";
  const paintedElements = [
    ...source.svg.matchAll(/<(?:path|circle|ellipse|rect|line)\b[^>]*>/gu),
  ].filter(([element]) => {
    const fill = svgAttribute(element, "fill") ?? inheritedFill;
    const stroke = svgAttribute(element, "stroke") ?? inheritedStroke;
    return fill !== "none" || stroke !== "none";
  });
  if (paintedElements.length !== shapes.length) {
    throw new Error(
      `${source.name}: source assembly could not bind effective child semantics`
    );
  }
  const absolute = indexed.flatMap(({ part, x, y }) =>
    parsePath(part.d).map((shape) => translate(shape, x, y))
  );
  const box = bbox(absolute);
  if (box.x0 < 0 || box.y0 < 0 || box.x1 > 24 || box.y1 > 24) {
    throw new Error(
      `${source.name}: source assembly geometry exceeds its 24-unit viewBox`
    );
  }
  const children = indexed.map(({ part, x, y }, index) => ({
    partHash: styleHash(part),
    partId: part.id,
    semantics: part.sourceFillRule
      ? { fillRule: part.sourceFillRule, kind: "fill" as const }
      : {
          cap: shapes[index].cap,
          join: (svgAttribute(paintedElements[index][0], "stroke-linejoin") ??
            inheritedJoin) as "bevel" | "miter" | "round",
          kind: "stroke" as const,
          strokeWidth: shapes[index].strokeWidth,
        },
    x: x - box.x0,
    y: y - box.y0,
  }));
  if (
    source.finish === "filled" &&
    new Set(children.map(({ semantics }) => semantics.kind)).size > 1
  ) {
    throw new Error(
      `${source.name}: filled source assembly mixes fill and stroke semantics`
    );
  }
  const id = `${source.name}-${source.finish}-assembly`;
  return {
    id,
    part: {
      closed: absolute.every((shape) => shape.closed),
      d: serialise(absolute.map((shape) => translate(shape, -box.x0, -box.y0))),
      h: box.h,
      icons: [source.name],
      id,
      instances: 1,
      name: id,
      nodes: absolute.reduce((count, shape) => count + shape.segs.length, 0),
      sizeRange: [Math.max(box.w, box.h), Math.max(box.w, box.h)],
      sourceAssembly: {
        children,
        finish: source.finish,
        sourceHash: createHash("sha256").update(source.svg).digest("hex"),
        viewBox: "0 0 24 24",
      },
      w: box.w,
    },
    x: box.x0,
    y: box.y0,
  };
};

export const familySourceAssemblyProgram = (
  source: FamilySource,
  icon = source.name
): string => {
  const assembly = familySourceAssembly(source);
  return `icon ${icon}\nfinish ${source.finish}\npart ${assembly.id} at ${assembly.x},${assembly.y} scale 1`;
};

/** Native painted-topology evidence at conservative antialias thresholds.
 * Threshold-specific results remain visible so callers cannot turn ambiguity
 * into an asserted counter or bridge. */
export const inspectNativeSourceFidelity = async (
  actualSvg: string,
  expectedSvg: string,
  size: 16 | 24,
  featureRegions: readonly NativeFeatureRegion[] = []
): Promise<NativeSourceFidelity> => {
  const pixels = async (svg: string) =>
    sharp(await png(svg, size))
      .greyscale()
      .raw()
      .toBuffer();
  const [actual, expected] = await Promise.all([
    pixels(actualSvg),
    pixels(expectedSvg),
  ]);
  const featureIds = new Set<string>();
  for (const region of featureRegions) {
    validateFeatureRegion(region);
    if (featureIds.has(region.id)) {
      throw new Error(`${region.id}: duplicate native feature region id`);
    }
    featureIds.add(region.id);
  }
  let error = 0;
  for (let index = 0; index < actual.length; index += 1) {
    error += Math.abs(actual[index] - expected[index]);
  }
  const actualTopology = NATIVE_THRESHOLDS.map((threshold) =>
    rasterTopology(actual, size, threshold)
  );
  const expectedTopology = NATIVE_THRESHOLDS.map((threshold) =>
    rasterTopology(expected, size, threshold)
  );
  return {
    actualTopology,
    aggregateError: error / (255 * actual.length),
    expectedTopology,
    features: featureRegions.map((region) =>
      inspectFeature(actual, expected, size, region)
    ),
    size,
    status:
      JSON.stringify(actualTopology) === JSON.stringify(expectedTopology)
        ? "match"
        : "topology-mismatch",
  };
};

type SourceBoundFeatureSemanticRole =
  | "clearance"
  | "connector"
  | "contour"
  | "counter"
  | "ink-island"
  | "junction"
  | "modifier"
  | "open-negative-space"
  | "rhythm";

const SOURCE_BOUND_FEATURE_SEMANTIC_ROLES =
  new Set<SourceBoundFeatureSemanticRole>([
    "clearance",
    "connector",
    "contour",
    "counter",
    "ink-island",
    "junction",
    "modifier",
    "open-negative-space",
    "rhythm",
  ]);

const SOURCE_BOUND_REGION_FAILURE_RULE = Object.freeze({
  minimumMismatchingThresholds: 2,
  minimumPersistentChangedMaskPositions: 1,
});

export interface SourceBoundFeatureRegion extends NativeFeatureRegion {
  /** Source-observed role; this label is evidence metadata, not classification. */
  semanticRole: SourceBoundFeatureSemanticRole;
  /** A caller assertion that this exact clear region is a semantic counter. */
  counterContract?: boolean;
}

interface SourceBoundRegionDeclaration {
  /** Prevents this diagnostic contract from becoming an implicit admission gate. */
  mode: "development-only";
  sourceSha256: string;
  sourceName: string;
  finish: Finish;
  master: string;
  rasterization: {
    kind: "native-master" | "resampled-source";
  };
  regions: readonly SourceBoundFeatureRegion[];
}

export interface SourceBoundRegionEvidenceRequest {
  actualFinish: Finish;
  actualMaster: string;
  actualSvg: string;
  declaration: SourceBoundRegionDeclaration;
  nativeSize: 16 | 24;
  revision: StyleRevision;
  source: FamilySource;
}

interface SourceBoundRegionDecision {
  id: string;
  mismatchThresholds: (typeof NATIVE_THRESHOLDS)[number][];
  persistentChangedMaskPositions: number;
  sourceCounterSuitability:
    | "not-a-counter-contract"
    | "source-counter-absent"
    | "source-counter-stable"
    | "source-counter-threshold-limited";
  status: NativeFeatureFidelity["status"];
}

export interface SourceBoundRegionEvidence {
  binding: {
    actualSvgSha256: string;
    finish: Finish;
    master: string;
    masterNativeSize: number;
    nativeSize: 16 | 24;
    rasterization: SourceBoundRegionDeclaration["rasterization"];
    sourceName: string;
    sourceSha256: string;
  };
  fidelity: NativeSourceFidelity;
  /** Aggregate error is report-only and never changes this decision. */
  status: "fail" | "pass" | "uncertain";
  regions: SourceBoundRegionDecision[];
  rule: typeof SOURCE_BOUND_REGION_FAILURE_RULE;
}

const validateSourceBoundRasterization = (
  request: SourceBoundRegionEvidenceRequest
) => {
  const { actualMaster, declaration, revision, source } = request;
  // Resolve the requested master now; a caller cannot bind evidence to an
  // absent master even when the declaration and claimed actual agree.
  const masterNativeSize = selectStyle(revision, actualMaster).spec.size;
  if (
    declaration.rasterization?.kind !== "native-master" &&
    declaration.rasterization?.kind !== "resampled-source"
  ) {
    throw new Error(`${source.name}: invalid source-bound rasterization`);
  }
  if (
    declaration.rasterization.kind === "native-master" &&
    request.nativeSize !== masterNativeSize
  ) {
    throw new Error(`${source.name}: native raster size does not match master`);
  }
  if (
    declaration.rasterization.kind === "resampled-source" &&
    request.nativeSize === masterNativeSize
  ) {
    throw new Error(`${source.name}: resampled raster size matches master`);
  }
  return masterNativeSize;
};

const validateSourceBoundDeclaration = (
  request: SourceBoundRegionEvidenceRequest
) => {
  const { actualFinish, actualMaster, declaration, source } = request;
  if (declaration.mode !== "development-only") {
    throw new Error("Source-bound region evidence must be development-only");
  }
  if (!/^[a-f0-9]{64}$/u.test(declaration.sourceSha256)) {
    throw new Error("Source-bound region source hash must be sha256");
  }
  if (
    declaration.sourceSha256 !==
    createHash("sha256").update(source.svg).digest("hex")
  ) {
    throw new Error(`${source.name}: source-bound region source hash mismatch`);
  }
  if (declaration.sourceName !== source.name) {
    throw new Error(`${source.name}: source-bound region source name mismatch`);
  }
  if (declaration.master !== actualMaster) {
    throw new Error(`${source.name}: source-bound region master mismatch`);
  }
  const masterNativeSize = validateSourceBoundRasterization(request);
  if (declaration.finish !== actualFinish || source.finish !== actualFinish) {
    throw new Error(`${source.name}: source-bound region paint mismatch`);
  }
  if (!declaration.regions.length) {
    throw new Error(`${source.name}: source-bound region declaration is empty`);
  }
  const ids = new Set<string>();
  for (const region of declaration.regions) {
    validateFeatureRegion(region);
    if (ids.has(region.id)) {
      throw new Error(`${region.id}: duplicate source-bound feature region id`);
    }
    ids.add(region.id);
    if (!SOURCE_BOUND_FEATURE_SEMANTIC_ROLES.has(region.semanticRole)) {
      throw new Error(`${region.id}: invalid source-bound semantic role`);
    }
    if (region.counterContract && region.polarity !== "clear") {
      throw new Error(
        `${region.id}: counter contract must have clear polarity`
      );
    }
  }
  return masterNativeSize;
};

/** Development-only evidence for exact source-bound local regions. Normal
 * source admission does not call this interface. Its three-way result remains
 * conservative: aggregate error cannot override local uncertainty or failure. */
export const inspectSourceBoundRegionEvidence = async (
  request: SourceBoundRegionEvidenceRequest
): Promise<SourceBoundRegionEvidence> => {
  const masterNativeSize = validateSourceBoundDeclaration(request);
  const {
    actualFinish,
    actualMaster,
    actualSvg,
    declaration,
    nativeSize,
    source,
  } = request;
  const fidelity = await inspectNativeSourceFidelity(
    actualSvg,
    source.svg,
    nativeSize,
    declaration.regions
  );
  const regions = fidelity.features.map((feature) => {
    const declarationRegion = declaration.regions.find(
      ({ id }) => id === feature.id
    );
    if (!declarationRegion) {
      throw new Error(`${feature.id}: source-bound declaration drift`);
    }
    const mismatches = feature.thresholds.filter(
      ({ actual, expected }) => actual.targetMask !== expected.targetMask
    );
    const persistentChangedMaskPositions = mismatches.length
      ? [...mismatches[0].actual.targetMask].filter((_, index) =>
          mismatches.every(
            ({ actual, expected }) =>
              actual.targetMask[index] !== expected.targetMask[index]
          )
        ).length
      : 0;
    const sourceTargetThresholds = feature.thresholds.filter(
      ({ expected }) => expected.targetPixels > 0
    ).length;
    let sourceCounterSuitability: SourceBoundRegionDecision["sourceCounterSuitability"] =
      "not-a-counter-contract";
    if (declarationRegion.counterContract) {
      if (sourceTargetThresholds === NATIVE_THRESHOLDS.length) {
        sourceCounterSuitability = "source-counter-stable";
      } else if (sourceTargetThresholds) {
        sourceCounterSuitability = "source-counter-threshold-limited";
      } else {
        sourceCounterSuitability = "source-counter-absent";
      }
    }
    return {
      id: feature.id,
      mismatchThresholds: mismatches.map(({ threshold }) => threshold),
      persistentChangedMaskPositions,
      sourceCounterSuitability,
      status: feature.status,
    } satisfies SourceBoundRegionDecision;
  });
  const failed = regions.some(
    ({ mismatchThresholds, persistentChangedMaskPositions }) =>
      mismatchThresholds.length >=
        SOURCE_BOUND_REGION_FAILURE_RULE.minimumMismatchingThresholds &&
      persistentChangedMaskPositions >=
        SOURCE_BOUND_REGION_FAILURE_RULE.minimumPersistentChangedMaskPositions
  );
  const passed =
    fidelity.status === "match" &&
    fidelity.features.every(({ status }) => status === "match") &&
    regions.every(
      ({ sourceCounterSuitability }) =>
        sourceCounterSuitability === "not-a-counter-contract" ||
        sourceCounterSuitability === "source-counter-stable"
    );
  let status: SourceBoundRegionEvidence["status"] = "uncertain";
  if (passed) {
    status = "pass";
  } else if (failed) {
    status = "fail";
  }
  return {
    binding: {
      actualSvgSha256: createHash("sha256").update(actualSvg).digest("hex"),
      finish: actualFinish,
      master: actualMaster,
      masterNativeSize,
      nativeSize,
      rasterization: declaration.rasterization,
      sourceName: source.name,
      sourceSha256: declaration.sourceSha256,
    },
    fidelity,
    regions,
    rule: SOURCE_BOUND_REGION_FAILURE_RULE,
    status,
  };
};

interface FamilySourceRepresentationDisposition {
  aggregateErrorBySize?: Partial<Record<16 | 24, number>>;
  localFeature: {
    evidenceBySize?: Partial<Record<16 | 24, SourceBoundRegionEvidence>>;
    profileHash?: string;
    profileVersion?: string;
    status: "fail" | "not-measured" | "pass" | "profile-refused" | "uncertain";
  };
  reason?: string;
  status: "admitted" | "not-applicable" | "refused" | "unsupported";
}

export interface FamilySourceAdmissionDisposition {
  assembly: FamilySourceRepresentationDisposition;
  indexed: FamilySourceRepresentationDisposition;
  source: { finish: FamilySource["finish"]; name: string };
}

// This is the single admission boundary for aggregate and fixed local evidence.
// eslint-disable-next-line complexity
const representationFidelity = async (
  revision: StyleRevision,
  master: string,
  source: FamilySource,
  dependencies: Dependency[],
  program: string,
  representation: "assembly" | "indexed"
): Promise<FamilySourceRepresentationDisposition> => {
  const sourceSha256 = createHash("sha256").update(source.svg).digest("hex");
  const profileResolution = resolveSourceFeatureAdmissionProfile({
    finish: source.finish,
    master,
    representation,
    sourceName: source.name,
    sourceOrigin: source.provenance.origin,
    sourceSet: source.provenance.set,
    sourceSha256,
  });
  if (profileResolution.status === "refused") {
    return {
      localFeature: { status: "profile-refused" },
      reason: profileResolution.reason,
      status: "refused",
    };
  }
  try {
    const selected = selectStyle(revision, master);
    const candidate = createStyleRevision({
      ...revision.definition,
      masters: {
        ...revision.definition.masters,
        [master]: { ...selected.spec, partGeometry: "source" },
      },
      parts: [...revision.definition.parts, ...dependencies],
    });
    const artifact = compileStyle(selectStyle(candidate, master), program);
    const aggregateErrorBySize: Partial<Record<16 | 24, number>> = {};
    const evidenceBySize: Partial<Record<16 | 24, SourceBoundRegionEvidence>> =
      {};
    const profiledFailures: {
      size: 16 | 24;
      status: "fail" | "uncertain";
    }[] = [];
    const aggregateFailures: (16 | 24)[] = [];
    /* eslint-disable no-await-in-loop -- Paired evidence is accumulated in deterministic native-size order. */
    for (const size of [16, 24] as const) {
      // Each representation is checked independently. A grouped alias cannot
      // revoke a valid indexed reconstruction or grant its children reuse.
      // eslint-disable-next-line no-await-in-loop
      const profileObservation =
        profileResolution.status === "profiled"
          ? profileResolution.profile.observations.find(
              ({ nativeSize }) => nativeSize === size
            )
          : undefined;
      if (profileResolution.status === "profiled" && !profileObservation) {
        return {
          aggregateErrorBySize,
          localFeature: {
            profileHash: profileResolution.profileHash,
            profileVersion: profileResolution.profileVersion,
            status: "profile-refused",
          },
          reason: `${source.name}: profiled ${size}px observation is missing`,
          status: "refused",
        };
      }
      // A fixed profile is resolved internally. Callers cannot provide regions
      // or opt a calibrated source into an unmeasured representation.
      // The two native-size checks share a fixed candidate and must be retained
      // together before a profiled decision is returned.
      // eslint-disable-next-line no-await-in-loop
      const evidence = profileObservation
        ? await inspectSourceBoundRegionEvidence({
            actualFinish: source.finish,
            actualMaster: master,
            actualSvg: artifact.svg,
            declaration: {
              finish: source.finish,
              master,
              mode: "development-only",
              rasterization: profileObservation.rasterization,
              regions: profileObservation.regions,
              sourceName: source.name,
              sourceSha256,
            },
            nativeSize: size,
            revision: candidate,
            source,
          })
        : undefined;
      if (evidence) {
        evidenceBySize[size] = evidence;
      }
      // eslint-disable-next-line no-await-in-loop
      const fidelity =
        evidence?.fidelity ??
        (await inspectNativeSourceFidelity(artifact.svg, source.svg, size));
      aggregateErrorBySize[size] = fidelity.aggregateError;
      if (evidence && evidence.status !== "pass") {
        profiledFailures.push({ size, status: evidence.status });
      }
      if (fidelity.aggregateError > 0.01) {
        aggregateFailures.push(size);
        if (profileResolution.status !== "profiled") {
          return {
            aggregateErrorBySize,
            localFeature: { status: "not-measured" },
            reason: `${source.name}: ${representation === "assembly" ? "assembly " : ""}${size}px source fidelity failed`,
            status: "refused",
          };
        }
      }
    }
    /* eslint-enable no-await-in-loop */
    if (profiledFailures.length) {
      const status = profiledFailures.some(
        ({ status: item }) => item === "fail"
      )
        ? "fail"
        : "uncertain";
      return {
        aggregateErrorBySize,
        localFeature: {
          evidenceBySize,
          profileHash:
            profileResolution.status === "profiled"
              ? profileResolution.profileHash
              : undefined,
          profileVersion:
            profileResolution.status === "profiled"
              ? profileResolution.profileVersion
              : undefined,
          status,
        },
        reason: `${source.name}: ${representation} local feature ${status} at ${profiledFailures.map(({ size }) => `${size}px`).join(", ")}`,
        status: "refused",
      };
    }
    if (aggregateFailures.length) {
      return {
        aggregateErrorBySize,
        localFeature: {
          evidenceBySize,
          profileHash:
            profileResolution.status === "profiled"
              ? profileResolution.profileHash
              : undefined,
          profileVersion:
            profileResolution.status === "profiled"
              ? profileResolution.profileVersion
              : undefined,
          status: "pass",
        },
        reason: `${source.name}: ${representation === "assembly" ? "assembly " : ""}${aggregateFailures.join("px, ")}px source fidelity failed`,
        status: "refused",
      };
    }
    return {
      aggregateErrorBySize,
      localFeature:
        profileResolution.status === "profiled"
          ? {
              evidenceBySize,
              profileHash: profileResolution.profileHash,
              profileVersion: profileResolution.profileVersion,
              status: "pass",
            }
          : { status: "not-measured" },
      status: "admitted",
    };
  } catch (error) {
    return {
      localFeature: {
        status:
          profileResolution.status === "profiled"
            ? "profile-refused"
            : "not-measured",
      },
      reason: error instanceof Error ? error.message : String(error),
      status: "refused",
    };
  }
};

const inspectRepresentations = async (
  revision: StyleRevision,
  master: string,
  source: FamilySource,
  priorDependencies: Dependency[] = []
): Promise<{
  assembly: FamilySourcePart | null;
  disposition: FamilySourceAdmissionDisposition;
  indexed: FamilySourcePart[];
}> => {
  const selected = selectStyle(revision, master);
  const indexed = familySourceParts(source);
  const sourceSha256 = createHash("sha256").update(source.svg).digest("hex");
  const assemblyProfile = resolveSourceFeatureAdmissionProfile({
    finish: source.finish,
    master,
    representation: "assembly",
    sourceName: source.name,
    sourceOrigin: source.provenance.origin,
    sourceSet: source.provenance.set,
    sourceSha256,
  });
  const unavailableAssemblyLocalFeature = {
    status:
      assemblyProfile.status === "not-measured"
        ? ("not-measured" as const)
        : ("profile-refused" as const),
  };
  const indexedDependencies = indexed.map(({ part }) => ({
    master,
    part,
    provenance: source.provenance,
  }));
  const indexedDisposition = await representationFidelity(
    revision,
    master,
    source,
    [...priorDependencies, ...indexedDependencies],
    familySourceProgram(source),
    "indexed"
  );
  let assembly: FamilySourcePart | null = null;
  let assemblyDisposition: FamilySourceRepresentationDisposition = {
    localFeature: unavailableAssemblyLocalFeature,
    reason: "Source has fewer than two indexed children",
    status: "not-applicable",
  };
  if (indexed.length > 1) {
    try {
      const candidate = familySourceAssembly(source);
      const compatible = candidate.part.sourceAssembly?.children.every(
        ({ semantics }) =>
          semantics.kind === "fill"
            ? true
            : semantics.strokeWidth === selected.spec.stroke &&
              semantics.cap === (selected.spec.strokeCap ?? "round") &&
              semantics.join === (selected.spec.strokeJoin ?? "round")
      );
      if (compatible) {
        const checked = await representationFidelity(
          revision,
          master,
          source,
          [
            ...priorDependencies,
            ...indexedDependencies,
            { master, part: candidate.part, provenance: source.provenance },
          ],
          familySourceAssemblyProgram(source),
          "assembly"
        );
        assemblyDisposition = checked;
        if (checked.status === "admitted") {
          assembly = candidate;
        }
      } else {
        assemblyDisposition = {
          localFeature: unavailableAssemblyLocalFeature,
          reason: `${source.name}: assembly child paint does not match master`,
          status: "refused",
        };
      }
    } catch (error) {
      assemblyDisposition = {
        localFeature: unavailableAssemblyLocalFeature,
        reason: error instanceof Error ? error.message : String(error),
        status: "unsupported",
      };
    }
  }
  return {
    assembly,
    disposition: {
      assembly: assemblyDisposition,
      indexed: indexedDisposition,
      source: { finish: source.finish, name: source.name },
    },
    indexed,
  };
};

/** Reports each independently validated source representation without changing
 * the revision. A valid assembly can be admitted with private child
 * dependencies even when those children fail independent indexed admission. */
export const inspectFamilySourceAdmission = async (
  revision: StyleRevision,
  master: string,
  source: FamilySource
): Promise<FamilySourceAdmissionDisposition> => {
  const inspected = await inspectRepresentations(revision, master, source);
  return inspected.disposition;
};

/** Returns a new immutable revision only after native source-fidelity checks.
 * This is source admission, not generated-quality approval. Unsupported SVG
 * paint semantics fail rather than becoming misleading reusable components. */
export const admitFamilyParts = async (
  revision: StyleRevision,
  master: string,
  sources: readonly FamilySource[]
): Promise<StyleRevision> => {
  const selected = selectStyle(revision, master);
  const dependencies: Dependency[] = [];
  for (const source of sources) {
    // eslint-disable-next-line no-await-in-loop
    const { assembly, disposition, indexed } = await inspectRepresentations(
      revision,
      master,
      source,
      dependencies
    );
    if (
      disposition.indexed.status !== "admitted" &&
      disposition.assembly.status !== "admitted"
    ) {
      throw new Error(
        disposition.indexed.reason ??
          `${source.name}: indexed source admission failed`
      );
    }
    const assemblyOnly = disposition.indexed.status !== "admitted";
    const admittedIndexed = indexed.map(({ part }) => ({
      ...part,
      ...(assemblyOnly && assembly ? { sourceAssemblyOnly: assembly.id } : {}),
    }));
    const admittedAssembly = assembly
      ? {
          ...assembly.part,
          sourceAssembly: assembly.part.sourceAssembly
            ? {
                ...assembly.part.sourceAssembly,
                children: assembly.part.sourceAssembly.children.map((child) => {
                  const admittedChild = admittedIndexed.find(
                    ({ id }) => id === child.partId
                  );
                  if (!admittedChild) {
                    throw new Error(
                      `${source.name}: assembly child ${child.partId} is missing`
                    );
                  }
                  return { ...child, partHash: styleHash(admittedChild) };
                }),
              }
            : undefined,
        }
      : null;
    dependencies.push(
      ...admittedIndexed.map((part) => ({
        master,
        part,
        provenance: source.provenance,
      })),
      ...(admittedAssembly
        ? [{ master, part: admittedAssembly, provenance: source.provenance }]
        : [])
    );
  }
  return createStyleRevision({
    ...revision.definition,
    masters: {
      ...revision.definition.masters,
      [master]: { ...selected.spec, partGeometry: "source" },
    },
    parts: [...revision.definition.parts, ...dependencies],
  });
};

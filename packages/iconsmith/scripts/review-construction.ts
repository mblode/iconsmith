/** Exact source measurements for the critic; never an aesthetic verdict. */
import { createHash } from "node:crypto";

import { normaliseIconSvg } from "../src/corpus/normalise.js";
import { parsePath } from "../src/geometry/path.js";

const digest = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export const strokeFacts = (svg: string) => {
  // The corpus normalizer supports flat geometry and root inheritance, not
  // arbitrary SVG/CSS. Unsupported constructs must not yield plausible facts.
  if (
    [...svg.matchAll(/<(?<tag>[A-Za-z][\w:-]*)\b/gu)].some(
      (match) =>
        !["svg", "path", "circle", "ellipse", "rect", "line"].includes(
          match.groups?.tag ?? ""
        )
    ) ||
    /\b(?:transform|style|class|vector-effect)\s*=|=\s*'/u.test(svg) ||
    [...svg.matchAll(/stroke-linecap="(?<cap>[^"]*)"/gu)].some(
      (match) => !["round", "butt", "square"].includes(match.groups?.cap ?? "")
    ) ||
    [...svg.matchAll(/stroke-width="(?<width>[^"]*)"/gu)].some(
      (match) =>
        !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(
          match.groups?.width ?? ""
        ) || !Number.isFinite(Number(match.groups?.width))
    )
  ) {
    return {
      reason: "Unsupported SVG presentation or transform",
      status: "unavailable",
      svgSha256: digest(svg),
    };
  }
  const normalized = normaliseIconSvg(svg);
  if (
    !normalized.viewBox ||
    normalized.viewBox[2] <= 0 ||
    normalized.viewBox[3] <= 0
  ) {
    return {
      reason: "Missing or invalid viewBox",
      status: "unavailable",
      svgSha256: digest(svg),
    };
  }
  const widths = [
    ...new Set(
      normalized.shapes
        .map((shape) => shape.strokeWidth)
        .filter((width) => width > 0)
    ),
  ].toSorted((a, b) => a - b);
  return {
    capScope:
      "Declared caps on open stroked subpaths only; closed contours have no cap endpoints. Filled or expanded contour terminal geometry is not inferred. Intersections may occlude caps.",
    declaredCapsOnOpenStrokedSubpaths: [
      ...new Set(
        normalized.shapes
          .filter(
            (shape) =>
              shape.strokeWidth > 0 &&
              parsePath(shape.d).some((subpath) => !subpath.closed)
          )
          .map((shape) => shape.cap)
      ),
    ].toSorted(),
    declaredStrokeWidthsOn24Grid: widths,
    status: "measured",
    svgSha256: digest(svg),
    widthInference: widths.length
      ? "Declared SVG strokes only; filled contour thickness is not measured"
      : "Filled geometry: stroke thickness cannot be inferred from absent stroke attributes",
  };
};

export const constructionEvidence = (input: {
  nativeSize: number;
  candidates: Readonly<Record<string, { svg: string; proof: Uint8Array }>>;
  references: readonly string[];
  referenceSheet?: Uint8Array;
}) => ({
  candidates: Object.fromEntries(
    Object.entries(input.candidates).map(([paint, candidate]) => [
      paint,
      {
        ...strokeFacts(candidate.svg),
        proofSha256: digest(candidate.proof),
      },
    ])
  ),
  nativeSize: input.nativeSize,
  referenceSheetSha256: input.referenceSheet
    ? digest(input.referenceSheet)
    : null,
  referencesInSheetOrder: input.references.map((svg, index) => ({
    index,
    ...strokeFacts(svg),
  })),
  scope:
    "Host-measured source stroke attributes normalized to a 24-unit grid. Native pixel width is width * nativeSize / 24. Different widths can be optically appropriate; equality or inequality is not a quality verdict. These facts do not establish style calibration or measure expanded filled contours.",
});

export const constructionStyleQuestion = (
  facts: ReturnType<typeof constructionEvidence>
) => ({
  choices: ["pass", "fail", "uncertain"],
  id: "style",
  prompt: `Does the candidate optically fit the supplied reference family's terminals, corners, proportions and detail weights? Without reference evidence choose uncertain. When reference-<index>-proof.png images are supplied, their zero-based indices match referencesInSheetOrder. Compare their labelled native1x/2x columns with the candidate at the same scale and surface, not just the enlarged vectors. These are unchanged source drawings rasterized at the candidate size, not newly calibrated optical masters. Use the host-measured source facts below for literal stroke-width and cap claims; do not estimate or contradict them from a raster. Distinguish literal width equality from perceptual harmony. A thinner detail stroke may be a deliberate optical adjustment, but you must judge its appearance rather than call it equal. An unavailable measurement is unknown, not zero. Identify visible evidence for perceptual claims; these measurements do not grant approval.\n${JSON.stringify(facts)}`,
});

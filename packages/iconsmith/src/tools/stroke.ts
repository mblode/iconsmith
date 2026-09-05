/** Host-owned stroke outlines. The DSL never accepts path data. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { bbox, parsePath } from "../geometry/path.js";

interface StrokePath {
  delete: () => void;
  transform: (matrix: number[]) => StrokePath;
  stroke: (options: {
    cap: unknown;
    join: unknown;
    miter_limit?: number;
    width: number;
  }) => StrokePath | null;
  toSVGString: () => string;
}
interface StrokeKernel {
  FromSVGString: (d: string) => StrokePath | null;
  StrokeCap: { ROUND: unknown; SQUARE: unknown };
  StrokeJoin: { MITER: unknown; ROUND: unknown };
}
const require = createRequire(import.meta.url);
const initialize = require("pathkit-wasm/bin/pathkit.js") as (options: {
  wasmBinary: Uint8Array;
}) => Promise<StrokeKernel>;
// Node's module initialization completes before synchronous Canvas calls. Resolve
// the external package asset equally in source, built CLI and library imports.
const kernel = await initialize({
  wasmBinary: readFileSync(require.resolve("pathkit-wasm/bin/pathkit.wasm")),
});

type StrokeOptions = (
  | { join: "miter"; miterLimit?: number }
  | { join: "round" }
) & { cap?: "round" | "square" };

const strokeOptions = (options?: StrokeOptions) => {
  const join = options?.join ?? "round";
  const cap = options?.cap ?? "round";
  if (!["round", "square"].includes(cap)) {
    throw new Error("Unsupported stroke cap");
  }
  const miterLimit = options?.join === "miter" ? (options.miterLimit ?? 4) : 4;
  if (
    !["miter", "round"].includes(join) ||
    !Number.isFinite(miterLimit) ||
    miterLimit < 1
  ) {
    throw new Error("Stroke join requires a finite miter limit of at least 1");
  }
  return { cap, join, miterLimit };
};

export const expandStroke = (
  d: string,
  width: number,
  options?: StrokeOptions
): string => {
  const { cap, join, miterLimit } = strokeOptions(options);
  const paths = parsePath(d);
  const box = bbox(paths);
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !paths.length ||
    !paths.some((path) => path.segs.length > 0) ||
    ![box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)
  ) {
    throw new Error(
      "Stroke requires finite nonempty geometry and positive width"
    );
  }
  const path = kernel.FromSVGString(d);
  if (!path) {
    throw new Error("Stroke kernel rejected geometry");
  }
  try {
    // Work at 100x resolution to reduce device-space curve approximation.
    path.transform([100, 0, 0, 0, 100, 0, 0, 0, 1]);
    if (
      !path.stroke({
        cap:
          cap === "square" ? kernel.StrokeCap.SQUARE : kernel.StrokeCap.ROUND,
        join:
          join === "miter" ? kernel.StrokeJoin.MITER : kernel.StrokeJoin.ROUND,
        miter_limit: miterLimit,
        width: width * 100,
      })
    ) {
      throw new Error("Stroke expansion failed");
    }
    path.transform([0.01, 0, 0, 0, 0.01, 0, 0, 0, 1]);
    const result = path.toSVGString();
    const expanded = parsePath(result);
    const bounds = bbox(expanded);
    if (
      !expanded.length ||
      expanded.some((part) => !part.closed) ||
      ![bounds.x0, bounds.y0, bounds.x1, bounds.y1].every(Number.isFinite)
    ) {
      throw new Error("Stroke expansion returned invalid geometry");
    }
    return result;
  } finally {
    path.delete();
  }
};

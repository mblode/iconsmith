/** Admit reusable family components without splitting counters or snapping curves. */
import sharp from "sharp";

import { parseIconSvg } from "../src/corpus/load.js";
import { bbox, parsePath, serialise, translate } from "../src/geometry/path.js";
import {
  compileStyle,
  createStyleRevision,
  selectStyle,
} from "../src/pipeline/style.js";
import type { StyleRevision } from "../src/pipeline/style.js";
import { png } from "../src/tools/render.js";
import type { Finish } from "../src/types.js";

type Dependency = StyleRevision["definition"]["parts"][number];
export interface FamilySource {
  finish: Finish;
  name: string;
  provenance: Dependency["provenance"];
  svg: string;
}

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
    const program = [`finish ${source.finish}`];
    for (const [index, shape] of shapes.entries()) {
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
      const part = {
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
      };
      dependencies.push({ master, part, provenance: source.provenance });
      program.push(`part ${id} at ${box.x0},${box.y0} scale 1`);
    }
    const candidate = createStyleRevision({
      ...revision.definition,
      masters: {
        ...revision.definition.masters,
        [master]: { ...selected.spec, partGeometry: "source" },
      },
      parts: [...revision.definition.parts, ...dependencies],
    });
    const artifact = compileStyle(
      selectStyle(candidate, master),
      program.join("\n")
    );
    for (const size of [16, 24]) {
      const pixels = async (svg: string) =>
        sharp(await png(svg, size))
          .greyscale()
          .raw()
          .toBuffer();
      // Each source is checked before any revision is returned.
      // eslint-disable-next-line no-await-in-loop
      const [actual, expected] = await Promise.all([
        pixels(artifact.svg),
        pixels(source.svg),
      ]);
      let error = 0;
      for (let i = 0; i < actual.length; i += 1) {
        error += Math.abs(actual[i] - expected[i]);
      }
      if (error / (255 * actual.length) > 0.01) {
        throw new Error(`${source.name}: ${size}px source fidelity failed`);
      }
    }
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

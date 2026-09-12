/** Deterministic sibling lookup over the whole bundled blode-icons library. */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { z } from "zod";

import { parseIconSvg } from "../src/corpus/load.js";
import { bbox, parsePath, points, q } from "../src/geometry/path.js";
import { ANGLE_TOLERANCE, SPEC } from "../src/tools/canvas.js";
import { run } from "../src/tools/dsl.js";
import { sheet } from "../src/tools/render.js";
import type { Subpath } from "../src/types.js";
import { BLODE_ICONS_PACKAGE } from "./blode-icons.js";

const metadataSchema = z
  .object({
    category: z.string().optional(),
    icon: z.string(),
    tags: z.array(z.string()).default([]),
  })
  .passthrough();

/** One drawn stroke of a sibling, read back as the DSL op that redraws it. */
interface LibraryElement {
  /** `line …` or `circle …` on the family grid; null for a curve. */
  readonly dsl: string | null;
  readonly h: number;
  readonly kind: "circle" | "curve" | "line";
  /** True when the canvas draws `dsl` somewhere other than the source ink:
   *  a vertex moved onto the grid, or a near-axis segment was pulled onto it. */
  readonly quantised: boolean;
  readonly w: number;
  readonly x: number;
  readonly y: number;
}

interface LibrarySibling {
  /** Shared tags, shared cohort, and name tokens that link it to the concept. */
  readonly because: readonly string[];
  /** Stroked elements, smallest first, so a reused modifier reads at the top. */
  readonly elements: readonly LibraryElement[];
  readonly name: string;
  readonly score: number;
  readonly svg: string;
}

export interface LibrarySiblingsResult {
  readonly concept: string;
  readonly conceptTags: readonly string[];
  /** Library files that are the concept itself, a byte twin, or Lucide-derived. */
  readonly excluded: readonly string[];
  readonly finish: "outlined" | "filled";
  readonly siblings: readonly LibrarySibling[];
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const tokens = (name: string) =>
  new Set(name.split("-").filter((t) => t.length > 2));
const normalise = (tag: string) =>
  tag
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();

const readTags = (dataDirectory: string, name: string): string[] => {
  const file = path.join(dataDirectory, `${name}.json`);
  if (!existsSync(file)) {
    return [];
  }
  const parsed = metadataSchema.parse(JSON.parse(readFileSync(file, "utf-8")));
  return parsed.tags.map(normalise).filter((t) => t.length > 0);
};

const GRID = 0.25;
const snap = ([x, y]: readonly [number, number]): [number, number] => [
  q(x, GRID),
  q(y, GRID),
];
const moved = (a: readonly [number, number], b: readonly [number, number]) =>
  Math.abs(a[0] - b[0]) > 0.001 || Math.abs(a[1] - b[1]) > 0.001;
/** What the house canvas actually draws for one op, so the readout never
 *  promises geometry the DSL will quietly pull onto an axis. */
const drawn = (dsl: string): Subpath[] => {
  const result = run(`icon readback\nfinish outlined\n${dsl}`, [], {
    spec: SPEC,
  });
  const [element] = result.canvas.elements;
  if (result.errors.length > 0 || !element) {
    throw new Error(`${dsl}: ${result.errors.join("; ") || "drew nothing"}`);
  }
  return parsePath(element.d);
};
const sameBox = (a: readonly Subpath[], b: readonly Subpath[]) => {
  const x = bbox(a);
  const y = bbox(b);
  return !(
    moved([x.x0, x.y0], [y.x0, y.y0]) || moved([x.x1, x.y1], [y.x1, y.y1])
  );
};
const fmtPoint = ([x, y]: readonly [number, number]) => `${x},${y}`;

const offAxis = (
  a: readonly [number, number],
  b: readonly [number, number]
) => {
  const angle = Math.abs(
    (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI
  );
  return [0, 45, 90, 135, 180].every(
    (axis) => Math.abs(angle - axis) > ANGLE_TOLERANCE
  );
};

/** Four cubic quadrants whose on-path points sit one radius from a centre. */
const asCircle = (sp: Subpath) => {
  if (
    !(sp.closed && sp.segs.length >= 4 && sp.segs.every((s) => s.t === "C"))
  ) {
    return null;
  }
  const box = bbox([sp]);
  const r = box.w / 2;
  if (Math.abs(box.w - box.h) > 0.05) {
    return null;
  }
  const cx = box.x0 + r;
  const cy = box.y0 + r;
  const onRing = points(sp).every(
    ([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - r) < r * 0.6
  );
  return onRing ? { cx, cy, r } : null;
};

/** Read one library drawing's strokes back as DSL where the DSL can say them. */
const elementsOf = (svg: string): LibraryElement[] => {
  const elements: LibraryElement[] = [];
  for (const shape of parseIconSvg(svg)) {
    if (shape.strokeWidth === 0) {
      continue;
    }
    for (const sp of parsePath(shape.d)) {
      const box = bbox([sp]);
      const place = {
        h: q(box.h, GRID),
        w: q(box.w, GRID),
        x: q(box.x0, GRID),
        y: q(box.y0, GRID),
      };
      const ring = asCircle(sp);
      if (ring) {
        const dsl = `circle ${fmtPoint(snap([ring.cx, ring.cy]))} r${q(ring.r, GRID)}`;
        elements.push({
          ...place,
          dsl,
          kind: "circle",
          quantised: !sameBox(drawn(dsl), [sp]),
        });
        continue;
      }
      if (sp.segs.every((s) => s.t === "L")) {
        const raw = points(sp);
        if (sp.closed) {
          raw.push(sp.start);
        }
        const pts = raw.map(snap);
        const skew = pts.some((p, i) => i > 0 && offAxis(pts[i - 1], p));
        const dsl = `line ${pts.map(fmtPoint).join(" ")}${skew ? " off-axis" : ""}`;
        const ink = points(
          drawn(dsl)[0] ?? { closed: false, segs: [], start: [0, 0] }
        );
        elements.push({
          ...place,
          dsl,
          kind: "line",
          quantised:
            ink.length !== raw.length || ink.some((p, i) => moved(p, raw[i])),
        });
        continue;
      }
      elements.push({ ...place, dsl: null, kind: "curve", quantised: false });
    }
  }
  return elements.toSorted(
    (a, b) => a.w * a.h - b.w * b.h || a.y - b.y || a.x - b.x
  );
};

const cohortOf = (
  name: string,
  cohorts: Readonly<Record<string, readonly string[]>>
): string | null =>
  Object.entries(cohorts).find(([, members]) => members.includes(name))?.[0] ??
  null;

/** Rank every library drawing by how much it shares with the requested concept. */
export const librarySiblings = (
  concept: string,
  {
    finish = "outlined",
    library = BLODE_ICONS_PACKAGE,
    limit = 24,
  }: {
    finish?: "outlined" | "filled";
    library?: string;
    limit?: number;
  } = {}
): LibrarySiblingsResult => {
  const svgDirectory = path.join(library, "icons-svg");
  const dataDirectory = path.join(library, "icons-data");
  const cohorts = z
    .record(z.array(z.string()))
    .parse(
      JSON.parse(
        readFileSync(path.join(dataDirectory, "_cohorts.json"), "utf-8")
      )
    );
  const conceptTags = new Set(readTags(dataDirectory, concept));
  const conceptTokens = tokens(concept);
  const conceptCohort = cohortOf(concept, cohorts);
  const conceptFile = path.join(svgDirectory, `${concept}.svg`);
  const conceptHash = existsSync(conceptFile)
    ? sha256(readFileSync(conceptFile, "utf-8"))
    : null;
  const excluded: string[] = [];
  const siblings: LibrarySibling[] = [];
  for (const file of readdirSync(svgDirectory).toSorted()) {
    if (!/^[a-z][a-z0-9-]*\.svg$/u.test(file)) {
      continue;
    }
    const filled = file.endsWith("-filled.svg");
    if (filled !== (finish === "filled")) {
      continue;
    }
    const name = file.replace(/(?:-filled)?\.svg$/u, "");
    const svg = readFileSync(path.join(svgDirectory, file), "utf-8");
    if (
      name === concept ||
      sha256(svg) === conceptHash ||
      svg.includes('class="lucide')
    ) {
      excluded.push(file);
      continue;
    }
    const because = [
      ...readTags(dataDirectory, name)
        .filter((tag) => conceptTags.has(tag))
        .map((tag) => `tag:${tag}`),
      ...(conceptCohort !== null && cohortOf(name, cohorts) === conceptCohort
        ? [`cohort:${conceptCohort}`]
        : []),
      ...[...tokens(name)]
        .filter((token) => conceptTokens.has(token))
        .map((token) => `name:${token}`),
    ];
    if (because.length > 0) {
      siblings.push({
        because,
        elements: elementsOf(svg),
        name,
        score: because.length,
        svg,
      });
    }
  }
  siblings.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return {
    concept,
    conceptTags: [...conceptTags].toSorted(),
    excluded,
    finish,
    siblings: siblings.slice(0, limit),
  };
};

/** Write `siblings.json` and a `siblings.png` contact sheet into a new directory. */
export const writeLibrarySiblings = async (
  result: LibrarySiblingsResult,
  out: string
): Promise<void> => {
  if (existsSync(out)) {
    throw new Error(`Refusing to overwrite ${out}`);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(
    path.join(out, "siblings.json"),
    `${JSON.stringify(
      {
        ...result,
        siblings: result.siblings.map(({ svg, ...rest }) => ({
          ...rest,
          svgHash: sha256(svg),
        })),
      },
      null,
      2
    )}\n`
  );
  if (result.siblings.length > 0) {
    writeFileSync(
      path.join(out, "siblings.png"),
      await sheet(
        result.siblings.map((s) => s.svg),
        { cols: 6, size: 96 }
      )
    );
  }
};

if (process.argv[1]?.endsWith("library-siblings.ts")) {
  const [concept, out, finish] = process.argv.slice(2);
  if (!(concept && out)) {
    console.error(
      "Usage: library-siblings.ts <concept> <new-output-directory> [outlined|filled]"
    );
    process.exit(1);
  }
  const result = librarySiblings(concept, {
    finish: finish === "filled" ? "filled" : "outlined",
  });
  await writeLibrarySiblings(result, out);
  for (const sibling of result.siblings) {
    console.log(`${sibling.name}\t${sibling.because.join(" ")}`);
    if (sibling.elements.length === 0) {
      console.log("  (flattened fill path: read it from the sheet)");
    }
    for (const element of sibling.elements) {
      console.log(
        `  ${element.kind} ${element.w}x${element.h} at ${element.x},${element.y}${element.dsl ? `\t${element.dsl}` : ""}${element.quantised ? "\t(the canvas snaps this)" : ""}`
      );
    }
  }
  console.log(
    `${result.siblings.length} siblings for ${concept}; ${result.excluded.length} excluded; sheet at ${path.join(out, "siblings.png")}`
  );
}

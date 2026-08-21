/**
 * Self-improvement loop for both paints.
 *
 * Train on house files that already exist (blode/Central). For each slug:
 * compile the outlined file, compile the filled file as filled (two
 * reconstructions, not one skeleton re-painted), and score each against its
 * house original. A derived twin (`adaptProgram`) is the fallback when only
 * one paint is on disk — that is the net-new path.
 *
 *   npx tsx scripts/twin-eval.ts --house /tmp/eval-20/house --out .staging/twin-eval
 *
 * Exits 1 if any generated SVG is empty or the mean outlined cosine drops
 * below 0.99. Filled mean is reported against the 0.737 cross-set baseline.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { parseIconSvg } from "../src/corpus/load.js";
import { compilePaint } from "../src/pipeline/reconstruct.js";
import { run as runDsl } from "../src/tools/dsl.js";
import { cosine, inkVector, sheet } from "../src/tools/render.js";
import { adaptProgram } from "../src/tools/twin.js";

const emptySvg = (svg: string): boolean => !/<path\b/u.test(svg);

const pathsOf = (file: string): string[] =>
  parseIconSvg(readFileSync(file, "utf-8")).map((s) => s.d);

const scorePair = async (a: string, b: string): Promise<number> =>
  cosine(await inkVector(a), await inkVector(b));

export interface TwinRow {
  cosineFilled: number | null;
  cosineOutlined: number;
  emptyFilled: boolean;
  emptyOutlined: boolean;
  name: string;
  sourceFilled: "adapt" | "compile";
}

export const evaluateTwins = async (
  house: string,
  out: string,
  slugs?: readonly string[]
): Promise<TwinRow[]> => {
  const outlinedDir = path.join(house, "outlined");
  const filledDir = path.join(house, "filled");
  const names =
    slugs ??
    readdirSync(outlinedDir)
      .filter((f) => f.endsWith(".svg"))
      .map((f) => f.slice(0, -4))
      .toSorted();
  rmSync(out, { force: true, recursive: true });
  mkdirSync(out, { recursive: true });
  const rows: TwinRow[] = [];
  const tiles: string[] = [];
  for (const name of names) {
    const outlinedFile = path.join(outlinedDir, `${name}.svg`);
    const filledFile = path.join(filledDir, `${name}.svg`);
    const outlined = compilePaint(name, pathsOf(outlinedFile), "outlined");
    const outlinedSvg = outlined.program.canvas.toSVG();
    let filledSvg: string;
    let sourceFilled: "adapt" | "compile" = "adapt";
    if (existsSync(filledFile)) {
      const filled = compilePaint(
        `${name}-filled`,
        pathsOf(filledFile),
        "filled"
      );
      filledSvg = filled.program.canvas.toSVG();
      sourceFilled = "compile";
    } else {
      const adapted = adaptProgram(outlined.source, "filled");
      filledSvg = runDsl(adapted, outlined.extras).canvas.toSVG();
    }
    const houseOut = readFileSync(outlinedFile, "utf-8");
    const houseFill = existsSync(filledFile)
      ? readFileSync(filledFile, "utf-8")
      : null;
    const dir = path.join(out, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${name}.svg`), outlinedSvg);
    writeFileSync(path.join(dir, `${name}-filled.svg`), filledSvg);
    writeFileSync(path.join(dir, `${name}.house.svg`), houseOut);
    if (houseFill !== null) {
      writeFileSync(path.join(dir, `${name}-filled.house.svg`), houseFill);
    }
    // Sequential: a failure has to name the icon it happened on.
    // oxlint-disable-next-line no-await-in-loop
    const cosineOutlined = await scorePair(outlinedSvg, houseOut);
    const cosineFilled =
      // oxlint-disable-next-line no-await-in-loop
      houseFill === null ? null : await scorePair(filledSvg, houseFill);
    rows.push({
      cosineFilled,
      cosineOutlined,
      emptyFilled: emptySvg(filledSvg),
      emptyOutlined: emptySvg(outlinedSvg),
      name,
      sourceFilled,
    });
    tiles.push(outlinedSvg, houseOut, filledSvg, houseFill ?? outlinedSvg);
    process.stderr.write(
      `${name.padEnd(16)} out=${cosineOutlined.toFixed(3)} ` +
        `fill=${cosineFilled === null ? "n/a" : cosineFilled.toFixed(3)} ` +
        `${sourceFilled}${emptySvg(filledSvg) ? " EMPTY" : ""}\n`
    );
  }
  writeFileSync(
    path.join(out, "eval.json"),
    `${JSON.stringify(rows, null, 2)}\n`
  );
  writeFileSync(path.join(out, "contact.png"), await sheet(tiles, { cols: 4 }));
  return rows;
};

const mean = (xs: number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;

const flag = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

if (process.argv[1]?.endsWith("twin-eval.ts")) {
  const args = process.argv.slice(2);
  const house = flag(args, "--house");
  const out = flag(args, "--out") ?? path.join(".staging", "twin-eval");
  if (house === undefined) {
    process.stderr.write(
      "usage: npx tsx scripts/twin-eval.ts --house <dir> [--out <dir>]\n"
    );
    process.exit(2);
  }
  const rows = await evaluateTwins(house, out);
  const outlined = rows.map((r) => r.cosineOutlined);
  const filled = rows
    .map((r) => r.cosineFilled)
    .filter((n): n is number => n !== null);
  const empty = rows.filter((r) => r.emptyOutlined || r.emptyFilled);
  const filledBit =
    filled.length > 0 ? ` · filled ${mean(filled).toFixed(3)}` : "";
  process.stderr.write(
    `\n${rows.length} icons · outlined ${mean(outlined).toFixed(3)}${filledBit} · empty ${empty.length} · wrote ${out}\n`
  );
  if (empty.length > 0 || mean(outlined) < 0.99) {
    process.exitCode = 1;
  }
}

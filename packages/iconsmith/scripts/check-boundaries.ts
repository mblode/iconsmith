/**
 * Four architectural rules that a comment cannot hold.
 *
 * 1. LAYERING. The import graph is a DAG today — geometry ← parts ← tools ←
 *    pipeline ← commands — and stays one only if something checks. An inverted
 *    edge (parts reaching into tools, say) is invisible in review and expensive
 *    to unpick once three modules depend on it.
 *
 * 2. THE INVARIANT. No model ever emits a coordinate. The pipeline hands a model
 *    constrained primitives; if it could construct path data directly, style
 *    drift enters the set at the rate icons are generated, which is the exact
 *    failure this project exists to prevent. Prose in AGENTS.md decays under
 *    context pressure. An exit code does not.
 *
 * 3. LICENCE CONTAINMENT. Generated icons ship in blode-icons under MIT as the
 *    author's own work, so only the author's own icons — Central and
 *    blode-icons — may condition a generation. The 23,731 icons in
 *    `corpus/baselines.ts` are readable for concept coverage and eval
 *    baselines and for nothing else, so nothing under `pipeline/` may import
 *    that module. Eval baselines reach `pipeline/eval.ts` as data, injected
 *    from `commands/`; there is no import edge to be widened later.
 *
 * 4. NO VECTORISER IN THE PIPELINE. A raster tracer inside the generator is
 *    rule 2 with extra steps: it turns a picture into path data with no
 *    primitive in between, and the picture can be anything. Whatever a
 *    proposal wants a tracer for, it does not want it there.
 *
 * No dependencies: this is 100 lines of stdlib against rules no installed tool
 * expresses, which is the only reason it is hand-written rather than configured.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "../src");

/** Lower layers must not import higher ones. Index = depth. */
const LAYERS = ["geometry", "parts", "tools", "pipeline", "commands"];
const depth = (layer: string): number => LAYERS.indexOf(layer);

/** Raw path data must be authored by the canvas, never assembled downstream. */
const RAW_GEOMETRY = /\bd\s*[:=]\s*[`"']\s*M[\s\d.-]/iu;

/** Every import specifier: static `from "x"` and dynamic `import("x")`. The
 *  layering check above reads only the relative ones; rules 3 and 4 need the
 *  bare ones too, since a tracer arrives as a package name. */
const IMPORT = /(?:from\s+|import\s*\(\s*)"(?<spec>[^"]+)"/gu;
/** The baselines loader, by whatever relative path it is reached. */
const BASELINES = /(?:^|\/)corpus\/baselines(?:\.js)?$/u;
/** The raster tracers. A named list, not a heuristic: there are five worth
 *  naming and a heuristic over package names would fire on innocent ones. */
const VECTORISER = /potrace|imagetracer|vtracer|svg-trace|opencv/iu;

const failures: string[] = [];

/**
 * Rules 3 and 4, which are about one layer only. Tests are not exempt: a test
 * that imports the baselines into the pipeline is the leak, not a rehearsal of
 * it.
 */
const checkPipelineImports = (file: string, rel: string, src: string): void => {
  for (const m of src.matchAll(IMPORT)) {
    const spec = m.groups?.spec ?? "";
    const resolved = spec.startsWith(".")
      ? path
          .relative(SRC, path.resolve(path.dirname(file), spec))
          .split(path.sep)
          .join("/")
      : spec;
    if (BASELINES.test(resolved)) {
      failures.push(
        `${rel}: imports corpus/baselines.\n` +
          "  Those 23,731 icons are third-party. They may be analysed and used as eval\n" +
          "  baselines; they may never condition a generation, and a generated icon\n" +
          "  ships under MIT carrying no per-icon notice. Load them in commands/ and\n" +
          "  pass what you need in as data."
      );
    }
    if (VECTORISER.test(spec)) {
      failures.push(
        `${rel}: imports the vectoriser "${spec}".\n` +
          "  Tracing a raster puts path data into the pipeline with no primitive in\n" +
          "  between, which is the invariant this project exists to hold. Trace outside\n" +
          "  the pipeline and bring the result back through the canvas."
      );
    }
  }
};

const check = (file: string): void => {
  const rel = path.relative(SRC, file);
  const layer = rel.includes(path.sep) ? rel.split(path.sep)[0] : null;
  const src = fs.readFileSync(file, "utf-8");
  const isTest = file.endsWith(".test.ts");

  for (const m of src.matchAll(/from\s+"(?<spec>\.\.?\/[^"]+)"/gu)) {
    const target = path.relative(
      SRC,
      path.resolve(path.dirname(file), m.groups?.spec ?? "")
    );
    const targetLayer = target.includes(path.sep)
      ? target.split(path.sep)[0]
      : null;
    if (!(layer && targetLayer) || layer === targetLayer) {
      continue;
    }
    if (depth(layer) === -1 || depth(targetLayer) === -1) {
      continue;
    }
    if (depth(targetLayer) > depth(layer)) {
      failures.push(
        `${rel}: ${layer}/ imports ${targetLayer}/, inverting the layer order.\n` +
          `  Allowed: ${LAYERS.join(" ← ")}\n` +
          `  Fix: move the shared piece down to a lower layer, or invert the dependency.`
      );
    }
  }

  if (layer === "pipeline") {
    checkPipelineImports(file, rel, src);
  }

  // Tests legitimately author path data as fixtures; source outside the canvas
  // and its corpus reader does not.
  //
  // `parts/vocabulary.ts` is the third case: its drawings are not authored,
  // they are the canonical members of measured clusters, copied out of an
  // extraction so a name can be checked against the mark it names. Nothing
  // renders them — they exist to be fingerprinted and matched — so no
  // geometry reaches an icon through this file.
  const mayAuthorGeometry =
    isTest ||
    rel.startsWith(`tools${path.sep}canvas`) ||
    rel === `parts${path.sep}vocabulary.ts` ||
    rel.startsWith("corpus");
  if (!mayAuthorGeometry && RAW_GEOMETRY.test(src)) {
    failures.push(
      `${rel}: constructs raw path data.\n` +
        "  Geometry is authored by the canvas primitives, which quantise, snap angles\n" +
        "  and tier radii, so off-spec output is unrepresentable. Call those instead."
    );
  }
};

const walk = (dir: string): void => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith(".ts")) {
      check(full);
    }
  }
};

walk(SRC);
if (failures.length > 0) {
  process.stderr.write(
    `${failures.join("\n\n")}\n\n${failures.length} boundary violation(s).\n`
  );
  process.exit(1);
}
process.stdout.write(`boundaries ok — ${LAYERS.join(" ← ")}\n`);

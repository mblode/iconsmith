/**
 * Two architectural rules that a comment cannot hold.
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
 * No dependencies: this is 60 lines of stdlib against a rule no installed tool
 * expresses, which is the only reason it is hand-written rather than configured.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "../src");

/** Lower layers must not import higher ones. Index = depth. */
const LAYERS = ["geometry", "parts", "tools", "pipeline", "commands"];
const depth = (layer) => LAYERS.indexOf(layer);

/** Raw path data must be authored by the canvas, never assembled downstream. */
const RAW_GEOMETRY = /\bd\s*[:=]\s*[`"']\s*M[\s\d.-]/i;

const failures = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".ts")) check(full);
  }
};

function check(file) {
  const rel = path.relative(SRC, file);
  const layer = rel.includes(path.sep) ? rel.split(path.sep)[0] : null;
  const src = fs.readFileSync(file, "utf8");
  const isTest = file.endsWith(".test.ts");

  for (const m of src.matchAll(/from\s+"(\.\.?\/[^"]+)"/g)) {
    const target = path.relative(SRC, path.resolve(path.dirname(file), m[1]));
    const targetLayer = target.includes(path.sep) ? target.split(path.sep)[0] : null;
    if (!(layer && targetLayer) || layer === targetLayer) continue;
    if (depth(layer) === -1 || depth(targetLayer) === -1) continue;
    if (depth(targetLayer) > depth(layer)) {
      failures.push(
        `${rel}: ${layer}/ imports ${targetLayer}/, inverting the layer order.\n` +
          `  Allowed: ${LAYERS.join(" ← ")}\n` +
          `  Fix: move the shared piece down to a lower layer, or invert the dependency.`
      );
    }
  }

  // Tests legitimately author path data as fixtures; source outside the canvas
  // and its corpus reader does not.
  const mayAuthorGeometry =
    isTest || rel.startsWith(`tools${path.sep}canvas`) || rel.startsWith("corpus");
  if (!mayAuthorGeometry && RAW_GEOMETRY.test(src)) {
    failures.push(
      `${rel}: constructs raw path data.\n` +
        "  Geometry is authored by the canvas primitives, which quantise, snap angles\n" +
        "  and tier radii, so off-spec output is unrepresentable. Call those instead."
    );
  }
}

walk(SRC);
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n\n")}\n\n${failures.length} boundary violation(s).\n`);
  process.exit(1);
}
process.stdout.write(`boundaries ok — ${LAYERS.join(" ← ")}\n`);

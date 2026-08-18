/** Public API. CLI-only concerns stay in cli.ts so this can also back an MCP server. */
export { bbox, parsePath, q, serialise, translate } from "./geometry/path.js";
export { extractParts, writeParts } from "./parts/extract.js";
export { distance, fingerprint } from "./parts/shape.js";
export {
  BASELINE,
  evaluate,
  formatReport,
  loadIconSet,
} from "./pipeline/eval.js";
export {
  DEFAULT_MODEL,
  generate,
  MissingApiKeyError,
} from "./pipeline/generate.js";
export { Canvas, SPEC } from "./tools/canvas.js";
export { run as runDsl } from "./tools/dsl.js";
export { format as formatIssues, lint } from "./tools/lint.js";
export { cosine, inkVector, png, sheet, similarity } from "./tools/render.js";
export type {
  Box,
  DotRole,
  DrawOp,
  Fingerprint,
  IconDoc,
  Issue,
  Keyline,
  Part,
  Provenance,
  Segment,
  Severity,
  Subpath,
} from "./types.js";

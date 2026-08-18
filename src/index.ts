/** Public API. CLI-only concerns stay in cli.ts so this can also back an MCP server. */
export { auditIcon, freeformShare, onAxisShare } from "./corpus/audit.js";
export { census, nameElement } from "./corpus/census.js";
export {
  HOUSE_VARIANT,
  loadCorpus,
  parseIconSvg,
  parseVariantKey,
  sampleSymbols,
  variantKey,
} from "./corpus/load.js";
export {
  circleRadius,
  cornerRadii,
  flaggedBy,
  histogram,
  measureIcon,
  measureVariant,
  summarise,
  visualExtent,
} from "./corpus/measure.js";
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
export {
  buildCohorts,
  cohortOf,
  COHORT_TOLERANCE,
  drift,
  inferCohort,
  measure,
  splits,
  verdict,
} from "./tools/cohort.js";
export { run as runDsl } from "./tools/dsl.js";
export { format as formatIssues, lint } from "./tools/lint.js";
export { cosine, inkVector, png, sheet, similarity } from "./tools/render.js";
export type {
  CensusReport,
  ElementInstance,
  RecurringElement,
} from "./corpus/census.js";
export type {
  CurveAudit,
  CurveClass,
  EdgeAudit,
  IconAudit,
} from "./corpus/audit.js";
export type {
  Corpus,
  CorpusIcon,
  CorpusShape,
  Variant,
} from "./corpus/load.js";
export type {
  Corner,
  Distribution,
  IconMeasurement,
  VariantMeasurement,
} from "./corpus/measure.js";
export type {
  Axis,
  Cohort,
  CohortAxis,
  CohortGroup,
  CohortManifest,
  CohortMember,
  CohortView,
} from "./tools/cohort.js";
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

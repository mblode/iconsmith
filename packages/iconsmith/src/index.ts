/** Public API. CLI-only concerns stay in cli.ts so this can also back an MCP server. */
export { auditIcon, freeformShare, onAxisShare } from "./corpus/audit.js";
export { buildCorpus, checkCorpus, corpusStats } from "./corpus/build.js";
export { census, nameElement } from "./corpus/census.js";
export {
  assignRoles,
  coverageOf,
  coveragePair,
  duplicateConcepts,
  headOf,
  houseVocabulary,
  isInformative,
  proposeConcepts,
  rankGaps,
  rejectionOf,
  slugifyTag,
  unnumbered,
} from "./corpus/concepts.js";
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
export {
  buildRecord,
  measureRendering,
  RECORD_SCHEMA_VERSION,
  stableStringify,
} from "./corpus/record.js";
export { availableSources, SOURCES } from "./corpus/sources.js";
export { bbox, parsePath, q, serialise, translate } from "./geometry/path.js";
export { extractParts, writeParts } from "./parts/extract.js";
export { distance, fingerprint } from "./parts/shape.js";
export { NAME_THRESHOLD, nameParts, VOCABULARY } from "./parts/vocabulary.js";
export { formatStaged, scoresOf, twoStage } from "./pipeline/accept.js";
export type {
  Judge,
  Stage,
  StagedVerdict,
  StageOptions,
  Verdictish,
} from "./pipeline/accept.js";
export {
  BENCH_SIZE,
  benchmarkExclusions,
  conceptClosure,
  closureSlugs,
  entriesOf,
  loadBenchmark,
  loadRecords,
  redactParts,
  selectBenchmark,
  SPLIT_SIZES,
  SPLITS,
  strataCounts,
} from "./pipeline/bench.js";
// The raster arm. `compose` is the seam the whole arm turns on: it is the only
// route from an image model into the pipeline, and it emits words.
export {
  assertNoGeometry,
  compose,
  describeProposal,
  READER_MODEL,
} from "./pipeline/compose.js";
export { RATES, rateFor, reachPoints, usdOf } from "./pipeline/cost.js";
export { critique } from "./pipeline/critique.js";
export {
  assertNoFilledTwin,
  BASELINE,
  evaluate,
  evaluateSeeds,
  formatReport,
  formatSpread,
  loadIconSet,
  scored,
} from "./pipeline/eval.js";
export {
  DEFAULT_MODEL,
  generate,
  MissingApiKeyError,
} from "./pipeline/generate.js";
// The gate, exported so a caller outside the package builds references the same
// way this one does. `asReference` is the sole constructor of `Reference`; there
// is no route around it from out here either.
export { asReference, asReferences, LicenceError } from "./pipeline/licence.js";
export {
  IDEATION_MODEL,
  IMAGE_RATES,
  propose,
  proposalArm,
  ProposalError,
  QUALITY_MODEL,
} from "./pipeline/propose.js";
export { referenceSet, SLOTS } from "./pipeline/references.js";
export { Canvas, SPEC } from "./tools/canvas.js";
export {
  buildCohorts,
  canonicalExtent,
  cohortOf,
  COHORT_TOLERANCE,
  drift,
  findCohort,
  inferCohort,
  measure,
  splits,
  verdict,
} from "./tools/cohort.js";
export { run as runDsl } from "./tools/dsl.js";
export {
  CONFORMANCE,
  clusterExtents,
  conformance,
  KEYLINES,
  measureKeyline,
  nearestKeyline,
  // `measure.ts` already owns the name. This one grows each piece by its *own*
  // stroke rather than the set's widest, which is the only correct reading for
  // an icon that mixes filled and stroked shapes — 303 of the corpus do.
  visualExtent as pieceVisualExtent,
} from "./tools/keyline.js";
export {
  band,
  bandSensitivity,
  CUT_24_TO_16,
  DEFAULT_THRESHOLDS,
  inkBox,
  measureLegibility,
  parsePieces,
} from "./tools/legibility.js";
export { format as formatIssues, lint } from "./tools/lint.js";
export { cosine, inkVector, png, sheet, similarity } from "./tools/render.js";
export { isSlashName, slashRule } from "./tools/slash.js";
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
  BuildOptions,
  BuildReport,
  CheckReport,
  Manifest,
  SourceReport,
  StatsReport,
} from "./corpus/build.js";
export type {
  ConceptConflict,
  ConceptCoverage,
  ConceptDuplicate,
  ConceptIcon,
  ConceptProposal,
  ConceptRole,
  ConceptSource,
  CoveragePair,
  GapEntry,
  GapOptions,
  ProposalReport,
  ProposeOptions,
  RejectedProposal,
  RejectionReason,
  RoleAssignment,
} from "./corpus/concepts.js";
export type {
  Corpus,
  CorpusIcon,
  CorpusShape,
  Variant,
} from "./corpus/load.js";
export type {
  IconRecord,
  RecordProvenance,
  Rendering,
  Usage,
  VectorRef,
} from "./corpus/record.js";
export type { Source, SourceFile } from "./corpus/sources.js";
export type {
  Benchmark,
  BenchmarkEntry,
  Split,
  Strata,
} from "./pipeline/bench.js";
export type { Rate, RateTable, TokenUsage } from "./pipeline/cost.js";
export type {
  ConditioningProvenance,
  CostReport,
  EvalIcon,
  EvalOptions,
  EvalReport,
  IconFailed,
  IconMeasured,
  IconScore,
  SpreadReport,
} from "./pipeline/eval.js";
export type {
  Cell,
  Proposal,
  ProposalBlock,
  ShapeWord,
  SizeBand,
} from "./pipeline/compose.js";
export type { Licensed, Reference, ReferenceIcon } from "./pipeline/licence.js";
export type { CohortBrief, Concept } from "./pipeline/prompt.js";
export type {
  ArmOptions,
  GenerateLike,
  ProposalOptions,
  ProposalRun,
} from "./pipeline/propose.js";
export type {
  ReferenceOptions,
  ReferenceSlots,
} from "./pipeline/references.js";
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
  CohortTarget,
  CohortView,
} from "./tools/cohort.js";
export type {
  Conformance,
  KeylineMetrics,
  KeylineOptions,
} from "./tools/keyline.js";
export type {
  Band,
  CutSpec,
  LegibilityMetrics,
  MeasureOptions,
  Piece,
  Thresholds,
  Verdict,
} from "./tools/legibility.js";
export type { SlashOptions, SlashTarget } from "./tools/slash.js";
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

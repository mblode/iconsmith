/**
 * The API the rest of the repo uses.
 *
 * This was 403 names, sized for an npm package and, per its old header, for
 * "an MCP server" that was never written. The package is private now and has
 * five importers in the whole repo; they use 33 names between them. What is
 * gone was not deleted for being wrong, it was deleted for being a front door
 * onto rooms nobody enters -- `dist/index.d.ts` was 4,459 lines of surface an
 * agent had to read past to find the six functions that matter.
 *
 * Everything still exists. Internal code imports it by relative path, which is
 * what `commands/`, `eval/` and the scripts already do. If a new consumer needs
 * a name, re-export it here and it is one line.
 */
export { parseIconSvg } from "./corpus/load.js";
export { bbox, parsePath, serialise } from "./geometry/path.js";
export { nameParts } from "./parts/vocabulary.js";
export { analogArm } from "./pipeline/analog.js";
export { gatewayAsk } from "./pipeline/audit.js";
export type { AuditResult } from "./pipeline/audit.js";
export { compose, describeProposal } from "./pipeline/compose.js";
export { exceedsCostBudget, totalUsd } from "./pipeline/cost.js";
export type { ApiCost } from "./pipeline/cost.js";
export { generate } from "./pipeline/generate.js";
export { harnessArm } from "./pipeline/harness.js";
export { asReferences } from "./pipeline/licence.js";
export type { Reference } from "./pipeline/licence.js";
export { EXPERT_IDS } from "./pipeline/mixture.js";
export type { ExpertId } from "./pipeline/mixture.js";
export { gatewayHarnessSpawn } from "./pipeline/model-harness.js";
export type { Concept } from "./pipeline/prompt.js";
export { QUALITY_MODEL, propose } from "./pipeline/propose.js";
export { compileArm } from "./pipeline/reconstruct.js";
export { referenceSet } from "./pipeline/references.js";
export {
  rankPairCandidates,
  runPairTournament,
} from "./pipeline/tournament.js";
export type { PairCandidate, TournamentRun } from "./pipeline/tournament.js";
export { SPEC } from "./tools/canvas.js";
export { png } from "./tools/render.js";
export type { Part, Provenance } from "./types.js";

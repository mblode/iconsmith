import { z } from "zod";

export const studioFinishSchema = z.enum(["outlined", "filled"]);
export type StudioFinish = z.infer<typeof studioFinishSchema>;

/**
 * A request for restraint, never an authorisation.
 *
 * `generateStudioResponse` clamps this to the server-owned ceiling with
 * `Math.min`, so a value larger than the default buys nothing. The caps here
 * stay generous because the field is only ever narrowing.
 */
export const studioBudgetSchema = z.object({
  maxCalls: z.number().int().positive().max(200),
  maxUsd: z.number().positive().max(100),
});

export const studioAttachmentSchema = z.object({
  dataUrl: z.string().max(2_100_000).optional(),
  kind: z.enum(["image", "svg", "file", "library"]),
  name: z.string().min(1).max(240),
  size: z.number().int().nonnegative().max(1_500_000),
  source: z.string().max(500).optional(),
  text: z.string().max(30_000).optional(),
  type: z.string().max(160),
});
export type StudioAttachment = z.infer<typeof studioAttachmentSchema>;

export const studioAnnotationSchema = z.object({
  id: z.string().min(1).max(160),
  text: z.string().max(2000),
  versionId: z.string().min(1).max(240),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
});
export type StudioAnnotation = z.infer<typeof studioAnnotationSchema>;

export interface StudioLibraryResult {
  readonly dataUrl: string;
  readonly id: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly name: string;
  readonly source: string;
  readonly sourceUrl: string;
}

export interface StudioLibraryResponse {
  readonly degraded?: boolean;
  readonly results: readonly StudioLibraryResult[];
}

export const studioIssueSchema = z.object({
  declared: z.string().optional(),
  message: z.string(),
  rule: z.string(),
  severity: z.enum(["error", "warn"]),
});
export type StudioIssue = z.infer<typeof studioIssueSchema>;

export const studioExpertSchema = z.enum(["agent", "analog", "compile", "glyph", "mark"]);
export type StudioExpert = z.infer<typeof studioExpertSchema>;

export const studioAgentRunSchema = z.object({
  attempted: z.array(studioExpertSchema),
  findings: z.array(z.object({ kind: z.string(), message: z.string() })),
  mode: z.enum(["draw-and-review", "review"]),
  ok: z.boolean(),
  pq: z.number(),
  reason: z.string().nullable(),
  sc: z.number(),
  scorable: z.boolean(),
  selected: studioExpertSchema,
});
export type StudioAgentRun = z.infer<typeof studioAgentRunSchema>;

export const studioTokenUsageSchema = z.object({
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
});

export const studioApiCostRecordSchema = z.object({
  calls: z.number().int().nonnegative(),
  generationIds: z.array(z.string()),
  model: z.string(),
  operation: z.string(),
  source: z.enum(["fixed", "gateway", "rate-table", "unpriced"]),
  usage: studioTokenUsageSchema,
  usd: z.number().nonnegative().nullable(),
});

export const studioGenerationCostSchema = z.object({
  finishReason: z.string(),
  ms: z.number().nonnegative(),
  outcome: z.enum(["budget", "clean", "converged", "stalled"]),
  toolCalls: z.record(z.string(), z.number().int().nonnegative()),
  usage: studioTokenUsageSchema,
});

export const studioTournamentPaintSchema = z.object({
  accepted: z.boolean(),
  apiCosts: z.array(studioApiCostRecordSchema),
  brief: z.string().nullable(),
  clean: z.boolean(),
  document: z.unknown(),
  findings: z.array(z.object({ kind: z.string(), message: z.string() })),
  finish: studioFinishSchema,
  generation: studioGenerationCostSchema.nullable(),
  issues: z.array(studioIssueSchema),
  pq: z.number(),
  program: z.string().nullable(),
  programComplete: z.boolean(),
  reason: z.string().nullable(),
  sc: z.number(),
  scorable: z.boolean(),
  steps: z.number().int().nonnegative(),
  svg: z.string(),
  text: z.string(),
  trace: z.array(z.string()),
});

export const studioCostRecordSchema = studioApiCostRecordSchema;

export const studioCostSummarySchema = z.object({
  calls: z.number().int().nonnegative(),
  records: z.array(studioCostRecordSchema),
  totalUsd: z.number().nonnegative().nullable(),
  unpricedCalls: z.number().int().nonnegative(),
});

export const studioTournamentCandidateSchema = z.object({
  accepted: z.boolean(),
  cost: studioCostSummarySchema,
  failure: z.string().nullable(),
  id: z.string(),
  label: z.string(),
  paints: z.array(studioTournamentPaintSchema),
  score: z.number(),
});

export const studioTournamentSchema = z.object({
  candidates: z.array(studioTournamentCandidateSchema),
  cost: studioCostSummarySchema,
  minimum: z.object({ pq: z.number(), sc: z.number() }),
  proposal: z
    .object({
      chosen: z.number().int().nonnegative(),
      cost: studioCostSummarySchema,
      images: z.number().int().positive(),
      models: z.array(z.string()),
      /** The sketches themselves, base64 PNG, in `models` order. They cost
       *  $0.03-$0.15 each and were being discarded, which left no way to tell
       *  a failure caused by a bad reference from one caused by a bad draw.
       *  96px thumbnails, so three of them are a few kilobytes. */
      previews: z.array(z.string()).default([]),
      reason: z.string().nullable(),
      references: z.array(z.string()),
    })
    .nullable(),
  proposalFailure: z.string().nullable(),
  ranking: z.object({ order: z.array(z.string()), reason: z.string().nullable() }).nullable(),
  selected: z.string(),
  strategy: z.object({
    budget: z
      .object({
        actualCalls: z.number().int().nonnegative(),
        actualUsd: z.number().nonnegative().nullable(),
        exhausted: z.boolean(),
        maxCalls: z.number().int().nonnegative(),
        maxUsd: z.number().nonnegative(),
        overrun: z.boolean(),
        reservedCalls: z.number().int().nonnegative(),
        reservedUsd: z.number().nonnegative(),
      })
      .nullable(),
    eligible: z.number().int().nonnegative(),
    evaluated: z.number().int().nonnegative(),
    /** An arm threw and stopped the escalation. Defaulted, so a record written
     *  before this field existed still parses. */
    haltedByFailure: z.boolean().default(false),
    stopScore: z.number().nullable(),
    stoppedEarly: z.boolean(),
    /** Arms the budget refused before they drew anything. `stoppedEarly` is
     *  true whether a tournament stopped because it won or because it ran out
     *  of money; this is what tells the two apart in the record. */
    unaffordable: z.array(z.string()).default([]),
  }),
});
export type StudioTournament = z.infer<typeof studioTournamentSchema>;

export const studioVersionSchema = z.object({
  agent: studioAgentRunSchema,
  batchId: z.string(),
  brief: z.string(),
  clean: z.boolean(),
  document: z.unknown(),
  finish: studioFinishSchema,
  id: z.string(),
  issues: z.array(studioIssueSchema),
  name: z.string(),
  program: z.string(),
  programComplete: z.boolean(),
  steps: z.number().int().nonnegative(),
  svg: z.string(),
  trace: z.array(z.string()),
});
export type StudioVersion = z.infer<typeof studioVersionSchema>;

export const studioQuestionSchema = z.object({
  choices: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  description: z.string().optional(),
  freeform: z.boolean().optional(),
  id: z.string(),
  multiple: z.boolean().optional(),
  optional: z.boolean().optional(),
  title: z.string(),
});
export type StudioQuestion = z.infer<typeof studioQuestionSchema>;

/** One questionnaire answer: a freeform string, or the values of a multiple
 *  choice. Bounded on both axes because the record it used to sit in bounded
 *  neither, and `conceptOf` spreads the `notes` answer into `tags` a word at a
 *  time. */
const studioAnswerSchema = z.union([z.string().max(2000), z.array(z.string().max(2000)).max(12)]);

export const studioRequestSchema = z.object({
  annotations: z.array(studioAnnotationSchema).max(100).optional(),
  /**
   * The three ids `CLARIFY` asks about, not an open record.
   *
   * This was `z.record(z.string(), …)`, which accepted any number of keys of
   * any size. `object`, `finish` and `notes` (`CLARIFY` in `generate.ts`) are
   * the only ones anything reads — `conceptOf` reads all three and
   * `generateStudioResponse` reads `object` again.
   *
   * Unknown ids are stripped rather than rejected. A question added to
   * `CLARIFY` before this list catches up would otherwise fail the whole
   * request and reach the user as the generic invalid-request banner, losing
   * the draw over an answer that has no reader either way.
   */
  answers: z
    .object({
      finish: studioAnswerSchema.optional(),
      notes: studioAnswerSchema.optional(),
      object: studioAnswerSchema.optional(),
    })
    .optional(),
  attachments: z.array(studioAttachmentSchema).max(4).optional(),
  budget: studioBudgetSchema.optional(),
  finish: studioFinishSchema.optional(),
  lastName: z.string().max(240).optional(),
  text: z.string().trim().min(1).max(2000),
});
export type StudioRequest = z.infer<typeof studioRequestSchema>;

export const studioResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("error"),
    text: z.string(),
    tournament: studioTournamentSchema.optional(),
  }),
  z.object({
    items: z.array(studioQuestionSchema),
    kind: z.literal("questions"),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("drawn"),
    text: z.string(),
    tournament: studioTournamentSchema,
    versions: z.array(studioVersionSchema),
  }),
]);
export type StudioResponse = z.infer<typeof studioResponseSchema>;

export const studioActivitySchema = z.object({
  detail: z.string().optional(),
  id: z.string(),
  label: z.string(),
  state: z.enum(["active", "complete", "failed"]),
});
export type StudioActivity = z.infer<typeof studioActivitySchema>;

/**
 * A progress snapshot yielded mid-tool-call, not a delta.
 *
 * eve publishes every non-final `yield` from a tool as an `action.partial`
 * stream event, and its contract is explicit that those are "last-write-wins by
 * tool call id, not append-only progress", because the durable runtime can
 * retry a step and replay overlapping snapshots. So this carries the complete
 * activity list every time and the client replaces rather than appends — which
 * makes a replayed snapshot idempotent by construction, rather than the second
 * copy of a row that a replay used to produce.
 */
export const studioProgressSchema = z.object({
  activities: z.array(studioActivitySchema).readonly(),
  kind: z.literal("progress"),
});
export type StudioProgress = z.infer<typeof studioProgressSchema>;

/**
 * Everything `generate_icon_pair` yields, which is what its `outputSchema` has
 * to describe.
 *
 * eve's contract says an `outputSchema` is used to "infer and check the
 * executor return type", and a generator tool's executor yields more than its
 * result: every non-final `yield` is a `StudioProgress` snapshot published as
 * an `action.partial`. Declaring only {@link studioResponseSchema} would type
 * the tool honestly and then reject each of those at runtime, turning a working
 * progress stream into a failing one. So the schema is the union, which is also
 * the exact signature `toModelOutput` already carries.
 *
 * It lives in the contract rather than beside the tool because the client reads
 * the same union off the action stream: `action.partial` carries the progress
 * arm, `action.result` the response arm.
 */
export const studioToolOutputSchema = z.union([studioProgressSchema, studioResponseSchema]);
export type StudioToolOutput = z.infer<typeof studioToolOutputSchema>;

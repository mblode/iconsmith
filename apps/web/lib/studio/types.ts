import { z } from "zod";

export const studioFinishSchema = z.enum(["outlined", "filled"]);
export type StudioFinish = z.infer<typeof studioFinishSchema>;

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

export const studioTournamentPaintSchema = z.object({
  accepted: z.boolean(),
  clean: z.boolean(),
  findings: z.array(z.object({ kind: z.string(), message: z.string() })),
  finish: studioFinishSchema,
  pq: z.number(),
  reason: z.string().nullable(),
  sc: z.number(),
  scorable: z.boolean(),
  svg: z.string(),
});

export const studioCostRecordSchema = z.object({
  calls: z.number().int().nonnegative(),
  model: z.string(),
  operation: z.string(),
  source: z.enum(["fixed", "gateway", "rate-table", "unpriced"]),
  usd: z.number().nonnegative().nullable(),
});

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
      reason: z.string().nullable(),
      references: z.array(z.string()),
    })
    .nullable(),
  proposalFailure: z.string().nullable(),
  ranking: z.object({ order: z.array(z.string()), reason: z.string().nullable() }).nullable(),
  selected: z.string(),
  strategy: z.object({
    eligible: z.number().int().nonnegative(),
    evaluated: z.number().int().nonnegative(),
    stopScore: z.number().nullable(),
    stoppedEarly: z.boolean(),
  }),
});
export type StudioTournament = z.infer<typeof studioTournamentSchema>;

export const studioVersionSchema = z.object({
  agent: studioAgentRunSchema,
  batchId: z.string(),
  brief: z.string(),
  clean: z.boolean(),
  finish: studioFinishSchema,
  id: z.string(),
  issues: z.array(studioIssueSchema),
  name: z.string(),
  program: z.string(),
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

export const studioApprovalSchema = z.object({
  body: z.string(),
  id: z.string(),
  title: z.string(),
});
export type StudioApproval = z.infer<typeof studioApprovalSchema>;

export const studioRequestSchema = z.object({
  annotations: z.array(studioAnnotationSchema).max(100).optional(),
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  approved: z.boolean().optional(),
  attachments: z.array(studioAttachmentSchema).max(4).optional(),
  finish: studioFinishSchema.optional(),
  lastName: z.string().max(240).optional(),
  pending: z.enum(["questions", "approval"]).optional(),
  text: z.string().trim().min(1).max(2000),
});
export type StudioRequest = z.infer<typeof studioRequestSchema>;

export const studioResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    approval: studioApprovalSchema,
    kind: z.literal("approval"),
    text: z.string(),
  }),
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

export interface StudioActivity {
  readonly detail?: string;
  readonly id: string;
  readonly label: string;
  readonly state: "active" | "complete" | "failed";
}

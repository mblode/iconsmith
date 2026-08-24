import campaign from "../campaign.json";

/**
 * The durable campaign, read as data.
 *
 * `backlog.mjs` already creates one eve session per concept and records its id
 * here, and the studio can now resume any session by id. So a backlog item is
 * not a link to a file listing: it is a conversation that already happened,
 * with its tournament, its scores and its rejection reasons intact.
 *
 * Read-only. Vercel's filesystem is read-only and the publish target is a
 * sibling repo, so generating attempts and approving them stay with
 * `backlog.mjs` locally. That the approval gate is a deliberate act on one
 * machine is the workbench's own design, not a limitation routed around.
 *
 * `lib/campaign.json` is a generated projection of the workbench's own file,
 * committed for the reason `vocabulary.json` is: a relative path into
 * `packages/` works in dev and breaks on Vercel. Re-run
 * `node scripts/campaign-data.mjs` when the campaign moves.
 */

export type CampaignStatus =
  | "approved"
  | "blocked"
  | "exploring"
  | "published"
  | "revision"
  | "todo"
  | "wont-do";

export interface CampaignItem {
  readonly attemptCount: number;
  readonly confidence: string;
  readonly id: string;
  /** The durable eve session the workbench drew this in, when it has drawn. */
  readonly lastSessionId: string | null;
  readonly rank: number;
  readonly risk: string | null;
  readonly slug: string;
  readonly sources: readonly string[];
  readonly status: CampaignStatus;
}

export interface Campaign {
  readonly id: string;
  readonly items: readonly CampaignItem[];
  /** Concepts the campaign explicitly stopped pursuing, with the reason. */
  readonly retired: readonly CampaignItem[];
  readonly target: string;
}

const asItem = (row: Record<string, unknown>): CampaignItem => ({
  attemptCount: typeof row.attemptCount === "number" ? row.attemptCount : 0,
  confidence: typeof row.confidence === "string" ? row.confidence : "unknown",
  id: String(row.id),
  lastSessionId: typeof row.lastSessionId === "string" ? row.lastSessionId : null,
  rank: typeof row.rank === "number" ? row.rank : 0,
  risk: typeof row.risk === "string" ? row.risk : null,
  slug: String(row.slug),
  sources: Array.isArray(row.sources) ? row.sources.map(String) : [],
  status: String(row.status) as CampaignStatus,
});

const rows = (value: unknown): CampaignItem[] =>
  Array.isArray(value) ? value.map((row) => asItem(row as Record<string, unknown>)) : [];

export const loadCampaign = (): Campaign => ({
  id: String(campaign.id),
  items: rows(campaign.items),
  retired: rows((campaign as { retired?: unknown }).retired),
  target: String(campaign.target),
});

/** Only a concept the workbench actually drew can be reopened in the studio. */
export const isResumable = (item: CampaignItem): boolean =>
  item.lastSessionId !== null && item.attemptCount > 0;

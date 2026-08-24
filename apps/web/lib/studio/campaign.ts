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
  readonly id: string;
  /** The durable eve session the workbench drew this in, when it has drawn. */
  readonly lastSessionId: string | null;
  readonly rank: number;
  /** Whether the concept needs a semantic call, not the note itself. */
  readonly risky: boolean;
  readonly slug: string;
  readonly sources: readonly string[];
  readonly status: CampaignStatus;
}

const asItem = (row: Record<string, unknown>): CampaignItem => ({
  attemptCount: typeof row.attemptCount === "number" ? row.attemptCount : 0,
  id: String(row.id),
  lastSessionId: typeof row.lastSessionId === "string" ? row.lastSessionId : null,
  rank: typeof row.rank === "number" ? row.rank : 0,
  risky: row.risky === true,
  slug: String(row.slug),
  sources: Array.isArray(row.sources) ? row.sources.map(String) : [],
  status: String(row.status) as CampaignStatus,
});

export const loadCampaign = (): CampaignItem[] =>
  Array.isArray(campaign.items)
    ? campaign.items.map((row) => asItem(row as Record<string, unknown>))
    : [];

/** Only a concept the workbench actually drew can be reopened in the studio. */
export const isResumable = (item: CampaignItem): boolean =>
  item.lastSessionId !== null && item.attemptCount > 0;

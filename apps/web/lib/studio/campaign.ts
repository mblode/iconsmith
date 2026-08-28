import { isStudioSessionLive } from "@iconsmith/contract/session-owner";

// The import attribute is what lets `node --test` load this module; Next
// accepts it too, and the bare form fails the runner with
// ERR_IMPORT_ATTRIBUTE_MISSING before a single assertion runs.
import campaign from "./campaign.json" with { type: "json" };

/**
 * The durable campaign, read as data.
 *
 * `backlog.mjs` already creates one eve session per concept and records its id
 * here, and the studio can resume any session by id. So a backlog item is not a
 * link to a file listing: it is a conversation that already happened, with its
 * tournament, its scores and its rejection reasons intact.
 *
 * **For as long as that conversation can still run, which in production is
 * never.** The ids below were minted whenever the workbench last regenerated
 * this file, and a session may run for a day; committing them means they age
 * with the git history, so each one is already days dead by the deploy that
 * carries it. `isResumable` is what keeps the paragraph above from being a
 * promise the data cannot keep -- a concept whose session has aged out opens
 * fresh rather than resuming an empty transcript under a heading advertising a
 * tournament. Reopening the real thing needs the transcript exported into this
 * file, not a pointer to a session that expires.
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

/**
 * Whether opening this concept can actually resume the conversation it was
 * drawn in, rather than merely claim to.
 *
 * Drawn work is not enough, and the file above is the reason. `campaign.json`
 * is committed and generated, so its `lastSessionId` values are as old as
 * whenever the workbench last ran — days by the time a deploy carries them to
 * production, against a session that may run for one. Handing one of those to
 * the studio as a resume cursor buys a refusal and an empty transcript under a
 * heading promising a tournament, so a concept whose session has aged out is
 * opened fresh instead.
 */
export const isResumable = (item: CampaignItem): boolean =>
  item.attemptCount > 0 && isStudioSessionLive(item.lastSessionId);

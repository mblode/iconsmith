/**
 * Regenerate `lib/campaign.json`, the backlog the studio reads.
 *
 * Committed rather than imported across the workspace, for the same reason
 * `vocabulary-data.mjs` gives: Next cannot serve assets from outside the app
 * directory, and a relative path into packages/ survives local dev and breaks
 * on Vercel.
 *
 *   node scripts/campaign-data.mjs
 *
 * Only the fields the studio shows are copied. The campaign's own file carries
 * a full cost ledger per item, which is most of its 100K and none of the
 * studio's business: the workbench remains the source of truth, and this is a
 * projection of it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..", "..", "..");
const source = path.join(
  root,
  "packages/iconsmith/workbench/central-gaps-v1/campaign.json",
);

const campaign = JSON.parse(readFileSync(source, "utf-8"));

const item = (row) => ({
  attemptCount: row.attemptCount ?? 0,
  confidence: row.confidence ?? "unknown",
  id: row.id,
  lastSessionId: row.lastSessionId ?? null,
  rank: row.rank ?? 0,
  risk: row.risk ?? null,
  slug: row.slug,
  sources: row.sources ?? [],
  status: row.status,
});

const projection = {
  generated: campaign.updatedAt ?? null,
  id: campaign.id,
  items: (campaign.items ?? []).map(item),
  retired: (campaign.retired ?? []).map(item),
  target: campaign.target,
};

const out = path.join(import.meta.dirname, "..", "lib", "campaign.json");
writeFileSync(out, `${JSON.stringify(projection, null, 2)}\n`);
process.stdout.write(
  `wrote ${projection.items.length} items, ${projection.retired.length} retired\n`,
);

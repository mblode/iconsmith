import { loadCampaign } from "@/lib/studio/campaign";

/**
 * The backlog, fetched when the panel that shows it is first opened.
 *
 * It used to cross as a prop from the studio page, which put all 200 concepts
 * in the RSC payload of every visit for a tab most sessions never open. The
 * campaign only changes when the workbench regenerates it, so it caches hard.
 */
export const runtime = "nodejs";

export const GET = () =>
  Response.json(loadCampaign(), {
    headers: { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });

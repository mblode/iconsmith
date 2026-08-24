"use client";

import { useEffect, useState } from "react";

import { asset } from "@/lib/site-url";
import type { CampaignItem } from "@/lib/studio/campaign";

/**
 * The backlog, loaded once for everyone who needs it.
 *
 * Two callers want it and they want different things: the panel wants the rows
 * to draw, and the studio wants to know whether any of them has been drawn at
 * all — because a session with no versions of its own used to hide the
 * inspector, and the backlog lives inside it. Fetching in both places would be
 * two requests for one answer, and two answers the moment one of them is stale.
 *
 * `null` while loading, so a caller can tell "nothing yet" from "nothing".
 */
export interface Campaign {
  fault: boolean;
  items: readonly CampaignItem[] | null;
}

export const useCampaign = (): Campaign => {
  const [items, setItems] = useState<readonly CampaignItem[] | null>(null);
  const [fault, setFault] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const response = await fetch(asset("/api/studio/campaign"));
        if (!response.ok) {
          throw new Error("campaign unavailable");
        }
        const rows = (await response.json()) as CampaignItem[];
        if (live) {
          setItems(rows);
        }
      } catch {
        if (live) {
          setFault(true);
        }
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, []);

  return { fault, items };
};

/** Whether the workbench has drawn anything worth reopening. */
export const hasDrawnWork = (items: readonly CampaignItem[] | null): boolean =>
  (items ?? []).some((item) => item.attemptCount > 0);

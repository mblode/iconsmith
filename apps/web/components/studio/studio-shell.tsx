"use client";

import { useState } from "react";

import { StudioApp } from "@/components/studio/studio-app";
import type { CampaignItem } from "@/lib/studio/campaign";
import type { OverviewSpec } from "@/lib/studio/overview";

/**
 * Chooses which durable conversation the studio is bound to.
 *
 * eve reads its session options only when the store is created, so opening a
 * concept remounts the studio under a new key rather than trying to redirect a
 * live binding. Each concept also gets its own saved cursor, which is what the
 * frontend guide means by one saved session per thread.
 */
export const StudioShell = ({
  campaign,
  houseSpec,
}: {
  campaign: readonly CampaignItem[];
  houseSpec: OverviewSpec;
}) => {
  const [open, setOpen] = useState<CampaignItem | null>(null);
  const thread = open ? `campaign:${open.slug}` : "default";

  return (
    <StudioApp
      campaign={campaign}
      houseSpec={houseSpec}
      key={thread}
      onOpenSlug={setOpen}
      openSlug={open?.slug ?? null}
      recordedSessionId={open?.lastSessionId ?? null}
      thread={thread}
    />
  );
};

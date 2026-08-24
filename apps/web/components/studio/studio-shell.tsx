"use client";

import { useState } from "react";

import { StudioApp } from "@/components/studio/studio-app";
import type { CampaignItem } from "@/lib/studio/campaign";
import type { OverviewSpec } from "@/lib/studio/overview";
import { newThreadId } from "@/lib/studio/threads";
import type { StudioThread } from "@/lib/studio/threads";

/**
 * Chooses which durable conversation the studio is bound to.
 *
 * eve reads its session options only when the store is created, so switching
 * conversations remounts the studio under a new key rather than trying to
 * redirect a live binding. Each conversation keeps its own cursor, which is
 * what the frontend guide means by one saved session per thread.
 */

interface Binding {
  readonly recordedSessionId: string | null;
  readonly slug: string | null;
  readonly thread: string;
}

const DEFAULT_BINDING: Binding = {
  recordedSessionId: null,
  slug: null,
  thread: "default",
};

export const StudioShell = ({
  campaign,
  houseSpec,
}: {
  campaign: readonly CampaignItem[];
  houseSpec: OverviewSpec;
}) => {
  const [binding, setBinding] = useState<Binding>(DEFAULT_BINDING);

  const openCampaignItem = (item: CampaignItem) => {
    setBinding({
      recordedSessionId: item.lastSessionId,
      slug: item.slug,
      thread: `campaign:${item.slug}`,
    });
  };

  const openThread = (thread: StudioThread) => {
    setBinding({
      // A saved thread already has a cursor of its own; the campaign's recorded
      // starting point only matters the first time a concept is opened.
      recordedSessionId: null,
      slug: thread.slug ?? null,
      thread: thread.id,
    });
  };

  return (
    <StudioApp
      campaign={campaign}
      houseSpec={houseSpec}
      key={binding.thread}
      onNewChat={() => setBinding({ ...DEFAULT_BINDING, thread: newThreadId() })}
      onOpenSlug={openCampaignItem}
      onOpenThread={openThread}
      openSlug={binding.slug}
      recordedSessionId={binding.recordedSessionId}
      thread={binding.thread}
    />
  );
};

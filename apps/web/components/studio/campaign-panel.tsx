"use client";

import { Button } from "@/components/ui/button";
import type { CampaignItem } from "@/lib/studio/campaign";

/**
 * The campaign backlog.
 *
 * Every row is a concept Central is missing. A row the workbench has drawn
 * carries the eve session it drew in, so opening it is resuming a conversation
 * that already happened rather than starting a new one.
 */

const STATUS_ORDER: Record<string, number> = {
  approved: 4,
  blocked: 6,
  exploring: 1,
  published: 5,
  review: 2,
  revision: 0,
  todo: 3,
  "wont-do": 7,
};

export const CampaignPanel = ({
  items,
  onOpen,
  openSlug,
}: {
  items: readonly CampaignItem[];
  onOpen: (item: CampaignItem) => void;
  openSlug: string | null;
}) => {
  // Drawn work first: those are the rows there is something to look at.
  const ordered = items.toSorted(
    (a, b) =>
      b.attemptCount - a.attemptCount ||
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      a.rank - b.rank,
  );
  const drawn = items.filter((item) => item.attemptCount > 0).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">Central gaps</h2>
        <p className="text-pretty text-muted-foreground text-sm">
          {items.length} concepts Central is missing, {drawn} drawn so far. Drawn concepts reopen
          the session the workbench recorded.
        </p>
      </div>

      <ul className="-mr-1 flex min-h-0 flex-col gap-px overflow-y-auto pr-1">
        {ordered.map((item) => {
          const resumable = item.lastSessionId !== null && item.attemptCount > 0;
          const open = openSlug === item.slug;
          return (
            <li key={item.id}>
              <Button
                aria-pressed={open}
                className="h-auto w-full justify-start px-2 py-2 text-left font-normal"
                disabled={!resumable}
                onClick={() => onOpen(item)}
                type="button"
                variant={open ? "outline" : "ghost"}
              >
                <span className="flex w-full min-w-0 flex-col gap-0.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium text-sm">{item.slug}</span>
                    <span className="shrink-0 text-muted-foreground text-xs">{item.status}</span>
                  </span>
                  <span className="truncate text-muted-foreground text-xs">
                    {item.attemptCount > 0
                      ? `${item.attemptCount} attempt${item.attemptCount === 1 ? "" : "s"}`
                      : "not drawn"}
                    {" · "}
                    {item.sources.join("/")}
                    {item.risk ? " · needs a semantic call" : ""}
                  </span>
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

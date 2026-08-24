"use client";

import Chevron from "blode-icons-react/icons/chevron-down-small";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { forgetThread, readThreads } from "@/lib/studio/threads";
import type { StudioThread } from "@/lib/studio/threads";

/**
 * Names the conversation in view, and is the way to every other one.
 *
 * The list is read when the menu opens rather than held in state: another tab
 * may have started a chat since this one mounted, and a stale list would
 * quietly hide it.
 */
export const ChatSwitcher = ({
  onNew,
  onOpen,
  threadId,
  title,
}: {
  onNew: () => void;
  onOpen: (thread: StudioThread) => void;
  threadId: string;
  title: string;
}) => {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<readonly StudioThread[]>([]);

  const close = () => setOpen(false);

  return (
    <header className="flex shrink-0 items-center border-b px-2 py-1.5">
      <Popover
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setThreads(readThreads());
          }
        }}
        open={open}
      >
        <PopoverTrigger render={<Button className="max-w-full" size="sm" variant="ghost" />}>
          <span className="truncate">{title}</span>
          <Chevron />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-1">
          <Button
            className="w-full justify-start"
            onClick={() => {
              onNew();
              close();
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            New chat
          </Button>

          {threads.length > 0 ? (
            <ul className="mt-1 flex max-h-80 flex-col gap-px overflow-y-auto border-t pt-1">
              {threads.map((thread) => (
                <li className="flex items-center gap-1" key={thread.id}>
                  <Button
                    aria-current={thread.id === threadId}
                    className="h-auto min-w-0 flex-1 justify-start px-2 py-2 text-left font-normal"
                    onClick={() => {
                      onOpen(thread);
                      close();
                    }}
                    size="sm"
                    type="button"
                    variant={thread.id === threadId ? "outline" : "ghost"}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm">{thread.title || "Untitled chat"}</span>
                      <span className="truncate text-muted-foreground text-xs">
                        {thread.kind === "campaign" ? `Backlog · ${thread.slug}` : "Chat"}
                      </span>
                    </span>
                  </Button>
                  <Button
                    aria-label={`Forget ${thread.title || "untitled chat"}`}
                    onClick={() => {
                      forgetThread(thread.id);
                      if (thread.id === threadId) {
                        // Still mounted on it, so it would re-record itself on
                        // the next turn unless we move off it first.
                        onNew();
                        close();
                        return;
                      }
                      setThreads(readThreads());
                    }}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <span aria-hidden="true">&times;</span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="px-2 pt-2 pb-1 text-muted-foreground text-xs">
            Forgetting a chat removes it from this browser. The conversation stays on the server.
          </p>
        </PopoverContent>
      </Popover>
    </header>
  );
};

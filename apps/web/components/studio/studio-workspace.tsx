"use client";

import type { ReactNode } from "react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * Holds the three studio panes.
 *
 * On a wide viewport the panes are resizable, because how much room the chat,
 * the icon, and the inspector deserve depends on what you are doing: writing a
 * brief, judging a render at real size, or reading the pipeline record. Below
 * that width there is not enough room to divide, so the panes stack and the
 * handles would be a control with nothing to control.
 */
export const StudioWorkspace = ({
  canvas,
  chat,
  inspector,
}: {
  canvas: ReactNode;
  chat: ReactNode;
  inspector: ReactNode;
}) => {
  const resizable = useMediaQuery("(min-width: 80rem)");

  if (!resizable) {
    // Narrow viewports stack and scroll: the panes each keep a workable height
    // rather than three panels fighting over one column of screen.
    return (
      <div className="flex min-h-0 flex-1 flex-col divide-y overflow-y-auto">
        <div className="flex min-h-[34rem] shrink-0 flex-col">{chat}</div>
        <div className="flex min-h-[30rem] shrink-0 flex-col">{canvas}</div>
        <div className="flex min-h-[20rem] shrink-0 flex-col">{inspector}</div>
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      className="min-h-0 flex-1 overflow-hidden bg-border"
      orientation="horizontal"
    >
      <ResizablePanel defaultSize="24%" maxSize="40%" minSize="18%">
        {chat}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel minSize="30%">{canvas}</ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel collapsible defaultSize="21%" maxSize="34%" minSize="15%">
        {inspector}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};

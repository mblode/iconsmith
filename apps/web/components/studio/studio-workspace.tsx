"use client";

import type { ReactNode } from "react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * Holds whichever studio panes currently have something to show.
 *
 * Before the first draw there is no icon to judge and no version to inspect, so
 * the canvas and inspector would be two empty columns explaining that they are
 * empty. They arrive when they have work in them, and until then the brief gets
 * the whole window.
 *
 * On a wide viewport the panes are resizable, because how much room the chat,
 * the icon, and the pipeline record deserve depends on what you are doing.
 * Below that width there is not enough room to divide, so they stack and the
 * handles would be a control with nothing to control.
 */
export const StudioWorkspace = ({
  canvas,
  chat,
  inspector,
}: {
  canvas: ReactNode | null;
  chat: ReactNode;
  inspector: ReactNode | null;
}) => {
  const resizable = useMediaQuery("(min-width: 80rem)");
  const extras = [canvas, inspector].filter(Boolean).length;

  if (extras === 0) {
    return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{chat}</div>;
  }

  if (!resizable) {
    // Narrow viewports stack and scroll: the panes each keep a workable height
    // rather than three panels fighting over one column of screen.
    return (
      <div className="flex min-h-0 flex-1 flex-col divide-y overflow-y-auto">
        <div className="flex min-h-[34rem] shrink-0 flex-col">{chat}</div>
        {canvas ? <div className="flex min-h-[30rem] shrink-0 flex-col">{canvas}</div> : null}
        {inspector ? <div className="flex min-h-[20rem] shrink-0 flex-col">{inspector}</div> : null}
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      className="min-h-0 flex-1 overflow-hidden bg-border"
      orientation="horizontal"
    >
      {/* Percentages renormalise across whichever panels are mounted, so the
          chat's share is stated per configuration rather than left to scale. */}
      <ResizablePanel defaultSize={canvas ? "24%" : "74%"} maxSize="80%" minSize="18%">
        {chat}
      </ResizablePanel>
      {canvas ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel minSize="30%">{canvas}</ResizablePanel>
        </>
      ) : null}
      {inspector ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel
            collapsible
            defaultSize={canvas ? "21%" : "26%"}
            maxSize="40%"
            minSize="15%"
          >
            {inspector}
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
};

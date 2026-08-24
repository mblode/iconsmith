"use client";

import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Conversation scroller. Anchors to the newest turn as messages arrive,
 * and offers a jump-to-latest control when the reader has scrolled away.
 */
const MessageScroller = ({ className, children, ...props }: React.ComponentProps<"div">) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  });

  return (
    <div
      className={cn("relative flex min-h-0 flex-1 flex-col overflow-y-auto", className)}
      data-slot="message-scroller"
      {...props}
    >
      {children}
      <div aria-hidden="true" ref={endRef} />
    </div>
  );
};

const MessageScrollerContent = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    className={cn("mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6", className)}
    data-slot="message-scroller-content"
    {...props}
  />
);

const MessageScrollerButton = ({ className, ...props }: React.ComponentProps<typeof Button>) => (
  <Button
    className={cn("absolute right-4 bottom-4", className)}
    data-slot="message-scroller-button"
    size="sm"
    type="button"
    variant="outline"
    {...props}
  />
);

export { MessageScroller, MessageScrollerContent, MessageScrollerButton };

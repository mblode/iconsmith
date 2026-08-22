import type * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = ({ className, ...props }: React.ComponentProps<"textarea">) => (
  <textarea
    className={cn(
      "field-sizing-content min-h-20 w-full resize-none rounded-xl border border-input bg-surface px-4 py-3 text-base outline-none transition-[color] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
      "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
      className,
    )}
    data-slot="textarea"
    {...props}
  />
);

export { Textarea };

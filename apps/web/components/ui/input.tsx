import type * as React from "react";

import { cn } from "@/lib/utils";

const Input = ({ className, type, ...props }: React.ComponentProps<"input">) => (
  <input
    className={cn(
      "h-11 w-full min-w-0 rounded-lg border border-input bg-surface px-4 py-2 text-base outline-none transition-[color] selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
      "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
      "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
      className,
    )}
    data-slot="input"
    type={type}
    {...props}
  />
);

export { Input };

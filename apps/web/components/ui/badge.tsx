import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
// The registry ships `import { Slot } from "radix-ui"`, Radix's newer single
// package. This app is on the per-package distribution (`@radix-ui/react-slot`,
// `@radix-ui/react-label`), and pulling the umbrella in beside them would ship a
// second copy of Radix. `@radix-ui/react-slot` exports `Slot as Root`, so the
// call site below is unchanged.
import * as Slot from "@radix-ui/react-slot";
import type * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        outline: "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        // `thinking-steps` marks a step that finished and one that wants
        // attention. Built on the same shape `destructive` uses — a tinted
        // wash plus a readable foreground, with its own dark-mode pair — so the
        // set stays coherent rather than gaining two one-off colours.
        success:
          "bg-emerald-500/10 text-emerald-700 [a]:hover:bg-emerald-500/20 dark:bg-emerald-400/15 dark:text-emerald-300",
        warning:
          "bg-amber-500/10 text-amber-700 [a]:hover:bg-amber-500/20 dark:bg-amber-400/15 dark:text-amber-300",
      },
    },
  },
);

const Badge = ({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) => {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      className={cn(badgeVariants({ variant }), className)}
      data-slot="badge"
      data-variant={variant}
      {...props}
    />
  );
};

export { Badge, badgeVariants };

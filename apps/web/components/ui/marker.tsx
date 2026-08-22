import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const markerVariants = cva(
  "group/marker relative flex min-h-4 w-full items-center gap-2 text-left text-muted-foreground text-sm [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        border: "border-border border-b pb-2",
        default: "",
        separator:
          "before:mr-1 before:h-px before:min-w-0 before:flex-1 before:bg-border after:ml-1 after:h-px after:min-w-0 after:flex-1 after:bg-border",
      },
    },
  },
);

const Marker = ({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof markerVariants> & {
    asChild?: boolean;
  }) => {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      className={cn(markerVariants({ className, variant }))}
      data-slot="marker"
      data-variant={variant}
      {...props}
    />
  );
};

const MarkerIcon = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span
    aria-hidden="true"
    className={cn("size-4 shrink-0 [&_svg:not([class*='size-'])]:size-4", className)}
    data-slot="marker-icon"
    {...props}
  />
);

const MarkerContent = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span
    className={cn(
      "min-w-0 wrap-break-word group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center",
      className,
    )}
    data-slot="marker-content"
    {...props}
  />
);

export { Marker, MarkerIcon, MarkerContent, markerVariants };

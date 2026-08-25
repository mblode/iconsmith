"use client";

// The registry ships `import { Accordion as AccordionPrimitive } from "radix-ui"`,
// Radix's newer umbrella package. This app is on the per-package distribution,
// so the primitive is installed as `@radix-ui/react-accordion` rather than
// bringing a second copy of Radix alongside `@radix-ui/react-slot`. The
// namespace shape is identical, so every call site below is unchanged.
import * as AccordionPrimitive from "@radix-ui/react-accordion";
// The registry's `IconPlaceholder` renders whichever icon set the docs reader
// picked. This project has already picked one: `components.json` names
// `blode-icons-react` as its `iconLibrary`.
import { ChevronDownIcon, ChevronUpIcon } from "blode-icons-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

const Accordion = ({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root>) => (
  <AccordionPrimitive.Root
    className={cn("flex w-full flex-col", className)}
    data-slot="accordion"
    {...props}
  />
);

const AccordionItem = ({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) => (
  <AccordionPrimitive.Item
    className={cn("not-last:border-b", className)}
    data-slot="accordion-item"
    {...props}
  />
);

const AccordionTrigger = ({
  className,
  children,
  /** `thinking-steps` builds its own leading glyph and row layout and asks for
   *  the trigger without a trailing chevron. Default true leaves every other
   *  caller as it was. */
  chevron = true,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger> & {
  chevron?: boolean;
}) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      className={cn(
        "group/accordion-trigger relative flex flex-1 items-start justify-between rounded-lg border border-transparent py-2.5 text-left font-medium text-sm outline-none transition-all hover:underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:after:border-ring disabled:pointer-events-none disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground",
        className,
      )}
      data-slot="accordion-trigger"
      {...props}
    >
      {children}
      {chevron ? (
        <>
          <ChevronDownIcon
            className="pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden"
            data-slot="accordion-trigger-icon"
          />
          <ChevronUpIcon
            className="pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline"
            data-slot="accordion-trigger-icon"
          />
        </>
      ) : null}
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
);

const AccordionContent = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) => (
  <AccordionPrimitive.Content
    className="overflow-hidden text-sm data-closed:animate-accordion-up data-open:animate-accordion-down"
    data-slot="accordion-content"
    {...props}
  >
    <div
      className={cn(
        "pt-0 pb-2.5 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className,
      )}
    >
      {children}
    </div>
  </AccordionPrimitive.Content>
);

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };

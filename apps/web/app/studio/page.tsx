import { SPEC } from "iconsmith";
import type { Metadata } from "next";

import { StudioApp } from "@/components/studio/studio-app";
import { StudioBreadcrumb } from "@/components/studio/studio-breadcrumb";

export const metadata: Metadata = {
  description:
    "Draw a house-spec icon in chat. Attach a reference, answer questions, and intervene on every version. The model never emits a coordinate.",
  title: "Studio",
};

const StudioPage = () => (
  /* The studio fills the viewport and owns its own scrolling. A tool is a
     surface you work inside, not a document you scroll past. */
  <main
    className="flex h-svh min-h-0 flex-col overflow-hidden bg-background"
    data-surface="app"
    id="main-content"
  >
    <header className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 border-b px-4 py-3 sm:px-5">
      <h1 className="font-heading font-medium text-base tracking-tight">Iconsmith Studio</h1>
      <p className="min-w-0 flex-1 truncate text-muted-foreground text-sm">
        Generate, compare, comment, and branch without letting a model emit a coordinate.
      </p>
      <StudioBreadcrumb />
    </header>
    <StudioApp houseSpec={{ dots: SPEC.dots, keylines: Object.keys(SPEC.keylines) }} />
  </main>
);

export default StudioPage;

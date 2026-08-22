import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { StudioApp } from "@/components/studio/studio-app";
import { StudioBreadcrumb } from "@/components/studio/studio-breadcrumb";

export const metadata: Metadata = {
  description:
    "Draw a house-spec icon in chat. Attach a reference, answer questions, and intervene on every version. The model never emits a coordinate.",
  title: "Studio",
};

const StudioPage = () => (
  <main className="isolate flex min-h-svh flex-col" id="main-content">
    <div className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-3">
          <StudioBreadcrumb />
          <h1 className="text-balance font-heading font-medium text-2xl tracking-tight">
            Iconsmith Studio
          </h1>
        </div>
        <p className="max-w-[58ch] text-pretty text-base text-muted-foreground">
          Generate, compare, comment, and branch without letting a model emit a coordinate.
        </p>
      </header>
      <StudioApp />
      <SiteFooter />
    </div>
  </main>
);

export default StudioPage;

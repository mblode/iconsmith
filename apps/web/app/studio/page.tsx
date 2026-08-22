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
  <main className="flex min-h-screen flex-col" id="main-content">
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-8 px-6 py-8">
      <StudioBreadcrumb />
      <header className="flex flex-col gap-3">
        <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">Studio</p>
        <h1 className="max-w-[18ch] text-balance font-heading font-medium text-4xl leading-[1.05] sm:text-5xl">
          Draw it. Then talk to it.
        </h1>
        <p className="max-w-[58ch] text-muted-foreground text-sm leading-relaxed sm:text-base">
          Type the object. Attach a reference I will not trace. I will pause when I need a decision.
          Every version keeps its program, its lint, and the expert that drew it.
        </p>
      </header>
      <StudioApp />
      <SiteFooter />
    </div>
  </main>
);

export default StudioPage;

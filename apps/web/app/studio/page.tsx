import { SPEC } from "iconsmith";
import type { Metadata } from "next";

import { StudioShell } from "@/components/studio/studio-shell";
import { loadCampaign } from "@/lib/studio/campaign";

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
    {/* The visible chrome is gone, but a document still needs one heading that
        names it. */}
    <h1 className="sr-only">Iconsmith Studio</h1>
    <StudioShell
      campaign={loadCampaign().items}
      houseSpec={{ dots: SPEC.dots, keylines: Object.keys(SPEC.keylines) }}
    />
  </main>
);

export default StudioPage;

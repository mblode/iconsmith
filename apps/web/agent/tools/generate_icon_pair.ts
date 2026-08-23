/* oxlint-disable unicorn/filename-case -- Eve derives the public tool name from this snake_case filename. */
import { defineTool } from "eve/tools";

import { generateStudioResponse } from "../../lib/studio/generate";
import { studioRequestSchema } from "../../lib/studio/types";

export default defineTool({
  description:
    "Run one exact Iconsmith Studio request through clarification or approval handling, paired outlined/filled generation, linting, rendering, and AI visual review. Use exactly once per user turn.",
  execute(request, ctx) {
    return generateStudioResponse(request, { operationId: ctx.callId });
  },
  inputSchema: studioRequestSchema,
  toModelOutput(output) {
    if (output.kind === "drawn") {
      const [lead] = output.versions;
      return {
        type: "text",
        value: `Generated ${output.versions.length} reviewed paints for ${lead?.name ?? "the icon"}. The Studio has the exact renders and audit data.`,
      };
    }
    if (output.kind === "questions") {
      return { type: "text", value: "The Studio is showing the required clarification questions." };
    }
    if (output.kind === "approval") {
      return { type: "text", value: "The Studio is showing the reference-reading approval." };
    }
    return { type: "text", value: output.text };
  },
});

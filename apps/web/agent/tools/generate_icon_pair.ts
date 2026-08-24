/* oxlint-disable unicorn/filename-case -- Eve derives the public tool name from this snake_case filename. */
import { defineTool } from "eve/tools";

import { generateStudioResponse } from "../../lib/studio/generate";
import { studioRequestSchema } from "../../lib/studio/types";

const activeTurns = new Map<string, ReturnType<typeof generateStudioResponse>>();

const clearFailedTurn = async (
  operationId: string,
  run: ReturnType<typeof generateStudioResponse>,
): Promise<void> => {
  try {
    await run;
  } catch {
    if (activeTurns.get(operationId) === run) {
      activeTurns.delete(operationId);
    }
  }
};

const generateOnce = (
  request: Parameters<typeof generateStudioResponse>[0],
  operationId: string,
): ReturnType<typeof generateStudioResponse> => {
  const active = activeTurns.get(operationId);
  if (active) {
    return active;
  }

  const run = generateStudioResponse(request, { operationId });
  activeTurns.set(operationId, run);
  void clearFailedTurn(operationId, run);
  return run;
};

export default defineTool({
  /**
   * Reading a user's image as composition is a consent decision, so it parks
   * the durable session rather than riding back as a tool return value. The
   * old in-band `kind: "approval"` completed the turn immediately, which meant
   * a refresh lost the pending consent and no approval ever reached Agent Runs.
   *
   * Only visual references need consent: text and library-name attachments
   * carry meaning, not geometry.
   */
  approval: ({ toolInput }) =>
    toolInput?.attachments?.some((file) => file.kind === "image" || file.kind === "svg")
      ? "user-approval"
      : "not-applicable",
  description:
    "Run one exact Iconsmith Studio request through clarification handling, paired outlined/filled generation, linting, rendering, and AI visual review. Reading an attached image or SVG as composition requires the user's approval.",
  execute(request, ctx) {
    const operationId = `${ctx.session.id}-${ctx.session.turn.id}`;
    return generateOnce(request, operationId);
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
    return { type: "text", value: output.text };
  },
});

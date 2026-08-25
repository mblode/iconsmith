import type { MessageStreamEvent } from "eve/client";

import { studioFaultMessage } from "./fault";

const PIPELINE = "generate_icon_pair";

const lastTurn = (events: readonly MessageStreamEvent[]): readonly MessageStreamEvent[] => {
  const start = events.findLastIndex((event) => event.type === "turn.started");
  return start === -1 ? events : events.slice(start);
};

const requestedPipeline = (events: readonly MessageStreamEvent[]): boolean =>
  events.some(
    (event) =>
      event.type === "actions.requested" &&
      event.data.actions.some(
        (action) => action.kind === "tool-call" && action.toolName === PIPELINE,
      ),
  );

export type StudioFinishDiagnosis =
  | { kind: "idle" }
  | { kind: "waiting" }
  /** The model replied without calling `generate_icon_pair`. */
  | { kind: "skipped" }
  /** The pipeline was called, but this client stream ended before its result. */
  | { kind: "dropped" }
  | { kind: "fault"; message: string };

/**
 * Why a live Studio turn ended without `applyStudioResponse`.
 *
 * `onFinish` fires for every settled stream, including a parked approval, a
 * cancelled Stop, and a model that never called the pipeline. Those are
 * different product states; collapsing them into one banner made a skipped
 * tool call look the same as a declined attachment.
 */
export const diagnoseStudioFinish = (
  events: readonly MessageStreamEvent[],
): StudioFinishDiagnosis => {
  const turn = lastTurn(events);
  if (turn.some((event) => event.type === "turn.cancelled")) {
    return { kind: "idle" };
  }
  const asked = turn.some((event) => event.type === "input.requested");
  const answered = turn.some((event) => event.type === "input.resolved");
  if (asked && !answered) {
    return { kind: "waiting" };
  }

  const pipeline = turn.findLast(
    (event) =>
      event.type === "action.result" &&
      event.data.result.kind === "tool-result" &&
      event.data.result.toolName === PIPELINE,
  );
  if (pipeline?.type === "action.result") {
    if (pipeline.data.status === "failed" || pipeline.data.status === "rejected") {
      return {
        kind: "fault",
        message: studioFaultMessage(
          pipeline.data.error?.message ??
            (pipeline.data.status === "rejected"
              ? "Reading the attachment was declined."
              : "The paired icon pipeline failed."),
        ),
      };
    }
    return { kind: "fault", message: "The icon agent returned an invalid Studio result." };
  }

  const failure = turn.findLast(
    (event) => event.type === "turn.failed" || event.type === "step.failed",
  );
  if (failure?.type === "turn.failed" || failure?.type === "step.failed") {
    return { kind: "fault", message: studioFaultMessage(failure.data.message) };
  }

  if (requestedPipeline(turn)) {
    return { kind: "dropped" };
  }
  return { kind: "skipped" };
};

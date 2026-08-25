import { CircleOutlineIcon, CircleXIcon } from "blode-icons-react";

import {
  ThinkingStep,
  ThinkingSteps,
  ThinkingStepsContent,
  ThinkingStepsHeader,
} from "@/components/ui/thinking-steps";
import type { StudioActivity } from "@iconsmith/contract/types";

/**
 * `StudioActivity` has three states and `ThinkingStep` has three statuses, but
 * they are not the same three: the step vocabulary describes position in a
 * sequence, so it carries `pending` and has no room for failure. A failed step
 * is still a step that finished, and what marks it is the icon plus the
 * assistive text on the row — not a status the timeline cannot express.
 */
const stepStatus = (state: StudioActivity["state"]) => (state === "active" ? "active" : "complete");

export const AgentActivityCard = ({ activities }: { activities: readonly StudioActivity[] }) => {
  if (activities.length === 0) {
    return null;
  }

  return (
    <ThinkingSteps className="w-full max-w-xl" data-slot="agent-activity">
      <ThinkingStepsHeader>Agent activity</ThinkingStepsHeader>
      {/* The list is the live region, not the card: rows arrive here while the
          pipeline runs, and without `role="log"` a screen reader was told
          nothing at all — the agent could draw for ten minutes in silence.
          `aria-relevant="additions text"` keeps that to the new row and the
          active row's changing label, rather than re-reading every step each
          time one of them updates.

          It sits on `ThinkingStepsContent` because that component spreads its
          props onto its own inner div. An extra wrapper between the accordion's
          item and its content would break the structure Radix expects. */}
      <ThinkingStepsContent
        aria-label="Icon agent activity"
        aria-live="polite"
        aria-relevant="additions text"
        role="log"
      >
        {activities.map((activity, index) => (
          <ThinkingStep
            description={activity.detail}
            icon={activity.state === "failed" ? CircleXIcon : CircleOutlineIcon}
            isLast={index === activities.length - 1}
            key={activity.id}
            label={activity.label}
            status={stepStatus(activity.state)}
          >
            {/* The icon is the only visual signal that a step failed, and an
                icon alone does not reach a screen reader. */}
            <span className="sr-only">{`${activity.state}: ${activity.label}`}</span>
          </ThinkingStep>
        ))}
      </ThinkingStepsContent>
    </ThinkingSteps>
  );
};

import type { StudioActivity } from "@/lib/studio/types";

const stateDotClass = (state: StudioActivity["state"]): string => {
  if (state === "failed") {
    return "mt-1 size-2 rounded-full bg-destructive";
  }
  if (state === "active") {
    return "mt-1 size-2 animate-pulse rounded-full bg-primary";
  }
  return "mt-1 size-2 rounded-full bg-muted-foreground/50";
};

export const AgentActivityCard = ({ activities }: { activities: readonly StudioActivity[] }) => {
  if (activities.length === 0) {
    return null;
  }

  return (
    <div
      aria-label="Icon agent activity"
      className="w-full max-w-xl rounded-xl border bg-card p-3"
      data-slot="agent-activity"
    >
      <h3 className="font-medium text-xs">Agent activity</h3>
      <ol className="mt-3 flex flex-col gap-2">
        {activities.map((activity) => (
          <li className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-2 text-xs" key={activity.id}>
            <span aria-hidden="true" className={stateDotClass(activity.state)} />
            <span>
              {/* The dot is the only signal that a step failed, and colour
                  alone does not reach a screen reader. */}
              <span className="sr-only">{`${activity.state}: `}</span>
              <span className="text-foreground">{activity.label}</span>
              {activity.detail ? (
                <span className="mt-0.5 block text-muted-foreground">{activity.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};

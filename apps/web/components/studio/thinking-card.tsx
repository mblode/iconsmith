"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { StudioVersion } from "@/lib/studio/types";

export const ThinkingCard = ({ versions }: { versions: readonly StudioVersion[] }) => {
  const [open, setOpen] = useState(true);
  const [lead] = versions;
  if (!lead) {
    return null;
  }

  return (
    <div className="w-full max-w-lg rounded-2xl border bg-card p-3 shadow-xs" data-slot="thinking">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
          Thinking
        </p>
        <Button onClick={() => setOpen((value) => !value)} size="sm" type="button" variant="ghost">
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm leading-relaxed">{lead.brief}</p>
          <ol className="flex flex-col gap-1 font-mono text-muted-foreground text-xs">
            {lead.trace.map((step, index) => (
              <li key={`${step}-${index}`}>
                {index + 1}. {step}
              </li>
            ))}
          </ol>
          {lead.issues.length > 0 ? (
            <ul className="flex flex-col gap-1 text-xs">
              {lead.issues.map((issue) => (
                <li key={`${issue.rule}-${issue.message}`}>
                  <span className="font-mono uppercase">{issue.severity}</span> {issue.rule}:{" "}
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">No lint findings.</p>
          )}
          <pre className="overflow-x-auto rounded-xl bg-code p-3 font-mono text-code-foreground text-xs leading-relaxed">
            <code>{lead.program}</code>
          </pre>
        </div>
      ) : null}
    </div>
  );
};

"use client";

import { useId, useState } from "react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { safeStudioSvg } from "@/lib/studio/svg";
import type { StudioVersion } from "@/lib/studio/types";

export const ThinkingCard = ({ versions }: { versions: readonly StudioVersion[] }) => {
  const [open, setOpen] = useState(true);
  const panelId = useId();
  const [lead] = versions;
  if (!lead) {
    return null;
  }

  return (
    <div className="w-full max-w-xl rounded-2xl border bg-card p-3 shadow-xs" data-slot="pipeline">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
          Pipeline details
        </p>
        <Button
          aria-controls={panelId}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open ? (
        <div className="mt-3 flex flex-col gap-4" id={panelId}>
          {versions.map((version) => {
            const svg = safeStudioSvg(version.svg);
            const agentLabel =
              version.agent.mode === "draw-and-review"
                ? "AI drawer + visual review"
                : `AI visual review · ${version.agent.selected} drawing`;
            return (
              <article
                className="flex flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0"
                key={version.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-medium text-sm capitalize">{version.finish} render</h4>
                    <p className="text-muted-foreground text-xs">{agentLabel}</p>
                  </div>
                  <span className="rounded-full border px-2 py-1 font-mono text-[10px] uppercase">
                    {version.clean ? "lint clean" : "review"}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <div className="flex aspect-square items-center justify-center rounded-xl border bg-background text-foreground">
                    <Image
                      alt={`${version.name} ${version.finish} rendered icon`}
                      height={80}
                      src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
                      unoptimized
                      width={80}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-2 text-xs">
                    <p className="leading-relaxed">{version.brief}</p>
                    <p className="text-muted-foreground">
                      Tried {version.agent.attempted.join(" → ")} · selected{" "}
                      {version.agent.selected}
                    </p>
                    <p className="text-muted-foreground">
                      {version.agent.scorable
                        ? `Visual review: SC ${version.agent.sc}/10 · PQ ${version.agent.pq}/10`
                        : "Visual review could not be scored; the drawing was preserved."}
                    </p>
                    {version.agent.reason ? <p>{version.agent.reason}</p> : null}
                  </div>
                </div>

                <div>
                  <h5 className="mb-2 font-mono text-muted-foreground text-[10px] uppercase tracking-widest">
                    Recorded steps
                  </h5>
                  <ol className="grid gap-1 font-mono text-muted-foreground text-xs sm:grid-cols-2">
                    {version.trace.map((step, index) => (
                      <li key={`${step}-${index}`}>
                        {index + 1}. {step}
                      </li>
                    ))}
                  </ol>
                </div>

                {version.agent.findings.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-xs">
                    {version.agent.findings.map((finding) => (
                      <li key={`${finding.kind}-${finding.message}`}>
                        <span className="font-mono uppercase">Agent {finding.kind}</span>:{" "}
                        {finding.message}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {version.issues.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-xs">
                    {version.issues.map((issue) => (
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
                  <code>{version.program}</code>
                </pre>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

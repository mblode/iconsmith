"use client";

import { safeStudioSvg } from "@iconsmith/contract/svg";
import type { StudioVersion } from "@iconsmith/contract/types";
import { cn } from "@/lib/utils";

export const ExplorationBoard = ({
  onSelect,
  selectedId,
  versions,
}: {
  onSelect: (id: string) => void;
  selectedId: string | null;
  versions: readonly StudioVersion[];
}) => (
  <section className="flex min-h-0 flex-1 flex-col gap-4">
    <div className="flex items-baseline justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">Explorations</h2>
        <p className="text-base text-muted-foreground sm:text-sm">
          Every attempt stays visible. Select one to inspect or branch in chat.
        </p>
      </div>
      <p className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
        {versions.length} versions
      </p>
    </div>

    {versions.length === 0 ? (
      <div className="grid min-h-72 flex-1 place-items-center rounded-xl border border-dashed">
        <p className="max-w-[28ch] text-balance text-center text-base text-muted-foreground sm:text-sm">
          Your outlined and filled attempts will collect here as you draw and refine.
        </p>
      </div>
    ) : (
      <ol className="grid auto-rows-max grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 xl:grid-cols-4">
        {versions.map((version, index) => (
          <li key={version.id}>
            <button
              aria-label={`Inspect version ${index + 1}, ${version.name}, ${version.finish}`}
              aria-pressed={selectedId === version.id}
              className={cn(
                "flex w-full flex-col gap-3 rounded-xl border bg-card p-3 text-left outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                selectedId === version.id && "border-foreground/35 bg-accent",
              )}
              onClick={() => onSelect(version.id)}
              type="button"
            >
              <span className="grid aspect-square w-full place-items-center rounded-xl bg-background">
                <span
                  className="size-20 text-foreground [&_svg]:size-20"
                  // oxlint-disable-next-line react/no-danger -- house SVG from iconsmith
                  dangerouslySetInnerHTML={{ __html: safeStudioSvg(version.svg) }}
                />
              </span>
              <span className="flex w-full items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-sm">{version.name}</span>
                  <span className="block text-muted-foreground text-xs">{version.finish}</span>
                </span>
                <span className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
                  v{index + 1}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    )}
  </section>
);

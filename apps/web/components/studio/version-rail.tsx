"use client";

import { Button } from "@/components/ui/button";
import { safeStudioSvg } from "@/lib/studio/svg";
import { cn } from "@/lib/utils";
import type { StudioVersion } from "@/lib/studio/types";

export const VersionRail = ({
  onSelect,
  selectedId,
  versions,
}: {
  onSelect: (id: string) => void;
  selectedId: string | null;
  versions: readonly StudioVersion[];
}) => (
  <aside className="flex min-h-0 flex-1 flex-col gap-2">
    <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">Versions</p>
    {versions.length === 0 ? (
      <p className="text-muted-foreground text-sm">
        Each draw lands here. Chat to branch a new one.
      </p>
    ) : (
      <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {versions.map((version, index) => (
          <li key={version.id}>
            <Button
              // Selection was a ring and nothing else, so assistive tech could
              // not tell which version was open. Matches ExplorationBoard.
              aria-pressed={selectedId === version.id}
              className={cn(
                "h-auto w-full justify-start px-3 py-2 text-left",
                selectedId === version.id && "ring-2 ring-ring",
              )}
              onClick={() => onSelect(version.id)}
              type="button"
              variant="outline"
            >
              <span className="flex w-full items-center justify-between gap-3">
                <span>
                  <span className="block font-medium text-sm">
                    v{index + 1} {version.name}
                  </span>
                  <span className="block text-muted-foreground text-xs">
                    {version.finish}
                    {version.clean ? " · clean" : " · dirty"}
                  </span>
                </span>
                <span
                  className="size-8 text-foreground [&_svg]:size-8"
                  // oxlint-disable-next-line react/no-danger -- house SVG thumbnail
                  dangerouslySetInnerHTML={{
                    __html: safeStudioSvg(version.svg),
                  }}
                />
              </span>
            </Button>
          </li>
        ))}
      </ol>
    )}
  </aside>
);

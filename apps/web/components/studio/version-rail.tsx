"use client";

import { Button } from "@/components/ui/button";
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
  <aside className="flex flex-col gap-2">
    <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">Versions</p>
    {versions.length === 0 ? (
      <p className="text-muted-foreground text-sm">
        Each draw lands here. Chat to branch a new one.
      </p>
    ) : (
      <ol className="flex max-h-64 flex-col gap-2 overflow-y-auto sm:max-h-none">
        {versions.map((version, index) => (
          <li key={version.id}>
            <Button
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
                    __html: version.svg.includes("<script") ? "" : version.svg,
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

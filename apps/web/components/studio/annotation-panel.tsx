"use client";

import X from "blode-icons-react/icons/x";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { StudioAnnotation, StudioVersion } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

export const AnnotationPanel = ({
  annotations,
  onDelete,
  onRefine,
  onSelect,
  onTextChange,
  selectedId,
  version,
}: {
  annotations: readonly StudioAnnotation[];
  onDelete: (id: string) => void;
  onRefine: (annotations: readonly StudioAnnotation[]) => void;
  onSelect: (id: string) => void;
  onTextChange: (id: string, text: string) => void;
  selectedId: string | null;
  version: StudioVersion | null;
}) => {
  const visible = version
    ? annotations.filter((annotation) => annotation.versionId === version.id)
    : [];
  const ready = visible.filter((annotation) => annotation.text.trim().length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">Comments</h2>
        <p className="text-pretty text-base text-muted-foreground sm:text-sm">
          Comments stay attached to this exact version. They only affect a draw when you choose
          refine.
        </p>
      </div>

      {version ? null : (
        <div className="flex flex-col gap-1 border-t pt-4">
          <p className="font-medium">No version selected</p>
          <p className="text-base text-muted-foreground sm:text-sm">
            Draw or select an icon before adding a comment.
          </p>
        </div>
      )}

      {version && visible.length === 0 ? (
        <div className="flex flex-col gap-1 border-t pt-4">
          <p className="font-medium">No comments on this version</p>
          <p className="text-base text-muted-foreground sm:text-sm">
            Choose Comment above the canvas, then click the region you want to discuss.
          </p>
        </div>
      ) : null}

      {visible.length > 0 ? (
        <ol className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          {visible.map((annotation, index) => (
            <li
              className={cn(
                "flex flex-col gap-2 rounded-xl border p-3",
                selectedId === annotation.id && "border-ring bg-accent",
              )}
              key={annotation.id}
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  className="flex min-w-0 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  onClick={() => onSelect(annotation.id)}
                  type="button"
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary font-mono text-primary-foreground text-xs">
                    {index + 1}
                  </span>
                  <span className="truncate font-medium text-sm">{version?.name ?? "Version"}</span>
                </button>
                <Button
                  aria-label={`Delete comment ${index + 1}`}
                  onClick={() => onDelete(annotation.id)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <X />
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                  />
                </Button>
              </div>
              <Textarea
                aria-label={`Comment ${index + 1}`}
                className="min-h-24"
                name={`annotation-${annotation.id}`}
                onChange={(event) => onTextChange(annotation.id, event.target.value)}
                onFocus={() => onSelect(annotation.id)}
                placeholder="What should change here?"
                value={annotation.text}
              />
            </li>
          ))}
        </ol>
      ) : null}

      {ready.length > 0 ? (
        <div className="border-t pt-3">
          <Button
            className="w-full"
            onClick={() => onRefine(ready)}
            size="sm"
            type="button"
            variant="outline"
          >
            Refine from {ready.length} open {ready.length === 1 ? "comment" : "comments"}
          </Button>
        </div>
      ) : null}
    </div>
  );
};

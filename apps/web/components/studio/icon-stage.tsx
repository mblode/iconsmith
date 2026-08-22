"use client";

import ChatBubble from "blode-icons-react/icons/chat-bubble-7";
import type { CSSProperties, MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import { safeStudioSvg } from "@/lib/studio/svg";
import { cn } from "@/lib/utils";
import type { StudioAnnotation, StudioFinish, StudioVersion } from "@/lib/studio/types";

const SIZES = [16, 24, 48, 128] as const;

const copy = async (value: string) => {
  await navigator.clipboard.writeText(value);
};

export const IconStage = ({
  annotationMode,
  annotations,
  finish,
  onAnnotate,
  onAnnotationModeChange,
  onFinish,
  onSelectAnnotation,
  selectedAnnotationId,
  version,
}: {
  annotationMode: boolean;
  annotations: readonly StudioAnnotation[];
  finish: StudioFinish;
  onAnnotate: (point: { x: number; y: number }) => void;
  onAnnotationModeChange: (active: boolean) => void;
  onFinish: (finish: StudioFinish) => void;
  onSelectAnnotation: (id: string) => void;
  selectedAnnotationId: string | null;
  version: StudioVersion | null;
}) => {
  const svg = version ? safeStudioSvg(version.svg) : "";
  const visibleAnnotations = version
    ? annotations.filter((annotation) => annotation.versionId === version.id)
    : [];

  const placeAnnotation = (event: MouseEvent<HTMLButtonElement>) => {
    if (!version) {
      return;
    }
    if (event.detail === 0) {
      onAnnotate({ x: 50, y: 50 });
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    onAnnotate({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    });
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
          {version ? `${version.name} · ${version.finish}` : "Stage"}
        </p>
        <div className="flex flex-wrap justify-end gap-1">
          <Button
            aria-pressed={annotationMode}
            disabled={!version}
            onClick={() => onAnnotationModeChange(!annotationMode)}
            size="sm"
            type="button"
            variant={annotationMode ? "outline" : "ghost"}
          >
            <ChatBubble />
            {annotationMode ? "Click the icon" : "Comment"}
          </Button>
          {(["outlined", "filled"] as const).map((paint) => (
            <Button
              aria-pressed={finish === paint}
              key={paint}
              onClick={() => onFinish(paint)}
              size="sm"
              type="button"
              variant={finish === paint ? "default" : "ghost"}
            >
              {paint}
            </Button>
          ))}
        </div>
      </div>

      <div
        className="relative flex min-h-64 flex-1 items-center justify-center overflow-hidden rounded-2xl border bg-card"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        {annotationMode && version ? (
          <button
            aria-label="Place a comment on the selected icon"
            className="absolute inset-0 z-10 cursor-crosshair outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
            onClick={placeAnnotation}
            type="button"
          />
        ) : null}
        {svg ? (
          <div
            className="pointer-events-none text-foreground [&_svg]:size-40"
            // oxlint-disable-next-line react/no-danger -- house SVG from iconsmith; scripts stripped above
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <p className="max-w-[24ch] text-balance text-center text-muted-foreground text-sm">
            Type an object. The drawer returns a program, never a free path.
          </p>
        )}
        {visibleAnnotations.map((annotation, index) => (
          <button
            aria-label={`Open comment ${index + 1}: ${annotation.text || "Draft comment"}`}
            className={cn(
              "absolute z-20 grid size-7 -translate-1/2 place-items-center rounded-full bg-primary font-mono text-primary-foreground text-xs outline-none ring-2 ring-card focus-visible:ring-[3px] focus-visible:ring-ring",
              selectedAnnotationId === annotation.id && "ring-[3px] ring-ring",
            )}
            key={annotation.id}
            onClick={() => onSelectAnnotation(annotation.id)}
            style={
              {
                "--annotation-x": `${annotation.x}%`,
                "--annotation-y": `${annotation.y}%`,
                left: "var(--annotation-x)",
                top: "var(--annotation-y)",
              } as CSSProperties
            }
            type="button"
          >
            {index + 1}
            <span
              aria-hidden="true"
              className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
            />
          </button>
        ))}
      </div>

      {version ? (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end gap-3">
            {SIZES.map((size) => (
              <div className="flex flex-col items-center gap-1" key={size}>
                <div
                  className={cn(
                    "text-foreground [&_svg]:h-full [&_svg]:w-full",
                    size >= 48 && "rounded-lg bg-card p-2 shadow-xs",
                  )}
                  // oxlint-disable-next-line react/no-danger -- same house SVG at optical sizes
                  dangerouslySetInnerHTML={{ __html: svg }}
                  style={{ height: size, width: size }}
                />
                <span className="font-mono text-[10px] text-muted-foreground">{size}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => copy(version.svg)} size="sm" type="button" variant="outline">
              Copy SVG
            </Button>
            <Button onClick={() => copy(version.program)} size="sm" type="button" variant="outline">
              Copy program
            </Button>
            <Button
              onClick={() => {
                const blob = new Blob([version.svg], { type: "image/svg+xml" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.download = `${version.name}-${version.finish}.svg`;
                link.href = url;
                link.click();
                URL.revokeObjectURL(url);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Download
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
};

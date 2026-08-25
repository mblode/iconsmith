"use client";

import type { CSSProperties, MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { sanitizeStudioSvg } from "@iconsmith/contract/svg";
import { cn } from "@/lib/utils";
import type { StudioAnnotation, StudioVersion } from "@iconsmith/contract/types";

const SIZES = [16, 24, 48, 128] as const;

const copy = async (value: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Clipboard access is refused in insecure contexts and by permission.
    return false;
  }
};

export const IconStage = ({
  annotationMode,
  annotations,
  onAnnotate,
  onSelectAnnotation,
  selectedAnnotationId,
  version,
}: {
  annotationMode: boolean;
  annotations: readonly StudioAnnotation[];
  onAnnotate: (point: { x: number; y: number }) => void;
  onSelectAnnotation: (id: string) => void;
  selectedAnnotationId: string | null;
  version: StudioVersion | null;
}) => {
  const rendered = version ? sanitizeStudioSvg(version.svg) : null;
  const svg = rendered?.svg ?? "";
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (noticeTimer.current) {
        clearTimeout(noticeTimer.current);
      }
    },
    [],
  );

  const report = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
    }
    noticeTimer.current = setTimeout(() => setNotice(""), 4000);
  };
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
      {/* The artboard is chrome for an icon. With nothing drawn it was a large
          bordered void, so it only appears once there is something to hold. */}
      <div
        className={cn(
          "relative flex min-h-64 flex-1 items-center justify-center overflow-hidden",
          svg && "rounded-xl border bg-card",
        )}
        style={
          svg
            ? {
                backgroundImage:
                  "linear-gradient(to right, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px)",
                backgroundSize: "24px 24px",
              }
            : undefined
        }
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
          <p className="max-w-[26ch] text-balance text-center text-base text-muted-foreground">
            Type an object. The drawer returns a program, never a free path.
          </p>
        )}
        {rendered?.status === "unsafe" ? (
          /* A rejected construct is a pipeline fault, not a user error. Say so
             rather than silently showing the stripped remainder as if clean. */
          <p
            className="absolute inset-x-3 bottom-3 z-20 rounded-lg bg-destructive/10 px-3 py-2 text-center text-destructive text-xs"
            role="alert"
          >
            Unsafe markup was removed from this render. The icon below is the stripped remainder —
            redraw before exporting it.
          </p>
        ) : null}
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
                    size >= 48 && "rounded-lg bg-card p-2",
                  )}
                  // oxlint-disable-next-line react/no-danger -- same house SVG at optical sizes
                  dangerouslySetInnerHTML={{ __html: svg }}
                  style={{ height: size, width: size }}
                />
                <span className="font-mono text-[10px] text-muted-foreground">{size}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={async () => {
                report(
                  (await copy(version.svg))
                    ? "SVG copied"
                    : "Could not reach the clipboard. Select the SVG and copy it.",
                );
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Copy SVG
            </Button>
            <Button
              onClick={async () => {
                report(
                  (await copy(version.program))
                    ? "Program copied"
                    : "Could not reach the clipboard. Select the program and copy it.",
                );
              }}
              size="sm"
              type="button"
              variant="outline"
            >
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
                // Revoking in the same tick can cancel the download in Safari.
                setTimeout(() => URL.revokeObjectURL(url), 10_000);
                report(`Downloaded ${link.download}`);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Download
            </Button>
            {/* Three of the four footer actions previously gave no sign they
                had run at all. */}
            <output aria-live="polite" className="text-muted-foreground text-xs">
              {notice}
            </output>
          </div>
        </div>
      ) : null}
    </section>
  );
};

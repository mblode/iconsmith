"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StudioFinish, StudioVersion } from "@/lib/studio/types";

const SIZES = [16, 24, 48, 128] as const;

const safeSvg = (svg: string): string => {
  if (!svg.includes("<svg") || /<script/iu.test(svg)) {
    return "";
  }
  return svg.replaceAll("<title", "<!--").replaceAll("</title>", "-->");
};

const copy = async (value: string) => {
  await navigator.clipboard.writeText(value);
};

export const IconStage = ({
  finish,
  onFinish,
  version,
}: {
  finish: StudioFinish;
  onFinish: (finish: StudioFinish) => void;
  version: StudioVersion | null;
}) => {
  const svg = version ? safeSvg(version.svg) : "";

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
          {version ? `${version.name} · ${version.finish}` : "Stage"}
        </p>
        <div className="flex gap-1">
          {(["outlined", "filled"] as const).map((paint) => (
            <Button
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
        className="relative flex min-h-64 flex-1 items-center justify-center rounded-3xl border bg-card shadow-xs"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        {svg ? (
          <div
            className="text-foreground [&_svg]:h-40 [&_svg]:w-40"
            // oxlint-disable-next-line react/no-danger -- house SVG from iconsmith; scripts stripped above
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <p className="max-w-[24ch] text-balance text-center text-muted-foreground text-sm">
            Type an object. The drawer returns a program, never a free path.
          </p>
        )}
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

/**
 * One sanitiser, at the strongest strength any caller needs.
 *
 * There used to be two: a strict one guarding third-party markup in the library
 * route, and a weaker one guarding model output before four
 * `dangerouslySetInnerHTML` sites. The weak one only rejected `<script`, so an
 * `onload=` handler or an `<image href>` reached the DOM. Same threat, same
 * sink, so it gets the same guard.
 */

export type StudioSvgStatus = "ok" | "empty" | "unsafe";

export interface StudioSvg {
  /** Render-safe markup. Empty when `status` is `"empty"`. */
  readonly svg: string;
  readonly status: StudioSvgStatus;
}

const DANGEROUS: readonly RegExp[] = [
  /<script\b[^>]*>[\s\S]*?<\/script>/giu,
  /<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/giu,
  /<image\b[^>]*\/?\s*>/giu,
  /\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/giu,
  /\s(?:href|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*')/giu,
];

/**
 * Strips every dangerous construct and reports whether it had to.
 *
 * `unsafe` still carries renderable markup: the stripped remainder is the icon
 * the pipeline meant to draw, and showing it beside a warning tells the user
 * more than a blank pane does.
 */
export const sanitizeStudioSvg = (svg: string): StudioSvg => {
  if (!svg.includes("<svg")) {
    return { status: "empty", svg: "" };
  }

  let cleaned = svg;
  let stripped = false;
  for (const pattern of DANGEROUS) {
    const next = cleaned.replaceAll(pattern, "");
    if (next !== cleaned) {
      stripped = true;
      cleaned = next;
    }
  }

  // A rendered <title> shows as visible text rather than metadata.
  cleaned = cleaned.replaceAll("<title", "<!--").replaceAll("</title>", "-->");

  return { status: stripped ? "unsafe" : "ok", svg: cleaned };
};

/** Markup only, for call sites that cannot act on the status. */
export const safeStudioSvg = (svg: string): string => sanitizeStudioSvg(svg).svg;

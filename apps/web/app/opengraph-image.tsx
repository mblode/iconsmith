import { renderZoneOgImage } from "@/app/og-image-shared";
import { OgLogo } from "@/app/og-logo";

export { OG_CONTENT_TYPE as contentType, OG_SIZE as size } from "@/app/og-image-shared";

export const alt = "Iconsmith: icons that cannot drift";

/**
 * The house card (Rule 12). A generated route, which is what makes Rule 11 hold:
 * `metadataBase` is the zone URL and a generated route is not `basePath`
 * -prefixed, so the two cannot stack into `/iconsmith/iconsmith/...`.
 *
 * There is deliberately no `twitter-image.tsx`: Next reuses this route for
 * `twitter:image`.
 *
 * Colours are hand-synced sRGB literals. Satori parses neither `oklch` nor CSS
 * variables, so it cannot read the tokens in globals.css.
 */
export default function OpengraphImage() {
  return renderZoneOgImage({
    background: "#111111",
    color: "#f5f5f4",
    logo: <OgLogo />,
    title: "Iconsmith",
  });
}

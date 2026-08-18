/**
 * The share mark is the product's own output.
 *
 * These two paths are verbatim what the CLI emits for the `square-check`
 * program shown on the landing page, so the card is drawn by the thing it
 * advertises. Regenerate with:
 *
 *   printf 'icon square-check\nkeyline square\nrect 4,4 16x16 r3\nline 8,12 11,15 16,10\nfit\n' \
 *     | node packages/iconsmith/dist/cli.js draw -
 *
 * `currentColor` is resolved to a literal here: Satori has no cascade to
 * inherit it from. There is deliberately no <title> either: Satori has no
 * accessibility tree to put it in, so it lays it out as visible text on top of
 * the mark. The card carries its own `alt` from opengraph-image.tsx.
 */
const SQUARE =
  "M7 4L17 4C18.6569 4 20 5.3431 20 7L20 17C20 18.6569 18.6569 20 17 20L7 20C5.3431 20 4 18.6569 4 17L4 7C4 5.3431 5.3431 4 7 4Z";
const CHECK = "M8 12L11 15L16 10";

export const OgLogo = () => (
  <svg fill="none" height={72} viewBox="0 0 24 24" width={72} xmlns="http://www.w3.org/2000/svg">
    <path
      d={SQUARE}
      stroke="#f5f5f4"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
    />
    <path d={CHECK} stroke="#f5f5f4" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
  </svg>
);

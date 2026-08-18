/**
 * Verbatim output of the `square-check` program shown beside it on the page.
 * Not hand-drawn: the point of the section is that this markup is what the
 * library produced, so it is pasted rather than authored. Regenerate with:
 *
 *   printf 'icon square-check\nkeyline square\nrect 4,4 16x16 r3\nline 8,12 11,15 16,10\nfit\n' \
 *     | node packages/iconsmith/dist/cli.js draw -
 */
export const SquareCheckIcon = ({ className }: { className?: string }) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="none"
    height="24"
    viewBox="0 0 24 24"
    width="24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M7 4L17 4C18.6569 4 20 5.3431 20 7L20 17C20 18.6569 18.6569 20 17 20L7 20C5.3431 20 4 18.6569 4 17L4 7C4 5.3431 5.3431 4 7 4Z"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
    <path
      d="M8 12L11 15L16 10"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  </svg>
);

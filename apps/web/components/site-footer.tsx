import { REPO_URL } from "@/lib/site-url";

/**
 * Zone rule 1: blode.co/iconsmith is the same origin as blode.co, so the credit
 * is an internal link. Same tab, and no `rel="noopener noreferrer"`, which only
 * means something cross-origin.
 *
 * An absolute href rather than `next/link` with `/`: a bare `/` is not
 * basePath-prefixed, so it would point at blode.co's own home page from a
 * preview deployment and at the wrong place from the zone origin.
 *
 * The GitHub link is genuinely off site and keeps both.
 */
export const SiteFooter = () => (
  <footer className="mx-auto w-full max-w-[900px] px-6 py-16 text-sm">
    <p className="text-foreground/60">
      Built by{" "}
      <a className="underline underline-offset-2" href="https://blode.co" rel="author">
        Matthew Blode
      </a>
      {". "}
      <a
        className="underline underline-offset-2"
        href={REPO_URL}
        rel="noopener noreferrer"
        target="_blank"
      >
        GitHub
      </a>
    </p>
  </footer>
);

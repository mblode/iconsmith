import { REPO_URL, siteConfig, SITE_URL } from "@/lib/site-url";

export const dynamic = "force-static";

/**
 * RFC 9727 API Catalog, served as an RFC 9264 linkset.
 *
 * One anchor only. The obvious second anchor would list downloadable artifacts
 * under `item`, but nothing is published yet, and a catalog of links that 404
 * is worse than a catalog that stays quiet about them. Add the npm tarball and
 * the registry metadata when there is a release to point at.
 */
export const GET = () => {
  const body = {
    linkset: [
      {
        anchor: SITE_URL,
        describedby: [
          {
            href: `${SITE_URL}/.well-known/agent-skills/iconsmith-dsl/SKILL.md`,
            title: "The icon DSL",
            type: "text/markdown",
          },
        ],
        "service-desc": [
          {
            href: `${REPO_URL}/releases`,
            title: "Releases",
            type: "text/html",
          },
        ],
        "service-doc": [
          {
            href: REPO_URL,
            title: `${siteConfig.name} source and README`,
            type: "text/html",
          },
        ],
        status: [{ href: SITE_URL, title: siteConfig.name, type: "text/html" }],
      },
    ],
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "application/linkset+json; charset=utf-8",
    },
  });
};

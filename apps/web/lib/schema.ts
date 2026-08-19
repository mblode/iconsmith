import { SITE_NAME, SITE_TAGLINE, siteConfig, SITE_URL } from "./site-url";

const HOST = "https://blode.co";

/**
 * Every `@id` in the graph, in one place.
 *
 * The host-level ids belong to blode.co and are only ever *referenced* here.
 * Giving any of them a body would mint a second Person or Organization for the
 * same entity, which is zone rule 2. `as const` makes a typo in a
 * cross-reference a type error rather than a silently orphaned node.
 */
export const schemaId = {
  breadcrumb: `${SITE_URL}/#breadcrumb`,
  organization: `${HOST}/#organization`,
  person: `${HOST}/#person`,
  software: `${SITE_URL}/#software`,
  webPage: `${SITE_URL}/#webpage`,
  website: `${HOST}/#website`,
} as const;

export const siteGraph = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@id": schemaId.webPage,
      "@type": "WebPage",
      about: { "@id": schemaId.software },
      breadcrumb: { "@id": schemaId.breadcrumb },
      description: SITE_TAGLINE,
      inLanguage: "en-US",
      isPartOf: { "@id": schemaId.website },
      name: `${SITE_NAME}: icons that cannot drift`,
      publisher: { "@id": schemaId.organization },
      url: SITE_URL,
    },
    {
      "@id": schemaId.software,
      "@type": "SoftwareApplication",
      applicationCategory: "DeveloperApplication",
      author: { "@id": schemaId.person },
      description: SITE_TAGLINE,
      name: SITE_NAME,
      /*
       * No `offers`, and no `aggregateRating`. Google's Software App rich
       * result wants `offers` plus a rating, and its review guidelines forbid
       * ratings we author about our own work, so a rating here could only ever
       * fail validation. `offers` follows once this is actually installable,
       * with a numeric `price: 0` rather than the string "0", which
       * schema.org reads as a currency-formatted literal.
       */
      operatingSystem: "Node.js",
      publisher: { "@id": schemaId.organization },
      softwareVersion: siteConfig.version,
      url: SITE_URL,
    },
    {
      "@id": schemaId.breadcrumb,
      "@type": "BreadcrumbList",
      /*
       * These names must match the visible trail in `<ZoneBreadcrumb>` exactly.
       * `check-zones` diffs the two.
       */
      itemListElement: [
        {
          "@type": "ListItem",
          item: `${HOST}/`,
          // Not "Home". This crumb is the one piece of chrome above the fold on
          // every zone, so it says who made the thing.
          name: siteConfig.author.name,
          position: 1,
        },
        {
          "@type": "ListItem",
          item: `${HOST}/projects`,
          name: "Projects",
          position: 2,
        },
        {
          "@type": "ListItem",
          item: SITE_URL,
          name: SITE_NAME,
          position: 3,
        },
      ],
    },
  ],
};

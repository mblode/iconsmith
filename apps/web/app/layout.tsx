import type { Metadata } from "next";
import localFont from "next/font/local";

import "./globals.css";
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site-url";

const glide = localFont({
  adjustFontFallback: "Arial",
  display: "swap",
  src: [
    { path: "./fonts/glide-variable.woff2", style: "normal" },
    { path: "./fonts/glide-variable-italic.woff2", style: "italic" },
  ],
  variable: "--font-glide",
  // The full variable axis. Narrowing it silently clamps the heavy end, so
  // font-black renders at the cap rather than failing visibly.
  weight: "100 950",
});

const glideMono = localFont({
  adjustFontFallback: "Arial",
  display: "swap",
  src: "./fonts/glide-mono.woff2",
  variable: "--font-glide-mono",
  weight: "400",
});

// `Product: what it does`, colon rather than a dash, under 60 characters so it
// does not truncate in the SERP.
const TITLE = "Iconsmith: icons that cannot drift";

export const metadata: Metadata = {
  alternates: {
    canonical: SITE_URL,
  },
  authors: [{ name: "Matthew Blode", url: "https://blode.co" }],
  creator: "Matthew Blode",
  description: SITE_TAGLINE,
  keywords: [
    "icon generation",
    "icon design system",
    "SVG icons",
    "design tokens",
    "AI icon design",
    "icon set consistency",
  ],
  // The zone URL, not the bare origin (Rule 11). Correct because the card is a
  // generated `opengraph-image.tsx` route: Next does not prefix those with
  // `basePath`, so `metadataBase` supplies the prefix exactly once. Shipping a
  // static opengraph-image.png instead is the doubled-path bug that broke a
  // sibling zone's card for months.
  metadataBase: new URL(SITE_URL),
  openGraph: {
    description: SITE_TAGLINE,
    locale: "en_US",
    // Every blode.co path shares one site name. The product is already in
    // og:title, so this slot says who made it. See zone-conventions.md Rule 9.
    siteName: "Matthew Blode",
    title: TITLE,
    type: "website",
    // No `url` key, deliberately (Rule 10). A child declaring it replaces the
    // whole object and loses og:site_name and og:image with it. Absent beats
    // wrong: consumers fall back to the URL they fetched, and
    // `alternates.canonical` is already per page and correct.
  },
  robots: {
    follow: true,
    googleBot: {
      follow: true,
      index: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
    index: true,
  },
  title: {
    default: TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  twitter: {
    // Only `card` plus the handles. Putting title and description here makes
    // every inner route share as the home page, because a child that declares
    // no twitter block inherits this one wholesale.
    card: "summary_large_image",
    creator: "@mattblode",
    site: "@mattblode",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@id": `${SITE_URL}/#webpage`,
      "@type": "WebPage",
      about: { "@id": `${SITE_URL}/#software` },
      breadcrumb: { "@id": `${SITE_URL}/#breadcrumb` },
      description: SITE_TAGLINE,
      inLanguage: "en-US",
      // Referenced by @id only. Defining these bodies here would mint a second
      // Person and Organization on blode.co. See Rules 2 and 3.
      isPartOf: { "@id": "https://blode.co/#website" },
      name: TITLE,
      publisher: { "@id": "https://blode.co/#organization" },
      url: SITE_URL,
    },
    {
      "@id": `${SITE_URL}/#software`,
      "@type": "SoftwareApplication",
      applicationCategory: "DeveloperApplication",
      author: { "@id": "https://blode.co/#person" },
      description: SITE_TAGLINE,
      name: SITE_NAME,
      // No `offers` and no `aggregateRating`. It is not released, and neither
      // is true yet.
      operatingSystem: "Node.js",
      publisher: { "@id": "https://blode.co/#organization" },
      url: SITE_URL,
    },
    {
      "@id": `${SITE_URL}/#breadcrumb`,
      "@type": "BreadcrumbList",
      // These names must match the visible trail in <ZoneBreadcrumb> exactly;
      // check-zones diffs the two.
      itemListElement: [
        {
          "@type": "ListItem",
          item: "https://blode.co/",
          // Not "Home". This crumb is the one piece of chrome above the fold on
          // every zone, so it says who made the thing.
          name: "Matthew Blode",
          position: 1,
        },
        {
          "@type": "ListItem",
          item: "https://blode.co/projects",
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

const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => (
  <html className={`${glide.variable} ${glideMono.variable}`} lang="en">
    <head>
      <link href={process.env.NEXT_PUBLIC_POSTHOG_HOST} rel="preconnect" />
      <script id="json-ld" type="application/ld+json">
        {JSON.stringify(jsonLd)}
      </script>
    </head>
    <body className="font-sans antialiased">{children}</body>
  </html>
);

export default RootLayout;

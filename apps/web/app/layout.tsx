import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Agentation } from "agentation";

import "./globals.css";
import { JsonLd } from "@/components/json-ld";
import { WebMcp } from "@/components/web-mcp";
import { siteGraph } from "@/lib/schema";
import { SITE_NAME, SITE_TAGLINE, siteConfig, SITE_URL } from "@/lib/site-url";

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
  authors: [siteConfig.author],
  creator: siteConfig.author.name,
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
    siteName: siteConfig.author.name,
    // `default` plus `template`, so an inner route that declares its own
    // `openGraph` without a title still carries the product name. Rule 8.
    title: { default: TITLE, template: `%s | ${SITE_NAME}` },
    type: "website",
    // No `url` key, deliberately (Rule 10). A child declaring it replaces the
    // whole object and loses og:site_name and og:image with it. Absent beats
    // wrong: consumers fall back to the URL they fetched, and
    // `alternates.canonical` is already per page and correct.
  },
  other: { "apple-mobile-web-app-title": SITE_NAME },
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

const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => (
  <html className={`${glide.variable} ${glideMono.variable}`} lang="en">
    <head>
      <link href={process.env.NEXT_PUBLIC_POSTHOG_HOST} rel="preconnect" />
    </head>
    <body className="font-sans antialiased">
      <JsonLd data={siteGraph} />
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:font-medium focus:text-sm focus:shadow-lg focus:ring-2 focus:ring-ring"
        href="#main-content"
      >
        Skip to content
      </a>
      {children}
      <WebMcp />
      {process.env.NODE_ENV === "development" && <Agentation />}
    </body>
  </html>
);

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f4f3ef",
};

export default RootLayout;

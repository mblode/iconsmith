import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

/**
 * The zone root is the only indexable URL here.
 *
 * `/subscribed` is deliberately absent: it is `noindex`, and listing a noindex
 * URL contradicts the page itself. Search Console reports that as "Submitted
 * URL marked noindex" rather than treating it as a hint.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      changeFrequency: "monthly",
      lastModified: new Date(),
      priority: 1,
      url: SITE_URL,
    },
  ];
}

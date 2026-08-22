import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

/**
 * Zone URLs this app owns. The host sitemap at blode.co does not list children.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      changeFrequency: "monthly",
      lastModified: new Date(),
      priority: 1,
      url: SITE_URL,
    },
    {
      changeFrequency: "weekly",
      lastModified: new Date(),
      priority: 0.8,
      url: `${SITE_URL}/studio`,
    },
  ];
}

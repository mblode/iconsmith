import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

/**
 * The zone root is the only URL here, so it is the only entry.
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

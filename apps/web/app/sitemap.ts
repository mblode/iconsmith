import type { MetadataRoute } from "next";
import { studioAvailable } from "@/lib/studio-availability";
import { SITE_URL } from "@/lib/site-url";

/**
 * Zone URLs this app owns. The host sitemap at blode.co does not list children.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      changeFrequency: "monthly",
      priority: 1,
      url: SITE_URL,
    },
    ...(studioAvailable()
      ? [
          {
            changeFrequency: "weekly" as const,
            priority: 0.8,
            url: `${SITE_URL}/studio`,
          },
        ]
      : []),
  ];
}

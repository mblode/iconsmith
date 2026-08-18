import type { MetadataRoute } from "next";
import { BASE_PATH, SITE_URL } from "@/lib/site-url";

const BASE_URL = SITE_URL;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      allow: BASE_PATH,
      userAgent: "*",
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}

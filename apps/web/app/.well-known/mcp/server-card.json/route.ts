import { SITE_NAME, siteConfig, SITE_URL } from "@/lib/site-url";

export const dynamic = "force-static";

/**
 * The discovery half of WebMCP. It advertises that this page provides tools in
 * the browser; the executable definitions, with their input schemas, live in
 * `components/web-mcp.tsx`. Tools here carry only a name and a description,
 * because a card is a teaser rather than a contract.
 */
export const GET = () => {
  const body = {
    $schema:
      "https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/well-known/server-card.schema.json",
    capabilities: { tools: { listChanged: false } },
    serverInfo: {
      name: `${SITE_NAME} WebMCP`,
      publisher: siteConfig.author,
      title: `${SITE_NAME} — ${siteConfig.description}`,
      version: siteConfig.version,
    },
    tools: [
      {
        description:
          "Get the parts vocabulary: every named mark the DSL can place, as SVG path data.",
        name: "get_vocabulary",
      },
      {
        description: "Get release status and where to read more. Pre-release; not on npm yet.",
        name: "get_status",
      },
      {
        description: "Scroll the page to the parts vocabulary grid.",
        name: "open_vocabulary",
      },
    ],
    transport: { type: "webmcp", url: SITE_URL },
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
};

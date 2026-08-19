import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { markdownByPath } from "@/lib/markdown";

/**
 * Content negotiation: the canonical URL returns Markdown to anything that asks
 * for it, so an agent reads the page without parsing HTML and without a second
 * URL to keep in sync.
 *
 * `proxy.ts` is Next 16's rename of `middleware.ts`: same position, same
 * matcher, same `NextResponse`.
 *
 * The basePath subtlety, which is inverted from everywhere else in this app:
 * `nextUrl.pathname` here is already basePath-*stripped*, so the zone root
 * arrives as `/` and the table is keyed `/`. Keying it `/iconsmith` would never
 * match. Compare `next.config.ts`, where `headers()` sources are
 * basePath-*prefixed*, and the `Link` header value, which is neither.
 */
export const proxy = (request: NextRequest) => {
  const accept = request.headers.get("accept") ?? "";

  if (!/\btext\/markdown\b/iu.test(accept)) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname.replace(/\/+$/u, "") || "/";
  const body = markdownByPath[pathname];

  if (!body) {
    return NextResponse.next();
  }

  return new NextResponse(body, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/markdown; charset=utf-8",
      // Mandatory. Without it a CDN caches this response and serves Markdown
      // to browsers, or caches the HTML and serves it to agents.
      Vary: "Accept",
      // A rough token count, so an agent can budget before reading the body.
      "x-markdown-tokens": String(Math.ceil(body.length / 4)),
    },
    status: 200,
  });
};

export const config = { matcher: ["/"] };

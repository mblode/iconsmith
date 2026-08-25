import type { NextRequest } from "next/server";

import { safeStudioSvg } from "@iconsmith/contract/svg";
import type { StudioLibraryResponse, StudioLibraryResult } from "@iconsmith/contract/types";

export const runtime = "nodejs";

const SOURCES = new Map([
  ["lucide", "Lucide"],
  ["ph", "Phosphor"],
  ["tabler", "Tabler Icons"],
]);

interface IconifyCollection {
  readonly author?: { readonly url?: string };
  readonly license?: {
    readonly spdx?: string;
    readonly title?: string;
    readonly url?: string;
  };
  readonly name?: string;
}

interface IconifySearch {
  readonly collections?: Readonly<Record<string, IconifyCollection>>;
  readonly icons?: readonly string[];
}

const asDataUrl = (svg: string): string =>
  `data:image/svg+xml;base64,${Buffer.from(safeStudioSvg(svg)).toString("base64")}`;

const iconOf = async (
  id: string,
  collections: Readonly<Record<string, IconifyCollection>>,
): Promise<StudioLibraryResult | null> => {
  const [prefix, name] = id.split(":");
  const source = prefix ? SOURCES.get(prefix) : undefined;
  if (!(prefix && name && source)) {
    return null;
  }
  const response = await fetch(
    `https://api.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg?height=none`,
    { next: { revalidate: 86_400 }, signal: AbortSignal.timeout(5000) },
  );
  if (!response.ok) {
    return null;
  }
  const svg = await response.text();
  if (!svg.startsWith("<svg") || svg.length > 100_000) {
    return null;
  }
  const collection = collections[prefix];
  const license = collection?.license;
  return {
    dataUrl: asDataUrl(svg),
    id,
    license: license?.spdx ?? license?.title ?? "See source",
    licenseUrl: license?.url ?? `https://icon-sets.iconify.design/${prefix}/`,
    name,
    source: collection?.name ?? source,
    sourceUrl: collection?.author?.url ?? `https://icon-sets.iconify.design/${prefix}/`,
  };
};

export const GET = async (request: NextRequest): Promise<Response> => {
  const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
  if (query.length < 2 || query.length > 80) {
    const body: StudioLibraryResponse = { results: [] };
    return Response.json(body);
  }

  try {
    const response = await fetch(
      `https://api.iconify.design/search?query=${encodeURIComponent(query)}&limit=256`,
      { next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) {
      throw new Error(`Iconify search returned ${response.status}`);
    }
    const body = (await response.json()) as IconifySearch;
    const candidates = (body.icons ?? [])
      .filter((id) => SOURCES.has(id.split(":")[0] ?? ""))
      .slice(0, 18);
    const loaded = await Promise.all(candidates.map((id) => iconOf(id, body.collections ?? {})));
    const results = loaded.filter((result): result is StudioLibraryResult => result !== null);
    const output: StudioLibraryResponse = { results };
    return Response.json(output, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch {
    const body: StudioLibraryResponse = { degraded: true, results: [] };
    return Response.json(body, { status: 503 });
  }
};

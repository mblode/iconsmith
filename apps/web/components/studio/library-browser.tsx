"use client";

import Search from "blode-icons-react/icons/search-menu";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { asset } from "@/lib/site-url";
import type {
  StudioAttachment,
  StudioLibraryResponse,
  StudioLibraryResult,
} from "@/lib/studio/types";

export const LibraryBrowser = ({
  onAttach,
}: {
  onAttach: (attachment: StudioAttachment) => void;
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly StudioLibraryResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    const next = query.trim();
    if (next.length < 2 || busy) {
      return;
    }
    setBusy(true);
    setFault(null);
    setSearched(true);
    try {
      const response = await fetch(
        `${asset("/api/studio/library")}?query=${encodeURIComponent(next)}`,
      );
      const body = (await response.json()) as StudioLibraryResponse;
      if (!response.ok || body.degraded) {
        throw new Error("Library search is unavailable. Your brief is still here — try again.");
      }
      setResults(body.results);
    } catch (error) {
      setResults([]);
      setFault(error instanceof Error ? error.message : "Library search failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">Search libraries</h2>
        <p className="text-pretty text-base text-muted-foreground sm:text-sm">
          Preview three open-source sets. Iconsmith receives the name and source, never the path.
        </p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          await search();
        }}
      >
        <Input
          aria-label="Search icon libraries"
          name="library-query"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="wifi, inbox, compass…"
          type="search"
          value={query}
        />
        <Button
          disabled={busy || query.trim().length < 2}
          size="sm"
          type="submit"
          variant="outline"
        >
          <Search />
          {busy ? "Searching" : "Search"}
        </Button>
      </form>

      {fault ? (
        <div className="flex flex-col gap-2 border-t pt-4" role="alert">
          <p className="text-base text-destructive sm:text-sm">{fault}</p>
          <Button onClick={search} size="sm" type="button" variant="outline">
            Try again
          </Button>
        </div>
      ) : null}

      {!fault && searched && results.length === 0 && !busy ? (
        <div className="flex flex-col gap-1 border-t pt-4">
          <p className="font-medium">No matching library icons</p>
          <p className="text-base text-muted-foreground sm:text-sm">
            Try the object noun or a broader synonym.
          </p>
        </div>
      ) : null}

      {searched ? null : (
        <div className="flex flex-col gap-1 border-t pt-4">
          <p className="font-medium">Search by object</p>
          <p className="text-base text-muted-foreground sm:text-sm">
            Results come from Lucide, Tabler, and Phosphor. The allowlist stays deliberately small.
          </p>
        </div>
      )}

      {results.length > 0 ? (
        <ul className="grid min-h-0 grid-cols-2 gap-2 overflow-y-auto pr-1">
          {results.map((result) => (
            <li className="min-w-0" key={result.id}>
              <article className="flex h-full flex-col gap-3 rounded-xl border bg-card p-3">
                {/* Iconify preview is isolated as an image. Its SVG never enters generation. */}
                {/* oxlint-disable-next-line nextjs/no-img-element -- data URL preview from the proxied icon catalogue */}
                <img
                  alt=""
                  className="size-10 self-center outline-1 -outline-offset-1 outline-foreground/5"
                  src={result.dataUrl}
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="truncate font-medium text-sm" title={result.name}>
                    {result.name}
                  </p>
                  <p className="truncate text-muted-foreground text-xs" title={result.source}>
                    {result.source}
                  </p>
                </div>
                <Button
                  className="w-full"
                  onClick={() =>
                    onAttach({
                      kind: "library",
                      name: result.name,
                      size: 0,
                      source: result.source,
                      type: "application/x-iconsmith-library-reference",
                    })
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Use name
                </Button>
                <p className="text-muted-foreground text-xs">
                  <a
                    className="underline underline-offset-2"
                    href={result.sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Source
                  </a>{" "}
                  ·{" "}
                  <a
                    className="underline underline-offset-2"
                    href={result.licenseUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {result.license}
                  </a>
                </p>
              </article>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

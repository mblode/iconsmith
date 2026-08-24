"use client";

import Search from "blode-icons-react/icons/search-menu";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { asset } from "@/lib/site-url";
import type {
  StudioAttachment,
  StudioLibraryResponse,
  StudioLibraryResult,
} from "@/lib/studio/types";

/** The proxy caps a search at this many icons, so the count can say so. */
const RESULT_CAP = 18;

interface NameGroup {
  readonly name: string;
  readonly previews: readonly StudioLibraryResult[];
  readonly sources: readonly string[];
}

/**
 * Collapses results to one row per name.
 *
 * Only the name is ever attached, so two sets drawing the same concept produce
 * an identical reference. Listing them separately offered a choice that changed
 * nothing; grouping them makes the row the thing you are actually picking, and
 * the previews show how the sets each read that word.
 */
const groupByName = (results: readonly StudioLibraryResult[]): NameGroup[] => {
  const groups = new Map<string, StudioLibraryResult[]>();
  for (const result of results) {
    const bucket = groups.get(result.name);
    if (bucket) {
      bucket.push(result);
    } else {
      groups.set(result.name, [result]);
    }
  }
  return [...groups.entries()].map(([name, rows]) => ({
    name,
    previews: rows.slice(0, 3),
    sources: [...new Set(rows.map((row) => row.source))],
  }));
};

export const LibraryBrowser = ({
  attached,
  full,
  onAttach,
}: {
  attached: readonly string[];
  full: boolean;
  onAttach: (attachment: StudioAttachment) => void;
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly StudioLibraryResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const groups = useMemo(() => groupByName(results), [results]);

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
        throw new Error("Library search is unavailable. Your brief is still here; try again.");
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
        <h2 className="font-medium">Reference a name</h2>
        <p className="text-pretty text-base text-muted-foreground sm:text-sm">
          Search how three open-source sets name an object. Iconsmith receives the word, never the
          path, so nothing here is traced.
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

      {!fault && searched && groups.length === 0 && !busy ? (
        <div className="flex flex-col gap-1 border-t pt-4">
          <p className="font-medium">No matching name</p>
          <p className="text-base text-muted-foreground sm:text-sm">
            Try the object noun or a broader synonym.
          </p>
        </div>
      ) : null}

      {searched ? null : (
        <div className="flex flex-col gap-1 border-t pt-4">
          <p className="font-medium">Search by object</p>
          <p className="text-base text-muted-foreground sm:text-sm">
            Type what the thing is, not what it means. A magnifying glass, not search.
          </p>
        </div>
      )}

      {groups.length > 0 ? (
        <>
          <p className="text-muted-foreground text-xs">
            {groups.length} {groups.length === 1 ? "name" : "names"} across{" "}
            {new Set(results.map((row) => row.source)).size} sets
            {results.length >= RESULT_CAP ? `, from the first ${RESULT_CAP} matches` : ""}.
            {full ? " Four references are already attached." : ""}
          </p>
          <ul className="-mr-1 flex min-h-0 flex-col gap-px overflow-y-auto pr-1">
            {groups.map((group) => {
              const added = attached.includes(group.name);
              return (
                <li key={group.name}>
                  <button
                    aria-label={`Reference the name ${group.name}`}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-55 disabled:hover:bg-transparent"
                    disabled={added || full}
                    onClick={() =>
                      onAttach({
                        kind: "library",
                        name: group.name,
                        size: 0,
                        source: group.sources.join(", "),
                        type: "application/x-iconsmith-library-reference",
                      })
                    }
                    type="button"
                  >
                    <span className="flex shrink-0 gap-1">
                      {group.previews.map((preview) => (
                        // Iconify preview is isolated as an image. Its SVG never enters generation.
                        // oxlint-disable-next-line nextjs/no-img-element -- data URL from the proxied catalogue
                        <img alt="" className="size-6" key={preview.id} src={preview.dataUrl} />
                      ))}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium text-sm">{group.name}</span>
                      <span className="truncate text-muted-foreground text-xs">
                        {group.sources.join(" · ")}
                      </span>
                    </span>
                    {added ? (
                      <span className="shrink-0 text-muted-foreground text-xs">Added</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {/* Attribution belongs once at the foot, not on every row. */}
          <p className="border-t pt-3 text-muted-foreground text-xs">
            Lucide (ISC), Tabler Icons (MIT) and Phosphor (MIT). Previews are fetched for display
            only.
          </p>
        </>
      ) : null}
    </div>
  );
};

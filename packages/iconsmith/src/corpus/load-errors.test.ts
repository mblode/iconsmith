/**
 * A missing corpus is the normal state of a fresh clone, not a broken install.
 *
 * The corpus is 62,550 third-party files and is gitignored, so the first thing
 * a new contributor runs is a command whose corpus is absent. What that command
 * says is the whole of their first impression, and `ENOENT ... open
 * 'corpus/corpus.json'` names neither what a corpus is nor how to point at one.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadCorpus } from "./load.js";

const temp = () => mkdtempSync(path.join(tmpdir(), "iconsmith-corpus-"));

describe("loadCorpus", () => {
  it("names the path, what a corpus is, and the flag that overrides it", async () => {
    await expect(loadCorpus(path.join(temp(), "absent"))).rejects.toThrow(
      /no such directory.*corpus\.json index.*--corpus <dir>/su
    );
  });

  it("reports bad input as INPUT, so a caller need not match on strings", async () => {
    let thrown: unknown;
    try {
      await loadCorpus(path.join(temp(), "absent"));
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { code: string }).code).toBe("INPUT");
    // The original is kept, so debugging the tool itself loses nothing.
    expect(((thrown as Error).cause as NodeJS.ErrnoException).code).toBe(
      "ENOENT"
    );
  });

  it("separates a corrupt index from a missing one — different fixes", async () => {
    const root = temp();
    writeFileSync(path.join(root, "corpus.json"), "{ not json");
    await expect(loadCorpus(root)).rejects.toThrow(/is not valid JSON/u);
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { loadAliases } from "./aliases.js";

const dir = mkdtempSync(path.join(tmpdir(), "aliases-"));
const write = (name: string, body: unknown): string => {
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(body));
  return file;
};

const central = write("central.json", {
  "square-arrow-top-right": { aliases: ["open", "Open Link"], category: "X" },
});
const house = write("_concepts.json", {
  concepts: { abduction: "ufo", "open link": "square-arrow-top-right" },
});

afterAll(() => rmSync(dir, { force: true, recursive: true }));

describe("loadAliases", () => {
  it("merges both sets into one table", async () => {
    const { aliases, from } = await loadAliases({ central, house });
    expect(aliases.get("ufo")).toEqual(["abduction"]);
    expect(aliases.get("square-arrow-top-right")).toEqual([
      "open",
      "open link",
    ]);
    expect(from).toHaveLength(2);
  });

  it("degrades to what it found when one source is absent", async () => {
    // `iconsmith parts` runs in a fresh clone, where `.corpus/` does not exist
    // and the blode-icons checkout may not be beside this one. A missing
    // sidecar is the normal case here, not a wrong argument.
    const { aliases, from } = await loadAliases({
      central: path.join(dir, "nope.json"),
      house,
    });
    expect(aliases.get("ufo")).toEqual(["abduction"]);
    expect(from).toEqual(["blode-icons (2 concepts)"]);
  });

  it("returns an empty table, and says so, when neither is there", async () => {
    const { aliases, from } = await loadAliases({
      central: path.join(dir, "nope.json"),
      house: path.join(dir, "also-nope.json"),
    });
    expect(aliases.size).toBe(0);
    // `from` empty is the signal an empty table is absence rather than a bug at
    // the call site — the two look identical from the map alone.
    expect(from).toEqual([]);
  });

  it("never lists a slug among its own aliases", async () => {
    // The slug is already reached by provenance. Counting it again would make
    // the widening look bigger than it is, in the one number that decides
    // whether the widening was worth doing.
    const self = write("self.json", {
      folder: { aliases: ["folder", "Folder", "directory"], category: "X" },
    });
    const { aliases } = await loadAliases({
      central: self,
      house: path.join(dir, "nope.json"),
    });
    expect(aliases.get("folder")).toEqual(["directory"]);
  });
});

describe("loadAliases independent table", () => {
  it("keeps the house's own concept map out of the independent table", async () => {
    // The whole reason there are two tables. `_concepts.json` supplies both the
    // aliases and the concept list coverage is scored against, so folding it in
    // makes every concept reachable by construction — a restatement wearing a
    // result's clothes.
    const { aliases, independent } = await loadAliases({ central, house });
    expect(aliases.get("ufo")).toEqual(["abduction"]);
    expect(independent.has("ufo")).toBe(false);
    expect(independent.get("square-arrow-top-right")).toEqual([
      "open",
      "open link",
    ]);
  });
});

import { describe, expect, it } from "vitest";

import { classifyReach, reach } from "./reach.js";
import type { HouseSource } from "./reach.js";

const BOX = "M4 4H12V12H4Z";
const IN_HOUSE = new Set(["clock", "folder", "pull-request"]);
const hasHouse = (slug: string): boolean => IN_HOUSE.has(slug);
const hasStrike = (slug: string): boolean => slug === "strike-through";
const hasWifiFull = (slug: string): boolean => slug === "wifi-full";

const house = (slugs: Record<string, string[]>): HouseSource => ({
  has: (slug) => slug in slugs,
  paths: (slug) => slugs[slug] ?? null,
});

describe("classifyReach", () => {
  it("prefers a mark over a house file of the same name", () => {
    expect(classifyReach("plus", () => true)).toEqual({ kind: "mark" });
  });

  it("compiles a keyed slug", () => {
    expect(classifyReach("pull-request", hasHouse)).toEqual({
      kind: "compile",
    });
  });

  it("splices a base-modifier whose halves are both in the house", () => {
    expect(classifyReach("folder-clock", hasHouse)).toEqual({
      badge: "clock",
      base: "folder",
      kind: "compile",
    });
  });

  it("analogs an unkeyed name the host has no construction for", () => {
    expect(classifyReach("unicorn", hasHouse)).toEqual({ kind: "analog" });
  });

  /** Host DRAW first. The ten the reach dashboard staged are all host
   *  constructions now, so none of them reaches the analog or agent arm. */
  it("draws every reach-set object on the host", () => {
    for (const slug of [
      "briefcase",
      "cake",
      "compass",
      "cookie",
      "database",
      "fingerprint",
      "microscope",
      "strikethrough",
      "umbrella",
      "wifi",
    ]) {
      expect(
        classifyReach(slug, () => false),
        slug
      ).toEqual({ kind: "glyph" });
    }
  });

  it("compiles a hyphen twin as the house file", () => {
    expect(
      classifyReach("strikethrough", hasStrike, false, "strike-through")
    ).toEqual({
      kind: "compile",
      of: "strike-through",
    });
  });

  it("does not compile a variant as the concept", () => {
    expect(classifyReach("wifi", hasWifiFull, false, "wifi-full")).toEqual({
      kind: "glyph",
    });
  });

  it("hires the agent only when asked", () => {
    expect(classifyReach("plus", hasHouse, true)).toEqual({ kind: "agent" });
  });
});

describe("reach", () => {
  it("draws a host mark with no model", async () => {
    const result = await reach({ name: "plus" });
    expect(result.cost).toBeUndefined();
    expect(result.program).toContain("finish outlined");
    expect(result.brief).toContain("plus");
  });

  it("compiles keyed paths without a vocabulary extract", async () => {
    const result = await reach({ name: "box" }, { targetPaths: [BOX] });
    expect(result.brief).toBe("compile box");
    expect(result.program).toContain("part box-0");
    expect(result.cost).toBeUndefined();
  });

  it("splices two house drawings into one compile", async () => {
    const result = await reach(
      { name: "folder-clock" },
      {},
      house({ clock: [BOX], folder: [BOX] })
    );
    expect(result.brief).toBe("compile folder-clock");
    expect(result.program).toMatch(/part folder-clock-/u);
  });

  it("analogs an unkeyed cylinder name as trays", async () => {
    const result = await reach({ name: "server" });
    expect(result.brief).toBe("analog trays server");
    expect(result.cost).toBeUndefined();
  });

  it("replays a Central kin when the exact slug is missing", async () => {
    const result = await reach(
      { name: "waffle" },
      {},
      {
        ...house({ waffles: [BOX] }),
        kin: (query) => (query === "waffle" ? ["waffles"] : []),
      }
    );
    expect(result.brief).toBe("analog replay waffles waffle");
    expect(result.program).toContain("part waffle-");
    expect(result.cost).toBeUndefined();
    expect(result.issues.some((i) => i.message.includes("unknown part"))).toBe(
      false
    );
  });

  it("compiles a letter-twin instead of analog replay", async () => {
    const d = "M12 4C16.4183 4 20 7.5817 20 12C20 16.4183 16.4183 20 12 20";
    const result = await reach(
      { name: "strikethrough" },
      {},
      {
        has: (slug) => slug === "strike-through",
        kin: (query) => (query === "strikethrough" ? ["strike-through"] : []),
        paths: (slug) => (slug === "strike-through" ? [d] : null),
      }
    );
    expect(result.brief).toBe("compile strikethrough");
    expect(result.cost).toBeUndefined();
  });
});

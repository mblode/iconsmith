import { describe, expect, it } from "vitest";

import type { Part } from "../types.js";
import { aboutConcept, islands, selectHints } from "./select.js";

const part = (id: string, icons: string[], name?: string): Part => ({
  closed: false,
  d: "M0 0L1 0",
  h: 1,
  icons,
  id,
  instances: icons.length,
  name,
  nodes: 1,
  sizeRange: [1, 1],
  w: 1,
});

const PARTS: Part[] = [
  part("p-pr", ["pull-request"], "git-fork"),
  part("p-sparkle", ["sparkle", "git-branch"], "sparkle"),
  part("p-cyl", ["storage"], "cylinder"),
  part("p-rack", ["server-1", "server-2"], "rack"),
];

const concept = {
  category: "Code",
  name: "pull-request",
  tags: ["git", "branch"],
};

describe("selectHints", () => {
  it("auto matches slug when the concept already has provenance", () => {
    expect(
      selectHints("auto", concept, PARTS, new Map()).map((h) => h.id)
    ).toEqual(selectHints("slug", concept, PARTS, new Map()).map((h) => h.id));
  });
  it("keeps slug hits that are about the concept, not shared tags", () => {
    const hints = selectHints("slug", concept, PARTS, new Map());
    expect(hints.map((h) => h.id)).toEqual(["p-pr"]);
  });

  it("lets tagged search reach marks the slug filter dropped", () => {
    const hints = selectHints("tagged", concept, PARTS, new Map());
    expect(hints.map((h) => h.id)).toContain("p-sparkle");
  });

  it("exact keeps only marks extracted from this slug, not cousins", () => {
    const hints = selectHints("exact", concept, PARTS, new Map());
    expect(hints.map((h) => h.id)).toEqual(["p-pr"]);
  });

  it("contrast withholds the provenance family tagged search leaned on", () => {
    const db = {
      name: "database",
      tags: ["storage", "server"],
    };
    const tagged = selectHints("tagged", db, PARTS, new Map()).map((h) => h.id);
    expect(tagged).toContain("p-cyl");
    expect(tagged).toContain("p-rack");
    const contrast = selectHints("contrast", db, PARTS, new Map()).map(
      (h) => h.id
    );
    expect(contrast).toEqual(["p-cyl"]);
  });

  it("empty is a real control: no suggested marks", () => {
    expect(selectHints("empty", concept, PARTS, new Map())).toEqual([]);
  });
});

describe("islands", () => {
  it("N=1 stays on the current hill, so a screen is still a screen", () => {
    expect(islands(concept, PARTS, new Map(), 1).map((i) => i.kind)).toEqual([
      "auto",
    ]);
  });

  it("N=5 is five policies, not five seeds of one", () => {
    expect(islands(concept, PARTS, new Map(), 5).map((i) => i.kind)).toEqual([
      "slug",
      "tagged",
      "exact",
      "contrast",
      "empty",
    ]);
  });
});

describe("aboutConcept", () => {
  it("accepts a part extracted from the slug itself", () => {
    expect(
      aboutConcept(
        { id: "p", name: null, seenIn: ["pull-request"], usedByIcons: 1 },
        "pull-request"
      )
    ).toBe(true);
  });
});

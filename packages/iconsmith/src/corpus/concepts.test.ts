import { describe, expect, test } from "vitest";

import type { ConceptIcon } from "./concepts.js";
import {
  assignRoles,
  coveragePair,
  coverageOf,
  duplicateConcepts,
  headOf,
  houseVocabulary,
  proposeConcepts,
  rankGaps,
  rejectionOf,
  slugifyTag,
  unnumbered,
} from "./concepts.js";

const icon = (
  slug: string,
  {
    cohort = null as string | null,
    concepts = [] as string[],
    tags = [] as string[],
  } = {}
): ConceptIcon => ({ cohort, concepts, set: "blode-icons", slug, tags });

describe("the head of a family is picked mechanically", () => {
  test("an existing concept's icon wins, however long its name", () => {
    // The whole point of the rule: a human already answered this question, and
    // a shorter sibling arriving later must not silently take the answer over.
    expect(headOf(["a", "settings-gear-1"], new Set(["settings-gear-1"]))).toBe(
      "settings-gear-1"
    );
  });

  test("otherwise the shortest unnumbered name, ties broken alphabetically", () => {
    expect(headOf(["car-1", "car-2", "car"], new Set())).toBe("car");
    expect(headOf(["bbb", "aaa"], new Set())).toBe("aaa");
  });

  test("an all-numbered family still gets a head rather than none", () => {
    // `chart-2` … `chart-8` exist with no plain `chart`. Refusing to pick would
    // leave seven canonicals competing for one word, which is the state this
    // module exists to end.
    expect(headOf(["chart-3", "chart-2"], new Set())).toBe("chart-2");
  });
});

describe("roles come from stated cohorts and trailing indices, nothing else", () => {
  test("a stated cohort has one canonical and the rest are modifiers", () => {
    const icons = [
      icon("airplane", { cohort: "airplane" }),
      icon("airplane-up", { cohort: "airplane" }),
      icon("airplane-down", { cohort: "airplane" }),
    ];
    const roles = assignRoles(icons, {
      airplane: ["airplane", "airplane-down", "airplane-up"],
    });
    expect(roles.map((r) => [r.slug, r.role])).toEqual([
      ["airplane", "canonical"],
      ["airplane-down", "direction"],
      ["airplane-up", "direction"],
    ]);
  });

  test("an inferred prefix is not a family", () => {
    // `cohortOf` falls back to a prefix, and the store records that fallback as
    // an ordinary string. Treating it as evidence would collapse the inferred
    // `square` cohort's 38 icons — `square-arrow-down` through `square-user` —
    // into one answer for four different questions.
    const icons = [
      icon("square-arrow-down", { cohort: "square" }),
      icon("square-user", { cohort: "square" }),
    ];
    expect(assignRoles(icons, {}).every((r) => r.role === "canonical")).toBe(
      true
    );
  });

  test("a solo: cohort is a statement that there is no family", () => {
    const icons = [
      icon("ai-slop", { cohort: "solo:ai-slop" }),
      icon("ar", { cohort: "solo:ar" }),
    ];
    expect(
      assignRoles(icons, {
        "solo:ai-slop": ["ai-slop"],
        "solo:ar": ["ar"],
      }).every((r) => r.role === "canonical")
    ).toBe(true);
  });

  test("slugs differing by a trailing index are one family", () => {
    const roles = assignRoles(
      [icon("bubble-3"), icon("bubble-4"), icon("bubble")],
      {}
    );
    expect(
      roles.filter((r) => r.role === "canonical").map((r) => r.slug)
    ).toEqual(["bubble"]);
  });

  test("a state suffix is a state, not a bare variant", () => {
    const roles = assignRoles(
      [icon("wifi", { cohort: "wifi" }), icon("wifi-off", { cohort: "wifi" })],
      { wifi: ["wifi", "wifi-off"] }
    );
    expect(roles.find((r) => r.slug === "wifi-off")?.role).toBe("state");
  });
});

describe("coverage is measured against canonical icons only", () => {
  test("a direction variant is not counted as uncovered", () => {
    // Counting it would put the ceiling out of reach by construction: the
    // variant is not supposed to answer a question of its own.
    const icons = [
      icon("airplane", { cohort: "airplane", concepts: ["airplane"] }),
      icon("airplane-up", { cohort: "airplane" }),
    ];
    const c = coverageOf(
      icons,
      assignRoles(icons, { airplane: ["airplane", "airplane-up"] })
    );
    expect(c).toMatchObject({ canonical: 1, coverage: 1, covered: 1 });
  });
});

describe("a concept never gets two answers", () => {
  test("duplicates are found on the merged pairs", () => {
    expect(
      duplicateConcepts([
        { concept: "add", slug: "plus" },
        { concept: "add", slug: "plus-medium" },
        { concept: "bin", slug: "trash" },
      ])
    ).toEqual([{ concept: "add", slugs: ["plus", "plus-medium"] }]);
  });

  test("proposing produces none, across all four passes", () => {
    const icons = [
      icon("phone", { concepts: ["call"] }),
      icon("call"),
      icon("trash-1", { tags: ["bin", "delete"] }),
      icon("bin-lid", { tags: ["bin"] }),
    ];
    const r = proposeConcepts({ icons, manifest: {} });
    expect(r.duplicates).toEqual([]);
  });
});

describe("the passes claim in trust order", () => {
  const icons = [
    icon("phone", { concepts: ["call"] }),
    icon("call"),
    icon("magnifier", { tags: ["search"] }),
    icon("folder-cloud", { tags: ["folder"] }),
    icon("folder"),
  ];

  test("a curated concept keeps its word against a same-named icon", () => {
    const r = proposeConcepts({ icons, manifest: {} });
    expect(r.proposals.find((p) => p.concept === "call")?.slug).toBe("phone");
    // …and the icon actually named `call` is surfaced rather than silently
    // renamed. This is an editorial contest, and there are ten of them in the
    // live set.
    expect(
      r.conflicts.filter((c) => c.kind === "curated-slug").map((c) => c.word)
    ).toEqual(["call"]);
  });

  test("the plain word goes to the plain icon, not to a qualified sibling", () => {
    // `folder-cloud` is tagged "folder". If tags ran before the slug pass it
    // would answer "which icon for a folder?" with a folder-in-the-cloud.
    const r = proposeConcepts({ icons, manifest: {} });
    expect(r.proposals.find((p) => p.concept === "folder")?.slug).toBe(
      "folder"
    );
  });

  test("a tag naming one icon becomes a concept", () => {
    const r = proposeConcepts({ icons, manifest: {} });
    expect(r.proposals.find((p) => p.concept === "search")).toMatchObject({
      slug: "magnifier",
      source: "tag-derived",
    });
  });

  test("a tag naming two canonicals goes to the queue, not to whichever sorts first", () => {
    const contested = [
      icon("a", { tags: ["thing"] }),
      icon("b", { tags: ["thing"] }),
    ];
    const r = proposeConcepts({ icons: contested, manifest: {} });
    expect(r.conflicts).toContainEqual({
      candidates: ["a", "b"],
      kind: "tag",
      word: "thing",
    });
    expect(r.proposals.some((p) => p.concept === "thing")).toBe(false);
  });

  test("a Lucide keyword transfers only where the two sets name the same drawing", () => {
    const r = proposeConcepts({
      icons: [icon("compass"), icon("unrelated")],
      lucideTags: { compass: ["navigation", "direction"], gauge: ["speed"] },
      manifest: {},
    });
    expect(r.proposals.find((p) => p.concept === "navigation")).toMatchObject({
      slug: "compass",
      source: "lucide-derived",
    });
    expect(r.proposals.some((p) => p.concept === "speed")).toBe(false);
  });
});

describe("the gap ranking reads names and never geometry", () => {
  const vocabulary = houseVocabulary([
    icon("trash-1", { tags: ["Waste basket"] }),
    icon("magnifying-glass", { concepts: ["search"] }),
  ]);

  test("the house vocabulary is slugs, stems, concepts and slugified tags", () => {
    expect([...vocabulary].toSorted()).toEqual([
      "magnifying-glass",
      "search",
      "trash",
      "trash-1",
      "waste-basket",
    ]);
  });

  test("a name the house draws under a number is not a gap", () => {
    // The failure this guards is a confidently wrong backlog: against raw slugs
    // alone, `calendar`, `camera`, `folder`, `plus` and `trash` all read as
    // things blode does not draw, because blode draws them as `trash-1` and so
    // on. That artefact is the difference between 145 names at 4+ packs and 62.
    const names = [
      { set: "lucide", slug: "trash" },
      { set: "tabler", slug: "trash" },
      { set: "remix", slug: "trash" },
      { set: "lucide", slug: "cookie" },
      { set: "tabler", slug: "cookie" },
      { set: "remix", slug: "cookie" },
    ];
    expect(rankGaps({ names, vocabulary })).toEqual([
      { name: "cookie", packs: 3, sets: ["lucide", "remix", "tabler"] },
    ]);
  });

  test("one pack drawing a name twice is still one pack", () => {
    const names = [
      { set: "lucide", slug: "cookie" },
      { set: "lucide", slug: "cookie" },
    ];
    expect(rankGaps({ minPacks: 2, names, vocabulary })).toEqual([]);
  });
});

describe("slug helpers", () => {
  test("tags are prose and concepts are slugs", () => {
    expect(slugifyTag("Credit Card")).toBe("credit-card");
    expect(slugifyTag("e-mail")).toBe("e-mail");
    expect(slugifyTag("!!")).toBe("");
  });

  test("a trailing index is a drawing revision, not a distinction", () => {
    expect(unnumbered("car-10")).toBe("car");
    expect(unnumbered("h1")).toBe("h1");
  });
});

describe("the two coverage numbers", () => {
  const icons = [icon("gauge", { concepts: ["gauge"] }), icon("wrench")];
  const roles = assignRoles(icons, {});

  test("a slug-to-itself concept counts nominally and not informatively", () => {
    // This is the whole correction: `gauge → gauge` satisfies any ">= x%
    // covered" criterion while telling a caller nothing the filename did not.
    const c = coveragePair(icons, roles);
    expect(c.nominal.covered).toBe(1);
    expect(c.informative.covered).toBe(0);
  });

  test("a concept that is not the slug counts in both", () => {
    const c = coveragePair([icon("wrench", { concepts: ["settings"] })], roles);
    expect(c.informative.covered).toBe(1);
    expect(c.nominal.covered).toBe(1);
  });
});

describe("the junk filter on derived concepts", () => {
  test("a concept the target file cannot use as a key is thrown away", () => {
    // `_concepts.json` keys must start with a letter, so proposing `100 →
    // battery-full` is proposing a file that fails the set's own validator.
    // Most of the class is a tag reading the gauge rather than naming it.
    expect(rejectionOf("100", "battery-full", "tag-derived")).toBe(
      "not-a-slug"
    );
    expect(rejectionOf("3-00", "clock-3-o-clock", "tag-derived")).toBe(
      "not-a-slug"
    );
    expect(rejectionOf("1080p", "hd", "lucide-derived")).toBe("not-a-slug");
    expect(rejectionOf("hd", "high-definition", "lucide-derived")).toBeNull();
  });

  test("a stem that cut a number pair in half is thrown away", () => {
    // `unnumbered("aspect-ratio-16-9")` is `aspect-ratio-16`, which names
    // nothing and reads as a numbered variant.
    expect(
      rejectionOf("aspect-ratio-16", "aspect-ratio-16-9", "inferred")
    ).toBe("truncated-number");
    // The same shape from a tag is a real word: `f1` is what people call it.
    expect(rejectionOf("f1", "formula1", "tag-derived")).toBeNull();
  });

  test("a blessed concept and a tautology are never rejected", () => {
    expect(rejectionOf("100", "100", "inferred")).toBeNull();
    expect(rejectionOf("100", "battery-full", "curated")).toBeNull();
  });

  test("a rejected stem still reserves its slug, and is reported", () => {
    const r = proposeConcepts({
      icons: [icon("aspect-ratio-16-9")],
      manifest: {},
    });
    expect(r.rejected).toEqual([
      {
        concept: "aspect-ratio-16",
        reason: "truncated-number",
        slug: "aspect-ratio-16-9",
      },
    ]);
    // Nominal coverage is unaffected: the icon still answers under its own
    // name, which is what the reservation is for.
    expect(r.coverage.after.nominal.covered).toBe(1);
    expect(r.coverage.after.informative.covered).toBe(0);
  });
});

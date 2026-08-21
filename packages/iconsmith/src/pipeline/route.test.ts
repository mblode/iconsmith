/**
 * Routing, without a model.
 *
 * Every stage is injectable, so nothing here calls an API. What is tested is
 * the wiring and the guarantee: that a route returns what `generate` returns,
 * that two routes differ in exactly the stage they claim to, that the shortlist
 * SELECT builds is the vocabulary DRAW sees, and — the one that matters — that
 * nothing a PROPOSE stage returns can hand geometry to a DRAW stage.
 */
import { describe, expect, it } from "vitest";

import type { Proposal } from "./compose.js";
import type { GenerateResult } from "./generate.js";
import type { Reference } from "./licence.js";
import { asReferences } from "./licence.js";
import type { ProposalRun } from "./propose.js";
import type { Brief, Drawing, PartHint, Route } from "./route.js";
import {
  ROUTES,
  RouteError,
  analog,
  arm,
  checkStructural,
  compile,
  describeRoute,
  direct,
  drawWith,
  getRoute,
  mark,
  partFirst,
  proposeFromRaster,
  routeNames,
  runRoute,
  scoreRoute,
  searchParts,
} from "./route.js";

const PROVENANCE = {
  date: "2026-08-19",
  licenses: ["MIT"],
  origin: "original" as const,
  set: "blode-icons",
};

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4L20 20" stroke="#000" fill="none"/></svg>`;

const corpus = (...names: string[]): Reference[] =>
  asReferences(
    names.map((name) => ({ name, svg: SVG })),
    PROVENANCE
  );

const part = (id: string, icons: string[], name?: string) => ({
  closed: false,
  d: "M0 0L4 0L4 6",
  h: 6,
  icons,
  id,
  instances: icons.length,
  name,
  nodes: 3,
  sizeRange: [1, 1] as [number, number],
  w: 4,
});

const PARTS = [
  part("p1", ["git-pull-request", "git-branch"]),
  part("p2", ["database", "server"], "cylinder"),
  part("p3", ["flower", "leaf"]),
  part("p4", ["git-commit"]),
];

const PROPOSAL: Proposal = {
  adjacency: ["block 2 sits inside block 1"],
  blocks: [
    { cell: "center", shape: "square", size: "dominant" },
    { cell: "top-right", shape: "square", size: "small" },
  ],
  elements: 2,
  parts: ["p3"],
  thumbnail: "aGVsbG8=",
};

const drawn = (over: Partial<GenerateResult> = {}): GenerateResult => ({
  clean: true,
  doc: { draw: [], icon: "git-pull-request", keyline: null },
  issues: [],
  steps: 3,
  svg: SVG,
  text: "drew it",
  trace: ["rect", "render"],
  ...over,
});

/** A DRAW stage that records what it was handed and draws nothing. */
const spyDraw = () => {
  const seen: Drawing[] = [];
  const stage = {
    name: "spy",
    run: (input: Drawing) => {
      seen.push(input);
      return Promise.resolve(drawn());
    },
  };
  return { seen, stage };
};

describe("the route contract", () => {
  it("returns exactly what generate returns, so it drops into the eval seam", async () => {
    const result = await runRoute(
      { ...direct, draw: drawWith("fake", () => Promise.resolve(drawn())) },
      { name: "git-pull-request" }
    );
    expect(result.svg).toBe(SVG);
    expect(result.steps).toBe(3);
    expect(result.trace).toEqual(["rect", "render"]);
    expect(result.clean).toBe(true);
  });

  it("is usable as a GenerateFn", async () => {
    const fn = arm({
      ...direct,
      draw: drawWith("fake", (concept) =>
        Promise.resolve(drawn({ text: concept.name }))
      ),
    });
    await expect(fn({ name: "folder" }, {})).resolves.toMatchObject({
      text: "folder",
    });
  });

  it("recomputes clean from the CHECK stage, not from the drawer", async () => {
    const result = await runRoute(
      {
        ...direct,
        check: {
          name: "always-angry",
          run: () =>
            Promise.resolve([
              { message: "no", rule: "test", severity: "error" as const },
            ]),
        },
        draw: drawWith("fake", () => Promise.resolve(drawn({ clean: true }))),
      },
      { name: "folder" }
    );
    expect(result.clean).toBe(false);
    expect(result.issues).toHaveLength(1);
  });

  it("names the route and the stage when a stage throws", async () => {
    const boom = runRoute(
      {
        ...direct,
        draw: drawWith("fake", () => Promise.reject(new Error("no model"))),
      },
      { name: "folder" }
    );
    await expect(boom).rejects.toThrow(RouteError);
    await expect(boom).rejects.toThrow(/route "direct" failed at stage "draw/u);
    await expect(boom).rejects.toThrow(/no model/u);
  });

  it("hands every stage the concept and the caller's options", async () => {
    const briefs: Brief[] = [];
    const { seen, stage } = spyDraw();
    await runRoute(
      {
        ...direct,
        brief: {
          name: "spy",
          run: (concept, ctx) => {
            expect(ctx.concept.name).toBe("folder");
            expect(ctx.options.maxSteps).toBe(7);
            const b = { concept, note: "seen" };
            briefs.push(b);
            return Promise.resolve(b);
          },
        },
        draw: stage,
      },
      { name: "folder" },
      { maxSteps: 7 }
    );
    expect(briefs).toHaveLength(1);
    expect(seen[0].brief.note).toBe("seen");
  });
});

describe("the coordinate invariant across PROPOSE and DRAW", () => {
  it("refuses a composition that carries anything but the closed vocabulary", async () => {
    const boom = runRoute(
      {
        ...direct,
        propose: {
          name: "rogue",
          run: () =>
            Promise.resolve({
              ...PROPOSAL,
              // The shape a hand-rolled bypass takes: a block with a field the
              // type does not have, carrying a position.
              blocks: [
                { cell: "center", shape: "square", size: "dominant", x: 4 },
              ],
              elements: 1,
            } as unknown as Proposal),
        },
      },
      { name: "folder" }
    );
    await expect(boom).rejects.toThrow(/x/u);
  });

  it("refuses a part id that reads as a measurement", async () => {
    const boom = runRoute(
      { ...partFirst, draw: spyDraw().stage },
      { name: "database" },
      { parts: [part("4.5", ["database"])] }
    );
    await expect(boom).rejects.toThrow(/reads as a measurement/u);
  });

  it("keeps only the Proposal from a raster run — the image never reaches DRAW", async () => {
    const { seen, stage } = spyDraw();
    const run: ProposalRun = {
      chosen: 0,
      images: [Buffer.from("a picture")],
      models: ["fake"],
      ms: 1,
      proposal: PROPOSAL,
      reason: null,
      references: ["folder"],
      usd: null,
    };
    await runRoute(
      {
        ...direct,
        draw: stage,
        propose: proposeFromRaster(() => Promise.resolve(run)),
      },
      { name: "folder" },
      { corpus: corpus("folder") }
    );
    expect(seen[0].composition).toEqual(PROPOSAL);
    // `Drawing` names three sources and none of them is a drawing, so there is
    // no key an image could have arrived under.
    expect(Object.keys(seen[0]).toSorted()).toEqual([
      "brief",
      "composition",
      "selection",
    ]);
  });

  it("passes the raster arm's corpus and vocabulary through from the caller", async () => {
    const asked: { corpus: number; parts: number }[] = [];
    await runRoute(
      {
        ...direct,
        draw: spyDraw().stage,
        propose: proposeFromRaster((_concept, options) => {
          asked.push({
            corpus: options.corpus.length,
            parts: options.parts?.length ?? 0,
          });
          return Promise.resolve({
            chosen: 0,
            images: [],
            models: [],
            ms: 0,
            proposal: PROPOSAL,
            reason: null,
            references: [],
            usd: null,
          });
        }),
      },
      { name: "folder" },
      { corpus: corpus("folder", "file"), parts: PARTS }
    );
    expect(asked).toEqual([{ corpus: 2, parts: 4 }]);
  });
});

describe("the part vocabulary search", () => {
  it("finds a part by the icons it was extracted from, not only by its name", () => {
    const hits = searchParts(PARTS, "git-pull-request");
    expect(hits.map((h) => h.id)).toContain("p1");
    expect(hits[0].name).toBeNull();
    expect(hits[0].seenIn).toContain("git-pull-request");
  });

  it("ranks a named match above a provenance match", () => {
    const hits = searchParts(
      [...PARTS, part("p5", ["misc"], "database")],
      "database"
    );
    expect(hits[0].id).toBe("p5");
  });

  it("carries no size — a shortlist names marks, it does not size them", () => {
    const hits: PartHint[] = searchParts(PARTS, "database");
    expect(Object.keys(hits[0]).toSorted()).toEqual([
      "id",
      "name",
      "seenIn",
      "usedByIcons",
    ]);
  });

  it("returns nothing for an empty query rather than everything", () => {
    expect(searchParts(PARTS, "   ")).toEqual([]);
  });
});

describe("the part-first route", () => {
  it("narrows the vocabulary the drawer sees to the shortlist", async () => {
    const { seen, stage } = spyDraw();
    await runRoute(
      { ...partFirst, draw: stage },
      { name: "git-pull-request" },
      { parts: PARTS }
    );
    expect(seen[0].selection.shortlist.map((h) => h.id)).toEqual(["p1", "p4"]);
    expect(seen[0].selection.parts.map((p) => p.id)).toEqual(["p1", "p4"]);
  });

  it("falls back to the whole vocabulary when the search matches nothing", async () => {
    const { seen, stage } = spyDraw();
    await runRoute(
      { ...partFirst, draw: stage },
      { name: "zeppelin" },
      { parts: PARTS }
    );
    expect(seen[0].selection.shortlist).toEqual([]);
    expect(seen[0].selection.parts).toHaveLength(PARTS.length);
  });

  it("searches tags and category as well as the name", async () => {
    const { seen, stage } = spyDraw();
    await runRoute(
      { ...partFirst, draw: stage },
      { category: "nature", name: "zeppelin", tags: ["flower"] },
      { parts: PARTS }
    );
    expect(seen[0].selection.shortlist.map((h) => h.id)).toEqual(["p3"]);
  });

  it("puts a composition's own part ids ahead of the name search", async () => {
    const { seen, stage } = spyDraw();
    await runRoute(
      {
        ...partFirst,
        draw: stage,
        propose: { name: "fake", run: () => Promise.resolve(PROPOSAL) },
      },
      { name: "git-pull-request" },
      { parts: PARTS }
    );
    expect(seen[0].selection.shortlist.map((h) => h.id)).toEqual([
      "p3",
      "p1",
      "p4",
    ]);
  });

  it("leaves the corpus alone — it selects parts, not references", async () => {
    const { seen, stage } = spyDraw();
    const refs = corpus("folder", "file");
    await runRoute(
      { ...partFirst, draw: stage },
      { name: "git-pull-request" },
      { corpus: refs, parts: PARTS }
    );
    expect(seen[0].selection.references).toEqual(refs);
  });

  it("differs from direct in exactly one stage", () => {
    const a = describeRoute(direct).stages;
    const b = describeRoute(partFirst).stages;
    const changed = Object.keys(a).filter((k) => a[k] !== b[k]);
    expect(changed).toEqual(["select"]);
  });
});

describe("the compile route", () => {
  it("differs from direct in exactly one stage", () => {
    const a = describeRoute(direct).stages;
    const b = describeRoute(compile).stages;
    const changed = Object.keys(a).filter((k) => a[k] !== b[k]);
    expect(changed).toEqual(["draw"]);
  });

  it("compiles target path data onto vocabulary parts", async () => {
    const result = await runRoute(
      compile,
      { name: "box" },
      { parts: PARTS, targetPaths: [PARTS[0].d] }
    );
    expect(result.program).toContain("part ");
    expect(result.trace).toContain("part");
    expect(result.brief).toBe("compile box");
    expect(result.cost).toBeUndefined();
  });

  it("refuses to run without targetPaths", async () => {
    const boom = runRoute(compile, { name: "box" }, { parts: PARTS });
    await expect(boom).rejects.toThrow(RouteError);
    await expect(boom).rejects.toThrow(/targetPaths/u);
  });
});

describe("the mark route", () => {
  it("differs from direct in exactly one stage", () => {
    const a = describeRoute(direct).stages;
    const b = describeRoute(mark).stages;
    const changed = Object.keys(a).filter((k) => a[k] !== b[k]);
    expect(changed).toEqual(["draw"]);
  });

  it("draws a host twin without a model, parts, or target paths", async () => {
    const result = await runRoute(mark, { name: "plus" });
    expect(result.clean).toBe(true);
    expect(result.svg).toContain("stroke");
    expect(result.program).toContain("finish outlined");
    expect(result.cost).toBeUndefined();
  });
});

describe("the analog route", () => {
  it("differs from direct in exactly one stage", () => {
    const a = describeRoute(direct).stages;
    const b = describeRoute(analog).stages;
    const changed = Object.keys(a).filter((k) => a[k] !== b[k]);
    expect(changed).toEqual(["draw"]);
  });

  it("draws a host construction without a model", async () => {
    // Not `database`: that is a host glyph now, so the analog route would
    // hand back the glyph rather than the trays this test is about.
    const result = await runRoute(analog, { name: "server" });
    expect(result.cost).toBeUndefined();
    expect(result.program).toContain("rect ");
    expect(result.brief).toContain("analog trays");
  });
});

describe("the registry", () => {
  it("lists the routes", () => {
    expect(routeNames()).toEqual([
      "analog",
      "compile",
      "direct",
      "mark",
      "part-first",
    ]);
  });

  it("resolves by name and says what it knows when it cannot", () => {
    expect(getRoute("part-first")).toBe(partFirst);
    expect(getRoute("compile")).toBe(compile);
    expect(getRoute("mark")).toBe(mark);
    expect(getRoute("analog")).toBe(analog);
    expect(() => getRoute("nope")).toThrow(
      /analog, compile, direct, mark, part-first/u
    );
  });

  it("names a stage for every step of every route", () => {
    for (const route of Object.values(ROUTES)) {
      const { stages } = describeRoute(route);
      expect(Object.keys(stages).toSorted()).toEqual([
        "brief",
        "check",
        "draw",
        "propose",
        "score",
        "select",
      ]);
      expect(Object.values(stages).every(Boolean)).toBe(true);
    }
  });

  it("scores every route on the same scorer, which is what makes them comparable", () => {
    const scorers = new Set(
      Object.values(ROUTES).map((r: Route) => r.score.name)
    );
    expect([...scorers]).toEqual(["registered"]);
  });

  it("keys the registry by the route's own name", () => {
    for (const [key, route] of Object.entries(ROUTES)) {
      expect(route.name).toBe(key);
    }
  });
});

describe("scoring and the structural check", () => {
  it("scores a drawing against itself at 1", async () => {
    const score = await scoreRoute(
      direct,
      { svg: SVG, target: SVG },
      { concept: { name: "folder" }, options: {} }
    );
    expect(score).toBeCloseTo(1, 5);
  });

  it("adds the structural panel's findings as warnings", async () => {
    const issues = await checkStructural.run(
      drawn({ svg: `<svg viewBox="0 0 24 24"></svg>` }),
      { concept: { name: "folder" }, options: {} }
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === "warn")).toBe(true);
    expect(issues.map((i) => i.rule)).toContain("structural");
  });
});

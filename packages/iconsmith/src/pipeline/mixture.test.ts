import { describe, expect, it } from "vitest";

import type { GenerateResult } from "./generate.js";
import type { GenerateLike } from "./harness.js";
import {
  CHEAP_EXPERTS,
  CONCEPT_CLASSES,
  DEFAULT_MIXTURE,
  EXPERT_IDS,
  assertNamesOnly,
  consensusOf,
  evidenceOf,
  gate,
  isUnknownAnalog,
  mixtureArm,
  mixtureSample,
  packIndexFromSlugs,
  parseMixturePolicy,
  partOpsOf,
} from "./mixture.js";
import type { ExpertId, MixturePolicy } from "./mixture.js";

const result = (
  name: string,
  over: Partial<GenerateResult> = {}
): GenerateResult => ({
  clean: true,
  doc: { draw: [], icon: name, keyline: "square" },
  issues: [],
  program: `icon ${name}\nrect 4 4 16 16\n`,
  steps: 1,
  svg: "<svg/>",
  text: "",
  trace: ["rect"],
  ...over,
});

const expert = (
  id: ExpertId,
  fn: (name: string) => GenerateResult
): GenerateLike => {
  return (concept) => Promise.resolve(fn(concept.name));
};

const policy = (over: Partial<MixturePolicy> = {}): MixturePolicy => ({
  ...DEFAULT_MIXTURE,
  ...over,
  weights: { ...DEFAULT_MIXTURE.weights, ...over.weights },
});

describe("parseMixturePolicy", () => {
  it("loads the committed default with every class weighted", () => {
    expect(DEFAULT_MIXTURE.packInventoryFloor).toBe(4);
    expect(DEFAULT_MIXTURE.stopOnCleanCheap).toBe(true);
    for (const id of CONCEPT_CLASSES) {
      expect(DEFAULT_MIXTURE.weights[id].length).toBeGreaterThan(0);
    }
  });

  it("refuses a policy that drops a class", () => {
    const { "net-new": _dropped, ...rest } = DEFAULT_MIXTURE.weights;
    expect(() =>
      parseMixturePolicy({
        packInventoryFloor: 4,
        stopOnCleanCheap: true,
        weights: rest,
      })
    ).toThrow(/net-new/u);
  });
});

describe("pack index is names only", () => {
  it("indexes slugs by pack and sorts consensus", () => {
    const index = packIndexFromSlugs([
      { pack: "tabler", slug: "database" },
      { pack: "lucide", slug: "database" },
      { pack: "heroicons", slug: "database" },
      { pack: "remix", slug: "database" },
      { pack: "lucide", slug: "wifi" },
    ]);
    expect(consensusOf("database", index)).toEqual({
      packs: 4,
      sets: ["heroicons", "lucide", "remix", "tabler"],
    });
    expect(consensusOf("xyzzy", index)).toEqual({ packs: 0, sets: [] });
  });

  it("refuses geometry on the inventory", () => {
    expect(() => assertNamesOnly({ name: "database", svg: "<svg/>" })).toThrow(
      /svg/u
    );
    expect(() =>
      packIndexFromSlugs([{ pack: "lucide", slug: "x", d: "M0 0" } as never])
    ).toThrow(/d/u);
  });
});

describe("gate", () => {
  it("classifies marks, house files, splices, families, parts, packs, and leftovers", () => {
    const house = {
      has: (slug: string) => slug === "clock" || slug === "folder",
      paths: () => null,
    };
    expect(gate(evidenceOf({ name: "plus" })).class).toBe("keyed-mark");
    expect(
      gate(evidenceOf({ name: "clock" }, {}, { house })).class
    ).toBe("keyed-house");
    expect(
      gate(evidenceOf({ name: "folder-clock" }, {}, { house })).class
    ).toBe("keyed-splice");
    expect(gate(evidenceOf({ name: "home" })).class).toBe("analog-family");
    expect(
      gate(
        evidenceOf(
          { name: "cylinder-thing" },
          {
            parts: [
              {
                closed: true,
                d: "M0 0",
                h: 8,
                icons: ["server"],
                id: "p1",
                instances: 1,
                name: "cylinder-thing",
                nodes: 4,
                sizeRange: [8, 8],
                w: 8,
              },
            ],
          }
        )
      ).class
    ).toBe("part-covered");
    expect(
      gate(
        evidenceOf(
          { name: "database" },
          {},
          {
            inventory: packIndexFromSlugs([
              { pack: "lucide", slug: "database" },
              { pack: "tabler", slug: "database" },
              { pack: "heroicons", slug: "database" },
              { pack: "remix", slug: "database" },
            ]),
          }
        )
      ).class
    ).toBe("pack-inventory");
    expect(gate(evidenceOf({ name: "xyzzy" })).class).toBe("net-new");
  });

  it("does not let pack consensus outrank a house file", () => {
    const decision = gate(
      evidenceOf(
        { name: "clock" },
        {},
        {
          house: { has: (slug) => slug === "clock", paths: () => ["M4 4"] },
          inventory: packIndexFromSlugs([
            { pack: "lucide", slug: "clock" },
            { pack: "tabler", slug: "clock" },
            { pack: "heroicons", slug: "clock" },
            { pack: "remix", slug: "clock" },
          ]),
        }
      )
    );
    expect(decision.class).toBe("keyed-house");
    expect(decision.candidates).toEqual(["compile"]);
  });
});

describe("mixtureArm", () => {
  it("stops on a clean cheap expert and never hires the agent", async () => {
    const called: ExpertId[] = [];
    const drawn = await mixtureArm({
      experts: {
        agent: expert("agent", (name) => {
          called.push("agent");
          return result(name, { brief: "agent leaked" });
        }),
        analog: expert("analog", (name) => {
          called.push("analog");
          return result(name, { brief: `analog home ${name}` });
        }),
      },
      onExpert: (id) => called.push(`on:${id}` as ExpertId),
    })({ name: "home" });
    expect(called).toEqual(["analog", "on:analog"]);
    expect(drawn.brief).toBe("mixture analog-family analog — analog home home");
    expect(drawn.trace[0]).toBe("mixture/analog-family/analog");
  });

  it("falls through an unknown analog and keeps a later clean agent", async () => {
    const called: ExpertId[] = [];
    const drawn = await mixtureArm({
      experts: {
        agent: expert("agent", (name) => {
          called.push("agent");
          return result(name, { brief: `agent ${name}` });
        }),
        analog: expert("analog", (name) => {
          called.push("analog");
          return result(name, {
            brief: `analog unknown ${name}`,
            clean: true,
          });
        }),
      },
      inventory: packIndexFromSlugs([
        { pack: "lucide", slug: "database" },
        { pack: "tabler", slug: "database" },
        { pack: "heroicons", slug: "database" },
        { pack: "remix", slug: "database" },
      ]),
    })({ name: "database" });
    expect(called).toEqual(["analog", "agent"]);
    expect(drawn.brief).toContain("mixture pack-inventory agent");
    expect(isUnknownAnalog(drawn)).toBe(false);
  });

  it("leaves a hold-out unknown when the gate lists only analog", async () => {
    const drawn = await mixtureArm({
      experts: {
        analog: expert("analog", (name) =>
          result(name, { brief: `analog unknown ${name}` })
        ),
      },
      policy: policy({
        weights: {
          ...DEFAULT_MIXTURE.weights,
          "net-new": ["analog"],
        },
      }),
    })({ name: "xyzzy" });
    expect(drawn.brief).toContain("analog unknown xyzzy");
    expect(mixtureSample("analog", "xyzzy", drawn).unknown).toBe(true);
  });

  it("picks the better of two experts when stopOnCleanCheap is off", async () => {
    const drawn = await mixtureArm({
      experts: {
        agent: expert("agent", (name) =>
          result(name, {
            brief: `agent ${name}`,
            program: `icon ${name}\npart rim\npart body\n`,
          })
        ),
        analog: expert("analog", (name) =>
          result(name, {
            brief: `analog trays ${name}`,
            program: `icon ${name}\nrect 4 4 16 16\n`,
          })
        ),
      },
      inventory: packIndexFromSlugs([
        { pack: "lucide", slug: "database" },
        { pack: "tabler", slug: "database" },
        { pack: "heroicons", slug: "database" },
        { pack: "remix", slug: "database" },
      ]),
      policy: policy({ stopOnCleanCheap: false }),
    })({ name: "database" });
    expect(drawn.brief).toContain("mixture pack-inventory agent");
    expect(partOpsOf(drawn.program)).toBe(2);
  });
});

describe("host experts still draw without a model", () => {
  it("marks plus and analog-homes home", async () => {
    const plus = await mixtureArm()({ name: "plus" });
    expect(plus.cost).toBeUndefined();
    expect(plus.brief).toMatch(/mixture keyed-mark mark/u);
    const home = await mixtureArm()({ name: "home" });
    expect(home.cost).toBeUndefined();
    expect(home.brief).toMatch(/mixture analog-family analog/u);
    expect(home.brief).not.toMatch(/unknown/u);
  });
});

describe("constants", () => {
  it("keeps the agent off the cheap list", () => {
    expect(CHEAP_EXPERTS.has("agent")).toBe(false);
    expect(EXPERT_IDS).toContain("agent");
  });
});

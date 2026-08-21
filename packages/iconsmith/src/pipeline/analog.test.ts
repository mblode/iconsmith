/**
 * Analog replay without a corpus: retitle and preferStroked are string and
 * list work; replay needs only a path that matches a part of the same `d`.
 */
import { describe, expect, it } from "vitest";

import { run } from "../tools/dsl.js";
import type { Part } from "../types.js";
import {
  analogArm,
  analogConstructions,
  composeFromParts,
  hasStackRim,
  horn,
  hourglass,
  hub,
  HUB_HINT,
  HORN_HINT,
  kinScore,
  mushroom,
  peak,
  pickKin,
  plant,
  PLANT_HINT,
  preferStroked,
  replay,
  retitle,
  sailboat,
  sameLetters,
  stack,
  tower,
  TOWER_HINT,
  trays,
  tube,
  volcano,
} from "./analog.js";

const BOX = "M4 4H12V12H4Z";

const part = (id: string, d: string): Part => ({
  closed: true,
  d,
  h: 8,
  icons: ["box"],
  id,
  instances: 1,
  nodes: 4,
  sizeRange: [8, 8],
  w: 8,
});

describe("retitle", () => {
  it("replaces the icon line and leaves the compiled ops", () => {
    const program = "icon server\nkeyline square\npart p-tray at 3,5 size 18\n";
    expect(retitle(program, "database")).toBe(
      "icon database\nkeyline square\npart p-tray at 3,5 size 18\n"
    );
  });
});

describe("preferStroked", () => {
  it("skips a filled dock and takes the first stroked neighbor", () => {
    // `database` tags hit `storage` first. That icon is filled; `server` is
    // not. The picker has to see the finish, not the rank.
    expect(
      preferStroked([
        { filled: true, slug: "storage" },
        { filled: false, slug: "server" },
        { filled: false, slug: "server-1" },
      ])
    ).toBe("server");
  });

  it("returns null when every analog is filled", () => {
    expect(preferStroked([{ filled: true, slug: "storage" }])).toBeNull();
  });
});

describe("pickKin", () => {
  it("treats a hyphen and a plural as the same drawing, not a miss", () => {
    expect(kinScore("fingerprint", "finger-print-1")).toBeGreaterThan(20);
    expect(kinScore("strikethrough", "strike-through")).toBeGreaterThan(20);
    expect(kinScore("cookie", "cookies")).toBeGreaterThan(20);
    expect(kinScore("wifi", "wifi-full")).toBeGreaterThan(
      kinScore("wifi", "wifi-no-signal")
    );
    expect(kinScore("cake", "birthday-cake")).toBeGreaterThan(20);
    expect(kinScore("cookie", "cookie")).toBe(0);
    expect(kinScore("microscope", "microphone")).toBe(0);
  });

  it("compiles only a letter-twin, not a neighbour or a variant", () => {
    expect(sameLetters("strikethrough", "strike-through")).toBe(true);
    expect(sameLetters("fingerprint", "finger-print-1")).toBe(true);
    expect(sameLetters("cookie", "cookies")).toBe(false);
    expect(sameLetters("wifi", "wifi-full")).toBe(false);
    expect(sameLetters("cookie", "cookie")).toBe(false);
  });

  it("skips a filled kin and does not analog a weak name match", () => {
    expect(
      pickKin("wifi", [
        { filled: true, slug: "wifi-full" },
        { filled: false, slug: "wifi-square" },
      ])
    ).toBe("wifi-square");
    expect(
      pickKin("microscope", [{ filled: false, slug: "microphone" }])
    ).toBeNull();
  });
});

describe("replay", () => {
  it("compiles matching paths then titles the concept", () => {
    const program = replay("database", [BOX], [part("p-box", BOX)]);
    expect(program.startsWith("icon database\n")).toBe(true);
    expect(program).toContain("part p-box");
    const ops = program.trim().split("\n");
    expect(ops[1]).toBe("keyline square");
    expect(ops.at(-1)).toBe("fit");
    expect(ops.slice(2, -1).every((line) => line.startsWith("part "))).toBe(
      true
    );
  });
});

describe("stack", () => {
  it("places the named rim three times and titles the concept", () => {
    const rim = {
      ...part("ellipse-flat", BOX),
      h: 4,
      name: "ellipse-flat",
      w: 11,
    };
    const program = stack("database", [rim]);
    expect(program.startsWith("icon database\n")).toBe(true);
    expect(program).toContain("keyline tall");
    expect(program.match(/^part ellipse-flat /gmu)?.length).toBe(3);
  });

  it("refuses when the rim is not in the vocabulary", () => {
    expect(() => stack("database", [part("p-box", BOX)])).toThrow(
      /ellipse-flat/u
    );
  });
});

describe("hub", () => {
  it("draws a connected tree of circles, not a pile of rims", () => {
    const program = hub("sitemap");
    expect(program.startsWith("icon sitemap\n")).toBe(true);
    expect(program).toContain("circle 12,6 r2");
    expect(program).toContain("line 12,8 12,15");
    expect(program).not.toContain("part ");
    expect(program).not.toContain("ellipse-flat");
    expect(run(program, []).errors).toEqual([]);
  });

  it("refuses a fan-out it has not written", () => {
    expect(() => hub("sitemap", 5)).toThrow(/three children/u);
  });
});

describe("trays", () => {
  it("stacks three rounded rects without a vocabulary rim", () => {
    const program = trays("database");
    expect(program).toContain("rect 5,3 14x3 r2");
    expect(program.match(/^rect /gmu)?.length).toBe(3);
    expect(run(program, []).errors).toEqual([]);
  });
});

describe("analogConstructions", () => {
  const rim = {
    ...part("ellipse-flat", BOX),
    h: 4,
    name: "ellipse-flat",
    w: 11,
  };

  it("picks the vocabulary stack when the name says cylinder and the rim exists", () => {
    const [row] = analogConstructions("server", [rim], "server", false);
    expect(row?.id).toBe("stack");
    expect(hasStackRim([rim])).toBe(true);
  });

  it("falls back to trays when the name says cylinder but the extract is empty", () => {
    const [row] = analogConstructions("server", [], "server", false);
    expect(row?.id).toBe("trays");
  });

  it("draws a hub for an unkeyed name that is not a stack or a family", () => {
    const [row] = analogConstructions("bananas", [], "bananas", false);
    expect(row?.id).toBe("hub");
    expect(HUB_HINT.test("org-chart")).toBe(true);
    expect(HUB_HINT.test("unicorn")).toBe(false);
    expect(HORN_HINT.test("unicorn")).toBe(true);
  });

  it("picks a concept family instead of a generic hub", () => {
    expect(analogConstructions("cactus", [], "cactus", false)[0]?.id).toBe(
      "plant"
    );
    expect(
      analogConstructions("lighthouse", [], "lighthouse", false)[0]?.id
    ).toBe("tower");
    expect(analogConstructions("volcano", [], "volcano", false)[0]?.id).toBe(
      "volcano"
    );
    expect(analogConstructions("mountain", [], "mountain", false)[0]?.id).toBe(
      "peak"
    );
    expect(analogConstructions("mushroom", [], "mushroom", false)[0]?.id).toBe(
      "mushroom"
    );
    expect(
      analogConstructions("hourglass", [], "hourglass", false)[0]?.id
    ).toBe("hourglass");
    expect(analogConstructions("sailboat", [], "sailboat", false)[0]?.id).toBe(
      "sailboat"
    );
    expect(
      analogConstructions("telescope", [], "telescope", false)[0]?.id
    ).toBe("tube");
    expect(analogConstructions("unicorn", [], "unicorn", false)[0]?.id).toBe(
      "horn"
    );
    expect(TOWER_HINT.test("beacon")).toBe(true);
    expect(PLANT_HINT.test("succulent")).toBe(true);
  });

  /**
   * Analog collates its own families and does not reach into `glyphs.ts`.
   *
   * A revision that consulted it returned the host construction *alone* for any
   * name that had one, so analog stopped collating for exactly the concepts
   * somebody had hand-drawn — and ten of them then read as ten analog draws in
   * the record. A host form is asked for by name, through `unkeyed: "glyph"`.
   */
  it("does not answer with a host glyph for a name that has one", () => {
    const rows = analogConstructions("compass", [], "compass", false);
    expect(rows.map((r) => r.id)).not.toContain("glyph");
    expect(rows[0]?.id).toBe("hub");
  });

  it("replays a house kin instead of a hub", () => {
    const [row] = analogConstructions("waffle", [], "waffle", false, {
      paths: [BOX],
      slug: "waffles",
    });
    expect(row?.id).toBe("replay");
    expect(row?.source.startsWith("icon waffle\n")).toBe(true);
    expect(row?.source).toContain("part ");
  });

  it("keeps a cylinder name on trays even when a kin is offered", () => {
    const [row] = analogConstructions("storage", [], "storage", false, {
      paths: [BOX],
      slug: "server",
    });
    expect(row?.id).toBe("trays");
  });

  it("collides the hinted family with trays and hub when a look will curate", () => {
    const ids = analogConstructions("unicorn", [], "unicorn", true).map(
      (r) => r.id
    );
    expect(ids).toEqual(["horn", "trays", "hub"]);
  });
});

describe("analogArm", () => {
  it("draws trays for a cylinder name with no model and no extract", async () => {
    const result = await analogArm()({ name: "server" });
    expect(result.cost).toBeUndefined();
    expect(result.brief).toBe("analog trays server");
    expect(result.program).toContain("rect ");
    expect(result.clean).toBe(true);
  });

  it("compiles a house kin as the concept, with no model", async () => {
    const result = await analogArm()(
      { name: "waffle" },
      { analogOf: "waffles", analogPaths: [BOX] }
    );
    expect(result.brief).toBe("analog replay waffles waffle");
    expect(result.program).toContain("part ");
    expect(result.cost).toBeUndefined();
    expect(result.issues.some((i) => i.message.includes("unknown part"))).toBe(
      false
    );
  });

  it("keeps the construction a look scores as the object", async () => {
    let n = 0;
    const result = await analogArm()(
      { name: "unicorn" },
      {
        ask: () => {
          n += 1;
          return Promise.resolve({
            findings: [],
            pq: 8,
            reason: null,
            sc: n === 3 ? 9 : 3,
          });
        },
      }
    );
    expect(result.brief).toBe("analog hub unicorn");
    expect(result.audit?.sc).toBe(9);
  });

  it("draws a concept family for a held-out name, not a hub", async () => {
    const result = await analogArm()({ name: "cactus" });
    expect(result.brief).toBe("analog plant cactus");
    expect(result.program).toContain("rect ");
    expect(result.program).not.toContain("circle 12,6 r2");
    expect(result.clean).toBe(true);
  });

  it("writes the filled paint of a family, not an adapted hub", async () => {
    const result = await analogArm()(
      { name: "lighthouse" },
      { finish: "filled" }
    );
    expect(result.brief).toBe("analog tower lighthouse");
    expect(result.program).toContain("finish filled");
    expect(result.svg).toContain('fill="currentColor"');
    expect(result.svg).toMatch(/<path/u);
  });
});

describe("analog families", () => {
  const families = [
    { draw: plant, id: "plant", slug: "cactus" },
    { draw: tower, id: "tower", slug: "lighthouse" },
    { draw: peak, id: "peak", slug: "mountain" },
    { draw: volcano, id: "volcano", slug: "volcano" },
    { draw: tube, id: "tube", slug: "telescope" },
    { draw: horn, id: "horn", slug: "unicorn" },
    { draw: mushroom, id: "mushroom", slug: "mushroom" },
    { draw: hourglass, id: "hourglass", slug: "hourglass" },
    { draw: sailboat, id: "sailboat", slug: "sailboat" },
  ] as const;

  it("runs each held-out family in both paints without a dsl error", () => {
    for (const { draw, slug } of families) {
      for (const finish of ["outlined", "filled"] as const) {
        const source = draw(slug, finish);
        const drawn = run(source, []);
        expect(drawn.errors, `${slug} ${finish}`).toEqual([]);
        expect(drawn.canvas.toSVG(), `${slug} ${finish}`).toMatch(/<path/u);
        expect(source, slug).toContain(`finish ${finish}`);
      }
    }
  });

  it("does not volunteer a glyph construction for a name that has one", () => {
    const [row] = analogConstructions("compass", [], "compass", false);
    expect(row?.id).toBe("hub");
    expect(row?.source).not.toContain("diamond 12,12 r5");
  });

  it("composes a named vocabulary part at a named anchor", () => {
    const rim = {
      ...part("ellipse-flat", BOX),
      name: "cactus",
    };
    const source = composeFromParts("cactus", [rim]);
    expect(source).toContain("part cactus at center size 12");
    expect(run(source ?? "", [rim]).errors).toEqual([]);
  });

  it("does not compose from provenance alone", () => {
    expect(composeFromParts("cactus", [part("p-box", BOX)])).toBeNull();
  });

  it("keeps volcano smoke off a bare mountain", () => {
    expect(volcano("volcano")).toContain("dot ");
    expect(peak("mountain")).not.toContain("dot ");
    expect(tower("lighthouse")).toContain("circle 12,5 r1");
    expect(tower("lighthouse")).not.toContain("circle 12,6 r2");
  });

  it("draws held-out names that are not in the house or glyph set", async () => {
    const cases = [
      ["mushroom", "mushroom"],
      ["hourglass", "hourglass"],
      ["sailboat", "sailboat"],
    ] as const;
    const drawn = await Promise.all(
      cases.flatMap(([name, id]) => [
        analogArm()({ name }).then((result) => ({
          finish: "outlined",
          id,
          name,
          result,
        })),
        analogArm()({ name }, { finish: "filled" }).then((result) => ({
          finish: "filled",
          id,
          name,
          result,
        })),
      ])
    );
    for (const { finish, id, name, result } of drawn) {
      expect(result.brief, `${name} ${finish}`).toBe(`analog ${id} ${name}`);
      expect(result.program, `${name} ${finish}`).not.toContain(
        "circle 12,6 r2"
      );
      expect(result.clean, `${name} ${finish}`).toBe(true);
      if (finish === "filled") {
        expect(result.program, `${name} filled`).toContain("finish filled");
        expect(result.svg, `${name} filled`).toMatch(/<path/u);
      }
    }
  });
});

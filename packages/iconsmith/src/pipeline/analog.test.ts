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
  ANALOG_ALIASES,
  ANALOG_KINS,
  ANALOG_MODIFIERS,
  contentTokens,
  familyFromToken,
  familyFromTokens,
  anchor,
  apple,
  banana,
  bell,
  book,
  camera,
  car,
  clock,
  cloud,
  composeFromParts,
  envelope,
  fish,
  flag,
  flask,
  flower,
  hammer,
  hasStackRim,
  heart,
  horn,
  hourglass,
  hub,
  HUB_HINT,
  HORN_HINT,
  key,
  kinScore,
  kiwi,
  ladder,
  leaf,
  magnet,
  moon,
  mushroom,
  peak,
  pencil,
  pickKin,
  pin,
  plant,
  plus,
  PLANT_HINT,
  preferStroked,
  replay,
  retitle,
  rocket,
  sailboat,
  sameLetters,
  shield,
  stack,
  stapler,
  sun,
  tent,
  tower,
  TOWER_HINT,
  trays,
  trophy,
  tube,
  unknown,
  volcano,
  wine,
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

  it("draws unknown for an unkeyed name that is not a stack or a family", () => {
    const [row] = analogConstructions("xyzzy", [], "xyzzy", false);
    expect(row?.id).toBe("unknown");
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
    expect(analogConstructions("bananas", [], "bananas", false)[0]?.id).toBe(
      "banana"
    );
    expect(analogConstructions("kiwi", [], "kiwi", false)[0]?.id).toBe("kiwi");
    expect(analogConstructions("stapler", [], "stapler", false)[0]?.id).toBe(
      "stapler"
    );
    expect(analogConstructions("envelope", [], "envelope", false)[0]?.id).toBe(
      "envelope"
    );
    expect(analogConstructions("mail", [], "mail", false)[0]?.id).toBe(
      "envelope"
    );
    expect(analogConstructions("bell", [], "bell", false)[0]?.id).toBe("bell");
    expect(analogConstructions("moon", [], "moon", false)[0]?.id).toBe("moon");
    expect(analogConstructions("clock", [], "clock", false)[0]?.id).toBe(
      "clock"
    );
    expect(
      analogConstructions("plus-sign", [], "plus-sign", false)[0]?.id
    ).toBe("plus");
    expect(analogConstructions("map-pin", [], "map-pin", false)[0]?.id).toBe(
      "pin"
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
    expect(rows[0]?.id).toBe("unknown");
    expect(rows[0]?.source).not.toContain("diamond 12,12 r5");
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

  it("falls to unknown, not a hub, when no token names a family", async () => {
    const result = await analogArm()({ name: "xyzzy" });
    expect(result.brief).toBe("analog unknown xyzzy");
    expect(result.program).toContain("dot 12,12 node");
    expect(result.program).not.toContain("circle 12,6 r2");
    expect(result.clean).toBe(true);
  });

  it("draws bananas, kiwi, and stapler as themselves, not unknown", async () => {
    const drawn = await Promise.all(
      (
        [
          ["bananas", "banana"],
          ["kiwi", "kiwi"],
          ["stapler", "stapler"],
        ] as const
      ).map(([name, id]) =>
        analogArm()({ name }).then((result) => ({ id, name, result }))
      )
    );
    for (const { id, name, result } of drawn) {
      expect(result.brief, name).toBe(`analog ${id} ${name}`);
      expect(result.clean, name).toBe(true);
      expect(
        result.issues.some((i) => i.severity === "error"),
        name
      ).toBe(false);
    }
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
    { draw: banana, id: "banana", slug: "bananas" },
    { draw: kiwi, id: "kiwi", slug: "kiwi" },
    { draw: stapler, id: "stapler", slug: "stapler" },
    { draw: envelope, id: "envelope", slug: "envelope" },
    { draw: bell, id: "bell", slug: "bell" },
    { draw: moon, id: "moon", slug: "moon" },
    { draw: sun, id: "sun", slug: "sun" },
    { draw: cloud, id: "cloud", slug: "cloud" },
    { draw: heart, id: "heart", slug: "heart" },
    { draw: pin, id: "pin", slug: "pin" },
    { draw: flag, id: "flag", slug: "flag" },
    { draw: key, id: "key", slug: "key" },
    { draw: book, id: "book", slug: "book" },
    { draw: camera, id: "camera", slug: "camera" },
    { draw: pencil, id: "pencil", slug: "pencil" },
    { draw: shield, id: "shield", slug: "shield" },
    { draw: flask, id: "flask", slug: "flask" },
    { draw: leaf, id: "leaf", slug: "leaf" },
    { draw: apple, id: "apple", slug: "apple" },
    { draw: rocket, id: "rocket", slug: "rocket" },
    { draw: tent, id: "tent", slug: "tent" },
    { draw: fish, id: "fish", slug: "fish" },
    { draw: car, id: "car", slug: "car" },
    { draw: trophy, id: "trophy", slug: "trophy" },
    { draw: hammer, id: "hammer", slug: "hammer" },
    { draw: ladder, id: "ladder", slug: "ladder" },
    { draw: magnet, id: "magnet", slug: "magnet" },
    { draw: wine, id: "wine", slug: "wine" },
    { draw: flower, id: "flower", slug: "flower" },
    { draw: anchor, id: "anchor", slug: "anchor" },
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
    expect(row?.id).toBe("unknown");
    expect(row?.source).not.toContain("diamond 12,12 r5");
  });

  it("composes a named vocabulary part at a named anchor", () => {
    const rim = {
      ...part("ellipse-flat", BOX),
      name: "cactus",
    };
    const source = composeFromParts("cactus", [rim]);
    expect(source).toContain("part cactus fill");
    expect(run(source ?? "", [rim]).errors).toEqual([]);
  });

  it("does not compose from provenance alone", () => {
    expect(composeFromParts("cactus", [part("p-box", BOX)])).toBeNull();
  });

  it("composes a plural query onto the singular part name", () => {
    const fruit = { ...part("p-widget", BOX), name: "widget" };
    const source = composeFromParts("widgets", [fruit]);
    expect(source).toContain("part widget fill");
    expect(
      analogConstructions("widgets", [fruit], "widgets", false)[0]?.id
    ).toBe("compose");
  });

  it("resolves analog aliases offline without a parts extract", () => {
    expect(ANALOG_ALIASES.plantain).toBe("banana");
    expect(ANALOG_KINS.mail).toBe("envelope");
    expect(analogConstructions("plantain", [], "plantain", false)[0]?.id).toBe(
      "banana"
    );
    expect(
      analogConstructions("kiwifruit", [], "kiwifruit", false)[0]?.id
    ).toBe("kiwi");
    expect(
      analogConstructions("staple-gun", [], "staple-gun", false)[0]?.id
    ).toBe("stapler");
    expect(analogConstructions("mail", [], "mail", false)[0]?.id).toBe(
      "envelope"
    );
  });

  it("composes a shipped kin offline when the extract is empty", () => {
    const source = composeFromParts("bananas", []);
    expect(source).toContain("arc ");
    expect(source).toContain("icon bananas");
    expect(composeFromParts("mail", [])).toContain("off-axis");
    expect(composeFromParts("plus-sign", [])).toContain("line 4,12");
    expect(composeFromParts("wall-clock", [])).toContain("circle 12,12 r9");
    expect(composeFromParts("xyzzy", [])).toBeNull();
  });

  it("resolves a new compound from name tokens, not a new kin row", () => {
    expect(ANALOG_KINS["office-mail"]).toBeUndefined();
    expect(ANALOG_KINS["mail-icon"]).toBeUndefined();
    expect(ANALOG_KINS["red-flag"]).toBeUndefined();
    expect(contentTokens("mail-icon")).toEqual(["mail"]);
    expect(ANALOG_MODIFIERS.has("icon")).toBe(true);
    expect(familyFromToken("mail")).toBe("envelope");
    expect(familyFromTokens("office-mail")).toBe("envelope");
    expect(familyFromTokens("mail-icon")).toBe("envelope");
    expect(familyFromTokens("red-flag")).toBe("flag");
    expect(familyFromTokens("hourglass-timer")).toBe("hourglass");
    expect(familyFromTokens("cactus-pot")).toBe("plant");
    expect(familyFromTokens("bananas-bunch")).toBe("banana");
    expect(
      analogConstructions("office-mail", [], "office-mail", false)[0]?.id
    ).toBe("envelope");
    expect(
      analogConstructions("mail-icon", [], "mail-icon", false)[0]?.id
    ).toBe("envelope");
    expect(analogConstructions("red-flag", [], "red-flag", false)[0]?.id).toBe(
      "flag"
    );
    expect(
      analogConstructions("cactus-pot", [], "cactus-pot", false)[0]?.id
    ).toBe("plant");
  });

  it("does not invent a drawing when tokens name two families or a glyph", () => {
    expect(familyFromTokens("flag-mail")).toBeNull();
    expect(familyFromTokens("mailbox")).toBeNull();
    expect(familyFromTokens("compass-rose")).toBeNull();
    expect(familyFromTokens("star")).toBeNull();
    expect(
      analogConstructions("flag-mail", [], "flag-mail", false)[0]?.id
    ).toBe("unknown");
    expect(analogConstructions("mailbox", [], "mailbox", false)[0]?.id).toBe(
      "unknown"
    );
    expect(
      analogConstructions("compass-rose", [], "compass-rose", false)[0]?.id
    ).toBe("unknown");
    expect(analogConstructions("compass", [], "compass", false)[0]?.id).toBe(
      "unknown"
    );
  });

  it("does not treat a leftover hub word as an org chart", () => {
    expect(
      analogConstructions("org-chart", [], "org-chart", false)[0]?.id
    ).toBe("hub");
    expect(analogConstructions("tree", [], "tree", false)[0]?.id).toBe("hub");
    expect(
      analogConstructions("apple-tree", [], "apple-tree", false)[0]?.id
    ).toBe("apple");
    expect(
      analogConstructions("tree-house", [], "tree-house", false)[0]?.id
    ).toBe("unknown");
  });

  it("reaches a named part through a token kin, not a new catalog row", () => {
    const flap = { ...part("p-flap", BOX), name: "envelope" };
    const source = composeFromParts("office-mail", [flap]);
    expect(source).toContain("part envelope fill");
    expect(composeFromParts("flag-mail", [flap])).toContain(
      "part envelope fill"
    );
  });

  it("keeps volcano smoke off a bare mountain", () => {
    expect(volcano("volcano")).toContain("dot ");
    expect(peak("mountain")).not.toContain("dot ");
    expect(tower("lighthouse")).toContain("rect 9,3 6x5");
    expect(tower("lighthouse")).not.toContain("circle 12,6 r2");
  });

  it("draws each named concept with an iconic primitive, not a stack of trays", () => {
    expect(mushroom("mushroom")).toContain("circle 12,9 r7");
    expect(hourglass("hourglass")).toContain("off-axis");
    expect(sailboat("sailboat")).toContain("diamond ");
    expect(peak("mountain")).toContain("diamond ");
    expect(volcano("volcano")).toContain("diamond ");
    expect(horn("unicorn")).toContain("diamond ");
    expect(banana("bananas")).toContain("arc ");
    expect(kiwi("kiwi")).toContain("circle 12,12");
    expect(stapler("stapler")).toContain("rect ");
    expect(envelope("envelope")).toContain("off-axis");
    expect(moon("moon")).toContain("three-quarter");
    expect(unknown("xyzzy")).toContain("dot 12,12 node");
    expect(unknown("xyzzy")).not.toContain("circle 12,6 r2");
    expect(plus("plus-sign")).toContain("line 4,12 20,12");
    expect(plus("plus-sign", "filled")).toContain("rect 3,11 18x2");
    expect(clock("wall-clock")).toContain("circle 12,12 r9");
    expect(clock("wall-clock", "filled")).toContain("hole rect");
  });

  it("keeps cactus arms on the trunk so gap does not warn", async () => {
    const result = await analogArm()({ name: "cactus" });
    expect(result.issues.filter((i) => i.rule === "gap")).toEqual([]);
    expect(result.issues.filter((i) => i.rule === "extent")).toEqual([]);
    expect(result.clean).toBe(true);
  });

  it("keeps unicorn, telescope, and lighthouse free of errors and 0.02px gaps", async () => {
    const names = ["unicorn", "telescope", "lighthouse", "hourglass"] as const;
    const drawn = await Promise.all(
      names.flatMap((name) =>
        (["outlined", "filled"] as const).map((finish) =>
          analogArm()({ name }, { finish }).then((result) => ({
            finish,
            name,
            result,
          }))
        )
      )
    );
    for (const { finish, name, result } of drawn) {
      expect(result.clean, `${name} ${finish}`).toBe(true);
      expect(
        result.issues.filter((i) => i.severity === "error"),
        `${name} ${finish}`
      ).toEqual([]);
      expect(
        result.issues.filter(
          (i) => i.rule === "gap" && i.message.includes("0.02px")
        ),
        `${name} ${finish}`
      ).toEqual([]);
      expect(
        result.issues.filter((i) => i.rule === "keyline"),
        `${name} ${finish}`
      ).toEqual([]);
    }
  });

  it("draws ordinary names as themselves, not unknown or a hub", async () => {
    const cases = [
      ["mail", "envelope"],
      ["bell", "bell"],
      ["moon", "moon"],
      ["map-pin", "pin"],
      ["key", "key"],
      ["book", "book"],
      ["camera", "camera"],
      ["heart", "heart"],
      ["plus-sign", "plus"],
      ["wall-clock", "clock"],
    ] as const;
    const drawn = await Promise.all(
      cases.map(([name, id]) =>
        analogArm()({ name }).then((result) => ({ id, name, result }))
      )
    );
    for (const { id, name, result } of drawn) {
      expect(result.brief, name).toBe(`analog ${id} ${name}`);
      expect(result.clean, name).toBe(true);
      expect(result.program, name).not.toContain("circle 12,6 r2");
    }
  });

  it("leaves names it cannot draw honestly as unknown", () => {
    for (const name of ["xyzzy", "fnord", "quokka", "star", "compass"]) {
      const [row] = analogConstructions(name, [], name, false);
      expect(row?.id, name).toBe("unknown");
    }
  });

  it("keeps unknown clean in both paints", () => {
    for (const finish of ["outlined", "filled"] as const) {
      const source = unknown("bananas", finish);
      const drawn = run(source, []);
      expect(drawn.errors, finish).toEqual([]);
      expect(source).toContain(`finish ${finish}`);
    }
  });

  it("draws held-out names that are not in the house or glyph set", async () => {
    const cases = [
      ["mushroom", "mushroom"],
      ["hourglass", "hourglass"],
      ["sailboat", "sailboat"],
      ["bananas", "banana"],
      ["kiwi", "kiwi"],
      ["stapler", "stapler"],
      ["envelope", "envelope"],
      ["bell", "bell"],
      ["moon", "moon"],
      ["plus-sign", "plus"],
      ["wall-clock", "clock"],
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

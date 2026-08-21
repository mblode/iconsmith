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
  hasStackRim,
  hub,
  HUB_HINT,
  kinScore,
  pickKin,
  preferStroked,
  replay,
  retitle,
  sameLetters,
  stack,
  trays,
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
    const [row] = analogConstructions("database", [rim], "database", false);
    expect(row?.id).toBe("stack");
    expect(hasStackRim([rim])).toBe(true);
  });

  it("falls back to trays when the name says cylinder but the extract is empty", () => {
    const [row] = analogConstructions("database", [], "database", false);
    expect(row?.id).toBe("trays");
  });

  it("draws a hub for an unkeyed name that is not a stack", () => {
    const [row] = analogConstructions("unicorn", [], "unicorn", false);
    expect(row?.id).toBe("hub");
    expect(HUB_HINT.test("org-chart")).toBe(true);
    expect(HUB_HINT.test("unicorn")).toBe(false);
  });

  it("replays a house kin instead of a hub", () => {
    const [row] = analogConstructions("cookie", [], "cookie", false, {
      paths: [BOX],
      slug: "cookies",
    });
    expect(row?.id).toBe("replay");
    expect(row?.source.startsWith("icon cookie\n")).toBe(true);
    expect(row?.source).toContain("part ");
  });

  it("keeps a cylinder name on trays even when a kin is offered", () => {
    const [row] = analogConstructions("database", [], "database", false, {
      paths: [BOX],
      slug: "server",
    });
    expect(row?.id).toBe("trays");
  });

  it("collides trays and hub when a look will curate", () => {
    const ids = analogConstructions("unicorn", [], "unicorn", true).map(
      (r) => r.id
    );
    expect(ids).toEqual(["trays", "hub"]);
  });
});

describe("analogArm", () => {
  it("draws trays for database with no model and no extract", async () => {
    const result = await analogArm()({ name: "database" });
    expect(result.cost).toBeUndefined();
    expect(result.brief).toBe("analog trays database");
    expect(result.program).toContain("rect ");
    expect(result.clean).toBe(true);
  });

  it("compiles a house kin as the concept, with no model", async () => {
    const result = await analogArm()(
      { name: "cookie" },
      { analogOf: "cookies", analogPaths: [BOX] }
    );
    expect(result.brief).toBe("analog replay cookies cookie");
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
            sc: n === 2 ? 9 : 3,
          });
        },
      }
    );
    expect(result.brief).toBe("analog hub unicorn");
    expect(result.audit?.sc).toBe(9);
  });
});

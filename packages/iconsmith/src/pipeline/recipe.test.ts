import { describe, expect, it } from "vitest";

import { analogArm, analogConstructions, ANALOG_KINS } from "./analog.js";
import { PAINT_RECIPES, recipeBrief, recipeFor } from "./recipe.js";

describe("recipeFor", () => {
  it("names a construction only when the query asked for it", () => {
    expect(recipeFor("wall-clock")?.id).toBe("clock");
    expect(recipeFor("plus-sign")?.id).toBe("plus");
    expect(recipeFor("checkmark")?.id).toBe("check");
    expect(recipeFor("plus-large")?.id).toBe("plus");
    expect(recipeFor("home")?.id).toBe("home");
    expect(recipeFor("heart")?.id).toBe("heart");
    expect(recipeFor("zap")?.id).toBe("zap");
    expect(recipeFor("lightning")?.id).toBe("zap");
    expect(recipeFor("shield")?.id).toBe("shield");
  });

  it("does not volunteer a glyph the name did not ask for", () => {
    expect(recipeFor("star")).toBeNull();
    expect(recipeFor("compass")).toBeNull();
    expect(recipeFor("quokka")).toBeNull();
    expect(recipeFor("clock-check")).toBeNull();
  });
});

describe("recipeBrief", () => {
  it("states the paint this run must draw", () => {
    expect(recipeBrief("clock", "outlined")).toContain("polyline");
    expect(recipeBrief("clock", "filled")).toContain("cut out");
    expect(recipeBrief("plus", "filled")).toContain("evenodd");
    expect(recipeBrief("heart", "outlined")).toContain("lobes");
    expect(recipeBrief("heart", "outlined")).toContain("Not three circles");
    expect(recipeBrief("heart", "filled")).toContain("evenodd");
    expect(recipeBrief("heart", "filled")).toContain("Not a disc");
    expect(recipeBrief("zap", "outlined")).toContain("lightning");
    expect(recipeBrief("shield", "outlined")).toContain("heater");
    expect(recipeBrief("star")).toBeNull();
    expect(recipeBrief("xyzzy")).toBeNull();
  });
});

describe("recipe → family", () => {
  it("draws every recipe in both paints, without a kin row", async () => {
    for (const recipe of PAINT_RECIPES) {
      expect(ANALOG_KINS[recipe.id], recipe.id).toBeUndefined();
      for (const token of recipe.tokens) {
        expect(ANALOG_KINS[token], token).toBeUndefined();
        const [row] = analogConstructions(token, [], token, false);
        expect(row?.id, token).toBe(recipe.id);
        expect(row?.id, token).not.toBe("unknown");
      }
    }
    const leftover = await analogArm()({ name: "checkmark" });
    const filled = await analogArm()(
      { name: "checkmark" },
      { finish: "filled" }
    );
    expect(leftover.brief).toBe("analog check checkmark");
    expect(leftover.program).toContain("line 3,14");
    expect(leftover.program).not.toContain("dot 12,12 node");
    expect(leftover.clean).toBe(true);
    expect(filled.brief).toBe("analog check checkmark");
    expect(filled.program).toContain("hole line");
    expect(filled.clean).toBe(true);
    const cottage = await analogArm()({ name: "home" });
    const cottageFill = await analogArm()(
      { name: "home" },
      { finish: "filled" }
    );
    expect(cottage.brief).toBe("analog home home");
    expect(cottage.program).toContain("line 12,3 20,8 20,20 4,20 4,8 12,3");
    expect(cottage.program).not.toContain("dot 12,12 node");
    expect(cottage.clean).toBe(true);
    expect(cottageFill.program).toContain("diamond 12,8 r5");
    expect(cottageFill.clean).toBe(true);
    const love = await analogArm()({ name: "heart" });
    const loveFill = await analogArm()({ name: "heart" }, { finish: "filled" });
    expect(love.brief).toBe("analog heart heart");
    expect(love.program).toContain("line 8,4 3,8 3,11 12,20");
    expect(love.program).not.toContain("circle ");
    expect(love.program).not.toContain("arc ");
    expect(love.program).not.toContain("dot 12,12 node");
    expect(love.clean).toBe(true);
    expect(loveFill.program).toContain("rect ");
    expect(loveFill.program).toContain("diamond 12,13.5 r6.5");
    expect(loveFill.program).not.toContain("circle ");
    expect(loveFill.clean).toBe(true);
    const bolt = await analogArm()({ name: "zap" });
    const boltFill = await analogArm()({ name: "zap" }, { finish: "filled" });
    expect(bolt.brief).toBe("analog zap zap");
    expect(bolt.program).toContain("line 13,3 13,9 20,9 11,21");
    expect(bolt.program).not.toContain("dot 12,12 node");
    expect(bolt.clean).toBe(true);
    expect(boltFill.program).toContain("line 13,4 5,14");
    expect(boltFill.clean).toBe(true);
    const [holdout] = analogConstructions("quokka", [], "quokka", false);
    expect(recipeFor("quokka")).toBeNull();
    expect(holdout?.id).toBe("unknown");
  });
});

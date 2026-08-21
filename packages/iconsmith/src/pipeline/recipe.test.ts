import { describe, expect, it } from "vitest";

import { analogArm, analogConstructions, ANALOG_KINS } from "./analog.js";
import {
  holdoutBrief,
  PAINT_RECIPES,
  recipeBrief,
  recipeFor,
  steerBrief,
} from "./recipe.js";

describe("recipeFor", () => {
  it("names a construction only when the query asked for it", () => {
    expect(recipeFor("wall-clock")?.id).toBe("clock");
    expect(recipeFor("plus-sign")?.id).toBe("plus");
    expect(recipeFor("checkmark")?.id).toBe("check");
    expect(recipeFor("plus-large")?.id).toBe("plus");
    expect(recipeFor("home")?.id).toBe("home");
    expect(recipeFor("heart")?.id).toBe("heart");
  });

  it("does not volunteer a glyph the name did not ask for", () => {
    expect(recipeFor("star")).toBeNull();
    expect(recipeFor("compass")).toBeNull();
    expect(recipeFor("quokka")).toBeNull();
    expect(recipeFor("clock-check")).toBeNull();
    expect(recipeFor("clock-heart")).toBeNull();
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
    expect(recipeBrief("star")).toBeNull();
    expect(recipeBrief("xyzzy")).toBeNull();
  });
});

describe("steerBrief", () => {
  it("names the house heart and holds out a star", () => {
    expect(steerBrief("heart", "outlined")).toContain(
      "House construction (heart, outlined)"
    );
    expect(steerBrief("heart", "filled")).toContain("Not a disc");
    expect(holdoutBrief("star")).toContain("Do not volunteer a star glyph");
    expect(holdoutBrief("star")).toContain("four diamonds");
    expect(steerBrief("star")).toBe(holdoutBrief("star"));
    expect(steerBrief("star")).not.toContain("House construction");
    expect(holdoutBrief("heart")).toBeNull();
    expect(holdoutBrief("north-star")).toBeNull();
    expect(Object.hasOwn(ANALOG_KINS, "star")).toBe(false);
    expect(Object.hasOwn(ANALOG_KINS, "heart")).toBe(false);
    expect(Object.keys(ANALOG_KINS)).toHaveLength(40);
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
    expect(cottage.program).toContain("line 4,10 12,2 20,10");
    expect(cottage.program).not.toContain("dot 12,12 node");
    expect(cottage.clean).toBe(true);
    expect(cottageFill.program).toContain("diamond 12,10 r8");
    expect(cottageFill.clean).toBe(true);
    const love = await analogArm()({ name: "heart" });
    const loveFill = await analogArm()({ name: "heart" }, { finish: "filled" });
    expect(love.brief).toBe("analog heart heart");
    expect(love.program).toContain("arc 8,9 r5 half from left");
    expect(love.program).toContain("diamond 12,14 r6");
    expect(love.program).not.toContain("circle ");
    expect(love.program).not.toContain("dot 12,12 node");
    expect(love.clean).toBe(true);
    expect(loveFill.program).toContain("circle 8,9 r6");
    expect(loveFill.program).not.toMatch(/^circle 12,12 r\d+$/mu);
    expect(loveFill.clean).toBe(true);
    const [holdout] = analogConstructions("quokka", [], "quokka", false);
    expect(recipeFor("quokka")).toBeNull();
    expect(holdout?.id).toBe("unknown");
  });
});

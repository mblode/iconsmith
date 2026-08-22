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
    expect(recipeFor("zap")?.id).toBe("zap");
    expect(recipeFor("lightning")?.id).toBe("zap");
    expect(recipeFor("shield")?.id).toBe("shield");
    expect(recipeFor("pause")?.id).toBe("pause");
    expect(recipeFor("play")?.id).toBe("play");
    expect(recipeFor("arrow-right")?.id).toBe("arrow");
    expect(recipeFor("chevron-right")?.id).toBe("chevron");
    expect(recipeFor("bookmark")?.id).toBe("bookmark");
    expect(recipeFor("share")?.id).toBe("share");
    expect(recipeFor("airdrop")?.id).toBe("airdrop");
    expect(recipeFor("airplane")?.id).toBe("airplane");
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
    expect(ANALOG_KINS.star).toBeUndefined();
    expect(ANALOG_KINS.heart).toBeUndefined();
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
    expect(leftover.program).toContain("line 20,6");
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
    expect(love.program).toContain("line 8,4 6,4 4,5 3,7 3,10");
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
    expect(bolt.program).toContain("line 13,2.4 13,9 19.6,9");
    expect(bolt.program).not.toContain("dot 12,12 node");
    expect(bolt.clean).toBe(true);
    expect(boltFill.program).toContain("rect 7,7 10x10");
    expect(boltFill.program).toContain("line 13,3 4.4,15");
    expect(boltFill.clean).toBe(true);
    const [holdout] = analogConstructions("quokka", [], "quokka", false);
    expect(recipeFor("quokka")).toBeNull();
    expect(holdout?.id).toBe("unknown");
  });
});

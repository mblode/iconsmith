import { describe, expect, it } from "vitest";

import { analogArm, analogConstructions, ANALOG_KINS } from "./analog.js";
import { PAINT_RECIPES, recipeBrief, recipeFor } from "./recipe.js";

describe("recipeFor", () => {
  it("names a construction only when the query asked for it", () => {
    expect(recipeFor("wall-clock")?.id).toBe("clock");
    expect(recipeFor("plus-sign")?.id).toBe("plus");
    expect(recipeFor("checkmark")?.id).toBe("check");
    expect(recipeFor("plus-large")?.id).toBe("plus");
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
    const [holdout] = analogConstructions("quokka", [], "quokka", false);
    expect(recipeFor("quokka")).toBeNull();
    expect(holdout?.id).toBe("unknown");
  });
});

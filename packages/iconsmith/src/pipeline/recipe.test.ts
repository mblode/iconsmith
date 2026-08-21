import { describe, expect, it } from "vitest";

import { recipeBrief, recipeFor } from "./recipe.js";

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

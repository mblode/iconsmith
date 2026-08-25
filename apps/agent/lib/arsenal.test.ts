import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadStudioArsenal } from "./arsenal.ts";

describe("loadStudioArsenal", () => {
  it("loads house references without reading node_modules from cwd", async () => {
    const arsenal = await loadStudioArsenal({ name: "umbrella" });
    assert.ok(arsenal.references.length > 0);
    assert.ok(arsenal.references.some((reference) => reference.svg.includes("<svg")));
    assert.ok(
      arsenal.references.some((reference) => /umbrella|parasol/u.test(reference.name)),
      "umbrella should match a house drawing",
    );
  });

  it("always includes the style-anchor drawings when they exist", async () => {
    const arsenal = await loadStudioArsenal({ name: "zzzz-unmatched-concept" });
    const names = new Set(arsenal.references.map((reference) => reference.name));
    for (const slug of ["folder-1", "clock", "arrow-up-right", "calendar-1"]) {
      assert.ok(names.has(slug), slug);
    }
  });
});

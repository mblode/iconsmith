import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { loadCatalogFamilies } from "./catalog-families.js";

it("uses stated families and numbered variants without collapsing unrelated prefixes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-families-"));
  try {
    const library = path.join(root, "icons-svg");
    const data = path.join(root, "icons-data");
    mkdirSync(data);
    expect(
      loadCatalogFamilies(library, "blode-icons", ["square-user"]).roles
    ).toEqual([]);
    writeFileSync(
      path.join(data, "_cohorts.json"),
      JSON.stringify({ plane: ["airplane", "airplane-up"] })
    );
    writeFileSync(
      path.join(data, "_concepts.json"),
      JSON.stringify({ concepts: { fly: "airplane" } })
    );
    const names = [
      "airplane",
      "airplane-up",
      "chart-1",
      "chart-2",
      "square-user",
      "square-arrow",
    ];
    const result = loadCatalogFamilies(library, "blode-icons", names);
    expect(
      result.roles.find(({ slug }) => slug === "airplane-up")?.family
    ).toBe("plane");
    expect(result.roles.find(({ slug }) => slug === "chart-2")?.family).toBe(
      "#chart"
    );
    expect(
      result.roles.find(({ slug }) => slug === "square-user")?.family
    ).toBe("square-user");
    writeFileSync(path.join(data, "_cohorts.json"), "{}");
    expect(
      loadCatalogFamilies(library, "blode-icons", names).identity
    ).not.toBe(result.identity);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compileStyle,
  createStyleRevision,
  selectStyle,
  STYLE_COMPILER,
} from "../src/pipeline/style.js";

const root = new URL("../../../examples/starter/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root), "utf-8");

describe("portable original starter reference family", () => {
  it("loads a current self-contained revision without parts or corpus", () => {
    const revision = createStyleRevision(JSON.parse(read("revision.json")));
    expect(revision.definition.compiler).toBe(STYLE_COMPILER);
    expect(revision.definition.calibration).toBe("unvalidated");
    expect(revision.definition.parts).toEqual([]);
    const style = selectStyle(revision, "24");
    expect(style.references).toHaveLength(4);
    expect(style.spec.size).toBe(24);
    const labels = JSON.parse(read("meanings.json")) as string[];
    expect(labels).toContain("square-check");
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(labels.length).toBeLessThanOrEqual(12);
  });
  it("pins every shipped SVG to editable original DSL and MIT provenance", () => {
    const revision = createStyleRevision(JSON.parse(read("revision.json")));
    const style = selectStyle(revision, "24");
    const names = readdirSync(fileURLToPath(new URL("references/", root)));
    expect(names.filter((name) => name.endsWith(".svg"))).toHaveLength(4);
    for (const reference of revision.definition.references) {
      expect(reference.provenance).toMatchObject({
        licenses: ["MIT"],
        origin: "original",
      });
      const { svg } = compileStyle(
        style,
        read(`references/${reference.name}.icon`)
      );
      expect(svg).toBe(read(`references/${reference.name}.svg`));
      expect(svg).toBe(reference.svg);
    }
    expect(read("LICENSE.md")).toContain("Permission is hereby granted");
  });
});

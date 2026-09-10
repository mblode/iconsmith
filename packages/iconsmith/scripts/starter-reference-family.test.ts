import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createStyleRevision,
  selectStyle,
  STYLE_COMPILER,
} from "../src/pipeline/style.js";
import { BLODE_ICONS_PACKAGE, BLODE_ICONS_SVG_URL } from "./blode-icons.js";

const root = new URL("../../../examples/starter/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root), "utf-8");

describe("bundled blode-icons default reference family", () => {
  it("loads a current self-contained revision without parts or corpus", () => {
    const revision = createStyleRevision(JSON.parse(read("revision.json")));
    expect(revision.definition.compiler).toBe(STYLE_COMPILER);
    expect(revision.definition.calibration).toBe("unvalidated");
    expect(revision.definition.parts).toEqual([]);
    const style = selectStyle(revision, "24");
    expect(style.references).toHaveLength(5);
    expect(style.spec.size).toBe(24);
    const labels = JSON.parse(read("meanings.json")) as string[];
    expect(labels).toContain("square-check");
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(labels.length).toBeLessThanOrEqual(12);
  });
  it("pins every shipped SVG byte-for-byte to the bundled blode-icons library", () => {
    const revision = createStyleRevision(JSON.parse(read("revision.json")));
    const names = readdirSync(fileURLToPath(new URL("references/", root)));
    expect(names.filter((name) => name.endsWith(".svg"))).toHaveLength(5);
    const source = JSON.parse(
      readFileSync(`${BLODE_ICONS_PACKAGE}/SOURCE.json`, "utf-8")
    ) as { commit: string; set: string };
    expect(source.set).toBe("blode-icons");
    for (const reference of revision.definition.references) {
      expect(reference.provenance).toMatchObject({
        icon: reference.name,
        licenses: ["MIT"],
        origin: "literal",
        set: "blode-icons",
      });
      expect(source.commit.startsWith(reference.provenance.version ?? "")).toBe(
        true
      );
      const library = readFileSync(
        new URL(`${reference.name}.svg`, BLODE_ICONS_SVG_URL),
        "utf-8"
      );
      expect(library).not.toContain("lucide");
      expect(reference.svg).toBe(library);
      expect(read(`references/${reference.name}.svg`)).toBe(library);
    }
    expect(
      readFileSync(`${BLODE_ICONS_PACKAGE}/LICENSE.md`, "utf-8")
    ).toContain("Permission is hereby granted");
  });
});

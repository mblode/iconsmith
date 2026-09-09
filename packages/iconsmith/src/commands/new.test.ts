/**
 * Product-path house lookup: both paints, not outline-only.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FILLED_VARIANT, HOUSE_VARIANT } from "../corpus/load.js";
import { houseAt, resolveParts, unkeyedOf } from "./new.js";

const OUTLINED =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M4 4H20V20H4Z" stroke="currentColor" stroke-width="2"/></svg>';
const FILLED =
  '<svg viewBox="0 0 24 24"><path d="M2 2H22V22H2Z" fill="currentColor"/></svg>';

describe("houseAt", () => {
  it("reads the filled variant when asked for finish filled", () => {
    const root = mkdtempSync(path.join(tmpdir(), "iconsmith-house-"));
    mkdirSync(path.join(root, HOUSE_VARIANT), { recursive: true });
    mkdirSync(path.join(root, FILLED_VARIANT), { recursive: true });
    writeFileSync(path.join(root, HOUSE_VARIANT, "clock.svg"), OUTLINED);
    writeFileSync(path.join(root, FILLED_VARIANT, "clock.svg"), FILLED);
    const house = houseAt(root);
    expect(house.has("clock")).toBe(true);
    expect(house.paths("clock", "outlined")?.[0]).toContain("M4 4");
    expect(house.paths("clock", "filled")?.[0]).toContain("M2 2");
    expect(house.paths("clock", "filled")?.[0]).not.toBe(
      house.paths("clock", "outlined")?.[0]
    );
  });

  it("returns null for a paint that is not on disk", () => {
    const root = mkdtempSync(path.join(tmpdir(), "iconsmith-house-"));
    mkdirSync(path.join(root, HOUSE_VARIANT), { recursive: true });
    writeFileSync(path.join(root, HOUSE_VARIANT, "clock.svg"), OUTLINED);
    expect(houseAt(root).paths("clock", "filled")).toBeNull();
  });
});

describe("unkeyedOf", () => {
  it("defaults to AI; mixture, analog and harness opt out", () => {
    expect(unkeyedOf({})).toBe("agent");
    expect(unkeyedOf({ mixture: true })).toBe("mixture");
    expect(unkeyedOf({ analog: true })).toBe("analog");
    expect(unkeyedOf({ harness: "codex" })).toBe("harness");
  });
});

describe("resolveParts", () => {
  it("loads parts.json from the working directory when no flag is passed", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-parts-"));
    writeFileSync(
      path.join(cwd, "parts.json"),
      `${JSON.stringify({ parts: [] })}\n`
    );
    expect(resolveParts(undefined, cwd)).toEqual([]);
    expect(
      resolveParts(undefined, mkdtempSync(path.join(tmpdir(), "empty-")))
    ).toEqual([]);
  });
});

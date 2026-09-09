import { describe, expect, test } from "vitest";

import {
  CONSTRUCTION_BOARD_CASES,
  constructionClassCoverage,
  constructionProgram,
} from "./family-construction-board.js";
import type { FamilySource } from "./family-parts.js";

const source = (name: string): FamilySource => ({
  finish: "outlined",
  name,
  provenance: {
    date: "2026-09-08",
    licenses: ["MIT"],
    origin: "literal",
    set: "blode-icons",
  },
  svg: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 4H20V20H4Z"/></svg>',
});

describe("family construction board", () => {
  test("covers every required class with two distinct disclosed families", () => {
    const coverage = constructionClassCoverage(CONSTRUCTION_BOARD_CASES);
    expect(Object.keys(coverage).toSorted()).toEqual([
      "asymmetric",
      "container",
      "dense",
      "narrow",
      "organic",
      "symbol",
      "tool",
      "transport",
    ]);
    expect(
      Object.values(coverage).every((families) => families.length >= 2)
    ).toBe(true);
    expect(CONSTRUCTION_BOARD_CASES.map(({ family }) => family)).toEqual(
      expect.arrayContaining([
        "folder-lock",
        "cloud-upload",
        "bell-pause",
        "camera",
        "shield-check",
        "hammer-check",
        "jellyfish",
        "heart",
        "eye",
        "bicycle",
        "scissors",
        "credit-card-check",
        "repeated-grid",
      ])
    );
  });

  test("emits editable admitted-part DSL for reconstruction and composition", () => {
    const reconstructed = constructionProgram(
      {
        classes: ["container"],
        family: "box",
        mode: "reconstruction",
        notes: [],
        primary: "box",
        sources: ["box"],
      },
      "outlined",
      [source("box")]
    );
    expect(reconstructed).toContain("part box-outlined-0 at 4,4 scale 1");

    const composed = constructionProgram(
      {
        classes: ["container", "symbol"],
        family: "box-check",
        mode: "composition",
        notes: [],
        placements: [{ name: "check", scale: 0.5, x: 12, y: 12 }],
        primary: "box",
        sources: ["box", "check"],
      },
      "outlined",
      [source("box"), source("check")]
    );
    expect(composed).toContain("part check-outlined-0 at 12,12 scale 0.5");
    expect(composed).not.toContain("raw");
  });
});

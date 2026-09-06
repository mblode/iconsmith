import { describe, expect, it } from "vitest";

import type { FamilySource } from "./family-parts.js";
import { libraryCandidates } from "./local-retrieval.js";

const source = (name: string, svg: string): FamilySource => ({
  finish: "outlined",
  name,
  provenance: { date: "2026-09-07", origin: "literal", set: "blode-icons" },
  svg,
});

describe("library retrieval exclusions", () => {
  it("excludes target aliases and byte-identical drawings under different names", () => {
    const sources = [
      source("bike", "a"),
      source("cycle", "a"),
      source("wheelchair", "b"),
    ];
    expect(
      libraryCandidates(sources, "bicycle", new Map([["bike", ["bicycle"]]]))
    ).toEqual([sources[2]]);
  });
  it("keeps useful neighboring families while respecting explicit exclusion sets", () => {
    const sources = [
      source("shield", "a"),
      source("shield-check", "b"),
      source("check", "c"),
    ];
    expect(
      libraryCandidates(sources, "Shield Check", new Map(), ["check"])
    ).toEqual([sources[0]]);
  });
});

it("pins visually selected references and admits parts while retaining native fidelity refusals", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { default: path } = await import("node:path");
  const { createStyleRevision, STYLE_COMPILER } =
    await import("../src/pipeline/style.js");
  const { DEFAULT_POLICY } = await import("../src/pipeline/policy.js");
  const { SPEC } = await import("../src/tools/canvas.js");
  const { retrieveLocalStyle } = await import("./local-retrieval.js");
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-retrieve-"));
  const library = path.join(root, "library");
  mkdirSync(library);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M4 4H20V20H4ZM8 8H16V16H8Z"/></svg>';
  const bad =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path transform="translate(1 0)" d="M4 4H20V20H4Z"/></svg>';
  writeFileSync(path.join(library, "box-filled.svg"), svg);
  writeFileSync(path.join(library, "tray-filled.svg"), bad);
  const revision = createStyleRevision({
    calibration: "unvalidated",
    compiler: STYLE_COMPILER,
    id: "retrieval-test",
    masters: { "24": SPEC },
    parts: [],
    policy: DEFAULT_POLICY,
    references: [
      {
        master: "24",
        name: "style-anchor",
        provenance: source("box", svg).provenance,
        svg,
      },
    ],
    rubric: "test",
  });
  try {
    const result = await retrieveLocalStyle({
      concept: "package-lock",
      library,
      master: "24",
      out: path.join(root, "retrieval"),
      review: ({ questions }) =>
        Promise.resolve({
          answers: Object.fromEntries(
            questions.map((question, i) => {
              let choice = i === 0 ? "box" : "tray";
              if (question.id.startsWith("candidate")) {
                choice = "reference-and-parts";
              }
              return [
                question.id,
                { choice, evidence: "fixture selection", treatment: "" },
              ];
            })
          ),
          apiChargeUsd: null,
          billing: "subscription",
          craftApproved: false,
          evidenceHashes: {},
          instrumentQualified: false,
          model: "test",
          status: "complete",
        }),
      revision,
      set: "blode-icons",
    });
    expect(result.definition.references).toHaveLength(2);
    expect(result.definition.parts).toHaveLength(1);
    expect(result.definition.parts[0].part.d.match(/M/gu)).toHaveLength(2);
    expect(revision.definition.parts).toHaveLength(0);
    expect(
      readFileSync(path.join(root, "retrieval/selection.json"), "utf-8")
    ).toContain("unsupported source semantics");
    await expect(
      retrieveLocalStyle({
        concept: "x",
        library,
        master: "24",
        out: path.join(root, "forbidden"),
        revision,
        set: "lucide",
      })
    ).rejects.toThrow();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

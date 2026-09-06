import { expect, it } from "vitest";

import {
  constructionEvidence,
  constructionStyleQuestion,
  strokeFacts,
} from "./review-construction.js";

it("measures inherited and mixed widths on the same normalized grid", () => {
  const facts = strokeFacts(
    '<svg viewBox="0 0 48 48" stroke="black" stroke-width="4"><path d="M0 0L10 10"/><path d="M0 10L10 0" stroke-width="3"/></svg>'
  );
  expect(facts.status).toBe("measured");
  expect(facts.declaredStrokeWidthsOn24Grid).toEqual([1.5, 2]);
});

it("does not interpret expanded filled geometry as a measured zero-width stroke", () => {
  const facts = strokeFacts(
    '<svg viewBox="0 0 24 24"><path d="M0 0L10 0L10 10Z" fill="black"/></svg>'
  );
  expect(facts.declaredStrokeWidthsOn24Grid).toEqual([]);
  expect(facts.widthInference).toContain("cannot be inferred");
});

it("refuses unsupported rendering features and ambiguous units", () => {
  for (const svg of [
    '<svg><path d="M0 0L1 1"/></svg>',
    '<svg viewBox="0 0 24 24"><g stroke="black"><path d="M0 0L1 1"/></g></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0L1 1" transform="scale(2)"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0L1 1" stroke="black" stroke-width="2em"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0L1 1" stroke="black" stroke-width="1e999"/></svg>',
    '<svg viewBox="0 0 24 24"><polygon points="0,0 1,1 0,1"/></svg>',
  ]) {
    expect(strokeFacts(svg).status).toBe("unavailable");
  }
});

it("binds neutral measurements to the exact candidate and reference images", () => {
  const svg =
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="black" stroke-width="2"/></svg>';
  const input = {
    candidates: { outlined: { proof: Buffer.from("first proof"), svg } },
    nativeSize: 16,
    referenceSheet: Buffer.from("reference sheet"),
    references: [svg],
  };
  const facts = constructionEvidence(input);
  expect(facts.referencesInSheetOrder[0].index).toBe(0);
  expect(constructionStyleQuestion(facts).prompt).toContain(
    "perceptual harmony"
  );
  const changed = constructionEvidence({
    ...input,
    candidates: { outlined: { proof: Buffer.from("different proof"), svg } },
  });
  expect(changed.candidates.outlined.proofSha256).not.toBe(
    facts.candidates.outlined.proofSha256
  );
  expect(changed.candidates.outlined.svgSha256).toBe(
    facts.candidates.outlined.svgSha256
  );
});

it("excludes closed contour caps while preserving open-path cap facts", () => {
  const svg =
    '<svg viewBox="0 0 24 24" stroke="black" stroke-width="2"><circle cx="12" cy="12" r="9" stroke-linecap="butt"/><path d="M8 8L12 12" stroke-linecap="round"/></svg>';
  expect(strokeFacts(svg).declaredCapsOnOpenStrokedSubpaths).toEqual(["round"]);
  expect(
    strokeFacts(
      svg.replace('stroke-linecap="round"', 'stroke-linecap="inherit"')
    ).status
  ).toBe("unavailable");
});

import { expect, test } from "vitest";

import { conceptPrompt, FILLED_PAINT_RULE, systemPrompt } from "./prompt.js";

test("the cohort brief appears only when a family has been measured", () => {
  // `cohort` targets a measurement, so naming the op with nothing to measure
  // against would offer the model an operation it cannot carry out.
  expect(systemPrompt()).not.toContain("cohort");

  const p = systemPrompt({
    cohort: {
      extent: { x: [4, 20], y: null },
      members: ["bell-active", "bell-off"],
      name: "bell",
    },
  });
  expect(p).toContain("`bell`");
  expect(p).toContain("bell-active, bell-off");
  expect(p).toContain("x spans 4.00..20.00");
  // An axis the family never agreed on is stated as such, not left blank.
  expect(p).toContain("y has no agreed extent");
  expect(p).toContain("instead of**\n  `fit`");
});

test("a filled run tells the model this canvas is solid, not outlined", () => {
  const outlined = systemPrompt();
  const filled = systemPrompt({ finish: "filled" });
  expect(outlined).toContain("Every shape you");
  expect(outlined).toContain("place is an outline");
  expect(outlined).not.toContain("This run is the solid variant");
  expect(filled).toContain(FILLED_PAINT_RULE);
  expect(filled).not.toContain("place is an outline");
});

test("the per-icon brief names the paint and refuses a frame-and-dot", () => {
  expect(conceptPrompt({ name: "quokka" })).toContain("Paint: outlined.");
  expect(conceptPrompt({ name: "quokka" })).toContain(
    "not a generic frame-and-dot"
  );
  const filled = conceptPrompt({ name: "quokka" }, "filled");
  expect(filled).toContain("Paint: filled.");
  expect(filled).toContain("`hole`");
  expect(filled).toContain("do not flood the bbox");
  expect(filled).toContain("frame with a centre dot is not the concept");
});

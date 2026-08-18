import { expect, test } from "vitest";

import { systemPrompt } from "./prompt.js";

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

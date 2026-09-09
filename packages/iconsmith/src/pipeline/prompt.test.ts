import { expect, test } from "vitest";

import {
  conceptPrompt,
  confirmSystemPrompt,
  FILLED_PAINT_RULE,
  systemPrompt,
} from "./prompt.js";

test("fresh generation never claims a house analog is already on its canvas", () => {
  const prompt = conceptPrompt({ name: "home" }, "outlined", {
    allowHouseConstruction: false,
  });
  expect(prompt).not.toContain("already holds");
  expect(prompt).not.toContain("Call confirm");
  expect(prompt).toContain("Compose the named object");
  expect(conceptPrompt({ name: "home" })).toContain("Call confirm");
});

test("a seeded confirm prompt is the spec and the paint, not the grammar", () => {
  const outlined = confirmSystemPrompt();
  expect(outlined).toContain("24×24");
  expect(outlined).toContain("Paint: outlined");
  expect(outlined).toContain("Call confirm");
  expect(outlined).not.toContain("Every shape you");
  const filled = confirmSystemPrompt({ finish: "filled" });
  expect(filled).toContain("Paint: filled");
  expect(filled).not.toContain(FILLED_PAINT_RULE);
});

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
  expect(outlined).toContain("Outlined bodies use centerlines");
  expect(outlined).toContain("explicit solid modifiers");
  expect(outlined).not.toContain("This run is the solid variant");
  expect(filled).toContain(FILLED_PAINT_RULE);
  expect(filled).toContain("immediately after");
  expect(filled).toContain("not a disc");
  expect(filled).toContain("Do not volunteer a star from diamonds");
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
  expect(conceptPrompt({ name: "wall-clock" })).toContain(
    "House construction (clock, outlined)"
  );
  expect(conceptPrompt({ name: "plus-sign" }, "filled")).toContain(
    "House construction (plus, filled)"
  );
  expect(conceptPrompt({ name: "checkmark" })).toContain(
    "House construction (check, outlined)"
  );
  expect(conceptPrompt({ name: "home" })).toContain(
    "House construction (home, outlined)"
  );
  expect(conceptPrompt({ name: "heart" })).toContain(
    "House construction (heart, outlined)"
  );
  expect(conceptPrompt({ name: "heart" })).not.toContain("Not three circles");
  expect(conceptPrompt({ name: "heart" }, "filled")).not.toContain(
    "Not a disc"
  );
  expect(conceptPrompt({ name: "zap" })).toContain(
    "House construction (zap, outlined)"
  );
  expect(conceptPrompt({ name: "shield" })).toContain(
    "House construction (shield, outlined)"
  );
  expect(conceptPrompt({ name: "play" })).toContain(
    "House construction (play, outlined)"
  );
  expect(conceptPrompt({ name: "arrow-right" })).toContain(
    "House construction (arrow, outlined)"
  );
  expect(conceptPrompt({ name: "quokka" })).not.toContain("House construction");
  expect(conceptPrompt({ name: "star" })).not.toContain("House construction");
  expect(conceptPrompt({ name: "star" })).toContain(
    "Do not volunteer a star glyph"
  );
  expect(conceptPrompt({ name: "heart" })).toContain(
    "The canvas already holds the host heart analog"
  );
  expect(conceptPrompt({ name: "heart" })).not.toContain(
    "Compose the named object"
  );
  expect(conceptPrompt({ name: "heart" })).toContain("Call confirm");
  expect(conceptPrompt({ name: "heart" })).toContain(
    "Do not add, remove, or redraw it"
  );
  expect(conceptPrompt({ name: "lantern" })).toContain(
    "The canvas already holds the host lantern analog"
  );
  expect(conceptPrompt({ name: "star" })).not.toContain("already holds");
  expect(conceptPrompt({ name: "quokka" })).not.toContain("already holds");
});

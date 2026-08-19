import fs from "node:fs";
import path from "node:path";

import { expect, test } from "vitest";

import { systemPrompt } from "./prompt.js";

/**
 * The correctness condition for moving the prompt into `policy.default.json`:
 * the default policy must render byte-for-byte what the nine template literals
 * rendered before it. `prompt.baseline.txt` was captured from that
 * implementation and is not to be regenerated — a change that needs it edited
 * is a change to the design language, and belongs in a labelled variant with a
 * measurement behind it, not in the baseline.
 */
const BASELINE = fs.readFileSync(
  path.join(import.meta.dirname, "prompt.baseline.txt"),
  "utf-8"
);

const variants: [string, Parameters<typeof systemPrompt>[0]][] = [
  ["default", {}],
  ["keyline", { keyline: "circle" }],
  ["proposal", { proposal: true }],
  [
    "cohort",
    {
      cohort: {
        extent: { x: [4, 20], y: null },
        members: ["bell-active", "bell-off"],
        name: "bell",
      },
    },
  ],
  [
    "all",
    {
      cohort: {
        extent: { x: [2, 22], y: [3, 21] },
        members: [],
        name: "chevron",
      },
      keyline: "wide",
      proposal: true,
    },
  ],
];

const expected = (name: string): string => {
  const start = BASELINE.indexOf(`<<<${name}>>>\n`);
  const body = BASELINE.slice(start + `<<<${name}>>>\n`.length);
  return body.slice(0, body.indexOf("\n<<<END>>>\n"));
};

for (const [name, opts] of variants) {
  test(`the default policy renders the ${name} prompt byte-identically`, () => {
    expect(systemPrompt(opts)).toBe(expected(name));
  });
}

test("every measured principle is off by default, so the baseline holds", () => {
  // The seeded corpus measurements are candidates the loop turns on, not
  // changes to today's prompt: enabling one would break byte-identity, which
  // is the point of the flag.
  expect(systemPrompt()).not.toContain("# What the set does");
});

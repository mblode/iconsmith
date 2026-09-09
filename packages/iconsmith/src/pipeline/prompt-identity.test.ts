import fs from "node:fs";
import path from "node:path";

import { expect, test } from "vitest";

import { systemPrompt } from "./prompt.js";

/**
 * The default render, byte for byte.
 *
 * The file was first captured from the nine template literals the prompt used
 * to be, to prove the move into `policy.default.json` changed nothing; that
 * held at `dbd343d`, and the port is not in question any more. What the file
 * does now is refuse a silent edit: any change to the rendered prompt shows up
 * here as a diff, so it has to be made deliberately and reviewed as a change to
 * the design language. Regenerating it is part of such a change, never a way
 * around one.
 */
const BASELINE = fs.readFileSync(
  path.join(import.meta.dirname, "prompt.wave-a-2026-09-08.txt"),
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

test("the seeded corpus measurements stay off, so the baseline holds", () => {
  // The `measured` section is candidates the loop turns on, not changes to
  // today's prompt: enabling one would break byte-identity, which is the point
  // of the flag. Provenance does not decide that — `meaning` is measured too
  // and ships enabled — the section does, which is why the two live apart.
  expect(systemPrompt()).not.toContain("# What the set does");
});

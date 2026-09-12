import { createHash } from "node:crypto";

import { expect, it } from "vitest";

import { assessReviews, parseLintResult } from "./experiment-evidence.js";

const clean = JSON.stringify({
  errors: 0,
  files: [{ file: "a.svg", issues: [] }],
  warnings: 0,
});
it("refuses missing, malformed, crashed and contradictory checker results", () => {
  expect(parseLintResult(0, clean).errors).toBe(0);
  for (const [status, body] of [
    [null, clean],
    [2, clean],
    [1, clean],
    [0, ""],
    [0, "{}"],
    [0, '{"error":true}'],
  ] as const) {
    expect(() => parseLintResult(status, body)).toThrow();
  }
  const failure = JSON.stringify({
    errors: 1,
    files: [
      {
        file: "a.svg",
        issues: [
          { message: "empty drawing", rule: "empty", severity: "error" },
        ],
      },
    ],
    warnings: 0,
  });
  expect(parseLintResult(1, failure).errors).toBe(1);
  expect(() => parseLintResult(0, failure)).toThrow();
});

const artifact = "exact inspected SVG";
const hash = createHash("sha256").update(artifact).digest("hex");
const review = (reviewer: string) => ({
  artifactSha256: hash,
  craftScore: 9,
  criticalDefects: [],
  freeRecognition: "clipboard with clock",
  reviewer,
  semanticMatch: true,
  shipUnchanged: true,
  uncertain: false,
});
it("distinguishes incomplete evidence from aesthetic rejection and binds it to the inspected bytes", () => {
  const a = review("one"),
    b = review("two"),
    ids = ["one", "two"];
  expect(assessReviews(artifact, ids, [a, b]).usable).toBe(true);
  for (const records of [
    [a, null],
    [a, a],
    [a],
    [a, { ...b, artifactSha256: "0".repeat(64) }],
    [{}, b],
  ]) {
    expect(assessReviews(artifact, ids, records).status).toBe("incomplete");
  }
  for (const patch of [
    { craftScore: 8 },
    { semanticMatch: false },
    { uncertain: true },
    { criticalDefects: ["colliding strokes"] },
    { shipUnchanged: false },
  ]) {
    expect(assessReviews(artifact, ids, [a, { ...b, ...patch }]).status).toBe(
      "rejected"
    );
  }
  expect(assessReviews(`${artifact} changed`, ids, [a, b]).usable).toBe(false);
});

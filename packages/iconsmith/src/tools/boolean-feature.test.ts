import { expect, test } from "vitest";

import { specAt } from "./canvas.js";
import { run } from "./dsl.js";
import { lint } from "./lint.js";

const spec = specAt({ radius: 1, size: 16, stroke: 1.875 });
const features = (program: string) => {
  const r = run(program, [], { spec });
  expect(r.errors).toEqual([]);
  return lint(r.canvas).filter((i) => i.rule === "feature");
};
test("narrow surviving Boolean counters warn independently of the large parent", () => {
  const issues = features(
    "finish filled\nrect 3,2 18x20 r1\nline 9,7 9,13\nline 15,7 15,13\nunion\nsubtract"
  );
  expect(issues).toHaveLength(2);
  for (const i of issues) {
    expect(i.severity).toBe("warn");
    expect(i.message).toContain("1.25px at 16px");
  }
});
test("widened counters meet the selected short-axis minimum", () => {
  expect(
    features(
      "finish filled\nrect 3,2 18x20 r1\nrect 7.75,6.25 2.5x7.5 r1\nrect 13.75,6.25 2.5x7.5 r1\nunion\nsubtract"
    )
  ).toEqual([]);
});
test("erased or absorbed intermediate narrow cutters do not leave phantom findings", () => {
  expect(
    features(
      "finish filled\nrect 3,2 18x20 r1\nline 9,7 9,13\nsubtract\nrect 6,5 6x10 r1\nunion"
    )
  ).toEqual([]);
});

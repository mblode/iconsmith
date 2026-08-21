import { expect, test } from "vitest";

import type { Policy, Principle } from "./policy.js";
import {
  DEFAULT_POLICY,
  LIMITS,
  findPrinciple,
  insertPrinciple,
  parsePolicy,
  PolicyError,
  renderPolicy,
  replacePrinciple,
  setEnabled,
} from "./policy.js";

/** The `SPEC` numbers, as `systemPrompt` supplies them. Rendering the default
 *  policy without these throws, which is the unresolved-token path below. */
const TOKENS = {
  canvas: "24",
  clearance: "2",
  dots: "floating = 3",
  grid: "0.25",
  keylines: "- `circle` — 20×20",
  maxElements: "8",
  minFeature: "1.5",
  minGap: "1",
  radius: "3",
  radiusTiers: "0.5, 1, 2, 3",
  size: "24",
  stroke: "2",
};

const clone = (): Policy => structuredClone(DEFAULT_POLICY);

const minimal = {
  principles: [
    {
      enabled: true,
      id: "a.one",
      provenance: "inferred",
      section: "a",
      text: "One.",
    },
  ],
  sections: [{ heading: "# A", id: "a", when: "always" }],
};

test("a policy that parses renders its enabled principles under its headings", () => {
  expect(renderPolicy(parsePolicy(minimal))).toBe("# A\n\nOne.");
});

test("a malformed policy throws rather than falling back", () => {
  // The failure that would ruin an experiment is a variant that silently did
  // not apply, so every one of these has to be loud.
  const cases: [string, unknown, string][] = [
    ["not an object", 42, "(root)"],
    ["a missing field", { principles: [], sections: [{ id: "a" }] }, "when"],
    [
      "an unknown field, e.g. a typo for `enabled`",
      {
        principles: [{ ...minimal.principles[0], enable: true }],
        sections: minimal.sections,
      },
      "enable",
    ],
    [
      "a principle in a section that does not exist",
      { principles: minimal.principles, sections: [] },
      "unknown section",
    ],
    [
      "two principles with the same id",
      {
        principles: [minimal.principles[0], minimal.principles[0]],
        sections: minimal.sections,
      },
      "duplicate principle id",
    ],
    [
      "a measured principle with no measurement behind it",
      {
        principles: [{ ...minimal.principles[0], provenance: "measured" }],
        sections: minimal.sections,
      },
      "carries no evidence",
    ],
  ];
  for (const [name, value, needle] of cases) {
    expect(() => parsePolicy(value), name).toThrow(PolicyError);
    expect(() => parsePolicy(value), name).toThrow(needle);
  }
});

test("an unresolved token throws at render, naming the principle", () => {
  const policy = parsePolicy({
    principles: [{ ...minimal.principles[0], text: "A {{nope}} hole." }],
    sections: minimal.sections,
  });
  expect(() => renderPolicy(policy)).toThrow("a.one");
  expect(() => renderPolicy(policy)).toThrow("{{nope}}");
});

test("a section with nothing enabled leaves no heading behind", () => {
  const policy = parsePolicy({
    principles: [{ ...minimal.principles[0], enabled: false }],
    sections: minimal.sections,
  });
  expect(renderPolicy(policy)).toBe("");
});

test("conditional sections appear only when their condition holds", () => {
  const policy = parsePolicy({
    principles: [
      minimal.principles[0],
      {
        enabled: true,
        id: "b.one",
        provenance: "inferred",
        section: "b",
        text: "Two.",
      },
    ],
    sections: [...minimal.sections, { heading: null, id: "b", when: "cohort" }],
  });
  expect(renderPolicy(policy)).toBe("# A\n\nOne.");
  expect(renderPolicy(policy, { conditions: ["cohort"] })).toBe(
    "# A\n\nOne.\n\nTwo."
  );
});

test("a principle is addressable by id: disable one and it leaves the render", () => {
  const before = renderPolicy(DEFAULT_POLICY, { tokens: TOKENS });
  const after = renderPolicy(setEnabled(clone(), "work.compare", false), {
    tokens: TOKENS,
  });
  expect(before).toContain("`compare` against the nearest existing icons");
  expect(after).not.toContain("`compare` against the nearest existing icons");
  // One principle out, and nothing else moved.
  expect(before.split("\n").length - after.split("\n").length).toBe(2);
});

test("enabling a seeded measurement adds it, and its section, to the prompt", () => {
  const out = renderPolicy(setEnabled(clone(), "measured.mirror-axis", true), {
    tokens: TOKENS,
  });
  expect(out).toContain("# What the set does\n\n- **Mirror about the vertical");
});

test("mutation returns a new policy and leaves the default alone", () => {
  const before = JSON.stringify(DEFAULT_POLICY);
  setEnabled(DEFAULT_POLICY, "work.lint", false);
  expect(JSON.stringify(DEFAULT_POLICY)).toBe(before);
});

test("addressing an id that does not exist throws", () => {
  expect(() => setEnabled(clone(), "work.nope", false)).toThrow(
    "no principle with id"
  );
});

test("a replacement restates its provenance, and is validated", () => {
  const p = replacePrinciple(clone(), "work.lint", {
    provenance: "inferred",
    text: "5. `lint`, then fix.",
  });
  expect(findPrinciple(p, "work.lint")?.text).toBe("5. `lint`, then fix.");
  expect(findPrinciple(p, "work.lint")?.provenance).toBe("inferred");
  // Claiming a measurement without one fails the same way a bad file does.
  expect(() =>
    replacePrinciple(clone(), "work.lint", {
      provenance: "measured",
      text: "5. `lint`, then fix.",
    })
  ).toThrow(PolicyError);
});

test("a principle can be inserted at a chosen point in the order", () => {
  const added: Principle = {
    enabled: true,
    id: "work.sleep",
    provenance: "inferred",
    section: "work",
    text: "3.5. Wait.",
  };
  const p = insertPrinciple(clone(), added, "work.render");
  const ids = p.principles.map((x) => x.id);
  expect(ids[ids.indexOf("work.render") + 1]).toBe("work.sleep");
  expect(renderPolicy(p, { tokens: TOKENS })).toContain(
    'some other icon", change the drawing, not the size.\n\n3.5. Wait.'
  );
  expect(() => insertPrinciple(clone(), added, "nope")).toThrow(
    "no principle with id"
  );
});

test("every measured principle in the house policy carries its number", () => {
  // Enforced by `parsePolicy` too; asserted here because it is the property the
  // whole provenance field exists for, and the default is the file that matters.
  const measured = DEFAULT_POLICY.principles.filter(
    (p) => p.provenance === "measured"
  );
  expect(measured.length).toBeGreaterThan(10);
  for (const p of measured) {
    expect(p.evidence, p.id).toBeTruthy();
  }
});

test("the capacity cap bounds slots, principle length and total length", () => {
  // An acceptance gate alone is not enough: a run of individually beneficial
  // edits can inflate the artefact until the problem stops being learnable. So
  // growth is refused at the same volume as malformation.
  const fill = (n: number, text: string) =>
    Array.from({ length: n }, (_, i) => ({
      ...minimal.principles[0],
      id: `a.${i}`,
      text,
    }));

  expect(() =>
    parsePolicy({
      principles: fill(LIMITS.principles + 1, "x"),
      sections: minimal.sections,
    })
  ).toThrow(PolicyError);

  expect(() =>
    parsePolicy({
      principles: fill(1, "x".repeat(LIMITS.text + 1)),
      sections: minimal.sections,
    })
  ).toThrow(PolicyError);

  // Each principle legal, the policy as a whole not: the binding cap.
  const wide = Math.ceil(LIMITS.totalText / LIMITS.text) + 1;
  expect(() =>
    parsePolicy({
      principles: fill(wide, "x".repeat(LIMITS.text)),
      sections: minimal.sections,
    })
  ).toThrow("over the 12000 cap");

  expect(() =>
    parsePolicy({
      principles: minimal.principles,
      sections: Array.from({ length: LIMITS.sections + 1 }, (_, i) => ({
        heading: null,
        id: `s${i}`,
        when: "always",
      })),
    })
  ).toThrow(PolicyError);
});

test("the house policy leaves headroom under every cap, without straining one", () => {
  // A cap the committed file already strains against is a cap that gets raised.
  const total = DEFAULT_POLICY.principles.reduce(
    (n, p) => n + p.text.length,
    0
  );
  expect(DEFAULT_POLICY.principles.length).toBeLessThan(LIMITS.principles);
  expect(DEFAULT_POLICY.sections.length).toBeLessThan(LIMITS.sections);
  expect(total).toBeLessThan(LIMITS.totalText * 0.75);
  for (const p of DEFAULT_POLICY.principles) {
    expect(p.text.length, p.id).toBeLessThan(LIMITS.text);
  }
});

test("growth through the mutation surface is capped too, not just through the file", () => {
  // insertPrinciple and replacePrinciple re-validate, so the cap cannot be
  // walked past one edit at a time.
  let policy = clone();
  expect(() =>
    replacePrinciple(policy, "work.lint", {
      provenance: "inferred",
      text: "x".repeat(LIMITS.text + 1),
    })
  ).toThrow(PolicyError);

  let added = 0;
  try {
    for (let i = 0; i < LIMITS.principles; i += 1) {
      policy = insertPrinciple(
        policy,
        {
          enabled: true,
          id: `work.pad${i}`,
          provenance: "inferred",
          section: "work",
          text: "x".repeat(LIMITS.text),
        },
        "work.lint"
      );
      added += 1;
    }
  } catch (error) {
    expect(error).toBeInstanceOf(PolicyError);
  }
  expect(added).toBeLessThan(LIMITS.principles);
});

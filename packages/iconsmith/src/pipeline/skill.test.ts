/**
 * The drift guard for `SKILL.md`.
 *
 * `SKILL.md` describes a grammar and a spec, and nothing type-checks markdown
 * against either. A skill that has drifted from the language it documents is
 * worse than no skill: an agent following it writes programs that are refused,
 * spends its turns fighting the parser, and blames the drawing.
 *
 * So every checkable claim in that file is checked here against the code that
 * enforces it, and the source of truth is behaviour rather than a copy. The op
 * list, the keylines and the dot roles are read out of the DSL's *own error
 * messages* — `tools/dsl.ts` builds those from the same arrays it dispatches
 * on, and `tools/` is where they live rather than here. The numbers come from
 * `SPEC`. The example programs are executed.
 *
 * What this does NOT cover, and a reader should not assume it does:
 *
 * - **Prose.** That `fit` "scales to the keyline" is a sentence; nothing here
 *   would notice if it said the opposite.
 * - **Argument shapes.** The grammar block's operand spellings (`<w>x<h>`,
 *   `r<n>`, `at <anchor>`) are only checked where an example exercises them.
 *   An op documented with the wrong operands and no example passes.
 * - **CLI flags.** `iconsmith lint --keyline` and `--output json` are quoted in
 *   the skill and are not asserted against `commands/`.
 * - **Anchors and turns beyond their names.** That `top-left` is (7,7) is not
 *   checked.
 * - **Whether the examples are good icons.** They are checked to run and to
 *   lint without errors, which is the floor, not the goal.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SPEC } from "../tools/canvas.js";
import { run, TURNS } from "../tools/dsl.js";
import { lint } from "../tools/lint.js";
import { skillPath } from "./harness.js";

const SKILL = readFileSync(skillPath(), "utf-8");

/**
 * The list a DSL error message enumerates: `… expected one of a, b, c`.
 *
 * Reading the vocabulary out of the refusal rather than out of an export is
 * deliberate. It is the same array the parser dispatches on, it needs no change
 * to `tools/`, and if a future op is added without a message the assertion
 * fails loudly rather than quietly checking nothing.
 */
const expectedOneOf = (program: string): string[] => {
  const [error] = run(program).errors;
  const match = /expected one of (?<list>.+)$/u.exec(error ?? "");
  if (!match?.groups) {
    throw new Error(`no enumeration in: ${error ?? "(no error at all)"}`);
  }
  return match.groups.list.split(", ").toSorted();
};

/** A fenced block by its language tag. */
const fences = (lang: string): string[] =>
  [
    ...SKILL.matchAll(
      new RegExp(`\`\`\`${lang}\\n(?<body>[\\s\\S]*?)\`\`\``, "gu")
    ),
  ].map((m) => m.groups?.body ?? "");

/** Rows of a two-or-more column table whose first cell is a backticked key. */
const table = (): Map<string, string> =>
  new Map(
    [
      ...SKILL.matchAll(
        /^\|\s*`(?<key>[^`]+)`\s*\|\s*(?<value>[^|]+?)\s*\|/gmu
      ),
    ].map((m) => [m.groups?.key ?? "", m.groups?.value ?? ""])
  );

describe("SKILL.md documents the language the parser accepts", () => {
  it("lists every op, and no op the parser does not have", () => {
    const [grammar] = fences("text");
    const documented = grammar
      .split("\n")
      .map((l) => l.trim().split(/\s+/u)[0])
      .filter(Boolean)
      .toSorted();

    expect(documented).toEqual(expectedOneOf("frobnicate"));
  });

  it("lists every keyline, with the extent the spec measures", () => {
    const documented = table();
    const names = expectedOneOf("keyline nope");
    expect(names).toEqual(Object.keys(SPEC.keylines).toSorted());

    for (const [name, [w, h]] of Object.entries(SPEC.keylines)) {
      expect(documented.get(name)).toBe(`${w}×${h}`);
      // And the op takes it: a keyline documented but refused is the drift this
      // file exists to catch.
      expect(run(`keyline ${name}`).errors).toEqual([]);
    }
    // The grammar block spells the same six out, so the two halves of the file
    // cannot disagree with each other either.
    const [grammar] = fences("text");
    const line = grammar.split("\n").find((l) => l.startsWith("keyline")) ?? "";
    expect(
      line
        .split(/\s+\|\s+|\s+/u)
        .slice(1)
        .toSorted()
    ).toEqual(names);
  });

  it("lists every dot role at the diameter the spec measures", () => {
    const documented = table();
    expect(expectedOneOf("dot 12,12 nope")).toEqual(
      Object.keys(SPEC.dots).toSorted()
    );
    for (const [role, size] of Object.entries(SPEC.dots)) {
      expect(documented.get(role)).toBe(String(size));
      expect(run(`dot 12,12 ${role}`).errors).toEqual([]);
    }
  });

  it("names the three quarter-turns, and only those", () => {
    for (const turn of Object.keys(TURNS)) {
      expect(SKILL).toContain(`\`${turn}\``);
    }
    // An angle where a turn belongs would be the loophole the turn names close.
    expect(SKILL).not.toMatch(/turn\s+\d/u);
  });

  it("quotes the spec's numbers rather than remembered ones", () => {
    const documented = table();
    const quoted = {
      canvas: String(SPEC.canvas),
      clearance: String(SPEC.clearance),
      grid: String(SPEC.grid),
      minGap: String(SPEC.minGap),
      radiusTiers: SPEC.radiusTiers.join(", "),
      stroke: String(SPEC.stroke),
    };
    for (const [key, value] of Object.entries(quoted)) {
      expect(documented.get(key)).toBe(value);
    }
  });
});

describe("SKILL.md's examples are programs, not prose", () => {
  const examples = fences("icon");

  it("has some", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples.map((src, i) => [i, src] as const))(
    "example %i runs and lints clean",
    (_i, src) => {
      const result = run(src);
      // A part the reader's own set has not extracted is an environment fact,
      // not a grammar error: the vocabulary is per-set and the skill cannot
      // name one that every set has.
      const missing = result.errors.filter((e) => e.includes("unknown part"));
      expect(result.errors.filter((e) => !missing.includes(e))).toEqual([]);

      // An example that places a part draws short of itself here, so its
      // extent is not the one it was written to have. Grammar only.
      if (missing.length === 0) {
        const issues = lint(result.canvas, { keyline: result.keyline });
        expect(issues.filter((issue) => issue.severity === "error")).toEqual(
          []
        );
      }
    }
  );
});

describe("SKILL.md's frontmatter is a skill's frontmatter", () => {
  it("opens with name and description", () => {
    const match = /^---\n(?<body>[\s\S]*?)\n---\n/u.exec(SKILL);
    expect(match?.groups?.body).toBeDefined();
    const front = match?.groups?.body ?? "";
    expect(front).toMatch(/^name: [a-z][a-z0-9-]*$/mu);
    expect(front).toMatch(/^description: \S/mu);
  });
});

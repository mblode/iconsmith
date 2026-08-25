import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * `agent-skills.ts` imports `./site-url` extensionlessly, which Next resolves
 * and the node test runner does not. Same hook as `generate.budget.test.ts`,
 * and it retires the same way: give the source imports their extensions.
 */
registerHooks({
  resolve(specifier, context, next) {
    if (
      specifier.startsWith(".") &&
      !/\.\w+$/u.test(specifier) &&
      context.parentURL?.endsWith(".ts")
    ) {
      return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  },
});

const { dslSkill } = await import("./agent-skills.ts");

/**
 * The public skill is a hand-written copy of a language defined elsewhere.
 *
 * `lib/agent-skills.ts` is served at `/.well-known/agent-skills/iconsmith-dsl/
 * SKILL.md` to any agent that asks, and it restates the op table rather than
 * importing it, because it is string constants with no dependency on the CLI
 * workspace. That is the right call for the bundle and the wrong one for
 * drift: it shipped 10 of the 14 ops for long enough that a model reading it
 * would conclude the language cannot draw a curve, `arc` being one of the four
 * it omitted. Nothing failed, because nothing compared them.
 *
 * `OPS` is module-private in `dsl.ts`, so this reads the source rather than
 * importing. That is deliberate: exporting the array to satisfy a test would
 * widen the package's public surface for the sake of a doc check.
 */
const DSL_SOURCE = path.join(import.meta.dirname, "../../../packages/iconsmith/src/tools/dsl.ts");

const declaredOps = (): string[] => {
  const source = readFileSync(DSL_SOURCE, "utf-8");
  const table = /const OPS = \[(?<body>[^\]]*)\]/u.exec(source)?.groups?.body;
  assert.ok(table, `no OPS array in ${DSL_SOURCE} — the parser was restructured`);
  return [...table.matchAll(/"(?<op>[a-z-]+)"/gu)].map((m) => m.groups?.op ?? "");
};

describe("the published DSL skill", () => {
  it("documents every op the parser accepts", () => {
    const ops = declaredOps();
    assert.ok(ops.length >= 10, `only ${ops.length} ops parsed out of dsl.ts`);

    // Matched at a word boundary against the fenced table, not the prose: an op
    // named only in a sentence is not a model's reference for how to spell it.
    const table = dslSkill.split("```")[1] ?? "";
    const missing = ops.filter((op) => !new RegExp(`(?<edge>^|\\s)${op}\\s`, "mu").test(table));

    assert.deepEqual(
      missing,
      [],
      `the served skill omits ${missing.length} of ${ops.length} ops: ${missing.join(", ")}. ` +
        "A model reading it cannot use what it is not shown — `arc` went missing " +
        "this way and the skill read as though the language had no curves.",
    );
  });

  it("does not offer `raw`, which the parser refuses", () => {
    const ops = declaredOps();
    assert.ok(!ops.includes("raw"), "`raw` is now an op; the escape story changed");

    const table = dslSkill.split("```")[1] ?? "";
    assert.ok(
      !/(?<edge>^|\s)raw\s/mu.test(table),
      "the op table offers `raw`, which the parser rejects — a model that tries " +
        "it spends a turn on a parse error",
    );
  });
});

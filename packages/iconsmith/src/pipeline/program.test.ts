import { describe, expect, it } from "vitest";

import { bbox, parsePath } from "../geometry/path.js";
import { run as runDsl } from "../tools/dsl.js";
import type { Part } from "../types.js";
import type { ProgramAsk } from "./program.js";
import { programArm, runProgram } from "./program.js";

/**
 * A hand-written part, so these tests need no corpus. `turns` and `flips` are
 * absent exactly as they are on any part the extractor did not measure.
 *
 * It is deliberately **not square**. A quarter turn transposes a part's extent,
 * so every placement bug that forgets to transpose is invisible against a
 * square fixture — which is exactly how one shipped.
 */
const TOOTH: Part = {
  closed: true,
  d: "M0 0L2 0L2 5L0 5Z",
  h: 5,
  icons: [],
  id: "p0000",
  instances: 1,
  name: "tooth",
  nodes: 4,
  sizeRange: [2, 5],
  w: 2,
};

/** Where each drawn element actually sits, measured off its path rather than
 *  read back off the numbers that placed it. This is what `place.*` promises:
 *  the part is centred on the point asked for, whatever turn it is under. */
const centres = (canvas: { elements: { d: string }[] }): [number, number][] =>
  canvas.elements.map((element) => {
    const box = bbox(parsePath(element.d));
    return [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
  });

describe("runProgram", () => {
  it("turns a loop into a program the DSL can replay", async () => {
    const result = await runProgram(`
      await icon.name("clock");
      await icon.keyline("circle");
      await draw.circle({ cx: 12, cy: 12, r: 9 });
      for (let i = 0; i < 4; i += 1) {
        const angle = (i * Math.PI) / 2;
        await draw.dot({
          cx: 12 + 6 * Math.sin(angle),
          cy: 12 - 6 * Math.cos(angle),
        });
      }
    `);

    expect(result.errors).toEqual([]);
    expect(result.program).toBe(
      "icon clock\nkeyline circle\ncircle 12,12 r9\ndot 12,6\ndot 18,12\ndot 12,18\ndot 6,12\n"
    );
    expect(result.trace).toEqual([
      "icon",
      "keyline",
      "circle",
      "dot",
      "dot",
      "dot",
      "dot",
    ]);
    expect(result.doc.draw).toHaveLength(5);
  });

  // The guarantee this arm rests on. `runProgram` records a named error when
  // the emitted program does not replay to the document it drew, so an empty
  // `errors` on a program with ops *is* the round-trip assertion.
  it("emits a program that replays to the same document", async () => {
    const result = await runProgram(
      `
      await icon.name("gear");
      await draw.circle({ cx: 12, cy: 12, r: 6 });
      await place.ring({ count: 4, cx: 12, cy: 12, name: "tooth", radius: 8 });
    `,
      [TOOTH]
    );

    expect(result.errors).toEqual([]);
    const replay = runDsl(result.program, [TOOTH]);
    expect(replay.errors).toEqual([]);
    expect(
      replay.canvas.toJSON({ icon: replay.icon, keyline: replay.keyline })
    ).toEqual(result.doc);
  });

  it("centres every part of a ring on its point", async () => {
    const result = await runProgram(
      `await place.ring({ count: 4, cx: 12, cy: 12, name: "tooth", radius: 8 });`,
      [TOOTH]
    );

    expect(result.errors).toEqual([]);
    expect(centres(result.canvas)).toEqual([
      [12, 4],
      [20, 12],
      [12, 20],
      [4, 12],
    ]);
  });

  /**
   * The regression test for the placement maths. `Canvas.part` rotates the path
   * and then puts the *turned* bbox's top-left at the emitted coordinate, so a
   * helper that offsets by the unturned width puts every quarter-turned copy in
   * the wrong place. Against a square part that is unobservable; against this
   * one the two odd turns move by (h - w) / 2.
   */
  it("centres a quartered part under every turn, not just the even ones", async () => {
    const result = await runProgram(
      `await place.quarters({ cx: 12, cy: 12, name: "tooth", radius: 8 });`,
      [TOOTH]
    );

    expect(result.errors).toEqual([]);
    expect(centres(result.canvas)).toEqual([
      [12, 4],
      [20, 12],
      [12, 20],
      [4, 12],
    ]);
    expect(result.trace).toEqual(["part", "part", "part", "part"]);
    expect(result.program).toContain("turn cw");
    expect(result.program).toContain("turn half");
    expect(result.program).toContain("turn ccw");
  });

  it("spaces a row and a column evenly", async () => {
    const row = await runProgram(
      `await place.row({ count: 3, cy: 12, gap: 6, name: "tooth", x: 4 });`,
      [TOOTH]
    );
    const column = await runProgram(
      `await place.column({ count: 3, cx: 12, gap: 6, name: "tooth", y: 4 });`,
      [TOOTH]
    );

    expect(row.errors).toEqual([]);
    expect(centres(row.canvas)).toEqual([
      [4, 12],
      [10, 12],
      [16, 12],
    ]);
    expect(column.errors).toEqual([]);
    expect(centres(column.canvas)).toEqual([
      [12, 4],
      [12, 10],
      [12, 16],
    ]);
  });

  it("lays a grid out row-major", async () => {
    const result = await runProgram(
      `await place.grid({ cols: 2, gapX: 8, gapY: 6, name: "tooth", rows: 2, x: 6, y: 6 });`,
      [TOOTH]
    );

    expect(result.errors).toEqual([]);
    expect(centres(result.canvas)).toEqual([
      [6, 6],
      [14, 6],
      [6, 12],
      [14, 12],
    ]);
  });
});

describe("the one invariant", () => {
  it("offers no way to emit path data", async () => {
    const result = await runProgram(`
      await draw.circle({ cx: 12, cy: 12, r: 6 });
      return typeof draw.raw;
    `);

    expect(result.errors).toEqual([]);
    expect(result.doc.draw.some((op) => op.op === "raw")).toBe(false);
    // No `d` reaches the document, because no host function accepts one.
    expect(JSON.stringify(result.doc)).not.toMatch(/"d":/u);
  });

  it("refuses a turn expressed as a number", async () => {
    const result = await runProgram(
      `await draw.part({ name: "tooth", at: [4, 4], turn: 37 });`,
      [TOOTH]
    );

    expect(result.errors.join(" ")).toContain('unknown turn "37"');
    expect(result.program).toBe("");
  });
});

describe("containment", () => {
  it("has no ambient authority to lend a program", async () => {
    const result = await runProgram(`
      await draw.circle({ cx: 12, cy: 12, r: 6 });
      return [
        typeof fetch,
        typeof process,
        typeof require,
        typeof setTimeout,
        typeof globalThis.XMLHttpRequest,
      ].join(",");
    `);

    expect(result.errors).toEqual([]);
    expect(result.doc.draw).toHaveLength(1);
  });

  it("cannot reach the host through dynamic evaluation", async () => {
    const result = await runProgram(
      `await draw.circle({ cx: 12, cy: 12, r: 6 });
       return eval("1 + 1");`
    );

    // The drawing still lands; only the escape fails.
    expect(result.doc.draw).toHaveLength(1);
    expect(result.errors).not.toEqual([]);
  });
});

describe("limits", () => {
  it("cuts a program that never returns", async () => {
    const result = await runProgram(
      `await draw.circle({ cx: 12, cy: 12, r: 6 });
       while (true) { /* spin */ }`,
      [],
      { limits: { timeoutMs: 250 } }
    );

    expect(result.errors.join(" ")).toMatch(/timed out|timeout/iu);
    // What it drew before the cut is still reported.
    expect(result.doc.draw).toHaveLength(1);
  });

  /**
   * A `place.*` helper is one bridge call that loops host-side, so
   * `maxBridgeRequests` does not reach it. Without its own bound a model could
   * ask for ten million placements and have every one of them allocated before
   * the DSL saw a line.
   */
  it("refuses a placement count the sandbox limit cannot reach", async () => {
    const result = await runProgram(
      `await place.ring({ count: 10000000, cx: 12, cy: 12, name: "tooth", radius: 8 });`,
      [TOOTH],
      { limits: { timeoutMs: 2000 } }
    );

    expect(result.errors.join(" ")).toContain("ring count of 10000000 is over");
    expect(result.doc.draw).toHaveLength(0);
  });

  it("refuses a grid whose cells multiply past the limit", async () => {
    const result = await runProgram(
      `await place.grid({ cols: 64, gapX: 1, gapY: 1, name: "tooth", rows: 64, x: 1, y: 1 });`,
      [TOOTH]
    );

    expect(result.errors.join(" ")).toContain("grid cells");
    expect(result.doc.draw).toHaveLength(0);
  });

  it("stops with the turn rather than running on to its timeout", async () => {
    const started = Date.now();
    const result = await runProgram(
      `await draw.circle({ cx: 12, cy: 12, r: 6 });
       while (true) { /* spin */ }`,
      [],
      { abortSignal: AbortSignal.abort(), limits: { timeoutMs: 30_000 } }
    );

    expect(result.errors).not.toEqual([]);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("cuts a program that draws without end", async () => {
    const result = await runProgram(
      `for (let i = 0; i < 100; i += 1) {
         await draw.dot({ cx: 12, cy: 12 });
       }`,
      [],
      { limits: { maxBridgeRequests: 5 } }
    );

    expect(result.errors).not.toEqual([]);
    expect(result.doc.draw.length).toBeLessThan(100);
  });
});

describe("faults", () => {
  // The DSL accumulates per-line errors rather than throwing (`tools/dsl.ts`),
  // and a builder program is held to the same contract: what it drew before it
  // failed is more use to a repair loop than an exception is.
  it("keeps what a throwing program drew", async () => {
    const result = await runProgram(`
      await draw.circle({ cx: 12, cy: 12, r: 6 });
      await draw.rect({ h: 4, w: 4, x: 2, y: 2 });
      throw new Error("gave up");
    `);

    expect(result.errors.join(" ")).toContain("gave up");
    expect(result.doc.draw).toHaveLength(2);
    expect(result.program).toBe("circle 12,12 r6\nrect 2,2 4x4\n");
  });

  // One fault, one error. The runtime hands the same failure back a second
  // time scrubbed to `Host function failed.`; keeping that copy would put a
  // contentless error beside the useful one and count it twice against `clean`.
  // A bag of optionals answered `hole({ shape: "circle" })` with
  // `hole circle 0,0 r0` — a nothing at the origin, in place of a sentence
  // naming what was left out.
  it("refuses a hole that names no coordinates", async () => {
    const result = await runProgram(`
      await icon.finish("filled");
      await draw.rect({ h: 12, w: 12, x: 6, y: 6 });
      await draw.hole({ shape: "circle" });
    `);

    expect(result.errors.join(" ")).toContain("hole circle");
    expect(result.program).not.toContain("r0");
  });

  it("names a part it does not have, once", async () => {
    const result = await runProgram(
      `await place.ring({ count: 3, cx: 12, cy: 12, name: "sprocket", radius: 8 });`
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('unknown part "sprocket"');
    expect(result.errors[0]).not.toContain("Host function failed");
  });

  /**
   * Every host call crosses the worker bridge, so ordering is the program's
   * responsibility. A dropped `await` is not a style question here: it detaches
   * the request, and the declaration it was carrying can land after the
   * geometry or not at all. The runtime catches it, and this pins that it does
   * — a silent reordering would put `finish` after a shape, which the DSL
   * refuses for reasons of its own.
   */
  it("catches a dropped await rather than reordering the program", async () => {
    const result = await runProgram(`
      icon.name("clock");
      await draw.circle({ cx: 12, cy: 12, r: 6 });
    `);

    expect(result.errors.join(" ")).toContain("icon.name");
  });
});

describe("check", () => {
  it("lets a program lint what it has drawn so far", async () => {
    const result = await runProgram(`
      await draw.rect({ h: 2, w: 2, x: 0, y: 0 });
      const first = await check.lint();
      if (first.issues.length > 0) {
        await draw.circle({ cx: 12, cy: 12, r: 9 });
      }
      return first.issues.length;
    `);

    // A 2×2 rect in the corner is off-keyline, so the program saw findings and
    // drew again. The point is that it could see them at all.
    expect(result.trace).toEqual(["rect", "circle"]);
  });

  it("reports the vocabulary without handing over geometry", async () => {
    const result = await runProgram(
      `
      const parts = await check.parts();
      await draw.part({ name: parts[0].name, at: [4, 4] });
    `,
      [TOOTH]
    );

    expect(result.errors).toEqual([]);
    expect(result.program).toBe("part tooth at 4,4\n");
  });
});

/** A model that always answers with this program. */
const askWith =
  (text: string): ProgramAsk =>
  () =>
    Promise.resolve({ text });

describe("programArm", () => {
  it("drives a model's program into a GenerateResult", async () => {
    const arm = programArm({
      ask: askWith(`
        await icon.name("gear");
        await draw.circle({ cx: 12, cy: 12, r: 4 });
        await place.ring({ count: 4, cx: 12, cy: 12, name: "tooth", radius: 6 });
      `),
    });
    const result = await arm({ name: "gear" }, { parts: [TOOTH] });

    expect(result.clean).toBe(true);
    // Warnings do not block: an off-keyline extent is a prompt to confirm the
    // size was chosen, and `clean` is about errors.
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.program).toContain("circle 12,12 r4");
    expect(result.trace).toEqual([
      "icon",
      "circle",
      "part",
      "part",
      "part",
      "part",
    ]);
    expect(result.svg).toContain("<svg");
    expect(result.brief).toContain("gear");
  });

  it("unwraps a fenced program the instructions asked it not to write", async () => {
    const arm = programArm({
      ask: askWith("```js\nawait draw.circle({ cx: 12, cy: 12, r: 9 });\n```"),
    });
    const result = await arm({ name: "ring" }, {});

    expect(result.clean).toBe(true);
    expect(result.program).toBe("circle 12,12 r9\n");
  });

  // A drawing that fails is a score, never a thrown arm: `clean` carries it.
  it("reports a failed program rather than throwing", async () => {
    const arm = programArm({ ask: askWith("this is not a program at all") });
    const result = await arm({ name: "ghost" }, {});

    expect(result.clean).toBe(false);
    expect(result.issues.some((issue) => issue.severity === "error")).toBe(
      true
    );
  });

  /**
   * The experiment is "a loop instead of an unrolled list", so the brief has to
   * be the one the `agent` arm gets — otherwise a scoring pass measures the
   * brief. An earlier revision hand-rolled four lines and would have reported
   * thin-brief-versus-rich-brief as loop-versus-unrolled.
   */
  it("briefs the model the way the agent arm does", async () => {
    const seen: { prompt: string; system: string }[] = [];
    const arm = programArm({
      ask: ({ prompt, system }) => {
        seen.push({ prompt, system });
        return Promise.resolve({
          text: `await draw.part({ name: "tooth", at: [4, 4] });`,
        });
      },
    });
    await arm(
      { category: "hardware", name: "gear", tags: ["cog", "settings"] },
      { keyline: "circle", parts: [TOOTH] }
    );

    const [{ prompt, system }] = seen;
    // The concept brief the agent arm sends: name, category, tags.
    expect(prompt).toContain("gear");
    expect(prompt).toContain("hardware");
    expect(prompt).toContain("cog");
    // The house spec, the paint rule and the keyline, from the shared builder.
    expect(system).toContain("house spec");
    expect(system).toContain("circle");
    // And the one thing that differs from the agent arm: how you call it.
    expect(system).toContain("EVERY host call must be awaited");
    // Never the geometry, on either half.
    expect(prompt).not.toContain(TOOTH.d);
    expect(system).not.toContain(TOOTH.d);
  });

  it("offers the vocabulary by id as well as by name", async () => {
    const result = await runProgram(
      `const parts = await check.parts();
       return parts.map((p) => p.id + ":" + p.name).join(",");`,
      [TOOTH]
    );

    expect(result.errors).toEqual([]);
  });
});

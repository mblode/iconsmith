import { describe, expect, it } from "vitest";

import { run as runDsl } from "../tools/dsl.js";
import type { Part } from "../types.js";
import type { ProgramAsk } from "./program.js";
import { programArm, runProgram } from "./program.js";

/** A hand-written part, so these tests need no corpus. `turns` and `flips` are
 *  absent exactly as they are on any part the extractor did not measure. */
const TOOTH: Part = {
  closed: true,
  d: "M0 0L2 0L2 2L0 2Z",
  h: 2,
  icons: [],
  id: "p0000",
  instances: 1,
  name: "tooth",
  nodes: 4,
  sizeRange: [2, 2],
  w: 2,
};

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

  it("places a ring exactly where the hand-written lines would", async () => {
    const looped = await runProgram(
      `await place.ring({ count: 4, cx: 12, cy: 12, name: "tooth", radius: 8 });`,
      [TOOTH]
    );
    const authored = runDsl(
      [
        "part tooth at 11,3",
        "part tooth at 19,11",
        "part tooth at 11,19",
        "part tooth at 3,11",
      ].join("\n"),
      [TOOTH]
    );

    expect(looped.errors).toEqual([]);
    expect(looped.doc.draw).toEqual(
      authored.canvas.toJSON({ icon: null, keyline: null }).draw
    );
  });

  it("gives quarters the turns that match them", async () => {
    const result = await runProgram(
      `await place.quarters({ cx: 12, cy: 12, name: "tooth", radius: 8 });`,
      [TOOTH]
    );

    expect(result.errors).toEqual([]);
    expect(result.program.trim().split("\n")).toEqual([
      "part tooth at 11,3",
      "part tooth at 19,11 turn cw",
      "part tooth at 11,19 turn half",
      "part tooth at 3,11 turn ccw",
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

  it("names a part it does not have", async () => {
    const result = await runProgram(
      `await place.ring({ count: 3, cx: 12, cy: 12, name: "sprocket", radius: 8 });`
    );

    expect(result.errors.join(" ")).toContain('unknown part "sprocket"');
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
        await draw.circle({ cx: 12, cy: 12, r: 6 });
        await place.ring({ count: 4, cx: 12, cy: 12, name: "tooth", radius: 9 });
      `),
    });
    const result = await arm({ name: "gear" }, { parts: [TOOTH] });

    expect(result.clean).toBe(true);
    // Warnings do not block: an off-keyline extent is a prompt to confirm the
    // size was chosen, and `clean` is about errors.
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.program).toContain("circle 12,12 r6");
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

  it("never shows the model path data for a part", async () => {
    const seen: string[] = [];
    const arm = programArm({
      ask: ({ prompt, system }) => {
        seen.push(prompt, system);
        return Promise.resolve({
          text: `await draw.part({ name: "tooth", at: [4, 4] });`,
        });
      },
    });
    await arm({ name: "gear" }, { parts: [TOOTH] });

    expect(seen.join("\n")).toContain("tooth (2x2)");
    expect(seen.join("\n")).not.toContain(TOOTH.d);
  });
});

/**
 * The harness arm, tested against a fake subprocess.
 *
 * Nothing here spawns anything: `spawn` is the one seam into the operating
 * system, so a fake that writes a `.icon` file exercises the whole arm — brief,
 * argv, program, lint, result shape — without an agent, a network or a token.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Cohort } from "../tools/cohort.js";
import type { GenerateOptions } from "./generate.js";
import { harnessArm, HarnessError } from "./harness.js";
import type { HarnessInvocation, HarnessRun, Spawn } from "./harness.js";

/** A fake agent: writes `program` into the scratch directory it was handed,
 *  then returns. `null` writes nothing, which is what a confused agent does. */
const fake = (
  program: string | null,
  over: Partial<HarnessRun> = {}
): { calls: HarnessInvocation[]; spawn: Spawn } => {
  const calls: HarnessInvocation[] = [];
  const spawn: Spawn = (invocation) => {
    calls.push(invocation);
    if (program !== null) {
      writeFileSync(path.join(invocation.cwd, "icon.icon"), program);
    }
    return Promise.resolve({
      code: 0,
      stderr: "",
      stdout: "Drew a document with two text lines.",
      ...over,
    });
  };
  return { calls, spawn };
};

const SQUARE = `icon box
keyline square
rect 4,4 16x16 r2
fit`;

const concept = { name: "box", tags: ["container"] };
const noOptions: GenerateOptions = {};

describe("harnessArm", () => {
  it("returns the drawn icon in the shape the built-in generator returns", async () => {
    const { spawn } = fake(SQUARE);
    const result = await harnessArm({ spawn })(concept, noOptions);

    expect(result.clean).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.svg).toContain("<svg");
    expect(result.doc.icon).toBe("box");
    expect(result.doc.keyline).toBe("square");
    expect(result.trace).toEqual(["icon", "keyline", "rect", "fit"]);
    expect(result.steps).toBe(4);
    expect(result.text).toBe("Drew a document with two text lines.");
  });

  it("reports no cost, because an external harness bills elsewhere", async () => {
    const { spawn } = fake(SQUARE);
    const result = await harnessArm({ spawn })(concept, noOptions);
    // Absent, not zeroed: a zero would enter a paid arm into the eval's dollar
    // column as free.
    expect(result.cost).toBeUndefined();
  });

  it("names the concept, its senses, the keyline and the program path in the brief", async () => {
    const { calls, spawn } = fake(SQUARE);
    await harnessArm({
      command: "codex",
      keep: true,
      skill: "/skills/SKILL.md",
      spawn,
    })(
      { category: "Files", name: "folder-clock", tags: ["schedule"] },
      { keyline: "wide" }
    );

    const [invocation] = calls;
    expect(invocation.command).toBe("codex");
    expect(invocation.args[0]).toBe("-p");
    const [, brief] = invocation.args;
    expect(brief).toContain("/skills/SKILL.md");
    expect(brief).toContain("`folder-clock`");
    expect(brief).toContain("Files");
    expect(brief).toContain("schedule");
    expect(brief).toContain("`wide` keyline");
    expect(brief).toContain(path.join(invocation.cwd, "icon.icon"));
    // Also on disk, so an agent that reads files rather than argv can find it.
    expect(readFileSync(path.join(invocation.cwd, "BRIEF.md"), "utf-8")).toBe(
      `${brief}\n`
    );
  });

  it("passes the family's measured extent through, and asks for cohort over fit", async () => {
    const { calls, spawn } = fake(SQUARE);
    await harnessArm({ spawn })(concept, {
      cohort: {
        extent: { x: [3, 21], y: [4, 20] },
        members: ["box-open"],
        name: "box",
      },
    });

    const [, brief] = calls[0].args;
    expect(brief).toContain("`box` family");
    expect(brief).toContain("box-open");
    expect(brief).toContain("x spans 3.00..21.00");
    expect(brief).toContain("y spans 4.00..20.00");
    expect(brief).toContain("`cohort` rather than `fit`");
  });

  it("lets the caller spell the command line however their agent does", async () => {
    const { calls, spawn } = fake(SQUARE);
    await harnessArm({
      args: (brief, ctx) => ["exec", "--out", ctx.file, brief],
      command: "gemini",
      spawn,
    })(concept, noOptions);

    expect(calls[0].args[0]).toBe("exec");
    expect(calls[0].args[1]).toBe("--out");
    expect(calls[0].args[2]).toBe(path.join(calls[0].cwd, "icon.icon"));
  });

  it("cleans up the scratch directory, unless asked to keep it", async () => {
    const gone = fake(SQUARE);
    await harnessArm({ spawn: gone.spawn })(concept, noOptions);
    expect(existsSync(gone.calls[0].cwd)).toBe(false);

    const kept = fake(SQUARE);
    await harnessArm({ keep: true, spawn: kept.spawn })(concept, noOptions);
    expect(existsSync(kept.calls[0].cwd)).toBe(true);
  });
});

describe("harnessArm failures", () => {
  const draw = (spawn: Spawn) => harnessArm({ spawn })(concept, noOptions);

  it("throws when the agent exits non-zero, keeping the scratch to look at", async () => {
    const { calls, spawn } = fake(null, { code: 2, stderr: "no such skill" });
    await expect(draw(spawn)).rejects.toThrow(HarnessError);
    expect(existsSync(calls[0].cwd)).toBe(true);
  });

  it("says so when the agent was killed rather than exiting", async () => {
    const { spawn } = fake(null, { code: null });
    await expect(draw(spawn)).rejects.toThrow(/killed/u);
  });

  it("says so when the agent wrote no program", async () => {
    const { spawn } = fake(null);
    await expect(draw(spawn)).rejects.toThrow(/wrote no program/u);
  });

  it("carries a refused op as a lint error rather than as a failed run", async () => {
    const { spawn } = fake(`icon box
keyline square
rect 4,4 16x16 r2
line 4,4 5,9
fit`);
    const result = await harnessArm({ spawn })(concept, noOptions);

    // The run succeeded; the drawing did not. An eval scores this as a
    // half-drawn icon, which is what it is.
    expect(result.clean).toBe(false);
    const dsl = result.issues.filter((i) => i.rule === "dsl");
    expect(dsl).toHaveLength(1);
    expect(dsl[0].message).toMatch(/off-axis/u);
    expect(result.svg).toContain("<svg");
  });

  it("reports a cohort nobody measured, rather than inventing an extent", async () => {
    const { spawn } = fake(`icon box
rect 4,4 16x16 r2
cohort box`);
    const result = await harnessArm({ spawn })(concept, noOptions);
    expect(result.issues.some((i) => i.message.includes("no cohorts"))).toBe(
      true
    );
  });

  it("aligns onto a cohort the caller measured", async () => {
    const cohorts: Cohort[] = [
      {
        members: [
          { box: { h: 16, w: 16, x0: 4, x1: 20, y0: 4, y1: 20 }, name: "box" },
          {
            box: { h: 16, w: 16, x0: 4, x1: 20, y0: 4, y1: 20 },
            name: "box-open",
          },
        ],
        name: "box",
        x: {
          axis: "x",
          conventional: true,
          even: false,
          groups: [{ hi: 20, lo: 4, members: ["box", "box-open"] }],
        },
        y: {
          axis: "y",
          conventional: true,
          even: false,
          groups: [{ hi: 20, lo: 4, members: ["box", "box-open"] }],
        },
      },
    ];
    const { spawn } = fake(`icon box
rect 6,6 8x8 r2
cohort box`);
    const result = await harnessArm({ cohorts, spawn })(concept, noOptions);

    expect(result.issues.filter((i) => i.rule === "dsl")).toEqual([]);
    // The 8x8 rect inherited the family's 16x16 box rather than its own.
    expect(result.doc.draw).toHaveLength(1);
    expect(result.svg).toContain("<svg");
  });
});

describe("the invariant, through a harness", () => {
  /**
   * The reason this arm is allowed to exist. `tools/dsl.ts` builds its own
   * `Canvas` and exposes no op that takes path data, so an agent driving the
   * DSL through *any* harness has exactly the guarantee the built-in tool loop
   * gives: it cannot emit a coordinate that is not already on-spec.
   */
  it("cannot smuggle path data in through the program", async () => {
    const { spawn } = fake(`icon box
raw M0 0 L24 24
path M0 0 L24 24
d M0 0 L24 24`);
    const result = await harnessArm({ spawn })(concept, noOptions);

    expect(result.issues.filter((i) => i.rule === "dsl")).toHaveLength(3);
    for (const issue of result.issues.filter((i) => i.rule === "dsl")) {
      expect(issue.message).toMatch(/unknown op/u);
    }
    // Nothing reached the document.
    expect(result.doc.draw).toEqual([]);
    expect(result.clean).toBe(false);
  });

  it("quantises what does get through, rather than taking it verbatim", async () => {
    const { spawn } = fake(`icon box
rect 4.13,4.07 15.9x16.1 r7`);
    const result = await harnessArm({ spawn })(concept, noOptions);

    // Off-grid in, on-grid out. Every design anchor — the move and line
    // endpoints — is a multiple of the 0.25 sub-grid, though the bezier handles
    // that round the corners are not, and are not meant to be.
    const anchors = [
      ...result.svg.matchAll(/[ML](?<x>-?[\d.]+) (?<y>-?[\d.]+)/gu),
    ];
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      for (const n of [a.groups?.x, a.groups?.y]) {
        expect(Number(n) % 0.25).toBe(0);
      }
    }
    // And nothing the program asked for survived unrounded.
    expect(result.svg).not.toContain("4.13");
    expect(result.svg).not.toContain("4.07");
  });
});

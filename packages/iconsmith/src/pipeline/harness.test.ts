/**
 * The harness arm, tested against a fake subprocess.
 *
 * Nothing here spawns anything: `spawn` is the one seam into the operating
 * system, so a fake that writes a `.icon` file exercises the whole arm — brief,
 * argv, program, lint, result shape — without an agent, a network or a token.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Cohort } from "../tools/cohort.js";
import type { Part } from "../types.js";
import { AUDIT_FILE, PREVIEW_FILE } from "./audit.js";
import type { AuditAsk, AuditResult } from "./audit.js";
import { CLAUDE_GATEWAY_URL, CODEX_GATEWAY_URL } from "./gateway.js";
import type { GenerateOptions } from "./generate.js";
import { harnessArm, HarnessError } from "./harness.js";
import type { HarnessInvocation, HarnessRun, Spawn } from "./harness.js";

/** A fake agent: writes `program` into the scratch directory it was handed,
 *  then returns. `null` writes nothing, which is what a confused agent does.
 *  A function is keyed on the 1-based call count so a repair spawn can write
 *  a different legal program. */
const fake = (
  program: string | null | ((n: number) => string | null),
  over: Partial<HarnessRun> = {}
): { calls: HarnessInvocation[]; spawn: Spawn } => {
  const calls: HarnessInvocation[] = [];
  const spawn: Spawn = (invocation) => {
    calls.push(invocation);
    const source =
      typeof program === "function" ? program(calls.length) : program;
    if (source !== null) {
      writeFileSync(path.join(invocation.cwd, "icon.icon"), source);
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

const DISC = `icon box
keyline square
circle 12,12 r8
fit`;

const FILLED_DISC = `icon box
keyline square
finish filled
circle 12,12 r8
fit`;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const throwAsk: AuditAsk = () => Promise.reject(new Error("gateway down"));

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
    expect(result.program).toContain("rect 4,4 16x16 r2");
    expect(result.log).toBe("Drew a document with two text lines.");
    expect(result.brief).toContain("Draw the icon `box`");
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
    expect(brief).toContain("Paint: outlined.");
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

  it("pairs the other paint so a filled disc is not a quiet twin", async () => {
    const { spawn } = fake(FILLED_DISC);
    const result = await harnessArm({ spawn })(concept, { finish: "filled" });
    expect(result.clean).toBe(false);
    expect(result.issues.map((i) => i.rule)).toContain("paint");
  });

  it("names the filled paint so the skill is not the only place that says so", async () => {
    const { calls, spawn } = fake(SQUARE);
    await harnessArm({ spawn })(concept, { finish: "filled" });
    const [, brief] = calls[0].args;
    expect(brief).toContain("Paint: filled.");
    expect(brief).toContain("`hole`");
    expect(brief).not.toContain("Paint: outlined.");
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

  it("keeps the session log on the error, so a lost sample is still inspectable", async () => {
    const { spawn } = fake(null, {
      code: 1,
      stderr: "thinking about circles",
      stdout: '{"type":"item"}',
    });
    const failed = await draw(spawn).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(HarnessError);
    const lost = failed as HarnessError;
    expect(lost.log).toContain("thinking about circles");
    expect(lost.log).toContain('"type":"item"');
    expect(lost.brief).toContain("Draw the icon `box`");
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

describe("harnessArm and the vocabulary", () => {
  it("writes the parts file and names it in the brief", async () => {
    // Without this the arm is not the same experiment as the built-in loop:
    // that loop's model has `listParts` and `part`, and an agent handed a skill
    // that promises `part` but no file to place from spends its timeout looking
    // for one.
    let seenBrief = "";
    // Read inside the fake: a successful run removes the scratch directory, so
    // by the time the arm returns there is nothing left to open.
    let written: { parts: unknown[] } = { parts: [] };
    const arm = harnessArm({
      spawn: (invocation) => {
        seenBrief = invocation.args.at(-1) ?? "";
        written = JSON.parse(
          readFileSync(path.join(invocation.cwd, "parts.json"), "utf-8")
        );
        writeFileSync(path.join(invocation.cwd, "icon.icon"), "icon x\nfit\n");
        return Promise.resolve({ code: 0, stderr: "", stdout: "" });
      },
    });
    const part: Part = {
      closed: false,
      d: "M0 0L4 0",
      h: 0,
      icons: ["folder-1"],
      id: "p0",
      instances: 1,
      name: "folder",
      nodes: 2,
      sizeRange: [4, 4],
      w: 4,
    };
    await arm({ name: "x" }, { parts: [part] });
    expect(written.parts).toHaveLength(1);
    expect(seenBrief).toContain("parts.json");
    expect(seenBrief).toContain("--parts");
  });

  it("omits unnamed parts that did not match the concept", async () => {
    // A house extraction is ~1,100 shapes of which ~60 carry a name. Shipping
    // the rest is 270 KB of path data the first demo timed out reading. Search
    // hits are the exception: those ids are what `listParts` would have named.
    let names: unknown[] = [];
    const arm = harnessArm({
      spawn: (invocation) => {
        names = (
          JSON.parse(
            readFileSync(path.join(invocation.cwd, "parts.json"), "utf-8")
          ) as { parts: { name?: string }[] }
        ).parts.map((p) => p.name);
        writeFileSync(path.join(invocation.cwd, "icon.icon"), "icon x\nfit\n");
        return Promise.resolve({ code: 0, stderr: "", stdout: "" });
      },
    });
    const named: Part = {
      closed: false,
      d: "M0 0L4 0",
      h: 0,
      icons: ["folder-1"],
      id: "p0",
      instances: 1,
      name: "folder",
      nodes: 2,
      sizeRange: [4, 4],
      w: 4,
    };
    const unnamed: Part = { ...named, id: "p1", name: undefined };
    await arm({ name: "x" }, { parts: [named, unnamed] });
    expect(names).toEqual(["folder"]);
  });

  it("ships an unnamed part that search hit, and names its id in the brief", async () => {
    let ids: string[] = [];
    let seenBrief = "";
    const arm = harnessArm({
      spawn: (invocation) => {
        seenBrief = invocation.args.at(-1) ?? "";
        ids = (
          JSON.parse(
            readFileSync(path.join(invocation.cwd, "parts.json"), "utf-8")
          ) as { parts: { id: string }[] }
        ).parts.map((p) => p.id);
        writeFileSync(path.join(invocation.cwd, "icon.icon"), "icon x\nfit\n");
        return Promise.resolve({ code: 0, stderr: "", stdout: "" });
      },
    });
    const unnamed: Part = {
      closed: false,
      d: "M0 0L4 0",
      h: 0,
      icons: ["git-pull-request"],
      id: "p99",
      instances: 1,
      nodes: 2,
      sizeRange: [4, 4],
      w: 4,
    };
    const named: Part = {
      ...unnamed,
      icons: ["folder-1"],
      id: "p0",
      name: "folder",
    };
    await arm(
      { name: "pull-request", tags: ["git"] },
      { parts: [named, unnamed] }
    );
    expect(ids).toEqual(["p99", "p0"]);
    expect(seenBrief).toContain("`p99`");
    expect(seenBrief).toContain("git-pull-request");
  });

  it("drops a search hit whose provenance is a different word", async () => {
    // `request` matches `email-2-incoming` on an alias. Listing it tells the
    // agent to place an envelope on a pull request.
    let ids: string[] = [];
    const arm = harnessArm({
      spawn: (invocation) => {
        ids = (
          JSON.parse(
            readFileSync(path.join(invocation.cwd, "parts.json"), "utf-8")
          ) as { parts: { id: string }[] }
        ).parts.map((p) => p.id);
        writeFileSync(path.join(invocation.cwd, "icon.icon"), "icon x\nfit\n");
        return Promise.resolve({ code: 0, stderr: "", stdout: "" });
      },
    });
    const base = {
      closed: false,
      d: "M0 0L4 0",
      h: 0,
      instances: 1,
      nodes: 2,
      sizeRange: [4, 4] as [number, number],
      w: 4,
    };
    await arm(
      { name: "pull-request", tags: ["git"] },
      {
        parts: [
          { ...base, icons: ["pull-request"], id: "p-pr" },
          { ...base, icons: ["email-2-incoming"], id: "p-mail" },
          { ...base, icons: ["folder-1"], id: "p0", name: "folder" },
        ],
      }
    );
    expect(ids).toEqual(["p-pr", "p0"]);
  });

  it("still places a part the file omitted, because the program is checked against the full list", async () => {
    const named: Part = {
      closed: true,
      d: "M16 4H20V8H16Z",
      h: 4,
      icons: ["box"],
      id: "p0",
      instances: 1,
      name: "box",
      nodes: 4,
      sizeRange: [4, 4],
      w: 4,
    };
    const unnamed: Part = {
      closed: true,
      d: "M4 4H12V12H4Z",
      h: 8,
      icons: ["box"],
      id: "p99",
      instances: 1,
      nodes: 4,
      sizeRange: [8, 8],
      w: 8,
    };
    const { spawn } = fake(`icon box
part p99
fit`);
    const result = await harnessArm({ spawn })(concept, {
      parts: [named, unnamed],
    });
    expect(result.issues.filter((i) => i.rule === "dsl")).toEqual([]);
    expect(result.doc.draw).toHaveLength(1);
  });

  it("says so when there is no vocabulary, rather than leaving the skill to promise one", async () => {
    let seenBrief = "";
    const arm = harnessArm({
      spawn: (invocation) => {
        seenBrief = invocation.args.at(-1) ?? "";
        writeFileSync(path.join(invocation.cwd, "icon.icon"), "icon x\nfit\n");
        return Promise.resolve({ code: 0, stderr: "", stdout: "" });
      },
    });
    await arm({ name: "x" }, {});
    expect(seenBrief).toContain("No parts vocabulary is available");
    expect(seenBrief).not.toContain("parts.json");
  });

  it("treats unmatched unnamed parts as no vocabulary", async () => {
    // `part` looks up a name or an id that search offered. A dump of every
    // unnamed id is a vocabulary the agent cannot choose from.
    let seenBrief = "";
    let wroteFile = false;
    const arm = harnessArm({
      spawn: (invocation) => {
        seenBrief = invocation.args.at(-1) ?? "";
        wroteFile = existsSync(path.join(invocation.cwd, "parts.json"));
        writeFileSync(path.join(invocation.cwd, "icon.icon"), "icon x\nfit\n");
        return Promise.resolve({ code: 0, stderr: "", stdout: "" });
      },
    });
    const unnamed: Part = {
      closed: false,
      d: "M0 0L4 0",
      h: 0,
      icons: ["unrelated"],
      id: "p0",
      instances: 1,
      nodes: 2,
      sizeRange: [4, 4],
      w: 4,
    };
    await arm({ name: "x" }, { parts: [unnamed] });
    expect(wroteFile).toBe(false);
    expect(seenBrief).toContain("No parts vocabulary is available");
  });

  it("copies a real skill into the scratch directory, because the sandbox cannot read outside it", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "iconsmith-skill-"));
    const skill = path.join(dir, "origin.md");
    writeFileSync(skill, "# skill\n");
    let copied = "";
    let seenBrief = "";
    const arm = harnessArm({
      skill,
      spawn: (invocation) => {
        seenBrief = invocation.args.at(-1) ?? "";
        copied = readFileSync(path.join(invocation.cwd, "SKILL.md"), "utf-8");
        writeFileSync(path.join(invocation.cwd, "icon.icon"), "icon x\nfit\n");
        return Promise.resolve({ code: 0, stderr: "", stdout: "" });
      },
    });
    await arm({ name: "x" }, {});
    expect(copied).toBe("# skill\n");
    expect(seenBrief).toContain(path.join("SKILL.md"));
    expect(seenBrief).not.toContain(skill);
  });

  it("puts iconsmith on PATH in the scratch directory when the CLI is built", async () => {
    // The skill tells the agent to run `iconsmith draw`. A temp dir has no
    // binary, and there is no global install, so without this the agent never
    // compiles what it wrote.
    let cwd = "";
    let pathEnv = "";
    const arm = harnessArm({
      spawn: (invocation) => {
        ({ cwd } = invocation);
        pathEnv = invocation.env.PATH ?? "";
        writeFileSync(path.join(cwd, "icon.icon"), "icon x\nfit\n");
        return Promise.resolve({ code: 0, stderr: "", stdout: "" });
      },
    });
    await arm({ name: "x" }, {});
    const linked = existsSync(path.join(cwd, "iconsmith"));
    if (linked) {
      expect(pathEnv.split(path.delimiter)[0]).toBe(cwd);
    }
  });

  it("points Claude Code at the AI Gateway without touching ~/.claude", async () => {
    const { calls, spawn } = fake(SQUARE);
    await harnessArm({ spawn })(concept, noOptions);
    expect(calls[0].env.ANTHROPIC_BASE_URL).toBe(CLAUDE_GATEWAY_URL);
    expect(calls[0].env.ANTHROPIC_API_KEY).toBe("");
  });

  it("gives Codex a scratch CODEX_HOME aimed at the gateway", async () => {
    const { calls, spawn } = fake(SQUARE);
    await harnessArm({ command: "codex", keep: true, spawn })(
      concept,
      noOptions
    );
    const home = calls[0].env.CODEX_HOME;
    expect(home).toBe(path.join(calls[0].cwd, ".codex"));
    const toml = readFileSync(path.join(home ?? "", "config.toml"), "utf-8");
    expect(toml).toContain(CODEX_GATEWAY_URL);
    expect(toml).toContain('wire_api = "responses"');
    expect(toml).toContain('model_provider = "vercel"');
  });
});

describe("harnessArm audit", () => {
  const pass: AuditResult = {
    findings: [],
    ok: true,
    pq: 10,
    reason: null,
    sc: 10,
    scorable: true,
    stage: "decide",
  };
  const passAsk: AuditAsk = () => Promise.resolve(pass);

  it("skips the host audit when no ask is injected", async () => {
    const { calls, spawn } = fake(SQUARE);
    await harnessArm({ keep: true, spawn })(concept, noOptions);

    expect(calls).toHaveLength(1);
    expect(existsSync(path.join(calls[0].cwd, PREVIEW_FILE))).toBe(false);
    expect(existsSync(path.join(calls[0].cwd, AUDIT_FILE))).toBe(false);
  });

  it("writes a preview and an audit after a passing look", async () => {
    const { calls, spawn } = fake(SQUARE);
    const result = await harnessArm({ ask: passAsk, keep: true, spawn })(
      concept,
      noOptions
    );

    expect(calls).toHaveLength(1);
    const preview = readFileSync(path.join(calls[0].cwd, PREVIEW_FILE));
    expect(preview.subarray(0, 4)).toEqual(PNG_MAGIC);
    expect(existsSync(path.join(calls[0].cwd, AUDIT_FILE))).toBe(true);
    expect(result.audit).toEqual(pass);
  });

  it("re-spawns once when the first look is not ok", async () => {
    const { calls, spawn } = fake((n) => (n === 1 ? SQUARE : DISC));
    let looks = 0;
    const ask: AuditAsk = () => {
      looks += 1;
      return Promise.resolve(
        looks === 1
          ? {
              findings: [{ kind: "object", message: "not a box" }],
              ok: false,
              pq: 4,
              reason: "wrong object",
              sc: 3,
            }
          : pass
      );
    };
    const result = await harnessArm({ ask, keep: true, spawn })(
      concept,
      noOptions
    );

    expect(calls).toHaveLength(2);
    expect(calls[1].cwd).toBe(calls[0].cwd);
    const revised = readFileSync(path.join(calls[1].cwd, "BRIEF.md"), "utf-8");
    expect(revised).toContain(PREVIEW_FILE);
    expect(revised).toContain(AUDIT_FILE);
    expect(revised).toContain("object: not a box");
    expect(result.program).toContain("circle 12,12 r8");
    expect(result.log).toBe(
      "Drew a document with two text lines.\n\nDrew a document with two text lines."
    );
  });

  it("spends the configured repair budget until the visual audit passes", async () => {
    const { calls, spawn } = fake((n) => (n < 3 ? SQUARE : DISC));
    let looks = 0;
    const ask: AuditAsk = () => {
      looks += 1;
      return Promise.resolve(
        looks < 3
          ? {
              findings: [
                { kind: "object", message: `attempt ${looks} is wrong` },
              ],
              pq: 4,
              reason: "wrong object",
              sc: 3,
            }
          : pass
      );
    };

    const result = await harnessArm({ ask, repairs: 2, spawn })(
      concept,
      noOptions
    );

    expect(calls).toHaveLength(3);
    expect(looks).toBe(3);
    expect(result.audit).toEqual(pass);
    expect(result.program).toContain("circle 12,12 r8");
  });

  it("keeps the drawing when the audit throws", async () => {
    const { calls, spawn } = fake(SQUARE);
    const result = await harnessArm({ ask: throwAsk, spawn })(
      concept,
      noOptions
    );

    expect(calls).toHaveLength(1);
    expect(result.program).toContain("rect 4,4 16x16 r2");
    expect(result.svg).toContain("<svg");
  });
});

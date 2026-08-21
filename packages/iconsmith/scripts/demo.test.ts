/**
 * The demo's host look, end to end.
 *
 * A drawing lands; a PNG and `AUDIT.json` land beside it; a failed look
 * re-spawns once. `ask` and `spawn` are injected — nothing here talks to a
 * gateway or an agent CLI.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HOUSE_VARIANT } from "../src/corpus/load.js";
import type { AuditAsk, AuditResult } from "../src/pipeline/audit.js";
import type { HarnessInvocation, Spawn } from "../src/pipeline/harness.js";
import { demoArgs, runDemo } from "./demo.js";
import type { DemoSpec } from "./demo.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const pass: AuditResult = {
  findings: [],
  ok: true,
  pq: 9,
  reason: null,
  sc: 9,
  scorable: true,
  stage: "decide",
};

const passAsk: AuditAsk = () => Promise.resolve(pass);

const PLUS: DemoSpec = {
  concept: { category: "Actions", name: "plus", tags: ["add"] },
  key: null,
  mark: "plus",
};

const BOX: DemoSpec = {
  concept: { name: "box" },
  key: null,
  make: "hub",
};

const SQUARE = `icon box
keyline square
rect 4,4 16x16 r2
fit`;

const DISC = `icon box
keyline square
circle 12,12 r8
fit`;

const scratch = (): string =>
  mkdtempSync(path.join(tmpdir(), "iconsmith-demo-"));

const fake = (
  program: string | ((n: number) => string)
): { calls: HarnessInvocation[]; spawn: Spawn } => {
  const calls: HarnessInvocation[] = [];
  const spawn: Spawn = (invocation) => {
    calls.push(invocation);
    const source =
      typeof program === "function" ? program(calls.length) : program;
    writeFileSync(path.join(invocation.cwd, "icon.icon"), source);
    return Promise.resolve({
      code: 0,
      stderr: "",
      stdout: "drew",
    });
  };
  return { calls, spawn };
};

describe("demoArgs", () => {
  it("points Codex at BRIEF.md rather than repeating the brief on argv", () => {
    expect(demoArgs("a long brief")).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--approve-for-me",
      "--json",
      "--color",
      "never",
      "Read BRIEF.md and follow it.",
    ]);
  });
});

describe("runDemo host look", () => {
  it("screenshots both finishes of a mark and writes the audit beside them", async () => {
    const out = scratch();
    const report = await runDemo({
      ask: passAsk,
      concepts: [PLUS],
      out,
    });

    expect(report).toHaveLength(1);
    expect(report[0]?.concept).toBe("plus");
    for (const stem of ["plus", "plus-filled"]) {
      const dir = path.join(out, "plus");
      expect(
        readFileSync(path.join(dir, `${stem}.preview.png`)).subarray(0, 4)
      ).toEqual(PNG_MAGIC);
      expect(
        JSON.parse(readFileSync(path.join(dir, `${stem}.audit.json`), "utf-8"))
      ).toEqual(pass);
      expect(existsSync(path.join(dir, `${stem}.svg`))).toBe(true);
      expect(
        JSON.parse(readFileSync(path.join(dir, `${stem}.json`), "utf-8")).audit
      ).toEqual(pass);
    }
  });

  it("still writes a preview when no ask is injected", async () => {
    const out = scratch();
    await runDemo({ ask: null, concepts: [PLUS], out });

    const dir = path.join(out, "plus");
    expect(
      readFileSync(path.join(dir, "plus.preview.png")).subarray(0, 4)
    ).toEqual(PNG_MAGIC);
    expect(existsSync(path.join(dir, "plus.audit.json"))).toBe(false);
  });

  const PLUS_HOUSE = path.join("corpus", HOUSE_VARIANT, "plus-large.svg");

  it.skipIf(!existsSync(PLUS_HOUSE))(
    "stages the house twin and hands it to the look as a reference",
    async () => {
      const out = scratch();
      let refs = 0;
      const ask: AuditAsk = ({ references }) => {
        refs = references.length;
        return Promise.resolve(pass);
      };
      const report = await runDemo({
        ask,
        concepts: [PLUS],
        out,
      });

      const dir = path.join(out, "plus");
      expect(existsSync(path.join(dir, "plus.house.svg"))).toBe(true);
      expect(existsSync(path.join(dir, "plus-filled.house.svg"))).toBe(true);
      expect(refs).toBe(1);
      const [row] = report as [
        { samples: { cosine: null; house: { slug: string } }[] },
      ];
      const [recorded] = row.samples;
      expect(recorded.cosine).toBeNull();
      expect(recorded.house.slug).toBe("plus-large");
    }
  );

  it("does not stage a house sibling for a motif we will not copy", async () => {
    const out = scratch();
    const report = await runDemo({
      ask: null,
      concepts: [
        {
          concept: { category: "Actions", name: "flag", tags: ["marker"] },
          key: null,
          mark: "flag",
        },
      ],
      out,
    });

    expect(existsSync(path.join(out, "flag", "flag.house.svg"))).toBe(false);
    const [row] = report as [{ samples: { cosine: null; house?: unknown }[] }];
    expect(row.samples[0].cosine).toBeNull();
    expect(row.samples[0].house).toBeUndefined();
  });

  it("runs analog, then one harness island, and re-spawns once when the look fails", async () => {
    const out = scratch();
    const { calls, spawn } = fake((n) => (n === 1 ? SQUARE : DISC));
    let looks = 0;
    const ask: AuditAsk = () => {
      looks += 1;
      return Promise.resolve(
        looks === 2
          ? {
              findings: [{ kind: "object", message: "not a box" }],
              ok: false,
              pq: 3,
              reason: "wrong object",
              sc: 3,
            }
          : pass
      );
    };

    await runDemo({
      ask,
      concepts: [BOX],
      keep: true,
      n: 2,
      out,
      spawn,
      vocab: { aliases: new Map(), parts: [] },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].args).toEqual(demoArgs("ignored"));
    expect(calls[0].command).toBe("codex");
    const dir = path.join(out, "box");
    expect(existsSync(path.join(dir, "box-1.preview.png"))).toBe(true);
    expect(existsSync(path.join(dir, "box-2.preview.png"))).toBe(true);
    expect(
      JSON.parse(readFileSync(path.join(dir, "box-2.audit.json"), "utf-8"))
    ).toEqual(pass);
    expect(readFileSync(path.join(dir, "box-2.icon"), "utf-8")).toContain(
      "circle 12,12 r8"
    );
    const revised = readFileSync(path.join(calls[1].cwd, "BRIEF.md"), "utf-8");
    expect(revised).toContain("PREVIEW.png");
    expect(revised).toContain("object: not a box");
    expect(looks).toBe(3);
  });
});

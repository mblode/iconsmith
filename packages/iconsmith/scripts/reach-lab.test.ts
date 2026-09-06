/**
 * The staging harness: the invariants it refuses to stage without, and the one
 * thing it must never do quietly.
 *
 * Each invariant is a bug the reach dashboard shipped, so each is worth failing
 * a run over rather than reporting on the page afterwards. The refusal to
 * substitute is the newer lesson: a previous revision drew all ten on the host,
 * reported `0 error(s)`, and so answered a question about the generator with a
 * fact about the house.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Thinking } from "../src/pipeline/thinking.js";
import { run } from "../src/tools/dsl.js";
import { lint } from "../src/tools/lint.js";
import { punches, REACH_SET, runReachLab, unavailable } from "./reach-lab.js";

const temp = (): string => mkdtempSync(path.join(tmpdir(), "iconsmith-reach-"));

/** `analog` is the one arm on the list that runs with no credential and no
 *  corpus, so it is what exercises the invariants here. */
const ANALOG = REACH_SET.map((e) => ({ ...e, arm: "analog" as const }));

const out = temp();
const staged = await runReachLab(out, ANALOG);
const records = staged.flatMap((s) => s.records ?? []);

const ops = (program: string): string[] =>
  program
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

const withoutModelKeys = (fn: () => void | Promise<void>): Promise<void> => {
  const or = process.env.OPENROUTER_API_KEY;
  const gw = process.env.AI_GATEWAY_API_KEY;
  const oidc = process.env.VERCEL_OIDC_TOKEN;
  const harness = process.env.ICONSMITH_HARNESS;
  process.env.OPENROUTER_API_KEY = "";
  process.env.AI_GATEWAY_API_KEY = "";
  process.env.VERCEL_OIDC_TOKEN = "";
  process.env.ICONSMITH_HARNESS = "iconsmith-test-missing-harness";
  return Promise.resolve(fn()).finally(() => {
    process.env.OPENROUTER_API_KEY = or;
    process.env.AI_GATEWAY_API_KEY = gw;
    process.env.VERCEL_OIDC_TOKEN = oidc;
    process.env.ICONSMITH_HARNESS = harness;
  });
};

describe("unavailable", () => {
  it("names the missing credential rather than letting the arm throw", async () => {
    await withoutModelKeys(() => {
      // Neither is set in CI, and the message has to say which one to set.
      expect(unavailable("agent")).toMatch(/AI_GATEWAY_API_KEY/u);
      expect(unavailable("agent")).toMatch(/OPENROUTER_API_KEY/u);
      expect(unavailable("harness")).toMatch(/CLI on PATH/u);
    });
  });

  it("lets through the arms that need nothing", () => {
    expect(unavailable("analog")).toBeNull();
    expect(unavailable("glyph")).toBeNull();
  });
});

describe("runReachLab", () => {
  /**
   * The regression that matters most. Asking for an arm this machine cannot run
   * must produce a *recorded skip*, never a drawing from somewhere else: a set
   * that quietly answers with the house is how ten host programs came to be
   * read as ten agent draws.
   */
  it("records a skip rather than substituting another arm", async () => {
    const dir = temp();
    let asked: Awaited<ReturnType<typeof runReachLab>> = [];
    await withoutModelKeys(async () => {
      asked = await runReachLab(dir, [
        { arm: "agent", name: "compass" },
        { arm: "harness", name: "wifi" },
      ]);
    });
    for (const one of asked) {
      expect(one.records, one.name).toBeUndefined();
      expect(one.skipped, one.name).toBeTruthy();
      expect(existsSync(path.join(dir, one.name, `${one.name}.svg`))).toBe(
        false
      );
    }
    // And the reason survives to disk, so a reader of the directory learns it
    // without re-running anything.
    expect(readFileSync(path.join(dir, "reach.json"), "utf-8")).toContain(
      "AI_GATEWAY_API_KEY"
    );
  });

  it("credits the arm that drew it, not the finish of the brief", () => {
    for (const record of records) {
      expect(record.policy, record.brief).toBe("analog");
    }
  });

  it("stages both paints of every icon it drew", () => {
    expect(records).toHaveLength(REACH_SET.length * 2);
    for (const { name } of REACH_SET) {
      for (const slug of [name, `${name}-filled`]) {
        for (const suffix of [".svg", ".icon", ".json", ".brief.md"]) {
          expect(existsSync(path.join(out, name, `${slug}${suffix}`))).toBe(
            true
          );
        }
      }
    }
  });

  /** A comment is not a program. Four of the ten staged one. */
  it("writes ops for every paint, filled included", () => {
    for (const record of records) {
      expect(ops(record.program).length, record.brief).toBeGreaterThan(3);
      expect(record.trace.length, record.brief).toBeGreaterThan(3);
    }
  });

  /**
   * Warnings are allowed through and errors are not. The analog fallback trips
   * plenty of the former — that is the arm telling the truth about a generic
   * construction — and the run is still valid.
   */
  it("stages findings but no errors, in either paint", () => {
    for (const record of records) {
      const drawn = run(record.program, []);
      expect(drawn.errors, record.brief).toEqual([]);
      const errors = lint(drawn.canvas, { keyline: drawn.keyline }).filter(
        (issue) => issue.severity === "error"
      );
      expect(errors, record.brief).toEqual([]);
    }
    expect(records.some((r) => r.issues.length > 0)).toBe(true);
  });

  /** The whole point of the sidecar: the page reads it, so `clean` may not
   *  disagree with the findings beside it. */
  it("records a verdict that agrees with its own findings", () => {
    for (const record of records) {
      const errors = record.issues.filter((i) => i.severity === "error");
      expect(record.clean, record.brief).toBe(errors.length === 0);
    }
  });

  it("cuts a hole rather than painting over the solid", async () => {
    await Promise.all(
      REACH_SET.map(async ({ name }) => {
        const program = readFileSync(
          path.join(out, name, `${name}-filled.icon`),
          "utf-8"
        );
        if (ops(program).some((line) => line.startsWith("hole "))) {
          expect(
            await punches(
              program,
              readFileSync(path.join(out, name, `${name}-filled.svg`), "utf-8")
            ),
            name
          ).toBe(true);
        }
      })
    );
  });

  it("writes a sidecar the viewer can read back as a verdict", () => {
    const sidecar = JSON.parse(
      readFileSync(path.join(out, "wifi", "wifi.json"), "utf-8")
    ) as Thinking;
    expect(Object.keys(sidecar).toSorted()).toEqual([
      "brief",
      "clean",
      "finish",
      "issues",
      "policy",
      "program",
      "steps",
      "trace",
    ]);
    expect(sidecar.finish).toBe("outlined");
    expect(sidecar.policy).toBe("analog");
  });
});

it("checks cutout pixels rather than accepting a fill-rule attribute", async () => {
  const program = "finish filled\ncircle 12,12 r8\nhole circle 12,12 r4";
  expect(await punches(program, run(program).canvas.toSVG())).toBe(true);
  const painted = run("finish filled\ncircle 12,12 r8").canvas.toSVG();
  expect(painted).toContain('fill-rule="evenodd"');
  expect(await punches(program, painted)).toBe(false);
});

/**
 * The staging harness, and the five invariants it refuses to stage without.
 *
 * Each one is a bug the reach dashboard shipped, so each is worth failing a
 * run over rather than reporting on the page afterwards: a directory that
 * cannot be trusted is worse than none, because the viewer shows it anyway and
 * the plausible cards carry the rest.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GLYPH_NAMES } from "../src/pipeline/glyphs.js";
import type { Thinking } from "../src/pipeline/thinking.js";
import { run } from "../src/tools/dsl.js";
import { lint } from "../src/tools/lint.js";
import { runReachLab } from "./reach-lab.js";

const out = mkdtempSync(path.join(tmpdir(), "iconsmith-reach-"));
const records = await runReachLab(out);

const ops = (program: string): string[] =>
  program
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

describe("runReachLab", () => {
  it("stages both paints of every icon in the set", () => {
    expect(records).toHaveLength(GLYPH_NAMES.length * 2);
    for (const name of GLYPH_NAMES) {
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

  it("stages nothing with a lint error, in either paint", () => {
    for (const record of records) {
      const drawn = run(record.program, []);
      expect(drawn.errors, record.brief).toEqual([]);
      const errors = lint(drawn.canvas, { keyline: drawn.keyline }).filter(
        (issue) => issue.severity === "error"
      );
      expect(errors, record.brief).toEqual([]);
    }
  });

  /** The whole point of the sidecar: the page reads it, so `clean` may not
   *  disagree with the findings beside it. */
  it("records a verdict that agrees with its own findings", () => {
    for (const record of records) {
      const errors = record.issues.filter((i) => i.severity === "error");
      expect(record.clean, record.brief).toBe(errors.length === 0);
    }
  });

  it("cuts a hole rather than painting over the solid", () => {
    const filled = readFileSync(
      path.join(out, "compass", "compass-filled.svg"),
      "utf-8"
    );
    expect(
      readFileSync(path.join(out, "compass", "compass-filled.icon"), "utf-8")
    ).toContain("hole circle 12,12 r8");
    expect(filled).toContain('fill-rule="evenodd"');
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
      "suppressed",
      "trace",
    ]);
    expect(sidecar.finish).toBe("outlined");
    expect(sidecar.policy).toBe("glyph");
  });
});

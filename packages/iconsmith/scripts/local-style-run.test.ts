import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import { STYLE_COMPILER } from "../src/pipeline/style.js";
import { specAt } from "../src/tools/spec.js";
import { runLocalStyle } from "./local-style-run.js";

it.each(["delivered", "missing-review", "author-failed", "altered-input"])(
  "requires checked artifacts and honest delivery: %s",
  async (scenario) => {
    const root = mkdtempSync(path.join(tmpdir(), "iconsmith-delivery-"));
    const out = path.join(root, "run");
    mkdirSync(out);
    const revisionPath = path.join(root, "revision.json");
    writeFileSync(
      revisionPath,
      JSON.stringify({
        calibration: "unvalidated",
        compiler: STYLE_COMPILER,
        id: "delivery-fixture",
        masters: { large: specAt() },
        parts: [],
        policy: DEFAULT_POLICY,
        references: [],
        rubric: "Host fixture, not craft evaluation.",
      })
    );
    try {
      const result = await runLocalStyle({
        args: () => [],
        command: "must-not-run",
        concept: "ring",
        env: process.env,
        invoke: (brief) => {
          expect(brief).toContain("Missing review means incomplete delivery");
          writeFileSync(
            path.join(out, "outlined.icon"),
            "icon ring\nfinish outlined\ncircle 12,12 r9"
          );
          writeFileSync(
            path.join(out, "filled.icon"),
            "icon ring\nfinish filled\ncircle 12,12 r10\nhole circle 12,12 r8"
          );
          if (scenario !== "missing-review") {
            writeFileSync(
              path.join(out, "review.md"),
              "Test fixture review, no claim of image inspection."
            );
          }
          if (scenario === "altered-input") {
            writeFileSync(path.join(out, "spec.json"), "{}");
          }
          return Promise.resolve({
            code: scenario === "author-failed" ? 1 : 0,
            killed: false,
            stderr: "",
            stdout: "",
          });
        },
        master: "large",
        out,
        revisionPath,
      });
      expect(result.status).toBe(
        scenario === "delivered" ? "delivered" : "incomplete"
      );
      expect(result.craftApproved).toBe(false);
      expect(result.reviewContentValidated).toBe(false);
      expect(result.missing).toEqual(
        scenario === "missing-review" ? ["review.md"] : []
      );
      expect(result.changedInputs).toEqual(
        scenario === "altered-input" ? ["spec.json"] : []
      );
      expect(result.checkExitCode).toBe(
        scenario === "altered-input" ? null : 0
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

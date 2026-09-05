import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { expect, it } from "vitest";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import { STYLE_COMPILER } from "../src/pipeline/style.js";
import { specAt } from "../src/tools/spec.js";

it.each([16, 20, 24] as const)(
  "renders the selected %ipx master at its native size",
  async (size) => {
    const out = mkdtempSync(path.join(tmpdir(), "iconsmith-native-"));
    try {
      const revision = path.join(out, "revision.json");
      writeFileSync(
        revision,
        JSON.stringify({
          calibration: "unvalidated",
          compiler: STYLE_COMPILER,
          id: "native-size-test",
          masters: { selected: specAt({ size }) },
          parts: [],
          policy: DEFAULT_POLICY,
          references: [],
          rubric: "Host fixture for native preview dimensions, not craft.",
        })
      );
      writeFileSync(
        path.join(out, "outlined.icon"),
        "icon disc\nfinish outlined\ncircle 12,12 r9"
      );
      writeFileSync(
        path.join(out, "filled.icon"),
        "icon disc\nfinish filled\ncircle 12,12 r10\nhole circle 12,12 r8"
      );
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(new URL("style-check.ts", import.meta.url)),
          revision,
          "selected",
          out,
        ],
        { encoding: "utf-8", stdio: "pipe" }
      );
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const report = JSON.parse(
        readFileSync(path.join(out, "checks.json"), "utf-8")
      );
      expect(report.nativeSize).toBe(size);
      expect(report.pairChecked).toBe(true);
      expect(report.paints).toEqual(["outlined", "filled"]);
      expect(report.preview16).toBe(size === 16 ? "native" : "downsample");
      expect(report.exactReplay).toBe(true);
      const native = await sharp(path.join(out, "native.png")).metadata();
      expect([native.width, native.height]).toEqual([size * 2, size]);
      const saved = await sharp(
        path.join(report.snapshot, "native.png")
      ).metadata();
      expect([saved.width, saved.height]).toEqual([size * 2, size]);
      const small = await sharp(path.join(out, "preview-16.png")).metadata();
      expect([small.width, small.height]).toEqual([32, 16]);
      const single = path.join(out, "single");
      mkdirSync(single);
      writeFileSync(
        path.join(single, "outlined.icon"),
        "icon ring\nfinish outlined\ncircle 12,12 r9"
      );
      const singleResult = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(new URL("style-check.ts", import.meta.url)),
          revision,
          "selected",
          single,
          "outlined",
        ],
        { encoding: "utf-8" }
      );
      expect(
        singleResult.status,
        singleResult.stdout + singleResult.stderr
      ).toBe(0);
      const singleReport = JSON.parse(
        readFileSync(path.join(single, "checks.json"), "utf-8")
      );
      expect(singleReport.pairChecked).toBe(false);
      expect(singleReport.paints).toEqual(["outlined"]);
      expect(singleReport.exactReplay).toBe(true);
      const singleImage = await sharp(
        path.join(single, "native.png")
      ).metadata();
      expect([singleImage.width, singleImage.height]).toEqual([size, size]);
    } finally {
      rmSync(out, { force: true, recursive: true });
    }
  }
);

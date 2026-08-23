import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  gatewayHarnessSpawn,
  programFromHarnessText,
} from "./model-harness.js";

describe("programFromHarnessText", () => {
  it("accepts a whole fenced DSL program", () => {
    expect(
      programFromHarnessText(
        "```icon\nicon home\nfinish filled\ncircle 12,12 r8\n```"
      )
    ).toBe("icon home\nfinish filled\ncircle 12,12 r8\n");
  });

  it("rejects commentary without a complete icon program", () => {
    expect(programFromHarnessText("I would draw a house.")).toBeNull();
  });
});

describe("gatewayHarnessSpawn", () => {
  it("sends names without path data and writes the harness deliverable", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "iconsmith-model-harness-"));
    writeFileSync(path.join(dir, "SKILL.md"), "Use the DSL.");
    writeFileSync(path.join(dir, "BRIEF.md"), "Draw `home`.");
    writeFileSync(
      path.join(dir, "parts.json"),
      JSON.stringify({
        parts: [{ d: "M1 1L2 2", h: 4, id: "roof-1", name: "roof", w: 6 }],
      })
    );
    let prompt = "";
    const spawn = gatewayHarnessSpawn({
      ask: ({ prompt: requestPrompt }) => {
        prompt = requestPrompt;
        return Promise.resolve({
          text: "icon home\nfinish outlined\npart roof-1 at 4,4 size 16",
        });
      },
    });

    try {
      const run = await spawn({
        args: [],
        command: "claude",
        cwd: dir,
        env: {},
        timeoutMs: 1000,
      });

      expect(run.code).toBe(0);
      expect(prompt).toContain('"id": "roof-1"');
      expect(prompt).not.toContain("M1 1L2 2");
      expect(readFileSync(path.join(dir, "icon.icon"), "utf-8")).toContain(
        "part roof-1"
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

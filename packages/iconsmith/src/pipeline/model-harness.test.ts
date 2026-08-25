import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  describeRejection,
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

  it("takes the program out of a fence opened with any language", () => {
    expect(
      programFromHarnessText("```dsl\nicon home\ncircle 12,12 r8\n```")
    ).toBe("icon home\ncircle 12,12 r8\n");
  });

  it("keeps a header the compiler would have accepted", () => {
    expect(
      programFromHarnessText("icon home  # the shed\ncircle 12,12 r8")
    ).toBe("icon home  # the shed\ncircle 12,12 r8\n");
  });
});

describe("describeRejection", () => {
  it("names an empty completion", () => {
    expect(describeRejection("  \n ")).toBe("the response was empty");
  });

  it("names a headerless program, which is not the same fault as prose", () => {
    expect(describeRejection("circle 12,12 r8\nfit")).toContain(
      "program lines with no `icon <slug>` header"
    );
  });

  it("names a fenced block that carried no header", () => {
    expect(
      describeRejection("Here you go:\n```\nrect 4,4 16x16\n```")
    ).toContain("a fenced block with no `icon <slug>` header");
  });

  it("names an output-token cut, which no amount of reading the text reveals", () => {
    expect(describeRejection("Let me work through the", "length")).toContain(
      "cut at the output-token limit"
    );
  });

  it("quotes prose rather than describing it", () => {
    expect(describeRejection("The current program is already correct.")).toBe(
      "39 characters of prose, opening `The current program is already correct.`"
    );
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

  it("names what came back instead of a program, and keeps it beside the brief", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "iconsmith-model-harness-"));
    writeFileSync(path.join(dir, "SKILL.md"), "Use the DSL.");
    writeFileSync(path.join(dir, "BRIEF.md"), "Draw `home`.");
    const said = "The current program already reads as a house.";
    const spawn = gatewayHarnessSpawn({
      ask: () => Promise.resolve({ text: said }),
    });

    try {
      const run = await spawn({
        args: [],
        command: "claude",
        cwd: dir,
        env: {},
        timeoutMs: 1000,
      });

      expect(run.code).toBe(1);
      // `harnessArm` quotes stderr into its own error, so the shape of the
      // answer has to travel in this string or it is lost with the process.
      expect(run.stderr).toContain("characters of prose");
      expect(run.stderr).toContain(said);
      expect(run.stderr).toContain("REJECTED.txt");
      expect(readFileSync(path.join(dir, "REJECTED.txt"), "utf-8")).toContain(
        said
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

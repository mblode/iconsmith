import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  assertNoAmbientCatalogs,
  discoveredSkillPaths,
  prepareAuthorContext,
} from "./local-author-context.js";

const catalog = (name: string) =>
  `<skills_instructions>\n- \`r0\` = \`/test/skills\`\n- ${name} (file: r0/${name}/SKILL.md)`;
const prompt = (text: string) =>
  JSON.stringify([
    { content: [{ text, type: "input_text" }], role: "developer" },
  ]);

const record = (payload: object) =>
  JSON.stringify({ payload, type: "response_item" });

it("resolves aliased and absolute paths without reading skill contents", () => {
  expect(
    discoveredSkillPaths(`${catalog("one")}\n(file: /absolute/two/SKILL.md)`)
  ).toEqual(["/test/skills/one/SKILL.md", "/absolute/two/SKILL.md"]);
  expect(() => discoveredSkillPaths("(file: r7/missing/SKILL.md)")).toThrow(
    "Unresolved"
  );
});

it("disables successive discovered pages and retains a compact preflight receipt", () => {
  const out = mkdtempSync(path.join(tmpdir(), "iconsmith-context-"));
  const seen: string[][] = [];
  let count = 0;
  try {
    const result = prepareAuthorContext("unused", out, {}, (args) => {
      seen.push([...args]);
      count += 1;
      return prompt(
        [catalog("one"), catalog("two"), "Only the drawing packet."][count - 1]
      );
    });
    expect(seen).toHaveLength(3);
    expect(result.args.join(" ")).toContain(
      'path="/test/skills/one/SKILL.md",enabled=false'
    );
    expect(result.args.join(" ")).toContain(
      'path="/test/skills/two/SKILL.md",enabled=false'
    );
    const receipt = JSON.parse(
      readFileSync(path.join(out, result.receiptName), "utf-8")
    );
    expect(receipt.disabledSkills).toBe(2);
    expect(receipt.globalConfigurationEdited).toBe(false);
    expect(JSON.stringify(receipt)).not.toContain("/test/skills");
  } finally {
    rmSync(out, { force: true, recursive: true });
  }
});

it("refuses persistent catalogs and invalid preview responses", () => {
  expect(() =>
    prepareAuthorContext("unused", "/unused", {}, () => prompt(catalog("one")))
  ).toThrow("still contains");
  expect(() =>
    prepareAuthorContext("unused", "/unused", {}, () => "invalid JSON")
  ).toThrow();
});

it("rejects actual ambient context while allowing ordinary tool output", () => {
  expect(() =>
    assertNoAmbientCatalogs(
      record({
        content: [{ text: "<recommended_plugins>" }],
        role: "user",
        type: "message",
      })
    )
  ).toThrow("catalog");
  expect(() =>
    assertNoAmbientCatalogs(
      record({
        content: [{ text: "<skills_instructions>" }],
        role: "developer",
        type: "message",
      })
    )
  ).toThrow("catalog");
  expect(() =>
    assertNoAmbientCatalogs(
      record({
        output: "Document mentions <skills_instructions>",
        type: "function_call_output",
      })
    )
  ).not.toThrow();
});

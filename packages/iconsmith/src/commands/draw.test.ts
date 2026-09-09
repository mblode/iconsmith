import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, expect, test, vi } from "vitest";

import { registerDrawCommand } from "./draw.js";

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const fixture = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "iconsmith-draw-"));
  directories.push(directory);
  const source = path.join(directory, "square.icon");
  const out = path.join(directory, "square.svg");
  writeFileSync(
    source,
    "icon square\nkeyline square\nrect 4,4 16x16 r3\nfit\n"
  );
  const command = new Command().option("--output <format>", "format", "text");
  registerDrawCommand(command);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  return { command, out, source };
};

test("JSON output writes the requested SVG and keeps stdout parseable", async () => {
  const { command, out, source } = fixture();
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  await command.parseAsync(["--output", "json", "draw", source, "-o", out], {
    from: "user",
  });
  const report = JSON.parse(
    stdout.mock.calls.map(([chunk]) => String(chunk)).join("")
  );
  expect(report.svg).toContain("<svg");
  expect(readFileSync(out, "utf-8")).toBe(`${report.svg}\n`);
});

test("JSON document output writes the editable document", async () => {
  const { command, out, source } = fixture();
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  await command.parseAsync(
    ["--output", "json", "draw", source, "--doc", "-o", out],
    {
      from: "user",
    }
  );
  const report = JSON.parse(
    stdout.mock.calls.map(([chunk]) => String(chunk)).join("")
  );
  expect(JSON.parse(readFileSync(out, "utf-8"))).toEqual(report.doc);
});

test("JSON export refuses to overwrite an existing file", async () => {
  const { command, out, source } = fixture();
  writeFileSync(out, "keep this drawing");
  await expect(
    command.parseAsync(["--output", "json", "draw", source, "-o", out], {
      from: "user",
    })
  ).rejects.toThrow("already exists");
  expect(readFileSync(out, "utf-8")).toBe("keep this drawing");
});

/** Test the packed artifact with fresh dependencies and no checkout symlinks. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(path.join(tmpdir(), "iconsmith-package-"));
const install = path.join(temporary, "install");
const workspace = path.join(temporary, "unrelated-project");
const home = path.join(temporary, "home");
for (const directory of [install, workspace, home]) mkdirSync(directory);
const invoke = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(
    result.status,
    options.expectedStatus ?? 0,
    `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  return result;
};
try {
  const [packed] = JSON.parse(
    invoke("npm", [
      "pack",
      "--workspace",
      "iconsmith",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      temporary,
    ]).stdout,
  );
  const names = packed.files.map((file) => file.path);
  for (const required of [
    "dist-agent/cli.js",
    "dist-agent/revision.json",
    "SKILL.md",
    "references/drawing.md",
    "library/blode-icons/SOURCE.json",
  ])
    assert.ok(names.includes(required), required);
  for (const name of names) assert.doesNotMatch(name, /^(?:src|scripts|corpus|dist|\.staging)\//u);
  const tarball = path.join(temporary, packed.filename);
  writeFileSync(path.join(install, "package.json"), JSON.stringify({ private: true }));
  invoke("npm", [
    "install",
    "--prefix",
    install,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    tarball,
  ]);
  const installed = path.join(install, "node_modules", "iconsmith");
  for (const researchDependency of ["ai", "run", "@ai-sdk/gateway"])
    assert.equal(existsSync(path.join(install, "node_modules", researchDependency)), false);
  const cli = path.join(installed, "dist-agent", "cli.js");
  const execute = (args, expectedStatus = 0, input) =>
    invoke(process.execPath, [cli, ...args], {
      cwd: workspace,
      expectedStatus,
      input,
      env: {
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, ".config"),
        CODEX_HOME: path.join(home, ".codex"),
        PATH: "",
        NO_COLOR: "1",
        TMPDIR: temporary,
      },
    });
  const help = execute(["--help"]).stdout;
  assert.match(help, /prepare/u);
  assert.doesNotMatch(help, /\n\s+(?:new|improve|generate)\s/u);
  const schema = JSON.parse(execute(["schema"]).stdout);
  assert.equal(schema.name, "iconsmith");
  assert.deepEqual(schema.options.find((option) => option.name === "output").enum, [
    "text",
    "json",
  ]);
  assert.equal(
    schema.commands
      .find((command) => command.name === "prepare")
      .options.find((option) => option.name === "out").required,
    true,
  );
  for (const args of [
    ["--output", "json", "prepare", "bookmark-check"],
    ["prepare", "bookmark-check", "--output", "json"],
    ["--output", "json", "draw", "missing.icon"],
    ["--output", "json", "render", "missing.svg", "--out", "missing-proof"],
    ["--output", "json", "skill", "--out", "."],
  ]) {
    const result = execute(args, 1);
    const error = JSON.parse(result.stdout);
    assert.equal(error.error, true);
    assert.ok(error.code && error.message && error.hint);
    assert.ok(result.stderr.trim());
    assert.doesNotMatch(result.stdout, /\u001b\[/u);
  }
  execute(["skill", "--out", ".agents/skills/iconsmith"]);
  for (const file of ["SKILL.md", "references/drawing.md"]) {
    assert.equal(
      readFileSync(path.join(workspace, ".agents/skills/iconsmith", file), "utf8"),
      readFileSync(path.join(installed, file), "utf8"),
    );
  }
  execute(["skill", "--out", ".agents/skills/iconsmith"], 1);
  execute(["prepare", "square-check", "--out", "draft"]);
  const pinned = readFileSync(path.join(workspace, "draft/revision.json"), "utf8");
  const siblings = JSON.parse(
    readFileSync(path.join(workspace, "draft/references/drawings.json"), "utf8"),
  );
  assert.ok(siblings.length > 0);
  assert.ok(siblings.every((item) => item.name !== "square-check"));
  execute(["prepare", "square-check", "--out", "draft"], 1);
  assert.equal(readFileSync(path.join(workspace, "draft/revision.json"), "utf8"), pinned);
  execute(["prepare", "../escape", "--out", "unsafe"], 1);
  assert.equal(existsSync(path.join(workspace, "unsafe")), false);
  const candidate = path.join(workspace, "draft/candidate");
  mkdirSync(candidate);
  // A structural fixture, not a visual quality qualification.
  writeFileSync(
    path.join(candidate, "outlined.icon"),
    "icon square-check\nfinish outlined\nrect 4,4 16x16 r3\nline 9,13 11,15 15.5,10.5\n",
  );
  execute(["check", "draft/candidate", "--revision", "draft/revision.json"]);
  const checks = JSON.parse(readFileSync(path.join(candidate, "checks.json"), "utf8"));
  assert.equal(checks.exactReplay, true);
  assert.equal(checks.craftApproved, false);
  const snapshot = checks.snapshot;
  const savedSvg = readFileSync(path.join(candidate, "outlined.svg"), "utf8");
  execute(["render", "draft/candidate/outlined.svg", "--out", "proof"]);
  execute(["render", "draft/candidate/outlined.svg", "--out", "proof"], 1);
  execute(["--output", "json", "lint", "draft/candidate/outlined.svg"]);
  const fromFile = JSON.parse(
    execute(["--output", "json", "lint", "draft/candidate/outlined.svg"]).stdout,
  );
  for (const args of [
    ["--output", "json", "lint", "-"],
    ["lint", "--output", "json"],
  ]) {
    const fromPipe = JSON.parse(execute(args, 0, savedSvg).stdout);
    assert.deepEqual(fromPipe.files[0].issues, fromFile.files[0].issues);
    assert.equal(fromPipe.errors, fromFile.errors);
  }
  execute(["render", "-", "--out", "stdin-proof"], 0, savedSvg);
  writeFileSync(path.join(candidate, "outlined.icon"), "not a valid drawing\n");
  execute(["check", "draft/candidate", "--revision", "draft/revision.json"], 1);
  const failed = JSON.parse(readFileSync(path.join(candidate, "checks.json"), "utf8"));
  assert.equal(failed.structuralStatus, "failed");
  assert.equal(existsSync(path.join(candidate, "outlined.svg")), false);
  assert.equal(readFileSync(path.resolve(workspace, snapshot, "outlined.svg"), "utf8"), savedSvg);
  assert.equal(readdirSync(candidate).filter((name) => name.startsWith("check-")).length, 2);
  console.log(
    JSON.stringify({
      status: "passed",
      package: packed.name,
      version: packed.version,
      compressedBytes: packed.size,
      unpackedBytes: packed.unpackedSize,
      files: packed.entryCount,
      freshDependencies: true,
      sourceSymlinks: false,
      credentials: false,
      visualQualification: false,
    }),
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

#!/usr/bin/env node

/** Offline onboarding only: no agent dispatch, provider call or quality score. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const temporary = mkdtempSync(path.join(tmpdir(), "iconsmith-public-smoke-"));
const relocated = path.join(temporary, "clone");
const home = path.join(temporary, "home");
const engine = "packages/iconsmith";

try {
  mkdirSync(home);
  mkdirSync(path.join(relocated, engine), { recursive: true });
  // Copy runtime inputs explicitly: neither an ignored corpus nor a local
  // revision, staged experiment or author configuration can leak into the run.
  for (const relative of [
    "package.json",
    "examples",
    `${engine}/package.json`,
    `${engine}/SKILL.md`,
    `${engine}/src`,
    `${engine}/scripts`,
    `${engine}/dist`,
    `${engine}/library/blode-icons`,
  ]) {
    const source = path.join(root, relative);
    assert.ok(existsSync(source), `Missing ${relative}; run npm run build:local first.`);
    cpSync(source, path.join(relocated, relative), { recursive: true });
  }
  // Reuse installed dependencies only; do not duplicate installs or source.
  for (const relative of ["node_modules", `${engine}/node_modules`]) {
    if (existsSync(path.join(root, relative))) {
      symlinkSync(path.join(root, relative), path.join(relocated, relative), "dir");
    }
  }
  assert.equal(existsSync(path.join(relocated, engine, "corpus")), false);
  assert.equal(existsSync(path.join(relocated, engine, ".corpus")), false);

  const execute = (args, expectedStatus = 0) => {
    const result = spawnSync(process.execPath, args, {
      cwd: relocated,
      encoding: "utf-8",
      env: {
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, ".config"),
        CODEX_HOME: path.join(home, ".codex"),
        PATH: "",
        NO_COLOR: "1",
        TMPDIR: temporary,
      },
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(
      result.status,
      expectedStatus,
      `${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
    );
    return result;
  };

  const cli = `${engine}/dist/cli.js`;
  const example = "examples/square-check.icon";
  execute([cli, "draw", example, "-o", "square-check.svg"]);
  const exported = readFileSync(path.join(relocated, "square-check.svg"), "utf-8");
  assert.match(exported, /<svg\b/u);
  // Test the documented refusal as well as the happy path; bytes must survive.
  const refused = execute([cli, "draw", example, "-o", "square-check.svg"], 1);
  assert.match(`${refused.stdout}${refused.stderr}`, /exist|overwrite|force/iu);
  assert.equal(readFileSync(path.join(relocated, "square-check.svg"), "utf-8"), exported);
  execute([cli, "lint", "square-check.svg"]);
  const json = JSON.parse(execute([cli, "--output", "json", "draw", example]).stdout);
  assert.deepEqual(json.errors, []);
  assert.match(json.svg, /<svg\b/u);

  // Exercise the included pinned revision through the actual checker, including
  // raster proof creation and exact replay. No mocked qualification stands in.
  const checkerArgs = [
    `${engine}/scripts/style-check.ts`,
    "examples/starter/revision.json",
    "24",
    "starter-draft/candidate-a",
    "outlined",
  ];
  const packet = readFileSync(path.join(relocated, "examples/starter/AGENT.md"), "utf-8");
  assert.ok(
    packet.includes(`node --import tsx ${checkerArgs.join(" ")}`),
    "Agent packet must document the exact checker command exercised here.",
  );
  assert.doesNotMatch(packet, /\/Users\/|\/home\/|\.staging\//u);
  assert.match(packet, /craftApproved: false/u);
  const checkDirectory = path.join(relocated, "starter-draft/candidate-a");
  mkdirSync(checkDirectory, { recursive: true });
  cpSync(path.join(relocated, example), path.join(checkDirectory, "outlined.icon"));
  execute(["--import", pathToFileURL(require.resolve("tsx")).href, ...checkerArgs]);
  const checked = JSON.parse(readFileSync(path.join(checkDirectory, "checks.json"), "utf-8"));
  assert.equal(checked.exactReplay, true);
  assert.equal(checked.assessment, "structural-only");
  assert.equal(checked.craftApproved, false);
  assert.equal(checked.visualReview, "required");
  assert.notEqual(checked.structuralStatus, "failed");
  assert.ok(readFileSync(path.join(checkDirectory, "outlined.native.png")).byteLength > 0);

  // The whole bundled library is the reference set: sibling lookup must work
  // from a relocated clone with no private corpus.
  const siblingArgs = [
    `${engine}/scripts/library-siblings.ts`,
    "square-check",
    "starter-draft/siblings",
  ];
  assert.ok(
    packet.includes(`node --import tsx ${siblingArgs.join(" ")}`),
    "Agent packet must document the exact sibling lookup exercised here.",
  );
  execute(["--import", pathToFileURL(require.resolve("tsx")).href, ...siblingArgs]);
  const siblings = JSON.parse(
    readFileSync(path.join(relocated, "starter-draft/siblings/siblings.json"), "utf-8"),
  );
  assert.ok(siblings.siblings.some((s) => s.name === "circle-check"));
  assert.ok(!siblings.siblings.some((s) => s.name === "square-check"));
  assert.ok(readFileSync(path.join(relocated, "starter-draft/siblings/siblings.png")).byteLength > 0);
  console.log(
    "Public onboarding smoke passed: relocated example draw/lint/JSON, overwrite refusal, agent packet checker, pinned replay, native proof and library sibling lookup; no corpus, credentials or agent dispatch. Visual review remains required.",
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

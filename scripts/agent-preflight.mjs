#!/usr/bin/env node

/** Exercise the production command sandbox without login or model dispatch. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { prepareLocalRuntime } from "../packages/iconsmith/scripts/local-runtime.ts";

const { values } = parseArgs({
  options: {
    codex: { type: "string", default: "codex" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`Usage: npm run check:agent -- [--codex <executable>]

Tests the same filesystem and network restrictions used by generation.
Uses Codex from PATH by default. No login, API key or model call is needed.
Run under the Node installation you intend to use for generation.`);
} else {
  const temporary = mkdtempSync(path.join(tmpdir(), "iconsmith-agent-preflight-"));
  const home = path.join(temporary, "home");
  const runtime = path.join(temporary, "runtime");
  mkdirSync(home);
  mkdirSync(path.join(home, ".codex"));
  mkdirSync(runtime);
  try {
    const env = {
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: path.join(home, ".codex"),
      XDG_CONFIG_HOME: path.join(home, ".config"),
      PATH: process.env.PATH ?? "",
      NO_COLOR: "1",
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    };
    await prepareLocalRuntime(runtime, values.codex, env);
    const receipt = JSON.parse(readFileSync(path.join(runtime, "runtime.json"), "utf-8"));
    console.log(
      JSON.stringify(
        {
          status: "passed",
          node: process.execPath,
          nodeVersion: process.version,
          codex: values.codex,
          evidence: receipt.evidence,
          scope: receipt.scope,
          agentDispatch: false,
          authenticationChecked: false,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      `Agent sandbox preflight failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(`Node: ${process.execPath} (${process.version}); Codex: ${values.codex}`);
    try {
      const receipt = JSON.parse(
        readFileSync(path.join(runtime, "runtime-preflight.json"), "utf-8"),
      );
      console.error(JSON.stringify(receipt, null, 2));
    } catch {
      // Bundling or dependency resolution can fail before a sandbox receipt.
    }
    console.error(
      "Check that Codex is on PATH (or pass --codex), and that its sandbox supports the production restrictions on this OS. Try an official Node 24 binary if a linked library was denied. No authentication or model call was attempted; generation remains blocked until this check passes.",
    );
    process.exitCode = 1;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

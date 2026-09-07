import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { expect, it, vi } from "vitest";

import { runOwnedProcess } from "./local-process.js";

it("settles a missing executable without waiting for its timeout", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  try {
    const startedAt = Date.now();
    const result = await runOwnedProcess({
      args: [],
      command: path.join(cwd, "does-not-exist"),
      cwd,
      env: process.env,
      maxBuffer: 1024,
      timeoutMs: 5000,
    });
    expect(result).toMatchObject({ code: "spawn-error", killed: false });
    expect(result.stderr).toContain("ENOENT");
    expect(Date.now() - startedAt).toBeLessThan(1000);
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("tracks a detached TERM-ignoring descendant before it can write", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  const marker = path.join(cwd, "late.txt");
  try {
    const source = `
      const { spawn } = require("node:child_process");
      spawn(process.execPath, ["-e", ${JSON.stringify(`process.on("SIGTERM", () => {}); setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "late"), 3000)`)}], { detached: true, stdio: "ignore" }).unref();
      setInterval(() => {}, 1000);
    `;
    const result = await runOwnedProcess({
      args: ["-e", source],
      command: process.execPath,
      cwd,
      env: process.env,
      maxBuffer: 1024,
      pollMs: 5,
      termGraceMs: 500,
      timeoutMs: 2500,
    });
    expect(result).toMatchObject({ code: null, killed: true });
    await sleep(3100);
    expect(existsSync(marker)).toBe(false);
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
}, 10_000);

it("kills the owner when process inspection fails after it is stopped", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  const marker = path.join(cwd, "inspection-failure.txt");
  const fakePs = path.join(cwd, "ps");
  const originalPath = process.env.PATH;
  try {
    writeFileSync(fakePs, "#!/bin/sh\nexit 1\n");
    chmodSync(fakePs, 0o755);
    process.env.PATH = cwd;
    const result = await runOwnedProcess({
      args: [
        "-e",
        `console.log(process.pid); setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "late"), 800); setInterval(() => {}, 1000)`,
      ],
      command: process.execPath,
      cwd,
      env: process.env,
      maxBuffer: 1024,
      pollMs: 5,
      termGraceMs: 200,
      timeoutMs: 700,
    });
    expect(result).toMatchObject({
      code: "quiescence-unproven",
      killed: true,
      quiescent: false,
    });
    await sleep(850);
    const ownerPid = Number(result.stdout.trim());
    expect(Number.isInteger(ownerPid) && ownerPid > 0).toBe(true);
    expect(() => process.kill(ownerPid, 0)).toThrow();
    expect(existsSync(marker)).toBe(false);
  } finally {
    process.env.PATH = originalPath;
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("does not describe an already-reparented double fork as whole-tree quiescence", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  const marker = path.join(cwd, "double-fork.txt");
  try {
    const writer = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "escaped"), 300)`;
    const intermediate = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(writer)}], { detached: true, stdio: "ignore" }).unref()`;
    const source = `const { spawn } = require("node:child_process"); const child = spawn(process.execPath, ["-e", ${JSON.stringify(intermediate)}], { detached: true, stdio: "ignore" }); child.on("exit", () => process.exit(0))`;
    const result = await runOwnedProcess({
      args: ["-e", source],
      command: process.execPath,
      cwd,
      env: process.env,
      maxBuffer: 1024,
      pollMs: 1000,
      timeoutMs: 1500,
    });
    expect(result.quiescenceScope).toBe(
      "process-group-and-observed-descendants"
    );
    await sleep(450);
    expect(existsSync(marker)).toBe(true);
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("freezes the owner before teardown can spawn a detached writer", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  const marker = path.join(cwd, "teardown-race.txt");
  try {
    const writer = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(Date.now())), 100)`;
    const source = `
      const { spawn } = require("node:child_process");
      process.on("SIGTERM", () => {
        spawn(process.execPath, ["-e", ${JSON.stringify(writer)}], { detached: true, stdio: "ignore" }).unref();
        process.exit(0);
      });
      setInterval(() => {}, 1000);
    `;
    const startedAt = Date.now();
    const result = await runOwnedProcess({
      args: ["-e", source],
      command: process.execPath,
      cwd,
      env: process.env,
      maxBuffer: 1024,
      pollMs: 5,
      termGraceMs: 500,
      timeoutMs: 2500,
    });
    expect(Date.now()).toBeGreaterThan(startedAt);
    expect(result).toMatchObject({ code: null, killed: true, quiescent: true });
    await sleep(250);
    expect(existsSync(marker)).toBe(false);
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("returns stable output once for a normally completed process", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  try {
    const result = await runOwnedProcess({
      args: ["-e", 'process.stdout.write("ok")'],
      command: process.execPath,
      cwd,
      env: process.env,
      maxBuffer: 1024,
      timeoutMs: 1000,
    });
    expect(result).toEqual({
      code: 0,
      killed: false,
      quiescenceScope: "process-group-and-observed-descendants",
      quiescent: true,
      stderr: "",
      stdout: "ok",
    });
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("reaps a delayed writer even when its owner exits normally", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  const marker = path.join(cwd, "orphan.txt");
  try {
    const source = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(`setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "late"), 150)`)}], { stdio: "ignore" }).unref()`;
    const result = await runOwnedProcess({
      args: ["-e", source],
      command: process.execPath,
      cwd,
      env: process.env,
      maxBuffer: 1024,
      termGraceMs: 300,
      timeoutMs: 1000,
    });
    expect(result.code).toBe(0);
    await sleep(220);
    expect(existsSync(marker)).toBe(false);
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("treats a descendant disappearing during signalling as absent", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  const originalKill = process.kill.bind(process);
  let simulatedRace = false;
  const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    const result = originalKill(pid, signal);
    if (!simulatedRace && pid > 0 && signal === "SIGTERM") {
      simulatedRace = true;
      const error = new Error("kill ESRCH") as NodeJS.ErrnoException;
      error.code = "ESRCH";
      throw error;
    }
    return result;
  });
  try {
    const source = `
      require("node:child_process")
        .spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
        .unref();
      setTimeout(() => {}, 200);
    `;
    const result = await runOwnedProcess({
      args: ["-e", source],
      command: process.execPath,
      cwd,
      env: process.env,
      maxBuffer: 1024,
      pollMs: 5,
      timeoutMs: 1000,
    });
    expect(simulatedRace).toBe(true);
    expect(result).toMatchObject({ code: 0, killed: false, quiescent: true });
  } finally {
    kill.mockRestore();
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("continues cleanup after a non-ESRCH process-group signal failure", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  const originalKill = process.kill.bind(process);
  let simulatedFailure = false;
  const attemptedSignals: [number, string | number | undefined][] = [];
  const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    attemptedSignals.push([pid, signal]);
    if (!simulatedFailure && pid < 0 && signal === "SIGTERM") {
      simulatedFailure = true;
      const error = new Error("kill EACCES") as NodeJS.ErrnoException;
      error.code = "EACCES";
      throw error;
    }
    return originalKill(pid, signal);
  });
  try {
    const source = `
      require("node:child_process")
        .spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
        .unref();
      setTimeout(() => {}, 60);
    `;
    const result = await runOwnedProcess({
      args: ["-e", source],
      command: process.execPath,
      cwd,
      env: process.env,
      maxBuffer: 1024,
      pollMs: 5,
      timeoutMs: 1000,
    });
    expect(simulatedFailure).toBe(true);
    expect(result).toMatchObject({
      code: "quiescence-unproven",
      killed: true,
      quiescent: false,
    });
    expect(result.stderr).toContain("EACCES");
    expect(
      attemptedSignals.some(([pid, signal]) => pid < 0 && signal === "SIGKILL")
    ).toBe(true);
  } finally {
    kill.mockRestore();
    rmSync(cwd, { force: true, recursive: true });
  }
});

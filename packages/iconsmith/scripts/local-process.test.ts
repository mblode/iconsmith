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

import {
  ownedSignalTargetsAfterObservationForTest,
  ownedSignalTargetsAfterSnapshotsForTest,
  ownedSignalTargetsForTest,
  runOwnedProcess,
} from "./local-process.js";

it("delivers complete stdout records in order before settlement", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  const lines: string[] = [];
  try {
    const result = await runOwnedProcess({
      args: [
        "-e",
        `process.stdout.write("one\\npar"); setTimeout(() => process.stdout.write("tial\\ntwo\\n"), 20)`,
      ],
      command: process.execPath,
      cwd,
      env: process.env,
      maxBuffer: 1024,
      onStdoutLine: async (line) => {
        await sleep(5);
        lines.push(line);
      },
      timeoutMs: 1000,
    });
    expect(lines).toEqual(["one", "partial", "two"]);
    expect(result).toMatchObject({ code: 0, quiescent: true });
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("decodes a multibyte terminal record split across stdout chunks", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  const lines: string[] = [];
  try {
    const source = `
      const bytes = Buffer.from("final 💡\\n");
      process.stdout.write(bytes.subarray(0, 8));
      setTimeout(() => process.stdout.write(bytes.subarray(8)), 20);
    `;
    const result = await runOwnedProcess({
      args: ["-e", source],
      command: process.execPath,
      cwd,
      env: process.env,
      maxBuffer: 1024,
      onStdoutLine: (line) => {
        lines.push(line);
      },
      timeoutMs: 1000,
    });
    expect(lines).toEqual(["final 💡"]);
    expect(result.stdout).toBe("final 💡\n");
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("drains and delivers a final record without a newline before settlement", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  const lines: string[] = [];
  try {
    const result = await runOwnedProcess({
      args: ["-e", `process.stdout.write("terminal")`],
      command: process.execPath,
      cwd,
      env: process.env,
      maxBuffer: 1024,
      onStdoutLine: (line) => {
        lines.push(line);
      },
      timeoutMs: 1000,
    });
    expect(lines).toEqual(["terminal"]);
    expect(result).toMatchObject({ code: 0, quiescent: true });
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("aborts a hung observer and refuses to claim quiescence", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  let lateEffect = false;
  try {
    const result = await runOwnedProcess({
      args: ["-e", `console.log("terminal")`],
      command: process.execPath,
      cwd,
      env: process.env,
      maxBuffer: 1024,
      onStdoutLine: async (_line, signal) => {
        await sleep(300);
        if (!signal.aborted) {
          lateEffect = true;
        }
      },
      termGraceMs: 40,
      timeoutMs: 180,
    });
    expect(result).toMatchObject({
      code: "quiescence-unproven",
      killed: true,
      quiescent: false,
    });
    await sleep(250);
    expect(lateEffect).toBe(false);
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("bounds queued complete stdout records behind a slow observer", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  try {
    const result = await runOwnedProcess({
      args: ["-e", `process.stdout.write("aaa\\nbbb\\nccc\\n")`],
      command: process.execPath,
      cwd,
      env: process.env,
      maxBuffer: 10,
      onStdoutLine: async () => {
        await sleep(20);
      },
      timeoutMs: 1000,
    });
    expect(result.code).toBe("stdout-observer-failed");
    expect(result.stderr).toContain("queue exceeded maxBuffer");
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("turns a stdout observer exception into a settled diagnostic failure", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  try {
    const result = await runOwnedProcess({
      args: ["-e", `console.log("final"); setTimeout(() => {}, 30)`],
      command: process.execPath,
      cwd,
      env: process.env,
      maxBuffer: 1024,
      onStdoutLine: () => {
        throw new Error("trigger fsync failed");
      },
      timeoutMs: 1000,
    });
    expect(result).toMatchObject({
      code: "stdout-observer-failed",
      killed: true,
      quiescent: true,
    });
    expect(result.stderr).toContain("trigger fsync failed");
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("keeps the same process identity when it changes process group", () => {
  const identity = {
    pid: 41,
    startToken: "Tue Sep 8 15:00:00 2026",
    uid: 501,
  };
  expect(
    ownedSignalTargetsForTest(
      [identity],
      [{ ...identity, pgid: 41, ppid: 1, state: "S" }]
    )
  ).toEqual([41]);
});

it("does not admit a reused process group without a live owned anchor", () => {
  expect(
    ownedSignalTargetsAfterObservationForTest(
      40,
      [],
      [
        {
          pgid: 40,
          pid: 900,
          ppid: 1,
          startToken: "Tue Sep 8 15:04:00 2026",
          state: "S",
          uid: 0,
        },
      ]
    )
  ).toEqual([]);
});

it("does not target a reused PID with a different start identity or owner", () => {
  const observed = [
    {
      pgid: 40,
      pid: 41,
      startToken: "Tue Sep 8 15:00:00 2026",
      uid: 501,
    },
  ];
  expect(
    ownedSignalTargetsForTest(observed, [
      {
        pgid: 900,
        pid: 41,
        ppid: 1,
        startToken: "Tue Sep 8 15:04:00 2026",
        state: "S",
        uid: 0,
      },
    ])
  ).toEqual([]);
});

it("never revives an identity after one process-table snapshot proves it absent", () => {
  const identity = {
    pgid: 40,
    pid: 41,
    startToken: "Tue Sep 8 15:00:00 2026",
    uid: 501,
  };
  const matchingRow = { ...identity, ppid: 1, state: "S" };
  expect(
    ownedSignalTargetsAfterSnapshotsForTest(identity, [
      [matchingRow],
      [],
      [matchingRow],
    ])
  ).toEqual([]);
});

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

it("reaps an observed delayed writer even when its owner exits normally", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-owned-process-"));
  const marker = path.join(cwd, "orphan.txt");
  try {
    const source = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(`setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "late"), 150)`)}], { stdio: "ignore" }).unref(); setTimeout(() => {}, 80)`;
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
    if (!simulatedRace && pid > 0 && signal === "SIGSTOP") {
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
      // Keep the owner alive until cleanup, even if a busy runner delays polling.
      setInterval(() => {}, 1000);
    `;
    const result = await runOwnedProcess({
      args: ["-e", source],
      command: process.execPath,
      cwd,
      env: process.env,
      maxBuffer: 1024,
      pollMs: 20,
      termGraceMs: 2000,
      timeoutMs: 6000,
    });
    expect(simulatedFailure, JSON.stringify({ attemptedSignals, result })).toBe(
      true
    );
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
}, 10_000);

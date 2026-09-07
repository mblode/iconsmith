import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import {
  dockerExecutor,
  runContainerProcess,
} from "./local-container-process.js";
import type {
  DockerCommandRequest,
  DockerExecutor,
} from "./local-container-process.js";
import type { ProcessResult } from "./local-process.js";

const ID = "a".repeat(64);
const IMAGE = `reviewer@sha256:${"b".repeat(64)}`;
const result = (overrides: Partial<ProcessResult> = {}): ProcessResult => ({
  code: 0,
  killed: false,
  stderr: "",
  stdout: "",
  ...overrides,
});

const scripted = (
  handler: (request: DockerCommandRequest) => ProcessResult
) => {
  let ownershipToken = "";
  return vi.fn((request: DockerCommandRequest) => {
    if (request.phase === "create") {
      const label = request.args[request.args.indexOf("--label") + 1] ?? "";
      ownershipToken = label.replace("iconsmith.owner=", "");
    }
    const response = handler(request);
    if (request.phase === "resolve-identity" && response.stdout.trim() === ID) {
      response.stdout = JSON.stringify({
        Config: { Image: IMAGE, Labels: { "iconsmith.owner": ownershipToken } },
        HostConfig: { PidMode: "" },
        Id: ID,
      });
    } else if (
      request.phase === "resolve-identity" &&
      response.stdout === "owned-host-pid"
    ) {
      response.stdout = JSON.stringify({
        Config: { Image: IMAGE, Labels: { "iconsmith.owner": ownershipToken } },
        HostConfig: { PidMode: "host" },
        Id: ID,
      });
    }
    return Promise.resolve(response);
  });
};
const containerOptions = (
  execute: DockerExecutor,
  args: readonly string[]
) => ({
  args,
  containerName: "iconsmith-test-run",
  deadlineAt: Date.now() + 10_000,
  execute,
  image: IMAGE,
  persistIdentity: vi.fn(),
});

it("preserves an argv0-sensitive command alias when invoking Docker", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-docker-alias-"));
  try {
    const target = path.join(cwd, "multiplexer");
    const alias = path.join(cwd, "docker");
    writeFileSync(target, '#!/bin/sh\nprintf "%s" "$0"\n');
    chmodSync(target, 0o755);
    symlinkSync(target, alias);
    const execute = dockerExecutor({
      command: alias,
      cwd,
      env: process.env,
      maxBuffer: 1024,
    });
    const executed = await execute({
      args: [],
      deadlineAt: Date.now() + 2000,
      phase: "create",
    });
    expect(executed).toMatchObject({ code: 0, stdout: alias });
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("captures a private container identity before start and verifies removal", async () => {
  let alive = false;
  const execute = scripted((request) => {
    if (request.phase === "create") {
      alive = true;
      expect(request.args).toContain("--cap-drop=ALL");
      expect(request.args).not.toContain("--privileged");
      expect(request.args).not.toContain("--pid=host");
      expect(
        request.args.some((arg) => arg === "--pid" || arg.startsWith("--pid="))
      ).toBe(false);
      return result({ stdout: `${ID}\n` });
    }
    if (request.phase === "start") {
      expect(request.args.at(-1)).toBe(ID);
      return result({ stdout: "artifact" });
    }
    if (request.phase === "resolve-identity") {
      return result({ stdout: ID });
    }
    if (request.phase === "remove") {
      alive = false;
    }
    if (request.phase === "verify-absent") {
      return result({ stdout: alive ? ID : "" });
    }
    return result();
  });
  const configured = containerOptions(execute, ["review", "/packet"]);
  const outcome = await runContainerProcess(configured);
  expect(execute.mock.calls.map(([request]) => request.phase)).toEqual([
    "create",
    "resolve-identity",
    "start",
    "kill",
    "remove",
    "verify-absent",
  ]);
  expect(outcome).toMatchObject({
    artifactEligible: true,
    containerAbsent: true,
    containerId: ID,
    containmentScope: "docker-private-pid-namespace",
    status: "complete",
  });
  expect(configured.persistIdentity).toHaveBeenCalledWith({
    containerId: ID,
    containerName: "iconsmith-test-run",
    image: IMAGE,
    ownershipToken: expect.any(String),
  });
});

it("accounts for a simulated double fork through container removal", async () => {
  let simulatedDescendants = 2;
  const execute = scripted((request) => {
    if (request.phase === "create") {
      return result({ stdout: ID });
    }
    if (request.phase === "resolve-identity") {
      return result({ stdout: ID });
    }
    if (request.phase === "kill" || request.phase === "remove") {
      simulatedDescendants = 0;
    }
    if (request.phase === "verify-absent") {
      return result({ stdout: simulatedDescendants ? ID : "" });
    }
    return result({ code: null, killed: true });
  });
  const outcome = await runContainerProcess(
    containerOptions(execute, ["spawn-double-fork"])
  );
  expect(outcome).toMatchObject({
    artifactEligible: false,
    containerAbsent: true,
    status: "workload-failed",
  });
  expect(simulatedDescendants).toBe(0);
});

it("fails closed when removal cannot prove the captured identity absent", async () => {
  const execute = scripted((request) => {
    if (request.phase === "create") {
      return result({ stdout: ID });
    }
    if (request.phase === "resolve-identity") {
      return result({ stdout: ID });
    }
    if (request.phase === "remove") {
      throw new Error("daemon removal failed");
    }
    if (request.phase === "verify-absent") {
      return result({ stdout: ID });
    }
    return result();
  });
  const outcome = await runContainerProcess(
    containerOptions(execute, ["review"])
  );
  expect(outcome).toMatchObject({
    artifactEligible: false,
    containerAbsent: false,
    status: "containment-unproven",
  });
  expect(outcome.reason).toContain("removal failed");
});

it("cleans up without starting when Docker create returns an ambiguous identity", async () => {
  const execute: DockerExecutor = scripted((request) =>
    request.phase === "create" || request.phase === "resolve-identity"
      ? result({ stdout: request.phase === "create" ? "short-id" : ID })
      : result()
  );
  const outcome = await runContainerProcess(
    containerOptions(execute, ["review"])
  );
  expect(
    vi.mocked(execute).mock.calls.some(([request]) => request.phase === "start")
  ).toBe(false);
  expect(outcome).toMatchObject({
    artifactEligible: false,
    containerId: ID,
    status: "workload-failed",
  });
});

it("recovers a lost create response by its predeclared name and cleans it up", async () => {
  let alive = false;
  const execute = scripted((request) => {
    if (request.phase === "create") {
      alive = true;
      throw new Error("Docker client lost create response");
    }
    if (request.phase === "resolve-identity") {
      return result({ stdout: ID });
    }
    if (request.phase === "remove") {
      alive = false;
    }
    if (request.phase === "verify-absent") {
      return result({ stdout: alive ? ID : "" });
    }
    return result();
  });
  const outcome = await runContainerProcess(
    containerOptions(execute, ["review"])
  );
  expect(outcome).toMatchObject({
    artifactEligible: false,
    containerAbsent: true,
    containerId: ID,
    status: "workload-failed",
  });
  expect(
    execute.mock.calls.some(([request]) => request.phase === "start")
  ).toBe(false);
});

it("does not clean up a name collision without the ownership label", async () => {
  const execute = scripted((request) => {
    if (request.phase === "create") {
      return result({ code: 1, stderr: "name already in use" });
    }
    if (request.phase === "resolve-identity") {
      return result({
        stdout: JSON.stringify({
          Config: {
            Image: IMAGE,
            Labels: { "iconsmith.owner": "someone-else" },
          },
          Id: ID,
        }),
      });
    }
    return result();
  });
  const outcome = await runContainerProcess(
    containerOptions(execute, ["review"])
  );
  expect(outcome).toMatchObject({
    artifactEligible: false,
    containerAbsent: false,
    containerId: null,
    status: "containment-unproven",
  });
  expect(execute.mock.calls.map(([request]) => request.phase)).toEqual([
    "create",
    "resolve-identity",
  ]);
});

it("refuses an owned container whose inspected PID mode is not private", async () => {
  const execute = scripted((request) => {
    if (request.phase === "create") {
      return result({ stdout: ID });
    }
    if (request.phase === "resolve-identity") {
      return result({ stdout: "owned-host-pid" });
    }
    return result();
  });
  const outcome = await runContainerProcess(
    containerOptions(execute, ["review"])
  );
  expect(outcome).toMatchObject({
    artifactEligible: false,
    containerId: ID,
    status: "workload-failed",
  });
  expect(
    execute.mock.calls.some(([request]) => request.phase === "start")
  ).toBe(false);
  expect(execute.mock.calls.map(([request]) => request.phase)).toContain(
    "remove"
  );
});

it("cleans up a captured container when durable identity persistence fails", async () => {
  let alive = true;
  const execute = scripted((request) => {
    if (request.phase === "create" || request.phase === "resolve-identity") {
      return result({ stdout: ID });
    }
    if (request.phase === "remove") {
      alive = false;
    }
    if (request.phase === "verify-absent") {
      return result({ stdout: alive ? ID : "" });
    }
    return result();
  });
  const configured = containerOptions(execute, ["review"]);
  configured.persistIdentity.mockImplementation(() => {
    throw new Error("receipt disk failed");
  });
  const outcome = await runContainerProcess(configured);
  expect(outcome).toMatchObject({
    artifactEligible: false,
    containerAbsent: true,
    containerId: ID,
    status: "workload-failed",
  });
  expect(outcome.reason).toContain("receipt disk failed");
  expect(
    execute.mock.calls.some(([request]) => request.phase === "start")
  ).toBe(false);
});

it("requires immutable images and real mount paths", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-container-"));
  try {
    await expect(
      runContainerProcess({
        args: [],
        containerName: "iconsmith-test-run",
        deadlineAt: Date.now() + 10_000,
        execute: scripted(() => result()),
        image: "reviewer:latest",
        mounts: [{ containerPath: "/packet", hostPath: cwd, readOnly: true }],
        persistIdentity: vi.fn(),
      })
    ).rejects.toThrow("pinned, bounded safe inputs");
    await expect(
      runContainerProcess({
        ...containerOptions(
          scripted(() => result()),
          []
        ),
        mounts: [
          { containerPath: "/packet,bad", hostPath: cwd, readOnly: true },
        ],
      })
    ).rejects.toThrow("pinned, bounded safe inputs");
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

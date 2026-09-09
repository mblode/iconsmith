import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

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
      // Process startup can be delayed by concurrent container probes in the
      // combined suite; this assertion is about preserving argv0, not latency.
      deadlineAt: Date.now() + 10_000,
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

it("captures sanitized create and inspect control evidence without environment or workload values", async () => {
  const hostRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), "iconsmith-control-evidence-"))
  );
  try {
    let ownershipToken = "";
    let alive = false;
    const stateValue = path.join(hostRoot, "private-state");
    const workloadValue = "sealed reviewer prompt";
    const execute = vi.fn((request: DockerCommandRequest) => {
      if (request.phase === "create") {
        alive = true;
        ownershipToken = String(
          request.args[request.args.indexOf("--label") + 1]
        ).replace("iconsmith.owner=", "");
        return Promise.resolve(result({ stdout: ID }));
      }
      if (request.phase === "resolve-identity") {
        return Promise.resolve(
          result({
            stdout: JSON.stringify({
              Config: {
                Env: [`CODEX_HOME=${stateValue}`],
                Image: IMAGE,
                Labels: { "iconsmith.owner": ownershipToken },
              },
              HostConfig: { PidMode: "" },
              Id: ID,
              Mounts: [{ Destination: "/state", RW: false, Source: hostRoot }],
            }),
          })
        );
      }
      if (request.phase === "remove") {
        alive = false;
      }
      if (request.phase === "verify-absent") {
        return Promise.resolve(result({ stdout: alive ? ID : "" }));
      }
      return Promise.resolve(result());
    });
    const outcome = await runContainerProcess({
      ...containerOptions(execute, ["review", workloadValue]),
      environment: { CODEX_HOME: stateValue },
      mounts: [{ containerPath: "/state", hostPath: hostRoot, readOnly: true }],
    });
    const encoded = JSON.stringify(outcome.controlEvidence);
    expect(encoded).not.toContain(stateValue);
    expect(encoded).not.toContain(workloadValue);
    expect(outcome.controlEvidence).toMatchObject({
      createRequest: {
        args: expect.arrayContaining([
          `CODEX_HOME=sha256:${createHash("sha256").update(stateValue).digest("hex")}`,
          `sha256:${createHash("sha256").update(workloadValue).digest("hex")}`,
        ]),
        phase: "create",
      },
      inspectResult: {
        code: 0,
        inspected: {
          Config: { Image: IMAGE },
          HostConfig: { PidMode: "" },
          Id: ID,
          Mounts: [{ Destination: "/state", RW: false, Source: hostRoot }],
        },
        phase: "resolve-identity",
      },
    });
    expect(encoded).not.toContain("Env");
  } finally {
    rmSync(hostRoot, { force: true, recursive: true });
  }
});

it("pins a diagnostic observer kill to the captured container and still settles", async () => {
  let ownershipToken = "";
  const phases: string[] = [];
  const execute = vi.fn(async (request: DockerCommandRequest) => {
    phases.push(request.phase);
    if (request.phase === "create") {
      const label = request.args[request.args.indexOf("--label") + 1] ?? "";
      ownershipToken = label.replace("iconsmith.owner=", "");
      return result({ stdout: ID });
    }
    if (request.phase === "resolve-identity") {
      return result({
        stdout: JSON.stringify({
          Config: {
            Image: IMAGE,
            Labels: { "iconsmith.owner": ownershipToken },
          },
          HostConfig: { PidMode: "" },
          Id: ID,
        }),
      });
    }
    if (request.phase === "start") {
      await request.onStdoutLine?.("final", new AbortController().signal);
    }
    return result();
  });
  const observed = vi.fn(
    async (_line, _signal, identity, killExactContainer) => {
      expect(identity).toMatchObject({ containerId: ID, image: IMAGE });
      await killExactContainer();
    }
  );
  const outcome = await runContainerProcess({
    ...containerOptions(execute, ["review"]),
    onStartStdoutLine: observed,
  });
  expect(phases).toEqual([
    "create",
    "resolve-identity",
    "start",
    "diagnostic-kill",
    "kill",
    "remove",
    "verify-absent",
  ]);
  expect(
    execute.mock.calls.find(
      ([request]) => request.phase === "diagnostic-kill"
    )?.[0].args
  ).toEqual(["container", "kill", ID]);
  expect(outcome.containerAbsent).toBe(true);
});

it("cleans and settles when the start stdout observer fails", async () => {
  let ownershipToken = "";
  const phases: string[] = [];
  const execute = vi.fn(async (request: DockerCommandRequest) => {
    phases.push(request.phase);
    if (request.phase === "create") {
      const label = request.args[request.args.indexOf("--label") + 1] ?? "";
      ownershipToken = label.replace("iconsmith.owner=", "");
      return result({ stdout: ID });
    }
    if (request.phase === "resolve-identity") {
      return result({
        stdout: JSON.stringify({
          Config: {
            Image: IMAGE,
            Labels: { "iconsmith.owner": ownershipToken },
          },
          HostConfig: { PidMode: "" },
          Id: ID,
        }),
      });
    }
    if (request.phase === "start") {
      await request.onStdoutLine?.("final", new AbortController().signal);
    }
    return result();
  });
  const outcome = await runContainerProcess({
    ...containerOptions(execute, ["review"]),
    onStartStdoutLine: () => {
      throw new Error("diagnostic receipt failed");
    },
  });
  expect(phases).toEqual([
    "create",
    "resolve-identity",
    "start",
    "kill",
    "remove",
    "verify-absent",
  ]);
  expect(outcome).toMatchObject({
    artifactEligible: false,
    containerAbsent: true,
    status: "workload-failed",
  });
  expect(outcome.reason).toContain("diagnostic receipt failed");
});

it("creates offline probes with Docker networking disabled", async () => {
  const execute = scripted((request) => {
    if (request.phase === "create") {
      expect(request.args).toContain("--network=none");
      expect(request.args).not.toContain("--network=bridge");
      return result({ stdout: ID });
    }
    if (request.phase === "resolve-identity") {
      return result({ stdout: ID });
    }
    return result();
  });
  const outcome = await runContainerProcess({
    ...containerOptions(execute, ["debug", "prompt-input"]),
    network: "none",
  });
  expect(outcome).toMatchObject({
    containerAbsent: true,
    status: "complete",
  });
});

it("rechecks the dispatch boundary after identity capture and before start", async () => {
  let alive = false;
  const execute = scripted((request) => {
    if (request.phase === "create") {
      alive = true;
      return result({ stdout: ID });
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
  const beforeStart = vi.fn(() => {
    throw new Error("STOP latched after create");
  });
  const outcome = await runContainerProcess({
    ...containerOptions(execute, ["review"]),
    beforeStart,
  });
  expect(beforeStart).toHaveBeenCalledWith(
    expect.objectContaining({ containerId: ID })
  );
  expect(execute.mock.calls.map(([request]) => request.phase)).not.toContain(
    "start"
  );
  expect(outcome).toMatchObject({
    artifactEligible: false,
    containerAbsent: true,
    status: "workload-failed",
  });
  expect(outcome.reason).toContain("STOP latched");
});

it("actively cancels the exact owned container and joins its STOP watcher", async () => {
  let owner = "";
  let releaseStart: ((value: ProcessResult) => void) | undefined;
  let markStarted: (() => void) | undefined;
  // oxlint-disable-next-line promise/avoid-new -- controlled attach lifecycle fixture.
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let stop = false;
  let alive = false;
  const phases: string[] = [];
  const execute = vi.fn(async (request: DockerCommandRequest) => {
    phases.push(request.phase);
    if (request.phase === "create") {
      alive = true;
      owner = String(request.args[request.args.indexOf("--label") + 1]).replace(
        "iconsmith.owner=",
        ""
      );
      return result({ stdout: ID });
    }
    if (request.phase === "resolve-identity") {
      return result({
        stdout: JSON.stringify({
          Config: { Image: IMAGE, Labels: { "iconsmith.owner": owner } },
          HostConfig: { PidMode: "" },
          Id: ID,
        }),
      });
    }
    if (request.phase === "start") {
      markStarted?.();
      // oxlint-disable-next-line promise/avoid-new -- controlled attach lifecycle fixture.
      return await new Promise<ProcessResult>((resolve) => {
        releaseStart = resolve;
      });
    }
    if (request.phase === "stop-kill") {
      expect(request.args).toEqual(["container", "kill", ID]);
      releaseStart?.(result({ code: 137 }));
    }
    if (request.phase === "remove") {
      alive = false;
    }
    if (request.phase === "verify-absent") {
      return result({ stdout: alive ? ID : "" });
    }
    return result();
  });
  const running = runContainerProcess({
    ...containerOptions(execute, ["review"]),
    observeStop: () => stop,
  });
  await started;
  stop = true;
  const outcome = await running;
  expect(phases).toEqual([
    "create",
    "resolve-identity",
    "start",
    "stop-kill",
    "kill",
    "remove",
    "verify-absent",
  ]);
  expect(outcome).toMatchObject({
    artifactEligible: false,
    cancelledByStop: true,
    containerAbsent: true,
    process: { killed: true },
    status: "workload-failed",
  });
  expect(outcome.reason).toContain("cancelled by latched STOP");
  const callCount = execute.mock.calls.length;
  await sleep(150);
  expect(execute).toHaveBeenCalledTimes(callCount);
});

it("fails closed and still kills when the active STOP observer fails", async () => {
  let owner = "";
  let releaseStart: ((value: ProcessResult) => void) | undefined;
  const execute = vi.fn(async (request: DockerCommandRequest) => {
    if (request.phase === "create") {
      owner = String(request.args[request.args.indexOf("--label") + 1]).replace(
        "iconsmith.owner=",
        ""
      );
      return result({ stdout: ID });
    }
    if (request.phase === "resolve-identity") {
      return result({
        stdout: JSON.stringify({
          Config: { Image: IMAGE, Labels: { "iconsmith.owner": owner } },
          HostConfig: { PidMode: "" },
          Id: ID,
        }),
      });
    }
    if (request.phase === "start") {
      // oxlint-disable-next-line promise/avoid-new -- controlled attach lifecycle fixture.
      return await new Promise<ProcessResult>((resolve) => {
        releaseStart = resolve;
      });
    }
    if (request.phase === "stop-kill") {
      releaseStart?.(result({ code: 137 }));
    }
    return result();
  });
  const outcome = await runContainerProcess({
    ...containerOptions(execute, ["review"]),
    observeStop: () => {
      throw new Error("STOP journal unreadable");
    },
  });
  expect(
    execute.mock.calls.filter(([request]) => request.phase === "stop-kill")
  ).toHaveLength(1);
  expect(outcome).toMatchObject({
    artifactEligible: false,
    containerAbsent: true,
    status: "workload-failed",
  });
  expect(outcome).not.toHaveProperty("cancelledByStop");
  expect(outcome.reason).toContain("STOP journal unreadable");
});

it("handles a rejected STOP kill while the attach remains pending", async () => {
  let owner = "";
  let releaseStart: ((value: ProcessResult) => void) | undefined;
  let markStarted: (() => void) | undefined;
  // oxlint-disable-next-line promise/avoid-new -- controlled attach lifecycle fixture.
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let stop = false;
  const unhandled = vi.fn();
  const onUnhandled = (reason: unknown) => unhandled(reason);
  process.on("unhandledRejection", onUnhandled);
  const execute = vi.fn(async (request: DockerCommandRequest) => {
    if (request.phase === "create") {
      owner = String(request.args[request.args.indexOf("--label") + 1]).replace(
        "iconsmith.owner=",
        ""
      );
      return result({ stdout: ID });
    }
    if (request.phase === "resolve-identity") {
      return result({
        stdout: JSON.stringify({
          Config: { Image: IMAGE, Labels: { "iconsmith.owner": owner } },
          HostConfig: { PidMode: "" },
          Id: ID,
        }),
      });
    }
    if (request.phase === "start") {
      markStarted?.();
      // oxlint-disable-next-line promise/avoid-new -- controlled attach lifecycle fixture.
      return await new Promise<ProcessResult>((resolve) => {
        releaseStart = resolve;
      });
    }
    if (request.phase === "stop-kill") {
      throw new Error("Docker refused STOP kill");
    }
    return result();
  });
  try {
    const running = runContainerProcess({
      ...containerOptions(execute, ["review"]),
      observeStop: () => stop,
    });
    await started;
    stop = true;
    await sleep(150);
    expect(
      execute.mock.calls.filter(([request]) => request.phase === "stop-kill")
    ).toHaveLength(1);
    expect(unhandled).not.toHaveBeenCalled();
    releaseStart?.(result());
    const outcome = await running;
    expect(outcome).toMatchObject({
      artifactEligible: false,
      containerAbsent: true,
      status: "workload-failed",
    });
    expect(outcome.reason).toContain("Docker refused STOP kill");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

it("joins the STOP watcher when the attached workload rejects", async () => {
  let owner = "";
  let observations = 0;
  const execute = vi.fn((request: DockerCommandRequest) => {
    if (request.phase === "create") {
      owner = String(request.args[request.args.indexOf("--label") + 1]).replace(
        "iconsmith.owner=",
        ""
      );
      return Promise.resolve(result({ stdout: ID }));
    }
    if (request.phase === "resolve-identity") {
      return Promise.resolve(
        result({
          stdout: JSON.stringify({
            Config: { Image: IMAGE, Labels: { "iconsmith.owner": owner } },
            HostConfig: { PidMode: "" },
            Id: ID,
          }),
        })
      );
    }
    if (request.phase === "start") {
      return Promise.reject(new Error("attach stream failed"));
    }
    return Promise.resolve(result());
  });
  const outcome = await runContainerProcess({
    ...containerOptions(execute, ["review"]),
    observeStop: () => {
      observations += 1;
      return false;
    },
  });
  expect(outcome).toMatchObject({
    artifactEligible: false,
    containerAbsent: true,
    status: "workload-failed",
  });
  expect(outcome.reason).toContain("attach stream failed");
  const settledObservations = observations;
  const settledCalls = execute.mock.calls.length;
  await sleep(150);
  expect(observations).toBe(settledObservations);
  expect(execute).toHaveBeenCalledTimes(settledCalls);
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

it("retains hashed inspect diagnostics when Docker fails with empty stdout", async () => {
  const stderr = "Cannot connect to the Docker daemon at the configured socket";
  const execute = scripted((request) => {
    if (request.phase === "create") {
      return result({ code: 1, stderr });
    }
    if (request.phase === "resolve-identity") {
      return result({ code: 1, stderr, stdout: "" });
    }
    return result();
  });
  const configured = containerOptions(execute, ["review"]);
  const outcome = await runContainerProcess(configured);
  const encodedEvidence = JSON.stringify(outcome.controlEvidence);

  expect(outcome).toMatchObject({
    artifactEligible: false,
    containerAbsent: false,
    containerId: null,
    controlEvidence: {
      inspectResult: {
        code: 1,
        diagnostics: {
          killed: false,
          stderrBytes: Buffer.byteLength(stderr),
          stderrSha256: `sha256:${createHash("sha256").update(stderr).digest("hex")}`,
          stdoutBytes: 0,
          stdoutSha256: `sha256:${createHash("sha256").update("").digest("hex")}`,
        },
        phase: "resolve-identity",
      },
    },
    process: null,
    status: "containment-unproven",
  });
  expect(outcome.reason).toContain("Docker inspect command failed (code=1");
  expect(outcome.reason).not.toContain("SyntaxError");
  expect(encodedEvidence).not.toContain(stderr);
  expect(configured.persistIdentity).not.toHaveBeenCalled();
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
        environment: { OPENAI_API_KEY: "secret" },
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

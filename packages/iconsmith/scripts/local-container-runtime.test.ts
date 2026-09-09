import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import type { DockerCommandRequest } from "./local-container-process.js";
import {
  containerPathFor,
  runNativeContainerCommand,
  validateCodexContainerAssets,
  validateHostVisibleContainerState,
  validateNativeCliContainerConfig,
} from "./local-container-runtime.js";
import type {
  SameContainerAccessBinding,
  SameContainerAccessProbePlan,
} from "./local-container-runtime.js";
import type { ProcessResult } from "./local-process.js";

const ID = "a".repeat(64);
const IMAGE = `iconsmith-native@sha256:${"b".repeat(64)}`;
const processResult = (
  overrides: Partial<ProcessResult> = {}
): ProcessResult => ({
  code: 0,
  killed: false,
  stderr: "",
  stdout: "",
  ...overrides,
});
const verifiedFile = (hostPath: string, containerPath: string) => ({
  containerPath,
  hostPath,
  sha256: createHash("sha256").update(readFileSync(hostPath)).digest("hex"),
});

it("binds the CLI bytes and host-visible Codex state", () => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-cli-identity-"));
  const command = path.join(root, "codex");
  const certificateBundle = path.join(root, "ca-certificates.crt");
  const codeModeHost = path.join(root, "codex-code-mode-host");
  const state = path.join(root, "state");
  writeFileSync(command, "frozen-codex");
  writeFileSync(
    certificateBundle,
    "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n"
  );
  writeFileSync(codeModeHost, "frozen-code-mode-host");
  chmodSync(codeModeHost, 0o755);
  const config = {
    codexAssets: {
      certificateBundle: verifiedFile(
        certificateBundle,
        "/etc/ssl/certs/ca-certificates.crt"
      ),
      cliVersion: "0.154.0-alpha.3",
      codeModeHost: verifiedFile(codeModeHost, "/runtime/codex-code-mode-host"),
    },
    dockerCommand: "/usr/local/bin/docker",
    environment: { CODEX_HOME: state },
    image: IMAGE,
    namePrefix: "iconsmith-codex",
    nativeCliVersion: "0.154.0-alpha.3",
    nativeCommand: "/runtime/codex",
    nativeExecutableHostPath: command,
    nativeExecutableSha256: createHash("sha256")
      .update("frozen-codex")
      .digest("hex"),
    persistIdentity: vi.fn(),
    persistSettlement: vi.fn(),
    stateMounts: [
      {
        containerPath: "/runtime/codex",
        hostPath: command,
        readOnly: true,
      },
      {
        containerPath: state,
        hostPath: state,
        readOnly: false,
      },
      {
        containerPath: "/etc/ssl/certs/ca-certificates.crt",
        hostPath: certificateBundle,
        readOnly: true,
      },
      {
        containerPath: "/runtime/codex-code-mode-host",
        hostPath: codeModeHost,
        readOnly: true,
      },
    ],
  };
  try {
    expect(() => validateNativeCliContainerConfig(config)).not.toThrow();
    expect(() => validateCodexContainerAssets(config)).not.toThrow();
    expect(() =>
      validateHostVisibleContainerState(config, "CODEX_HOME")
    ).not.toThrow();
    expect(() =>
      validateNativeCliContainerConfig({
        ...config,
        nativeExecutableSha256: "0".repeat(64),
      })
    ).toThrow("identity");
    expect(() =>
      validateCodexContainerAssets({
        ...config,
        codexAssets: {
          ...config.codexAssets,
          cliVersion: "different-version",
        },
      })
    ).toThrow("version-bound");
    expect(() =>
      validateCodexContainerAssets({
        ...config,
        codexAssets: {
          ...config.codexAssets,
          codeModeHost: {
            ...config.codexAssets.codeModeHost,
            sha256: "0".repeat(64),
          },
        },
      })
    ).toThrow("read-only mount");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

it("maps only paths inside the declared run directory", () => {
  expect(containerPathFor("/host/run", "/host/run/schema.json")).toBe(
    "/host/run/schema.json"
  );
  expect(containerPathFor("/host/run", "--json")).toBe("--json");
  expect(() => containerPathFor("/host/run", "/host/secret")).toThrow(
    "escaped"
  );
});

it("runs one exact command with the original deadline and declared mounts", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-container-runtime-"));
  const authFile = path.join(cwd, "auth.json");
  writeFileSync(authFile, "{}");
  const deadlines: number[] = [];
  let owner = "";
  const diagnosticObserver = { observe: vi.fn(async () => {}) };
  const execute = vi.fn(async (request: DockerCommandRequest) => {
    deadlines.push(request.deadlineAt);
    if (request.phase === "create") {
      owner = String(request.args[request.args.indexOf("--label") + 1]).replace(
        "iconsmith.owner=",
        ""
      );
      expect(request.args).toEqual(
        expect.arrayContaining([
          "--env",
          "CODEX_HOME=/state/codex",
          `type=bind,src=${realpathSync(authFile)},dst=/state/codex/auth.json,readonly`,
          `type=bind,src=${realpathSync(cwd)},dst=${cwd}`,
          "/opt/codex",
          "--output-schema",
          path.join(cwd, "schema.json"),
        ])
      );
      expect(request.args.slice(request.args.indexOf(IMAGE) + 1)).toEqual([
        "/opt/codex",
        "--output-schema",
        path.join(cwd, "schema.json"),
      ]);
      return processResult({ stdout: ID });
    }
    if (request.phase === "resolve-identity") {
      return processResult({
        quiescenceScope: "process-group-and-observed-descendants",
        quiescent: true,
        stdout: JSON.stringify({
          Config: { Image: IMAGE, Labels: { "iconsmith.owner": owner } },
          HostConfig: { PidMode: "" },
          Id: ID,
        }),
      });
    }
    if (request.phase === "start") {
      await request.onStdoutLine?.("answer", new AbortController().signal);
    }
    return processResult({ stdout: request.phase === "start" ? "answer" : "" });
  });
  const deadlineAt = Date.now() + 20_000;
  const persistSettlement = vi.fn();
  const observeStop = vi.fn(() => false);
  try {
    const result = await runNativeContainerCommand(
      {
        diagnosticFinalizationObserver: diagnosticObserver,
        dockerCommand: "/usr/local/bin/docker",
        environment: { CODEX_HOME: "/state/codex" },
        execute,
        image: IMAGE,
        namePrefix: "iconsmith-codex",
        observeStop,
        persistIdentity: vi.fn(),
        persistSettlement,
        stateMounts: [
          {
            containerPath: "/state/codex/auth.json",
            hostPath: authFile,
            readOnly: true,
          },
        ],
      },
      {
        args: ["--output-schema", path.join(cwd, "schema.json")],
        command: "/opt/codex",
        cwd,
        deadlineAt,
        maxBuffer: 1024,
      }
    );
    expect(result).toMatchObject({
      code: 0,
      stdout: "answer",
    });
    expect(diagnosticObserver.observe).toHaveBeenCalledWith(
      "answer",
      expect.any(AbortSignal),
      expect.objectContaining({ containerId: ID, image: IMAGE }),
      expect.any(Function)
    );
    expect(persistSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ containerAbsent: true, status: "complete" })
    );
    expect(observeStop).toHaveBeenCalled();
    expect(Math.max(...deadlines)).toBe(deadlineAt);
    expect(deadlines).toContain(deadlineAt - 5000);
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

const accessPlan = (cwd: string): SameContainerAccessProbePlan => {
  const partial = {
    ackContainerPath: path.join(cwd, ".access-ack"),
    ackHostPath: path.join(cwd, ".access-ack"),
    ackSha256: "",
    allowed: { containerPath: "/runtime/codex", sha256: "c".repeat(64) },
    forbidden: [
      { containerPath: "/private/host", pathClass: "forbidden-0-direct" },
      {
        containerPath: "/proc/1/root/private/host",
        pathClass: "forbidden-1-proc-root",
      },
      {
        containerPath: "/host_mnt/private/host",
        pathClass: "forbidden-2-host-mnt",
      },
      {
        containerPath: "/run/host/private/host",
        pathClass: "forbidden-3-run-host",
      },
    ],
    kind: "same-container-access-probe-plan-v1" as const,
    nonce: "nonce-123",
    nonceSha256: createHash("sha256").update("nonce-123").digest("hex"),
    stageId: "06-reviewer-0",
  };
  partial.ackSha256 = createHash("sha256")
    .update(
      `iconsmith-access-ack-v1:${partial.stageId}:${partial.nonceSha256}\n`
    )
    .digest("hex");
  return {
    ...partial,
    planSha256: createHash("sha256")
      .update(JSON.stringify(partial))
      .digest("hex"),
  };
};

const accessPreamble = (plan: SameContainerAccessProbePlan) =>
  [
    "ICONSMITH_ACCESS_V1",
    plan.planSha256,
    plan.stageId,
    plan.nonce,
    plan.nonceSha256,
    `allowed-native-executable:readable:${plan.allowed.sha256}`,
    ...plan.forbidden.map(({ pathClass }) => `${pathClass}:missing`),
  ].join("|");

it("gates one native exec on exact controls, sealed observation and ACK", async () => {
  const cwd = realpathSync(
    mkdtempSync(path.join(tmpdir(), "iconsmith-access-runtime-"))
  );
  const authFile = path.join(cwd, "auth.json");
  const receiptFile = path.join(cwd, "observation.json");
  const securityFile = path.join(cwd, "security.json");
  writeFileSync(authFile, "{}");
  const plan = accessPlan(cwd);
  const preamble = accessPreamble(plan);
  let emittedPreamble = preamble;
  let owner = "";
  let binding: SameContainerAccessBinding | undefined;
  let probeScriptChecked = false;
  const persisted = vi.fn();
  const execute = vi.fn(async (request: DockerCommandRequest) => {
    if (request.phase === "create") {
      owner = String(request.args[request.args.indexOf("--label") + 1]).replace(
        "iconsmith.owner=",
        ""
      );
      expect(request.args).toContain("/bin/sh");
      expect(request.args).toContain("/runtime/codex");
      const shellIndex = request.args.indexOf("/bin/sh");
      const script = request.args[shellIndex + 2];
      expect(script).toContain(
        'timeout 1 dd if="$candidate" of=/dev/null bs=1 count=1 2>/dev/null'
      );
      if (probeScriptChecked) {
        return processResult({ stdout: ID });
      }
      probeScriptChecked = true;
      const fixtures = path.join(cwd, "probe-fixtures");
      const directory = path.join(fixtures, "directory");
      const fifo = path.join(fixtures, "fifo");
      const link = path.join(fixtures, "link");
      const readable = path.join(fixtures, "readable");
      const missing = path.join(fixtures, "missing");
      const probeAck = path.join(fixtures, "ack");
      const fakeBin = path.join(fixtures, "fake-bin");
      mkdirSync(directory, { recursive: true });
      mkdirSync(fakeBin);
      writeFileSync(
        path.join(fakeBin, "timeout"),
        '#!/bin/sh\nshift\nexec "$@"\n'
      );
      chmodSync(path.join(fakeBin, "timeout"), 0o755);
      writeFileSync(readable, "must-not-appear-in-probe-output");
      symlinkSync(readable, link);
      execFileSync("mkfifo", [fifo]);
      const allowedHash = createHash("sha256")
        .update(readFileSync(readable))
        .digest("hex");
      const ackValue = "bounded-ack";
      writeFileSync(probeAck, `${ackValue}\n`);
      const classified = execFileSync(
        "/bin/sh",
        [
          "-c",
          String(script),
          "probe-test",
          "plan",
          "stage",
          "nonce",
          "nonce-hash",
          readable,
          allowedHash,
          probeAck,
          ackValue,
          "4",
          "forbidden-0-direct",
          missing,
          "forbidden-1-proc-root",
          directory,
          "forbidden-2-host-mnt",
          fifo,
          "forbidden-3-run-host",
          link,
          "/usr/bin/true",
        ],
        {
          encoding: "utf-8",
          env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
          timeout: 5000,
        }
      );
      expect(classified).toBe(
        `ICONSMITH_ACCESS_V1|plan|stage|nonce|nonce-hash|allowed-native-executable:readable:${allowedHash}|forbidden-0-direct:missing|forbidden-1-proc-root:unsupported-type|forbidden-2-host-mnt:unsupported-type|forbidden-3-run-host:unsupported-type\n`
      );
      expect(classified).not.toContain("must-not-appear");

      const forcedFailure = path.join(fixtures, "forced-failure");
      writeFileSync(forcedFailure, "also-secret");
      for (const exitCode of [1, 124, 127]) {
        writeFileSync(
          path.join(fakeBin, "timeout"),
          `#!/bin/sh\nexit ${exitCode}\n`
        );
        chmodSync(path.join(fakeBin, "timeout"), 0o755);
        writeFileSync(probeAck, `${ackValue}\n`);
        const failed = execFileSync(
          "/bin/sh",
          [
            "-c",
            String(script),
            "probe-test",
            "plan",
            "stage",
            "nonce",
            "nonce-hash",
            readable,
            allowedHash,
            probeAck,
            ackValue,
            "1",
            "forbidden-0-direct",
            forcedFailure,
            "/usr/bin/true",
          ],
          {
            encoding: "utf-8",
            env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
            timeout: 5000,
          }
        );
        expect(failed).toContain("forbidden-0-direct:read-failed");
        expect(failed).not.toContain("also-secret");
      }
      return processResult({ stdout: ID });
    }
    if (request.phase === "resolve-identity") {
      return processResult({
        quiescenceScope: "process-group-and-observed-descendants",
        quiescent: true,
        stdout: JSON.stringify({
          Config: { Image: IMAGE, Labels: { "iconsmith.owner": owner } },
          HostConfig: {
            CapDrop: ["ALL"],
            Devices: [],
            NetworkMode: "bridge",
            PidMode: "",
            Privileged: false,
            ReadonlyRootfs: true,
            SecurityOpt: ["no-new-privileges"],
          },
          Id: ID,
          Mounts: [
            { Destination: cwd, RW: true, Source: cwd, Type: "bind" },
            {
              Destination: "/state/auth.json",
              RW: false,
              Source: realpathSync(authFile),
              Type: "bind",
            },
          ],
        }),
      });
    }
    if (request.phase === "start") {
      await request.onStdoutLine?.(
        emittedPreamble,
        new AbortController().signal
      );
      expect(readFileSync(plan.ackHostPath, "utf-8")).toBe(
        `iconsmith-access-ack-v1:${plan.stageId}:${plan.nonceSha256}\n`
      );
      rmSync(plan.ackHostPath);
      return processResult({
        stdout: `${emittedPreamble}\n{"type":"result"}\n`,
      });
    }
    return processResult();
  });
  try {
    const result = await runNativeContainerCommand(
      {
        dockerCommand: "/usr/bin/docker",
        execute,
        image: IMAGE,
        namePrefix: "iconsmith-access",
        persistAccessBinding: (value) => {
          binding = value;
        },
        persistIdentity: vi.fn(),
        persistSettlement: persisted,
        sameContainerAccessProbe: {
          observe: (observation, _identity, security) => {
            writeFileSync(receiptFile, JSON.stringify(observation));
            writeFileSync(securityFile, security.rawInspect);
            return Promise.resolve({
              receiptFile,
              receiptSha256: createHash("sha256")
                .update(readFileSync(receiptFile))
                .digest("hex"),
              securityInspectFile: securityFile,
              securityInspectSha256: security.sha256,
            });
          },
          plan,
        },
        stateMounts: [
          {
            containerPath: "/state/auth.json",
            hostPath: authFile,
            readOnly: true,
          },
        ],
      },
      {
        args: ["review", "--image", path.join(cwd, "proof.png")],
        command: "/runtime/codex",
        cwd,
        deadlineAt: Date.now() + 30_000,
        maxBuffer: 4096,
      }
    );
    expect(result.stdout).toBe('{"type":"result"}\n');
    expect(binding).toMatchObject({
      containerId: ID,
      kind: "same-container-access-binding-v1",
      planSha256: plan.planSha256,
      securityInspectFile: securityFile,
    });
    expect(
      String(persisted.mock.calls[0]?.[0].process.stdout).startsWith(preamble)
    ).toBe(true);
    expect(existsSync(plan.ackHostPath)).toBe(false);
    const rejectedObserver = vi.fn();
    emittedPreamble = preamble.replace(":missing", ":read-failed");
    await expect(
      runNativeContainerCommand(
        {
          dockerCommand: "/usr/bin/docker",
          execute,
          image: IMAGE,
          namePrefix: "iconsmith-access",
          persistIdentity: vi.fn(),
          persistSettlement: vi.fn(),
          sameContainerAccessProbe: { observe: rejectedObserver, plan },
          stateMounts: [
            {
              containerPath: "/state/auth.json",
              hostPath: authFile,
              readOnly: true,
            },
          ],
        },
        {
          args: [],
          command: "/runtime/codex",
          cwd,
          deadlineAt: Date.now() + 30_000,
          maxBuffer: 4096,
        }
      )
    ).rejects.toThrow("observations were not exact");
    expect(rejectedObserver).not.toHaveBeenCalled();
    expect(existsSync(plan.ackHostPath)).toBe(false);
    emittedPreamble = preamble;
    await expect(
      runNativeContainerCommand(
        {
          dockerCommand: "/usr/bin/docker",
          execute,
          image: IMAGE,
          namePrefix: "iconsmith-access",
          persistIdentity: vi.fn(),
          persistSettlement: vi.fn(),
          sameContainerAccessProbe: {
            observe: () =>
              Promise.resolve({
                receiptFile: path.join(cwd, "missing-receipt.json"),
                receiptSha256: "0".repeat(64),
                securityInspectFile: path.join(cwd, "missing-security.json"),
                securityInspectSha256: "0".repeat(64),
              }),
            plan,
          },
          stateMounts: [
            {
              containerPath: "/state/auth.json",
              hostPath: authFile,
              readOnly: true,
            },
          ],
        },
        {
          args: [],
          command: "/runtime/codex",
          cwd,
          deadlineAt: Date.now() + 30_000,
          maxBuffer: 4096,
        }
      )
    ).rejects.toThrow("collector receipt");
    expect(existsSync(plan.ackHostPath)).toBe(false);
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("rejects a forged access-plan hash before Docker create", async () => {
  const cwd = realpathSync(
    mkdtempSync(path.join(tmpdir(), "iconsmith-access-plan-"))
  );
  const authFile = path.join(cwd, "auth.json");
  writeFileSync(authFile, "{}");
  const plan = { ...accessPlan(cwd), planSha256: "0".repeat(64) };
  const execute = vi.fn();
  try {
    await expect(
      runNativeContainerCommand(
        {
          dockerCommand: "/usr/bin/docker",
          execute,
          image: IMAGE,
          namePrefix: "iconsmith-access",
          persistIdentity: vi.fn(),
          persistSettlement: vi.fn(),
          sameContainerAccessProbe: { observe: vi.fn(), plan },
          stateMounts: [
            {
              containerPath: "/state/auth.json",
              hostPath: authFile,
              readOnly: true,
            },
          ],
        },
        {
          args: [],
          command: "/runtime/codex",
          cwd,
          deadlineAt: Date.now() + 30_000,
          maxBuffer: 4096,
        }
      )
    ).rejects.toThrow("plan is invalid");
    expect(execute).not.toHaveBeenCalled();
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("refuses invalid Docker controls before container start", async () => {
  const cwd = realpathSync(
    mkdtempSync(path.join(tmpdir(), "iconsmith-access-controls-"))
  );
  const authFile = path.join(cwd, "auth.json");
  writeFileSync(authFile, "{}");
  const plan = accessPlan(cwd);
  let owner = "";
  let starts = 0;
  const execute = vi.fn((request: DockerCommandRequest) => {
    if (request.phase === "create") {
      owner = String(request.args[request.args.indexOf("--label") + 1]).replace(
        "iconsmith.owner=",
        ""
      );
      return Promise.resolve(processResult({ stdout: ID }));
    }
    if (request.phase === "resolve-identity") {
      return Promise.resolve(
        processResult({
          quiescenceScope: "process-group-and-observed-descendants",
          quiescent: true,
          stdout: JSON.stringify({
            Config: { Image: IMAGE, Labels: { "iconsmith.owner": owner } },
            HostConfig: {
              CapDrop: ["ALL"],
              Devices: [],
              NetworkMode: "bridge",
              PidMode: "",
              Privileged: true,
              ReadonlyRootfs: true,
              SecurityOpt: ["no-new-privileges"],
            },
            Id: ID,
            Mounts: [
              { Destination: cwd, RW: true, Source: cwd, Type: "bind" },
              {
                Destination: "/state/auth.json",
                RW: false,
                Source: authFile,
                Type: "bind",
              },
            ],
          }),
        })
      );
    }
    if (request.phase === "start") {
      starts += 1;
    }
    return Promise.resolve(processResult());
  });
  try {
    await expect(
      runNativeContainerCommand(
        {
          dockerCommand: "/usr/bin/docker",
          execute,
          image: IMAGE,
          namePrefix: "iconsmith-access",
          persistIdentity: vi.fn(),
          persistSettlement: vi.fn(),
          sameContainerAccessProbe: {
            observe: vi.fn(),
            plan,
          },
          stateMounts: [
            {
              containerPath: "/state/auth.json",
              hostPath: authFile,
              readOnly: true,
            },
          ],
        },
        {
          args: [],
          command: "/runtime/codex",
          cwd,
          deadlineAt: Date.now() + 30_000,
          maxBuffer: 4096,
        }
      )
    ).rejects.toThrow("controls were not exact");
    expect(starts).toBe(0);
    expect(existsSync(plan.ackHostPath)).toBe(false);
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

it("rejects secret environment values before Docker execution", async () => {
  const execute = vi.fn();
  await expect(
    runNativeContainerCommand(
      {
        dockerCommand: "/usr/local/bin/docker",
        environment: { OPENAI_API_KEY: "must-not-appear" } as never,
        execute,
        image: IMAGE,
        namePrefix: "iconsmith-codex",
        persistIdentity: vi.fn(),
        persistSettlement: vi.fn(),
        stateMounts: [
          {
            containerPath: "/state/auth.json",
            hostPath: "/host/auth.json",
            readOnly: true,
          },
        ],
      },
      {
        args: [],
        command: "/opt/codex",
        cwd: "/host/run",
        deadlineAt: Date.now() + 10_000,
        maxBuffer: 1024,
      }
    )
  ).rejects.toThrow("public environment");
  expect(execute).not.toHaveBeenCalled();
});

it("refuses secret environment and has no host fallback", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "iconsmith-container-runtime-"));
  try {
    await expect(
      runNativeContainerCommand(
        {
          dockerCommand: "/usr/local/bin/docker",
          environment: { OPENAI_API_KEY: "must-not-appear" },
          image: IMAGE,
          namePrefix: "iconsmith-codex",
          persistIdentity: vi.fn(),
          persistSettlement: vi.fn(),
          stateMounts: [
            {
              containerPath: "/state/auth",
              hostPath: "/host/auth",
              readOnly: true,
            },
          ],
        },
        {
          args: [],
          command: "/opt/codex",
          cwd,
          deadlineAt: Date.now() + 10_000,
          maxBuffer: 1024,
        }
      )
    ).rejects.toThrow("public environment");
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});

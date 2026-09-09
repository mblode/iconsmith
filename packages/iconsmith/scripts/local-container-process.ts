import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { runOwnedProcess } from "./local-process.js";
import type { ProcessResult } from "./local-process.js";

export interface DockerCommandRequest {
  args: readonly string[];
  deadlineAt: number;
  onStdoutLine?: (line: string, signal: AbortSignal) => Promise<void> | void;
  phase:
    | "create"
    | "diagnostic-kill"
    | "kill"
    | "remove"
    | "resolve-identity"
    | "stop-kill"
    | "start"
    | "verify-absent";
}

export type DockerExecutor = (
  request: DockerCommandRequest
) => Promise<ProcessResult>;

export interface ContainerMount {
  containerPath: string;
  hostPath: string;
  readOnly: boolean;
}

export type ContainerEnvironment = Readonly<Record<string, string>>;
export type ContainerNetwork = "bridge" | "none";

export interface ContainerProcessResult {
  artifactEligible: boolean;
  cancelledByStop?: true;
  containerAbsent: boolean;
  containerId: string | null;
  containmentScope: "docker-private-pid-namespace";
  controlEvidence?: DockerControlEvidence | null;
  process: ProcessResult | null;
  reason?: string;
  status: "complete" | "containment-unproven" | "workload-failed";
}

export interface DockerControlEvidence {
  createRequest: {
    /** Exact control arguments; environment values and workload arguments are hashed. */
    args: readonly string[];
    deadlineAt: number;
    phase: "create";
  };
  inspectResult: {
    code: number | string | null;
    diagnostics?: {
      killed: boolean;
      stderrBytes: number;
      stderrSha256: string;
      stdoutBytes: number;
      stdoutSha256: string;
    };
    inspected: {
      Config: { Image: string | undefined };
      HostConfig: { PidMode: string | undefined };
      Id: string | undefined;
      Mounts: readonly {
        Destination: string | undefined;
        RW: boolean | undefined;
        Source: string | undefined;
      }[];
    };
    phase: "resolve-identity";
  };
}

const CONTAINER_ID = /^[a-f0-9]{64}$/u;
const CONTAINER_NAME = /^iconsmith-[a-z0-9][a-z0-9-]{0,50}$/u;
const PINNED_IMAGE = /^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/u;

const remainingMs = (deadlineAt: number) => {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    throw new Error("Container process deadline exhausted");
  }
  return remaining;
};

export const dockerExecutor = (options: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
}): DockerExecutor => {
  // Validate resolution without replacing the invocation alias. Multiplexer
  // binaries such as OrbStack select behavior from the caller's argv0.
  realpathSync(options.command);
  const { command } = options;
  return ({ args, deadlineAt, onStdoutLine }) =>
    runOwnedProcess({
      args,
      command,
      cwd: options.cwd,
      env: options.env,
      maxBuffer: options.maxBuffer,
      onStdoutLine,
      timeoutMs: remainingMs(deadlineAt),
    });
};

const safeContainerPath = (value: string) =>
  value.startsWith("/") && !value.includes(":") && !/[,\r\n\0]/u.test(value);

const SAFE_ENVIRONMENT_NAME =
  /^(?:CODEX_HOME|HOME|LANG|LC_ALL|NO_COLOR|PATH|TERM|TZ|XDG_CONFIG_HOME|XDG_DATA_HOME)$/u;
const safeEnvironment = (environment: ContainerEnvironment | undefined) =>
  Object.entries(environment ?? {}).every(
    ([name, value]) =>
      SAFE_ENVIRONMENT_NAME.test(name) &&
      value.length <= 4096 &&
      !/[\r\n\0]/u.test(value)
  );

const hashSensitiveValue = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const streamDiagnostics = (value: string) => ({
  bytes: Buffer.byteLength(value),
  sha256: hashSensitiveValue(value),
});

const sanitizeCreateArguments = (args: readonly string[], image: string) => {
  const imageIndex = args.indexOf(image);
  if (imageIndex === -1) {
    throw new Error(
      "Container create evidence could not locate its pinned image"
    );
  }
  const sanitized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string;
    if (index > imageIndex) {
      sanitized.push(hashSensitiveValue(argument));
      continue;
    }
    if (argument === "--env") {
      const assignment = args[index + 1];
      const separator = assignment?.indexOf("=") ?? -1;
      const name = separator < 0 ? "" : assignment?.slice(0, separator);
      const value = separator < 0 ? "" : assignment?.slice(separator + 1);
      if (!name || value === undefined || !SAFE_ENVIRONMENT_NAME.test(name)) {
        throw new Error(
          "Container create evidence found an unsupported environment argument"
        );
      }
      sanitized.push(argument, `${name}=${hashSensitiveValue(value)}`);
      index += 1;
      continue;
    }
    if (argument.startsWith("--env=")) {
      throw new Error(
        "Container create evidence found an unsupported environment syntax"
      );
    }
    sanitized.push(argument);
  }
  return sanitized;
};

/**
 * Run a command behind a Docker-owned PID namespace. This adapter proves only
 * daemon accounting in tests; kernel containment needs a frozen live runtime
 * probe before the route can be qualified.
 */
// Validation, lifecycle and independent cleanup branches remain together so
// artifact eligibility is decided from the complete captured-container state.
// oxlint-disable-next-line eslint/complexity
export const runContainerProcess = async (options: {
  args: readonly string[];
  beforeStart?: (identity: {
    containerId: string;
    containerName: string;
    image: string;
    ownershipToken: string;
  }) => Promise<void> | void;
  cleanupReserveMs?: number;
  containerName: string;
  deadlineAt: number;
  execute: DockerExecutor;
  environment?: ContainerEnvironment;
  image: string;
  mounts?: readonly ContainerMount[];
  /** Offline probes must opt out of Docker networking explicitly. */
  network?: ContainerNetwork;
  onStartStdoutLine?: (
    line: string,
    signal: AbortSignal,
    identity: {
      containerId: string;
      containerName: string;
      image: string;
      ownershipToken: string;
    },
    killExactContainer: () => Promise<void>
  ) => Promise<void> | void;
  /** Identity-bound durable STOP observer for an already-started workload. */
  observeStop?: () => boolean;
  persistIdentity: (identity: {
    containerId: string;
    containerName: string;
    image: string;
    ownershipToken: string;
  }) => void;
  workingDirectory?: string;
}): Promise<ContainerProcessResult> => {
  const cleanupReserveMs = options.cleanupReserveMs ?? 5000;
  if (
    !PINNED_IMAGE.test(options.image) ||
    !CONTAINER_NAME.test(options.containerName) ||
    !Number.isFinite(options.deadlineAt) ||
    !Number.isFinite(cleanupReserveMs) ||
    cleanupReserveMs <= 0 ||
    options.deadlineAt - Date.now() <= cleanupReserveMs ||
    (options.network !== undefined &&
      !["bridge", "none"].includes(options.network)) ||
    (options.workingDirectory !== undefined &&
      !safeContainerPath(options.workingDirectory)) ||
    options.mounts?.some(
      ({ containerPath, hostPath }) =>
        !safeContainerPath(containerPath) ||
        !hostPath.startsWith("/") ||
        /[,\n\r\0]/u.test(hostPath)
    ) ||
    !safeEnvironment(options.environment)
  ) {
    throw new Error("Container process needs pinned, bounded safe inputs");
  }
  const workloadDeadline = options.deadlineAt - cleanupReserveMs;
  let containerId: string | null = null;
  let processResult: ProcessResult | null = null;
  let failure: unknown;
  let created: ProcessResult | null = null;
  let controlEvidence: DockerControlEvidence | null = null;
  let cancelledByStop = false;
  const ownershipToken = randomUUID();
  let createRequest: DockerCommandRequest | undefined;
  try {
    const mountArgs = (options.mounts ?? []).flatMap((mount) => [
      "--mount",
      `type=bind,src=${realpathSync(mount.hostPath)},dst=${mount.containerPath}${mount.readOnly ? ",readonly" : ""}`,
    ]);
    const environmentArgs = Object.entries(options.environment ?? {}).flatMap(
      ([name, value]) => ["--env", `${name}=${value}`]
    );
    createRequest = {
      args: [
        "container",
        "create",
        "--name",
        options.containerName,
        "--label",
        `iconsmith.owner=${ownershipToken}`,
        `--network=${options.network ?? "bridge"}`,
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=256",
        "--read-only",
        "--tmpfs=/tmp:rw,noexec,nosuid,size=256m",
        ...(options.workingDirectory
          ? ["--workdir", options.workingDirectory]
          : []),
        ...environmentArgs,
        ...mountArgs,
        options.image,
        ...options.args,
      ],
      deadlineAt: workloadDeadline,
      phase: "create",
    };
    created = await options.execute(createRequest);
  } catch (error) {
    failure = error;
  }

  try {
    const inspected = await options.execute({
      args: [
        "container",
        "inspect",
        "--format={{json .}}",
        options.containerName,
      ],
      deadlineAt: workloadDeadline,
      phase: "resolve-identity",
    });
    if (!createRequest) {
      throw new Error("Docker create request was not captured");
    }
    const stdoutDiagnostics = streamDiagnostics(inspected.stdout);
    const stderrDiagnostics = streamDiagnostics(inspected.stderr);
    controlEvidence = {
      createRequest: {
        args: sanitizeCreateArguments(
          createRequest.args as readonly string[],
          options.image
        ),
        deadlineAt: createRequest.deadlineAt,
        phase: "create",
      },
      inspectResult: {
        code: inspected.code,
        diagnostics: {
          killed: inspected.killed,
          stderrBytes: stderrDiagnostics.bytes,
          stderrSha256: stderrDiagnostics.sha256,
          stdoutBytes: stdoutDiagnostics.bytes,
          stdoutSha256: stdoutDiagnostics.sha256,
        },
        inspected: {
          Config: { Image: undefined },
          HostConfig: { PidMode: undefined },
          Id: undefined,
          Mounts: [],
        },
        phase: "resolve-identity",
      },
    };
    if (inspected.code !== 0 || inspected.killed) {
      throw new Error(
        `Docker inspect command failed (code=${String(inspected.code)}, killed=${String(inspected.killed)}, stderr=${stderrDiagnostics.sha256})`
      );
    }
    const inspectedContainer = JSON.parse(inspected.stdout) as {
      Config?: { Image?: string; Labels?: Record<string, string> };
      HostConfig?: { PidMode?: string };
      Id?: string;
      Mounts?: { Destination?: string; RW?: boolean; Source?: string }[];
    };
    controlEvidence.inspectResult.inspected = {
      Config: { Image: inspectedContainer.Config?.Image },
      HostConfig: { PidMode: inspectedContainer.HostConfig?.PidMode },
      Id: inspectedContainer.Id,
      Mounts: (inspectedContainer.Mounts ?? []).map(
        ({ Destination, RW, Source }) => ({ Destination, RW, Source })
      ),
    };
    if (
      inspected.code === 0 &&
      inspectedContainer.Config?.Image === options.image &&
      inspectedContainer.Config.Labels?.["iconsmith.owner"] ===
        ownershipToken &&
      typeof inspectedContainer.Id === "string" &&
      CONTAINER_ID.test(inspectedContainer.Id)
    ) {
      containerId = inspectedContainer.Id;
      options.persistIdentity({
        containerId,
        containerName: options.containerName,
        image: options.image,
        ownershipToken,
      });
    }
    const createId = created?.stdout.trim();
    if (
      failure !== undefined ||
      created?.code !== 0 ||
      !createId ||
      !CONTAINER_ID.test(createId) ||
      createId !== containerId ||
      inspectedContainer.HostConfig?.PidMode !== ""
    ) {
      throw new Error("Docker create identity was not captured exactly");
    }
    await options.beforeStart?.({
      containerId,
      containerName: options.containerName,
      image: options.image,
      ownershipToken,
    });
    const startRequest: DockerCommandRequest = {
      args: ["container", "start", "--attach", containerId],
      deadlineAt: workloadDeadline,
      ...(options.onStartStdoutLine
        ? {
            onStdoutLine: (line: string, signal: AbortSignal) =>
              options.onStartStdoutLine?.(
                line,
                signal,
                {
                  containerId: containerId as string,
                  containerName: options.containerName,
                  image: options.image,
                  ownershipToken,
                },
                async () => {
                  if (signal.aborted) {
                    throw new Error(
                      "Diagnostic container kill was cancelled before settlement"
                    );
                  }
                  const killed = await options.execute({
                    args: ["container", "kill", containerId as string],
                    deadlineAt: workloadDeadline,
                    phase: "diagnostic-kill",
                  });
                  if (killed.code !== 0) {
                    throw new Error("Exact diagnostic container kill failed");
                  }
                }
              ),
          }
        : {}),
      phase: "start",
    };
    const start = options.execute(startRequest);
    const stopController = new AbortController();
    let startSettled = false;
    const rawStopMonitor = options.observeStop
      ? (async () => {
          /* oxlint-disable eslint/no-await-in-loop, eslint/no-unmodified-loop-condition -- one sequential bounded STOP watcher follows an independently settling attach promise. */
          while (!startSettled && !stopController.signal.aborted) {
            let stop = false;
            try {
              stop = options.observeStop?.() === true;
            } catch (error) {
              failure ??= error;
              stop = true;
            }
            if (stop) {
              const killed = await options.execute({
                args: ["container", "kill", containerId as string],
                deadlineAt: workloadDeadline,
                phase: "stop-kill",
              });
              if (killed.code !== 0 || killed.killed) {
                throw new Error("Exact active STOP container kill failed");
              }
              cancelledByStop = failure === undefined;
              return;
            }
            const delay = Math.min(100, workloadDeadline - Date.now());
            if (delay <= 0) {
              return;
            }
            try {
              await sleep(delay, undefined, {
                signal: stopController.signal,
              });
            } catch (error) {
              if (!stopController.signal.aborted) {
                throw error;
              }
            }
          }
          /* oxlint-enable eslint/no-await-in-loop, eslint/no-unmodified-loop-condition */
        })()
      : undefined;
    const stopMonitor = rawStopMonitor
      ? (async () => {
          try {
            // Attach this handler immediately. The workload attach may remain
            // pending until its deadline after Docker refuses a STOP kill.
            await rawStopMonitor;
          } catch (error) {
            failure ??= error;
          }
        })()
      : undefined;
    try {
      processResult = await start;
    } finally {
      startSettled = true;
      stopController.abort();
      await stopMonitor;
    }
    if (cancelledByStop && processResult) {
      processResult = { ...processResult, killed: true };
      failure ??= new Error("Native call cancelled by latched STOP");
    }
  } catch (error) {
    failure ??= error;
  }

  const cleanupErrors: string[] = [];
  if (containerId === null) {
    return {
      artifactEligible: false,
      containerAbsent: false,
      containerId,
      containmentScope: "docker-private-pid-namespace",
      controlEvidence,
      process: processResult,
      reason: String(failure ?? "Container ownership could not be established"),
      status: "containment-unproven",
    };
  }
  const cleanupIdentity = containerId;
  for (const [phase, args] of [
    ["kill", ["container", "kill", cleanupIdentity]],
    ["remove", ["container", "rm", "--force", cleanupIdentity]],
  ] as const) {
    try {
      // Cleanup attempts are independent so one daemon error cannot skip the
      // remaining removal and accounting checks.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await options.execute({ args, deadlineAt: options.deadlineAt, phase });
    } catch (error) {
      cleanupErrors.push(String(error));
    }
  }

  let containerAbsent = false;
  try {
    const listed = await options.execute({
      args: [
        "container",
        "ls",
        "--all",
        "--quiet",
        "--no-trunc",
        "--filter",
        `id=${containerId}`,
      ],
      deadlineAt: options.deadlineAt,
      phase: "verify-absent",
    });
    containerAbsent = listed.code === 0 && listed.stdout.trim() === "";
    if (!containerAbsent) {
      cleanupErrors.push("Docker still reports the captured container id");
    }
  } catch (error) {
    cleanupErrors.push(String(error));
  }

  const workloadSucceeded =
    failure === undefined &&
    processResult?.code === 0 &&
    processResult.killed === false;
  const artifactEligible = workloadSucceeded && containerAbsent;
  let status: ContainerProcessResult["status"] = "workload-failed";
  if (!containerAbsent) {
    status = "containment-unproven";
  } else if (workloadSucceeded) {
    status = "complete";
  }
  return {
    artifactEligible,
    ...(cancelledByStop ? { cancelledByStop: true as const } : {}),
    containerAbsent,
    containerId,
    containmentScope: "docker-private-pid-namespace",
    controlEvidence,
    process: processResult,
    ...(failure === undefined && cleanupErrors.length === 0
      ? {}
      : {
          reason: [
            ...(failure === undefined ? [] : [String(failure)]),
            ...cleanupErrors,
          ].join("; "),
        }),
    status,
  };
};

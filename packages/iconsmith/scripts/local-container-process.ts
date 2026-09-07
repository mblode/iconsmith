import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";

import { runOwnedProcess } from "./local-process.js";
import type { ProcessResult } from "./local-process.js";

export interface DockerCommandRequest {
  args: readonly string[];
  deadlineAt: number;
  phase:
    | "create"
    | "kill"
    | "remove"
    | "resolve-identity"
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

export interface ContainerProcessResult {
  artifactEligible: boolean;
  containerAbsent: boolean;
  containerId: string | null;
  containmentScope: "docker-private-pid-namespace";
  process: ProcessResult | null;
  reason?: string;
  status: "complete" | "containment-unproven" | "workload-failed";
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
  return ({ args, deadlineAt }) =>
    runOwnedProcess({
      args,
      command,
      cwd: options.cwd,
      env: options.env,
      maxBuffer: options.maxBuffer,
      timeoutMs: remainingMs(deadlineAt),
    });
};

const safeContainerPath = (value: string) =>
  value.startsWith("/") && !value.includes(":") && !/[,\r\n\0]/u.test(value);

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
  cleanupReserveMs?: number;
  containerName: string;
  deadlineAt: number;
  execute: DockerExecutor;
  image: string;
  mounts?: readonly ContainerMount[];
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
    (options.workingDirectory !== undefined &&
      !safeContainerPath(options.workingDirectory)) ||
    options.mounts?.some(
      ({ containerPath, hostPath }) =>
        !safeContainerPath(containerPath) ||
        !hostPath.startsWith("/") ||
        /[,\n\r\0]/u.test(hostPath)
    )
  ) {
    throw new Error("Container process needs pinned, bounded safe inputs");
  }
  const workloadDeadline = options.deadlineAt - cleanupReserveMs;
  let containerId: string | null = null;
  let processResult: ProcessResult | null = null;
  let failure: unknown;
  let created: ProcessResult | null = null;
  const ownershipToken = randomUUID();
  try {
    const mountArgs = (options.mounts ?? []).flatMap((mount) => [
      "--mount",
      `type=bind,src=${realpathSync(mount.hostPath)},dst=${mount.containerPath}${mount.readOnly ? ",readonly" : ""}`,
    ]);
    created = await options.execute({
      args: [
        "container",
        "create",
        "--name",
        options.containerName,
        "--label",
        `iconsmith.owner=${ownershipToken}`,
        "--network=bridge",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=256",
        "--read-only",
        "--tmpfs=/tmp:rw,noexec,nosuid,size=256m",
        ...(options.workingDirectory
          ? ["--workdir", options.workingDirectory]
          : []),
        ...mountArgs,
        options.image,
        ...options.args,
      ],
      deadlineAt: workloadDeadline,
      phase: "create",
    });
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
    const inspectedContainer = JSON.parse(inspected.stdout) as {
      Config?: { Image?: string; Labels?: Record<string, string> };
      HostConfig?: { PidMode?: string };
      Id?: string;
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
    processResult = await options.execute({
      args: ["container", "start", "--attach", containerId],
      deadlineAt: workloadDeadline,
      phase: "start",
    });
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
    containerAbsent,
    containerId,
    containmentScope: "docker-private-pid-namespace",
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

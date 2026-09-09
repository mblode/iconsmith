/** Canonical native-CLI execution inside an explicitly configured container. */
import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  dockerExecutor,
  runContainerProcess,
} from "./local-container-process.js";
import type {
  ContainerProcessResult,
  ContainerEnvironment,
  ContainerMount,
  DockerExecutor,
} from "./local-container-process.js";
import type { DiagnosticFinalizationObserver } from "./local-native-interruption-diagnostic.js";
import type { ProcessResult } from "./local-process.js";

export interface NativeContainerRuntimeConfig {
  /** Recheck a latched stop/call boundary immediately before workload start. */
  beforeStart?: (identity: {
    containerId: string;
    containerName: string;
    image: string;
    ownershipToken: string;
  }) => Promise<void> | void;
  /** Absolute path to docker-compatible client on the host. */
  dockerCommand: string;
  /** Host environment for the Docker client. Provider credentials are removed. */
  dockerEnvironment?: NodeJS.ProcessEnv;
  /** Opaque diagnostic-only finalization observer; absent from production manifests. */
  diagnosticFinalizationObserver?: DiagnosticFinalizationObserver;
  /** Diagnostic-only same-container access handshake; absent by default. */
  sameContainerAccessProbe?: SameContainerAccessProbe;
  /** Immutable image reference, including its sha256 digest. */
  image: string;
  /** Public values only. Authentication must be provided by declared mounts. */
  environment?: ContainerEnvironment;
  /** Prefix used for one unique container per native invocation. */
  namePrefix: string;
  /** Provider calls default to bridge; offline preflights use none. */
  network?: "bridge" | "none";
  /** Explicit native authentication/configuration mounts. */
  stateMounts: readonly ContainerMount[];
  /** Test seam for the Docker control plane. */
  execute?: DockerExecutor;
  /** Durable host receipt written before the workload starts. */
  persistIdentity: (identity: {
    containerId: string;
    containerName: string;
    image: string;
    ownershipToken: string;
  }) => void;
  /** Host-only access binding sink, called before ACK and provider exec. */
  persistAccessBinding?: (binding: SameContainerAccessBinding) => void;
  /** Identity-bound durable STOP observer for an in-flight provider call. */
  observeStop?: () => boolean;
  /** Durable settlement receipt retaining containment evidence. */
  persistSettlement: (result: ContainerProcessResult) => void;
}

export interface SameContainerAccessProbePlan {
  ackContainerPath: string;
  ackHostPath: string;
  ackSha256: string;
  allowed: { containerPath: string; sha256: string };
  forbidden: readonly { containerPath: string; pathClass: string }[];
  kind: "same-container-access-probe-plan-v1";
  nonce: string;
  nonceSha256: string;
  planSha256: string;
  stageId: string;
}

export interface SameContainerAccessObservation {
  kind: "same-container-access-observation-v1";
  nonceSha256: string;
  observations: readonly {
    pathClass: string;
    sha256?: string;
    status: "missing" | "read-failed" | "readable" | "unsupported-type";
  }[];
  planSha256: string;
  stageId: string;
}

export interface SameContainerSecurityEvidence {
  containerId: string;
  kind: "same-container-security-evidence-v1";
  mountCensusSha256: string;
  network: "bridge" | "none";
  rawInspect: string;
  sha256: string;
}

interface SameContainerAccessReceipt {
  receiptFile: string;
  receiptSha256: string;
  securityInspectFile: string;
  securityInspectSha256: string;
}

export interface SameContainerAccessBinding {
  ackSha256: string;
  containerId: string;
  kind: "same-container-access-binding-v1";
  nonceSha256: string;
  observationSha256: string;
  planSha256: string;
  receiptFile: string;
  receiptSha256: string;
  securityInspectFile: string;
  securityInspectSha256: string;
  stageId: string;
}

export interface SameContainerAccessProbe {
  observe: (
    observation: SameContainerAccessObservation,
    identity: NativeContainerIdentity,
    security: SameContainerSecurityEvidence
  ) => Promise<SameContainerAccessReceipt>;
  plan: SameContainerAccessProbePlan;
}

export interface NativeContainerIdentity {
  containerId: string;
  containerName: string;
  image: string;
  ownershipToken: string;
}

export interface NativeCliContainerConfig extends NativeContainerRuntimeConfig {
  /** Version-bound trust and helper assets required by the Codex binary. */
  codexAssets?: {
    certificateBundle: VerifiedReadOnlyContainerFile;
    cliVersion: string;
    codeModeHost: VerifiedReadOnlyContainerFile;
  };
  /** Frozen executable identity inside the container. */
  nativeCliVersion: string;
  nativeCommand: string;
  /** Exact host binary mounted read-only at nativeCommand. */
  nativeExecutableHostPath: string;
  nativeExecutableSha256: string;
  /** Required only when an adapter executes a local stream bridge. */
  nodeCommand?: string;
}

export interface VerifiedReadOnlyContainerFile {
  containerPath: string;
  hostPath: string;
  sha256: string;
}

export interface NativeContainerInvocation {
  args: readonly string[];
  /** Absolute executable path inside the frozen image. */
  command: string;
  /** Host directory mounted read/write at the same absolute path. */
  cwd: string;
  deadlineAt: number;
  maxBuffer: number;
}

const SECRET_NAME =
  /(?:API|AUTH|CREDENTIAL|OAUTH|SECRET|TOKEN|ANTHROPIC|OPENAI|GEMINI|GOOGLE|VERCEL)/iu;
const SAFE_NAME_PREFIX = /^iconsmith-[a-z0-9][a-z0-9-]{0,37}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PROBE_VALUE = /^[A-Za-z0-9._:-]{1,200}$/u;
const PATH_CLASS =
  /^(?:allowed-native-executable|forbidden-[0-9]+-(?:direct|proc-root|host-mnt|run-host))$/u;
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const containerPathFor = (
  hostCwd: string,
  value: string,
  declaredContainerPaths: readonly string[] = []
) => {
  if (!path.isAbsolute(value)) {
    return value;
  }
  if (declaredContainerPaths.includes(value)) {
    return value;
  }
  const relative = path.relative(hostCwd, value);
  if (relative === "") {
    return hostCwd;
  }
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Native container argument escaped its run directory");
  }
  return path.posix.join(hostCwd, ...relative.split(path.sep));
};

const sanitizeDockerEnvironment = (env: NodeJS.ProcessEnv) =>
  Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) => value !== undefined && !SECRET_NAME.test(name)
    )
  );

const validateRuntime = (config: NativeContainerRuntimeConfig) => {
  if (
    !path.isAbsolute(config.dockerCommand) ||
    !SAFE_NAME_PREFIX.test(config.namePrefix) ||
    Object.keys(config.environment ?? {}).some((name) =>
      SECRET_NAME.test(name)
    ) ||
    config.stateMounts.length === 0 ||
    config.stateMounts.some(
      ({ containerPath, hostPath }) =>
        !path.isAbsolute(containerPath) || !path.isAbsolute(hostPath)
    )
  ) {
    throw new Error(
      "Native container runtime needs an absolute Docker client, safe name, public environment and explicit state mounts"
    );
  }
};

const validateAccessPlan = (
  plan: SameContainerAccessProbePlan,
  hostCwd: string,
  deadlineAt: number
) => {
  const expectedAck = `iconsmith-access-ack-v1:${plan.stageId}:${plan.nonceSha256}\n`;
  const { planSha256: _planSha256, ...planDescriptor } = plan;
  if (
    plan.kind !== "same-container-access-probe-plan-v1" ||
    !SHA256.test(plan.planSha256) ||
    digest(JSON.stringify(planDescriptor)) !== plan.planSha256 ||
    !SHA256.test(plan.nonceSha256) ||
    digest(plan.nonce) !== plan.nonceSha256 ||
    !PROBE_VALUE.test(plan.nonce) ||
    !PROBE_VALUE.test(plan.stageId) ||
    !path.posix.isAbsolute(plan.allowed.containerPath) ||
    !SHA256.test(plan.allowed.sha256) ||
    plan.forbidden.length === 0 ||
    new Set(plan.forbidden.map(({ pathClass }) => pathClass)).size !==
      plan.forbidden.length ||
    plan.forbidden.some(
      ({ containerPath, pathClass }) =>
        !path.posix.isAbsolute(containerPath) ||
        !PATH_CLASS.test(pathClass) ||
        pathClass === "allowed-native-executable"
    ) ||
    !path.isAbsolute(plan.ackHostPath) ||
    plan.ackContainerPath !== plan.ackHostPath ||
    path.dirname(path.resolve(plan.ackHostPath)) !== hostCwd ||
    existsSync(plan.ackHostPath) ||
    digest(expectedAck) !== plan.ackSha256 ||
    deadlineAt <= Date.now()
  ) {
    throw new Error("Same-container access probe plan is invalid");
  }
  return expectedAck;
};

interface RawSecurityInspect {
  HostConfig?: {
    CapDrop?: string[];
    Devices?: unknown[];
    NetworkMode?: string;
    PidMode?: string;
    Privileged?: boolean;
    ReadonlyRootfs?: boolean;
    SecurityOpt?: string[];
  };
  Id?: string;
  Mounts?: {
    Destination?: string;
    RW?: boolean;
    Source?: string;
    Type?: string;
  }[];
}

// Exact security controls intentionally remain one atomic validation gate.
// oxlint-disable-next-line eslint/complexity
const verifySameContainerSecurity = async (
  execute: DockerExecutor,
  identity: NativeContainerIdentity,
  config: NativeContainerRuntimeConfig,
  hostCwd: string,
  deadlineAt: number
): Promise<SameContainerSecurityEvidence> => {
  const response = await execute({
    args: ["container", "inspect", identity.containerId],
    deadlineAt,
    phase: "resolve-identity",
  });
  if (response.code !== 0 || response.killed || !response.quiescent) {
    throw new Error("Access probe Docker security inspect failed");
  }
  const bytes = response.stdout.trim();
  let inspected: RawSecurityInspect;
  try {
    const parsed = JSON.parse(bytes);
    inspected = (
      Array.isArray(parsed) ? parsed[0] : parsed
    ) as RawSecurityInspect;
  } catch {
    throw new Error("Access probe Docker security inspect was malformed");
  }
  const expectedMounts = [
    {
      Destination: hostCwd,
      RW: true,
      Source: realpathSync(hostCwd),
      Type: "bind",
    },
    ...config.stateMounts.map(({ containerPath, hostPath, readOnly }) => ({
      Destination: containerPath,
      RW: !readOnly,
      Source: realpathSync(hostPath),
      Type: "bind",
    })),
  ].toSorted((left, right) =>
    left.Destination.localeCompare(right.Destination)
  );
  const actualMounts = (inspected.Mounts ?? [])
    .map(({ Destination, RW, Source, Type }) => ({
      Destination,
      RW,
      Source,
      Type,
    }))
    .toSorted((left, right) =>
      String(left.Destination).localeCompare(String(right.Destination))
    );
  const host = inspected.HostConfig;
  const network = config.network ?? "bridge";
  if (
    inspected.Id !== identity.containerId ||
    host?.PidMode !== "" ||
    host.Privileged !== false ||
    host.ReadonlyRootfs !== true ||
    host.NetworkMode !== network ||
    JSON.stringify(host.CapDrop) !== JSON.stringify(["ALL"]) ||
    !host.SecurityOpt?.includes("no-new-privileges") ||
    (host.Devices?.length ?? 0) !== 0 ||
    JSON.stringify(actualMounts) !== JSON.stringify(expectedMounts)
  ) {
    throw new Error("Access probe Docker controls were not exact");
  }
  return Object.freeze({
    containerId: identity.containerId,
    kind: "same-container-security-evidence-v1" as const,
    mountCensusSha256: digest(JSON.stringify(actualMounts)),
    network,
    rawInspect: bytes,
    sha256: digest(bytes),
  });
};

const probeScript = String.raw`set -eu
command -v timeout >/dev/null 2>&1
command -v dd >/dev/null 2>&1
plan="$1"; stage="$2"; nonce="$3"; nonce_hash="$4"; allowed="$5"; allowed_hash="$6"; ack="$7"; ack_value="$8"; count="$9"
shift 9
actual="$(sha256sum "$allowed" | awk '{print $1}')"
[ "$actual" = "$allowed_hash" ]
line="ICONSMITH_ACCESS_V1|$plan|$stage|$nonce|$nonce_hash|allowed-native-executable:readable:$actual"
i=0
while [ "$i" -lt "$count" ]; do
  class="$1"; candidate="$2"; shift 2
  if [ -L "$candidate" ]; then
    status=unsupported-type
  elif [ ! -e "$candidate" ]; then
    status=missing
  elif [ ! -f "$candidate" ]; then
    status=unsupported-type
  elif timeout 1 dd if="$candidate" of=/dev/null bs=1 count=1 2>/dev/null; then
    status=readable
  elif [ -L "$candidate" ] || { [ -e "$candidate" ] && [ ! -f "$candidate" ]; }; then
    status=unsupported-type
  elif [ ! -e "$candidate" ]; then
    status=missing
  else
    status=read-failed
  fi
  line="$line|$class:$status"
  i=$((i + 1))
done
printf '%s\n' "$line"
while [ ! -f "$ack" ]; do sleep 0.02; done
IFS= read -r received < "$ack" || true
[ "$received" = "$ack_value" ]
rm -f -- "$ack"
native="$1"; shift
exec "$native" "$@"`;

const parseProbeObservation = (
  line: string,
  plan: SameContainerAccessProbePlan
): SameContainerAccessObservation => {
  const fields = line.split("|");
  if (
    fields.length !== 6 + plan.forbidden.length ||
    fields[0] !== "ICONSMITH_ACCESS_V1" ||
    fields[1] !== plan.planSha256 ||
    fields[2] !== plan.stageId ||
    fields[3] !== plan.nonce ||
    fields[4] !== plan.nonceSha256
  ) {
    throw new Error("Same-container access preamble identity mismatched");
  }
  const parsed = fields.slice(5).map((field) => {
    const [pathClass, status, sha256, ...rest] = field.split(":");
    if (
      rest.length > 0 ||
      !pathClass ||
      !PATH_CLASS.test(pathClass) ||
      !["missing", "read-failed", "readable", "unsupported-type"].includes(
        status ?? ""
      ) ||
      (sha256 !== undefined && !SHA256.test(sha256))
    ) {
      throw new Error("Same-container access preamble was malformed");
    }
    return {
      pathClass,
      ...(sha256 ? { sha256 } : {}),
      status: status as
        | "missing"
        | "read-failed"
        | "readable"
        | "unsupported-type",
    };
  });
  if (
    parsed[0]?.pathClass !== "allowed-native-executable" ||
    parsed[0].status !== "readable" ||
    parsed[0].sha256 !== plan.allowed.sha256 ||
    plan.forbidden.some(
      ({ pathClass }, index) =>
        parsed[index + 1]?.pathClass !== pathClass ||
        parsed[index + 1]?.status !== "missing" ||
        parsed[index + 1]?.sha256 !== undefined
    )
  ) {
    throw new Error("Same-container access observations were not exact");
  }
  return Object.freeze({
    kind: "same-container-access-observation-v1" as const,
    nonceSha256: plan.nonceSha256,
    observations: parsed,
    planSha256: plan.planSha256,
    stageId: plan.stageId,
  });
};

export const validateNativeCliContainerConfig = (
  config: NativeCliContainerConfig
) => {
  validateRuntime(config);
  if (
    !config.nativeCliVersion.trim() ||
    !path.posix.isAbsolute(config.nativeCommand) ||
    !path.isAbsolute(config.nativeExecutableHostPath) ||
    !/^[a-f0-9]{64}$/u.test(config.nativeExecutableSha256) ||
    !config.stateMounts.some(
      (mount) =>
        mount.readOnly &&
        mount.containerPath === config.nativeCommand &&
        path.resolve(mount.hostPath) ===
          path.resolve(config.nativeExecutableHostPath)
    ) ||
    createHash("sha256")
      .update(readFileSync(config.nativeExecutableHostPath))
      .digest("hex") !== config.nativeExecutableSha256
  ) {
    throw new Error(
      "Native CLI identity must match an exact read-only executable mount"
    );
  }
};

const validateVerifiedReadOnlyFile = (
  config: NativeCliContainerConfig,
  file: VerifiedReadOnlyContainerFile
) => {
  if (
    !path.posix.isAbsolute(file.containerPath) ||
    !path.isAbsolute(file.hostPath) ||
    !/^[a-f0-9]{64}$/u.test(file.sha256) ||
    !config.stateMounts.some(
      (mount) =>
        mount.readOnly &&
        mount.containerPath === file.containerPath &&
        path.resolve(mount.hostPath) === path.resolve(file.hostPath)
    ) ||
    createHash("sha256").update(readFileSync(file.hostPath)).digest("hex") !==
      file.sha256
  ) {
    throw new Error("Native runtime asset must match an exact read-only mount");
  }
};

export const validateCodexContainerAssets = (
  config: NativeCliContainerConfig
) => {
  validateNativeCliContainerConfig(config);
  const assets = config.codexAssets;
  if (
    !assets ||
    assets.cliVersion !== config.nativeCliVersion ||
    assets.certificateBundle.containerPath !==
      "/etc/ssl/certs/ca-certificates.crt" ||
    assets.codeModeHost.containerPath !==
      path.posix.join(
        path.posix.dirname(config.nativeCommand),
        "codex-code-mode-host"
      )
  ) {
    throw new Error(
      "Codex container needs version-bound certificate and code-mode assets"
    );
  }
  validateVerifiedReadOnlyFile(config, assets.certificateBundle);
  validateVerifiedReadOnlyFile(config, assets.codeModeHost);
  const certificateBytes = readFileSync(assets.certificateBundle.hostPath);
  const codeModeHost = statSync(assets.codeModeHost.hostPath);
  accessSync(assets.codeModeHost.hostPath, constants.X_OK);
  if (
    !certificateBytes.includes(Buffer.from("-----BEGIN CERTIFICATE-----")) ||
    !codeModeHost.isFile()
  ) {
    throw new Error(
      "Codex container certificate bundle or code-mode host is unusable"
    );
  }
};

export const validateHostVisibleContainerState = (
  config: NativeCliContainerConfig,
  environmentName: "CODEX_HOME"
) => {
  const statePath = config.environment?.[environmentName];
  if (
    !statePath ||
    !path.isAbsolute(statePath) ||
    !config.stateMounts.some(
      (mount) =>
        !mount.readOnly &&
        path.resolve(mount.hostPath) === path.resolve(statePath) &&
        mount.containerPath === statePath
    )
  ) {
    throw new Error(
      `${environmentName} must be one explicit read-write same-path mount`
    );
  }
};

// Invocation, nested handshake and settlement share one fail-closed lifecycle gate.
// oxlint-disable eslint/complexity
export const runNativeContainerCommand = async (
  config: NativeContainerRuntimeConfig,
  invocation: NativeContainerInvocation
): Promise<ProcessResult> => {
  validateRuntime(config);
  if (
    !path.posix.isAbsolute(invocation.command) ||
    !path.isAbsolute(invocation.cwd) ||
    !Number.isFinite(invocation.deadlineAt) ||
    invocation.deadlineAt <= Date.now() ||
    !Number.isInteger(invocation.maxBuffer) ||
    invocation.maxBuffer <= 0
  ) {
    throw new Error("Native container invocation must be absolute and bounded");
  }
  const hostCwd = path.resolve(invocation.cwd);
  const accessProbe = config.sameContainerAccessProbe;
  const ackBytes = accessProbe
    ? validateAccessPlan(accessProbe.plan, hostCwd, invocation.deadlineAt)
    : undefined;
  if (accessProbe && !ackBytes) {
    throw new Error("Same-container access ACK was not derived");
  }
  const execute =
    config.execute ??
    dockerExecutor({
      command: config.dockerCommand,
      cwd: hostCwd,
      env: sanitizeDockerEnvironment(config.dockerEnvironment ?? process.env),
      maxBuffer: invocation.maxBuffer,
    });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  let accessBinding: SameContainerAccessBinding | undefined;
  let accessSecurity: SameContainerSecurityEvidence | undefined;
  let preambleLine: string | undefined;
  let observedIdentity: NativeContainerIdentity | undefined;
  const command = accessProbe ? "/bin/sh" : invocation.command;
  const commandArgs = accessProbe
    ? [
        "-c",
        probeScript,
        "iconsmith-access-probe",
        accessProbe.plan.planSha256,
        accessProbe.plan.stageId,
        accessProbe.plan.nonce,
        accessProbe.plan.nonceSha256,
        accessProbe.plan.allowed.containerPath,
        accessProbe.plan.allowed.sha256,
        accessProbe.plan.ackContainerPath,
        ackBytes?.trimEnd() ?? "",
        String(accessProbe.plan.forbidden.length),
        ...accessProbe.plan.forbidden.flatMap(
          ({ containerPath, pathClass }) => [pathClass, containerPath]
        ),
        invocation.command,
        ...invocation.args.map((argument) =>
          containerPathFor(
            hostCwd,
            argument,
            config.stateMounts.map(({ containerPath }) => containerPath)
          )
        ),
      ]
    : invocation.args.map((argument) =>
        containerPathFor(
          hostCwd,
          argument,
          config.stateMounts.map(({ containerPath }) => containerPath)
        )
      );
  const result = await runContainerProcess({
    args: [command, ...commandArgs],
    beforeStart: async (identity) => {
      if (accessProbe) {
        accessSecurity = await verifySameContainerSecurity(
          execute,
          identity,
          config,
          hostCwd,
          invocation.deadlineAt
        );
        observedIdentity = identity;
      }
      await config.beforeStart?.(identity);
    },
    containerName: `${config.namePrefix}-${suffix}`,
    deadlineAt: invocation.deadlineAt,
    environment: config.environment,
    execute,
    image: config.image,
    mounts: [
      {
        containerPath: hostCwd,
        hostPath: hostCwd,
        readOnly: false,
      },
      ...config.stateMounts,
    ],
    network: config.network,
    observeStop: config.observeStop,
    onStartStdoutLine:
      accessProbe || config.diagnosticFinalizationObserver
        ? async (line, signal, identity, killExactContainer) => {
            if (accessProbe && preambleLine === undefined) {
              const exactAckBytes = ackBytes;
              if (
                !exactAckBytes ||
                identity.containerId !== observedIdentity?.containerId ||
                accessSecurity?.containerId !== identity.containerId ||
                signal.aborted
              ) {
                throw new Error("Access probe start identity was not verified");
              }
              const observation = parseProbeObservation(line, accessProbe.plan);
              const receipt = await accessProbe.observe(
                observation,
                identity,
                accessSecurity
              );
              if (
                !path.isAbsolute(receipt.receiptFile) ||
                !path.isAbsolute(receipt.securityInspectFile) ||
                !SHA256.test(receipt.receiptSha256) ||
                receipt.securityInspectSha256 !== accessSecurity.sha256 ||
                !lstatSync(receipt.receiptFile).isFile() ||
                lstatSync(receipt.receiptFile).isSymbolicLink() ||
                lstatSync(receipt.receiptFile).nlink !== 1 ||
                !lstatSync(receipt.securityInspectFile).isFile() ||
                lstatSync(receipt.securityInspectFile).isSymbolicLink() ||
                lstatSync(receipt.securityInspectFile).nlink !== 1 ||
                digest(readFileSync(receipt.receiptFile)) !==
                  receipt.receiptSha256 ||
                digest(readFileSync(receipt.securityInspectFile)) !==
                  receipt.securityInspectSha256 ||
                signal.aborted ||
                existsSync(accessProbe.plan.ackHostPath)
              ) {
                throw new Error(
                  "Access probe collector receipt was not sealed"
                );
              }
              const descriptor = openSync(
                accessProbe.plan.ackHostPath,
                "wx",
                0o600
              );
              try {
                writeFileSync(descriptor, exactAckBytes);
                fsyncSync(descriptor);
              } finally {
                closeSync(descriptor);
              }
              const directory = openSync(hostCwd, "r");
              try {
                fsyncSync(directory);
              } finally {
                closeSync(directory);
              }
              preambleLine = line;
              accessBinding = Object.freeze({
                ackSha256: accessProbe.plan.ackSha256,
                containerId: identity.containerId,
                kind: "same-container-access-binding-v1" as const,
                nonceSha256: accessProbe.plan.nonceSha256,
                observationSha256: digest(JSON.stringify(observation)),
                planSha256: accessProbe.plan.planSha256,
                receiptFile: receipt.receiptFile,
                receiptSha256: receipt.receiptSha256,
                securityInspectFile: receipt.securityInspectFile,
                securityInspectSha256: accessSecurity.sha256,
                stageId: accessProbe.plan.stageId,
              });
              config.persistAccessBinding?.(accessBinding);
              return;
            }
            await config.diagnosticFinalizationObserver?.observe(
              line,
              signal,
              identity,
              killExactContainer
            );
          }
        : undefined,
    persistIdentity: config.persistIdentity,
    workingDirectory: hostCwd,
  });
  config.persistSettlement(result);
  if (
    accessProbe &&
    (!preambleLine ||
      !accessBinding ||
      existsSync(accessProbe.plan.ackHostPath) ||
      result.process === null ||
      !result.process.stdout.startsWith(`${preambleLine}\n`))
  ) {
    if (existsSync(accessProbe.plan.ackHostPath)) {
      unlinkSync(accessProbe.plan.ackHostPath);
    }
    throw new Error(
      result.reason ?? "Same-container access handshake did not settle exactly"
    );
  }
  if (!result.containerAbsent || result.process === null) {
    throw new Error(
      result.reason ?? "Native container settlement was unproven"
    );
  }
  if (!accessProbe || !preambleLine) {
    return result.process;
  }
  return {
    ...result.process,
    stdout: result.process.stdout.slice(preambleLine.length + 1),
  };
};
// oxlint-enable eslint/complexity

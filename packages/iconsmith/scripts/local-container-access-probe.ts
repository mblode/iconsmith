/** Offline Docker namespace probe for host-path reachability. */

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  dockerExecutor,
  runContainerProcess,
} from "./local-container-process.js";
import type {
  ContainerMount,
  DockerControlEvidence,
  DockerExecutor,
} from "./local-container-process.js";

const HASH = /^[a-f0-9]{64}$/u;
const CLASS = /^[a-z][a-z0-9-]{0,62}$/u;
const PINNED_IMAGE = /^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/u;
const CONTAINER_ROOT = "/iconsmith-access-probe";

const PROBE_SCRIPT = `#!/bin/sh
set -eu
plan="$1"
allowed="$2"
emit() {
  path_class="$1"
  candidate="$2"
  if [ -r "$candidate" ]; then
    value="$(sha256sum "$candidate" | cut -d ' ' -f 1)"
    printf '{"pathClass":"%s","status":"readable","hash":"%s"}\\n' "$path_class" "$value"
  else
    printf '{"pathClass":"%s","status":"not-visible","hash":null}\\n' "$path_class"
  fi
}
emit allowed-fixture "$allowed"
tab="$(printf '\\t')"
while IFS="$tab" read -r path_class host_path; do
  base_class="$path_class"
  emit "$base_class-direct" "$host_path"
  emit "$base_class-proc-root" "/proc/1/root$host_path"
  emit "$base_class-host-mnt" "/host_mnt$host_path"
done < "$plan"
`;

const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

const assertRegular = (file: string) => {
  const resolved = path.resolve(file);
  const metadata = lstatSync(resolved);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    realpathSync(resolved) !== resolved
  ) {
    throw new Error("Access probe inputs must be canonical regular files");
  }
  return resolved;
};

const assertExecutable = (file: string) => {
  const resolved = path.resolve(file);
  const target = realpathSync(resolved);
  if (!lstatSync(target).isFile()) {
    throw new Error("Access probe Docker command must resolve to a file");
  }
  return resolved;
};

const syncDirectory = (directory: string) => {
  const descriptor = openSync(directory, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

const writeSealed = (file: string, value: string | Uint8Array) => {
  const descriptor = openSync(
    file,
    constants.O_CREAT + constants.O_EXCL + constants.O_WRONLY,
    0o600
  );
  try {
    writeFileSync(descriptor, value);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  syncDirectory(path.dirname(file));
};

const writeJson = (file: string, value: unknown) =>
  writeSealed(file, `${JSON.stringify(value, null, 2)}\n`);

const canonicalMounts = (mounts: readonly ContainerMount[]) =>
  mounts
    .map((mount) => ({ ...mount, hostPath: realpathSync(mount.hostPath) }))
    .toSorted((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    );

const readCreateMounts = (args: readonly string[]) => {
  const mounts: ContainerMount[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      argument === "--volume" ||
      argument === "-v" ||
      argument.startsWith("--volume=") ||
      (argument.startsWith("-v") && argument !== "--version") ||
      argument.startsWith("--mount=")
    ) {
      throw new Error("Container access probe refuses alternate mount syntax");
    }
    if (argument !== "--mount") {
      continue;
    }
    const specification = args[index + 1];
    if (!specification) {
      throw new Error("Container access probe create mount is incomplete");
    }
    index += 1;
    const fields = specification.split(",");
    const type = fields.filter((field) => field.startsWith("type="));
    const sources = fields.filter((field) => field.startsWith("src="));
    const destinations = fields.filter((field) => field.startsWith("dst="));
    if (
      fields.length !== 4 ||
      type.length !== 1 ||
      type[0] !== "type=bind" ||
      sources.length !== 1 ||
      destinations.length !== 1 ||
      fields.filter((field) => field === "readonly").length !== 1
    ) {
      throw new Error("Container access probe create mount changed");
    }
    mounts.push({
      containerPath: destinations[0].slice(4),
      hostPath: sources[0].slice(4),
      readOnly: true,
    });
  }
  return mounts;
};

export interface ContainerAccessProbeTarget {
  hostPath: string;
  pathClass: string;
}

export interface ContainerAccessProbeOptions {
  allowedFixture: string;
  deadlineAt: number;
  dockerCommand: string;
  dockerSha256: string;
  forbiddenSentinels: readonly ContainerAccessProbeTarget[];
  image: string;
  out: string;
}

interface ContainerAccessProbeRecord {
  hash: string | null;
  pathClass: string;
  status: "not-visible" | "readable";
}

interface ProbeDependencies {
  execute?: DockerExecutor;
  now: () => number;
}

const productionDependencies: ProbeDependencies = { now: Date.now };

const validateRecords = (
  stdout: string,
  fixtureSha256: string,
  targets: readonly ContainerAccessProbeTarget[]
) => {
  const records = stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ContainerAccessProbeRecord);
  const expectedClasses = [
    "allowed-fixture",
    ...targets.flatMap(({ pathClass }) => [
      `${pathClass}-direct`,
      `${pathClass}-proc-root`,
      `${pathClass}-host-mnt`,
    ]),
  ];
  if (
    records.length !== expectedClasses.length ||
    records.some(
      (record, index) =>
        record.pathClass !== expectedClasses[index] ||
        !["not-visible", "readable"].includes(record.status) ||
        (record.hash !== null && !HASH.test(record.hash))
    ) ||
    records[0]?.status !== "readable" ||
    records[0]?.hash !== fixtureSha256 ||
    records
      .slice(1)
      .some(({ hash, status }) => status !== "not-visible" || hash)
  ) {
    throw new Error("Container access probe observed unexpected reachability");
  }
  return records;
};

const validateControlEvidence = (
  evidence: DockerControlEvidence | null | undefined,
  expectedMounts: readonly ContainerMount[],
  image: string
) => {
  const inspected = evidence?.inspectResult.inspected;
  const actualMounts = inspected?.Mounts.map((mount) => ({
    containerPath: mount.Destination ?? "",
    hostPath: mount.Source ?? "",
    readOnly: mount.RW === false,
  }));
  const createArgs = evidence?.createRequest.args ?? [];
  const createMounts = readCreateMounts(createArgs);
  if (
    evidence?.createRequest.phase !== "create" ||
    evidence.inspectResult.phase !== "resolve-identity" ||
    evidence.inspectResult.code !== 0 ||
    inspected?.Config.Image !== image ||
    inspected.HostConfig.PidMode !== "" ||
    !actualMounts ||
    JSON.stringify(canonicalMounts(actualMounts)) !==
      JSON.stringify(canonicalMounts(expectedMounts)) ||
    JSON.stringify(canonicalMounts(createMounts)) !==
      JSON.stringify(canonicalMounts(expectedMounts)) ||
    !createArgs.includes("--network=none") ||
    !createArgs.includes("--read-only") ||
    !createArgs.includes("--cap-drop=ALL") ||
    !createArgs.includes("--security-opt=no-new-privileges") ||
    createArgs.some((argument) =>
      ["--env", "--privileged", "--pid=host"].includes(argument)
    )
  ) {
    throw new Error("Container access probe control evidence changed");
  }
};

/**
 * Run a no-network, no-credential reachability diagnostic. This checks one
 * Docker namespace shape only; it does not qualify a native reviewer runtime.
 */
// Validation, execution and crash-durable evidence sealing form one boundary.
// oxlint-disable-next-line eslint/complexity
export const runLocalContainerAccessProbe = async (
  options: ContainerAccessProbeOptions,
  dependencies: ProbeDependencies = productionDependencies
) => {
  const out = path.resolve(options.out);
  const dockerCommand = assertExecutable(options.dockerCommand);
  const allowedFixture = assertRegular(options.allowedFixture);
  const targets = options.forbiddenSentinels.map(({ hostPath, pathClass }) => ({
    hostPath: assertRegular(hostPath),
    pathClass,
  }));
  if (
    existsSync(out) ||
    !HASH.test(options.dockerSha256) ||
    digest(readFileSync(dockerCommand)) !== options.dockerSha256 ||
    !PINNED_IMAGE.test(options.image) ||
    !Number.isSafeInteger(options.deadlineAt) ||
    options.deadlineAt - dependencies.now() <= 10_000 ||
    !targets.length ||
    new Set(targets.map(({ pathClass }) => pathClass)).size !==
      targets.length ||
    targets.some(
      ({ hostPath, pathClass }) =>
        !CLASS.test(pathClass) || hostPath === allowedFixture
    )
  ) {
    throw new Error("Container access probe requires frozen bounded inputs");
  }

  mkdirSync(out, { mode: 0o700 });
  const inputDirectory = path.join(out, "input");
  const evidenceDirectory = path.join(out, "evidence");
  mkdirSync(inputDirectory, { mode: 0o700 });
  mkdirSync(evidenceDirectory, { mode: 0o700 });
  const scriptFile = path.join(inputDirectory, "probe.sh");
  const planFile = path.join(inputDirectory, "plan.tsv");
  const fixtureFile = path.join(inputDirectory, "allowed.fixture");
  writeSealed(scriptFile, PROBE_SCRIPT);
  writeSealed(
    planFile,
    `${targets.map(({ hostPath, pathClass }) => `${pathClass}\t${hostPath}`).join("\n")}\n`
  );
  writeSealed(fixtureFile, readFileSync(allowedFixture));

  const mounts = [
    {
      containerPath: CONTAINER_ROOT,
      hostPath: realpathSync(inputDirectory),
      readOnly: true,
    },
  ] as const;
  let identity: unknown = null;
  const execute =
    dependencies.execute ??
    dockerExecutor({
      command: dockerCommand,
      cwd: out,
      env: {},
      maxBuffer: 1024 * 1024,
    });
  const outcome = await runContainerProcess({
    args: [
      "/bin/sh",
      `${CONTAINER_ROOT}/probe.sh`,
      `${CONTAINER_ROOT}/plan.tsv`,
      `${CONTAINER_ROOT}/allowed.fixture`,
    ],
    cleanupReserveMs: 5000,
    containerName: `iconsmith-access-${randomUUID().slice(0, 12)}`,
    deadlineAt: options.deadlineAt,
    execute,
    image: options.image,
    mounts,
    network: "none",
    persistIdentity: (value) => {
      identity = value;
    },
  });

  writeJson(path.join(evidenceDirectory, "container-identity.json"), identity);
  writeJson(
    path.join(evidenceDirectory, "container-create-request.json"),
    outcome.controlEvidence?.createRequest ?? null
  );
  writeJson(
    path.join(evidenceDirectory, "container-inspect-result.json"),
    outcome.controlEvidence?.inspectResult ?? null
  );
  writeSealed(
    path.join(evidenceDirectory, "probe-stdout.jsonl"),
    outcome.process?.stdout ?? ""
  );
  writeJson(path.join(evidenceDirectory, "container-settlement.json"), outcome);

  let records: ContainerAccessProbeRecord[] = [];
  let failure: string | null = null;
  try {
    if (
      outcome.status !== "complete" ||
      outcome.artifactEligible !== true ||
      outcome.containerAbsent !== true ||
      outcome.process?.code !== 0 ||
      outcome.process.killed !== false ||
      outcome.process.stderr !== ""
    ) {
      throw new Error("Container access probe did not settle cleanly");
    }
    validateControlEvidence(outcome.controlEvidence, mounts, options.image);
    records = validateRecords(
      outcome.process.stdout,
      digest(readFileSync(fixtureFile)),
      targets
    );
  } catch (error) {
    failure = String(error);
  }

  const evidenceFiles = [
    scriptFile,
    planFile,
    fixtureFile,
    ...[
      "container-identity.json",
      "container-create-request.json",
      "container-inspect-result.json",
      "probe-stdout.jsonl",
      "container-settlement.json",
    ].map((file) => path.join(evidenceDirectory, file)),
  ];
  const receipt = {
    accessVerified: failure === null,
    allowedMounts: mounts,
    dockerCommandSha256: options.dockerSha256,
    evidence: Object.fromEntries(
      evidenceFiles.map((file) => [
        path.relative(out, file),
        digest(readFileSync(file)),
      ])
    ),
    failure,
    forbiddenObservationCount: records.length - (records.length ? 1 : 0),
    image: options.image,
    kind: "offline-container-access-probe-v2",
    network: "none",
    productionEligible: false,
    providerCalls: 0,
  };
  writeJson(path.join(out, "receipt.json"), receipt);
  syncDirectory(out);
  if (failure) {
    throw new Error(failure);
  }
  return Object.freeze({
    receipt,
    receiptFile: path.join(out, "receipt.json"),
    records,
  });
};

/** Freeze actual executables and geometry dependencies, not only command names. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import { subscriptionEnv } from "../src/pipeline/harness.js";
import { runtimePackages } from "./local-runtime.js";

const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export const resolveExecutable = (
  command: string,
  searchPath = process.env.PATH ?? ""
) => {
  const candidates = command.includes(path.sep)
    ? [path.resolve(command)]
    : searchPath
        .split(path.delimiter)
        .filter(Boolean)
        .map((dir) => path.resolve(dir, command));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Try the next PATH entry; absence must fail before provider dispatch.
    }
  }
  throw new Error(`Executable unavailable for runtime freeze: ${command}`);
};

export const executableIdentity = (
  command: string,
  executionEnv: NodeJS.ProcessEnv = subscriptionEnv(process.env)
) => {
  const executable = resolveExecutable(command, executionEnv.PATH ?? "");
  const sha256 = hash(readFileSync(executable));
  const version = spawnSync(executable, ["--version"], {
    encoding: "utf-8",
    env: executionEnv,
    maxBuffer: 64 * 1024,
    timeout: 10_000,
  });
  if (version.status !== 0 || !version.stdout.trim()) {
    throw new Error(`Cannot read frozen executable version: ${command}`);
  }
  if (sha256 !== hash(readFileSync(executable))) {
    throw new Error(`Executable changed during runtime freeze: ${command}`);
  }
  return { command, executable, sha256, version: version.stdout.trim() };
};

const filesIn = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : filesIn(file);
    }
    return /\.(?:[cm]?js|json|wasm|node|dylib|dll|so(?:\.\d+)*)$/u.test(
      entry.name
    )
      ? [file]
      : [];
  });

export const captureRuntimeIdentity = (
  authorCommand: string,
  reviewerCommand = "claude",
  executionEnv: NodeJS.ProcessEnv = subscriptionEnv(process.env)
) => {
  const dependencies = runtimePackages(
    ["paper", "pathkit-wasm", "sharp", "tsx"],
    import.meta.dirname
  )
    .toSorted((a, b) => a.directory.localeCompare(b.directory))
    .map((pkg) => ({
      ...pkg,
      files: filesIn(pkg.directory)
        .toSorted()
        .map((file) => ({
          file: path.relative(pkg.directory, file),
          sha256: hash(readFileSync(file)),
        })),
    }));
  const manifest = {
    architecture: process.arch,
    author: executableIdentity(authorCommand, executionEnv),
    dependencies,
    node: {
      executable: realpathSync(process.execPath),
      sha256: hash(readFileSync(process.execPath)),
      versions: process.versions,
    },
    platform: process.platform,
    reviewer: executableIdentity(reviewerCommand, executionEnv),
    schemaVersion: 2,
    searchPath: executionEnv.PATH ?? "",
  };
  return { hash: hash(JSON.stringify(manifest)), manifest };
};

export const verifyRuntimeIdentity = (
  expected: ReturnType<typeof captureRuntimeIdentity>,
  executionEnv: NodeJS.ProcessEnv = subscriptionEnv(process.env)
) => {
  if (hash(JSON.stringify(expected.manifest)) !== expected.hash) {
    throw new Error("Frozen runtime manifest hash is invalid");
  }
  const actual = captureRuntimeIdentity(
    expected.manifest.author.command,
    expected.manifest.reviewer.command,
    executionEnv
  );
  if (actual.hash !== expected.hash) {
    throw new Error("External runtime changed since experiment freeze");
  }
  return actual;
};

export interface CanonicalLaunchInput {
  args: readonly string[];
  command: string;
  concurrency: number;
  cwd: string;
  deadlineAt: number;
  identity: {
    configHash: string;
    effort: string;
    model: string;
    routeHash: string;
  };
  sourceFiles: readonly string[];
  /** Complete directory populations, including added and removed files. */
  sourceTrees?: readonly string[];
}

const captureSourceTree = (directory: string) => {
  const root = path.resolve(directory);
  const visit = (relative: string): { file: string; sha256: string }[] => {
    const file = path.join(root, relative);
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) {
      throw new Error("Launch source trees cannot contain symlinks");
    }
    if (stat.isDirectory()) {
      return readdirSync(file)
        .toSorted()
        .flatMap((name) => visit(path.join(relative, name)));
    }
    if (!stat.isFile()) {
      throw new Error("Launch source trees require regular files");
    }
    return [{ file: relative, sha256: hash(readFileSync(file)) }];
  };
  if (!lstatSync(root).isDirectory()) {
    throw new Error("Launch source tree must be a directory");
  }
  return { directory: root, files: visit(""), realPath: realpathSync(root) };
};

/** The descriptor is the dispatch input, never a second copied command. */
export const captureLaunchDescriptor = (input: CanonicalLaunchInput) => {
  if (
    !Number.isSafeInteger(input.concurrency) ||
    input.concurrency < 1 ||
    !Number.isSafeInteger(input.deadlineAt) ||
    input.deadlineAt <= Date.now() ||
    !input.identity.model.trim() ||
    !input.identity.effort.trim() ||
    !/^[a-f0-9]{64}$/u.test(input.identity.configHash) ||
    !/^[a-f0-9]{64}$/u.test(input.identity.routeHash) ||
    input.args.some((arg) => typeof arg !== "string" || arg.includes("\0")) ||
    input.sourceFiles.length === 0
  ) {
    throw new Error("Launch descriptor needs a complete bounded identity");
  }
  const executable = resolveExecutable(input.command);
  const files = [
    ...new Set(input.sourceFiles.map((file) => path.resolve(file))),
  ].toSorted();
  const descriptor = {
    args: [...input.args],
    concurrency: input.concurrency,
    cwd: realpathSync(input.cwd),
    deadlineAt: input.deadlineAt,
    executable,
    executableSha256: hash(readFileSync(executable)),
    identity: { ...input.identity },
    schemaVersion: 2,
    sourceFiles: files.map((file) => ({
      file,
      realPath: realpathSync(file),
      sha256: hash(readFileSync(file)),
    })),
    sourceTrees: [...new Set(input.sourceTrees)]
      .map((directory) => path.resolve(directory))
      .toSorted()
      .map(captureSourceTree),
  };
  return { descriptor, hash: hash(JSON.stringify(descriptor)) };
};

export type CanonicalLaunch = ReturnType<typeof captureLaunchDescriptor>;

export const verifyLaunchDescriptor = (launch: CanonicalLaunch) => {
  if (hash(JSON.stringify(launch.descriptor)) !== launch.hash) {
    throw new Error("Launch descriptor hash mismatch");
  }
  const current = captureLaunchDescriptor({
    ...launch.descriptor,
    command: launch.descriptor.executable,
    sourceFiles: launch.descriptor.sourceFiles.map(({ file }) => file),
    sourceTrees: launch.descriptor.sourceTrees.map(
      ({ directory }) => directory
    ),
  });
  if (current.hash !== launch.hash) {
    throw new Error(
      "Launch executable or source closure changed before dispatch"
    );
  }
  return current.descriptor;
};

/** Only descriptor-owned argv/cwd can reach the executor. The caller supplies
 * its containment implementation; this helper does not prove settlement. */
export const executeLaunchDescriptor = <T>(
  launch: CanonicalLaunch,
  execute: (descriptor: CanonicalLaunch["descriptor"]) => T
): T => execute(verifyLaunchDescriptor(launch));

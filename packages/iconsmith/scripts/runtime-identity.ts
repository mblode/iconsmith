/** Freeze actual executables and geometry dependencies, not only command names. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
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

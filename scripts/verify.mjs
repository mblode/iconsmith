#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_STAGES = Object.freeze([
  Object.freeze({ id: "test", command: "npm", args: ["run", "test"] }),
  Object.freeze({
    id: "typecheck",
    command: "npm",
    args: ["run", "typecheck"],
  }),
  Object.freeze({ id: "build", command: "npm", args: ["run", "build"] }),
  Object.freeze({ id: "check", command: "npm", args: ["run", "check"] }),
  Object.freeze({ id: "diff", command: "git", args: ["diff", "--check"] }),
]);

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".md",
  ".mjs",
  ".mts",
  ".py",
  ".scss",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const SOURCE_BASENAMES = new Set([
  ".editorconfig",
  ".gitignore",
  ".npmrc",
  "AGENTS.md",
  "Dockerfile",
]);

const EXCLUDED_PREFIXES = [
  ".git/",
  ".staging/",
  "docs/",
  "packages/iconsmith/.corpus/",
  "packages/iconsmith/corpus/",
];

const EXCLUDED_SEGMENTS = new Set([
  ".next",
  ".staging",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "output",
  "outputs",
]);

const CORPUS_REQUIREMENTS = Object.freeze([
  { path: "packages/iconsmith/corpus/corpus.json", kind: "file" },
  { path: "packages/iconsmith/.corpus/icons.jsonl", kind: "file" },
  {
    path: "packages/iconsmith/corpus/round-outlined-radius-3-stroke-2",
    kind: "directory",
  },
  {
    path: "packages/iconsmith/corpus/round-outlined-radius-3-stroke-2/pull-request.svg",
    kind: "file",
  },
  {
    path: "packages/iconsmith/corpus/round-outlined-radius-3-stroke-2/plus-large.svg",
    kind: "file",
  },
  {
    path: "packages/iconsmith/corpus/round-filled-radius-3-stroke-2/bell.svg",
    kind: "file",
  },
]);

export class VerificationError extends Error {
  constructor(message, { code, outputDirectory, receipt } = {}) {
    super(message);
    this.name = "VerificationError";
    this.code = code;
    this.outputDirectory = outputDirectory;
    this.receipt = receipt;
  }
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const sha256File = async (file) =>
  await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(file);
    input.on("data", (chunk) => hash.update(chunk));
    input.once("error", reject);
    input.once("end", () => resolve(hash.digest("hex")));
  });

const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

const isSourcePath = (relativePath) => {
  const normalized = relativePath.replaceAll(path.sep, "/");
  if (
    EXCLUDED_PREFIXES.some(
      (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
    )
  ) {
    return false;
  }
  if (
    normalized.split("/").some((segment) => EXCLUDED_SEGMENTS.has(segment)) ||
    path.posix.basename(normalized) === "next-env.d.ts"
  ) {
    return false;
  }
  return (
    SOURCE_BASENAMES.has(path.posix.basename(normalized)) ||
    SOURCE_EXTENSIONS.has(path.posix.extname(normalized))
  );
};

const gitSourcePaths = (cwd) => {
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `git ls-files failed with exit ${String(result.status)}: ${result.stderr.toString("utf8")}`,
    );
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter(isSourcePath)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
};

const snapshotSources = async (cwd) => {
  const files = [];
  for (const relativePath of gitSourcePaths(cwd)) {
    const absolutePath = path.join(cwd, relativePath);
    try {
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        const target = await readlink(absolutePath);
        const contents = await readFile(absolutePath);
        files.push({
          path: relativePath,
          kind: "symlink",
          target,
          size: contents.byteLength,
          sha256: sha256(Buffer.concat([Buffer.from(target), Buffer.from([0]), contents])),
        });
      } else if (metadata.isFile()) {
        const contents = await readFile(absolutePath);
        files.push({
          path: relativePath,
          kind: "file",
          size: contents.byteLength,
          sha256: sha256(contents),
        });
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        files.push({ path: relativePath, kind: "missing", size: 0, sha256: null });
      } else {
        throw error;
      }
    }
  }
  return {
    algorithm: "sha256",
    fileCount: files.length,
    aggregateSha256: sha256(JSON.stringify(files)),
    files,
  };
};

const inspectCorpus = async (cwd) => {
  const missing = [];
  for (const requirement of CORPUS_REQUIREMENTS) {
    try {
      const metadata = await stat(path.join(cwd, requirement.path));
      const matches = requirement.kind === "file" ? metadata.isFile() : metadata.isDirectory();
      if (!matches) missing.push({ ...requirement, reason: "wrong-kind" });
    } catch (error) {
      if (error?.code === "ENOENT") {
        missing.push({ ...requirement, reason: "missing" });
      } else {
        throw error;
      }
    }
  }
  return {
    available: missing.length === 0,
    requirements: CORPUS_REQUIREMENTS,
    missing,
  };
};

export const executeStage = async (stage, { cwd, logFile }) => {
  return await new Promise((resolve, reject) => {
    const output = createWriteStream(logFile, { flags: "wx" });
    const child = spawn(stage.command, stage.args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let failure;
    child.stdout.on("data", (chunk) => {
      if (!output.destroyed) output.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (!output.destroyed) output.write(chunk);
    });
    child.once("error", (error) => {
      failure ??= error;
    });
    output.once("error", (error) => {
      failure ??= error;
      child.kill("SIGTERM");
    });
    child.once("close", (code, signal) => {
      if (failure) {
        output.destroy();
        reject(failure);
        return;
      }
      output.end(() => resolve({ exitCode: code, signal }));
    });
  });
};

const createOutputDirectory = async (cwd, requestedOutput, idFactory, lockDirectory) => {
  const outputDirectory = requestedOutput
    ? path.resolve(cwd, requestedOutput)
    : path.join(
        cwd,
        ".staging",
        `verification-${new Date().toISOString().replaceAll(":", "-")}-${idFactory()}`,
      );
  if (outputDirectory === cwd) {
    throw new VerificationError("The verification output cannot be the repository root.", {
      code: "invalid-output",
    });
  }
  if (
    outputDirectory === lockDirectory ||
    outputDirectory.startsWith(`${lockDirectory}${path.sep}`)
  ) {
    throw new VerificationError("The verification output cannot be inside its lock.", {
      code: "invalid-output",
      outputDirectory,
    });
  }
  await mkdir(path.dirname(outputDirectory), { recursive: true });
  try {
    await mkdir(outputDirectory);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new VerificationError(`Verification output already exists: ${outputDirectory}`, {
        code: "output-exists",
        outputDirectory,
      });
    }
    throw error;
  }
  return outputDirectory;
};

const acquireLock = async (cwd, token, startedAt) => {
  const stagingDirectory = path.join(cwd, ".staging");
  const lockDirectory = path.join(stagingDirectory, ".verify.lock");
  await mkdir(stagingDirectory, { recursive: true });
  try {
    await mkdir(lockDirectory);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new VerificationError(
        `Another verification owns ${path.relative(cwd, lockDirectory)}. The lock must be removed explicitly after its owner is known to have stopped.`,
        { code: "verification-locked" },
      );
    }
    throw error;
  }
  await writeFile(
    path.join(lockDirectory, "owner.json"),
    canonicalJson({ token, pid: process.pid, startedAt }),
    { flag: "wx" },
  ).catch(async (error) => {
    await rm(lockDirectory, { recursive: true });
    throw error;
  });
  return lockDirectory;
};

const releaseOwnedLock = async (lockDirectory, token) => {
  if (!lockDirectory) return;
  try {
    const owner = JSON.parse(await readFile(path.join(lockDirectory, "owner.json"), "utf8"));
    if (owner.token === token) {
      await rm(lockDirectory, { recursive: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};

const writeImmutableJson = async (file, value) => {
  await writeFile(file, canonicalJson(value), { flag: "wx" });
  const contents = await readFile(file);
  return { path: file, sha256: sha256(contents) };
};

export const runVerification = async ({
  cwd = process.cwd(),
  out,
  stages = DEFAULT_STAGES,
  runStage = executeStage,
  takeSourceSnapshot = snapshotSources,
  checkCorpus = inspectCorpus,
  allowMissingCorpus = false,
  clock = () => Date.now(),
  idFactory = randomUUID,
} = {}) => {
  const repositoryRoot = path.resolve(cwd);
  const token = idFactory();
  const startedMs = clock();
  const startedAt = new Date(startedMs).toISOString();
  let lockDirectory;
  let outputDirectory;
  let receipt;
  let corpus;
  const stageResults = [];

  try {
    lockDirectory = await acquireLock(repositoryRoot, token, startedAt);
    outputDirectory = await createOutputDirectory(repositoryRoot, out, idFactory, lockDirectory);

    corpus = await checkCorpus(repositoryRoot);
    const sourceBefore = await takeSourceSnapshot(repositoryRoot);
    const beforeManifest = await writeImmutableJson(
      path.join(outputDirectory, "source-before.json"),
      sourceBefore,
    );
    for (const [index, stage] of stages.entries()) {
      if (!corpus.available && !allowMissingCorpus) break;
      const stageStartedMs = clock();
      const logFile = path.join(
        outputDirectory,
        `${String(index + 1).padStart(2, "0")}-${stage.id}.log`,
      );
      let execution;
      let executionError;
      try {
        execution = await runStage(stage, {
          cwd: repositoryRoot,
          logFile,
        });
      } catch (error) {
        executionError = error;
        try {
          await writeFile(logFile, `${error?.stack ?? String(error)}\n`, { flag: "wx" });
        } catch (writeError) {
          if (writeError?.code !== "EEXIST") throw writeError;
        }
      }
      const stageFinishedMs = clock();
      const logMetadata = await stat(logFile);
      const exitCode = executionError ? null : (execution?.exitCode ?? null);
      const passed = !executionError && exitCode === 0;
      stageResults.push({
        id: stage.id,
        command: [stage.command, ...stage.args],
        startedAt: new Date(stageStartedMs).toISOString(),
        finishedAt: new Date(stageFinishedMs).toISOString(),
        durationMs: Math.max(0, stageFinishedMs - stageStartedMs),
        exitCode,
        signal: execution?.signal ?? null,
        error: executionError ? String(executionError.message ?? executionError) : null,
        passed,
        log: {
          path: path.relative(repositoryRoot, logFile),
          bytes: logMetadata.size,
          sha256: await sha256File(logFile),
        },
      });
      if (!passed) break;
    }

    const sourceAfter = await takeSourceSnapshot(repositoryRoot);
    const afterManifest = await writeImmutableJson(
      path.join(outputDirectory, "source-after.json"),
      sourceAfter,
    );
    const sourceStable =
      sourceBefore.aggregateSha256 === sourceAfter.aggregateSha256 &&
      JSON.stringify(sourceBefore.files) === JSON.stringify(sourceAfter.files);
    const stagesPassed =
      stageResults.length === stages.length && stageResults.every((stage) => stage.passed);
    const corpusBlocked = !corpus.available && !allowMissingCorpus;
    const status = corpusBlocked
      ? sourceStable
        ? "corpus-unavailable"
        : "corpus-unavailable-and-source-drift"
      : sourceStable
        ? stagesPassed
          ? "passed"
          : "failed-stage"
        : stagesPassed
          ? "source-drift"
          : "failed-stage-and-source-drift";
    const finishedMs = clock();
    receipt = {
      schema: "iconsmith-verification-v1",
      status,
      startedAt,
      finishedAt: new Date(finishedMs).toISOString(),
      durationMs: Math.max(0, finishedMs - startedMs),
      repositoryRoot,
      outputDirectory,
      lock: { path: path.relative(repositoryRoot, lockDirectory), token },
      corpus: {
        available: corpus.available,
        missingAllowed: allowMissingCorpus,
        requirements: corpus.requirements,
        missing: corpus.missing,
        measurementsAvailable: corpus.available,
      },
      source: {
        stable: sourceStable,
        before: {
          aggregateSha256: sourceBefore.aggregateSha256,
          manifestPath: path.relative(repositoryRoot, beforeManifest.path),
          manifestSha256: beforeManifest.sha256,
        },
        after: {
          aggregateSha256: sourceAfter.aggregateSha256,
          manifestPath: path.relative(repositoryRoot, afterManifest.path),
          manifestSha256: afterManifest.sha256,
        },
      },
      stages: stageResults,
    };
    await writeImmutableJson(path.join(outputDirectory, "receipt.json"), receipt);

    if (status !== "passed") {
      throw new VerificationError(`Verification ended with status ${status}.`, {
        code: status,
        outputDirectory,
        receipt,
      });
    }
    return receipt;
  } catch (error) {
    if (outputDirectory && !receipt) {
      const finishedMs = clock();
      receipt = {
        schema: "iconsmith-verification-v1",
        status: "setup-error",
        startedAt,
        finishedAt: new Date(finishedMs).toISOString(),
        durationMs: Math.max(0, finishedMs - startedMs),
        repositoryRoot,
        outputDirectory,
        lock: { path: path.relative(repositoryRoot, lockDirectory), token },
        corpus: corpus
          ? {
              available: corpus.available,
              missingAllowed: allowMissingCorpus,
              requirements: corpus.requirements,
              missing: corpus.missing,
              measurementsAvailable: corpus.available,
            }
          : null,
        error: {
          name: String(error?.name ?? "Error"),
          message: String(error?.message ?? error),
        },
        stages: stageResults,
      };
      await writeImmutableJson(path.join(outputDirectory, "receipt.json"), receipt);
      throw new VerificationError("Verification setup failed.", {
        code: "setup-error",
        outputDirectory,
        receipt,
      });
    }
    throw error;
  } finally {
    await releaseOwnedLock(lockDirectory, token);
  }
};

const HELP = `Usage: node scripts/verify.mjs [--out <directory>] [--allow-missing-corpus]\n\nRuns the repository's fixed verification stages sequentially:\n  npm run test\n  npm run typecheck\n  npm run build\n  npm run check\n  git diff --check\n\nOptions:\n  --out <directory>       Write evidence to a new directory (default: unique .staging path)\n  --allow-missing-corpus  Continue with corpus measurements marked unavailable (for cloud CI)\n  --help                  Show this help\n`;

const parseArguments = (arguments_) => {
  let out;
  let allowMissingCorpus = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") return { help: true };
    if (argument === "--allow-missing-corpus") {
      allowMissingCorpus = true;
      continue;
    }
    if (argument === "--out") {
      const value = arguments_[index + 1];
      if (!value || value.startsWith("--")) {
        throw new VerificationError("--out requires a directory.", {
          code: "invalid-arguments",
        });
      }
      out = value;
      index += 1;
      continue;
    }
    throw new VerificationError(`Unknown argument: ${argument}`, {
      code: "invalid-arguments",
    });
  }
  return { help: false, out, allowMissingCorpus };
};

const main = async (arguments_ = process.argv.slice(2)) => {
  const options = parseArguments(arguments_);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  try {
    const receipt = await runVerification({
      out: options.out,
      allowMissingCorpus: options.allowMissingCorpus,
    });
    process.stdout.write(`${receipt.outputDirectory}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    if (error.outputDirectory) {
      process.stderr.write(`Evidence: ${error.outputDirectory}\n`);
    }
    return 1;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}

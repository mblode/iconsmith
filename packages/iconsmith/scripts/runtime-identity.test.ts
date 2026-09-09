import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import {
  captureLaunchDescriptor,
  executeLaunchDescriptor,
  verifyLaunchDescriptor,
  captureRuntimeIdentity,
  executableIdentity,
  resolveExecutable,
  verifyRuntimeIdentity,
} from "./runtime-identity.js";

test("freezes resolved executable bytes and rejects changed binaries even at the same version", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "iconsmith-runtime-"));
  try {
    const binary = path.join(dir, "native");
    writeFileSync(binary, "#!/bin/sh\necho fixture-v1\n", { mode: 0o755 });
    const alias = path.join(dir, "alias");
    symlinkSync(binary, alias);
    expect(resolveExecutable("alias", dir)).toBe(realpathSync(binary));
    const frozen = captureRuntimeIdentity(alias, binary);
    expect(verifyRuntimeIdentity(frozen)).toEqual(frozen);
    writeFileSync(
      binary,
      "#!/bin/sh\n# changed implementation\necho fixture-v1\n"
    );
    expect(executableIdentity(alias).version).toBe("fixture-v1");
    expect(() => verifyRuntimeIdentity(frozen)).toThrow("runtime changed");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("unavailable or unverifiable commands fail before dispatch", () => {
  expect(() => resolveExecutable("missing-iconsmith-runtime", "")).toThrow(
    "unavailable"
  );
  expect(() => executableIdentity("/usr/bin/false")).toThrow("version");
});

test("freezes the execution PATH and probes versions under that same environment", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "iconsmith-runtime-path-"));
  try {
    const authorBin = path.join(dir, "author-bin");
    const changedBin = path.join(dir, "changed-bin");
    mkdirSync(authorBin);
    mkdirSync(changedBin);
    for (const folder of [authorBin, changedBin]) {
      writeFileSync(
        path.join(folder, "reviewer"),
        '#!/bin/sh\necho "fixture-$ICONSMITH_TEST_VERSION"\n',
        { mode: 0o755 }
      );
    }
    const executionEnv = { ICONSMITH_TEST_VERSION: "native", PATH: authorBin };
    const frozen = captureRuntimeIdentity("reviewer", "reviewer", executionEnv);
    expect(frozen.manifest.author.executable).toBe(
      realpathSync(path.join(authorBin, "reviewer"))
    );
    expect(frozen.manifest.author.version).toBe("fixture-native");
    expect(verifyRuntimeIdentity(frozen, executionEnv)).toEqual(frozen);
    expect(() =>
      verifyRuntimeIdentity(frozen, { ...executionEnv, PATH: changedBin })
    ).toThrow("runtime changed");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

// Canonical launch regression coverage is kept with executable freeze checks.

test("launch binds the complete library population before dispatch", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "iconsmith-library-launch-"));
  try {
    const library = path.join(dir, "library");
    mkdirSync(library);
    const source = path.join(library, "heart.svg");
    const original = "<svg/>";
    writeFileSync(source, original);
    const input = {
      args: ["--library", library],
      command: process.execPath,
      concurrency: 1,
      cwd: dir,
      deadlineAt: Date.now() + 60_000,
      identity: {
        configHash: "a".repeat(64),
        effort: "high",
        model: "test-model",
        routeHash: "b".repeat(64),
      },
      sourceFiles: [source],
      sourceTrees: [library],
    };
    const launch = captureLaunchDescriptor(input);
    expect(verifyLaunchDescriptor(launch).sourceTrees[0]?.files).toHaveLength(
      1
    );
    let dispatched = false;
    const refuses = () => {
      expect(() =>
        executeLaunchDescriptor(launch, () => {
          dispatched = true;
        })
      ).toThrow();
      expect(dispatched).toBe(false);
    };
    writeFileSync(source, "<svg>changed</svg>");
    refuses();
    writeFileSync(source, original);
    const added = path.join(library, "new.svg");
    writeFileSync(added, original);
    refuses();
    rmSync(added);
    const linked = path.join(library, "linked.svg");
    symlinkSync(source, linked);
    refuses();
    rmSync(linked);
    rmSync(source);
    refuses();
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("launch dispatch uses frozen argv and rejects copied metadata, expired deadlines and source drift", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "iconsmith-launch-"));
  try {
    const source = path.join(dir, "entry.mjs");
    writeFileSync(source, "export const version = 1;");
    const input = {
      args: [source, "--manifest", "current.json"],
      command: process.execPath,
      concurrency: 1,
      cwd: dir,
      deadlineAt: Date.now() + 60_000,
      identity: {
        configHash: "a".repeat(64),
        effort: "high",
        model: "test-exact-model",
        routeHash: "b".repeat(64),
      },
      sourceFiles: [source],
    };
    const launch = captureLaunchDescriptor(input);
    expect(
      executeLaunchDescriptor(launch, (descriptor) => descriptor.args)
    ).toEqual(input.args);
    expect(() =>
      verifyLaunchDescriptor({
        ...launch,
        descriptor: {
          ...launch.descriptor,
          args: [source, "--manifest", "old.json"],
        },
      })
    ).toThrow("hash mismatch");
    expect(() =>
      verifyLaunchDescriptor({
        ...launch,
        descriptor: { ...launch.descriptor, concurrency: 2 },
      })
    ).toThrow("hash mismatch");
    expect(() =>
      captureLaunchDescriptor({ ...input, deadlineAt: Date.now() - 1 })
    ).toThrow("bounded identity");
    const alias = path.join(dir, "entry-alias.mjs");
    const replacement = path.join(dir, "replacement.mjs");
    writeFileSync(replacement, "export const version = 1;");
    symlinkSync(source, alias);
    const aliasedLaunch = captureLaunchDescriptor({
      ...input,
      sourceFiles: [alias],
    });
    rmSync(alias);
    symlinkSync(replacement, alias);
    expect(() => verifyLaunchDescriptor(aliasedLaunch)).toThrow(
      "source closure changed"
    );
    writeFileSync(source, "export const version = 2;");
    let dispatched = false;
    expect(() =>
      executeLaunchDescriptor(launch, () => {
        dispatched = true;
      })
    ).toThrow("source closure changed");
    expect(dispatched).toBe(false);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

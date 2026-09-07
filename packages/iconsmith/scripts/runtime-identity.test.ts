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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { runtimePackages, validateRuntimeProbe } from "./local-runtime.js";

const valid = {
  insideRead: "allowed",
  insideWrite: "allowed",
  network: "EPERM",
  outsideRead: "EPERM",
  outsideWrite: "EPERM",
  sourceRead: "EPERM",
  symlinkRead: "EPERM",
};

it("requires positive access controls as well as actual permission denials", () => {
  expect(validateRuntimeProbe(valid)).toEqual(valid);
  expect(() =>
    validateRuntimeProbe({ ...valid, insideRead: "EPERM" })
  ).toThrow();
});
it.each([
  "outsideRead",
  "outsideWrite",
  "sourceRead",
  "symlinkRead",
  "network",
])("refuses an unenforced or missing boundary: %s", (key) => {
  expect(() => validateRuntimeProbe({ ...valid, [key]: "allowed" })).toThrow();
  expect(() => validateRuntimeProbe({ ...valid, [key]: undefined })).toThrow();
  // Missing files or a closed server do not demonstrate policy enforcement.
  expect(() => validateRuntimeProbe({ ...valid, [key]: "ENOENT" })).toThrow();
  expect(() =>
    validateRuntimeProbe({ ...valid, [key]: "ECONNREFUSED" })
  ).toThrow();
});

it("admits installed native assets with export-only subpaths without granting unrelated packages", () => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-runtime-"));
  const save = (name: string, data: object) => {
    const dir = path.join(root, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name, version: "1.0.0", ...data })
    );
  };
  try {
    save("viewer", {
      dependencies: { "runtime-js": "1" },
      optionalDependencies: { "native-binary": "1", "other-platform": "1" },
    });
    save("runtime-js", {});
    save("native-binary", { exports: { "./binary.node": "./binary.node" } });
    save("unrelated-icons", {});
    expect(runtimePackages(["viewer"], root).map((pkg) => pkg.name)).toEqual([
      "viewer",
      "runtime-js",
      "native-binary",
    ]);
    expect(() => runtimePackages(["missing-required"], root)).toThrow(
      "Missing checker dependency"
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

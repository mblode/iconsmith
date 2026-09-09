import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import { STYLE_COMPILER } from "../src/pipeline/style.js";
import { SPEC } from "../src/tools/canvas.js";
import { BLODE_ICONS_SVG_URL } from "./blode-icons.js";

const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
const houseSource = new URL("branch-simple.svg", BLODE_ICONS_SVG_URL);
const cli = new URL("source-exact-cli.ts", import.meta.url);
const tsx = createRequire(import.meta.url).resolve("tsx/cli");

const runCli = (args: string[]) =>
  execFileSync(process.execPath, [tsx, cli.pathname, ...args], {
    encoding: "utf-8",
  });

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const styleHashForTest = (value: unknown): string => sha256(canonical(value));

test.skipIf(!existsSync(houseSource))(
  "fresh CLI processes compile and exactly replay one host-admitted source",
  () => {
    const dir = mkdtempSync(path.join(tmpdir(), "iconsmith-source-exact-cli-"));
    const sourcePath = path.join(dir, "branch-simple.svg");
    const revisionPath = path.join(dir, "revision.json");
    const manifestPath = path.join(dir, "manifest.json");
    copyFileSync(houseSource, sourcePath);
    const revision = {
      calibration: "unvalidated",
      compiler: STYLE_COMPILER,
      id: "source-exact-cli-test",
      masters: { "24": SPEC },
      parts: [],
      policy: DEFAULT_POLICY,
      references: [],
      rubric: "test",
    };
    const revisionText = `${JSON.stringify(revision, null, 2)}\n`;
    writeFileSync(revisionPath, revisionText);
    const manifest = {
      compiler: STYLE_COMPILER,
      finish: "outlined",
      master: "24",
      representation: "indexed",
      requestSha256: "1".repeat(64),
      revisionPath: "revision.json",
      revisionSha256: sha256(revisionText),
      schema: "iconsmith-source-exact-host-v1",
      sourceName: "branch-simple",
      sourcePath: "branch-simple.svg",
      sourceProvenance: {
        date: "2026-09-07",
        licenses: ["MIT"],
        origin: "literal",
        set: "blode-icons",
      },
      sourceSha256: sha256(readFileSync(sourcePath)),
    };
    const writeManifest = (file: string, value = manifest) => {
      const text = `${JSON.stringify(value, null, 2)}\n`;
      writeFileSync(file, text);
      return sha256(text);
    };
    const manifestSha256 = writeManifest(manifestPath);
    const resolved = JSON.parse(
      runCli(["resolve", manifestPath, manifestSha256])
    ) as { bindingId: string; registryHash: string };
    const programPath = path.join(dir, "branch-simple.icon");
    const bundlePath = path.join(dir, "bundle.json");
    const replayPath = path.join(dir, "replay.svg");
    writeFileSync(
      programPath,
      `icon branch-simple\nfinish outlined\nsource-exact ${resolved.bindingId}\n`
    );
    runCli(["compile", manifestPath, manifestSha256, programPath, bundlePath]);
    runCli(["replay", manifestPath, manifestSha256, bundlePath, replayPath]);
    const bundle = JSON.parse(readFileSync(bundlePath, "utf-8")) as {
      artifact: { sourceExactRegistryHash: string; svg: string };
      revision: unknown;
      revisionHash: string;
    };
    expect(bundle.artifact.sourceExactRegistryHash).toBe(resolved.registryHash);
    expect(styleHashForTest(bundle.revision)).toBe(bundle.revisionHash);
    expect(readFileSync(replayPath, "utf-8")).toBe(`${bundle.artifact.svg}\n`);

    writeFileSync(sourcePath, `${readFileSync(sourcePath, "utf-8")}\n`);
    expect(() => runCli(["resolve", manifestPath, manifestSha256])).toThrow(
      /source SVG sha256 mismatch/u
    );
    copyFileSync(houseSource, sourcePath);

    for (const [label, changed, error] of [
      [
        "master",
        { ...manifest, master: "16" },
        "pinned source-feature profile",
      ],
      [
        "namespace",
        {
          ...manifest,
          sourceProvenance: { ...manifest.sourceProvenance, set: "central" },
        },
        "pinned source-feature profile",
      ],
    ] as const) {
      const changedPath = path.join(dir, `${label}.json`);
      const changedSha = writeManifest(changedPath, changed);
      expect(() => runCli(["resolve", changedPath, changedSha])).toThrow(
        new RegExp(error, "u")
      );
    }

    const otherRequestPath = path.join(dir, "other-request.json");
    const otherRequestSha = writeManifest(otherRequestPath, {
      ...manifest,
      requestSha256: "2".repeat(64),
    });
    expect(() =>
      runCli([
        "replay",
        otherRequestPath,
        otherRequestSha,
        bundlePath,
        path.join(dir, "bad.svg"),
      ])
    ).toThrow(/bundle identity differs from host authority/u);

    const movedManifestPath = path.join(dir, "moved-manifest.json");
    copyFileSync(manifestPath, movedManifestPath);
    expect(() =>
      runCli([
        "replay",
        movedManifestPath,
        manifestSha256,
        bundlePath,
        path.join(dir, "moved.svg"),
      ])
    ).toThrow(/bundle identity differs from host authority/u);
  },
  120_000
);

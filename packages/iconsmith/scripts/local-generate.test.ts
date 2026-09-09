import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import { createStyleRevision, STYLE_COMPILER } from "../src/pipeline/style.js";
import { SPEC } from "../src/tools/canvas.js";

test("help works outside the checkout without agent credentials or output creation", () => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-generate-help-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        path.resolve(import.meta.dirname, "local-generate.ts"),
        "--help",
      ],
      {
        cwd: root,
        encoding: "utf-8",
        env: { HOME: root, PATH: "", TMPDIR: root },
      }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("--codex <executable>");
    expect(result.stdout).toContain("--model <id>");
    expect(result.stdout).toContain("subscription logins");
    expect(result.stdout).toContain("no API-key fallback");
    expect(existsSync(path.join(root, "request.json"))).toBe(false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("requires an account-selected model before login or output creation", () => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-generate-model-"));
  const out = path.join(root, "out");
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.resolve(import.meta.dirname, "local-generate.ts"),
        "square-check",
        out,
        "--revision",
        path.join(root, "revision.json"),
        "--master",
        "native24",
        "--meanings",
        path.join(root, "meanings.json"),
      ],
      { encoding: "utf-8" }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--model is required");
    expect(existsSync(out)).toBe(false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("a parent-bound request cannot create a fresh deadline", () => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-generate-clock-"));
  const out = path.join(root, "out");
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.resolve(import.meta.dirname, "local-generate.ts"),
        "square-check",
        out,
        "--revision",
        path.join(root, "revision.json"),
        "--master",
        "24",
        "--meanings",
        path.join(root, "meanings.json"),
        "--model",
        "account-model",
        "--request-id",
        "parent-request",
        "--tooling-hash",
        "a".repeat(64),
      ],
      { encoding: "utf-8" }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "A parent-issued --deadline-at is required"
    );
    expect(existsSync(out)).toBe(false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

const digest = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");

const runWithoutLibraryHash = (libraryHash?: string) => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-local-generate-"));
  const out = path.join(root, "out");
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      path.resolve(import.meta.dirname, "local-generate.ts"),
      "folder-lock",
      out,
      "--revision",
      path.join(root, "revision.json"),
      "--master",
      "16",
      "--meanings",
      path.join(root, "meanings.json"),
      "--library",
      path.join(root, "library"),
      "--library-set",
      "blode-icons",
      "--request-id",
      "request-1",
      "--tooling-hash",
      "a".repeat(64),
      "--deadline-at",
      String(Date.now() + 60_000),
      ...(libraryHash ? ["--library-hash", libraryHash] : []),
    ],
    { encoding: "utf-8" }
  );
  return { out, result };
};

test.each([undefined, "not-a-hash"])(
  "parent-issued retrieval refuses missing or invalid library hash (%s)",
  (libraryHash) => {
    const { out, result } = runWithoutLibraryHash(libraryHash);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Parent-issued library retrieval requires a valid --library-hash"
    );
    expect(existsSync(out)).toBe(false);
  }
);

test("refuses an incomplete diagnostic child binding before creating output", () => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-diagnostic-cli-"));
  const out = path.join(root, "out");
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.resolve(import.meta.dirname, "local-generate.ts"),
        "folder-lock",
        out,
        "--revision",
        path.join(root, "revision.json"),
        "--master",
        "16",
        "--meanings",
        path.join(root, "meanings.json"),
        "--deadline-at",
        String(Date.now() + 60_000),
        "--diagnostic-finalization-plan",
        path.join(root, "plan.json"),
        "--diagnostic-finalization-plan-sha256",
        "a".repeat(64),
      ],
      { encoding: "utf-8" }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Diagnostic finalization requires its plan/hash"
    );
    expect(existsSync(out)).toBe(false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("passes the parent start through the real native CLI path without renewing retrieval", () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "iconsmith-parent-schedule-"))
  );
  const frozen = (name: string) => {
    const file = path.join(root, name);
    const bytes = name.endsWith("-ca")
      ? "-----BEGIN CERTIFICATE-----\nfixture"
      : name;
    writeFileSync(file, bytes, { mode: 0o700 });
    return { path: file, sha256: digest(bytes) };
  };
  const actor = (model: string) => ({
    cliVersion: "0.154.0-alpha.3",
    codexAssets: {
      certificateBundle: frozen(`${model}-ca`),
      codeModeHost: frozen(`${model}-helper`),
    },
    effort: "high",
    executable: frozen(model),
    model,
    provider: "codex",
    stateFiles: [
      { relativePath: "auth.json", source: frozen(`${model}-auth`) },
    ],
  });
  const manifest = {
    author: actor("gpt-6-astra"),
    billing: "subscription",
    docker: { ...frozen("docker"), resolvedPath: path.join(root, "docker") },
    image: `debian@sha256:${"a".repeat(64)}`,
    reviewers: [actor("gpt-5.5"), actor("gpt-5.6-sol")],
    schemaVersion: 1,
  };
  const manifestBytes = JSON.stringify(manifest);
  const manifestFile = path.join(root, "native-route.json");
  writeFileSync(manifestFile, manifestBytes);
  const revisionFile = path.join(root, "revision.json");
  writeFileSync(
    revisionFile,
    JSON.stringify(
      createStyleRevision({
        calibration: "unvalidated",
        compiler: STYLE_COMPILER,
        id: "parent-schedule",
        masters: { native16: SPEC },
        parts: [],
        policy: DEFAULT_POLICY,
        references: [],
        rubric: "fixture",
      })
    )
  );
  const meaningsFile = path.join(root, "meanings.json");
  writeFileSync(meaningsFile, JSON.stringify(["folder-lock"]));
  const library = path.join(root, "library");
  mkdirSync(library);
  const startedAt = Date.now() - 300_000;
  const deadlineAt = startedAt + 1_200_000;
  const invoke = (name: string) => {
    const out = path.join(root, name);
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.resolve(import.meta.dirname, "local-generate.ts"),
        "folder-lock",
        out,
        "--revision",
        revisionFile,
        "--master",
        "native16",
        "--meanings",
        meaningsFile,
        "--library",
        library,
        "--library-set",
        "blode-icons",
        "--library-hash",
        "b".repeat(64),
        "--request-id",
        name,
        "--tooling-hash",
        "c".repeat(64),
        "--deadline-at",
        String(deadlineAt),
        "--max-wall-ms",
        "1200000",
        "--native-route",
        manifestFile,
        "--native-route-hash",
        digest(manifestBytes),
      ],
      { encoding: "utf-8", timeout: 10_000 }
    );
    expect(result.status).not.toBe(0);
    return JSON.parse(
      readFileSync(path.join(out, "native-control/launch.json"), "utf-8")
    ).budget;
  };
  try {
    const first = invoke("first");
    const reentered = invoke("reentered");
    expect(reentered).toEqual(first);
    expect(first).toMatchObject({
      deadlineAt,
      retrievalDeadlineAt: startedAt + 240_000,
      startedAt,
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

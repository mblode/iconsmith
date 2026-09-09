import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { runLocalContainerAccessProbe } from "./local-container-access-probe.js";
import type {
  DockerCommandRequest,
  DockerExecutor,
} from "./local-container-process.js";
import type { ProcessResult } from "./local-process.js";

const ID = "a".repeat(64);
const IMAGE = `debian:12-slim@sha256:${"b".repeat(64)}`;
const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const processResult = (
  overrides: Partial<ProcessResult> = {}
): ProcessResult => ({
  code: 0,
  killed: false,
  stderr: "",
  stdout: "",
  ...overrides,
});

const fixture = () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "iconsmith-access-probe-test-"))
  );
  const docker = path.join(root, "docker");
  const allowed = path.join(root, "allowed.txt");
  const forbidden = path.join(root, "forbidden.txt");
  writeFileSync(docker, "docker fixture");
  writeFileSync(allowed, "allowed bytes");
  writeFileSync(forbidden, "forbidden bytes");
  return { allowed, docker, forbidden, root };
};

const executor = (
  stdout: (fixtureHash: string) => string,
  fixtureHash: string
) => {
  let alive = false;
  let label = "";
  let mounts: { Destination: string; RW: boolean; Source: string }[] = [];
  const execute: DockerExecutor = vi.fn((request: DockerCommandRequest) => {
    if (request.phase === "create") {
      alive = true;
      label = String(request.args[request.args.indexOf("--label") + 1]).replace(
        "iconsmith.owner=",
        ""
      );
      mounts = request.args.flatMap((argument, index) => {
        if (argument !== "--mount") {
          return [];
        }
        const fields = String(request.args[index + 1]).split(",");
        return [
          {
            Destination:
              fields.find((field) => field.startsWith("dst="))?.slice(4) ?? "",
            RW: !fields.includes("readonly"),
            Source:
              fields.find((field) => field.startsWith("src="))?.slice(4) ?? "",
          },
        ];
      });
      return Promise.resolve(processResult({ stdout: ID }));
    }
    if (request.phase === "resolve-identity") {
      return Promise.resolve(
        processResult({
          stdout: JSON.stringify({
            Config: { Image: IMAGE, Labels: { "iconsmith.owner": label } },
            HostConfig: { PidMode: "" },
            Id: ID,
            Mounts: mounts,
          }),
        })
      );
    }
    if (request.phase === "start") {
      return Promise.resolve(processResult({ stdout: stdout(fixtureHash) }));
    }
    if (request.phase === "remove") {
      alive = false;
    }
    if (request.phase === "verify-absent") {
      return Promise.resolve(processResult({ stdout: alive ? ID : "" }));
    }
    return Promise.resolve(processResult());
  });
  return execute;
};

const expectedStdout = (fixtureHash: string, forbiddenStatus = "not-visible") =>
  `${[
    { hash: fixtureHash, pathClass: "allowed-fixture", status: "readable" },
    { hash: null, pathClass: "semantic-key-direct", status: forbiddenStatus },
    { hash: null, pathClass: "semantic-key-proc-root", status: "not-visible" },
    { hash: null, pathClass: "semantic-key-host-mnt", status: "not-visible" },
  ]
    .map((record) => JSON.stringify(record))
    .join("\n")}\n`;

it("seals a no-network denied-access probe without exposing host paths in stdout", async () => {
  const files = fixture();
  try {
    const allowedHash = sha(readFileSync(files.allowed));
    const out = path.join(files.root, "out");
    const result = await runLocalContainerAccessProbe(
      {
        allowedFixture: files.allowed,
        deadlineAt: Date.now() + 20_000,
        dockerCommand: files.docker,
        dockerSha256: sha(readFileSync(files.docker)),
        forbiddenSentinels: [
          { hostPath: files.forbidden, pathClass: "semantic-key" },
        ],
        image: IMAGE,
        out,
      },
      { execute: executor(expectedStdout, allowedHash), now: Date.now }
    );
    expect(result.receipt).toMatchObject({
      accessVerified: true,
      forbiddenObservationCount: 3,
      network: "none",
      productionEligible: false,
      providerCalls: 0,
    });
    const stdout = readFileSync(
      path.join(out, "evidence/probe-stdout.jsonl"),
      "utf-8"
    );
    expect(stdout).not.toContain(files.root);
    expect(result.records).toHaveLength(4);
    expect(existsSync(result.receiptFile)).toBe(true);
  } finally {
    rmSync(files.root, { force: true, recursive: true });
  }
});

it("records and rejects a forbidden readable path", async () => {
  const files = fixture();
  try {
    const allowedHash = sha(readFileSync(files.allowed));
    const out = path.join(files.root, "out");
    await expect(
      runLocalContainerAccessProbe(
        {
          allowedFixture: files.allowed,
          deadlineAt: Date.now() + 20_000,
          dockerCommand: files.docker,
          dockerSha256: sha(readFileSync(files.docker)),
          forbiddenSentinels: [
            { hostPath: files.forbidden, pathClass: "semantic-key" },
          ],
          image: IMAGE,
          out,
        },
        {
          execute: executor(
            (hash) => expectedStdout(hash, "readable"),
            allowedHash
          ),
          now: Date.now,
        }
      )
    ).rejects.toThrow("unexpected reachability");
    expect(
      JSON.parse(readFileSync(path.join(out, "receipt.json"), "utf-8"))
    ).toMatchObject({ accessVerified: false, productionEligible: false });
  } finally {
    rmSync(files.root, { force: true, recursive: true });
  }
});

it("refuses duplicate path classes before creating evidence", async () => {
  const files = fixture();
  try {
    const out = path.join(files.root, "out");
    await expect(
      runLocalContainerAccessProbe({
        allowedFixture: files.allowed,
        deadlineAt: Date.now() + 20_000,
        dockerCommand: files.docker,
        dockerSha256: sha(readFileSync(files.docker)),
        forbiddenSentinels: [
          { hostPath: files.forbidden, pathClass: "semantic-key" },
          { hostPath: files.docker, pathClass: "semantic-key" },
        ],
        image: IMAGE,
        out,
      })
    ).rejects.toThrow("frozen bounded inputs");
    expect(existsSync(out)).toBe(false);
  } finally {
    rmSync(files.root, { force: true, recursive: true });
  }
});

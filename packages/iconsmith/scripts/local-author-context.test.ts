import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import {
  assertNoAmbientCatalogs,
  discoveredSkillPaths,
  prepareAuthorContext,
  prepareContainedCodexContext,
} from "./local-author-context.js";
import { reviewImagesWithCodex } from "./local-codex-review.js";
import type { DockerCommandRequest } from "./local-container-process.js";
import type { ProcessResult } from "./local-process.js";

const catalog = (name: string) =>
  `<skills_instructions>\n- \`r0\` = \`/test/skills\`\n- ${name} (file: r0/${name}/SKILL.md)`;
const prompt = (text: string) =>
  JSON.stringify([
    { content: [{ text, type: "input_text" }], role: "developer" },
  ]);
const sha256 = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const record = (payload: object) =>
  JSON.stringify({ payload, type: "response_item" });

it("resolves aliased and absolute paths without reading skill contents", () => {
  expect(
    discoveredSkillPaths(`${catalog("one")}\n(file: /absolute/two/SKILL.md)`)
  ).toEqual(["/test/skills/one/SKILL.md", "/absolute/two/SKILL.md"]);
  expect(() => discoveredSkillPaths("(file: r7/missing/SKILL.md)")).toThrow(
    "Unresolved"
  );
});

it("disables successive discovered pages and retains a compact preflight receipt", () => {
  const out = mkdtempSync(path.join(tmpdir(), "iconsmith-context-"));
  const seen: string[][] = [];
  let count = 0;
  try {
    const result = prepareAuthorContext("unused", out, {}, (args) => {
      seen.push([...args]);
      count += 1;
      return prompt(
        [catalog("one"), catalog("two"), "Only the drawing packet."][count - 1]
      );
    });
    expect(seen).toHaveLength(3);
    expect(result.args.join(" ")).toContain(
      'path="/test/skills/one/SKILL.md",enabled=false'
    );
    expect(result.args.join(" ")).toContain(
      'path="/test/skills/two/SKILL.md",enabled=false'
    );
    const receipt = JSON.parse(
      readFileSync(path.join(out, result.receiptName), "utf-8")
    );
    expect(receipt.disabledSkills).toBe(2);
    expect(receipt.globalConfigurationEdited).toBe(false);
    expect(JSON.stringify(receipt)).not.toContain("/test/skills");
  } finally {
    rmSync(out, { force: true, recursive: true });
  }
});

it("refuses persistent catalogs and invalid preview responses", () => {
  expect(() =>
    prepareAuthorContext("unused", "/unused", {}, () => prompt(catalog("one")))
  ).toThrow("still contains");
  expect(() =>
    prepareAuthorContext("unused", "/unused", {}, () => "invalid JSON")
  ).toThrow();
});

it("rejects actual ambient context while allowing ordinary tool output", () => {
  expect(() =>
    assertNoAmbientCatalogs(
      record({
        content: [{ text: "<recommended_plugins>" }],
        role: "user",
        type: "message",
      })
    )
  ).toThrow("catalog");
  expect(() =>
    assertNoAmbientCatalogs(
      record({
        content: [{ text: "<skills_instructions>" }],
        role: "developer",
        type: "message",
      })
    )
  ).toThrow("catalog");
  expect(() =>
    assertNoAmbientCatalogs(
      record({
        output: "Document mentions <skills_instructions>",
        type: "function_call_output",
      })
    )
  ).not.toThrow();
});

it("converges offline without forwarding the authenticated call access probe", async () => {
  const out = mkdtempSync(path.join(tmpdir(), "iconsmith-contained-context-"));
  const binary = path.join(out, "codex");
  const companion = path.join(out, "codex-code-mode-host");
  const certificate = path.join(out, "ca-certificates.crt");
  const providerState = path.join(out, "provider-state");
  const auth = path.join(providerState, "auth.json");
  mkdirSync(providerState);
  writeFileSync(binary, "codex");
  writeFileSync(companion, "companion");
  chmodSync(companion, 0o755);
  writeFileSync(
    certificate,
    "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n"
  );
  writeFileSync(auth, "private-auth");
  const id = "a".repeat(64);
  const image = `debian@sha256:${"b".repeat(64)}`;
  const nonce = "review-access-nonce";
  const nonceSha256 = digest(nonce);
  const stageId = "reviewer-codex-initial";
  const ackHostPath = path.join(out, "same-container-access.ack");
  const ackSha256 = digest(
    `iconsmith-access-ack-v1:${stageId}:${nonceSha256}\n`
  );
  const accessPlanDescriptor = {
    ackContainerPath: ackHostPath,
    ackHostPath,
    ackSha256,
    allowed: { containerPath: "/runtime/codex", sha256: sha256(binary) },
    forbidden: [
      { containerPath: "/forbidden/sentinel", pathClass: "forbidden-direct" },
    ],
    kind: "same-container-access-probe-plan-v1" as const,
    nonce,
    nonceSha256,
    stageId,
  };
  const observeAccess = vi.fn();
  const observeFinalization = vi.fn();
  const observeStop = vi.fn(() => {
    throw new Error("provider-call STOP observer leaked into context probe");
  });
  const persistAccessBinding = vi.fn();
  const creates: readonly string[][] = [];
  let starts = 0;
  const execute = vi.fn((request: DockerCommandRequest) => {
    if (request.phase === "create") {
      (creates as string[][]).push([...request.args]);
      return Promise.resolve<ProcessResult>({
        code: 0,
        killed: false,
        stderr: "",
        stdout: id,
      });
    }
    if (request.phase === "resolve-identity") {
      const create = creates.at(-1) ?? [];
      const label = create[create.indexOf("--label") + 1]?.replace(
        "iconsmith.owner=",
        ""
      );
      return Promise.resolve<ProcessResult>({
        code: 0,
        killed: false,
        stderr: "",
        stdout: JSON.stringify({
          Config: { Image: image, Labels: { "iconsmith.owner": label } },
          HostConfig: { PidMode: "" },
          Id: id,
        }),
      });
    }
    if (request.phase === "start") {
      expect(request.onStdoutLine).toBeUndefined();
      const stdout =
        starts === 0
          ? prompt(
              `<skills_instructions>\n- \`r0\` = \`${providerState}/skills\`\n- one (file: r0/one/SKILL.md)`
            )
          : prompt("sealed");
      starts += 1;
      return Promise.resolve<ProcessResult>({
        code: 0,
        killed: false,
        stderr: "",
        stdout,
      });
    }
    return Promise.resolve<ProcessResult>({
      code: 0,
      killed: false,
      stderr: "",
      stdout: "",
    });
  });
  try {
    const result = await prepareContainedCodexContext({
      container: {
        codexAssets: {
          certificateBundle: {
            containerPath: "/etc/ssl/certs/ca-certificates.crt",
            hostPath: certificate,
            sha256: sha256(certificate),
          },
          cliVersion: "0.154.0-alpha.3",
          codeModeHost: {
            containerPath: "/runtime/codex-code-mode-host",
            hostPath: companion,
            sha256: sha256(companion),
          },
        },
        diagnosticFinalizationObserver: { observe: observeFinalization },
        dockerCommand: "/usr/local/bin/docker",
        environment: { CODEX_HOME: providerState, HOME: providerState },
        execute,
        image,
        namePrefix: "iconsmith-provider",
        nativeCliVersion: "0.154.0-alpha.3",
        nativeCommand: "/runtime/codex",
        nativeExecutableHostPath: binary,
        nativeExecutableSha256: sha256(binary),
        observeStop,
        persistAccessBinding,
        persistIdentity: vi.fn(),
        persistSettlement: vi.fn(),
        sameContainerAccessProbe: {
          observe: observeAccess,
          plan: {
            ...accessPlanDescriptor,
            planSha256: digest(JSON.stringify(accessPlanDescriptor)),
          },
        },
        stateMounts: [
          { containerPath: "/runtime/codex", hostPath: binary, readOnly: true },
          {
            containerPath: "/runtime/codex-code-mode-host",
            hostPath: companion,
            readOnly: true,
          },
          {
            containerPath: "/etc/ssl/certs/ca-certificates.crt",
            hostPath: certificate,
            readOnly: true,
          },
          {
            containerPath: providerState,
            hostPath: providerState,
            readOnly: false,
          },
          {
            containerPath: path.join(providerState, "auth.json"),
            hostPath: auth,
            readOnly: true,
          },
        ],
      },
      deadlineAt: Date.now() + 20_000,
      out,
    });
    expect(starts).toBe(2);
    expect(result.args.join(" ")).toContain(
      `path="${providerState}/skills/one/SKILL.md",enabled=false`
    );
    for (const args of creates) {
      expect(args).toContain("--network=none");
      expect(args.join(" ")).not.toContain("auth.json");
      expect(args).toContain(`CODEX_HOME=${providerState}`);
      expect(args).toContain("/runtime/codex");
      expect(args).not.toContain("/bin/sh");
    }
    expect(observeAccess).not.toHaveBeenCalled();
    expect(observeFinalization).not.toHaveBeenCalled();
    expect(observeStop).not.toHaveBeenCalled();
    expect(persistAccessBinding).not.toHaveBeenCalled();
    const receipt = JSON.parse(
      readFileSync(path.join(out, result.receiptName), "utf-8")
    );
    expect(receipt).toMatchObject({
      disabledSkills: 1,
      network: "none",
      probes: [{}, {}],
    });
    expect(
      readFileSync(
        path.join(out, "context-preflight/probe-0/container-settlement.json"),
        "utf-8"
      )
    ).toContain('"containerAbsent": true');
  } finally {
    rmSync(out, { force: true, recursive: true });
  }
});

it("strips call-only hooks from the real review context probe but retains them for the call", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-review-context-"));
  const out = path.join(root, "receipts", "review");
  const runtimeCwd = path.join(root, "runtime", "review");
  mkdirSync(path.dirname(out));
  mkdirSync(path.dirname(runtimeCwd));
  const binary = path.join(root, "codex");
  const companion = path.join(root, "codex-code-mode-host");
  const certificate = path.join(root, "ca-certificates.crt");
  const providerState = path.join(root, "provider-state");
  mkdirSync(providerState);
  writeFileSync(binary, "codex");
  writeFileSync(companion, "companion");
  chmodSync(companion, 0o755);
  writeFileSync(
    certificate,
    "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n"
  );
  const id = "c".repeat(64);
  const image = `debian@sha256:${"d".repeat(64)}`;
  const nonce = "review-adapter-access-nonce";
  const nonceSha256 = digest(nonce);
  const stageId = "reviewer-codex-initial";
  const ackHostPath = path.join(runtimeCwd, "same-container-access.ack");
  const descriptor = {
    ackContainerPath: ackHostPath,
    ackHostPath,
    ackSha256: digest(`iconsmith-access-ack-v1:${stageId}:${nonceSha256}\n`),
    allowed: { containerPath: "/runtime/codex", sha256: sha256(binary) },
    forbidden: [
      { containerPath: "/forbidden/sentinel", pathClass: "forbidden-direct" },
    ],
    kind: "same-container-access-probe-plan-v1" as const,
    nonce,
    nonceSha256,
    stageId,
  };
  const accessProbe = {
    observe: vi.fn(),
    plan: { ...descriptor, planSha256: digest(JSON.stringify(descriptor)) },
  };
  const observeFinalization = vi.fn();
  const observeStop = vi.fn(() => {
    throw new Error("provider-call STOP observer leaked into context probe");
  });
  const persistAccessBinding = vi.fn();
  let owner = "";
  const execute = vi.fn((request: DockerCommandRequest) => {
    if (request.phase === "create") {
      owner = String(request.args[request.args.indexOf("--label") + 1]).replace(
        "iconsmith.owner=",
        ""
      );
      expect(request.args).toContain("--network=none");
      expect(request.args).not.toContain("/bin/sh");
      return Promise.resolve<ProcessResult>({
        code: 0,
        killed: false,
        stderr: "",
        stdout: id,
      });
    }
    if (request.phase === "resolve-identity") {
      return Promise.resolve<ProcessResult>({
        code: 0,
        killed: false,
        stderr: "",
        stdout: JSON.stringify({
          Config: { Image: image, Labels: { "iconsmith.owner": owner } },
          HostConfig: { PidMode: "" },
          Id: id,
        }),
      });
    }
    if (request.phase === "start") {
      expect(request.onStdoutLine).toBeUndefined();
      return Promise.resolve<ProcessResult>({
        code: 0,
        killed: false,
        stderr: "",
        stdout: prompt("sealed"),
      });
    }
    return Promise.resolve<ProcessResult>({
      code: 0,
      killed: false,
      stderr: "",
      stdout: "",
    });
  });
  const config = {
    codexAssets: {
      certificateBundle: {
        containerPath: "/etc/ssl/certs/ca-certificates.crt",
        hostPath: certificate,
        sha256: sha256(certificate),
      },
      cliVersion: "0.154.0-alpha.3",
      codeModeHost: {
        containerPath: "/runtime/codex-code-mode-host",
        hostPath: companion,
        sha256: sha256(companion),
      },
    },
    diagnosticFinalizationObserver: { observe: observeFinalization },
    dockerCommand: "/usr/local/bin/docker",
    environment: { CODEX_HOME: providerState, HOME: providerState },
    execute,
    image,
    namePrefix: "iconsmith-provider",
    nativeCliVersion: "0.154.0-alpha.3",
    nativeCommand: "/runtime/codex",
    nativeExecutableHostPath: binary,
    nativeExecutableSha256: sha256(binary),
    observeStop,
    persistAccessBinding,
    persistIdentity: vi.fn(),
    persistSettlement: vi.fn(),
    sameContainerAccessProbe: accessProbe,
    stateMounts: [
      { containerPath: "/runtime/codex", hostPath: binary, readOnly: true },
      {
        containerPath: "/runtime/codex-code-mode-host",
        hostPath: companion,
        readOnly: true,
      },
      {
        containerPath: "/etc/ssl/certs/ca-certificates.crt",
        hostPath: certificate,
        readOnly: true,
      },
      {
        containerPath: providerState,
        hostPath: providerState,
        readOnly: false,
      },
    ],
  };
  const parentDeadlineAt = Date.now() + 20_000;
  try {
    const result = await reviewImagesWithCodex({
      deadlineAt: parentDeadlineAt - 1000,
      images: { "candidate.png": Buffer.from("fixture") },
      invokeContained: (_request, received) => {
        expect(received.sameContainerAccessProbe).toBe(accessProbe);
        expect(received.observeStop).toBe(observeStop);
        return Promise.resolve({
          code: 1,
          killed: false,
          stderr: "bounded fixture completion",
          stdout: "",
        });
      },
      maxStageMs: 10_000,
      model: "gpt-6-astra",
      nativeCall: {
        accessProbe,
        containerFactory: {
          create: (request) => {
            mkdirSync(request.cwd);
            return {
              config,
              scope: {
                cwd: request.cwd,
                deadlineAt: request.deadlineAt,
                intent: {},
                stateDirectory: providerState,
              },
            } as never;
          },
        },
        ordinal: 6,
        parentDeadlineAt,
        runtimeCwd,
        stageKind: stageId,
      },
      out,
      questions: [
        { choices: ["yes", "no"], id: "visible", prompt: "Visible?" },
      ],
    });
    expect(result.status).toBe("incomplete");
    expect(execute).toHaveBeenCalled();
    expect(accessProbe.observe).not.toHaveBeenCalled();
    expect(observeFinalization).not.toHaveBeenCalled();
    expect(observeStop).not.toHaveBeenCalled();
    expect(persistAccessBinding).not.toHaveBeenCalled();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

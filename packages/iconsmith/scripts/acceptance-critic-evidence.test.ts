import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import type { AcceptanceCampaignTerminalExpectation } from "../src/eval/acceptance-contract.js";
import { withCampaignTerminalEvidence } from "./acceptance-critic-evidence.js";
import { createCampaignManifest } from "./campaign-manifest.js";
import {
  corpusTreeHash,
  frozenCampaignPlanHash,
  planLocalCampaign,
  verifyCampaignTerminalEvidence,
} from "./local-campaign.js";
import type { NativeRouteManifest } from "./local-native-config.js";
import { DEVELOPMENT_FAMILIES } from "./quality-population.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

const terminalFixture = () => {
  const root = mkdtempSync(
    path.join(tmpdir(), "iconsmith-acceptance-terminal-")
  );
  const library = path.join(root, "library");
  const meaningsDirectory = path.join(root, "meanings");
  const scripts = path.join(root, "repo", "packages", "iconsmith", "scripts");
  mkdirSync(library);
  mkdirSync(meaningsDirectory);
  mkdirSync(scripts, { recursive: true });
  for (const name of [
    "family-parts.ts",
    "family-reference-packet.ts",
    "local-author-context.ts",
    "local-generate.ts",
    "local-retrieval.ts",
    "local-review.ts",
    "local-runtime.ts",
    "local-style-run.ts",
    "reference-proofs.ts",
  ]) {
    writeFileSync(path.join(scripts, name), `// fixture ${name}\n`);
  }
  writeFileSync(path.join(root, "repo", "package-lock.json"), "{}\n");
  writeFileSync(path.join(library, "box.svg"), "<svg/>");
  const manifestFile = path.join(root, "manifest.json");
  writeFileSync(
    manifestFile,
    JSON.stringify(
      createCampaignManifest(
        "development",
        {
          sources: [
            {
              id: "blode-icons",
              records: 20,
              treeHash: corpusTreeHash(library),
            },
          ],
        },
        []
      )
    )
  );
  for (const { concept } of DEVELOPMENT_FAMILIES) {
    writeFileSync(
      path.join(meaningsDirectory, `${concept}.json`),
      JSON.stringify([concept, `${concept}-other`, `${concept}-alternate`])
    );
  }
  const frozen = (name: string) => {
    const file = path.join(root, name);
    writeFileSync(file, name, { mode: 0o700 });
    return { path: realpathSync(file), sha256: sha(name) };
  };
  const actor = (model: "gpt-6-astra" | "gpt-5.5" | "gpt-5.6-sol") => ({
    cliVersion: "0.154.0-alpha.3",
    codexAssets: {
      certificateBundle: frozen(`${model}-ca`),
      codeModeHost: frozen(`${model}-helper`),
    },
    effort: "high" as const,
    executable: frozen(model),
    model,
    provider: "codex" as const,
    stateFiles: [
      { relativePath: "auth.json", source: frozen(`${model}-auth`) },
    ],
  });
  const docker = frozen("docker");
  const native: NativeRouteManifest = {
    author: actor("gpt-6-astra"),
    billing: "subscription",
    docker: { ...docker, resolvedPath: docker.path },
    image: `debian@sha256:${"a".repeat(64)}`,
    reviewers: [actor("gpt-5.5"), actor("gpt-5.6-sol")],
    schemaVersion: 1,
  };
  const runtimeBytes = JSON.stringify(native);
  const runtimeFile = path.join(root, "native-route.json");
  writeFileSync(runtimeFile, runtimeBytes);
  const revisionFile = path.join(root, "revision.json");
  writeFileSync(revisionFile, "{}");
  const options = {
    authorCommand: undefined,
    authorModel: undefined,
    concurrency: 1,
    execute: false,
    generator: path.join(scripts, "local-generate.ts"),
    library,
    manifestFile,
    maxRequests: 2,
    meaningsDirectory,
    nativeRouteHash: sha(runtimeBytes),
    out: path.join(root, "campaign"),
    revisionFile,
    runtimeFile,
  };
  const plan = planLocalCampaign(options);
  const expected = (requestIndex: number) => {
    const request = plan.requests[requestIndex];
    if (!request) {
      throw new Error("Missing fixture request");
    }
    return {
      campaignHash: plan.campaignHash,
      originalDeadlineAt: null,
      planHash: frozenCampaignPlanHash(plan),
      requestId: request.requestId,
      requestIntentHash: null,
      route: plan.execution.route,
      runtimeHash: plan.execution.runtimeHash,
      slotIds: [request.slotIds[0] ?? "", request.slotIds[1] ?? ""],
      toolingHash: plan.execution.toolingHash,
    } satisfies AcceptanceCampaignTerminalExpectation;
  };
  const capability = (requestIndex: number) => {
    const expectation = expected(requestIndex);
    return verifyCampaignTerminalEvidence({
      expectedPlanHash: expectation.planHash,
      plan,
      receiptRoot: path.join(options.out, "receipts"),
      requestId: expectation.requestId,
    });
  };
  return { capability, expected, plan, root };
};

test("bridges a real unstarted terminal capability only while it is live", async () => {
  const fixture = terminalFixture();
  try {
    const capability = await fixture.capability(0);
    expect(
      withCampaignTerminalEvidence(
        [{ capability, expected: fixture.expected(0) }],
        (acceptanceCapability) => acceptanceCapability.kind
      )
    ).toBe("iconsmith-acceptance-campaign-terminal-capability-v1");
    const copied = structuredClone(capability);
    expect(() =>
      withCampaignTerminalEvidence(
        [{ capability: copied, expected: fixture.expected(0) }],
        () => null
      )
    ).toThrow("not process-local authority");
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test("refuses one capability rebound to another request or changed terminal path", async () => {
  const fixture = terminalFixture();
  try {
    const capability = await fixture.capability(0);
    expect(() =>
      withCampaignTerminalEvidence(
        [{ capability, expected: fixture.expected(1) }],
        () => null
      )
    ).toThrow("Campaign terminal evidence binding is invalid");
    expect(() =>
      withCampaignTerminalEvidence(
        [
          { capability, expected: fixture.expected(0) },
          { capability, expected: fixture.expected(1) },
        ],
        () => null
      )
    ).toThrow("Campaign terminal evidence binding is invalid");

    const [request] = fixture.plan.requests;
    if (!request) {
      throw new Error("Missing fixture request");
    }
    mkdirSync(request.destination, { recursive: true });
    writeFileSync(path.join(request.destination, "late.svg"), "late");
    expect(() =>
      withCampaignTerminalEvidence(
        [{ capability, expected: fixture.expected(0) }],
        () => null
      )
    ).toThrow();
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

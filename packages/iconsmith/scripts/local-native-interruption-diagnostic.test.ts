import { createHash } from "node:crypto";
import {
  linkSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { createFamilyReferencePacket } from "./family-reference-packet.js";
import {
  assertDiagnosticFinalizationPlanBinding,
  bindDiagnosticFinalizationPlan,
  bindDiagnosticFinalizationObserver,
  materializeDiagnosticFinalizationPlan,
  readDiagnosticFinalizationPlan,
  verifyDiagnosticFinalizationTrigger,
} from "./local-native-interruption-diagnostic.js";

const HASH = "a".repeat(64);
const IMAGE = `debian@sha256:${"b".repeat(64)}`;
const ID = "c".repeat(64);
const SIGNAL = new AbortController().signal;
const digest = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const planFixture = () => {
  const directory = realpathSync(
    mkdtempSync(path.join(tmpdir(), "iconsmith-interrupt-plan-"))
  );
  const packet = createFamilyReferencePacket({
    concept: "folder-lock",
    excludedFamilies: ["folder-lock"],
    excludedSourceHashes: [],
    librarySet: "blode-icons",
    librarySourceHash: "1".repeat(64),
    sources: [
      {
        admissionRequested: false,
        intent: {
          evidence: "folder body",
          polarity: "body",
          treatment: "preserve the body",
        },
        source: {
          finish: "outlined",
          name: "folder",
          provenance: {
            date: "2026-09-09",
            origin: "literal",
            set: "blode-icons",
          },
          svg: '<svg viewBox="0 0 24 24"><path d="M3 5H10L12 7H21V20H3Z"/></svg>',
        },
      },
    ],
  });
  const packetFile = path.join(directory, "packet.json");
  const packetBytes = `${JSON.stringify(packet)}\n`;
  writeFileSync(packetFile, packetBytes);
  const revisionFile = path.join(directory, "revision.json");
  const revisionBytes = '{"revision":"fixture"}\n';
  writeFileSync(revisionFile, revisionBytes);
  const planFile = path.join(directory, "plan.json");
  const plan = {
    campaignHash: "2".repeat(64),
    expiresAt: Date.now() + 60_000,
    familyPacket: {
      file: packetFile,
      packetHash: packet.packetHash,
      sha256: digest(packetBytes),
    },
    image: IMAGE,
    kind: "iconsmith-finalization-interruption-plan-v1",
    maxWallMs: 1_200_000,
    planFile,
    qualification: false,
    revisionHash: digest(revisionBytes),
    routeHash: "3".repeat(64),
    schemaVersion: 1,
    target: {
      concept: "folder-lock",
      family: "folder",
      master: "16",
      slotIds: [
        "folder/folder-lock/16/outlined",
        "folder/folder-lock/16/filled",
      ],
    },
  };
  const planBytes = `${JSON.stringify(plan)}\n`;
  writeFileSync(planFile, planBytes);
  const loaded = () =>
    readDiagnosticFinalizationPlan({
      file: planFile,
      sha256: digest(planBytes),
    });
  const actual = () => ({
    campaignHash: plan.campaignHash,
    concept: plan.target.concept,
    deadlineAt: plan.expiresAt + 1000,
    family: plan.target.family,
    familyPacket: { ...plan.familyPacket },
    image: plan.image,
    master: plan.target.master,
    maxWallMs: plan.maxWallMs,
    requestId: "4".repeat(64),
    revisionFile,
    revisionHash: plan.revisionHash,
    routeHash: plan.routeHash,
    slotIds: [...plan.target.slotIds],
  });
  return { actual, directory, loaded, packetFile, planFile, revisionFile };
};

const fixture = () => {
  const plan = planFixture();
  const { directory } = plan;
  const capability = materializeDiagnosticFinalizationPlan({
    binding: bindDiagnosticFinalizationPlan({
      actual: plan.actual(),
      loaded: plan.loaded(),
    }),
    descriptorReceipt: path.join(directory, "descriptor.json"),
    reservationHash: HASH,
  });
  const triggerReceipt = path.join(directory, "trigger.json");
  const finalizationBinding = {
    callId: "00000000-0000-4000-8000-000000000000",
    finalizedReceiptHash: HASH,
    inspectionHash: HASH,
    intentHash: HASH,
    programHashes: { filled: HASH, outlined: HASH },
    responseSchemaHash: HASH,
    stage: "02-finalize",
    stageDeadlineAt: capability.descriptor.expiresAt - 1,
    triggerReceipt,
  };
  const observer = bindDiagnosticFinalizationObserver({
    binding: finalizationBinding,
    capability,
    now: () => capability.descriptor.createdAt + 1,
  });
  return {
    capability,
    directory,
    finalizationBinding,
    observer,
    triggerReceipt,
  };
};

const finalLine = JSON.stringify({
  item: {
    text: JSON.stringify({ reviewMarkdown: "inspected", unresolved: [] }),
    type: "agent_message",
  },
  type: "item.completed",
});

it("binds a closed plan and materializes one exact post-reservation capability", () => {
  const f = planFixture();
  try {
    const binding = bindDiagnosticFinalizationPlan({
      actual: f.actual(),
      loaded: f.loaded(),
    });
    const capability = materializeDiagnosticFinalizationPlan({
      binding,
      descriptorReceipt: path.join(f.directory, "bound-descriptor.json"),
      reservationHash: "5".repeat(64),
    });
    expect(capability.descriptor).toMatchObject({
      diagnosticId: f.loaded().sha256,
      expectedImage: IMAGE,
      reservationHash: "5".repeat(64),
      routeHash: "3".repeat(64),
    });
    expect(() =>
      materializeDiagnosticFinalizationPlan({
        binding,
        descriptorReceipt: path.join(f.directory, "second-descriptor.json"),
        reservationHash: "5".repeat(64),
      })
    ).toThrow("was not canonical");
    const duplicate = bindDiagnosticFinalizationPlan({
      actual: f.actual(),
      loaded: f.loaded(),
    });
    expect(() =>
      assertDiagnosticFinalizationPlanBinding({
        binding: duplicate,
        deadlineAt: f.actual().deadlineAt,
        image: IMAGE,
        requestId: "4".repeat(64),
        retrievalCalls: 0,
        routeHash: "3".repeat(64),
      })
    ).toThrow("was transplanted");
  } finally {
    rmSync(f.directory, { force: true, recursive: true });
  }
});

it.each([
  ["campaign", { campaignHash: "9".repeat(64) }],
  ["concept", { concept: "other" }],
  ["master", { master: "24" }],
  ["wall clock", { maxWallMs: 900_000 }],
  ["route", { routeHash: "9".repeat(64) }],
  ["image", { image: `debian@sha256:${"9".repeat(64)}` }],
  ["slots", { slotIds: ["wrong", "slots"] }],
])("refuses a preallocation %s mismatch", (_label, changed) => {
  const f = planFixture();
  try {
    expect(() =>
      bindDiagnosticFinalizationPlan({
        actual: { ...f.actual(), ...changed },
        loaded: f.loaded(),
      })
    ).toThrow("did not match child inputs");
  } finally {
    rmSync(f.directory, { force: true, recursive: true });
  }
});

it("reads an expired plan for replay but refuses it for a fresh binding", () => {
  const f = planFixture();
  try {
    const bytes = JSON.parse(readFileSync(f.planFile, "utf-8"));
    bytes.expiresAt = Date.now() - 1;
    const rewritten = `${JSON.stringify(bytes)}\n`;
    writeFileSync(f.planFile, rewritten);
    const loaded = readDiagnosticFinalizationPlan({
      file: f.planFile,
      sha256: digest(rewritten),
    });
    expect(loaded.plan.expiresAt).toBeLessThanOrEqual(Date.now());
    expect(() =>
      bindDiagnosticFinalizationPlan({ actual: f.actual(), loaded })
    ).toThrow("did not match child inputs");
  } finally {
    rmSync(f.directory, { force: true, recursive: true });
  }
});

it("refuses linked plan inputs and mutation before capability materialization", () => {
  const linked = planFixture();
  try {
    const hardlink = path.join(linked.directory, "plan-hardlink.json");
    linkSync(linked.planFile, hardlink);
    expect(() => linked.loaded()).toThrow("owned regular file");
  } finally {
    rmSync(linked.directory, { force: true, recursive: true });
  }
  const symbolic = planFixture();
  try {
    const symlink = path.join(symbolic.directory, "plan-symlink.json");
    symlinkSync(symbolic.planFile, symlink);
    expect(() =>
      readDiagnosticFinalizationPlan({
        file: symlink,
        sha256: digest(readFileSync(symbolic.planFile)),
      })
    ).toThrow("owned regular file");
  } finally {
    rmSync(symbolic.directory, { force: true, recursive: true });
  }
  const copied = planFixture();
  try {
    const copy = path.join(copied.directory, "copied-plan.json");
    const bytes = readFileSync(copied.planFile);
    writeFileSync(copy, bytes);
    expect(() =>
      readDiagnosticFinalizationPlan({ file: copy, sha256: digest(bytes) })
    ).toThrow("canonical path changed");
  } finally {
    rmSync(copied.directory, { force: true, recursive: true });
  }
  const mutated = planFixture();
  try {
    const binding = bindDiagnosticFinalizationPlan({
      actual: mutated.actual(),
      loaded: mutated.loaded(),
    });
    writeFileSync(mutated.revisionFile, "mutated");
    expect(() =>
      materializeDiagnosticFinalizationPlan({
        binding,
        descriptorReceipt: path.join(mutated.directory, "descriptor.json"),
        reservationHash: "5".repeat(64),
      })
    ).toThrow("changed before allocation");
  } finally {
    rmSync(mutated.directory, { force: true, recursive: true });
  }
});

it("persists the exact bound trigger before killing the captured container", async () => {
  const {
    capability,
    directory,
    finalizationBinding,
    observer,
    triggerReceipt,
  } = fixture();
  const kill = vi.fn(() => {
    expect(JSON.parse(readFileSync(triggerReceipt, "utf-8"))).toMatchObject({
      action: "diagnostic-kill",
      containerId: ID,
      finalizedReceiptHash: HASH,
      image: IMAGE,
      originalDeadlineAt: capability.descriptor.originalDeadlineAt,
    });
    return Promise.resolve();
  });
  try {
    await observer.observe(
      finalLine,
      SIGNAL,
      {
        containerId: ID,
        containerName: "iconsmith-finalize-fixture",
        image: IMAGE,
        ownershipToken: "private-token",
      },
      kill
    );
    await observer.observe(
      finalLine,
      SIGNAL,
      {
        containerId: ID,
        containerName: "iconsmith-finalize-fixture",
        image: IMAGE,
        ownershipToken: "private-token",
      },
      kill
    );
    expect(kill).toHaveBeenCalledOnce();
    expect(readFileSync(triggerReceipt, "utf-8")).not.toContain(
      "private-token"
    );
    expect(
      verifyDiagnosticFinalizationTrigger({
        capability,
        expected: {
          ...finalizationBinding,
          containerId: ID,
          containerName: "iconsmith-finalize-fixture",
          image: IMAGE,
        },
        triggerReceipt,
      })
    ).toMatchObject({
      file: triggerReceipt,
      terminalLineSha256: digest(finalLine),
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

it("refuses to trigger after its durable descriptor changes", async () => {
  const { capability, directory, observer } = fixture();
  const kill = vi.fn();
  try {
    writeFileSync(capability.descriptor.descriptorReceipt, "changed");
    await expect(
      observer.observe(
        finalLine,
        SIGNAL,
        {
          containerId: ID,
          containerName: "iconsmith-finalize-fixture",
          image: IMAGE,
          ownershipToken: "private-token",
        },
        kill
      )
    ).rejects.toThrow("descriptor identity changed");
    expect(kill).not.toHaveBeenCalled();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

it("does not kill when the exclusive durable trigger write fails", async () => {
  const { directory, observer, triggerReceipt } = fixture();
  const kill = vi.fn();
  try {
    writeFileSync(triggerReceipt, "occupied");
    await expect(
      observer.observe(
        finalLine,
        SIGNAL,
        {
          containerId: ID,
          containerName: "iconsmith-finalize-fixture",
          image: IMAGE,
          ownershipToken: "private-token",
        },
        kill
      )
    ).rejects.toThrow();
    expect(kill).not.toHaveBeenCalled();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

it("ignores malformed, nonterminal and wrong-image observations", async () => {
  const { directory, observer } = fixture();
  const kill = vi.fn();
  try {
    await observer.observe("not-json", SIGNAL, {} as never, kill);
    await observer.observe(
      JSON.stringify({ type: "item.started" }),
      SIGNAL,
      {} as never,
      kill
    );
    await observer.observe(
      finalLine,
      SIGNAL,
      {
        containerId: ID,
        containerName: "iconsmith-finalize-fixture",
        image: `debian@sha256:${"d".repeat(64)}`,
        ownershipToken: "private-token",
      },
      kill
    );
    expect(kill).not.toHaveBeenCalled();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

it("cannot write or kill after its observer signal is cancelled", async () => {
  const { directory, observer, triggerReceipt } = fixture();
  const controller = new AbortController();
  const kill = vi.fn();
  controller.abort();
  try {
    await observer.observe(
      finalLine,
      controller.signal,
      {
        containerId: ID,
        containerName: "iconsmith-finalize-fixture",
        image: IMAGE,
        ownershipToken: "private-token",
      },
      kill
    );
    expect(kill).not.toHaveBeenCalled();
    expect(() => readFileSync(triggerReceipt)).toThrow();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

it("rejects a forged capability and ignores an expired terminal record", async () => {
  const directory = realpathSync(
    mkdtempSync(path.join(tmpdir(), "iconsmith-interrupt-forged-"))
  );
  try {
    expect(() =>
      bindDiagnosticFinalizationObserver({
        binding: {
          callId: "00000000-0000-4000-8000-000000000000",
          finalizedReceiptHash: HASH,
          inspectionHash: HASH,
          intentHash: HASH,
          programHashes: { filled: HASH },
          responseSchemaHash: HASH,
          stage: "02-finalize",
          stageDeadlineAt: 800,
          triggerReceipt: path.join(directory, "forged-trigger.json"),
        },
        capability: {
          descriptor: {
            createdAt: 100,
            descriptorReceipt: path.join(directory, "missing.json"),
            diagnosticId: "forged",
            expectedImage: IMAGE,
            expiresAt: 900,
            kind: "native-finalization-interruption-diagnostic",
            originalDeadlineAt: 1000,
            requestId: HASH,
            reservationHash: HASH,
            routeHash: HASH,
            schemaVersion: 1,
          },
          descriptorHash: HASH,
        },
      })
    ).toThrow("did not match");
    const kill = vi.fn();
    const canonical = fixture();
    const expired = bindDiagnosticFinalizationObserver({
      binding: {
        callId: "00000000-0000-4000-8000-000000000001",
        finalizedReceiptHash: HASH,
        inspectionHash: HASH,
        intentHash: HASH,
        programHashes: { filled: HASH },
        responseSchemaHash: HASH,
        stage: "03-finalize",
        stageDeadlineAt: canonical.capability.descriptor.expiresAt - 1,
        triggerReceipt: path.join(directory, "expired-trigger.json"),
      },
      capability: canonical.capability,
      now: () => canonical.capability.descriptor.expiresAt,
    });
    await expired.observe(finalLine, SIGNAL, {} as never, kill);
    expect(kill).not.toHaveBeenCalled();
    rmSync(canonical.directory, { force: true, recursive: true });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

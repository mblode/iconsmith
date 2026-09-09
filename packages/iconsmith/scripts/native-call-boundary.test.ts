import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import type { statfsSync as StatfsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import {
  assertNativeCallMayStart,
  createNativeCallBoundary,
  NATIVE_CALL_MINIMUM_FREE_BYTES,
  observeNativeCallStop,
  reserveNativeCall,
  readNativeCallBoundary,
  settleNativeCall,
} from "./native-call-boundary.js";

const diskObservation = vi.hoisted(() => ({
  availableBlocks: undefined as bigint | "unavailable" | undefined,
}));
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<{
    [key: string]: unknown;
    statfsSync: typeof StatfsSync;
  }>("node:fs");
  return {
    ...actual,
    statfsSync: (target: string, options?: { bigint?: boolean }) => {
      if (diskObservation.availableBlocks === "unavailable") {
        throw new Error("statfs unavailable");
      }
      if (diskObservation.availableBlocks !== undefined) {
        const observed = actual.statfsSync(target, { bigint: true });
        return {
          ...observed,
          bavail: diskObservation.availableBlocks,
          bsize: 1n,
        };
      }
      return options?.bigint
        ? actual.statfsSync(target, { bigint: true })
        : actual.statfsSync(target);
    },
  };
});

const roots: string[] = [];
afterEach(() => {
  diskObservation.availableBlocks = undefined;
  vi.useRealTimers();
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
  roots.length = 0;
});

const setup = (maxCalls = 2, campaignStopFile?: string) => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "native-boundary-"))
  );
  roots.push(root);
  const directory = path.join(root, "calls");
  const deadlineAt = Date.now() + 100_000;
  const reservationHash = createNativeCallBoundary(directory, {
    billing: "subscription",
    ...(campaignStopFile ? { campaignStopFile } : {}),
    deadlineAt,
    maxCalls,
    minimumCallReserveMs: 5000,
    reservationId: "wave-b",
    routeHash: "a".repeat(64),
  });
  return {
    deadlineAt,
    directory,
    minimumRemainingMs: 5000,
    requestId: "folder-lock16",
    reservationHash,
    stage: "construct",
  };
};

test.each([
  ["below the floor", BigInt(NATIVE_CALL_MINIMUM_FREE_BYTES - 1)],
  ["unavailable", "unavailable" as const],
])(
  "refuses a native reservation when disk observation is %s",
  (_label, value) => {
    const options = setup();
    diskObservation.availableBlocks = value;
    expect(() => reserveNativeCall(options)).toThrow(/disk|2 GiB/iu);
    expect(
      JSON.parse(
        readFileSync(path.join(options.directory, "dispatches.json"), "utf-8")
      ).calls
    ).toEqual([]);
    expect(
      readdirSync(options.directory).filter((name) =>
        name.endsWith(".intent.json")
      )
    ).toEqual([]);
    expect(existsSync(path.join(options.directory, "boundary.lock"))).toBe(
      false
    );
  }
);

test("rechecks disk at workload start and records both accepted observations", () => {
  const options = setup();
  diskObservation.availableBlocks = BigInt(
    NATIVE_CALL_MINIMUM_FREE_BYTES + 4096
  );
  const intent = reserveNativeCall(options);
  expect(intent.availableDiskBytesAtReservation).toBe(
    NATIVE_CALL_MINIMUM_FREE_BYTES + 4096
  );
  diskObservation.availableBlocks = BigInt(NATIVE_CALL_MINIMUM_FREE_BYTES - 1);
  expect(() => assertNativeCallMayStart(options.directory, intent)).toThrow(
    "at least 2 GiB"
  );
  const startedFile = path.join(
    options.directory,
    `${intent.callId}.started.json`
  );
  expect(existsSync(startedFile)).toBe(false);

  diskObservation.availableBlocks = BigInt(
    NATIVE_CALL_MINIMUM_FREE_BYTES + 8192
  );
  assertNativeCallMayStart(options.directory, intent);
  expect(JSON.parse(readFileSync(startedFile, "utf-8"))).toMatchObject({
    availableDiskBytesAtStart: NATIVE_CALL_MINIMUM_FREE_BYTES + 8192,
  });
});
const evidence = (
  options: ReturnType<typeof setup>,
  intent: ReturnType<typeof reserveNativeCall>
) => {
  const evidenceFile = path.join(
    options.directory,
    `${intent.callId}.container.json`
  );
  const bytes = JSON.stringify({
    container: {
      artifactEligible: true,
      containerAbsent: true,
      containerId: "d".repeat(64),
      containmentScope: "docker-private-pid-namespace",
      process: { code: 0, killed: false },
      status: "complete",
    },
    deadlineAt: intent.deadlineAt,
    intentHash: createHash("sha256")
      .update(JSON.stringify(intent))
      .digest("hex"),
  });
  writeFileSync(evidenceFile, bytes);
  return {
    evidenceFile,
    evidenceHash: createHash("sha256").update(bytes).digest("hex"),
  };
};
const failedEvidence = (
  options: ReturnType<typeof setup>,
  intent: ReturnType<typeof reserveNativeCall>,
  quiescent = true
) => {
  const evidenceFile = path.join(
    options.directory,
    `${intent.callId}.failed-container.json`
  );
  const bytes = JSON.stringify({
    container: {
      artifactEligible: false,
      containerAbsent: true,
      containerId: "d".repeat(64),
      containmentScope: "docker-private-pid-namespace",
      process: {
        code: 1,
        killed: false,
        quiescenceScope: "process-group-and-observed-descendants",
        quiescent,
        stderr: "failed",
        stdout: "",
      },
      status: "workload-failed",
    },
    deadlineAt: intent.deadlineAt,
    intentHash: createHash("sha256")
      .update(JSON.stringify(intent))
      .digest("hex"),
  });
  writeFileSync(evidenceFile, bytes);
  return {
    evidenceFile,
    evidenceHash: createHash("sha256").update(bytes).digest("hex"),
  };
};
const settle = (
  options: ReturnType<typeof setup>,
  intent: ReturnType<typeof reserveNativeCall>
) => {
  if (
    !existsSync(path.join(options.directory, `${intent.callId}.started.json`))
  ) {
    assertNativeCallMayStart(options.directory, intent);
  }
  return settleNativeCall({
    accounting: "settled",
    containment: "container-absent",
    directory: options.directory,
    ...evidence(options, intent),
    intent,
    outcome: "complete",
  });
};

test.each(["reserve", "start", "settle"])(
  "latches the frozen campaign STOP observed at %s",
  (stage) => {
    const stopRoot = mkdtempSync(path.join(os.tmpdir(), "campaign-stop-"));
    roots.push(stopRoot);
    const stop = path.join(stopRoot, "STOP");
    const options = setup(2, stop);
    const intent = stage === "reserve" ? undefined : reserveNativeCall(options);
    if (stage === "settle" && intent) {
      assertNativeCallMayStart(options.directory, intent);
    }
    writeFileSync(stop, "STOP");
    if (stage === "reserve") {
      expect(() => reserveNativeCall(options)).toThrow("stopped");
    }
    if (stage === "start" && intent) {
      expect(() => assertNativeCallMayStart(options.directory, intent)).toThrow(
        "cannot start"
      );
    }
    if (stage === "settle" && intent) {
      settle(options, intent);
    }
    unlinkSync(stop);
    expect(
      readFileSync(path.join(options.directory, "stopped.json"), "utf-8")
    ).toContain("campaign-stop-sentinel");
    expect(() => reserveNativeCall({ ...options, stage: "next" })).toThrow(
      "stopped"
    );
  }
);
test("records intent before a call and blocks crashes before terminal settlement", () => {
  const options = setup();
  const intent = reserveNativeCall(options);
  expect(
    JSON.parse(
      readFileSync(
        path.join(options.directory, `${intent.callId}.intent.json`),
        "utf-8"
      )
    )
  ).toEqual(intent);
  expect(() => reserveNativeCall({ ...options, stage: "review" })).toThrow(
    "Ambiguous"
  );
  settle(options, intent);
  expect(reserveNativeCall({ ...options, stage: "review" }).callId).not.toBe(
    intent.callId
  );
});
test("STOP is shared across stages and remains latched after sentinel removal", () => {
  const options = setup();
  const intent = reserveNativeCall(options);
  assertNativeCallMayStart(options.directory, intent);
  writeFileSync(path.join(options.directory, "STOP"), "stop");
  settle(options, intent);
  unlinkSync(path.join(options.directory, "STOP"));
  expect(() =>
    reserveNativeCall({ ...options, stage: "clarification" })
  ).toThrow("latched");
});
test("actively observes one started call and never unlatches a removed STOP", () => {
  const options = setup();
  const intent = reserveNativeCall(options);
  expect(() => observeNativeCallStop(options.directory, intent)).toThrow(
    "start evidence missing"
  );
  assertNativeCallMayStart(options.directory, intent);
  expect(observeNativeCallStop(options.directory, intent)).toBe(false);
  writeFileSync(path.join(options.directory, "STOP"), "stop");
  expect(observeNativeCallStop(options.directory, intent)).toBe(true);
  unlinkSync(path.join(options.directory, "STOP"));
  expect(observeNativeCallStop(options.directory, intent)).toBe(true);
  expect(() => reserveNativeCall({ ...options, stage: "next" })).toThrow(
    "stopped"
  );
});
test("max calls counts failed settled attempts and never resets on resume", () => {
  const options = setup(1);
  const intent = reserveNativeCall(options);
  assertNativeCallMayStart(options.directory, intent);
  settleNativeCall({
    accounting: "settled",
    containment: "container-absent",
    directory: options.directory,
    ...failedEvidence(options, intent),
    intent,
    outcome: "failed",
  });
  expect(() => reserveNativeCall({ ...options, stage: "repair" })).toThrow(
    "exhausted"
  );
  expect(() => reserveNativeCall(options)).toThrow("latched");
});
test("unknown charge or unproven containment prevents later calls", () => {
  const options = setup();
  const intent = reserveNativeCall(options);
  settleNativeCall({
    accounting: "unknown",
    containment: "unproven",
    directory: options.directory,
    ...evidence(options, intent),
    intent,
    outcome: "cancelled",
  });
  expect(() => reserveNativeCall(options)).toThrow("latched");
});
test("rejects reservation drift, extended deadlines and nominal tiny attempts", () => {
  const options = setup();
  expect(() =>
    reserveNativeCall({ ...options, reservationHash: "f".repeat(64) })
  ).toThrow("identity drift");
  expect(() =>
    reserveNativeCall({ ...options, deadlineAt: options.deadlineAt + 1 })
  ).toThrow("Invalid native stage");
  expect(() =>
    reserveNativeCall({ ...options, deadlineAt: Date.now() + 1 })
  ).toThrow("reserve exhausted");
});
test("concurrent resume contention is fail closed; copied settlement does not consume intent", () => {
  const options = setup();
  const lock = path.join(options.directory, "boundary.lock");
  writeFileSync(lock, "occupied");
  expect(() => reserveNativeCall(options)).toThrow();
  unlinkSync(lock);
  const intent = reserveNativeCall(options);
  expect(() => settle(options, { ...intent, stage: "different" })).toThrow(
    "intent mismatch"
  );
  settle(options, intent);
  expect(() => settle(options, intent)).toThrow("already exists");
});
test("late settlement preserves original deadline and cannot turn time back", () => {
  const options = setup();
  const intent = reserveNativeCall(options);
  assertNativeCallMayStart(options.directory, intent);
  vi.useFakeTimers();
  vi.setSystemTime(options.deadlineAt + 1);
  expect(settle(options, intent).deadlineExceeded).toBe(true);
  expect(() => reserveNativeCall({ ...options, stage: "review" })).toThrow(
    "reserve exhausted"
  );
});

test("a settled provider stage cannot be silently dispatched a second time", () => {
  const options = setup();
  const intent = reserveNativeCall(options);
  settle(options, intent);
  expect(() => reserveNativeCall(options)).toThrow("already dispatched");
});

test("deleted intent cannot restore consumed call capacity", () => {
  const options = setup();
  const intent = reserveNativeCall(options);
  settle(options, intent);
  unlinkSync(path.join(options.directory, `${intent.callId}.intent.json`));
  expect(() => reserveNativeCall({ ...options, stage: "review" })).toThrow(
    "journal mismatch"
  );
});

test("a three-field fabricated terminal cannot release the next call", () => {
  const options = setup();
  const intent = reserveNativeCall(options);
  writeFileSync(
    path.join(options.directory, `${intent.callId}.terminal.json`),
    JSON.stringify({
      accounting: "settled",
      containment: "container-absent",
      intentHash: createHash("sha256")
        .update(JSON.stringify(intent))
        .digest("hex"),
    })
  );
  expect(() => reserveNativeCall({ ...options, stage: "review" })).toThrow(
    "Invalid native terminal"
  );
});
test("STOP between intent and workload start prevents dispatch and latches", () => {
  const options = setup();
  const intent = reserveNativeCall(options);
  writeFileSync(path.join(options.directory, "STOP"), "stop");
  expect(() => assertNativeCallMayStart(options.directory, intent)).toThrow(
    "cannot start"
  );
  unlinkSync(path.join(options.directory, "STOP"));
  expect(() => assertNativeCallMayStart(options.directory, intent)).toThrow(
    "cannot start"
  );
});

test("an intent absent from the reservation journal cannot start", () => {
  const options = setup(1);
  const intent = reserveNativeCall(options);
  const forged = {
    ...intent,
    callId: "forged-extra-call",
    requestId: "forged-request",
    stage: "forged-stage",
  };
  writeFileSync(
    path.join(options.directory, `${forged.callId}.intent.json`),
    JSON.stringify(forged)
  );
  expect(() => assertNativeCallMayStart(options.directory, forged)).toThrow(
    "journal mismatch"
  );
});

test("deleting the start marker cannot permit a second workload start", () => {
  const options = setup();
  const intent = reserveNativeCall(options);
  assertNativeCallMayStart(options.directory, intent);
  unlinkSync(path.join(options.directory, `${intent.callId}.started.json`));
  expect(() => assertNativeCallMayStart(options.directory, intent)).toThrow(
    "intent mismatch"
  );
});

test("complete settlement requires journal-bound start evidence", () => {
  const options = setup();
  const intent = reserveNativeCall(options);
  expect(() =>
    settleNativeCall({
      accounting: "settled",
      containment: "container-absent",
      directory: options.directory,
      ...evidence(options, intent),
      intent,
      outcome: "complete",
    })
  ).toThrow("start evidence missing");
});

test("strict reopen retains settled calls and original deadline without redispatch", () => {
  const options = setup();
  const intent = reserveNativeCall(options);
  settle(options, intent);
  const reopened = readNativeCallBoundary(
    options.directory,
    options.reservationHash
  );
  expect(reopened.calls).toEqual([intent]);
  expect(reopened.reservation.deadlineAt).toBe(options.deadlineAt);
  expect(reopened.stopped).toBe(false);
  expect(() => reserveNativeCall(options)).toThrow("already dispatched");
});
test("strict reopen refuses in-flight, orphan, tampered and contended accounting", () => {
  const options = setup();
  const intent = reserveNativeCall(options);
  expect(() =>
    readNativeCallBoundary(options.directory, options.reservationHash)
  ).toThrow("Ambiguous");
  settle(options, intent);
  const orphan = path.join(options.directory, "orphan.terminal.json");
  writeFileSync(orphan, "{}");
  expect(() =>
    readNativeCallBoundary(options.directory, options.reservationHash)
  ).toThrow("orphan");
  unlinkSync(orphan);
  expect(() =>
    readNativeCallBoundary(options.directory, "b".repeat(64))
  ).toThrow("identity drift");
  const lock = path.join(options.directory, "boundary.lock");
  writeFileSync(lock, "");
  expect(() =>
    readNativeCallBoundary(options.directory, options.reservationHash)
  ).toThrow();
});
test("strict reopen reports a latched stop and never grants a fresh deadline", () => {
  vi.useFakeTimers();
  const options = setup();
  writeFileSync(path.join(options.directory, "STOP"), "stop");
  expect(
    readNativeCallBoundary(options.directory, options.reservationHash).stopped
  ).toBe(true);
  unlinkSync(path.join(options.directory, "STOP"));
  vi.setSystemTime(options.deadlineAt + 1);
  const reopened = readNativeCallBoundary(
    options.directory,
    options.reservationHash
  );
  expect(reopened.stopped).toBe(true);
  expect(reopened.reservation.deadlineAt).toBe(options.deadlineAt);
  expect(() => reserveNativeCall(options)).toThrow("stopped");
});

test("validates the same exact reservation schema on create and reopen", () => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "native-boundary-schema-"))
  );
  roots.push(root);
  const reservation = {
    billing: "subscription" as const,
    deadlineAt: Date.now() + 100_000,
    extra: "not-in-schema",
    maxCalls: 1,
    minimumCallReserveMs: 5000,
    reservationId: "schema",
    routeHash: "a".repeat(64),
  };
  expect(() =>
    createNativeCallBoundary(path.join(root, "extra"), reservation)
  ).toThrow("Invalid bounded native reservation");

  const options = setup();
  const file = path.join(options.directory, "reservation.json");
  const envelope = JSON.parse(readFileSync(file, "utf-8"));
  envelope.reservation.maxCalls = "2";
  envelope.reservationHash = createHash("sha256")
    .update(JSON.stringify(envelope.reservation))
    .digest("hex");
  writeFileSync(file, JSON.stringify(envelope));
  expect(() =>
    readNativeCallBoundary(options.directory, envelope.reservationHash)
  ).toThrow("Invalid bounded native reservation");
});

test("rejects hard-linked evidence and a boundary below a symlinked ancestor", () => {
  const options = setup();
  const intent = reserveNativeCall(options);
  settle(options, intent);
  const evidenceFile = path.join(
    options.directory,
    `${intent.callId}.container.json`
  );
  const alias = path.join(options.directory, "evidence-hardlink.json");
  linkSync(evidenceFile, alias);
  expect(() =>
    readNativeCallBoundary(options.directory, options.reservationHash)
  ).toThrow("owned regular files");

  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "native-boundary-link-"))
  );
  roots.push(root);
  const actual = path.join(root, "actual");
  mkdirSync(actual);
  const linked = path.join(root, "linked");
  symlinkSync(actual, linked, "dir");
  expect(() =>
    createNativeCallBoundary(path.join(linked, "calls"), {
      billing: "subscription",
      deadlineAt: Date.now() + 100_000,
      maxCalls: 1,
      minimumCallReserveMs: 5000,
      reservationId: "linked",
      routeHash: "a".repeat(64),
    })
  ).toThrow("owned directory");
});

test("latches STOP before an in-flight journal makes reopen fail", () => {
  const options = setup();
  reserveNativeCall(options);
  const stop = path.join(options.directory, "STOP");
  writeFileSync(stop, "stop");
  expect(() =>
    readNativeCallBoundary(options.directory, options.reservationHash)
  ).toThrow("Ambiguous");
  unlinkSync(stop);
  expect(
    readFileSync(path.join(options.directory, "stopped.json"), "utf-8")
  ).toContain("stop-sentinel");
});

test("accepts factory-shaped failed settlement only with proven quiescence", () => {
  const options = setup();
  const intent = reserveNativeCall(options);
  assertNativeCallMayStart(options.directory, intent);
  expect(() =>
    settleNativeCall({
      accounting: "settled",
      containment: "container-absent",
      directory: options.directory,
      ...failedEvidence(options, intent, false),
      intent,
      outcome: "failed",
    })
  ).toThrow("failed settlement evidence");
  unlinkSync(
    path.join(options.directory, `${intent.callId}.failed-container.json`)
  );
  settleNativeCall({
    accounting: "settled",
    containment: "container-absent",
    directory: options.directory,
    ...failedEvidence(options, intent),
    intent,
    outcome: "failed",
  });
  expect(
    readNativeCallBoundary(options.directory, options.reservationHash).calls
  ).toEqual([intent]);
});
